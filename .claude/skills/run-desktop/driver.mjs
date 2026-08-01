// REPL driver for the Dexter desktop app (Electron, macOS).
//
// Interactive:  node .claude/skills/run-desktop/driver.mjs
// Scripted:     printf 'launch\nss landing\nquit\n' | node .claude/skills/run-desktop/driver.mjs
//
// Launches with an isolated --user-data-dir by default so the real install's
// chat history and encrypted API keys are never touched. Set DEXTER_REAL_PROFILE=1
// to attach to the actual profile (needed only when a run must use stored keys).
import { createRequire } from 'node:module';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const APP_DIR = path.join(REPO_ROOT, 'desktop');
// playwright-core is a root dependency; desktop/ does not carry its own copy.
const require = createRequire(path.join(REPO_ROOT, 'package.json'));
const { _electron: electron } = require('playwright-core');

const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/dexter-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_BIN = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

let app = null;
let page = null;
let userDataDir = null;

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    if (!fs.existsSync(ELECTRON_BIN)) {
      return console.log(`ERROR: no Electron binary at ${ELECTRON_BIN}\n  → cd desktop && node node_modules/electron/install.js`);
    }
    if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js'))) {
      return console.log('ERROR: app not built (desktop/out missing)\n  → cd desktop && npm run build');
    }

    const args = ['--no-sandbox'];
    if (process.env.DEXTER_REAL_PROFILE !== '1') {
      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-driver-'));
      args.push(`--user-data-dir=${userDataDir}`);
    }
    args.push(APP_DIR);

    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args,
      // The sidecar resolves the Bun core relative to this.
      env: { ...process.env, DEXTER_CORE_ROOT: REPO_ROOT },
      timeout: 60_000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // The renderer boots async (settings + secrets over IPC); .chat is the first
    // real UI to mount. A blank screenshot means this wait was skipped.
    await page.waitForSelector('.chat', { timeout: 30_000 }).catch(() => console.log('WARN: .chat never appeared'));
    console.log(`launched${userDataDir ? ` (isolated profile: ${userDataDir})` : ' (REAL profile)'}`);
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  /** Click via DOM, not coordinates — reliable regardless of layering. */
  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log('click', sel, '→', await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel));
  },

  /** Click the first button/nav item whose text matches. Covers the sidebar tabs. */
  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    console.log('click-text', JSON.stringify(text), '→', await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"], [class*="head"], .hist-row, .hist-row-del')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return `OK: ${el.tagName}.${el.className}`;
    }, text));
  },

  /**
   * Set a React-controlled input. Assigning .value directly does nothing — React
   * tracks the previous value on the node, so the native setter plus a bubbling
   * `input` event is what makes onChange fire.
   *
   * Usage: set-input <css-sel> <text...>
   *        set-input "<css-sel with spaces>" <text...>
   */
  async 'set-input'(rest) {
    if (!page) return console.log('ERROR: launch first');
    const quoted = /^(['"])(.*?)\1\s*/.exec(rest);
    let sel, value;
    if (quoted) {
      sel = quoted[2];
      value = rest.slice(quoted[0].length);
    } else {
      const i = rest.indexOf(' ');
      [sel, value] = i < 0 ? [rest, ''] : [rest.slice(0, i), rest.slice(i + 1)];
    }
    console.log('set-input', JSON.stringify(sel), '→', await page.evaluate(([s, v]) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
        return `NOT_AN_INPUT (${el.tagName}) — quote the selector if it contains spaces`;
      }
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return `OK (len=${el.value.length})`;
    }, [sel, value]));
  },

  async type(text) { if (page) await page.keyboard.type(text, { delay: 20 }); },
  async press(key) { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 20_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  /**
   * Poll until a selector appears. For states too short-lived for `wait`.
   * Usage: poll-for <css-sel> [timeout-ms]  — the selector may contain spaces,
   * so the timeout is taken from the end only when the last token is a number.
   */
  async 'poll-for'(rest) {
    if (!page) return console.log('ERROR: launch first');
    const parts = rest.trim().split(/\s+/);
    const tail = parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]) ? parts.pop() : null;
    const sel = parts.join(' ');
    const budget = Number(tail) || 10_000;
    const start = Date.now();
    while (Date.now() - start < budget) {
      if (await page.evaluate((s) => !!document.querySelector(s), sel)) {
        return console.log('appeared:', sel, `after ${Date.now() - start}ms`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('NEVER APPEARED:', sel);
  },

  /** Arm a one-shot handler for the next window.confirm/alert: accept | dismiss. */
  async dialog(action) {
    if (!page) return console.log('ERROR: launch first');
    const accept = action === 'accept';
    page.once('dialog', async (d) => {
      console.log(`DIALOG(${d.type()}): ${JSON.stringify(d.message())} → ${accept ? 'accepted' : 'dismissed'}`);
      await (accept ? d.accept() : d.dismiss());
    });
    console.log(`armed: next dialog will be ${accept ? 'accepted' : 'dismissed'}`);
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    app = null;
    page = null;
    userDataDir = null;
  },

  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

// Electron steals the inherited stdin — read the raw fd so the REPL keeps input.
// Works for a TTY and for a pipe, which is how scripted runs feed commands.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

// readline emits every buffered line at once when stdin is a pipe, and an async
// handler does not hold the next event back — without this chain a scripted run
// fires all commands before `launch` has resolved.
let queue = Promise.resolve();
let closed = false;
const prompt = () => { if (!closed) rl.prompt(); };

rl.on('line', (line) => {
  queue = queue.then(async () => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return prompt();
    const i = trimmed.indexOf(' ');
    const [cmd, rest] = i < 0 ? [trimmed, ''] : [trimmed.slice(0, i), trimmed.slice(i + 1)];
    const fn = COMMANDS[cmd];
    if (!fn) {
      console.log('unknown:', cmd, '— try: help');
      return prompt();
    }
    try { await fn(rest); } catch (e) { console.log('ERROR:', e.message); }
    if (cmd === 'quit') { closed = true; rl.close(); process.exit(0); }
    prompt();
  });
});
// A piped script ends with EOF; let queued commands finish before tearing down.
rl.on('close', () => {
  closed = true;
  queue = queue.then(async () => {
    await COMMANDS.quit();
    process.exit(0);
  });
});

console.log('dexter desktop driver — "help" for commands, "launch" to start');
rl.prompt();
