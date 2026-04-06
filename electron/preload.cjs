const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("censoCapture", {
  startCapture: (payload) => ipcRenderer.invoke("capture:start", payload),
  onLog: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on("capture:log", handler);
    return () => ipcRenderer.removeListener("capture:log", handler);
  },
});
