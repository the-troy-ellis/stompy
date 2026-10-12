// The stepped settings (roadmap M1): each is a pref with a range, a step and
// a way to print it. The toggles (sound, voice, invert, motion, haptics) and
// difficulty live in the screens; these are the ones with a dial.
export const SETTINGS = {
  mouseSens: { label: 'MOUSE', key: 'sens.mouse', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  touchSens: { label: 'TOUCH', key: 'sens.touch', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  padSens: { label: 'GAMEPAD', key: 'sens.pad', min: 0.3, max: 2.5, step: 0.1, def: 1, fmt: v => `${v.toFixed(1)}x` },
  fov: { label: 'FOV', key: 'view.fov', min: 50, max: 95, step: 5, def: 62, fmt: v => `${v}\u00b0` },
  voiceVol: { label: 'VOICE VOL', key: 'voice.vol', min: 0, max: 1, step: 0.1, def: 0.9, fmt: v => `${Math.round(v * 100)}%` },
  // How many particles (spec 07): LOW / MED / HIGH. Unset, MED on touch and HIGH on a desktop (main.js).
  particles: { label: 'PARTICLES', key: 'fx.particles', min: 0, max: 2, step: 1, def: 2, fmt: v => PARTICLE_NAMES[v] },
};
export const PARTICLE_NAMES = ['LOW', 'MED', 'HIGH'];
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
