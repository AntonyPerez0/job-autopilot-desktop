// The only bridge between the app window and the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ja", {
  // body undefined: read; anything else: change
  api: (route, body) => ipcRenderer.invoke("api", route, body),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  showDataFolder: () => ipcRenderer.invoke("show-data-folder"),
  go: (page) => ipcRenderer.invoke("go", page),
  saveHistory: () => ipcRenderer.invoke("history-save"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  saveResume: (file, name) => ipcRenderer.invoke("save-resume", file, name),
  showFile: (f) => ipcRenderer.invoke("show-file", f),
  setTheme: (mode) => ipcRenderer.invoke("set-theme", mode),
  platform: process.platform,
});
