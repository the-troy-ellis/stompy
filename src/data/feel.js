// The feel table: every camera, body and sound response to an event, in one
// place (docs/specs/13-thunk.md). Nothing in the sim or renderer hardcodes a
// shake amount; it calls feel(G, event, { mech, k }) and the row decides.
//
// Columns, each multiplied by the event's intensity k:
//   kick    dashboard / eye drop (G.kick, max with the current value)
//   shake   camera jitter (G.shake, added, capped at view.shakeMax)
//   flash   red damage flash (G.flash, added, capped at view.flashMax)
//   white   white-out (G.whiteFlash, max)
//   squash  body squash pulse on the mech (spring impulse)
//   wobble  torso / view angular wobble on the mech (spring impulse, radians-ish)
//   bass    sub-bass thump gain
//   duck    how much the reactor hum ducks for a moment
//   dust    particle burst multiplier (used by the event's own particle code)
//   haptic  navigator.vibrate milliseconds on touch
//   push    horizontal impulse on the mech in m/s along the event's direction (recoil, knockback); it decays in about a quarter second
// Rows are plain mutable objects so the ?debug=1 FEEL panel can tune them live.
export const FEEL = {
  // k = 0.35 + 0.65 * pace, scaled by the chassis (scale^2) in footDown
  step:        { kick: 1.0, shake: 0.12, flash: 0, white: 0, squash: 0.03, wobble: 0, bass: 0.4, duck: 0, dust: 1, haptic: 10, push: 0 },
  // Another mech's footfall felt through the ground: k = (1 - d / 40) * scale^2, heavies only
  nearStep:    { kick: 0.15, shake: 0.12, flash: 0, white: 0, squash: 0, wobble: 0.05, bass: 0.3, duck: 0, dust: 0, haptic: 8, push: 0 },
  // k = landing force 0.25..1
  land:        { kick: 1.0, shake: 0.6, flash: 0, white: 0, squash: 0.25, wobble: 0.4, bass: 1.0, duck: 0.3, dust: 3, haptic: 40, push: 0 },
  // k = 1 per shot (the player's own weapons)
  fireAc:      { kick: 0.5, shake: 0.2, flash: 0, white: 0, squash: 0, wobble: 0.3, bass: 0.6, duck: 0, dust: 0, haptic: 20, push: 0.6 },   // 0.6 m/s decays to a 0.15 m step back
  fireLrm:     { kick: 0.3, shake: 0.3, flash: 0, white: 0, squash: 0, wobble: 0.15, bass: 0.5, duck: 0, dust: 2, haptic: 20, push: 0.2 },
  // k = damage / 10
  hit:         { kick: 0.3, shake: 0.5, flash: 0.4, white: 0, squash: 0, wobble: 0.6, bass: 0.5, duck: 0.2, dust: 0, haptic: 30, push: 0 },
  // sag: how far the hips drop (metres x scale) while the reactor is down; the spring below sets the 0.6 s.
  shutdown:    { kick: 0, shake: 0, flash: 0, white: 0, squash: 0, wobble: 0, bass: 0.6, duck: 0.8, dust: 0, haptic: 0, push: 0, sag: 0.4 },
  // overshoot: how far past standing height the restart snaps (metres x scale) before settling.
  restart:     { kick: 0.3, shake: 0.1, flash: 0, white: 0, squash: 0.1, wobble: 0.3, bass: 0.4, duck: 0, dust: 0, haptic: 20, push: 0, overshoot: 0.1 },
  sectionLost: { kick: 0.5, shake: 0.8, flash: 0, white: 0, squash: 0, wobble: 0.9, bass: 0.8, duck: 0.3, dust: 1, haptic: 50, push: 0 },
  // the player's own mech going down
  death:       { kick: 1.0, shake: 1.5, flash: 0, white: 0, squash: 0, wobble: 0, bass: 1.2, duck: 1.0, dust: 0, haptic: 100, push: 0 },
  // k = (big ? 1 : 0.35) * (1 - distance / 220)
  explosion:   { kick: 0, shake: 1.0, flash: 0, white: 0, squash: 0, wobble: 0.3, bass: 0.9, duck: 0.3, dust: 0, haptic: 30, push: 0 },
  // the fusion discharge: the frame shakes, the screen whites out, the feedback hurts
  fusionFire:  { kick: 0.6, shake: 1.2, flash: 0.4, white: 0.7, squash: 0.1, wobble: 0.8, bass: 1.2, duck: 1.0, dust: 0, haptic: 80, push: 0 },
  // How the view reads the springs and caps.
  view: { wobble: 0.6, shakeMax: 1.2, flashMax: 0.6, reducedScale: 0.3 },   // reducedScale: REDUCED MOTION's multiplier on the camera columns
  // Spring stiffness and damping ratio for the body springs.
  spring: { squashK: 160, squashZeta: 0.7, wobbleK: 90, wobbleZeta: 0.35, sagK: 45, sagZeta: 1 },
};
export const FEEL_EVENTS = Object.keys(FEEL).filter(k => k !== 'view' && k !== 'spring');
export const FEEL_COLS = ['kick', 'shake', 'flash', 'white', 'squash', 'wobble', 'bass', 'duck', 'dust', 'haptic', 'push'];
