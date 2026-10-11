// The service worker's page side (docs/specs/11-release.md § PWA). Only the
// built game registers it (the build defines __PWA__), and only where a
// browser allows one: https, or localhost. `onUpdate(apply)` is called when a
// new version is waiting; `apply()` swaps it in and reloads.
/* global __PWA__ */
export function registerServiceWorker(onUpdate) {
  const sw = navigator.serviceWorker;
  if (typeof __PWA__ === 'undefined' || !sw) return;
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  let swapping = false;
  sw.addEventListener('controllerchange', () => { if (swapping) location.reload(); });
  sw.register('sw.js').then(reg => {
    const ready = () => {
      if (!reg.waiting || !sw.controller) return;   // the first install has nothing to replace
      onUpdate(() => { swapping = true; reg.waiting.postMessage('skip'); });
    };
    ready();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') ready(); });
    });
  }).catch(() => {});
}
