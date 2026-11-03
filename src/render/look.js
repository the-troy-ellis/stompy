// The look's tunable resolution (docs/specs/14-look-and-performance.md § The
// look 6): the 3D view can render `lines` pixels tall, the width following the
// screen's shape, and is scaled up with hard edges (CSS `pixelated`), while
// the HUD canvas stays at full resolution. `lines: 0` is native resolution.
// `aa` is the GL context's antialiasing, fixed when the context is made, so
// changing it takes a reload. PIXELS in Settings picks the lines (P5,
// data/settings.js PIXEL_LINES); ?debug=1's LOOK row can still set any count
// by hand, so the owner can settle the final number by eye.
import { PIXEL_LINES } from '../data/settings.js';
export const LOOK_DEFAULT = { lines: PIXEL_LINES[2], aa: true };   // CRISP (data/settings.js PIXELS default)
// The look for a PIXELS step: hard pixels have no antialiasing; CRISP has it
// (from the next load, as the context is made once).
export const lookOf = pixels => { const lines = PIXEL_LINES[pixels] ?? PIXEL_LINES[2]; return { lines, aa: lines === 0 }; };
export const LOOK_PRESETS = [0, 480, 360, 300, 240, 200, 160, 120];
export const LOOK_KEY = 'dev.look';

// The GL canvas's backing size for a CSS size, device pixel ratio and line
// count. Never more than native, never less than one pixel.
export function backingSize(cssW, cssH, dpr, lines) {
  const nw = Math.max(1, Math.floor(cssW * dpr)), nh = Math.max(1, Math.floor(cssH * dpr));
  if (!lines || lines >= nh) return [nw, nh];
  const h = Math.max(1, Math.round(lines));
  return [Math.max(1, Math.round(cssW * h / Math.max(1, cssH))), h];
}

// Saved settings, overridden by the URL (?lines=240&aa=0) so a look can be shared.
export function readLook(params, saved, base = LOOK_DEFAULT) {
  const look = { ...base, ...(saved || {}) };
  if (params.has('lines')) look.lines = Math.max(0, parseInt(params.get('lines'), 10) || 0);
  if (params.has('aa')) look.aa = params.get('aa') !== '0';
  return look;
}

// A phone that can't hold its frame (spec 14 P5): fed each frame's dt while
// playing, it answers true once, the first time a stretch of SLOW.secs
// averages slower than SLOW.ms a frame, so PARTICLES can step down a notch.
// Never again after that; the pixels are never touched.
export const SLOW = { ms: 40, secs: 5 };
export function slowWatch(S = SLOW) {
  let t = 0, n = 0, done = false;
  return dt => {
    if (done || !(dt > 0)) return false;
    t += dt; n++;
    if (t < S.secs) return false;
    const slow = t / n * 1000 > S.ms;
    t = 0; n = 0;
    return (done = slow);
  };
}
