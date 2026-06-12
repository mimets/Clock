const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setAutoStart: () => ipcRenderer.invoke('set-auto-start')
});
