// A gamepad in the standard mapping (docs/specs/11-release.md § Gamepad),
// read into the same per-frame snapshot as the keyboard, mouse and touch.
// Pure: `readPad` takes anything shaped like a Gamepad ({ buttons, axes }) and
// the buttons held last frame, so the mapping is tested headlessly
// (test/gamepad.test.js); input.js does the polling.
//
//   Left stick   legs (sideways) and throttle (up and down), like A/D and W/S
//   Right stick  torso twist and pitch (and steers guided missiles)
//   RT energy · LT missiles (tap, or hold to fly) · RB ballistic · LB fusion
//   A jump · B centre torso · X next target · Y zoom · right stick click punch
//   D-pad up lights · D-pad down stop · Start pause · Back pause (the menu is on it)
const { abs, hypot, min, sign } = Math;

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export const DEAD = 0.2;   // of a stick's travel: worn sticks rest off centre
const TRIGGER = 0.35;      // an analog trigger counts as pulled past this

// A stick with a round deadzone, rescaled so just past it is just above zero.
export function stick(x, y) {
  const m = hypot(x, y);
  if (!(m > DEAD)) return [0, 0];
  const k = min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}
// Aim wants fine control near the centre and speed at the edge.
const curve = v => sign(v) * v * v;

const down = (gp, i) => { const b = gp.buttons?.[i]; return !!b && (b.pressed || b.value > TRIGGER); };

// One frame of the pad: what is held (`held`, for next frame's presses), the
// analog part of the snapshot (`axes`), what is held down for the sim
// (`hold`), and what was pressed this frame (`press`). `active`: anything at
// all moved or was pressed, so the touch UI can step aside.
export function readPad(gp, before = []) {
  const held = Object.values(PAD).map(i => down(gp, i));
  const press = name => held[PAD[name]] && !before[PAD[name]];
  const [lx, ly] = stick(+gp.axes?.[0] || 0, +gp.axes?.[1] || 0);
  const [rx, ry] = stick(+gp.axes?.[2] || 0, +gp.axes?.[3] || 0);
  const axes = { turn: -lx, thr: -ly, twist: -curve(rx), pitch: -curve(ry) };
  const hold = {
    energy: held[PAD.RT], missile: held[PAD.LT], ballistic: held[PAD.RB], fusion: held[PAD.LB],
    jets: held[PAD.A], centre: held[PAD.B],
  };
  const pressed = {
    missile: press('LT'), target: press('X'), zoom: press('Y'), punch: press('RS'), lights: press('UP'), stop: press('DOWN'),
    start: press('START'), back: press('BACK'),
    // Menus: the D-pad (or the left stick, see input.js) moves, A presses, B goes back.
    a: press('A'), b: press('B'), up: press('UP'), down: press('DOWN'), left: press('LEFT'), right: press('RIGHT'),
  };
  const active = held.some(Boolean) || [lx, ly, rx, ry].some(v => abs(v) > 0);
  return { held, axes, hold, pressed, active };
}

// The first pad the browser has that uses the standard mapping (or any, failing that).
export function firstPad(pads) {
  const list = [...(pads || [])].filter(p => p && p.connected !== false);
  return list.find(p => p.mapping === 'standard') || list[0] || null;
}
