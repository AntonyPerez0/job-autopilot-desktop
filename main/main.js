// The desktop app: one window with the dashboard (or the first-run setup),
// the autopilot loop running in this process, and everything stored in the
// OS app-data folder. The window talks to the engine over IPC only.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeSecretStore } from "./secrets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(HERE, "..", "ui");

// JA_DATA_DIR lets the end-to-end test run against an empty folder.
if (process.env.JA_DATA_DIR) app.setPath("userData", process.env.JA_DATA_DIR);
const DATA = app.getPath("userData");
process.env.JA_DATA_DIR = DATA;
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(DATA, "browsers");

protocol.registerSchemesAsPrivileged([{ scheme: "ap-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null, core = null;

function page(name) { return path.join(UI, name); }

// Light, dark, or whatever the computer uses ("system"). Pages follow it through prefers-color-scheme.
const THEMES = ["system", "light", "dark"];
const applyTheme = (t) => { nativeTheme.themeSource = THEMES.includes(t) ? t : "system"; };
const TEXT_SIZES = [1, 1.15, 1.3];
const textSize = (f) => (TEXT_SIZES.includes(Number(f)) ? Number(f) : 1);
// The window's own title bar is replaced by the app's: the page draws the background, and on Windows
// the minimize/maximize/close buttons sit on top in the app's paper and ink colours.
const MAC = process.platform === "darwin", WIN = process.platform === "win32";
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
  win.once("ready-to-show", () => win.show());
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
  win.loadFile(page(s.onboarded ? "index.html" : "onboarding.html"));
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
    if (!url.startsWith(pathToFileURL(UI).href)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  const store = await import("../core/store.js");
  store.setDataDir(DATA);
  store.setSecretStore(await makeSecretStore(path.join(DATA, "secrets.json")));
  const api = await import("../core/api.js");
  const worker = await import("../core/worker.js");
  const db = await import("../core/db.js");
  db.openDb();
  core = { store, api, worker };
  // One line per start, so support (and the update test) can see which version ran when.
  try {
    const f = path.join(DATA, "launches.json");
    const list = (() => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; } })();
    fs.writeFileSync(f, JSON.stringify([...list.slice(-19), { version: app.getVersion(), at: new Date().toISOString(), exe: process.execPath }], null, 1));
  } catch { /* informational only */ }
  const history = await import("../core/history.js");
  history.setDefaultBackupDir(path.join(app.getPath("documents"), "Job Autopilot"));
  history.startBackups(app.getVersion());
  ipcMain.handle("history-save", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, { title: "Save your application history", defaultPath: path.join(app.getPath("documents"), `job-autopilot-history-${day}.json.gz`),
      filters: [{ name: "Job Autopilot history", extensions: ["gz"] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, history.exportHistory(app.getVersion()));
    return r.filePath;
  });
  // Save a resume PDF the app made (Resume page > Download) wherever the user likes.
  ipcMain.handle("save-resume", async (_e, file, suggested) => {
    const src = path.join(DATA, "resumes", path.basename(String(file || "")));
    if (!fs.existsSync(src)) return null;
    const r = await dialog.showSaveDialog(win, { title: "Save your resume", defaultPath: path.join(app.getPath("downloads"), path.basename(String(suggested || "Resume.pdf"))), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(src, r.filePath);
    return r.filePath;
  });
  ipcMain.handle("pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Where to keep your application history", properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("show-file", (_e, f) => { if (f && fs.existsSync(String(f))) shell.showItemInFolder(String(f)); });
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

  ipcMain.handle("api", (_e, route, body) => api.handle(route, body));
  ipcMain.handle("open-external", (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(String(url)); });
  ipcMain.handle("show-data-folder", () => shell.openPath(DATA));
  ipcMain.handle("set-theme", (_e, t) => { applyTheme(t); store.saveSettings({ theme: nativeTheme.themeSource }); return nativeTheme.themeSource; });
  ipcMain.handle("set-text-size", (_e, f) => {
    const z = textSize(f);
    store.saveSettings({ textSize: z });
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(z);
    return z;
  });
  ipcMain.handle("go", (_e, name) => {
    if (!win || !["index.html", "onboarding.html"].includes(name)) return;
    if (name === "index.html" && store.getSettings().onboarded) worker.run();
    win.loadFile(page(name));
  });

  createWindow();
  if (store.getSettings().onboarded) worker.run();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

// Closing the window quits: the autopilot only works while the app is open.
app.on("window-all-closed", async () => {
  if (core) {
    core.worker.stop();
    const { closeBrowser } = await import("../core/browser.js");
    await Promise.race([closeBrowser(), new Promise((r) => setTimeout(r, 4000))]);
  }
  app.quit();
});

process.on("unhandledRejection", (e) => console.error("unhandled:", e));
