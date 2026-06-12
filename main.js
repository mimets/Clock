const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const { autoUpdater } = require('electron-updater');
let mainWindow, tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 500,
    minHeight: 500,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#08081a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Create tray icon
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Stage Tracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Stage Tracker', click: () => mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Verifica aggiornamenti...',
      click: () => { autoUpdater.checkForUpdates(); }
    },
    { type: 'separator' },
    { label: 'Esci', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => mainWindow.show());
}

// Auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      new Notification('Stage Tracker', { body: 'Nuova versione disponibile: v${info.version}. Download in corso...' })
    `);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      if (confirm('Nuova versione v${info.version} scaricata. Riavviare ora?')) {
        require('electron').ipcRenderer.send('restart-app');
      }
    `);
  }
});

ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});

app.on('ready', () => {
  // IPC: set auto-start
  ipcMain.handle('set-auto-start', async () => {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
      });
      return true;
    } catch (e) {
      return false;
    }
  });
  createWindow();
  autoUpdater.checkForUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});
