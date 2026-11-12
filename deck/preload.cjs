// The Steam Deck app's bridge to the page (docs/specs/40-steam-deck.md): only
// what the game's platform layer (src/platform/index.js onShellUpdate) asks
// for. The page gets window.stompyShell and nothing else of Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stompyShell', {
  // `cb()` once the next build is downloaded, checked and in place. Asks at
  // once too, in case it was ready before the page was.
  onUpdateReady(cb) {
    let told = false;
    ipcRenderer.on('update-ready', () => { if (!told) { told = true; cb(); } });
    ipcRenderer.send('update-ask');
  },
  // Start again into the new build.
  restart() { ipcRenderer.send('restart'); },
});
