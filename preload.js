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
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  restartApp: () => ipcRenderer.send('restart-app'),
  readFileDB: () => ipcRenderer.invoke('read-filedb'),
  writeFileDB: (data) => ipcRenderer.invoke('write-filedb', data),
  checkDbTables: () => ipcRenderer.invoke('check-db-tables'),
  migrateDb: (pw) => ipcRenderer.invoke('migrate-db', pw),
  deleteMessage: (messageId, username) => ipcRenderer.invoke('delete-message', messageId, username),
  deleteUser: (targetUsername) => ipcRenderer.invoke('delete-user', targetUsername),
  addReaction: (messageId, username, reaction) => ipcRenderer.invoke('add-reaction', messageId, username, reaction),
  setTyping: (channelId, username) => ipcRenderer.invoke('set-typing', channelId, username),
  getTypingUsers: (channelId) => ipcRenderer.invoke('get-typing-users', channelId),
  wipeDatabase: () => ipcRenderer.invoke('wipe-database'),
  resetUser: (targetUsername) => ipcRenderer.invoke('reset-user', targetUsername),
  getScreenSource: () => ipcRenderer.invoke('get-screen-source')
});
