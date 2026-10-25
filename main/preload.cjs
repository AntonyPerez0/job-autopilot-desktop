// The only bridge between the app window and the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ja", {
  // body undefined: read; anything else: change
  api: (route, body) => ipcRenderer.invoke("api", route, body),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  showDataFolder: () => ipcRenderer.invoke("show-data-folder"),
  go: (page) => ipcRenderer.invoke("go", page),
});
