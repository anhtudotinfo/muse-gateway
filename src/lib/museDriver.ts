import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { getBrowserExecutable, getSavedSessions, parseCookieString, formatCookiesForPuppeteer } from './museService';
import { parseCommandRequests, isCommandAllowed, runLocalCommand } from './toolBridge';
import './logBuffer';
import { MEDIA_DIR, persistMediaFile } from './mediaStore';
import type { OpenAIModel, Profile } from '@/types';

export interface ChatOptions {
  prompt: string;
  onChunk?: ((chunk: string) => void) | null;
  signal?: AbortSignal | null;
  cwd?: string | null;
  sessionId?: string | null;
  model?: string | null;
  ua?: string | null;
  /** Which API key made the request (record name, or 'open'). Usage tracking only. */
  keyName?: string | null;
  /** Which OpenAI-compatible endpoint served the request. Usage tracking only. */
  endpoint?: string | null;
  /** Reference images to attach to the message (data: URLs). Used for
   *  frame-bridging — the previous scene's last frame becomes this one's
   *  starting frame for seamless cuts. */
  images?: string[];
  /** Start a brand-new Muse chat before sending — used for the first shot
   *  of a new scenario so prior threads don't bleed context in. */
  newChat?: boolean | null;
}

/** A media element found in a Muse reply — may be a blob: URL (page-local). */
interface MediaItem {
  src: string;
  name?: string;
}

/** A completed Muse reply — text plus resolved media URLs. */
export interface ChatResult {
  text: string;
  media: string[];
}

// Max command-execution rounds per user prompt before giving the reply back.
const MAX_CMD_ROUNDS = 5;

interface AccountSlot {
  context: BrowserContext;
  page: Page;
  cookiesRaw: string;
}

class MuseDriverService {
  private browser: Browser | null = null;
  private slots: Map<string, AccountSlot> = new Map();
  private busy: Set<string> = new Set();
  private waiting: Set<string> = new Set();
  private lastActiveTime: number = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Auto-close headless browser after 15 minutes of inactivity to save RAM
    this.idleTimer = setTimeout(() => {
      this.close();
    }, 15 * 60 * 1000);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;

    const browserInfo = getBrowserExecutable('chrome');
    if (!browserInfo) {
      throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy chủ.');
    }

    this.browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });
    return this.browser;
  }

  // One incognito context per account — cookies are isolated, so every saved
  // profile becomes an independent Muse session inside a single browser.
  async getPageForSession(session: Profile): Promise<Page> {
    this.resetIdleTimer();
    const existing = this.slots.get(session.id);
    if (
      existing &&
      existing.cookiesRaw === session.cookies &&
      !existing.page.isClosed()
    ) {
      return existing.page;
    }

    if (existing) {
      try { await existing.context.close(); } catch {}
      this.slots.delete(session.id);
    }

    const browser = await this.ensureBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const map = parseCookieString(session.cookies);
    await page.setCookie(...formatCookiesForPuppeteer(map));

    console.log(`[MuseDriver] Loading https://muse.ai/ for account "${session.name}" ...`);
    await page.goto('https://muse.ai/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
    // Realtime socket needs a moment after load — sending earlier gets
    // "Delivery not confirmed" and no reply is ever generated.
    await new Promise((r) => setTimeout(r, 3500));

    this.slots.set(session.id, { context, page, cookiesRaw: session.cookies });
    return page;
  }

  private resolveSession(sessionId?: string | null): Profile {
    const sessions = getSavedSessions();
    if (!sessions.length) throw new Error('Chưa có cookie nào được lưu trong hệ thống.');
    const found = sessionId
      ? sessions.find((s) => s.id === sessionId)
      : sessions[0];
    if (!found) throw new Error(`Không tìm thấy session "${sessionId}".`);
    return found;
  }

  async chat({ prompt, onChunk = null, signal = null, cwd = null, sessionId = null, images, newChat = null }: ChatOptions): Promise<ChatResult> {
    const session = this.resolveSession(sessionId);

    // Serialize per account — different accounts run in parallel. Requests
    // parked here are reported as "queued" in pool state.
    this.waiting.add(session.id);
    try {
      let announced = false;
      while (this.busy.has(session.id)) {
        if (signal?.aborted) throw new Error('Request aborted by client.');
        if (!announced) {
          console.log(`[MuseDriver] queued — "${session.name}" đang bận, request xếp hàng chờ`);
          announced = true;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      this.waiting.delete(session.id);
    }

    this.busy.add(session.id);
    this.lastActiveTime = Date.now();

    try {
      const page = await this.getPageForSession(session);
      if (newChat) await this.openNewChat(page);
      const textarea = await page.waitForSelector('textarea', { timeout: 20000 });
      if (!textarea) throw new Error('Không tìm thấy khung chat trên Muse.');

      let toSend = prompt.trim();
      if (!toSend) throw new Error('Prompt rỗng.');

      // Agent loop: send → read reply → if Muse asks us to run local commands,
      // execute them here and paste [COMMAND OUTPUT] back into the thread.
      let lastReply = '';
      let lastMedia: string[] = [];
      for (let round = 0; round <= MAX_CMD_ROUNDS; round++) {
        // Buffer this round's stream deltas; only flush to the caller when the
        // round turns out to be the final answer (no command request inside).
        let buffered = '';
        // Only the first round carries attachments — later rounds are
        // follow-up prompts and must not re-send the bridge frame.
        const result = await this.sendAndAwaitReply(page, toSend, signal, (d) => {
          buffered += d;
        }, round === 0 ? images : undefined);

        if (result.text) lastReply = result.text;
        if (result.media.length) lastMedia = result.media;
        const cmds = parseCommandRequests(result.text).filter(isCommandAllowed);
        if (!cmds.length || round === MAX_CMD_ROUNDS) {
          if (buffered && onChunk) onChunk(buffered);
          return { text: lastReply || 'Đã gửi yêu cầu đến Muse thành công.', media: lastMedia };
        }

        for (const c of cmds) console.log('[MuseDriver] Muse requested command:', c);
        const results = cmds.map(
          (c) => `$ ${c}\n${runLocalCommand(c, cwd)}`
        );
        toSend =
          `[COMMAND OUTPUT — executed on the user's machine]\n` +
          results.join('\n\n').slice(0, 24000) +
          `\n[/COMMAND OUTPUT]`;
      }
      return { text: lastReply || 'Đã gửi yêu cầu đến Muse thành công.', media: lastMedia };
    } catch (err) {
      console.error('[MuseDriver] Chat error:', err);
      await this.dropSlot(session.id);
      throw err;
    } finally {
      this.busy.delete(session.id);
      this.resetIdleTimer();
    }
  }

  isBusy(sessionId: string): boolean {
    return this.busy.has(sessionId);
  }

  isQueued(sessionId: string): boolean {
    return this.waiting.has(sessionId) && !this.busy.has(sessionId);
  }

  /** Warm up a session's page (loads Muse if needed, touches the realtime
   *  socket) so the cookie stays fresh and the account answers instantly.
   *  Skips accounts currently processing a request. */
  async keepAlive(sessionId: string): Promise<'ok' | 'busy' | 'error'> {
    try {
      // Skip accounts busy or about to be (a request is parked on them).
      if (this.busy.has(sessionId) || this.waiting.has(sessionId)) return 'busy';
      const session = this.resolveSession(sessionId);
      const page = await this.getPageForSession(session);
      // Touch the page — realtime socket pings keep the session warm.
      await page.evaluate(() => document.title).catch(() => {});
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Open a fresh chat thread on the account's page. Heuristic — muse.ai
   *  has no stable "new chat" selector, so try (1) a control labelled
   *  "New chat"/"Chat mới", (2) a "+" affordance sitting next to the
   *  chats/sidebar section header, (3) reload the app root. Best-effort:
   *  worst case we stay on the current thread rather than failing. */
  private async openNewChat(page: Page): Promise<void> {
    try {
      const strategy: string | null = await page.evaluate(() => {
        const clickables = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, a, [role="button"], [role="link"], li > *'
          )
        );
        // 1) Explicit "New chat" label — most reliable when present.
        const labelled = clickables.find((el) =>
          /new\s*chat|chat\s*mới|cuộc\s*trò\s*chuyện\s*mới/i.test(
            (el.getAttribute('aria-label') || '') +
              ' ' +
              (el.title || '') +
              ' ' +
              (el.textContent || '')
          )
        );
        if (labelled) {
          labelled.click();
          return 'label';
        }
        // 2) "+" affordance near a sidebar section that holds chats —
        //    look for a header mentioning chats/history then its "+".
        const headers = Array.from(
          document.querySelectorAll<HTMLElement>('aside *, nav *, [class*="sidebar"] *')
        );
        const chatHeader = headers.find((el) =>
          /side\s*chats|chats|lịch\s*sử|history|đoạn\s*chat/i.test(
            (el.textContent || '').trim()
          ) && (el.textContent || '').trim().length < 40
        );
        if (chatHeader) {
          const scope = chatHeader.parentElement || chatHeader;
          const plus = scope.querySelector<HTMLElement>(
            'button, [role="button"], svg, a'
          );
          const plusBtn =
            plus &&
            ((plus.textContent || '').trim() === '+' ||
              /add|new|plus/i.test(plus.getAttribute('aria-label') || ''));
          if (plus && plusBtn) {
            plus.click();
            return 'sidebar-plus';
          }
        }
        return null;
      });
      if (!strategy) {
        // 3) Reload the app root — lands on the default/new composer.
        await page.goto(new URL(page.url()).origin + '/', {
          waitUntil: 'domcontentloaded',
        });
      }
      await page.waitForSelector('textarea', { timeout: 15000 });
      // Let the new thread mount before we paste into it.
      await new Promise((r) => setTimeout(r, 800));
      console.log(`[MuseDriver] new chat opened via ${strategy ?? 'reload'}`);
    } catch (e) {
      console.log('[MuseDriver] openNewChat failed — staying on current thread:', e);
    }
  }

  private async dropSlot(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (slot) {
      try { await slot.context.close(); } catch {}
      this.slots.delete(sessionId);
    }
  }

  private async sendAndAwaitReply(
    page: Page,
    cleanPrompt: string,
    signal: AbortSignal | null,
    onChunk: ((delta: string) => void) | null,
    images?: string[]
  ): Promise<ChatResult> {
    try {
      console.log('[MuseDriver] Sending clean prompt to Muse:', cleanPrompt.slice(0, 100));

      const sendOnce = async () => {
        // 0. Attach reference images first (frame bridging): real file input
        // if the composer has one, else a synthetic paste event. Bytes are
        // decoded in Node and passed across — fetching data: URLs inside the
        // page is blocked by muse.ai's connect-src CSP.
        if (images?.length) {
          // Decode data URLs to real temp files — Puppeteer's uploadFile
          // (CDP DOM.setFileInputFiles) is the reliable way to feed an
          // <input type=file>; a synthetic DataTransfer on .files half-works:
          // the chip renders but upload state breaks → "Delivery not confirmed".
          const tmpFiles: string[] = [];
          for (const [i, u] of images.entries()) {
            const m = u.match(/^data:([^;]+);base64,(.+)$/s);
            if (!m) continue;
            const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
            const p = path.join(MEDIA_DIR, `frame-${Date.now()}-${i}.${ext}`);
            fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
            tmpFiles.push(p);
          }
          // Composer-local pending attachment? A blob: preview img / hatch
          // marker inside the composer's ancestor means a resend already
          // attached — don't stack duplicates.
          const pendingProbe = `(() => {
            const ta = document.querySelector('textarea');
            let scope = ta;
            for (let i = 0; i < 6 && scope && scope.parentElement; i++) scope = scope.parentElement;
            return !!(scope && scope.querySelector('img[src^="blob:"], [data-hatch-image-src], [data-hatch-video-src]'));
          })()`;
          const already = await page.evaluate(pendingProbe);
          let how = 'skip-pending';
          if (!already && tmpFiles.length) {
            // Debug: which file inputs exist and where do they live?
            const inputInfo = await page.evaluate(() =>
              Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => ({
                i,
                accept: el.getAttribute('accept'),
                cls: String(el.className).slice(0, 60),
                parCls: String(el.parentElement?.className || '').slice(0, 80),
                nearTa: !!el.closest('form')?.querySelector('textarea'),
              }))
            );
            console.log('[MuseDriver] file inputs:', JSON.stringify(inputInfo));
            const input = await page.$('input[type="file"]');
            if (input) {
              try {
                await input.uploadFile(...tmpFiles);
                how = 'upload';
              } catch (e) {
                how = 'err:' + String(e);
              }
            } else {
              how = 'no-input';
            }
          }
          console.log('[MuseDriver] attach', images.length, 'image(s) via', how);
          // Wait for the composer's attachment chip/preview to render and
          // the upload to settle — sending early → "Delivery not confirmed".
          if (how === 'upload' || how === 'skip-pending') {
            for (let t = 0; t < 25; t++) {
              await new Promise((r) => setTimeout(r, 400));
              if (await page.evaluate(pendingProbe)) break;
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
          // Temp frames are consumed by the browser — clean up.
          for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch {}
          }
        }

        // 1. Focus textarea and set value atomically without triggering Enter per line
        await page.evaluate((textToSet) => {
          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
          if (ta) {
            ta.focus();
            // React synthetic events bypass setter
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(ta, textToSet);
            } else {
              ta.value = textToSet;
            }
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, cleanPrompt);

        await new Promise((r) => setTimeout(r, 150));

        // 2. Submit the message once by pressing Enter
        await page.keyboard.press('Enter');
      };
      // Snapshot every media URL already on the page (avatar, older replies)
      // — anything still there was rendered before our prompt and can never
      // belong to this reply.
      await page.evaluate(() => {
        (window as any).__musePreMedia = new Set(
          Array.from(
            document.querySelectorAll(
              'video, source, img, a[href], [data-hatch-video-src], [data-hatch-image-src], [data-hatch-audio-src]'
            )
          ).flatMap((el: Element) =>
            [
              (el as HTMLVideoElement).src,
              (el as HTMLVideoElement).currentSrc,
              (el as HTMLAnchorElement).href,
              el.getAttribute('data-hatch-video-src'),
              el.getAttribute('data-hatch-image-src'),
              el.getAttribute('data-hatch-audio-src'),
            ].filter(Boolean)
          )
        );
      });
      await sendOnce();

      let streamIndex = 0;
      let lastText = '';
      let lastMedia: MediaItem[] = [];
      let lastDbg: any = null;
      let lastChangeTime = Date.now();
      let failedSince: number | null = null;
      let resends = 0;
      const startTime = Date.now();
      // Media-producing prompts (video/image/…) get a longer window and a
      // post-text grace period — generated media typically lands in the DOM
      // seconds after the reply text settles.
      const wantsMedia = /video|clip|ảnh|anh\b|image|hình|mp4|render|animation|tạo/i.test(cleanPrompt);
      const TIMEOUT_MS = wantsMedia ? 240000 : 90000;
      const MEDIA_GRACE_MS = wantsMedia ? 60000 : 0;
      let stableSince: number | null = null;

      // 3. Poll the chat column for the assistant reply that follows our bubble.
      // Anchors on the actual bubble ELEMENT (exact text match, deepest node,
      // same column subtree as the composer) so a reply that merely echoes the
      // prompt ("Xin chào bạn...") can never be mistaken for the user bubble.
      while (Date.now() - startTime < TIMEOUT_MS && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, 400));

        const result = await page.evaluate((rawPrompt: string) => {
          const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
          const target = norm(rawPrompt);
          const snip = norm(rawPrompt.slice(0, 40));
          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
          const allEls = Array.from(document.querySelectorAll('body *')) as HTMLElement[];

          const depthOf = (el: Element | null): number => {
            let d = 0;
            while (el && el.parentElement) { d++; el = el.parentElement; }
            return d;
          };
          const taAnc: Element[] = [];
          for (let n: Element | null = ta; n; n = n.parentElement) taAnc.push(n);
          // How deep this element shares an ancestor with the composer —
          // chat-column content scores high, side-panel content scores low.
          const lcaScore = (el: Element): number => {
            for (let n: Element | null = el; n; n = n.parentElement) {
              if (taAnc.includes(n)) return depthOf(n);
            }
            return 0;
          };
          const noMatchChild = (el: Element, test: (e: Element) => boolean) =>
            !Array.from(el.children).some(test);

          const exact = (el: Element) => norm((el as HTMLElement).innerText) === target;
          const starts = (el: Element) => norm((el as HTMLElement).innerText).startsWith(snip);
          const tailSnip = norm(rawPrompt.slice(-40));

          // Structural anchor: the newest user-message bubble (Tailwind
          // `group/msg` container) holding any part of the prompt — robust
          // even when long messages render collapsed/truncated.
          let bubble: Element | null = null;
          const groups = allEls.filter(
            (el) =>
              typeof el.className === 'string' &&
              el.className.includes('group/msg') &&
              !el.querySelector('textarea') // never the composer row
          );
          for (let i = groups.length - 1; i >= 0; i--) {
            const t = norm(groups[i].innerText);
            if (t.includes(snip) || t.includes(tailSnip) || t.includes(target)) {
              bubble = groups[i];
              break;
            }
          }

          if (!bubble) {
            let cands = allEls.filter((el) => exact(el) && noMatchChild(el, exact));
            if (cands.length === 0) {
              cands = allEls.filter((el) => starts(el) && noMatchChild(el, starts));
            }
            if (cands.length === 0) return { reply: '', failed: false };

            const best = Math.max(...cands.map(lcaScore));
            const pool = cands
              .filter((c) => lcaScore(c) === best)
              .map((el) => ({ el, i: allEls.indexOf(el) }));
            // Newest user bubble: closest in length to the prompt (assistant
            // echoes are longer), ties go to the last in document order.
            pool.sort(
              (a, b) =>
                Math.abs(norm(a.el.innerText).length - target.length) -
                  Math.abs(norm(b.el.innerText).length - target.length) || b.i - a.i
            );
            bubble = pool[0].el;
          }

          // Composer root = the subtree containing the textarea — everything
          // after it in the chat column is composer/side-panel chrome.
          const bubbleAnc: Element[] = [];
          for (let n: Element | null = bubble; n; n = n.parentElement) bubbleAnc.push(n);
          const lca = taAnc.find((a) => bubbleAnc.includes(a)) || null;
          let composerRoot: Element | null = ta;
          while (composerRoot && composerRoot.parentElement && composerRoot.parentElement !== lca) {
            composerRoot = composerRoot.parentElement;
          }

          // Assistant reply = the next group/msg container after our bubble.
          // Scope collection to it; without one, stay inside the chat column —
          // nodes sharing no ancestor with the composer are side panels
          // (history / activity lists) and must not leak into the reply.
          const replyContainer =
            groups.find(
              (el) =>
                el !== bubble &&
                (bubble!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
            ) || null;
          const inScope = (el: Element): boolean =>
            replyContainer ? replyContainer.contains(el) : !!(lca && lca.contains(el));

          // The NEXT user turn after ours — user bubbles are the
          // right-aligned (ms-auto) group/msg containers. Anything after it
          // belongs to a later turn and must not leak into this reply
          // (batch runs: the next job's prompt/media must never attach to us).
          const isUserGroup = (el: Element) =>
            typeof el.className === 'string' &&
            el.className.includes('ms-auto') &&
            norm((el as HTMLElement).innerText).toLowerCase().startsWith('you:');
          const nextUserGroup =
            groups.find(
              (el) =>
                el !== bubble &&
                isUserGroup(el) &&
                (bubble!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
            ) || null;
          const beforeNextUser = (el: Element): boolean =>
            !nextUserGroup ||
            (el.compareDocumentPosition(nextUserGroup) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

          const STOP_WORDS = new Set([
            'invite', 'connected', 'message', 'today', 'chats', 'you', 'you:',
            'show in library', 'open chat and side chats', 'log in', 'sign up',
          ]);
          const SKIP_WORDS = new Set([
            'muse', 'copy', 'copied', 'share', 'regenerate', 'edit', 'retry',
            'like', 'dislike', 'read aloud', 'report', 'thanks',
            'delivered', 'seen', 'sent', 'just now',
            'no activity yet', 'activity',
            'assistant message:', 'user message:', 'assistant message', 'user message',
          ]);
          // Transient status lines shown while the assistant generates
          // ("Muse is working", "is working...", timestamps, ...).
          const TRANSIENT =
            /^((muse|assistant)\s+)?(is\s+)?(working|thinking|typing|generating|writing|searching|processing|responding|reasoning)/i;
          // Muse's own agent activity lines ("Listing files", "Reading file"...).
          const ACTIVITY =
            /^(listing|reading|writing|running|searching|opening|fetching|loading|analyzing|creating|updating|checking|building|installing|previewing|exporting|summarizing|structuring|animating|compiling|downloading|uploading|rendering|scanning|reviewing|auditing|editing|deleting|renaming|moving|copying|counting|measuring|calculating|estimating|gathering|preparing|waiting)\b/i;
          // Generic activity label: a bare "Xxx-ing <few words>" line with no
          // sentence punctuation — Muse's internal agent status lines.
          const GERUND_LINE = /^[a-z]+ing\b( [\w.:/\\-]+){0,4}[.…]{0,3}$/i;
          const TIME_RE = /^\d{1,2}:\d{2}\s?(am|pm)?$/i;

          // Collect text nodes in document order right after our bubble.
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const textNodes: Text[] = [];
          let n: Node | null;
          while ((n = walker.nextNode())) textNodes.push(n as Text);

          let startIdx = -1;
          for (let i = 0; i < textNodes.length; i++) {
            if (bubble.contains(textNodes[i].parentElement)) startIdx = i;
          }

          // Muse renders streamed tokens as separate text nodes / inline
          // spans. Group them by block ancestor (p/li/heading…) — or by the
          // reply container's direct child when no block exists — and read
          // the group's innerText so real paragraph breaks survive instead
          // of shredding the reply into one word per line.
          const groupOf = (parent: Element): Element => {
            const block = parent.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th');
            if (block) return block;
            if (replyContainer && replyContainer.contains(parent)) {
              let a = parent;
              while (a.parentElement && a.parentElement !== replyContainer) a = a.parentElement;
              return a;
            }
            return parent;
          };

          const chunks: string[] = [];
          const seenCode = new Set<Element>();
          const seenGroup = new Set<Element>();
          let failed = false;
          for (let i = startIdx + 1; i < textNodes.length; i++) {
            const parent = textNodes[i].parentElement;
            if (!parent) continue;
            if (composerRoot && composerRoot.contains(parent)) break;
            if (nextUserGroup && nextUserGroup.contains(parent)) break;
            const peek = norm(textNodes[i].textContent);
            if (peek && peek.toLowerCase() === 'delivery not confirmed') {
              failed = true;
              continue;
            }
            // Code blocks: innerText of the whole pre/code element preserves
            // real newlines — emit it once as a fenced block instead of
            // letting it shred into one text node per inline span.
            const codeEl = parent.closest('pre, code') as HTMLElement | null;
            if (codeEl) {
              if (seenCode.has(codeEl) || !inScope(codeEl)) continue;
              seenCode.add(codeEl);
              const codeText = (codeEl.innerText || '').trim();
              if (codeText) chunks.push('```\n' + codeText + '\n```');
              continue;
            }
            // Out-of-column text (history/activity panels) — skip, never break.
            if (!inScope(parent)) continue;
            const key = groupOf(parent);
            if (seenGroup.has(key)) continue;
            seenGroup.add(key);
            chunks.push((key as HTMLElement).innerText ?? key.textContent ?? '');
          }

          const lines: string[] = [];
          let stop = false;
          for (const chunk of chunks) {
            if (stop) break;
            for (const rawLine of String(chunk).split('\n')) {
              const t = norm(rawLine);
              if (!t) continue;
              const low = t.toLowerCase();
              if (STOP_WORDS.has(low)) { stop = true; break; }
              if (
                SKIP_WORDS.has(low) ||
                TRANSIENT.test(low) ||
                ACTIVITY.test(low) ||
                GERUND_LINE.test(low) ||
                TIME_RE.test(low) ||
                !/[a-zA-ZÀ-ỹ0-9]/.test(t)
              ) {
                continue;
              }
              lines.push(t.replace(/^(assistant|user) message:\s*/i, ''));
              if (lines.length >= 200) { stop = true; break; }
            }
          }

          // Media attachments in the same post-bubble region: <video>,
          // <img>, <source>, downloadable <a>, and hatch data-* attributes.
          // blob: URLs are kept — the driver resolves them after the reply
          // (they're only fetchable inside this page). Skips chrome
          // (icons/emoji/avatars); the region is only the assistant reply.
          const media: { src: string; name?: string }[] = [];
          const seenMedia = new Set<string>();
          const mediaDbg: any[] = [];
          const preMedia: Set<string> | undefined = (window as any).__musePreMedia;
          const pushUrl = (u?: string | null, name?: string) => {
            const s = (u || '').trim();
            if (!/^(https?:|blob:)/i.test(s)) return;
            if (/emoji|avatar|sprite|favicon|logo-|profile|icon-\d|\.svg(\?|$)/i.test(s)) return;
            if (preMedia?.has(s)) return; // existed before this prompt — not ours
            if (!seenMedia.has(s)) { seenMedia.add(s); media.push(name ? { src: s, name } : { src: s }); }
          };
          const fileNameOf = (el: Element): string | undefined => {
            const label = (el.closest('[aria-label]')?.getAttribute('aria-label')) || '';
            return label.match(/[\w.-]+\.(mp4|webm|mov|png|jpe?g|webp|gif|mp3|wav)/i)?.[0];
          };
          // Only elements inside a real attachment card count. Muse marks
          // generated media with hatch data-* attrs / test ids / filenames;
          // decorative <video>/<img> (the animated side-panel avatar, logo,
          // message avatars) have none of these markers.
          const ATTACHMENT =
            '[data-testid^="hatch-chat-attachment"], [data-hatch-video-wrapper], [data-hatch-image-wrapper], [data-hatch-audio-wrapper], [data-hatch-video-src], [data-hatch-image-src], [data-hatch-audio-src]';
          const isMediaAttachment = (el: Element): boolean =>
            !!el.closest(ATTACHMENT) ||
            !!fileNameOf(el) ||
            (el instanceof HTMLAnchorElement &&
              (el.hasAttribute('download') ||
                /\.(mp4|webm|mov|mkv|m3u8|png|jpe?g|webp|gif|mp3|wav|zip)(\?|#|$)/i.test(el.href)));
          const inReplyRegion = (el: Element): boolean => {
            if (!(bubble!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
            if (composerRoot && composerRoot.contains(el)) return false;
            if (!beforeNextUser(el)) return false;
            // Attachments WE sent (e.g. a bridge frame) render inside the
            // right-aligned user group — never count them as reply media.
            if (el.closest('[class*="ms-auto"]')) return false;
            // With a reply text container present, media must sit at/after it;
            // anything between our bubble and the reply is user-side chrome.
            if (
              replyContainer &&
              !replyContainer.contains(el) &&
              !(replyContainer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
            ) return false;
            // Media lives in the same chat column as the reply but outside
            // the reply's group/msg text node (attachment cards are siblings,
            // not descendants, of the text group) — scope by the column, then
            // let the attachment-marker gate reject chrome like the avatar.
            return !!(lca && lca.contains(el));
          };
          const mediaEls = document.querySelectorAll(
            'video, source, img, a[href], [data-hatch-video-src], [data-hatch-image-src], [data-hatch-audio-src]'
          );
          // Debug: ALL candidate media elements (even out-of-scope) so we can
          // see why something like the side-panel avatar leaked in.
          for (const el of Array.from(mediaEls)) {
            const name = fileNameOf(el);
            const attrSrc =
              el.getAttribute('data-hatch-video-src') ||
              el.getAttribute('data-hatch-image-src') ||
              el.getAttribute('data-hatch-audio-src');
            const src =
              attrSrc ||
              (el instanceof HTMLVideoElement ? el.src || el.currentSrc : null) ||
              (el instanceof HTMLSourceElement ? el.src : null) ||
              (el instanceof HTMLImageElement ? el.currentSrc || el.src : null) ||
              ((el as HTMLAnchorElement).href || null);
            if (src && mediaDbg.length < 20) {
              const pos = bubble!.compareDocumentPosition(el);
              mediaDbg.push({
                src: src.slice(0, 40),
                name,
                idx: allEls.indexOf(el as HTMLElement),
                pos,
                dur: el instanceof HTMLVideoElement ? Math.round(el.duration || 0) : undefined,
                att: isMediaAttachment(el),
                inRegion: inReplyRegion(el),
                inRc: !!replyContainer?.contains(el),
                inLca: !!lca?.contains(el),
                cls: String(el.className).slice(0, 36),
              });
            }
            if (!inReplyRegion(el) || !isMediaAttachment(el)) continue;
            if (attrSrc) { pushUrl(attrSrc, name); continue; }
            if (el instanceof HTMLVideoElement) { pushUrl(el.src || el.currentSrc, name); }
            else if (el instanceof HTMLSourceElement) pushUrl(el.src, name);
            else if (el instanceof HTMLImageElement) {
              if (el.closest('[data-hatch-video-wrapper]')) continue; // poster frame — video src already collected
              if (el.naturalWidth > 0 && el.naturalWidth < 48) continue;
              pushUrl(el.currentSrc || el.src, name);
            } else {
              const a = el as HTMLAnchorElement;
              if (a.hasAttribute('download') || /\.(mp4|webm|mov|mkv|m3u8|png|jpe?g|webp|gif|mp3|wav|zip)(\?|#|$)/i.test(a.href)) {
                pushUrl(a.href, name);
              }
            }
          }
          return {
            reply: lines.join('\n'),
            failed,
            media,
            mediaDbg,
            rcFound: !!replyContainer,
            lcaCls: lca ? String((lca as HTMLElement).className).slice(0, 60) : 'none',
            bubCls: String((bubble as HTMLElement).className).slice(0, 60),
            bubTxt: norm((bubble as HTMLElement).innerText).slice(0, 50),
            idxB: allEls.indexOf(bubble as HTMLElement),
            groupsIdx: groups.slice(0, 6).map((g) => ({
              idx: allEls.indexOf(g),
              txt: norm((g as HTMLElement).innerText).slice(0, 24),
            })),
          };
        }, cleanPrompt);
        const cleanText = result.reply;
        const media = result.media;
        lastDbg = { rcFound: result.rcFound, lcaCls: result.lcaCls, bubCls: result.bubCls, bubTxt: result.bubTxt, idxB: result.idxB, groupsIdx: result.groupsIdx, mediaDbg: result.mediaDbg };

        // "Delivery not confirmed" means the realtime socket dropped the send —
        // resend the prompt a limited number of times instead of waiting out.
        if (result.failed && !cleanText) {
          failedSince ??= Date.now();
          if (Date.now() - failedSince > 4000 && resends < 2) {
            resends++;
            failedSince = null;
            console.log('[MuseDriver] Delivery not confirmed — resending prompt (attempt', resends + 1, ')');
            await sendOnce();
          }
        } else {
          failedSince = null;
        }

        if (cleanText && cleanText !== lastText) {
          const delta = cleanText.slice(streamIndex);
          if (delta && onChunk) {
            onChunk(delta);
          }
          streamIndex = cleanText.length;
          lastText = cleanText;
          lastChangeTime = Date.now();
        }
        if (media.length && JSON.stringify(media) !== JSON.stringify(lastMedia)) {
          lastMedia = media;
          lastChangeTime = Date.now();
        }

        // Reply is done when content (text or media) has been stable for 3.5s.
        // For media prompts with no media yet, keep waiting through the grace
        // window instead of returning a bare text reply.
        const stable =
          (lastText.length > 0 || lastMedia.length > 0) && Date.now() - lastChangeTime > 3500;
        if (stable) {
          if (stableSince === null) stableSince = Date.now();
          const graceOver = Date.now() - stableSince > MEDIA_GRACE_MS;
          if (lastMedia.length > 0 || !wantsMedia || graceOver) break;
          // else keep polling for late-arriving media
        } else {
          stableSince = null;
        }
      }

      console.log('[MuseDriver] Response completed. Length:', lastText.length, 'Media:', lastMedia.length);
      if (lastDbg) console.log('[MuseDriver] scope:', JSON.stringify(lastDbg));

      // blob: URLs only live inside this page — fetch them here, persist to
      // data/media/, and hand the client a real URL it can play/download.
      const mediaOut: string[] = [];
      for (const m of lastMedia) {
        if (/^https?:/i.test(m.src)) {
          mediaOut.push(m.src);
          continue;
        }
        if (signal?.aborted) break;
        try {
          const saved = await this.saveBlobMedia(page, m);
          if (saved) mediaOut.push(saved);
        } catch (e: any) {
          console.warn('[MuseDriver] media save failed:', e?.message);
        }
      }
      return { text: lastText, media: mediaOut };
    } catch (err) {
      // Slot cleanup is the caller's (chat) responsibility.
      console.error('[MuseDriver] Round error:', err);
      throw err;
    }
  }

  // Fetch a page-local blob: URL, persist it under data/media/, return the
  // public /api/media/<file> path (callers turn it absolute per-request).
  private async saveBlobMedia(page: Page, m: MediaItem): Promise<string | null> {
    const data = await page.evaluate(async (u: string) => {
      try {
        const r = await fetch(u);
        const b = await r.blob();
        if (!b.size || b.size > 64 * 1024 * 1024) return null;
        const buf = new Uint8Array(await b.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) {
          s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        return { b64: btoa(s), mime: b.type || '' };
      } catch {
        return null;
      }
    }, m.src);
    if (!data?.b64) return null;

    const byMime: Record<string, string> = {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
    };
    const ext =
      m.name?.match(/\.(mp4|webm|mov|png|jpe?g|webp|gif|mp3|wav)$/i)?.[0] ||
      byMime[data.mime] ||
      '.bin';
    const base = (m.name || 'media')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 60);
    const fname = `${base}-${Date.now().toString(36)}${ext}`;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const url = persistMediaFile(fname, Buffer.from(data.b64, 'base64'));
    console.log('[MuseDriver] saved media:', fname, `(${(data.b64.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`);
    return url;
  }

  async close(): Promise<void> {
    this.slots.clear();
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }
}

// Global singleton for Next.js hot-reloading preservation
const globalForMuse = globalThis as unknown as { museDriver: MuseDriverService };
export const museDriver = globalForMuse.museDriver || new MuseDriverService();
if (process.env.NODE_ENV !== 'production') {
  globalForMuse.museDriver = museDriver;
}

export const SUPPORTED_MODELS: OpenAIModel[] = [
  { id: 'muse-chat', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'claude-3-5-sonnet', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'deepseek-chat', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'meta-llama-3.1-405b', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
];
