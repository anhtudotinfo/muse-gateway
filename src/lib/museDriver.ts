import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { getBrowserExecutable, getSavedSessions, parseCookieString, formatCookiesForPuppeteer } from './museService';
import { settingsService } from './settings';
import { parseCommandRequests, isCommandAllowed, runLocalCommand } from './toolBridge';
import './logBuffer';
import { MEDIA_DIR, persistMediaFile } from './mediaStore';
import { dataPath } from './dataDir';
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
  /** Muse thread to continue — id or full https://muse.ai/thread/<id> URL.
   *  The driver navigates the page to that thread before composing so a
   *  follow-up task lands in the same conversation instead of Main chat. */
  thread?: string | null;
  /** Pin the request to one saved account profile (sessions.json id).
   *  Thread continuation only works on the account that owns the thread,
   *  so the pool must not fall over to a different account. */
  pinAccount?: string | null;
  /** Idempotency key from the client (e.g. the task id). The pool uses it
   *  to coalesce retries of the SAME job — a client abort cannot cancel a
   *  prompt once it is inside Muse, so retrying without dedupe posts the
   *  prompt twice and burns a second generation. */
  idem?: string | null;
  /** Internal — set by the pool when this idem key was attempted before:
   *  the driver then checks whether the prompt is already sitting in the
   *  thread and resumes the in-flight reply instead of re-sending. */
  resume?: boolean | null;
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
  /** The Muse thread the reply landed in — page URL captured after send.
   *  Needed so follow-up tasks can return to the same conversation. */
  threadUrl?: string | null;
  /** Which saved-session account served the request (sessions.json id). */
  accountId?: string | null;
}

// Max command-execution rounds per user prompt before giving the reply back.
const MAX_CMD_ROUNDS = 5;

/** Parallel pages (tabs) per saved account. Each lane drives its own Muse
 *  thread — Muse renders server-side per conversation, so one account can
 *  have several generations in flight at once. Chrome tab ≈ 150–300MB, so
 *  the cap is modest; extra requests park in the lane queue. Live value —
 *  the dashboard setting is re-read on every acquisition so changing it
 *  applies instantly; MUSE_LANES_PER_ACCOUNT env overrides for power users. */
const laneCap = () =>
  Math.max(
    1,
    Math.min(
      6,
      Number(process.env.MUSE_LANES_PER_ACCOUNT) ||
        settingsService.get().lanesPerAccount ||
        3
    )
  );

/** One lane = one page under an account's context. */
export interface LaneView {
  /** 1-based lane number — stable handle for laneStatus/closeLane. */
  index: number;
  busy: boolean;
  /** Muse thread the lane is parked on — read from the live page URL;
   *  null when idle on home or the /thread/new composer. */
  threadId: string | null;
  threadUrl: string | null;
}

export interface LaneStatus {
  cap: number;
  lanes: LaneView[];
  busy: number;
  /** Lanes mid-creation (page load + socket warmup in progress). */
  creating: number;
  /** At least one request parked waiting for a free lane. */
  queued: boolean;
}

/** Does this reply read like a blocking clarifying question rather than a
 *  finished answer? Matched on Vietnamese + English ask-for-confirmation
 *  phrasing; callers must also check the reply carries no media (a done
 *  generation's "want edits?" follow-up would false-positive otherwise). */
function looksLikeClarification(text: string): boolean {
  if (!text || text.length > 6000) return false;
  const t = text.toLowerCase();
  const hasQuestion = t.includes('?') || /lựa chọn|phương án|bên dưới/i.test(t);
  if (!hasQuestion) return false;
  return /xác nhận|không lấy nhầm|bạn muốn|bạn cần|chọn (người|phương án|một)|hai gương mặt|khác nhau|nào\b|which (one|face|person|option)|clarif|confirm|hãy chọn|trước khi/i.test(
    t
  );
}

interface AccountSlot {
  context: BrowserContext;
  cookiesRaw: string;
  /** Normalized proxy URL this slot's browser was launched with — a proxy
   *  change on the profile must force a fresh context in the right browser. */
  proxy: string;
  /** Parallel lanes — one page per in-flight request. All pages share the
   *  incognito context's cookies, and Muse renders per thread server-side,
   *  so lane N drives its own /thread/<id> while lane M collects a reply
   *  from a different conversation. */
  pages: Page[];
  /** Lanes currently mid-creation — counted against the cap so two parked
   *  requests don't each spawn a page past LANES_PER_ACCOUNT. */
  creating: number;
  /** Last addLane failure — while fresh, requests park on existing lanes
   *  instead of hammering page loads every poll. */
  lastLaneError?: number;
}

class MuseDriverService {
  // One headless browser per egress proxy — Chrome applies --proxy-server
  // process-wide, so accounts on different proxies can't share a browser.
  // Key '' = direct connection.
  private browsers: Map<string, Browser> = new Map();
  private slots: Map<string, AccountSlot> = new Map();
  // Busy is per PAGE (lane), not per account — one account serves up to
  // laneCap() in-flight requests concurrently.
  private busyPages: Set<Page> = new Set();
  private waiting: Set<string> = new Set();
  private lastActiveTime: number = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Auto-close headless browser after 15 minutes of inactivity to save RAM.
    // Never fire while a request is in flight — a long (10-min) generation
    // must not have its browser killed mid-wait; re-arm instead.
    this.idleTimer = setTimeout(() => {
      if (this.busyPages.size > 0) { this.resetIdleTimer(); return; }
      this.close();
    }, 15 * 60 * 1000);
  }

  /** Strip credentials from a proxy URL — Chrome's --proxy-server takes
   *  host:port only; auth goes through page.authenticate. */
  private proxyKey(session: Profile): string {
    const raw = (session.proxy || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    } catch {
      return raw;
    }
  }

  private async ensureBrowser(proxyKey: string): Promise<Browser> {
    const existing = this.browsers.get(proxyKey);
    if (existing?.connected) return existing;

    const browserInfo = getBrowserExecutable('chrome');
    if (!browserInfo) {
      throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy chủ.');
    }

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ];
    if (proxyKey) args.push(`--proxy-server=${proxyKey}`);

    const browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: true,
      args,
    });
    this.browsers.set(proxyKey, browser);
    return browser;
  }

  // One incognito context per account — cookies are isolated, so every saved
  // profile becomes an independent Muse session inside its proxy's browser.
  // The context hosts up to LANES_PER_ACCOUNT pages (lanes); all lanes share
  // the context's cookie jar but drive their own Muse thread.
  private async getSlotForSession(session: Profile): Promise<AccountSlot> {
    this.resetIdleTimer();
    const proxy = this.proxyKey(session);
    const existing = this.slots.get(session.id);
    if (
      existing &&
      existing.cookiesRaw === session.cookies &&
      existing.proxy === proxy &&
      existing.context.browser().connected
    ) {
      return existing;
    }

    if (existing) {
      try { await existing.context.close(); } catch {}
      this.slots.delete(session.id);
    }

    const browser = await this.ensureBrowser(proxy);
    const context = await browser.createBrowserContext();
    const slot: AccountSlot = {
      context,
      cookiesRaw: session.cookies,
      proxy,
      pages: [],
      creating: 0,
    };
    this.slots.set(session.id, slot);
    await this.addLane(slot, session);
    return slot;
  }

  /** Open one more lane (page) inside the slot's context — cookies are
   *  context-level so the new page is already logged in; it just needs the
   *  app load + realtime-socket warmup before it can post prompts. */
  private async addLane(slot: AccountSlot, session: Profile): Promise<Page> {
    const page = await slot.context.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Authenticated proxy — credentials live in the URL, Chrome prompts per
    // page; answer them once at page level.
    try {
      const u = session.proxy ? new URL(session.proxy) : null;
      if (u?.username) {
        await page.authenticate({
          username: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password || ''),
        });
      }
    } catch {}

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

    slot.pages.push(page);
    return page;
  }

  /** Acquire a lane for this session — reuse an idle page, else spawn one
   *  up to LANES_PER_ACCOUNT, else wait until a lane frees. */
  private async acquireLane(session: Profile, signal: AbortSignal | null): Promise<Page> {
    let announced = false;
    for (;;) {
      if (signal?.aborted) throw new Error('Request aborted by client.');
      const slot = await this.getSlotForSession(session);
      // Prune lanes Chrome already closed (crash, context teardown) so they
      // don't count against laneCap().
      slot.pages = slot.pages.filter((p) => !p.isClosed());
      const free = slot.pages.find((p) => !this.busyPages.has(p));
      if (free) return free;
      if (
        slot.pages.length + slot.creating < laneCap() &&
        (!slot.lastLaneError || Date.now() - slot.lastLaneError > 30000)
      ) {
        slot.creating++;
        try {
          return await this.addLane(slot, session);
        } catch (err) {
          slot.lastLaneError = Date.now();
          if (!slot.pages.length) {
            // No surviving lanes — the context itself is probably dead.
            // Drop the slot so the next request rebuilds it from scratch
            // instead of failing forever on a cached corpse.
            try { await slot.context.close(); } catch {}
            this.slots.delete(session.id);
            throw err;
          }
          // Busy lanes still exist — park on them instead of retrying the
          // spawn every poll cycle.
        } finally {
          slot.creating--;
        }
      }
      if (!announced) {
        console.log(`[MuseDriver] queued — "${session.name}" hết lane rảnh, request xếp hàng chờ`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
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

  async chat({ prompt, onChunk = null, signal = null, cwd = null, sessionId = null, images, newChat = null, thread = null, resume = null }: ChatOptions): Promise<ChatResult> {
    const session = this.resolveSession(sessionId);

    // Lanes are per account — requests beyond LANES_PER_ACCOUNT park here
    // and are reported as "queued" in pool state. Different accounts run
    // fully in parallel; same-account lanes share cookies but drive their
    // own Muse threads.
    this.waiting.add(session.id);
    const page = await this.acquireLane(session, signal).finally(() =>
      this.waiting.delete(session.id)
    );

    this.busyPages.add(page);
    this.lastActiveTime = Date.now();

    try {
      // Thread continuation wins over newChat — a task that must land in an
      // existing conversation is navigated there explicitly; newChat only
      // applies when there is no thread to return to.
      if (thread) await this.openThread(page, thread);
      else if (newChat) await this.openNewChat(page);
      const textarea = await page.waitForSelector('textarea', { timeout: 20000 });
      if (!textarea) throw new Error('Không tìm thấy khung chat trên Muse.');

      let toSend = prompt.trim();
      if (!toSend) throw new Error('Prompt rỗng.');

      // Agent loop: send → read reply → if Muse asks us to run local commands,
      // execute them here and paste [COMMAND OUTPUT] back into the thread.
      let lastReply = '';
      let lastMedia: string[] = [];
      const makeResult = (): ChatResult => ({
        text: lastReply || 'Đã gửi yêu cầu đến Muse thành công.',
        media: lastMedia,
        // The URL Muse is on after the reply — /thread/new redirects to the
        // real /thread/<id> once the first message posts, so this is the
        // reliable way to learn which conversation a task landed in.
        threadUrl: /\/thread\/[^/?#]+/.test(page.url()) ? page.url() : null,
        accountId: session.id,
      });
      let clarified = false;
      for (let round = 0; round <= MAX_CMD_ROUNDS; round++) {
        // Buffer this round's stream deltas; only flush to the caller when the
        // round turns out to be the final answer (no command request inside).
        let buffered = '';
        // Only the first round carries attachments — later rounds are
        // follow-up prompts and must not re-send the bridge frame.
        const result = await this.sendAndAwaitReply(page, toSend, signal, (d) => {
          buffered += d;
        }, round === 0 ? images : undefined, !!(resume && round === 0));

        if (result.text) lastReply = result.text;
        if (result.media.length) lastMedia = result.media;
        const cmds = parseCommandRequests(result.text).filter(isCommandAllowed);
        if (!cmds.length || round === MAX_CMD_ROUNDS) {
          // Clarification stall — Muse sometimes stops to ask "which of these
          // faces / confirm the choice" with option buttons instead of
          // generating, and the task then waits for media that never comes.
          // Only when the reply is media-LESS (a finished generation with a
          // "want edits?" follow-up carries media and must not trigger this)
          // and reads like a blocking question do we answer once: pick the
          // most reasonable option per the refs' described roles, don't ask
          // again, generate now. A second clarification falls through to
          // return so the task surfaces Muse's actual question as the error.
          if (
            !clarified &&
            !result.media.length &&
            looksLikeClarification(result.text)
          ) {
            clarified = true;
            console.log('[MuseDriver] clarification detected — auto-answering');
            toSend =
              'Không cần xác nhận thêm — tự chọn phương án hợp lý nhất theo đúng vai trò từng file đính kèm trong yêu cầu ban đầu (khung hình = bối cảnh/tư thế, ảnh chân dung = nhân vật chính phải giống hệt, ảnh trang phục = chỉ lấy đồ). Không hỏi lại — TẠO NGAY media.';
            continue;
          }
          if (buffered && onChunk) onChunk(buffered);
          return makeResult();
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
      return makeResult();
    } catch (err) {
      console.error('[MuseDriver] Chat error:', err);
      await this.dropLane(session.id, page);
      throw err;
    } finally {
      this.busyPages.delete(page);
      this.resetIdleTimer();
    }
  }

  private slotPages(sessionId: string): Page[] {
    return this.slots.get(sessionId)?.pages ?? [];
  }

  /** Live lane snapshot for the dashboard — which pages the account holds,
   *  which are in flight, and which Muse thread each is parked on (read
   *  off the page URL). */
  laneStatus(sessionId: string): LaneStatus {
    const slot = this.slots.get(sessionId);
    const lanes: LaneView[] = [];
    for (const [i, p] of (slot?.pages ?? []).entries()) {
      if (p.isClosed()) continue;
      const url = p.url() || '';
      const m = url.match(/\/thread\/([^/?#]+)/);
      lanes.push({
        index: i + 1,
        busy: this.busyPages.has(p),
        threadId: m && m[1] !== 'new' ? m[1] : null,
        threadUrl: m && m[1] !== 'new' ? url : null,
      });
    }
    return {
      cap: laneCap(),
      lanes,
      busy: lanes.filter((l) => l.busy).length,
      creating: slot?.creating ?? 0,
      queued: this.waiting.has(sessionId),
    };
  }

  /** Close lane #index (1-based, matching laneStatus). Busy lanes are
   *  refused — killing a page mid-collection would lose the reply, so it
   *  must finish or time out first. Returns an error string on refusal. */
  async closeLane(sessionId: string, index: number): Promise<string | null> {
    const slot = this.slots.get(sessionId);
    const p = slot?.pages?.[index - 1];
    if (!p || p.isClosed()) return `Lane ${index} không tồn tại.`;
    if (this.busyPages.has(p)) {
      return `Lane ${index} đang chạy — không đóng giữa chừng.`;
    }
    await this.dropLane(sessionId, p);
    return null;
  }

  isBusy(sessionId: string): boolean {
    return this.slotPages(sessionId).some((p) => this.busyPages.has(p));
  }

  isQueued(sessionId: string): boolean {
    return this.waiting.has(sessionId);
  }

  /** Warm up a session's page (loads Muse if needed, touches the realtime
   *  socket) so the cookie stays fresh and the account answers instantly.
   *  Skips accounts currently processing a request. */
  async keepAlive(sessionId: string): Promise<'ok' | 'busy' | 'error'> {
    try {
      // Skip accounts busy or about to be (a request is parked on them).
      if (this.isBusy(sessionId) || this.waiting.has(sessionId)) return 'busy';
      const session = this.resolveSession(sessionId);
      const slot = await this.getSlotForSession(session);
      const page = slot.pages.find((p) => !p.isClosed());
      if (!page) return 'error';
      // Touch the page — realtime socket pings keep the session warm.
      await page.evaluate(() => document.title).catch(() => {});
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Navigate the page to an existing Muse thread (continuation). Accepts
   *  a thread id or full URL. Threads live under the account that created
   *  them — if Muse redirects away (home/Main chat) the thread does not
   *  belong to this account, and sending anyway would silently dump the
   *  prompt into Main chat, so that's a hard failure. */
  private async openThread(page: Page, thread: string): Promise<void> {
    const m = thread.match(/\/thread\/([^/?#]+)/) || thread.match(/^([A-Za-z0-9_-]{6,})$/);
    if (!m) throw new Error(`Thread không hợp lệ: "${thread}"`);
    const id = m[1];
    const url = `https://muse.ai/thread/${id}`;
    if (!page.url().includes(`/thread/${id}`)) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('textarea', { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 800));
      if (!page.url().includes(`/thread/${id}`)) {
        throw new Error(
          `Thread ${id} không mở được — Muse đã redirect (về ${page.url()}). Thread chỉ tồn tại trên đúng tài khoản đã tạo nó.`
        );
      }
      console.log(`[MuseDriver] continued thread ${id}`);
    }
  }

  /** Open a fresh chat thread on the account's page. Heuristic — muse.ai
   *  has no stable "new chat" selector, so try (1) a control labelled
   *  "New chat"/"Chat mới", (2) a "+" affordance sitting next to the
   *  chats/sidebar section header, (3) reload the app root. Best-effort:
   *  worst case we stay on the current thread rather than failing. */
  private async openNewChat(page: Page): Promise<void> {
    // Muse's "+" button navigates to /thread/new — direct navigation beats
    // DOM scraping entirely (sidebar/popover state differs across layouts,
    // viewports and accounts; the URL does not).
    if (!page.url().startsWith('https://muse.ai/thread/new')) {
      try {
        await page.goto('https://muse.ai/thread/new', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForSelector('textarea', { timeout: 15000 });
        // Let the composer settle — same settle as a manual "+" click.
        await new Promise((r) => setTimeout(r, 800));
        console.log('[MuseDriver] new chat opened via /thread/new');
        return;
      } catch (e) {
        console.log(
          '[MuseDriver] /thread/new navigation failed — falling back to UI click:',
          e
        );
      }
    } else {
      // Already on a fresh, empty composer — nothing to isolate.
      return;
    }

    // Snapshot "where we are" — a real switch must change at least one of
    // these signals (active row title / row count / url / empty composer).
    const prev = await page
      .evaluate(() => {
        const cur = document.querySelector<HTMLElement>('[aria-current="page"]');
        return {
          title: cur ? (cur.textContent || '').trim() : '',
          rows: document.querySelectorAll(
            '[data-testid="hatch-thread-row"]'
          ).length,
          bubbles: document.querySelectorAll('[class*="group/msg"]').length,
          url: location.href,
        };
      })
      .catch(() => ({ title: '', rows: 0, bubbles: 0, url: '' }));

    // Right after page load the sidebar mounts late — a click fired before
    // React hydration is silently swallowed. Wait for the button first.
    // In the headless layout the chats list lives behind the "Chats"
    // switcher popover (hatch-chat-switcher-trigger) — open it so the "+"
    // (hatch-chat-compose) mounts, then fall back to any rail toggle.
    await page
      .waitForSelector('[data-testid="hatch-chat-compose"]', { timeout: 6000 })
      .catch(async () => {
        await page
          .click('[data-testid="hatch-chat-switcher-trigger"]')
          .catch(() =>
            page.evaluate(() => {
              const el = document.querySelector<HTMLElement>(
                '[data-testid="hatch-chat-switcher-trigger"]'
              );
              el?.click();
            })
          )
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        await page
          .waitForSelector('[data-testid="hatch-chat-compose"]', {
            timeout: 4000,
          })
          .catch(async () => {
            await page
              .evaluate(() => {
                const btns = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    'nav button, aside button, [class*="sidebar"] button, [class*="rail"] button, header button'
                  )
                );
                const toggle = btns.find((el) =>
                  /chat|thread|sidebar|message|conversation|trò\s*chuyện|đoạn/i.test(
                    (el.getAttribute('aria-label') || '') +
                      ' ' +
                      (el.title || '') +
                      ' ' +
                      (el.getAttribute('data-testid') || '')
                  )
                );
                toggle?.click();
              })
              .catch(() => {});
            await new Promise((r) => setTimeout(r, 700));
          });
      });

    // Mark the found control, then click it with a real CDP mouse event —
    // trusted input survives a half-hydrated React tree where a bare
    // el.click() can be swallowed.
    const tryClick = async (): Promise<string | null> => {
      const strategy = await page.evaluate(() => {
        const mark = (el: HTMLElement) => {
          el.setAttribute('data-muse-nc', '1');
        };
        // 0) Stable test hook — Muse renders the "+" as hatch-chat-compose.
        const hook = document.querySelector<HTMLElement>(
          '[data-testid="hatch-chat-compose"]'
        );
        if (hook) {
          mark(hook);
          return 'compose-testid';
        }
        const clickables = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, a, [role="button"], [role="link"], li > *'
          )
        );
        // 1) Explicit "New (side) chat" label — words may not be adjacent.
        const labelled = clickables.find((el) =>
          /\bnew\b[^.]{0,24}\bchat\b|chat\s*mới|cuộc\s*trò\s*chuyện\s*mới|tạo\s*chat|tạo\s*đoạn\s*chat/i.test(
            (el.getAttribute('aria-label') || '') +
              ' ' +
              (el.title || '') +
              ' ' +
              (el.textContent || '')
          )
        );
        if (labelled) {
          mark(labelled);
          return 'label';
        }
        // 2) "+" affordance near the chats section header — may be an
        //    icon-only button or a sibling a few levels up.
        const headers = Array.from(
          document.querySelectorAll<HTMLElement>('aside *, nav *, [class*="sidebar"] *')
        );
        const chatHeader = headers.find((el) =>
          /side\s*chats|chats|lịch\s*sử|history|đoạn\s*chat/i.test(
            (el.textContent || '').trim()
          ) && (el.textContent || '').trim().length < 40
        );
        if (chatHeader) {
          let scope: HTMLElement | null = chatHeader;
          for (let depth = 0; depth < 4 && scope; depth++) {
            scope = scope.parentElement;
            if (!scope) break;
            const buttons = Array.from(
              scope.querySelectorAll<HTMLElement>(
                'button, a, [role="button"], [class*="cursor-pointer"]'
              )
            ).filter(
              (el) =>
                (chatHeader.compareDocumentPosition(el) &
                  Node.DOCUMENT_POSITION_FOLLOWING) !== 0
            );
            const plus = buttons.find((el) => {
              const text = (el.textContent || '').trim();
              const label = el.getAttribute('aria-label') || '';
              const qualifies =
                text === '+' ||
                /add|new|plus|create|tạo|mới/i.test(label) ||
                (!text && el.querySelector('svg'));
              // Never click outside the sidebar — message-area icon buttons
              // ("More options", "React", media openers) match otherwise.
              return (
                qualifies &&
                !!el.closest('nav, aside, [class*="sidebar"]')
              );
            });
            if (plus) {
              mark(plus);
              return 'sidebar-plus';
            }
          }
        }
        return null;
      });
      if (!strategy) return null;
      // Log the marked control so silent no-op clicks are diagnosable —
      // an icon-only fallback could mark the wrong button.
      const marked = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-muse-nc="1"]');
        if (!el) return 'none';
        return `${el.tagName.toLowerCase()} label="${el.getAttribute('aria-label')}" title="${el.title}" testid="${el.getAttribute('data-testid')}" text="${(el.textContent || '').trim().slice(0, 20)}"`;
      });
      console.log(`[MuseDriver] new-chat target (${strategy}): ${marked}`);
      await page
        .click('[data-muse-nc="1"]')
        .catch(() =>
          page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('[data-muse-nc="1"]');
            el?.click();
          })
        )
        .finally(() =>
          page
            .evaluate(() =>
              document
                .querySelector('[data-muse-nc="1"]')
                ?.removeAttribute('data-muse-nc')
            )
            .catch(() => {})
        );
      return strategy;
    };

    // Empty composer = clean context regardless of which thread it is —
    // a fresh side chat shows no new row/url until the first message is
    // sent, so the ONLY reliable success signal for an already-empty start
    // is "still empty". With bubbles present, require a real change.
    const switched = async (): Promise<boolean> =>
      page
        .waitForFunction(
          (p: { title: string; rows: number; bubbles: number; url: string }) => {
            const cur = document.querySelector('[aria-current="page"]');
            const t = cur ? (cur.textContent || '').trim() : '';
            const rows = document.querySelectorAll(
              '[data-testid="hatch-thread-row"]'
            ).length;
            const bubbles = document.querySelectorAll('[class*="group/msg"]').length;
            return (
              bubbles === 0 ||
              t !== p.title ||
              rows > p.rows ||
              location.href !== p.url
            );
          },
          { timeout: 5000 },
          prev
        )
        .then(() => true)
        .catch(() => false);

    let strategy: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      strategy = await tryClick();
      if (!strategy) break;
      if (await switched()) break;
      const after = await page
        .evaluate(() => {
          const cur = document.querySelector('[aria-current="page"]');
          return {
            title: cur ? (cur.textContent || '').trim().slice(0, 30) : '',
            rows: document.querySelectorAll('[data-testid="hatch-thread-row"]').length,
            bubbles: document.querySelectorAll('[class*="group/msg"]').length,
            url: location.href,
          };
        })
        .catch(() => null);
      console.log(
        `[MuseDriver] new-chat click #${attempt} (${strategy}) did not switch thread — retrying. prev=${JSON.stringify(prev)} after=${JSON.stringify(after)}`
      );
      strategy = null;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!strategy) {
      await this.dumpNewChatDebug(page);
      throw new Error(
        'new_chat được yêu cầu nhưng không mở được side chat mới trong Muse (nút + không phản hồi) — hủy để tránh gửi nhầm vào thread cũ'
      );
    }
    await page.waitForSelector('textarea', { timeout: 15000 });
    // Let the new thread mount before we paste into it.
    await new Promise((r) => setTimeout(r, 600));
    console.log(`[MuseDriver] new chat opened via ${strategy}`);
  }

  /** On new-chat failure, capture what the automation page actually looks
   *  like — headless sessions render a different DOM than a normal browser
   *  (sidebar collapsed, popovers closed), so guessing selectors never ends.
   *  A screenshot + the sidebar/popover HTML goes to data/debug/ so the next
   *  breakage self-diagnoses on any machine. */
  private async dumpNewChatDebug(page: Page): Promise<void> {
    try {
      const dir = dataPath('debug');
      fs.mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      await page.screenshot({ path: path.join(dir, `newchat-${ts}.png`) });
      const dom = await page.evaluate(() => {
        const pick = document.querySelector(
          'nav, aside, [class*="sidebar"], [class*="rail"], [role="dialog"], [data-testid*="chat"]'
        );
        const header = document.querySelector('header, [class*="header"]');
        const dump =
          '=== PICKED ===\n' +
          (pick ? pick.outerHTML : '(none)') +
          '\n\n=== HEADER ===\n' +
          (header ? header.outerHTML : '(none)') +
          '\n\n=== ALL aria/testid BUTTONS ===\n' +
          Array.from(
            document.querySelectorAll<HTMLElement>(
              'button[aria-label], [role="button"][aria-label], [data-testid]'
            )
          )
            .map(
              (el) =>
                `<${el.tagName.toLowerCase()} testid="${el.getAttribute('data-testid')}" label="${el.getAttribute('aria-label')}" title="${el.title}">${(el.textContent || '').trim().slice(0, 30)}`
            )
            .slice(0, 60)
            .join('\n');
        return dump;
      });
      fs.writeFileSync(path.join(dir, `newchat-${ts}.html`), dom);
      console.log(`[MuseDriver] new-chat debug → data/debug/newchat-${ts}.{png,html}`);
    } catch (e) {
      console.log('[MuseDriver] debug dump failed:', e);
    }
  }

  /** Close a single broken lane. Only the failing page dies — sibling lanes
   *  keep their in-flight replies; the context stays as long as it hosts
   *  other pages. The slot is recreated lazily on the next request. */
  private async dropLane(sessionId: string, page: Page): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    const idx = slot.pages.indexOf(page);
    if (idx >= 0) slot.pages.splice(idx, 1);
    try { await page.close(); } catch {}
    if (!slot.pages.length) {
      try { await slot.context.close(); } catch {}
      this.slots.delete(sessionId);
    }
  }

  private async sendAndAwaitReply(
    page: Page,
    cleanPrompt: string,
    signal: AbortSignal | null,
    onChunk: ((delta: string) => void) | null,
    images?: string[],
    resume = false
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
          // persistMediaFile creates this lazily — the attach path writes
          // frame-* temps straight into it, so it must exist first too.
          fs.mkdirSync(MEDIA_DIR, { recursive: true });
          const extFor = (mime: string): string => {
            if (mime.includes('png')) return 'png';
            if (mime.includes('webp')) return 'webp';
            if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
            if (mime.includes('gif')) return 'gif';
            if (mime.includes('quicktime')) return 'mov';
            if (mime.includes('webm')) return 'webm';
            if (mime.includes('mp4') || mime.includes('video')) return 'mp4';
            if (mime.includes('mpeg')) return 'mp3';
            if (mime.includes('wav')) return 'wav';
            if (mime.includes('ogg')) return 'ogg';
            if (mime.includes('m4a') || mime.includes('mp4a') || mime.includes('aac')) return 'm4a';
            if (mime.includes('audio')) return 'mp3';
            return 'bin';
          };
          for (const [i, u] of images.entries()) {
            const m = u.match(/^data:([^;]+);base64,(.+)$/s);
            if (!m) continue;
            const ext = extFor(m[1]);
            const p = path.join(MEDIA_DIR, `frame-${Date.now()}-${i}.${ext}`);
            fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
            tmpFiles.push(p);
          }
          // Composer-local pending attachment? A blob: preview img / hatch
          // marker inside the composer's ancestor means a resend already
          // attached — don't stack duplicates. MUST exclude elements inside
          // posted message bubbles (group/msg): Muse keeps blob: previews on
          // already-sent attachments, and the widened scope can reach them —
          // matching one fakes "already attached" and sends a TEXT-ONLY
          // duplicate prompt (the exact bug seen in the wild).
          const pendingProbe = `(() => {
            const ta = document.querySelector('textarea');
            let scope = ta;
            for (let i = 0; i < 6 && scope && scope.parentElement; i++) scope = scope.parentElement;
            if (!scope) return false;
            const cands = scope.querySelectorAll('img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"], [data-hatch-image-src], [data-hatch-video-src], [data-hatch-audio-src]');
            for (const el of Array.from(cands)) {
              if (!el.closest('[class*="group/msg"]')) return true;
            }
            return false;
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
            // Honour the composer's accept list — feeding it a file type it
            // doesn't take (e.g. mp4 on an image-only input) either breaks
            // the upload state or silently drops the reference. Drop
            // unsupported files here instead; the prompt still describes
            // whatever did attach.
            const accept = (inputInfo[0]?.accept || '').toLowerCase();
            const allows = (f: string): boolean => {
              if (!accept) return true;
              const ext = '.' + f.split('.').pop()!.toLowerCase();
              return accept.split(',').some((tok) => {
                const t = tok.trim();
                if (!t) return false;
                if (t === ext) return true;
                if (t === '*/*' || t === '*') return true;
                if (t.endsWith('/*')) {
                  const grp = t.slice(0, -2);
                  const imgExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
                  const vidExt = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
                  const audExt = ['.mp3', '.m4a', '.wav', '.ogg', '.aac', '.flac'];
                  if (grp === 'image') return imgExt.includes(ext);
                  if (grp === 'video') return vidExt.includes(ext);
                  if (grp === 'audio') return audExt.includes(ext);
                }
                return false;
              });
            };
            const rejected = tmpFiles.filter((f) => !allows(f));
            const send = tmpFiles.filter(allows);
            if (rejected.length) {
              console.log(`[MuseDriver] ${rejected.length} file(s) bị accept="${accept}" loại:`, rejected.map((f) => f.split(/[\\/]/).pop()));
            }
            const input = await page.$('input[type="file"]');
            if (input && send.length) {
              try {
                await input.uploadFile(...send);
                how = 'upload';
              } catch (e) {
                how = 'err:' + String(e);
              }
            } else if (!send.length) {
              how = 'reject-all';
            } else {
              how = 'no-input';
            }
          }
          console.log('[MuseDriver] attach', images.length, 'image(s) via', how);
          // The prompt talks about "ảnh đính kèm" — sending it WITHOUT the
          // images attached makes Muse answer with text ("mình vẫn chưa…"),
          // which surfaces as the confusing "không chứa link media" failure.
          // Fail fast instead so the queue retries with a clear cause.
          if (!already && images.length && !tmpFiles.length) {
            throw new Error('No reference images could be decoded (all refs dropped before attach).');
          }
          if (how === 'err' || how.startsWith('err:') || how === 'no-input' || how === 'reject-all') {
            throw new Error(`Không attach được ảnh tham chiếu vào composer (${how}).`);
          }
          // Wait for the composer's attachment chip/preview to render and
          // the upload to settle — sending early → "Delivery not confirmed".
          if (how === 'upload' || how === 'skip-pending') {
            let attached = false;
            for (let t = 0; t < 25; t++) {
              await new Promise((r) => setTimeout(r, 400));
              if (await page.evaluate(pendingProbe)) { attached = true; break; }
            }
            if (!attached && !already) {
              throw new Error('Ảnh tham chiếu upload xong nhưng chip preview không xuất hiện sau 10s.');
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
      // Resume probe: a client abort can't retract a prompt once it is
      // inside Muse — retrying then re-sends the whole thing and burns a
      // second generation (the duplicate-bubble bug). When the pool marks
      // this as a retried idem key, check whether the newest user bubble
      // already carries this exact prompt; if so we skip the send and just
      // wait for the reply the first submission is/was generating.
      const alreadyPosted = resume
        ? await page
            .evaluate((rawPrompt: string) => {
              const norm = (s: string | null | undefined) =>
                (s || '').replace(/\s+/g, ' ').trim();
              const target = norm(rawPrompt);
              const snip = norm(rawPrompt.slice(0, 40));
              const tail = norm(rawPrompt.slice(-40));
              const groups = Array.from(
                document.querySelectorAll('[class*="group/msg"]')
              ).filter((el) => !(el as HTMLElement).querySelector('textarea'));
              for (let i = groups.length - 1; i >= 0; i--) {
                const t = norm((groups[i] as HTMLElement).innerText);
                if (t === target || t.includes(snip) || t.includes(tail)) return true;
              }
              return false;
            }, cleanPrompt)
            .catch(() => false)
        : false;

      // Snapshot every media URL already on the page (avatar, older replies)
      // — anything still there was rendered before our prompt and can never
      // belong to this reply. When resuming, media rendered so far MAY be
      // the interrupted reply's attachments — leave the set empty instead.
      await page.evaluate((resuming: boolean) => {
        (window as any).__musePreMedia = resuming
          ? new Set()
          : new Set(
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
      }, alreadyPosted);
      if (alreadyPosted) {
        console.log('[MuseDriver] prompt already posted — resuming interrupted generation (no duplicate send)');
      } else {
        await sendOnce();
      }

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
      // Media renders can run for many minutes (10-min videos) — env-tunable
      // for the rare case Muse needs even longer.
      const mediaTimeoutMs = Math.max(60000, Number(process.env.MUSE_MEDIA_TIMEOUT_MS) || 900000);
      const TIMEOUT_MS = wantsMedia ? mediaTimeoutMs : 90000;
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
            // Bubble not rendered yet (heavy attachments post slowly) — the
            // caller reads result.media.length, so EVERY field it touches
            // must exist or this early return 500s the whole request.
            if (cands.length === 0)
              return { reply: '', failed: false, media: [], mediaDbg: [], rcFound: false };

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
          let busy = false;
          for (const chunk of chunks) {
            if (stop) break;
            for (const rawLine of String(chunk).split('\n')) {
              const t = norm(rawLine);
              if (!t) continue;
              const low = t.toLowerCase();
              if (STOP_WORDS.has(low)) { stop = true; break; }
              // Generation still in progress — status lines ("Rendering…",
              // activity labels) are filtered from the reply but mark the
              // wait busy so settled text can't end a long render early.
              if (TRANSIENT.test(low) || ACTIVITY.test(low) || GERUND_LINE.test(low)) {
                busy = true;
                continue;
              }
              if (
                SKIP_WORDS.has(low) ||
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
            // A <video> with no duration is still rendering/loading.
            if (el instanceof HTMLVideoElement && !(el.duration > 0)) busy = true;
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
          // Spinners / progress bars inside the reply region also mean the
          // generation is still running even when no status text matched.
          const progEl = document.querySelector(
            '[role="progressbar"], [aria-busy="true"], .animate-spin, .animate-pulse'
          );
          if (progEl && inReplyRegion(progEl)) busy = true;
          return {
            reply: lines.join('\n'),
            failed,
            busy,
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
        }, cleanPrompt).catch(() => null); // context destroyed mid-nav → skip tick
        if (!result) continue;
        const cleanText = result.reply ?? '';
        const media = result.media ?? [];
        lastDbg = { rcFound: result.rcFound, busy: result.busy, lcaCls: result.lcaCls, bubCls: result.bubCls, bubTxt: result.bubTxt, idxB: result.idxB, groupsIdx: result.groupsIdx, mediaDbg: result.mediaDbg };

        // "Delivery not confirmed" means the realtime socket dropped the send —
        // resend the prompt a limited number of times instead of waiting out.
        // THREE guards, all learned from real duplicates:
        //  - !result.rcFound: a reply container means the original send DID
        //    land and Muse is already answering — resending is a duplicate.
        //  - 12s grace: multi-MB attachment uploads take a while to confirm,
        //    4s was firing during normal in-flight uploads.
        //  - pending chips: chips still in the composer = the ORIGINAL send
        //    is still uploading — a resend now would skip re-attaching (the
        //    probe sees those chips) and land a text-only twin.
        if (result.failed && !cleanText && !result.rcFound) {
          failedSince ??= Date.now();
          if (Date.now() - failedSince > 12000 && resends < 2) {
            const stillUploading = await page
              .evaluate(() => {
                const ta = document.querySelector('textarea');
                let scope: HTMLElement | null = ta;
                for (let i = 0; i < 6 && scope && scope.parentElement; i++)
                  scope = scope.parentElement;
                if (!scope) return false;
                const cands = scope.querySelectorAll(
                  'img[src^="blob:"], video[src^="blob:"], audio[src^="blob:"], [data-hatch-image-src], [data-hatch-video-src], [data-hatch-audio-src]'
                );
                // Only composer chips count — blob: previews inside posted
                // bubbles (group/msg) are the LAST send's attachments, not
                // an in-flight upload.
                for (const el of Array.from(cands)) {
                  if (!el.closest('[class*="group/msg"]')) return true;
                }
                return false;
              })
              .catch(() => false);
            if (stillUploading) {
              failedSince = null;
              console.log('[MuseDriver] delivery pending with attachments — waiting, not resending');
            } else {
              resends++;
              failedSince = null;
              console.log('[MuseDriver] Delivery not confirmed — resending prompt (attempt', resends + 1, ')');
              await sendOnce();
            }
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
        // Settled-looking text while the render is still running (status
        // lines, video with no duration, a progress indicator) is NOT done —
        // a 10-minute video must keep the wait alive until Muse finishes.
        const stable =
          !result.busy &&
          (lastText.length > 0 || lastMedia.length > 0) &&
          Date.now() - lastChangeTime > 3500;
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
        if (!b.size || b.size > 512 * 1024 * 1024) return null;
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
    const fname = `${base}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}${ext}`;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const url = persistMediaFile(fname, Buffer.from(data.b64, 'base64'));
    console.log('[MuseDriver] saved media:', fname, `(${(data.b64.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`);
    return url;
  }

  async close(): Promise<void> {
    this.slots.clear();
    const browsers = [...this.browsers.values()];
    this.browsers.clear();
    await Promise.all(browsers.map(async (b) => {
      try { await b.close(); } catch {}
    }));
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
