const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, exec } = require('child_process');

process.env.ELECTRON_DISABLE_FFMPEG = '1';
if (app.commandLine) {
  app.commandLine.appendSwitch('disable-ffmpeg');
  app.commandLine.appendSwitch('no-sandbox');
}

const logPath = path.join(app.getPath('userData'), 'debug.log');
function dbg(m) { try { fs.appendFileSync(logPath, new Date().toISOString()+' '+m+'\n'); } catch(_) {} }

let mainWindow, tray;
let updateVersion = null;
let isDownloading = false;

function createWindow() {
  dbg('createWindow');
  mainWindow = new BrowserWindow({
    width: 1100, height: 720, minWidth: 500, minHeight: 500,
    icon: path.join(__dirname, 'icon.png'), backgroundColor: '#08081a',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    autoHideMenuBar: true, show: false
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Stage Tracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Stage Tracker', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Verifica aggiornamenti...', click: () => checkForUpdates() },
    { type: 'separator' },
    { label: 'Esci', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => mainWindow.show());
}

function send(channel, data) {
  try { if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, data); } catch(_) {}
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'StageTracker' }, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, { headers: { 'User-Agent': 'StageTracker' }, timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        const file = fs.createWriteStream(dest);
        const total = parseInt(res.headers['content-length'], 10);
        let downloaded = 0;
        res.pipe(file);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) send('update-progress', { percent: Math.min(99, Math.round(downloaded / total * 100)) });
        });
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    };
    doGet(url);
  });
}

function getCurrentVer() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0'; } catch(_) { return '0.0.0'; }
}

function verGt(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((aa[i] || 0) > (bb[i] || 0)) return true;
    if ((aa[i] || 0) < (bb[i] || 0)) return false;
  }
  return false;
}

async function doUpdate() {
  if (isDownloading || !updateVersion) return;
  isDownloading = true;
  try {
    send('update-available', { version: updateVersion });
    send('update-progress', { percent: 0 });

    const exeUrl = 'https://github.com/mimets/Clock/releases/download/v' + updateVersion + '/StageTracker-' + updateVersion + '.exe';
    const exePath = path.join(app.getPath('userData'), 'StageTracker-' + updateVersion + '-setup.exe');

    dbg('downloading installer: ' + exeUrl);
    await downloadFile(exeUrl, exePath);
    dbg('installer downloaded, size: ' + fs.statSync(exePath).size);

    // Verify it's actually an EXE (not a 404 HTML page)
    const header = fs.readFileSync(exePath, { encoding: null }).slice(0, 2);
    if (header[0] !== 0x4D || header[1] !== 0x5A) throw new Error('Downloaded file is not a valid executable (missing MZ header)');

    send('update-downloaded', { version: updateVersion });
    send('restart-countdown', { seconds: 5 });

    try {
      new Notification({ title: 'Aggiornamento pronto', body: 'Installazione tra 5 secondi...' }).show();
    } catch(_) {}

    await new Promise(r => setTimeout(r, 5000));

    dbg('launching installer: ' + exePath);
    app.isQuitting = true;

    // Close all windows first so the installer can overwrite files
    mainWindow.close();

    // Write a VBScript (no console window) that:
    //   1. Waits for our process to fully exit via WMI
    //   2. Runs the installer silently
    //   3. Launches the new app
    //   4. Deletes itself
    const scriptPath = path.join(app.getPath('userData'), 'update.vbs');
    const appExe = app.getPath('exe');
    const vbsScript = 
      'Dim WshShell, pid, installer, appExePath\r\n' +
      'Set WshShell = CreateObject("WScript.Shell")\r\n' +
      'pid = ' + process.pid + '\r\n' +
      'installer = "' + exePath.replace(/\\/g, '\\\\') + '"\r\n' +
      'appExePath = "' + appExe.replace(/\\/g, '\\\\') + '"\r\n' +
      'Set objWMIService = GetObject("winmgmts:\\\\.\\root\\cimv2")\r\n' +
      'Do\r\n' +
      '  Set colProcessList = objWMIService.ExecQuery("SELECT * FROM Win32_Process WHERE ProcessId = " & pid)\r\n' +
      '  If colProcessList.Count = 0 Then Exit Do\r\n' +
      '  WScript.Sleep 1000\r\n' +
      'Loop\r\n' +
      'WshShell.Run chr(34) & installer & chr(34) & " /S", 0, True\r\n' +
      'WshShell.Run chr(34) & appExePath & chr(34), 0, False\r\n' +
      'Set fso = CreateObject("Scripting.FileSystemObject")\r\n' +
      'fso.DeleteFile WScript.ScriptFullName';
    fs.writeFileSync(scriptPath, vbsScript, 'utf8');
    dbg('update script written: ' + scriptPath);

    // Launch via wscript.exe (no console window)
    spawn('wscript.exe', [scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();

    // Give PowerShell a moment to start, then quit
    await new Promise(r => setTimeout(r, 1000));
    app.quit();
  } catch (err) {
    dbg('update error: ' + err.message);
    isDownloading = false;
    send('update-error', { message: err.message });
  }
}

async function checkForUpdates() {
  send('update-checking', {});
  try {
    // Use raw GitHub file (no rate limit) instead of API
    const currentVer = getCurrentVer();
    const url = 'https://raw.githubusercontent.com/mimets/Clock/refs/heads/master/version.txt';
    const { status, body } = await httpsGet(url);

    if (status !== 200) {
      dbg('check failed: HTTP ' + status);
      send('update-error', { message: 'HTTP ' + status });
      return;
    }

    const latestVer = body.trim();
    dbg('current=' + currentVer + ' latest=' + latestVer);

    if (verGt(latestVer, currentVer)) {
      updateVersion = latestVer;
      dbg('update available: ' + latestVer);
      doUpdate();
    } else {
      dbg('up to date');
      send('update-none', { version: currentVer });
    }
  } catch (err) {
    dbg('check error: ' + err.message);
    send('update-error', { message: err.message });
  }
}

ipcMain.on('restart-app', () => {
  app.isQuitting = true;
  spawn(app.getPath('exe'), [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
});

ipcMain.on('delay-restart', () => {});

const dbFilePath = () => path.join(app.getPath('userData'), 'stagedb.json');

ipcMain.handle('read-filedb', () => {
  try {
    const p = dbFilePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    return null;
  } catch(_) { return null; }
});

ipcMain.handle('write-filedb', (_e, data) => {
  try { fs.writeFileSync(dbFilePath(), JSON.stringify(data), 'utf8'); return true; } catch(_) { return false; }
});

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default now(),
  username text not null,
  content text not null,
  conversation_id text
);
CREATE TABLE IF NOT EXISTS message_likes (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default now(),
  message_id text not null,
  username text not null
);
CREATE TABLE IF NOT EXISTS follows (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default now(),
  follower text not null,
  following text not null
);
CREATE TABLE IF NOT EXISTS notifications (
  id bigint generated by default as identity primary key,
  created_at timestamp with time zone default now(),
  username text not null,
  type text not null,
  from_user text not null,
  message text default '',
  reference_id text default '',
  read boolean default false
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "anon_all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_all" ON message_likes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_all" ON follows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_all" ON notifications FOR ALL USING (true) WITH CHECK (true);
`.trim();

function getDbPassword() {
  try {
    const p = path.join(app.getPath('userData'), 'db_pass.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch(_) {}
  return null;
}

function saveDbPassword(pw) {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'db_pass.txt'), pw, 'utf8');
  } catch(_) {}
}

ipcMain.handle('check-db-tables', async () => {
  try {
    const pw = getDbPassword();
    if (!pw) return { needsPassword: true, tablesExist: false };
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: pw,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    const r = await c.query("SELECT to_regclass('public.messages') IS NOT NULL as exists");
    await c.end();
    return { needsPassword: false, tablesExist: r.rows[0].exists };
  } catch(e) {
    return { needsPassword: !getDbPassword(), tablesExist: false, error: e.message };
  }
});

ipcMain.handle('migrate-db', async (_e, pw) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: pw,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    await c.query(MIGRATE_SQL);
    await c.end();
    saveDbPassword(pw);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

app.on('ready', () => {
  ipcMain.handle('set-auto-start', async () => {
    try { app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') }); return true; } catch(e) { return false; }
  });
  ipcMain.on('check-updates', () => checkForUpdates());
  createWindow();
  setTimeout(checkForUpdates, 3000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
