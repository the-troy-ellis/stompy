// Stompy on the Steam Deck (docs/specs/40-steam-deck.md): the built game
// (../dist, copied to ./game) in its own window, full screen, with no browser
// around it. The game itself doesn't know: it is the same page as on the web.
//
// The page is served from a scheme of its own, stompy://game/, rather than
// file://, so ES modules, the ground's worker and fetch() behave as they do
// over http, and saves (localStorage) live in one origin that never changes.
const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GAME = path.join(__dirname, 'game');
const START = 'stompy://game/index.html';

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
  const win = new BrowserWindow({
    width: 1280, height: 800, fullscreen: !process.env.STOMPY_WINDOWED, backgroundColor: '#000000', show: false, title: 'Stompy',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // F11 toggles full screen; nothing else is taken from the game's keys.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links out of the game (there are none yet) don't open inside it.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('stompy://game/')) e.preventDefault(); });
  win.loadURL(START + (process.env.STOMPY_QUERY ? `?${process.env.STOMPY_QUERY}` : ''));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('stompy', serve);
  open();
});
app.on('window-all-closed', () => app.quit());
