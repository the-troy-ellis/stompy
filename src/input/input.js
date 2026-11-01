import { $ } from '../util/dom.js';
import { store } from '../util/store.js';
import { msg } from '../sim/effects.js';
import { clampN } from '../util/math.js';
import { CATS, CAT_OF } from '../data/weapons.js';
import { steerBy, alpha, cycleTarget } from '../sim/missiles.js';
import { nextSpectate, orbitSpectate } from '../net/spectate.js';
import { darkness } from '../data/palettes.js';
import { NAMES } from '../data/names.js';
import { readPad, firstPad } from './gamepad.js';

const { abs, hypot } = Math;

// Keyboard, mouse (with pointer lock), touch (an aim drag and a throttle
// stick on the left, hold-to-fire buttons on the right, one finger each) and
// a gamepad (input/gamepad.js) all feed one per-frame snapshot that the sim
// reads. Menu navigation keys are routed to the screens.
export function createInput(app) {
  const G = app.G, prefs = app.prefs, root = app.root, wrap = app.wrap, cv = app.cv, ov = app.ov;
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
  // SWAP (sim/crew.js, spec 20): Q, the pad's D-pad right, or TGT held on touch. With a
  // crew, TGT picks the next target on release and swaps if held SWAP_HOLD; without one,
  // it picks on the press, as it always has.
  let swapTap = false, tgtTimer = null;
  const SWAP_HOLD = 450;   // ms
  const hasCrew = () => (G.crew?.length || 0) > 1;

  // Only show fire buttons for the kinds of weapon this mech carries. A
  // chassis with a tool has it on the ENERGY button, held (DIG or BUILD,
  // sim/tools.js, docs/specs/25-hold-to-dig.md, 31-builder.md), and a
  // digger's FUSION button is DUMP (sim/dig.js, docs/specs/21-mining.md).
  // No cockpit places a site: the command view does (spec 31).
  // Run again whenever the mech you are in changes (SWAP, spec 20).
  let buttonsFor = null;
  function syncWeaponButtons() {
    const P = (buttonsFor = G.player);
    for (const c of CATS) {
      const btn = $(`[data-t="${c}"]`, tui);
      if (!btn) continue;
      btn.hidden = !(P.weapons.some(w => CAT_OF[w.type] === c) || (c === 'energy' && P.ch.tool) || (c === 'fusion' && P.ch.tool === 'dig'));
      if (c === 'missile') btn.firstChild.textContent = 'MISSILE';
      if (c === 'energy') btn.firstChild.textContent = P.ch.tool ? NAMES.tools[P.ch.tool] : 'ENERGY';
      if (c === 'fusion') btn.firstChild.textContent = P.ch.tool ? 'DUMP' : 'FUSION';
      if (c === 'ballistic') btn.firstChild.textContent = 'BALLISTIC';
    }
  }
  // Each fire button shows its weapons' state (touch only; the HUD's weapon
  // list is off there): a dark pie that sweeps away as they recharge, the
  // OOPS BUTTON's scan filling it bright, the ammo left, and dim red when
  // they are all gone or empty. A style is written only when it changes.
  const fireLast = {}, fireBtn = {};
  function fireStatus() {
    const P = G.player;
    for (const c of CATS) {
      const btn = fireBtn[c] || (fireBtn[c] = $(`[data-t="${c}"]`, tui));   // found once
      if (!btn || btn.hidden) continue;
      let cd = 0, ammo = -1, live = 0;
      for (const w of P.weapons) {
        if (CAT_OF[w.type] !== c || w.dead) continue;
        live++;
        if (w.def.cd) cd = Math.max(cd, w.cd / w.def.cd);
        if (w.def.ammo) ammo = Math.max(ammo, 0) + w.ammo;
      }
      const scan = c === 'fusion' && P.fusion?.on && P.fusion.mech ? Math.min(1, P.fusion.t / P.weapons.find(w => w.def.kind === 'fusion').def.scan) : 0;
      const gone = P.weapons.some(w => CAT_OF[w.type] === c) && (!live || ammo === 0);
      const q = Math.round(Math.min(1, cd) * 48), s = Math.round(scan * 48), L = fireLast[c] || (fireLast[c] = { q: -1, s: -1, ammo: -2, gone: null });
      if (q !== L.q) { L.q = q; btn.style.setProperty('--cd', q / 48); }
      if (s !== L.s) { L.s = s; btn.style.setProperty('--scan', s / 48); }
      if (ammo !== L.ammo) { L.ammo = ammo; btn.lastChild.textContent = ammo >= 0 ? String(ammo) : ''; }
      if (gone !== L.gone) { L.gone = gone; btn.classList.toggle('gone', gone); }
    }
  }


  const lockPointer = () => { if (G.touchUI) return; try { const r = cv.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* fall back to arrows */ } };
  const exitLock = () => { if (document.pointerLockElement === cv) document.exitPointerLock(); };
  const locked = () => document.pointerLockElement === cv;
  let hadLock = false;
  const onLockChange = () => {
    if (locked()) hadLock = true;
    else if (hadLock && G.state === 'play' && !G.paused && !G.command) app.ui.pause(true);   // going up to the command view lets go on purpose
  };
  document.addEventListener('pointerlockchange', onLockChange);

  const onMouseMove = e => {
    if (G.state !== 'play' || G.paused) return;
    if (!locked()) return;
    if (G.spectate) { orbitSpectate(G, -e.movementX * 0.004 * prefs.mouseSens, e.movementY * 0.003 * prefs.mouseSens * (prefs.invert ? -1 : 1)); return; }   // waiting to respawn: orbit
    if (!G.player.alive) return;
    if (G.guide) { steerBy(G, e.movementX, e.movementY, 0.0028 * prefs.mouseSens, prefs.invert); return; }
    const sens = (G.zoom ? 0.0009 : 0.0024) * prefs.mouseSens;
    const P = G.player;
    P.twist = clampN(P.twist - e.movementX * sens, -1.9, 1.9);
    P.pitch = clampN(P.pitch - e.movementY * sens * (prefs.invert ? -1 : 1), -0.4, 0.45);
  };
  document.addEventListener('mousemove', onMouseMove);

  wrap.addEventListener('contextmenu', e => e.preventDefault());
  cv.parentElement.addEventListener('mousedown', e => {
    if (e.target.closest('.mech-overlay') || G.touchUI || G.command) return;   // up in the command view, the mouse is its own (ui/command.js)
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

  const GAME_KEYS = new Set(['KeyQ', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyC', 'KeyJ', 'KeyT', 'KeyR', 'KeyF', 'KeyZ', 'KeyP', 'KeyE', 'KeyL', 'Space',
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
    if (G.command && (e.code === 'Escape' || e.code === 'Tab')) { e.preventDefault(); app.command.close(); return; }   // BACK (ui/command.js)
    if (G.command && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); app.command.key(e.code.slice(5) - 1); return; }   // the order bar (MAKE's, with an assembly line tapped)
    if (e.code === 'Tab' && !G.paused) { e.preventDefault(); app.command.open(); return; }   // MAP
    if (e.code === 'Escape') { e.preventDefault(); if (!G.paused) app.ui.pause(true); return; }
    if (e.code === 'KeyP') { e.preventDefault(); app.ui.pause(!G.paused); return; }
    if (G.paused || !GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat && keys[e.code]) return;
    keys[e.code] = true;
    if (KEY_FOR.missile.includes(e.code)) missileTap = true;
    if (e.code === 'KeyT') { if (G.spectate) nextSpectate(G); else cycleTarget(G); }   // spectating: the next pilot
    if (e.code === 'KeyE') punchTap = true;
    if (e.code === 'KeyQ') swapTap = true;
    if (e.code === 'KeyR' && G.aimMech && G.aimMech.team !== 0) { G.target = G.aimMech; app.audio.sfx.beep(); }
    if (e.code === 'KeyF') alpha(G);
    if (e.code === 'KeyZ') G.zoom = !G.zoom;
    if (e.code === 'KeyL') toggleLights();
  };
  const onKeyUp = e => { keys[e.code] = false; };
  // Headlights: on is seeing, off is not being seen (spec 07). Flat, like a switch.
  function toggleLights() {
    const P = G.player;
    if (!P?.alive) return;
    P.lights = !P.lights;
    msg(G, P.lights ? 'LIGHTS ON' : 'LIGHTS OFF');
    app.audio.sfx.beep();
    $('[data-t="lights"]', root)?.classList.toggle('lit', P.lights);
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  /* ---------- touch ---------- */

  // The left side is for flying the mech, the right for shooting. Both left
  // controls are floating sticks that sit where the thumb lands, in two
  // zones stacked in the bottom-left corner: on a phone each is half the
  // height, on a tablet each is ZONE px, so one thumb reaches both.
  //   Lower left: turn and aim. Sideways turns the legs (the whole mech) for
  //     as long as it's held, faster the further out; up and down pitches.
  //     Tap, then tap and hold: the jump jets charge for as long as the
  //     second touch stays down, and letting go blasts off.
  //   Upper left: throttle and torso. Up and down moves the throttle from
  //     where it was when the thumb went down, and it stays set on release,
  //     like W/S; sideways twists the torso. A double tap punches.
  //   The compass tape: a tap swings the torso back over the legs.
  //   Right: the buttons. Dragging the FUSION button aims the scan, and while
  //     flying missiles the aim side or the MISSILE button steers them.
  // Every finger is tracked separately.
  const tui = $('.touch-ui', root), sticks = [...tui.querySelectorAll('.stick')], zoneLabels = [...tui.querySelectorAll('.tzones span')];
  const ring = { stick: sticks[0], aim: sticks[1] };   // the throttle stick's ring and the turn stick's
  const fingers = new Map();
  const STICK_R = 56, LEFT = 0.45, DOUBLE_TAP = 300, ZONE = 200;   // px; share of the width; ms; px: a zone's most height
  // lastAimTap / lastStickTap: when a tap (not a drag) on the turn / throttle stick lifted; centreTap: a compass tap not yet sent.
  let lastAimTap = -1e9, lastStickTap = -1e9, centreTap = false;
  // Where the turn zone (below) meets the throttle zone (above), in px from the top.
  const split = h => h - Math.min(h / 2, ZONE);
  const showStick = (s, x, y) => { s.hidden = false; s.style.left = x + 'px'; s.style.top = y + 'px'; s.firstElementChild.style.transform = 'translate(-50%, -50%)'; };
  const moveKnob = (s, dx, dy) => { s.firstElementChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
  // The stick's offset from where the thumb landed, clamped to its ring, and as -1..1 past a small deadzone.
  const stickOf = (f, e) => {
    const r = tui.getBoundingClientRect();
    let dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
    const d = hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    const dead = v => (abs(v) < 8 ? 0 : (v - Math.sign(v) * 8) / (STICK_R - 8));
    return { dx, dy, x: dead(dx), y: dead(dy) };
  };
  const syncTouchUI = () => {
    tui.hidden = !(G.touchUI && !G.padActive && (G.state === 'play' || G.state === 'over') && !G.paused && !G.command);   // a gamepad in use, or up in the command view: out of the way
    const map = root.querySelector('[data-t="map"]');
    if (map) map.hidden = !app.command?.can();   // MAP: only with a crew (docs/specs/22-command-view.md)
    const h = tui.getBoundingClientRect().height || window.innerHeight;
    if (zoneLabels[1]) zoneLabels[1].style.flex = `0 0 ${h - split(h)}px`;   // the faint labels follow the zones
    const lights = root.querySelector('[data-t="lights"]');
    if (lights) { lights.hidden = !(darkness(G.pal) > 0.3 || G.palRamp); lights.classList.toggle('lit', !!G.player?.lights); }   // only where night falls
    if (tui.hidden) releaseFingers();
  };
  function releaseFingers() {
    for (const f of fingers.values()) { if (f.kind === 'btn') touchButton(f.name, false, f.el); if (f.jets) keys.KeyJ = false; }
    fingers.clear();
    G.touchTwist = 0; G.touchTurn = 0; G.touchPitch = 0; ring.stick.hidden = true; ring.aim.hidden = true;
  }
  function touchButton(name, down, el) {
    el?.classList.toggle('on', down);
    if (CATS.includes(name)) { held[name] = down; if (down && name === 'missile') missileTap = true; }
    if (name === 'tgt' && hasCrew() && !G.spectate) {   // with a crew: tap for the next target, hold to SWAP
      if (down) tgtTimer = setTimeout(() => { tgtTimer = null; swapTap = true; }, SWAP_HOLD);
      else if (tgtTimer) { clearTimeout(tgtTimer); tgtTimer = null; cycleTarget(G); }
      return;
    }
    if (!down) return;
    if (name === 'centre') centreTap = true;
    else if (name === 'tgt') { if (G.spectate) nextSpectate(G); else cycleTarget(G); }
    else if (name === 'zoom') G.zoom = !G.zoom;
    else if (name === 'lights') toggleLights();
    else if (name === 'stop') G.player.throttle = 0;
    else if (name === 'pause') app.ui.pause(true);
    else if (name === 'map') { releaseFingers(); app.command.open(); }
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
    if (x >= r.width * LEFT) return;   // the right side is buttons only
    const has = k => [...fingers.values()].some(f => f.kind === k);
    const now = performance.now();
    if (y < split(r.height) && !has('stick')) {
      if (now - lastStickTap < DOUBLE_TAP) { punchTap = true; lastStickTap = -1e9; }   // double tap: a punch
      fingers.set(e.pointerId, { kind: 'stick', x0: x, y0: y, thr0: G.player.throttle });
      showStick(ring.stick, x, y);
    } else if (y >= split(r.height) && !has('aim')) {
      // Tap, then tap and hold: the jets charge while this touch stays down (JUMP JETS NONE: nothing).
      const jets = now - lastAimTap < DOUBLE_TAP && G.player.jets > 0;
      if (jets) { keys.KeyJ = true; lastAimTap = -1e9; }
      fingers.set(e.pointerId, { kind: 'aim', x0: x, y0: y, lx: e.clientX, ly: e.clientY, cx: e.clientX, cy: e.clientY, jets });
      showStick(ring.aim, x, y);
    }
  });
  tui.addEventListener('pointermove', e => {
    const f = fingers.get(e.pointerId);
    if (!f || G.state !== 'play' || G.paused) return;
    const P = G.player;
    if (f.kind === 'stick') {
      const s = stickOf(f, e);
      moveKnob(ring.stick, s.dx, s.dy);
      G.touchTwist = clampN(-s.x, -1, 1);
      if (P.alive && !P.shutdown) P.throttle = clampN(f.thr0 - s.y, -0.35, 1);
    } else if (G.guide && (f.kind === 'aim' || (f.kind === 'btn' && f.name === 'missile'))) {
      // Flying missiles: drag the missile button itself (the thumb is
      // already on it) or the aim side to steer.
      steerBy(G, e.clientX - (f.lx ?? e.clientX), e.clientY - (f.ly ?? e.clientY), (f.kind === 'btn' ? 0.009 : 0.006) * prefs.touchSens, prefs.invert);
      if (f.kind === 'aim') { G.touchTurn = 0; G.touchPitch = 0; }   // flying missiles: the stick steers them, not the mech
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'btn' && f.name === 'fusion' && P.alive) {
      // Dragging the fusion button aims the scan (the thumb is already on it).
      P.twist = clampN(P.twist - (e.clientX - f.lx) * 0.0055 * prefs.touchSens, -1.9, 1.9);
      P.pitch = clampN(P.pitch - (e.clientY - f.ly) * 0.0055 * prefs.touchSens * (prefs.invert ? -1 : 1), -0.4, 0.45);
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'btn') {
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'aim' && G.spectate) {
      // Waiting to respawn: the aim drag orbits the spectator camera.
      orbitSpectate(G, -(e.clientX - f.lx) * 0.008 * prefs.touchSens, (e.clientY - f.ly) * 0.006 * prefs.touchSens * (prefs.invert ? -1 : 1));
      f.lx = e.clientX; f.ly = e.clientY;
    } else if (f.kind === 'aim' && P.alive) {
      // The turn stick: held out sideways, the legs keep turning (the sim's
      // rate, like A / D); up and down pitches at a rate (like the arrows).
      const s = stickOf(f, e), k = prefs.touchSens * (G.zoom ? 0.4 : 1);
      moveKnob(ring.aim, s.dx, s.dy);
      G.touchTurn = clampN(-s.x * Math.min(1, prefs.touchSens), -1, 1);
      G.touchPitch = clampN(-s.y * k * (prefs.invert ? -1 : 1), -1.5, 1.5);
      f.cx = e.clientX; f.cy = e.clientY;
    }
    if (f.kind === 'aim') { f.lx = e.clientX; f.ly = e.clientY; }   // the drag paths above (missiles, spectating) steer by the step
  });
  const lift = e => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    fingers.delete(e.pointerId);
    if (f.kind === 'btn') touchButton(f.name, false, f.el);
    // A tap (no real drag) on either stick may be the first of a double tap.
    const tapped = (() => { const r = tui.getBoundingClientRect(); return abs(e.clientX - r.left - (f.x0 ?? 0)) + abs(e.clientY - r.top - (f.y0 ?? 0)) < 12; })();
    if (f.kind === 'stick') {
      G.touchTwist = 0; ring.stick.hidden = true;
      lastStickTap = tapped ? performance.now() : -1e9;
    }
    if (f.kind === 'aim') {
      G.touchTurn = 0; G.touchPitch = 0; ring.aim.hidden = true;
      if (f.jets) keys.KeyJ = false;
      lastAimTap = tapped && !f.jets ? performance.now() : -1e9;
    }
  };
  addEventListener('resize', () => { if (G.touchUI) syncTouchUI(); });   // the zones follow the screen
  tui.addEventListener('pointerup', lift);
  tui.addEventListener('pointercancel', lift);
  // A touchscreen laptop can switch either way: follow whatever was used last.
  document.addEventListener('pointerdown', e => {
    const touch = e.pointerType === 'touch';
    if (touch && G.padActive) { G.padActive = false; syncTouchUI(); }   // a thumb on the glass: the touch controls come back
    if (touch === G.touchUI || e.pointerType === 'pen') return;
    G.touchUI = touch;
    if (touch) exitLock();
    syncTouchUI();
  }, true);

  /* ---------- gamepad ---------- */

  // Polled every frame (main.js). In play it feeds the snapshot below and
  // takes the one-press buttons; over a screen (menu, pause, lobby, debrief)
  // the D-pad or left stick moves a highlight through its buttons, A presses
  // the highlighted one, Start launches or resumes, B resumes.
  const PAD_AIM = 1.5, NAV_REPEAT = 0.22;   // the right stick at full tilt: 1.5x the arrow keys' turn; s between steps while the left stick is held
  let padHeld = [], pad = null, padIdx = -1, navT = 0;
  function pollPad(dt) {
    const gp = firstPad(navigator.getGamepads?.());
    if (!gp) { pad = null; return; }
    pad = readPad(gp, padHeld); padHeld = pad.held;
    if (!pad.active) return;
    if (!G.padActive) { G.padActive = true; syncTouchUI(); }
    const p = pad.pressed, P = G.player;
    if (G.state === 'play' && !G.paused && !G.lobby && !G.summary) {
      for (const b of ov.querySelectorAll('.pad-focus')) b.classList.remove('pad-focus');
      if (G.command) { if (p.start) app.ui.pause(true); else app.command.pad(pad, dt); return; }   // up in the command view: the map takes the pad (ui/command.js)
      if (p.back && app.command?.can()) { app.command.open(); return; }   // View: MAP, with a crew
      if (p.start || p.back) { app.ui.pause(true); return; }
      if (G.spectate) orbitSpectate(G, pad.axes.twist * 2.5 * dt, -pad.axes.pitch * 2 * dt * (prefs.invert ? -1 : 1));   // waiting to respawn: look around
      if (p.missile) missileTap = true;
      if (p.punch) punchTap = true;
      if (p.swap) swapTap = true;
      if (p.target) { if (G.spectate) nextSpectate(G); else cycleTarget(G); }
      if (p.zoom) G.zoom = !G.zoom;
      if (p.lights) toggleLights();
      if (p.stop && P?.alive) P.throttle = 0;
      return;
    }
    // A screen is up: move the highlight, press it.
    const btns = [...ov.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);
    if (!btns.length) return;
    const tilt = abs(pad.axes.thr) > 0.6 ? -Math.sign(pad.axes.thr) : abs(pad.axes.turn) > 0.6 ? -Math.sign(pad.axes.turn) : 0;
    navT = tilt ? navT - dt : 0;
    let step = p.up || p.left ? -1 : p.down || p.right ? 1 : 0;
    if (!step && tilt && navT <= 0) { step = tilt; navT = NAV_REPEAT; }
    if (step) padIdx = padIdx < 0 ? (step > 0 ? 0 : btns.length - 1) : (padIdx + step + btns.length) % btns.length;
    padIdx = Math.min(padIdx, btns.length - 1);
    const on = btns[padIdx];
    if (on && !on.classList.contains('pad-focus')) { for (const b of ov.querySelectorAll('.pad-focus')) b.classList.remove('pad-focus'); on.classList.add('pad-focus'); on.scrollIntoView?.({ block: 'nearest' }); }
    if (p.a) { if (on) on.click(); else if (G.state === 'menu') app.ui.go(); }
    else if (p.start) { if (G.paused) app.ui.pause(false); else if (G.state === 'menu' && !G.lobby) app.ui.go(); }
    else if (p.b && G.paused) app.ui.pause(false);
  }

  // What the sim sees this frame, from the keyboard, the mouse buttons, the touch controls and a gamepad.
  function snapshotInput() {
    G.turnByUsed = 0;
    if (G.player !== buttonsFor) syncWeaponButtons();   // swapped into another mech: its buttons
    const gp = pad && !G.spectate ? pad : null, aim = gp ? prefs.padSens * PAD_AIM * (G.zoom ? 0.4 : 1) : 0;
    const inp = {
      thrUp: !!keys.KeyW, thrDown: !!keys.KeyS, stop: !!keys.KeyX, thr: gp ? gp.axes.thr : 0,
      turn: (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + (gp ? gp.axes.turn : 0) + (G.touchTurn || 0), turnBy: 0,
      twist: (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0) + (G.touchTwist || 0) + (gp ? gp.axes.twist * aim : 0),
      pitch: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0) + (G.touchPitch || 0) + (gp ? gp.axes.pitch * aim * (prefs.invert ? -1 : 1) : 0),
      centre: !!keys.KeyC || !!gp?.hold.centre, centreTap, jets: !!keys.KeyJ || !!gp?.hold.jets,
      held: Object.fromEntries(CATS.map(c => [c, isHeld(c) || !!gp?.hold[c]])), missileTap, punch: punchTap, swap: swapTap,
    };
    missileTap = false; punchTap = false; centreTap = false; swapTap = false;
    return inp;
  }

  Object.assign(self, { keys, held, clearHeld, isHeld, snapshot: snapshotInput, pollPad, lockPointer, exitLock, locked, syncTouchUI, releaseFingers, syncWeaponButtons, fireStatus,
    get missileTap() { return missileTap; }, set missileTap(v) { missileTap = v; } });
  return self;
}
