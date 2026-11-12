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
const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
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
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
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
}

app.on('child-process-gone', (e, d) => log('child process gone', d.type, d.reason, d.exitCode));
app.whenReady().then(() => {
  log('ready');
  app.getGPUInfo('basic').then(g => log('gpu', JSON.stringify((g.gpuDevice || []).map(d => [d.vendorId, d.deviceId, d.driverVendor || '', d.driverVersion || '']))), () => {});
  Menu.setApplicationMenu(null);
  protocol.handle('stompy', serve);
  open();
});
app.on('window-all-closed', () => { log('closed'); app.quit(); });
