// The bridge between Retake's windows and the main process. Only these two functions are exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('retakeDesktop', {
  platform: process.platform,
  call: (name, data) => ipcRenderer.invoke('call', name, data),
  on: (event, fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(`evt:${event}`, listener);
    return () => ipcRenderer.removeListener(`evt:${event}`, listener);
  },
});
