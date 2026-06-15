const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setAutoStart: () => ipcRenderer.invoke('set-auto-start'),
  checkUpdates: () => ipcRenderer.send('check-updates'),
  onUpdateChecking: (callback) => { ipcRenderer.on('update-checking', (_e) => callback()); },
  onUpdateNone: (callback) => { ipcRenderer.on('update-none', (_e, info) => callback(info)); },
  onUpdateAvailable: (callback) => { ipcRenderer.on('update-available', (_e, info) => callback(info)); },
  onUpdateProgress: (callback) => { ipcRenderer.on('update-progress', (_e, info) => callback(info)); },
  onUpdateDownloaded: (callback) => { ipcRenderer.on('update-downloaded', (_e, info) => callback(info)); },
  onUpdateError: (callback) => { ipcRenderer.on('update-error', (_e, info) => callback(info)); },
  onRestartCountdown: (callback) => { ipcRenderer.on('restart-countdown', (_e, info) => callback(info)); },
  restartApp: () => ipcRenderer.send('restart-app')
});
