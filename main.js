const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, safeStorage } = require('electron');
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
    const tmp = dest + '.tmp.' + Date.now();
    const doGet = (u, depth) => {
      if (depth > 10) { reject(new Error('Too many redirects')); return; }
      https.get(u, { headers: { 'User-Agent': 'StageTracker' }, timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location, (depth||0) + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
          fs.unlink(tmp, () => {});
          reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
          return;
        }
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (ct.includes('text/html')) {
          res.destroy();
          fs.unlink(tmp, () => {});
          reject(new Error('Downloaded HTML page instead of executable. The release asset may not exist or the URL is wrong.'));
          return;
        }
        if (!ct.includes('application/octet-stream') && !ct.includes('application/x-msdownload') && !ct.includes('application/x-msi') && !ct.includes('application/zip')) {
          dbg('WARNING: unexpected content-type: ' + ct + ' for ' + url);
        }
        let file;
        try { file = fs.createWriteStream(tmp); } catch(err) { reject(err); return; }
        const total = parseInt(res.headers['content-length'], 10);
        let downloaded = 0, lastEmit = 0;
        res.pipe(file);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const now = Date.now();
            if (now - lastEmit > 200) {
              lastEmit = now;
              send('update-progress', { percent: Math.min(99, Math.round(downloaded / total * 100)) });
            }
          }
        });
        file.on('finish', () => {
          file.close();
          // Rename temp file to destination (retry on EBUSY up to 10x)
          let retries = 0;
          const rename = () => {
            try { fs.renameSync(tmp, dest); resolve(); }
            catch(e) {
              if (e.code === 'EBUSY' && retries++ < 10) setTimeout(rename, 1000);
              else reject(e);
            }
          };
          rename();
        });
      }).on('error', (err) => { fs.unlink(tmp, () => {}); reject(err); });
    };
    doGet(url);
  });
}

function getCurrentVer() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0'; } catch(_) { return '0.0.0'; }
}

async function getInstallerUrl(version) {
  const fallback = 'https://github.com/mimets/Clock/releases/download/v' + version + '/StageTracker-' + version + '.exe';
  try {
    const { status, body } = await httpsGet('https://api.github.com/repos/mimets/Clock/releases/tags/v' + version);
    if (status === 200) {
      const release = JSON.parse(body);
      const assets = Array.isArray(release.assets) ? release.assets : [];
      dbg('release assets: ' + assets.map(a => a.name + '(' + a.size + ' bytes)').join(', '));
      // Prefer .exe files that are NOT .blockmap
      const exeAsset = assets.find(a => a && typeof a.name === 'string' && /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name));
      if (exeAsset && exeAsset.browser_download_url) {
        dbg('selected exe asset: ' + exeAsset.name + ' -> ' + exeAsset.browser_download_url);
        return exeAsset.browser_download_url;
      }
      dbg('no suitable exe asset found in release');
    }
  } catch (e) {
    dbg('getInstallerUrl error: ' + e.message);
  }
  dbg('using fallback URL: ' + fallback);
  return fallback;
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

    const exeUrl = await getInstallerUrl(updateVersion);
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();

    // Use PowerShell to run the installer (handles paths with spaces better)
    const psPath = path.join(app.getPath('userData'), 'update.ps1');
    const appExe = app.getPath('exe');
    const appDir = path.dirname(appExe);
    const psScript = [
      'Start-Sleep -Seconds 6',
      'if (-not (Test-Path ' + exePath.replace(/'/g, "''") + ')) {',
      '  Write-Output "PS: installer not found"; exit 1',
      '}',
      'Write-Output "PS: running installer"',
      '$p = Start-Process -FilePath ' + exePath.replace(/'/g, "''") + ' -ArgumentList "/S","/D=' + appDir.replace(/"/g, '""') + '" -Wait -PassThru',
      'Write-Output "PS: installer exit code: $($p.ExitCode)"',
      'if ($p.ExitCode -ne 0) {',
      '  Write-Output "PS: silent install failed, trying interactive"',
      '  $p2 = Start-Process -FilePath ' + exePath.replace(/'/g, "''") + ' -ArgumentList "/D=' + appDir.replace(/"/g, '""') + '" -Wait -PassThru',
      '  Write-Output "PS: interactive exit code: $($p2.ExitCode)"',
      '}',
      'Start-Sleep -Seconds 3',
      'for ($i = 1; $i -le 10; $i++) {',
      '  try {',
      '    Start-Process ' + appExe.replace(/'/g, "''") + ' -WindowStyle Normal',
      '    Write-Output "PS: app launched (attempt $i)"',
      '    break',
      '  } catch {',
      '    Write-Output "PS: attempt $i failed: $_"',
      '    Start-Sleep -Seconds 3',
      '  }',
      '}',
      'Remove-Item ' + exePath.replace(/'/g, "''") + ' -ErrorAction SilentlyContinue',
      'Remove-Item $PSCommandPath -ErrorAction SilentlyContinue',
      'Write-Output "PS: done"'
    ].join('\r\n');
    fs.writeFileSync(psPath, psScript, 'utf8');
    dbg('update script written: ' + psPath);

    // Launch PowerShell with hidden window, bypass execution policy
    const child = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', psPath
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    child.on('error', err => dbg('powershell spawn error: ' + err.message));

    // Give wscript a moment to start, then quit
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
    const currentVer = getCurrentVer();
    dbg('current=' + currentVer);
    let latestVer = null;
    // Primary: GitHub API (always accurate)
    try {
      const { status, body } = await httpsGet('https://api.github.com/repos/mimets/Clock/releases/latest');
      if (status === 200) {
        const release = JSON.parse(body);
        const tag = (release.tag_name || '').replace(/^v/, '');
        if (/^\d+\.\d+\.\d+$/.test(tag)) latestVer = tag;
      }
    } catch (_) {}
    // Fallback: raw version.txt (no rate limit, may be stale from CDN)
    if (!latestVer) {
      try {
        const { status: s, body: b } = await httpsGet('https://raw.githubusercontent.com/mimets/Clock/master/version.txt');
        if (s === 200) { const lv = b.trim(); if (/^\d+\.\d+\.\d+$/.test(lv)) latestVer = lv; }
      } catch (_) {}
    }
    if (!latestVer) { send('update-error', { message: 'Impossibile determinare ultima versione' }); return; }
    dbg('latest=' + latestVer);
    if (verGt(latestVer, currentVer)) { updateVersion = latestVer; dbg('update available: ' + latestVer); doUpdate(); }
    else { dbg('up to date'); send('update-none', { version: currentVer }); }
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

ipcMain.handle('delete-message', async (_e, messageId, username) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: getDbPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    await c.query('DELETE FROM messages WHERE id = $1 AND username = $2', [messageId, username]);
    await c.query('DELETE FROM message_likes WHERE message_id = $1', [messageId]);
    await c.query('DELETE FROM message_reactions WHERE message_id = $1', [messageId]);
    await c.end();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-user', async (_e, targetUsername) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: getDbPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    await c.query('DELETE FROM users WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM configs WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM leaderboard WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM messages WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM message_likes WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM message_reactions WHERE username = $1', [targetUsername]);
    await c.query('DELETE FROM follows WHERE follower = $1 OR following = $1', [targetUsername]);
    await c.query('DELETE FROM notifications WHERE username = $1 OR from_user = $1', [targetUsername]);
    await c.end();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('add-reaction', async (_e, messageId, username, reaction) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: getDbPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    await c.query('INSERT INTO message_reactions (message_id, username, reaction) VALUES ($1, $2, $3)', [messageId, username, reaction]);
    await c.end();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-typing', async (_e, channelId, username) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: getDbPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    await c.query('INSERT INTO typing_events (channel_id, username, last_typing_at) VALUES ($1, $2, now()) ON CONFLICT (channel_id, username) DO UPDATE SET last_typing_at = now()', [channelId, username]);
    await c.end();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-typing-users', async (_e, channelId) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: getDbPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    const res = await c.query('SELECT username FROM typing_events WHERE channel_id = $1 AND last_typing_at > now() - interval \'3 seconds\'', [channelId]);
    await c.end();
    return res.rows.map(r => r.username);
  } catch(e) {
    return [];
  }
});

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
CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS configs (username TEXT PRIMARY KEY REFERENCES users(username), config JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS leaderboard (username TEXT PRIMARY KEY REFERENCES users(username), completed_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS messages (id bigint generated by default as identity primary key, created_at timestamp with time zone default now(), username text not null, content text not null, conversation_id text);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id text;
CREATE TABLE IF NOT EXISTS message_likes (id bigint generated by default as identity primary key, created_at timestamp with time zone default now(), message_id text not null, username text not null);
CREATE TABLE IF NOT EXISTS follows (id bigint generated by default as identity primary key, created_at timestamp with time zone default now(), follower text not null, following text not null);
  CREATE TABLE IF NOT EXISTS notifications (id bigint generated by default as identity primary key, created_at timestamp with time zone default now(), username text not null, type text not null, from_user text not null, message text default '', reference_id text default '', read boolean default false);
  CREATE TABLE IF NOT EXISTS message_reactions (id bigint generated by default as identity primary key, created_at timestamp with time zone default now(), message_id text not null, username text not null, reaction text not null);
  CREATE TABLE IF NOT EXISTS typing_events (channel_id text not null, username text not null, last_typing_at timestamp with time zone default now(), PRIMARY KEY (channel_id, username));
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON messages;
DROP POLICY IF EXISTS "anon_all" ON message_likes;
DROP POLICY IF EXISTS "anon_all" ON follows;
DROP POLICY IF EXISTS "anon_all" ON notifications;
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_users" ON users FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_insert_configs" ON configs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_configs" ON configs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_configs" ON configs FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_insert_leaderboard" ON leaderboard FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_leaderboard" ON leaderboard FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_leaderboard" ON leaderboard FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON message_likes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON follows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON notifications FOR ALL USING (true) WITH CHECK (true);
`.trim();

function getDbPassword() {
  try {
    const p = path.join(app.getPath('userData'), 'db_pass.enc');
    if (fs.existsSync(p) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(p);
      return safeStorage.decryptString(buf);
    }
    const old = path.join(app.getPath('userData'), 'db_pass.txt');
    if (fs.existsSync(old)) return fs.readFileSync(old, 'utf8').trim();
  } catch(_) {}
  // Hardcoded fallback — setup automatico, nessun prompt richiesto
  return 'Fede2009@123';
}

function saveDbPassword(pw) {
  try {
    const enc = path.join(app.getPath('userData'), 'db_pass.enc');
    const txt = path.join(app.getPath('userData'), 'db_pass.txt');
    fs.writeFileSync(txt, pw, 'utf8');
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(enc, safeStorage.encryptString(pw));
    }
  } catch(_) {}
}

ipcMain.handle('check-db-tables', async () => {
  try {
    const pw = getDbPassword();
    if (!pw) return { needsPassword: true, tablesExist: false };
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.akodhogcuowpgndetaca',
      password: pw,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });
    await c.connect();
    // Always run the latest migration (idempotent — IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE POLICY)
    await c.query(MIGRATE_SQL);
    await c.end();
    // Save password for future runs (so hardcoded fallback is only needed on first install)
    saveDbPassword(pw);
    return { needsPassword: false, tablesExist: true };
  } catch(e) {
    return { needsPassword: !getDbPassword(), tablesExist: false, error: e.message };
  }
});

ipcMain.handle('migrate-db', async (_e, pw) => {
  try {
    const { Client } = require('pg');
    const c = new Client({
      host: 'aws-0-eu-west-1.pooler.supabase.com',
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
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('set-auto-start', async () => {
    try { app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') }); return true; } catch(e) { return false; }
  });
  ipcMain.on('check-updates', () => checkForUpdates());
  createWindow();
  setTimeout(checkForUpdates, 3000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
