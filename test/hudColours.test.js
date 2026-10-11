import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUD_PALETTES, hudPalette } from '../src/data/colors.js';
import { SETTINGS, HUD_SCALES, COLOUR_NAMES } from '../src/data/settings.js';

// COLOURS (#229, spec 11 § Accessibility, acceptance 4): each mode's fine /
// warning / bad / gone colours stay apart when simulated through the colour
// blindness it is for (Machado, Oliveira and Fernandes 2009, full severity),
// measured as CIELAB distance.
const CVD = {
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const hex = c => { const s = c.replace('#', ''), f = s.length === 3 ? [...s].map(d => d + d).join('') : s; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };
const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const sim = (rgb, m) => { const l = rgb.map(lin); return m.map(row => gam(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])))); };
function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116), fx = f(X / 0.9505), fy = f(Y), fz = f(Z / 1.089);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const apart = (cols, m) => { const s = cols.map(c => sim(hex(c), m)); let min = Infinity; for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) min = Math.min(min, dE(s[i], s[j])); return min; };
const states = p => [p.good, p.warn, p.bad, p.hp[3]];
const MIN = 25;

test('each colour mode keeps heat, armour and the radar apart for the eyes it is for', () => {
  for (const key of ['deutan', 'protan', 'tritan']) {
    const p = HUD_PALETTES.find(q => q.key === key);
    const d = apart(states(p), CVD[key]), h = apart(p.hp, CVD[key]);
    assert.ok(d >= MIN, `${key}: fine/warning/bad/gone ${d.toFixed(1)} apart`);
    assert.ok(h >= MIN, `${key}: armour levels ${h.toFixed(1)} apart`);
  }
});

test('the normal colours are the ones the HUD always had, and are why the modes exist', () => {
  const n = hudPalette(0);
  assert.deepEqual([n.good, n.warn, n.bad, n.dim], ['#5f5', '#fc3', '#f44', '#2a7a2a']);
  assert.ok(apart(states(n), CVD.protan) < MIN, 'red-green blind, the normal set runs together');
  assert.equal(hudPalette(99), n, 'an unknown mode is normal');
});

test('HUD SCALE and COLOURS are dials over their lists', () => {
  assert.deepEqual(HUD_SCALES, [0.8, 1, 1.25, 1.5]);
  assert.equal(SETTINGS.hudScale.fmt(SETTINGS.hudScale.def), '1x');
  assert.equal(SETTINGS.hudScale.max, HUD_SCALES.length - 1);
  assert.deepEqual(COLOUR_NAMES, HUD_PALETTES.map(p => p.label));
  assert.equal(SETTINGS.colourMode.fmt(0), 'NORMAL');
});
