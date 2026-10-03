import { $ } from '../util/dom.js';
import { store } from '../util/store.js';
import { msg } from '../sim/effects.js';
import { clampN } from '../util/math.js';
import { CATS, CAT_OF } from '../data/weapons.js';
import { steerBy, alpha, cycleTarget } from '../sim/missiles.js';

const { abs, hypot } = Math;

// Keyboard, mouse (with pointer lock) and touch (a floating stick, aim drag,
// hold-to-fire buttons, one finger each) all feed one per-frame snapshot
// that the sim reads. Menu navigation keys are routed to the screens.
export function createInput(app) {
  const G = app.G, prefs = app.prefs, root = app.root, wrap = app.wrap, cv = app.cv;
  const self = {};
  const keys = {};
  // Which fire controls are held: by touch button, mouse button or key.
  const held = { energy: false, ballistic: false, missile: false, fusion: false };
  const clearHeld = () => { for (const c of CATS) held[c] = false; };
  const KEY_FOR = { energy: ['Digit1'], ballistic: ['Digit2'], missile: ['Digit3', 'Space'], fusion: ['Digit4', 'KeyG'] };
  const isHeld = c => held[c] || KEY_FOR[c].some(k => keys[k]);
  // A missile press is latched until the next frame sees it, so a tap
  // shorter than a frame (a slow phone, a quick thumb) still fires.
  let missileTap = false;
  let punchTap = false;   // a press, consumed by the next snapshot

  // Only show fire buttons for the kinds of weapon this mech carries.
  function syncWeaponButtons() {
    for (const c of CATS) {
      const btn = $(`[data-t="${c}"]`, tui);
      if (btn) btn.hidden = !G.player.weapons.some(w => CAT_OF[w.type] === c);
    }
  }


  const lockPointer = () => { if (G.touchUI) return; try { const r = cv.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* fall back to arrows */ } };
  const exitLock = () => { if (document.pointerLockElement === cv) document.exitPointerLock(); };
  const locked = () => document.pointerLockElement === cv;
  let hadLock = false;
  const onLockChange = () => {
    if (locked()) hadLock = true;
    else if (hadLock && G.state === 'play' && !G.paused) app.ui.pause(true);
  };
  document.addEventListener('pointerlockchange', onLockChange);

  const onMouseMove = e => {
    if (G.state !== 'play' || G.paused || !G.player.alive) return;
    if (!locked()) return;
    if (G.guide) { steerBy(G, e.movementX, e.movementY, 0.0028 * prefs.mouseSens, prefs.invert); return; }
    const sens = (G.zoom ? 0.0009 : 0.0024) * prefs.mouseSens;
    const P = G.player;
    P.twist = clampN(P.twist - e.movementX * sens, -1.9, 1.9);
    P.pitch = clampN(P.pitch - e.movementY * sens * (prefs.invert ? -1 : 1), -0.4, 0.45);
  };
  document.addEventListener('mousemove', onMouseMove);

  wrap.addEventListener('contextmenu', e => e.preventDefault());
  cv.parentElement.addEventListener('mousedown', e => {
    if (e.target.closest('.mech-overlay') || G.touchUI) return;
    wrap.focus();
    app.audio.Sound.unlock();
    app.audio.loadSamples();
    if (G.state !== 'play' || G.paused) return;
    if (!locked()) { lockPointer(); return; }
    const cat = { 0: 'energy', 2: 'ballistic', 1: 'missile' }[e.button];
    if (cat) { held[cat] = true; e.preventDefault(); if (cat === 'missile') missileTap = true; }
    if (e.button === 3) { punchTap = true; e.preventDefault(); }   // the back button: a punch
  });
  addEventListener('mouseup', e => {
    const cat = { 0: 'energy', 2: 'ballistic', 1: 'missile' }[e.button];
    if (cat && !G.touchUI) held[cat] = false;
  });

  const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyC', 'KeyJ', 'KeyT', 'KeyR', 'KeyF', 'KeyZ', 'KeyP', 'KeyE', 'Space',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyG', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  // Keys are taken at the document: hiding the overlay drops focus to <body>,
  // and pointer lock doesn't move it back.
  const onKeyDown = e => {
    if (e.target.closest?.('input')) { if (e.key === 'Enter' && G.state === 'menu') { e.preventDefault(); app.ui.go(); } return; }
    if (e.key === 'F2') { e.preventDefault(); exitLock(); if (app.net.mp()) app.net.leaveArena(); else app.ui.mainMenu(); return; }
    if (e.code === 'KeyM') { app.ui.OPTS.sound[2](!prefs.sound); msg(G, prefs.sound ? 'SOUND ON' : 'SOUND OFF'); return; }
    if (G.state === 'menu') {
      if (app.mechlab.fit.open) { app.mechlab.key(e); return; }
      const i = app.ui.MENU.findIndex(([k]) => k === prefs.menuSel);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = app.ui.MENU[(i + (e.key === 'ArrowDown' ? 1 : -1) + app.ui.MENU.length) % app.ui.MENU.length][0];
        const wasMp = prefs.menuSel === 'mp'; prefs.menuSel = next; store.set('menu.sel', next);
        if (wasMp !== (next === 'mp')) app.ui.showMech();
        app.ui.renderMenu();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); app.ui.cycleMech(e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); app.ui.go(); }
      return;
    }
    if (G.state !== 'play') return;
    // Esc only ever pauses: leaving pointer lock already pauses via
    // pointerlockchange, and a toggle here would immediately undo that.
    if (e.code === 'Escape') { e.preventDefault(); if (!G.paused) app.ui.pause(true); return; }
    if (e.code === 'KeyP') { e.preventDefault(); app.ui.pause(!G.paused); return; }
    if (G.paused || !GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat && keys[e.code]) return;
    keys[e.code] = true;
    if (KEY_FOR.missile.includes(e.code)) missileTap = true;
    if (e.code === 'KeyT') cycleTarget(G);
    if (e.code === 'KeyE') punchTap = true;
    if (e.code === 'KeyR' && G.aimMech && G.aimMech.team !== 0) { G.target = G.aimMech; app.audio.sfx.beep(); }
    if (e.code === 'KeyF') alpha(G);
    if (e.code === 'KeyZ') G.zoom = !G.zoom;
  };
  const onKeyUp = e => { keys[e.code] = false; };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  /* ---------- touch ---------- */

  // Left 40% of the screen: a floating stick that appears under the thumb.
  // Sideways turns the legs; up/down moves the throttle from wherever it was
  // when the thumb went down (so steering doesn't reset your speed), and the
  // throttle stays set on release, like W/S. Anywhere else: drag to aim.
  // Buttons handle themselves. Every finger is tracked separately.
  const tui = $('.touch-ui', root), stick = $('.stick', tui), knob = $('.knob', tui);
  const fingers = new Map();
  const STICK_R = 56;
  const syncTouchUI = () => {
    tui.hidden = !(G.touchUI && (G.state === 'play' || G.state === 'over') && !G.paused);
    const jump = root.querySelector('[data-t="jump"]');
    if (jump) jump.hidden = G.player?.jets === 0;   // JUMP JETS NONE: no button
    if (tui.hidden) releaseFingers();
  };
  function releaseFingers() {
    for (const f of fingers.values()) if (f.kind === 'btn') touchButton(f.name, false, f.el);
    fingers.clear();
    G.touchTurn = 0; stick.hidden = true;
  }
  function touchButton(name, down, el) {
    el?.classList.toggle('on', down);
    if (CATS.includes(name)) { held[name] = down; if (down && name === 'missile') missileTap = true; }
    else if (name === 'jump') keys.KeyJ = down;
    if (!down) return;
    if (name === 'punch') punchTap = true;
    if (name === 'tgt') cycleTarget(G);
    else if (name === 'zoom') G.zoom = !G.zoom;
    else if (name === 'stop') G.player.throttle = 0;
    else if (name === 'pause') app.ui.pause(true);
  }
  // Stop the browser turning touches into scrolls, zooms and fake mouse clicks.
  tui.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  tui.addEventListener('pointerdown', e => {
    e.preventDefault();
    app.audio.Sound.unlock(); app.audio.loadSamples();
    tui.setPointerCapture?.(e.pointerId);
    const b = e.target.closest('[data-t]');
    if (b) { fingers.set(e.pointerId, { kind: 'btn', name: b.dataset.t, el: b, lx: e.clientX, ly: e.clientY }); touchButton(b.dataset.t, true, b); return; }
    const r = tui.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const haveStick = [...fingers.values()].some(f => f.kind === 'stick');
    if (x < r.width * 0.4 && !haveStick) {
      fingers.set(e.pointerId, { kind: 'stick', x0: x, y0: y, thr0: G.player.throttle });
      stick.hidden = false;
      stick.style.left = x + 'px'; stick.style.top = y + 'px';
      knob.style.transform = 'translate(-50%, -50%)';
    } else fingers.set(e.pointerId, { kind: 'aim', lx: e.clientX, ly: e.clientY });
  });
  tui.addEventListener('pointermove', e => {
    const f = fingers.get(e.pointerId);
    if (!f || G.state !== 'play' || G.paused) return;
    const P = G.player;
    if (f.kind === 'stick') {
      const r = tui.getBoundingClientRect();
      let dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
      const d = hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = v => (abs(v) < 8 ? 0 : v - Math.sign(v) * 8);
      G.touchTurn = clampN(-dead(dx) / (STICK_R - 8), -1, 1);
      if (P.alive && !P.shutdown) P.throttle = clampN(f.thr0 - dead(dy) / (STICK_R - 8), -0.35, 1);
    } else if (G.guide && (f.kind === 'aim' || (f.kind === 'btn' && f.name === 'missile'))) {
      // Flying missiles: drag the missile button itself (the thumb is
      // already on it) or anywhere on the right side to steer.
      steerBy(G, e.clientX - (f.lx ?? e.clientX), e.clientY - (f.ly ?? e.clientY), (f.kind === 'btn' ? 0.009 : 0.006) * prefs.touchSens, prefs.invert);
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'btn' && f.name === 'fusion' && P.alive) {
      // Dragging the fusion button aims the scan (the thumb is already on it).
      P.twist = clampN(P.twist - (e.clientX - f.lx) * 0.0055 * prefs.touchSens, -1.9, 1.9);
      P.pitch = clampN(P.pitch - (e.clientY - f.ly) * 0.0055 * prefs.touchSens * (prefs.invert ? -1 : 1), -0.4, 0.45);
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'btn') {
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'aim' && P.alive) {
      const sens = (G.zoom ? 0.0022 : 0.0055) * prefs.touchSens;
      P.twist = clampN(P.twist - (e.clientX - f.lx) * sens, -1.9, 1.9);
      P.pitch = clampN(P.pitch - (e.clientY - f.ly) * sens * (prefs.invert ? -1 : 1), -0.4, 0.45);
      f.lx = e.clientX; f.ly = e.clientY;
    }
  });
  const lift = e => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    fingers.delete(e.pointerId);
    if (f.kind === 'btn') touchButton(f.name, false, f.el);
    if (f.kind === 'stick') { G.touchTurn = 0; stick.hidden = true; }
  };
  tui.addEventListener('pointerup', lift);
  tui.addEventListener('pointercancel', lift);
  // A touchscreen laptop can switch either way: follow whatever was used last.
  document.addEventListener('pointerdown', e => {
    const touch = e.pointerType === 'touch';
    if (touch === G.touchUI || e.pointerType === 'pen') return;
    G.touchUI = touch;
    if (touch) exitLock();
    syncTouchUI();
  }, true);

  // What the sim sees this frame, from the keyboard, the mouse buttons and the touch controls.
  function snapshotInput() {
    const inp = {
      thrUp: !!keys.KeyW, thrDown: !!keys.KeyS, stop: !!keys.KeyX,
      turn: (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + G.touchTurn,
      twist: (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0), pitch: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0),
      centre: !!keys.KeyC, jets: !!keys.KeyJ,
      held: Object.fromEntries(CATS.map(c => [c, isHeld(c)])), missileTap, punch: punchTap,
    };
    missileTap = false; punchTap = false;
    return inp;
  }

  Object.assign(self, { keys, held, clearHeld, isHeld, snapshot: snapshotInput, lockPointer, exitLock, locked, syncTouchUI, releaseFingers, syncWeaponButtons,
    get missileTap() { return missileTap; }, set missileTap(v) { missileTap = v; } });
  return self;
}
