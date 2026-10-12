// The stepped settings (roadmap M1): each is a pref with a range, a step and
// a way to print it, and the SETTINGS section it shows in (SETTING_GROUPS).
// The toggles (sound, voice, invert, motion, haptics) and difficulty live in
// the screens; these are the ones with a dial.
export const SETTINGS = {
  mouseSens: { group: 'controls', label: 'MOUSE', key: 'sens.mouse', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  touchSens: { group: 'controls', label: 'TOUCH', key: 'sens.touch', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  padSens: { group: 'controls', label: 'GAMEPAD', key: 'sens.pad', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  // FOV is stored and stepped as the vertical angle (62 is the old 1.08 rad), and
  // shown as the horizontal one on this screen's shape (spec 11: about 100 on a phone).
  fov: { group: 'display', label: 'FOV', key: 'view.fov', min: 50, max: 95, step: 5, def: 62, fmt: (v, aspect = 16 / 9) => `${hfov(v, aspect)}\u00b0` },
  voiceRate: { group: 'sound', label: 'VOICE RATE', key: 'voice.rate', min: 0.7, max: 1.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },   // times the voice's own 1.05
  voiceVol: { group: 'sound', label: 'VOICE VOL', key: 'voice.vol', min: 0, max: 1, step: 0.1, def: 0.9, fmt: v => `${Math.round(v * 100)}%` },
  // How many particles (spec 07): LOW / MED / HIGH. Unset, MED on touch and HIGH on a desktop (main.js).
  particles: { group: 'display', label: 'PARTICLES', key: 'fx.particles', min: 0, max: 2, step: 1, def: 2, fmt: v => PARTICLE_NAMES[v] },
  // The HUD's size (HUD_SCALES) and its colour set (data/colors.js HUD_PALETTES), spec 11 § Accessibility.
  hudScale: { group: 'display', label: 'HUD SCALE', key: 'hud.scale', min: 0, max: 3, step: 1, def: 1, fmt: v => `${HUD_SCALES[v]}x` },
  colourMode: { group: 'display', label: 'COLOURS', key: 'hud.colours', min: 0, max: 3, step: 1, def: 0, fmt: v => COLOUR_NAMES[v] },
};
export const PARTICLE_NAMES = ['LOW', 'MED', 'HIGH'];
// The SETTINGS screen's sections, in order (ui/screens.js adds the toggles to them).
export const SETTING_GROUPS = [['sound', 'SOUND'], ['controls', 'CONTROLS'], ['display', 'DISPLAY'], ['game', 'GAME']];
// A vertical field of view in degrees as the horizontal one on a screen this wide over high.
export const hfov = (v, aspect) => Math.round(2 * Math.atan(Math.tan(v * Math.PI / 360) * aspect) * 180 / Math.PI);
export const HUD_SCALES = [0.8, 1, 1.25, 1.5];
export const COLOUR_NAMES = ['NORMAL', 'DEUTAN', 'PROTAN', 'TRITAN'];
// What each PARTICLES level keeps: the share of weather particles (LOW: none)
// and of gameplay effects (sparks, smoke, fire, dust). REDUCED MOTION takes
// it down a step. The sim and renderer read the result off the game state.
export const PARTICLE_SCALE = { weather: [0, 0.6, 1], effects: [0.5, 0.75, 1] };
export function particleScales(level, reduced = false) {
  const l = Math.max(0, Math.min(2, Math.round(level) - (reduced ? 1 : 0)));
  return { weatherScale: PARTICLE_SCALE.weather[l], effectScale: PARTICLE_SCALE.effects[l] };
}
export const SETTING_KEYS = Object.keys(SETTINGS);

// A stored value, clamped to the range (or the default when missing or junk).
export function readSetting(name, raw) {
  const s = SETTINGS[name], v = +raw;
  return Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.def;
}
// One click of the dial, rounded so 0.1 + 0.1 + 0.1 prints as 0.3.
export function stepSetting(name, v, d) {
  const s = SETTINGS[name];
  return Math.min(s.max, Math.max(s.min, +(v + d * s.step).toFixed(6)));
}
