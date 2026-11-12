// The desktop app: one window with the dashboard (or the first-run setup),
// the autopilot loop running in this process, and everything stored in the
// OS app-data folder. The window talks to the engine over IPC only.
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, protocol, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeSecretStore } from "./secrets.js";
import { startBackground } from "./background.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(HERE, "..", "ui");

// JA_DATA_DIR lets the end-to-end test run against an empty folder.
const TEST_RUN = !!process.env.JA_DATA_DIR;
if (process.env.JA_DATA_DIR) app.setPath("userData", process.env.JA_DATA_DIR);
const DATA = app.getPath("userData");
process.env.JA_DATA_DIR = DATA;
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(DATA, "browsers");

// The window's own pages come from app://ui/ (only the ui folder), never file://, so a page can't read other files.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "ap-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
const UI_URL = "app://ui/";
const inside = (f, dir) => { if (!dir) return false; const r = path.relative(path.resolve(dir), path.resolve(f)); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

if (!app.requestSingleInstanceLock()) app.quit();

let win = null, core = null, bg = null;
// Quitting for real (the menu's Quit, Cmd+Q, an update): the window may close. Otherwise closing it only hides it.
let quitting = false;
app.on("before-quit", () => { quitting = true; });
// Started with the computer: no window until the person opens it from the menu bar or system tray.
// (macOS has no "open hidden" any more: an app opened at login by the system is told so, and stays out of the way.)
const startHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && (() => { try { const l = app.getLoginItemSettings(); return !!(l.wasOpenedAtLogin || l.wasOpenedAsHidden); } catch { return false; } })());

function page(name) { return UI_URL + name; }
// Only the app's own two pages, in the window's top frame, may call the engine.
const PAGES = ["index.html", "onboarding.html"].map((n) => UI_URL + n);
const trusted = (e) => { const f = e.senderFrame; return !!f && f.parent === null && PAGES.some((u) => f.url === u || f.url.startsWith(u + "?") || f.url.startsWith(u + "#")); };
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => { if (!trusted(e)) throw new Error("not allowed from this page"); return fn(e, ...args); });

// Light, dark, or whatever the computer uses ("system"). Pages follow it through prefers-color-scheme.
const THEMES = ["system", "light", "dark"];
const applyTheme = (t) => { nativeTheme.themeSource = THEMES.includes(t) ? t : "system"; };
const TEXT_SIZES = [1, 1.15, 1.3];
const textSize = (f) => (TEXT_SIZES.includes(Number(f)) ? Number(f) : 1);
// The window's own title bar is replaced by the app's: the page draws the background, and on Windows
// the minimize/maximize/close buttons sit on top in the app's paper and ink colours.
const MAC = process.platform === "darwin", WIN = process.platform === "win32";
// Windows shows an app's notifications only when the app says which one it is (the name the installer registered).
if (WIN) app.setAppUserModelId("io.github.antonyperez0.jobautopilot");
const overlay = () => (nativeTheme.shouldUseDarkColors ? { color: "#0d0f15", symbolColor: "#eceff1", height: 36 } : { color: "#f7f9fa", symbolColor: "#13161d", height: 36 });
nativeTheme.on("updated", () => { if (WIN) for (const w of BrowserWindow.getAllWindows()) try { w.setTitleBarOverlay(overlay()); } catch { /* a window without an overlay */ } });

function createWindow() {
  applyTheme(core.store.getSettings().theme);
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 960, minHeight: 640, title: "Job Autopilot", show: false,
    // Windows and Linux: no File/Edit/View bar; pressing Alt still shows it, and its shortcuts keep working.
    autoHideMenuBar: true,
    // (Linux keeps its own title bar: the overlay crashes some Linux window systems.)
    ...(MAC ? { titleBarStyle: "hiddenInset", titleBarOverlay: true } : WIN ? { titleBarStyle: "hidden", titleBarOverlay: overlay() } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0f15" : "#f7f9fa",
    webPreferences: { preload: path.join(HERE, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, plugins: true },
  });
  win.once("ready-to-show", () => { if (!startHidden || !core.store.getSettings().onboarded) win.show(); });
  // Closing the window keeps the autopilot working in the background (once set up, and unless turned off in Settings).
  win.on("close", (e) => {
    const st = core.store.getSettings();
    if (quitting || !st.onboarded || st.keepRunning === false) return;
    e.preventDefault();
    // The first time, said in the window itself (a notification may never show): closing it doesn't stop the app,
    // where it went, and the choice to quit instead.
    if (!TEST_RUN && !(st.dismissed || []).includes("hide-notice")) {
      core.store.saveSettings({ dismissed: [...(st.dismissed || []), "hide-notice"] });
      dialog.showMessageBox(win, { type: "info", buttons: ["Keep it working", "Quit Job Autopilot"], defaultId: 0, cancelId: 0,
        message: "Job Autopilot keeps working after you close this window",
        detail: `It goes on looking for jobs and filling in applications. Open it again from its icon ${MAC ? "in the menu bar at the top of the screen" : "in the system tray, next to the clock (it may be under the small arrow there)"}. Quit is there too.\n\nSettings > While it works changes this.` })
        .then((r) => { if (r.response === 1) { quitting = true; app.quit(); } else if (win) win.hide(); });
      return;
    }
    win.hide();
    if (bg) bg.hidden();
  });
  // The person's text size (Settings > Appearance) zooms every page the window loads.
  win.webContents.on("did-finish-load", () => { if (win) win.webContents.setZoomFactor(textSize(core.store.getSettings().textSize)); });
  // Ctrl (Cmd on a Mac) with + or - zooms, and 0 goes back to the chosen text size, whatever the keyboard layout's menu does.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const wc = win.webContents, z = wc.getZoomFactor();
    if (input.key === "=" || input.key === "+") wc.setZoomFactor(Math.min(2, Math.round((z + 0.1) * 10) / 10));
    else if (input.key === "-") wc.setZoomFactor(Math.max(0.8, Math.round((z - 0.1) * 10) / 10));
    else if (input.key === "0") wc.setZoomFactor(textSize(core.store.getSettings().textSize));
    else return;
    e.preventDefault();
  });
  const s = core.store.getSettings();
  win.loadURL(page(s.onboarded ? "index.html" : "onboarding.html"));
  // Links to postings and help pages open in the user's own browser; the app window never leaves its own pages.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    else if (url.startsWith("ap-file://")) {
      const child = new BrowserWindow({ width: 1000, height: 900, autoHideMenuBar: true, webPreferences: { sandbox: true, plugins: true } });
      child.loadURL(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(UI_URL)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  win.on("closed", () => { win = null; });
}

function showWindow() {
  // Opened a second time while it's still starting: the window comes up on its own in a moment.
  if (!core) return;
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  // The app's pages never need the camera, microphone, location, notifications or any other permission.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle("app", (req) => {
    const u = new URL(req.url);
    let file = "";
    try { file = path.resolve(UI, "." + decodeURIComponent(u.pathname)); } catch { /* a malformed address */ }
    if (u.hostname !== "ui" || !inside(file, UI) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  const store = await import("../core/store.js");
  store.setDataDir(DATA);
  store.setSecretStore(await makeSecretStore(path.join(DATA, "secrets.json")));
  const api = await import("../core/api.js");
  const worker = await import("../core/worker.js");
  const db = await import("../core/db.js");
  // A list of jobs that can't be read (the computer lost power while it was being written, say) is set aside and a
  // new one started, so the app still opens. The jobs already applied to come back from the history file below.
  let damaged = null;
  try { db.openDb(); } catch (e) {
    if (!/not a database|malformed|corrupt/i.test(String(e && e.message))) throw e;
    const f = path.join(DATA, "autopilot.db");
    damaged = `${f}.damaged-${new Date().toISOString().slice(0, 10)}`;
    fs.renameSync(f, damaged);
    for (const x of ["-wal", "-shm"]) fs.rmSync(f + x, { force: true });
    db.openDb();
  }
  core = { store, api, worker };
  // One line per start, so support (and the update test) can see which version ran when.
  try {
    const f = path.join(DATA, "launches.json");
    const list = (() => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; } })();
    fs.writeFileSync(f, JSON.stringify([...list.slice(-19), { version: app.getVersion(), at: new Date().toISOString(), exe: process.execPath }], null, 1));
  } catch { /* informational only */ }
  const history = await import("../core/history.js");
  history.setDefaultBackupDir(path.join(app.getPath("documents"), "Job Autopilot"));
  if (damaged) {
    let back = 0;
    try { const f = history.backupFile(); if (f && fs.existsSync(f)) back = history.importHistory(fs.readFileSync(f)).added; } catch { /* nothing to bring back */ }
    db.log(null, `the list of jobs couldn't be read and was set aside (${path.basename(damaged)}); a new one was started${back ? `, with the ${back} jobs you applied to from your application history` : ""}`, "warn");
    damaged = { file: damaged, back };
  }
  history.startBackups(app.getVersion());
  // A file saved where the person chose; a file that can't be written says why in plain words.
  const saveFile = (to, write) => {
    try { write(to); } catch (e) {
      const m = `${e.code || ""} ${e.message || ""}`;
      throw new Error(/EBUSY|EPERM|EACCES/.test(m) ? "That file is open in another program (Excel, say), or that folder can't be written to. Close the file or pick another name or folder, and save again."
        : /ENOSPC/.test(m) ? "There's no room left on that disk. Pick another place, or free some space." : "The file couldn't be saved there. Pick another folder and try again.");
    }
  };
  handle("history-save", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, { title: "Save your application history", defaultPath: path.join(app.getPath("documents"), `job-autopilot-history-${day}.json.gz`),
      filters: [{ name: "Job Autopilot history", extensions: ["gz"] }] });
    if (r.canceled || !r.filePath) return null;
    saveFile(r.filePath, (f) => fs.writeFileSync(f, history.exportHistory(app.getVersion())));
    return r.filePath;
  });
  // Save a resume PDF the app made (Resume page > Download) wherever the user likes.
  handle("save-resume", async (_e, file, suggested) => {
    const src = path.join(DATA, "resumes", path.basename(String(file || "")));
    if (!fs.existsSync(src)) return null;
    const r = await dialog.showSaveDialog(win, { title: "Save your resume", defaultPath: path.join(app.getPath("downloads"), path.basename(String(suggested || "Resume.pdf"))), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    saveFile(r.filePath, (f) => fs.copyFileSync(src, f));
    return r.filePath;
  });
  // A diagnostics report, saved where the person chooses (Downloads by default), then shown in its folder.
  handle("save-diagnostics", async (_e, personal) => {
    const report = await api.handle("/api/diagnostics", { personal: personal === true });
    if (!report || report.error) throw new Error((report && report.error) || "The report couldn't be made.");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const r = await dialog.showSaveDialog(win, { title: "Save the diagnostics report", defaultPath: path.join(app.getPath("downloads"), `job-autopilot-diagnostics-${stamp}.json`),
      filters: [{ name: "Diagnostics report", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return null;
    saveFile(r.filePath, (f) => fs.writeFileSync(f, JSON.stringify(report, null, 1)));
    shell.showItemInFolder(r.filePath);
    return { file: r.filePath, stopped: report.stopped.length, bytes: fs.statSync(r.filePath).size };
  });
  handle("pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Where to keep your application history", properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  // A note the person sends themselves (a referral ask, a follow-up): text only, at most 20,000 characters.
  handle("copy-text", (_e, t) => { clipboard.writeText(String(t || "").slice(0, 20000)); return true; });
  // The list of applications sent, by date, for unemployment claims (a spreadsheet file), saved where the person picks.
  handle("save-applications", async () => {
    const list = await api.handle("/api/applications/log");
    if (!list || list.error) throw new Error((list && list.error) || "The list couldn't be made.");
    const day = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, { title: "Save your list of applications", defaultPath: path.join(app.getPath("documents"), `job-applications-${day}.csv`),
      filters: [{ name: "Spreadsheet (CSV)", extensions: ["csv"] }] });
    if (r.canceled || !r.filePath) return null;
    // With a byte-order mark, so Excel reads names like "Nestlé" right.
    saveFile(r.filePath, (f) => fs.writeFileSync(f, "\ufeff" + list.csv));
    shell.showItemInFolder(r.filePath);
    return { file: r.filePath, count: list.count };
  });
  // Only the history backup (or a file in its folder or the app's data folder); never a network (UNC) path.
  handle("show-file", (_e, f) => {
    const p = String(f || "");
    if (!p || /^(\\\\|\/\/)/.test(p)) return;
    const file = path.resolve(p);
    if ((file === history.backupFile() || inside(file, history.backupDir()) || inside(file, DATA)) && fs.existsSync(file)) shell.showItemInFolder(file);
  });
  const updater = await import("./updater.js");
  updater.initUpdater(worker);
  api.setUpdater({ state: updater.updateState, check: updater.checkNow, install: updater.installNow });

  protocol.handle("ap-file", (req) => {
    const u = new URL(req.url);
    const dir = u.hostname;
    const name = path.basename(decodeURIComponent(u.pathname));
    const file = path.join(DATA, dir, name);
    if (!["resumes", "shots"].includes(dir) || !name || !fs.existsSync(file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  handle("api", (_e, route, body) => api.handle(route, body));
  handle("open-external", (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(String(url)); });
  handle("show-data-folder", () => shell.openPath(DATA));
  handle("set-theme", (_e, t) => { applyTheme(t); store.saveSettings({ theme: nativeTheme.themeSource }); return nativeTheme.themeSource; });
  handle("set-text-size", (_e, f) => {
    const z = textSize(f);
    store.saveSettings({ textSize: z });
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(z);
    return z;
  });
  handle("go", (_e, name) => {
    if (!win || !["index.html", "onboarding.html"].includes(name)) return;
    if (name === "index.html" && store.getSettings().onboarded) worker.run();
    win.loadURL(page(name));
  });

  // The person's own browser opens only OpenRouter's sign-in page, for Connect with OpenRouter.
  api.setOpener((u) => { if (!/^https:\/\/openrouter\.ai\//.test(String(u))) throw new Error("not an OpenRouter address"); return shell.openExternal(String(u)); });

  if (!win) createWindow();
  if (damaged && !TEST_RUN) {
    dialog.showMessageBox(win, { type: "warning", message: "Your list of jobs couldn't be read, so Job Autopilot started a new one",
      detail: `${damaged.back ? `The ${damaged.back} jobs you already applied to were brought back from your application history, so none is applied to twice.` : "If you applied to jobs before, bring them back under Settings > Application history > Import a history file, so none is applied to twice."} Your resume, answers and settings are as they were. The old list is kept as ${path.basename(damaged.file)} in the app's folder.` });
  }
  if (store.getSettings().onboarded) worker.run();
  bg = startBackground({ core, here: HERE, show: showWindow, visible: () => !!win && win.isVisible() && win.isFocused(),
    open: (target) => { showWindow(); if (win) win.webContents.send("navigate", target || {}); } });
  app.on("activate", showWindow);
  // macOS: "Update now" can only replace the app in Applications, so a copy run from the disk image or Downloads offers to move there.
  // Asked on the window, once it shows (a question with no window would hold the whole app until it's answered).
  if (MAC && app.isPackaged && !TEST_RUN && !app.isInApplicationsFolder() && !(store.getSettings().dismissed || []).includes("move-to-applications")) {
    if (!win.isVisible()) await new Promise((r) => win.once("show", r));
    const r = await dialog.showMessageBox(win, { type: "question", buttons: ["Move to Applications", "Not now"], defaultId: 0, cancelId: 1,
      message: "Move Job Autopilot to your Applications folder?", detail: "It needs to be there to update itself. It opens again from there by itself.", checkboxLabel: "Don't ask again" });
    if (r.checkboxChecked) store.saveSettings({ dismissed: [...(store.getSettings().dismissed || []), "move-to-applications"] });
    if (r.response === 0) { try { quitting = true; if (!app.moveToApplicationsFolder()) quitting = false; } catch (e) { quitting = false; dialog.showMessageBox(win, { type: "warning", message: "Job Autopilot couldn't move itself", detail: `Drag it into Applications yourself, then open it from there. (${e.message})` }); } }
  }
}).catch((e) => {
  console.error("startup failed:", e);
  // With the window up, the app carries on. Without one there would be nothing to see or close: say so, and quit.
  if (win) return;
  const m = String((e && e.message) || e);
  dialog.showErrorBox("Job Autopilot couldn't start", `${/ENOSPC|SQLITE_FULL|disk is full/i.test(m) ? "This computer's disk is full. Free some space, then open Job Autopilot again."
    : /EACCES|EPERM|EROFS|readonly|read-only/i.test(m) ? `Job Autopilot can't write to its folder (${DATA}). Check that the folder isn't read-only, then open it again.`
      : "Something went wrong while it was starting. Restart your computer and open it again; if it keeps happening, install the latest version from the Releases page."}\n\n(${m.slice(0, 300)})`);
  app.exit(1);
});

// Before the app goes, however it was told to (the window closed for real, Quit in the tray, Cmd+Q): the autopilot
// stops and the browser it applies with is closed, so none is left running behind.
let tidied = false;
async function tidyUp() {
  if (tidied) return;
  tidied = true;
  try {
    if (bg) bg.stop();
    if (core) {
      core.worker.stop();
      const { closeBrowser } = await import("../core/browser.js");
      await Promise.race([closeBrowser(), new Promise((r) => setTimeout(r, 4000))]);
    }
  } catch (e) { console.error("closing down:", e); }
}
app.on("window-all-closed", async () => { await tidyUp(); app.quit(); });
app.on("will-quit", (e) => {
  if (tidied) return;
  e.preventDefault();
  tidyUp().finally(() => app.exit(0));
});

process.on("unhandledRejection", (e) => console.error("unhandled:", e));
