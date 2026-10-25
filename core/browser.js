// The browser applications run in: the user's installed Chrome, else Edge,
// else Playwright's own Chromium, downloaded once into the app-data folder.
// It always uses its own profile folder, never the user's everyday browser profile.
import { spawn } from "node:child_process";
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
  let cli = require.resolve("playwright-core/cli.js");
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
  const base = { headless, viewport: null, args: ["--window-size=1366,900", "--no-first-run", "--no-default-browser-check"], timeout: 60000 };
  let last;
  for (const ch of order) {
    try {
      let opts;
      if (ch === "chromium") {
        let exe = chromiumPath();
        if (!exe) { onStatus("Downloading Chromium (about 150 MB, once)"); exe = await installChromium((l) => onStatus("Chromium: " + l.slice(0, 80))); }
        opts = { ...base, executablePath: exe, channel: headless ? "chromium" : undefined };
      } else opts = { ...base, channel: ch };
      const ctx = await chromium.launchPersistentContext(userDataDir, opts);
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
