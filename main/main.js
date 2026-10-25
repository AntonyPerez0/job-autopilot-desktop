// The desktop app: one window with the dashboard (or the first-run setup),
// the autopilot loop running in this process, and everything stored in the
// OS app-data folder. The window talks to the engine over IPC only.
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
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

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 960, minHeight: 640, title: "Job Autopilot", show: false,
    backgroundColor: "#f7f8fa",
    webPreferences: { preload: path.join(HERE, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, plugins: true },
  });
  win.once("ready-to-show", () => win.show());
  const s = core.store.getSettings();
  win.loadFile(page(s.onboarded ? "index.html" : "onboarding.html"));
  // Links to postings and help pages open in the user's own browser; the app window never leaves its own pages.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    else if (url.startsWith("ap-file://")) {
      const child = new BrowserWindow({ width: 1000, height: 900, webPreferences: { sandbox: true, plugins: true } });
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
  if (core) core.worker.stop();
  app.quit();
});

process.on("unhandledRejection", (e) => console.error("unhandled:", e));
