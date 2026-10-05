// The look's tunable resolution (docs/specs/14-look-and-performance.md § The
// look 6): the 3D view can render `lines` pixels tall, the width following the
// screen's shape, and is scaled up with hard edges (CSS `pixelated`), while
// the HUD canvas stays at full resolution. `lines: 0` is native resolution.
// `aa` is the GL context's antialiasing, fixed when the context is made, so
// changing it takes a reload. For now this is a ?debug=1 tool, so the owner
// can settle the final look by hand; the PIXELS setting comes after (P5).
export const LOOK_DEFAULT = { lines: 0, aa: true };
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
export function readLook(params, saved) {
  const look = { ...LOOK_DEFAULT, ...(saved || {}) };
  if (params.has('lines')) look.lines = Math.max(0, parseInt(params.get('lines'), 10) || 0);
  if (params.has('aa')) look.aa = params.get('aa') !== '0';
  return look;
}
