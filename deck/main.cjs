// Stompy on the Steam Deck (docs/specs/40-steam-deck.md): the built game
// (../dist, copied to ./game) in its own window, full screen, with no browser
// around it. The game itself doesn't know: it is the same page as on the web.
//
// The page is served from a scheme of its own, stompy://game/, rather than
// file://, so ES modules, the ground's worker and fetch() behave as they do
// over http, and saves (localStorage) live in one origin that never changes.
//
// The packaged app starts through a launcher script (afterPack.cjs) that
// picks X11 under gamescope and the sandbox the Deck allows; this file logs
// what happens next to ~/.config/Stompy/stompy.log, next to the launcher's
// own lines, so a launch that hangs on the Deck says why.
//
// It also keeps itself up to date (update(), below): the owner shouldn't have
// to go to Desktop Mode to install each build.
const { app, BrowserWindow, Menu, ipcMain, net, protocol } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

const GAME = path.join(__dirname, 'game');
const START = 'stompy://game/index.html';

let logFile = null;
function log(...parts) {
  const line = `${new Date().toISOString()} main: ${parts.join(' ')}\n`;
  try {
    if (!logFile) { const dir = app.getPath('userData'); fs.mkdirSync(dir, { recursive: true }); logFile = path.join(dir, 'stompy.log'); }
    fs.appendFileSync(logFile, line);
  } catch { /* no log is no reason not to play */ }
  if (process.env.STOMPY_LOG_STDOUT) process.stdout.write(line);
}
process.on('uncaughtException', e => { log('uncaught', e?.stack || e); });

log('start', `electron ${process.versions.electron}`, `chrome ${process.versions.chrome}`, `argv ${process.argv.slice(1).join(' ') || '-'}`);
log('env', ['XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DISPLAY', 'WAYLAND_DISPLAY', 'SteamGameId', 'SteamDeck', 'gamescope'].map(k => `${k}=${process.env[k] ?? ''}`).join(' '));

protocol.registerSchemesAsPrivileged([{ scheme: 'stompy', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Sound from the first frame: a controller's press isn't a gesture to
// Chromium, and on the Deck there may be no other kind.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function serve(req) {
  const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(GAME, rel));
  if (file !== GAME && !file.startsWith(GAME + path.sep)) return new Response('no', { status: 403 });   // nothing outside the game
  return net.fetch(pathToFileURL(file).toString());
}

function open() {
  // Shown at once, black, not on 'ready-to-show': under gamescope a window
  // that waits for its first frame and never gets one is a logo spinning
  // forever (the owner's first launch, 2026-11-12).
  const win = new BrowserWindow({
    width: 1280, height: 800, fullscreen: !process.env.STOMPY_WINDOWED, backgroundColor: '#000000', show: true, title: 'Stompy',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  log('window', `${win.getBounds().width}x${win.getBounds().height}`, win.isFullScreen() ? 'fullscreen' : 'windowed');
  // F11 toggles full screen; nothing else is taken from the game's keys.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links out of the game (there are none yet) don't open inside it.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('stompy://game/')) e.preventDefault(); });
  win.webContents.on('did-finish-load', () => log('page loaded'));
  win.webContents.on('did-fail-load', (e, code, desc, url) => log('page failed', code, desc, url));
  win.webContents.on('render-process-gone', (e, d) => log('page process gone', d.reason, d.exitCode));
  win.webContents.on('unresponsive', () => log('page unresponsive'));
  win.webContents.on('console-message', (e, ...a) => {
    const m = a[0] && typeof a[0] === 'object' ? a[0] : { level: a[0], message: a[1] };   // Electron's newer event object, or the old arguments
    if (m.level === 'error' || m.level === 3 || m.level === 'warning' || m.level === 2) log('page', m.level, m.message);
  });
  win.loadURL(START + (process.env.STOMPY_QUERY ? `?${process.env.STOMPY_QUERY}` : ''));
  return win;
}

// Updating itself. A few seconds after start, in the background: fetch the
// deck-latest release's checksum (deck.yml publishes it on every push to
// main) and compare it with this AppImage's own. If they differ, download the
// new AppImage next to this one while the game runs, check it against the
// checksum, and rename it over this file. Linux lets a running file be
// replaced, and the path doesn't change, so Steam's shortcut and its launch
// options keep working. The page is told (preload.cjs, then the menu's
// UPDATED · RELOAD), and RELOAD restarts into the new build; otherwise the
// next launch is the new build anyway.
//
// Only ever installs a file that matches the release's checksum. No network,
// a 404, a cut-off download, a folder it can't write: it logs why, leaves the
// old file, and plays on. Off outside an AppImage (npm start), and with
// STOMPY_NO_UPDATE=1. STOMPY_UPDATE_URL points it at another release (tests).
const RELEASE = process.env.STOMPY_UPDATE_URL || 'https://github.com/the-troy-ellis/stompy/releases/download/deck-latest';
const ASSET = 'Stompy-x86_64.AppImage';
const UPDATE_AFTER = 5000;   // ms after the window opens: the game loads first
let updated = false;

async function sha256Of(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function update(win) {
  const self = process.env.APPIMAGE;
  if (!self) { log('update: off (not running from an AppImage)'); return; }
  if (process.env.STOMPY_NO_UPDATE) { log('update: off (STOMPY_NO_UPDATE)'); return; }
  const tmp = `${self}.download`;
  try {
    const res = await net.fetch(`${RELEASE}/${ASSET}.sha256`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`checksum ${res.status}`);
    const want = (await res.text()).trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/.test(want)) throw new Error('checksum unreadable');
    const have = await sha256Of(self);
    if (want === have) { log('update: up to date', have.slice(0, 12)); return; }
    log('update: new build', want.slice(0, 12), 'over', have.slice(0, 12), '- downloading');
    const dl = await net.fetch(`${RELEASE}/${ASSET}`, { cache: 'no-store' });
    if (!dl.ok || !dl.body) throw new Error(`download ${dl.status}`);
    const h = crypto.createHash('sha256'), out = fs.createWriteStream(tmp, { mode: 0o755 });
    let bytes = 0;
    for await (const chunk of dl.body) {
      h.update(chunk); bytes += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
    }
    await new Promise((ok, fail) => out.end(e => (e ? fail(e) : ok())));
    const got = h.digest('hex');
    if (got !== want) { fs.rmSync(tmp, { force: true }); log('update: checksum mismatch, discarded', got.slice(0, 12), `${bytes} bytes`); return; }
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, self);
    updated = true;
    log('update: installed', want.slice(0, 12), `${bytes} bytes`);
    if (!win.isDestroyed()) win.webContents.send('update-ready');
  } catch (e) {
    log('update: skipped', e?.message || e);
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to tidy */ }
  }
}

// The page asks whether a build is waiting (it may have been ready before the
// page was), and asks to restart into it.
ipcMain.on('update-ask', e => { if (updated) e.sender.send('update-ready'); });
ipcMain.on('restart', () => {
  const self = process.env.APPIMAGE;
  log('restart into the new build');
  if (self) app.relaunch({ execPath: self, args: process.argv.slice(1) });
  else app.relaunch();
  app.exit(0);
});

app.on('child-process-gone', (e, d) => log('child process gone', d.type, d.reason, d.exitCode));
app.whenReady().then(() => {
  log('ready');
  app.getGPUInfo('basic').then(g => log('gpu', JSON.stringify((g.gpuDevice || []).map(d => [d.vendorId, d.deviceId, d.driverVendor || '', d.driverVersion || '']))), () => {});
  Menu.setApplicationMenu(null);
  protocol.handle('stompy', serve);
  const win = open();
  setTimeout(() => update(win), UPDATE_AFTER);
});
app.on('window-all-closed', () => { log('closed'); app.quit(); });
