import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { getBrowserExecutable, getSavedSessions, parseCookieString, formatCookiesForPuppeteer } from './museService';

class MuseDriverService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isBusy = false;
    this.lastActiveTime = Date.now();
    this.idleTimer = null;
  }

  async getActiveCookies() {
    const sessions = getSavedSessions();
    if (sessions && sessions.length > 0) {
      return sessions[0].cookies;
    }
    return '';
  }

  resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Auto-close headless browser after 15 minutes of inactivity to save RAM
    this.idleTimer = setTimeout(() => {
      this.close();
    }, 15 * 60 * 1000);
  }

  async getPage() {
    this.resetIdleTimer();
    if (this.browser && this.page && !this.page.isClosed()) {
      return this.page;
    }

    const browserInfo = getBrowserExecutable('chrome');
    if (!browserInfo) {
      throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy chủ.');
    }

    const cookieStr = await this.getActiveCookies();
    if (!cookieStr) {
      throw new Error('Chưa có cookie nào được lưu trong hệ thống.');
    }

    const map = parseCookieString(cookieStr);
    const puppeteerCookies = formatCookiesForPuppeteer(map);

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

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
    await this.page.setCookie(...puppeteerCookies);

    console.log('[MuseDriver] Loading https://muse.ai/ ...');
    await this.page.goto('https://muse.ai/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    return this.page;
  }

  async chat({ prompt, onChunk = null }) {
    // Queue if busy
    while (this.isBusy) {
      await new Promise((r) => setTimeout(r, 200));
    }

    this.isBusy = true;
    this.lastActiveTime = Date.now();

    try {
      const page = await this.getPage();
      const textarea = await page.waitForSelector('textarea', { timeout: 20000 });

      // Focus and clear textarea
      await textarea.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');

      // Type prompt
      await textarea.type(prompt, { delay: 5 });
      await page.keyboard.press('Enter');
      console.log('[MuseDriver] Sent prompt:', prompt.slice(0, 60));

      let streamIndex = 0;
      let lastText = '';
      let lastChangeTime = Date.now();
      const startTime = Date.now();

      // Poll page for assistant response
      while (Date.now() - startTime < 60000) {
        await new Promise((r) => setTimeout(r, 400));

        const bodyText = await page.evaluate(() => document.body.innerText);

        // Find the section corresponding to our prompt
        const promptIndex = bodyText.lastIndexOf(prompt);
        if (promptIndex !== -1) {
          const afterPrompt = bodyText.slice(promptIndex + prompt.length);

          // Remove transient working indicators
          const cleanText = afterPrompt
            .replace(/^[\s\S]*?(?:is working|Connected|Activity|No activity yet|Delivery not confirmed)\s*/i, '')
            .split(/\n(?:Message|Show in library|Chats|Invite|You:)\b/)[0]
            .trim();

          // Check if we have received real content
          if (cleanText && cleanText !== lastText) {
            const delta = cleanText.slice(streamIndex);
            if (delta && onChunk) {
              onChunk(delta);
            }
            streamIndex = cleanText.length;
            lastText = cleanText;
            lastChangeTime = Date.now();
          }

          // If text hasn't changed for 3 seconds and has content, it's done
          if (lastText.length > 0 && Date.now() - lastChangeTime > 3000) {
            break;
          }
        }
      }

      return lastText || 'Không nhận được phản hồi từ máy chủ Muse.';
    } catch (err) {
      console.error('[MuseDriver] Chat error:', err);
      // If error occurs, reset page so next request can recover
      if (this.page) {
        try { await this.page.close(); } catch (e) {}
        this.page = null;
      }
      throw err;
    } finally {
      this.isBusy = false;
      this.resetIdleTimer();
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
      this.page = null;
    }
  }
}

// Global singleton for Next.js hot-reloading preservation
const globalForMuse = globalThis;
export const museDriver = globalForMuse.museDriver || new MuseDriverService();
if (process.env.NODE_ENV !== 'production') {
  globalForMuse.museDriver = museDriver;
}

export const SUPPORTED_MODELS = [
  { id: 'muse-chat', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'claude-3-5-sonnet', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'deepseek-chat', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
  { id: 'meta-llama-3.1-405b', object: 'model', created: 1700000000, owned_by: 'meta-muse' },
];
