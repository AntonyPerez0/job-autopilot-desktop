// The browser applications run in: the user's installed Chrome, else Edge,
// else Playwright's own Chromium, downloaded once into the app-data folder.
// It always uses its own profile folder, never the user's everyday browser profile.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright-core";
import { dataDir } from "./store.js";

const require = createRequire(import.meta.url);
const missing = (e) => /is not found|Executable doesn't exist|not installed|Failed to launch.*ENOENT|Chromium distribution .* is not found/i.test(String(e && e.message));

export function chromiumPath() {
  try { const p = chromium.executablePath(); return p && fs.existsSync(p) ? p : null; } catch { return null; }
}

// Runs Playwright's own installer with this app's Node (Electron as Node), into PLAYWRIGHT_BROWSERS_PATH.
export function installChromium(onLine = () => {}) {
  let cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  cli = cli.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, "install", "--no-shell", "chromium"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true,
    });
    const out = (d) => String(d).split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).forEach(onLine);
    p.stdout.on("data", out); p.stderr.on("data", out);
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 && chromiumPath() ? resolve(chromiumPath()) : reject(new Error(`Chromium download failed (exit ${code})`))));
  });
}

// Which browsers this machine has, for Settings.
export async function detectBrowsers() {
  const out = {};
  for (const ch of ["chrome", "msedge"]) {
    try { const b = await chromium.launch({ channel: ch, headless: true, timeout: 20000 }); await b.close(); out[ch] = true; } catch { out[ch] = false; }
  }
  out.chromium = !!chromiumPath();
  return out;
}

let preferred = null; // the channel that worked last time

export async function launch({ headless = false, choice = "auto", onStatus = () => {} } = {}) {
  const order = choice === "auto" ? [preferred, "chrome", "msedge", "chromium"].filter((x, i, a) => x && a.indexOf(x) === i) : [choice];
  const userDataDir = dataDir("browser-profile");
  const base = { headless, viewport: null, args: ["--window-size=1280,800", "--no-first-run", "--no-default-browser-check"], timeout: 60000 };
  let last;
  for (const ch of order) {
    try {
      let opts;
      if (ch === "chromium") {
        let exe = chromiumPath();
        if (!exe) { onStatus("Downloading Chromium (about 150 MB, once)"); exe = await installChromium((l) => onStatus("Chromium: " + l.slice(0, 80))); }
        opts = { ...base, executablePath: exe, channel: headless ? "chromium" : undefined };
      } else opts = { ...base, channel: ch };
      let ctx = await chromium.launchPersistentContext(userDataDir, opts);
      // With no window, the browser calls itself "HeadlessChrome", and sites behind bot checks
      // (HiringCafe's Cloudflare among them) refuse it. Start it again under its ordinary name.
      if (headless) {
        const p = ctx.pages()[0] || await ctx.newPage();
        const ua = String(await p.evaluate(() => navigator.userAgent).catch(() => ""));
        if (/HeadlessChrome/.test(ua)) {
          await ctx.close();
          ctx = await chromium.launchPersistentContext(userDataDir, { ...opts, userAgent: ua.replace(/HeadlessChrome/g, "Chrome") });
        }
      }
      preferred = ch;
      return { ctx, channel: ch };
    } catch (e) {
      last = e;
      if (/user data directory is already in use|ProcessSingleton|SingletonLock/i.test(e.message)) throw new Error("The application browser is already open. Close its window and try again.");
      if (!missing(e) && choice !== "auto") throw e;
    }
  }
  throw last || new Error("No browser could be started");
}

// ---------- the one browser applications run in, kept open between applications ----------
// windowMode: "minimized" (default; the user can bring it up from the dashboard),
// "visible" (in front, to watch), or "headless" (no window at all).

let shared = null; // { ctx, channel, mode }

async function cdpWindow(page) {
  const s = await page.context().newCDPSession(page);
  const { windowId } = await s.send("Browser.getWindowForTarget");
  return { s, windowId };
}

export async function setWindowState(page, state) {
  try {
    const { s, windowId } = await cdpWindow(page);
    const now = async () => (await s.send("Browser.getWindowBounds", { windowId })).bounds.windowState;
    for (let i = 0; i < 3; i++) {
      const cur = await now();
      if (cur === state) break;
      // A maximized or full-screen window (macOS treats one larger than the screen as maximized)
      // has to go back to "normal" before it can be minimized.
      if (cur !== "normal" && state !== "normal") {
        await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
        await new Promise((r) => setTimeout(r, 300));
      }
      await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
      await new Promise((r) => setTimeout(r, 300));
    }
    const ok = (await now()) === state;
    await s.detach().catch(() => {});
    return ok;
  } catch { return false; }
}

export async function windowState(page) {
  try {
    const { s, windowId } = await cdpWindow(page);
    const { bounds } = await s.send("Browser.getWindowBounds", { windowId });
    await s.detach().catch(() => {});
    return bounds.windowState;
  } catch { return null; }
}

// macOS brings a newly started browser to the front. Note which app the user was in, and give it focus back.
function frontApp() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", "lsappinfo info -only bundleid \"$(lsappinfo front)\""], { timeout: 3000 }, (err, out) => {
      const m = String(out || "").match(/"CFBundleIdentifier"="([^"]+)"/);
      resolve(err || !m ? null : m[1]);
    });
  });
}
const refocus = (bundleId) => { if (bundleId) execFile("/usr/bin/open", ["-b", bundleId], { timeout: 5000 }, () => {}); };

const BROWSER_APP = /^(com\.google\.Chrome|com\.microsoft\.edgemac|org\.chromium|com\.google\.chrome\.for\.testing)/i;
let lastUserApp = null;
const userApp = async () => { const id = await frontApp(); if (id && !BROWSER_APP.test(id)) lastUserApp = id; return lastUserApp; };

// Run a browser action that macOS may answer by bringing the browser forward, then hand focus back.
async function keepFocus(windowMode, fn) {
  if (process.platform !== "darwin" || windowMode === "visible") return fn();
  const before = await userApp();
  const out = await fn();
  await new Promise((r) => setTimeout(r, 150));
  const now = await frontApp();
  if (before && now && BROWSER_APP.test(now)) refocus(before);
  return out;
}

// Out of the way: minimized on Windows and Linux. macOS does not draw a minimized window, so its
// screenshots would never come; there the window is parked off the left edge of the screen
// (macOS keeps a sliver of it on screen) behind the user's other windows.
export const PARKED_LEFT = -100000;
export async function tuck(page) {
  if (process.platform !== "darwin") return setWindowState(page, "minimized");
  await setWindowState(page, "normal");
  try {
    const { s, windowId } = await cdpWindow(page);
    await s.send("Browser.setWindowBounds", { windowId, bounds: { left: PARKED_LEFT, top: 80, width: 1280, height: 800 } });
    await s.detach().catch(() => {});
    return true;
  } catch { return false; }
}
export async function tucked(page) {
  if (process.platform !== "darwin") return (await windowState(page)) === "minimized";
  try {
    const { s, windowId } = await cdpWindow(page);
    const { bounds } = await s.send("Browser.getWindowBounds", { windowId });
    await s.detach().catch(() => {});
    return bounds.windowState === "normal" && bounds.left + bounds.width <= 100;
  } catch { return false; }
}

export async function acquireBrowser({ windowMode = "minimized", choice = "auto", onStatus = () => {} } = {}) {
  if (shared && shared.mode === (windowMode === "headless") && shared.choice === choice) {
    try { shared.ctx.pages(); return shared; } catch { shared = null; }
  }
  if (shared) await closeBrowser();
  const before = windowMode === "visible" ? null : await userApp();
  const { ctx, channel } = await launch({ headless: windowMode === "headless", choice, onStatus });
  shared = { ctx, channel, mode: windowMode === "headless", choice };
  ctx.on("close", () => { if (shared && shared.ctx === ctx) shared = null; });
  if (windowMode === "minimized") await tuck(ctx.pages()[0] || await ctx.newPage());
  refocus(before);
  return shared;
}

// A fresh tab for one application, kept in the window state the user chose. On macOS a new tab
// brings the browser to the front, so whatever the user was in gets focus back.
export async function newAppPage(b, windowMode) {
  const page = await keepFocus(windowMode, () => b.ctx.newPage());
  // Keep one blank tab besides this one, so the window survives when this tab closes.
  const blanks = b.ctx.pages().filter((p) => p !== page && p.url() === "about:blank");
  for (const p of blanks.slice(1)) await p.close().catch(() => {});
  if (windowMode === "minimized") { if (!(await tucked(page))) await keepFocus(windowMode, () => tuck(page)); }
  else if (windowMode === "visible") await page.bringToFront().catch(() => {});
  return page;
}

// Done with one application. Closing the last tab would close the window (and on most systems the
// browser), so that one is blanked instead.
export async function closeAppPage(page, windowMode) {
  await keepFocus(windowMode, async () => {
    if (page.context().pages().length > 1) await page.close().catch(() => {});
    else await page.goto("about:blank").catch(() => {});
  });
}

export async function closeBrowser() {
  const s = shared;
  shared = null;
  if (s) await s.ctx.close().catch(() => {});
}

export const browserOpen = () => !!shared;

// Dashboard buttons: bring the window up to watch, or put it away again.
export async function showBrowser(show) {
  if (!shared || shared.mode) return false;
  const pages = shared.ctx.pages();
  const page = pages[pages.length - 1];
  if (!page) return false;
  if (!show) return keepFocus("minimized", () => tuck(page));
  await setWindowState(page, "normal");
  if (process.platform === "darwin") {
    try {
      const { s, windowId } = await cdpWindow(page);
      await s.send("Browser.setWindowBounds", { windowId, bounds: { left: 80, top: 80, width: 1280, height: 800 } });
      await s.detach().catch(() => {});
    } catch { /* still brought to front below */ }
    const app = { chrome: "Google Chrome", msedge: "Microsoft Edge" }[shared.channel] || (chromiumPath() || "").replace(/(\.app)\/.*$/, "$1");
    if (app) execFile("/usr/bin/open", ["-a", app], { timeout: 5000 }, () => {});
  }
  await page.bringToFront().catch(() => {});
  return true;
}
