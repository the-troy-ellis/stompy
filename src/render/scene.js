import { hudPalette } from '../data/colors.js';
import { backingSize } from './look.js';
import { effectLook, SHAPE_BY_KIND, TUMBLE_BY_KIND } from '../mesh/effects.js';
import { M as M0, add, makeMatrixArena, frustumPlanes, sphereVisible, boxVisible, clampN, dirOf, mix3, mul, norm, rnd, sub, len, cross, TAU } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { buildGroundExtras } from '../world/terrainMesh.js';
import { createGround } from './ground.js';
import { createFalls } from './falls.js';
import { Builder } from '../mesh/builder.js';
import { viewYaw } from '../sim/geom.js';
import { solveKnee, limb } from '../sim/gait.js';
import { meltFrac } from '../sim/beams.js';
import { FEEL, HEAT, hotFrac } from '../data/feel.js';
import { meleeOf } from '../data/melee.js';
import { spinPose } from '../sim/tools.js';
import { landingAt } from '../sim/jets.js';
import { JETS, JETS_FLIGHT } from '../data/systems.js';
import { BARREL_AT, styleOf, BONE, BONE_COUNT } from '../mesh/mechParts.js';
import { darkness, HEADLIGHTS } from '../data/palettes.js';
import { fogOf, flashOf, WEATHER } from '../data/weather.js';
import { makeWeatherBox, stepWeatherBox } from './weatherBox.js';
import { fallAngle } from '../sim/entities.js';
import { spectateCamera } from '../net/spectate.js';
import { WRECK_BURN } from '../sim/combat.js';
import { SCORCH_MAX } from '../sim/effects.js';
import { propInto } from '../mesh/props.js';
import { batchEntities, clearProps, makePropBatches } from './propBatch.js';
import { WEAPONS } from '../data/weapons.js';

// Every matrix the renderer builds comes from a per-frame arena (render() resets
// it), so drawing allocates no matrices; apply, persp and lookAt are M's own.
const MA = makeMatrixArena();
const M = { ...MA, apply: M0.apply, persp: M0.persp, lookAt: M0.lookAt };
const chain = MA.chain;

// An arm gun's proportions by weapon: [thickness, length] against the stock barrel.
const BARREL = { laser: [1, 1], mlaser: [0.8, 0.7], ac: [1.45, 1.1], gauss: [0.8, 1.9], mg: [0.6, 0.75], lrm: [1.7, 0.55], srm: [2.4, 0.55] };   // srm: an arm-mounted box

const { sin, cos, atan2, min, max, abs, PI, floor } = Math;

// How far the knees splay outward while the body is squashed (a landing):
// up to a 20% lean of the knee pole at full squash. Pure, for the tests.
export const legSplay = squash => clampN(squash / 0.25, 0, 1) * 0.2;

// The swing: how far the torso rears back then lunges, and the arms cock and
// drive, as a function of where the melee state is. Pure, for the tests.
// Returns { lean (torso pitch, +back), arm (shoulder swing, +back), lunge (m forward) }.
// A fisted chassis's arms (PURPLE PUNCHER), as shoulder angles: at rest
// the fists hang a little forward in a guard; the wind-up cocks the punching
// arm back and tucks the other up; the hit swings the punching fist out level
// and it eases back over the recovery. Negative swings forward. `twist`
// turns the torso away from the punch, then into it. Pure, for the tests.
export const FIST_REST = -0.35;
export function fistPose(m) {
  const st = m.melee, rest = { LA: FIST_REST, RA: FIST_REST, twist: 0 };
  if (!st || !st.arm) return rest;
  const def = meleeOf(m), t = st.t, side = st.arm === 'LA' ? 1 : -1, other = st.arm === 'LA' ? 'RA' : 'LA';
  if (st.phase === 'windup') {
    const u = Math.min(1, t / def.windup);
    return { [st.arm]: FIST_REST + 0.95 * u, [other]: FIST_REST - 0.4 * u, twist: -0.1 * side * u };
  }
  const r = Math.min(1, (t - def.windup) / def.recover), snap = Math.exp(-r * 5);
  return { [st.arm]: FIST_REST - 1.15 * snap, [other]: FIST_REST - 0.4 * snap, twist: 0.12 * side * snap };
}
// The menu mech's vertical band in NDC (+1 is the top of the screen): from
// just under the top edge down to just above the mech selector panel, which
// sits lower on a tall screen than on a phone held sideways.
export function menuBand(H, panelTop = null) {
  const floor = clampN(panelTop != null ? panelTop / H : (H < 500 ? 0.42 : 0.65), 0.35, 0.92);
  return { top: 1 - 2 * 0.07, bottom: 1 - 2 * (floor - 0.03) };
}
export function meleePose(m) {
  const st = m.melee;
  if (!st) return { lean: 0, arm: 0, lunge: 0 };
  const def = meleeOf(m), t = st.t;
  if (st.phase === 'windup') { const u = Math.min(1, t / def.windup); return { lean: 0.15 * u, arm: -0.9 * u, lunge: 0 }; }
  const r = Math.min(1, (t - def.windup) / def.recover), snap = Math.exp(-r * 6);
  return { lean: -0.2 * snap, arm: 0.6 * snap, lunge: 0.6 * snap };
}

// The topple of a dying mech: a rotation by its fall angle about a horizontal
// axis through the ground under it, leaning the way it falls. Null when it
// is not falling. Pure, for the tests.
// A dying mech's fall, or (your own) where the fall ended: m.fallen keeps it.
export function toppleOf(m) {
  const d = m.dying || m.fallen;
  if (!d || !(d.angle > 0)) return null;
  return chain(M.T(m.x, m.y, m.z), M.RY(d.fallYaw), M.RX(d.angle), M.RZ(d.roll * d.angle), M.RY(-d.fallYaw), M.T(-m.x, -m.y, -m.z));
}
// Inverse of a rigid (rotation + translation) 4x4 column-major matrix.
function inverse3(m) {
  const r = M.id();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[j * 4 + i] = m[i * 4 + j];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]); r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]); r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

// Everything drawn in 3D: the camera per state, sky, terrain, mechs with
// their IK legs, wrecks, shots, pulses, beams and particles.
// The cockpit's eye, kept out of rock. Walking into rock is stopped in the
// sim (sim/mech.js rockAt's cab sample), but turning against a face the
// bucket dug, a twist, or ground coming down round you can still bring rock
// up to the eye; the near plane (0.5 m) would cut into it and show the inside
// of the ground. So: if the eye, or rock EYE_CLEAR ahead of it (straight on,
// to either edge of the view, or above), is solid, the eye slides back along
// the line to the body's middle until it is clear. Usually the first test
// passes and nothing is made.
export const EYE_CLEAR = 0.7;
function eyeClear(ter, x, y, z, d, rx, rz) {
  const c = EYE_CLEAR;
  return ter.sample(x, y, z) <= 0 && ter.sample(x + d[0] * c, y + d[1] * c, z + d[2] * c) <= 0
    && ter.sample(x + d[0] * 0.5 + rx * c, y + d[1] * 0.5, z + d[2] * 0.5 + rz * c) <= 0
    && ter.sample(x + d[0] * 0.5 - rx * c, y + d[1] * 0.5, z + d[2] * 0.5 - rz * c) <= 0
    && ter.sample(x + d[0] * 0.5, y + d[1] * 0.5 + c * 0.5, z + d[2] * 0.5) <= 0;
}
export function clearEye(ter, eye, dir, bx, by, bz) {
  const rl = Math.hypot(dir[0], dir[2]) || 1, rx = dir[2] / rl, rz = -dir[0] / rl;   // the view's right, level
  if (eyeClear(ter, eye[0], eye[1], eye[2], dir, rx, rz)) return eye;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8, x = eye[0] + (bx - eye[0]) * t, y = eye[1] + (by - eye[1]) * t, z = eye[2] + (bz - eye[2]) * t;
    if (eyeClear(ter, x, y, z, dir, rx, rz)) return [x, y, z];
  }
  return [bx, by, bz];
}

export function createScene(app) {
  const G = app.G, R = app.R, wrap = app.wrap, cv = app.cv, hud = app.hud;
  // The world on the GPU, rebuilt whenever the sim builds a new one: the voxel
  // ground (render/ground.js), and what stands on it (world/terrainMesh.js: 16
  // chunks, each with its box) in one buffer, the chunks in rows, so each run
  // of neighbours in view is one draw.
  const ground = createGround(R), falls = createFalls(R);
  let world = { buf: null, chunks: [] };
  const RUN = { buf: null, first: 0, count: 0 };
  function uploadWorld() {
    if (world.buf) R.gl.deleteBuffer(world.buf);
    const P = G.player, eye = P && G.worldKind === 'match' ? [P.x, 0, P.z] : [0, 0, 0];
    ground.load(G.ter, G.pal, eye);
    const chunks = buildGroundExtras(G.ter, G.pal, G.ter.seed), all = new Builder();
    world = { chunks: chunks.map(({ b, ...ch }) => { const first = all.d.length / 9; for (const v of b.d) all.d.push(v); return { ...ch, first, count: b.d.length / 9 }; }) };
    world.buf = all.d.length ? R.upload(all).buf : null;
  }
  // A chunk is drawn when its box is in view and some of it is nearer than the fog's end.
  const ID = M0.id(), SUNK = M0.T(0, -2, 0);   // the ground is drawn where it is; its far groups a little lower (render/ground.js)
  function drawWorld(eye) {
    ground.tick(eye, G.falls);
    ground.draw(eye, FOG[1], PLANES, ID, SUNK);
    if (!world.buf) return;
    RUN.buf = world.buf; RUN.count = 0;
    const cs = world.chunks;
    for (let i = 0; i < cs.length; i++) {   // an index, not for-of: no iterator garbage while this is still cold
      const ch = cs[i], dx = Math.max(ch.lo[0] - eye[0], 0, eye[0] - ch.hi[0]), dz = Math.max(ch.lo[2] - eye[2], 0, eye[2] - ch.hi[2]);
      if (!ch.count || dx * dx + dz * dz > FOG[1] * FOG[1] || !boxVisible(PLANES, ch.lo, ch.hi)) {
        if (RUN.count) { R.draw(RUN, ID); RUN.count = 0; }
        continue;
      }
      if (!RUN.count) RUN.first = ch.first;
      RUN.count += ch.count;
    }
    if (RUN.count) R.draw(RUN, ID);
  }

  // Scan tone: a pulsing whine that climbs as the scan converges.


  // The HUD canvas is always full resolution; the 3D canvas renders R.look.lines
  // tall (0: full) and the browser scales it up with hard edges (render/look.js).
  const UP = [0, 1, 0], NO_SHADE = [1, 1, 1], LAMP_COL = [1, 0.95, 0.75];
  const SPOT = { on: false, pos: [0, 0, 0], dir: [0, 0, 1], col: [0, 0, 0], cone: [Math.cos(HEADLIGHTS.cone[0]), Math.cos(HEADLIGHTS.cone[1])], range: HEADLIGHTS.range };
  let DARK = 0;   // how dark this frame is (palettes.js darkness)
  const FOG = [0, 0];   // this frame's fog distances: the palette's, cut by the weather (data/weather.js)
  const SHADE = [1, 1, 1], SKY_Z = [0, 0, 0], SKY_H = [0, 0, 0], FLASH_SHADE = [1.8, 1.8, 2.0], FLASH_SKY = [0.78, 0.8, 0.92], WHITE_SKY = [0.86, 0.89, 0.94];
  // Rain and snow (spec 07): drops in a box round the camera, one instanced
  // draw each. Rain is thin streaks leaning with the wind; snow is flat
  // three-pointed flakes drifting down, spinning and tumbling as they go
  // (`whirl`: radians a second about their middle and end over end, each flake
  // a little faster or slower than the next), and swaying. `clear`: metres round the
  // cockpit kept free, so nothing sits on the canopy.
  const WX_LOOK = {
    rain: { shape: 'streak', count: 1500, fall: 22, size: 1.8, col: [0.6, 0.66, 0.76], glow: 0.3, clear: 6, lean: true },
    snow: { shape: 'flake', count: 800, fall: 1.6, size: 0.42, col: [0.95, 0.96, 1], glow: 0.55, clear: 5, sway: 0.5, whirl: [2.2, 1.6] },
    dust: { shape: 'flat', count: 2500, fall: 0.6, size: 0.22, col: [0.7, 0.5, 0.32], glow: 0.15, clear: 4, sway: 0.3, gust: 1.4 },   // grains streaming sideways
  };
  const box = makeWeatherBox(2500), WX_VEL = [0, 0, 0];
  let wxTime = null;
  function fillWeather(eye) {
    const w = G.weather, L = w && WX_LOOK[w.kind];
    if (!L) { box.n = 0; return; }
    const dt = wxTime == null ? 0 : Math.min(0.1, Math.max(0, G.time - wxTime));
    wxTime = G.time;
    const gust = L.gust || 1;
    WX_VEL[0] = w.wind[0] * gust; WX_VEL[1] = -L.fall; WX_VEL[2] = w.wind[1] * gust;   // the wind is [x, z]
    stepWeatherBox(box, eye, Math.round(L.count * w.intensity * (G.weatherScale ?? 1)), WX_VEL, dt);
    const g = R.fx[L.shape], wind = Math.hypot(w.wind[0], w.wind[1]);
    g.n = L.lean ? fillDrops(g.data, g.n, box, eye, L, Math.atan2(w.wind[0], w.wind[1]), Math.atan2(wind, L.fall), 0, 0, G.time)
      : fillDrops(g.data, g.n, box, eye, L, 0, 0, 1, L.sway || 0, G.time, L.whirl ? L.whirl[0] : 0.7, L.whirl ? L.whirl[1] : 0.45);
  }
  // The drops into an effect shape's instances, from `n` on; returns the new
  // count. Rain leans (yaw, lean) with spin 0; snow and dust have spin 1 and
  // turn and sway instead. No ternaries in the loop: V8 boxes a number picked
  // between a passed-in value and fresh arithmetic, which is a heap number per
  // drop per frame.
  function fillDrops(d, n, box, eye, L, yaw, lean, spin, sway, t, rs = 0.7, rt = 0.45) {
    const cap = R.FX_CAP, F = R.FX_FLOATS, pos = box.pos, ex = eye[0], ez = eye[2], clear2 = L.clear * L.clear;
    const size = L.size, cr = L.col[0], cg = L.col[1], cb = L.col[2], glow = L.glow;
    for (let i = 0; i < box.n && n < cap; i++) {
      const i3 = i * 3, dx = pos[i3] - ex, dz = pos[i3 + 2] - ez;
      if (dx * dx + dz * dz < clear2) continue;
      const o = n * F, sw = Math.sin(t * 0.9 + i * 1.7) * sway;
      n++;
      d[o] = pos[i3] + sw; d[o + 1] = pos[i3 + 1]; d[o + 2] = pos[i3 + 2] + sw * 0.6; d[o + 3] = size;
      const k = 0.6 + 0.8 * ((i * 0.618) % 1);   // this one's own pace
      d[o + 4] = yaw + spin * (t * rs * k + i * 1.3); d[o + 5] = lean + spin * (t * rt * k + i);
      d[o + 6] = cr; d[o + 7] = cg; d[o + 8] = cb; d[o + 9] = glow; d[o + 10] = 0; d[o + 11] = 0;
    }
    return n;
  }
  // A point through a matrix into `out`, without allocating.
  const placeInto = (m, p, out) => { for (let i = 0; i < 3; i++) out[i] = m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]; };
  const FRAME = {}, LOOK = new Float32Array(7);   // reused every frame: the effects' shared uniforms and one particle's look (mesh/effects.js)
  let W = 0, H = 0, dpr = 1, lines = -1;
  function resize() {
    dpr = min(devicePixelRatio || 1, 1.5);
    const w = wrap.clientWidth, h = wrap.clientHeight, want = R.look?.lines || 0;
    if (w === W && h === H && want === lines) return;
    W = w; H = h; lines = want;
    hud.width = max(1, floor(w * dpr)); hud.height = max(1, floor(h * dpr));
    [cv.width, cv.height] = backingSize(w, h, dpr, lines);
    cv.classList.toggle('pixelated', cv.height < hud.height);
  }

  // One mech's bones this frame (spec 14 P4): put() copies a part's matrix
  // into its bone, or draws the part on its own where skinning isn't available.
  const BONES = new Float32Array(BONE_COUNT * 16), PLANES = new Float32Array(24);
  // Bounding spheres, generous: a toppling mech or a fallen tower lies along the ground.
  const seen = (x, y, z, r) => sphereVisible(PLANES, x, y, z, r) || (R.culled++, false);   // R.culled: the ?debug=1 overlay's count
  let putTint = null, grab = null;   // grab: poseWire's capture of a pose instead of drawing it
  const put = (bone, mesh, mat) => {
    if (grab) { grab(bone, mesh, mat); return; }
    if (R.skinned) BONES.set(mat, bone * 16);
    else R.draw(mesh, mat, putTint);
  };
  function drawMech(m, VPtint) {
    // The hips drop by the sag spring (reactor down); the feet stay put and the knees take it up.
    const sag = (m.sag ? m.sag.x : 0) + (m.dying ? m.dying.drop || 0 : 0);   // and the buckle of a dying mech
    // A one-legged mech leans toward the gap (m.lean, radians of roll about its heading).
    // A dying mech topples rigidly about the ground under it (toppleOf), feet and all.
    const top = toppleOf(m), place = p => (top ? M.apply(top, p) : p);
    // The body frame is frame(m) (sim/geom.js) built from the arena.
    // The hips shift over the planted foot (m.sway, model units, +x its left) and turn with the stride (m.hipYaw): sim/gait.js.
    // The whole body tips about its feet with its inertia (m.tilt, sim/feel.js) and lurches ahead after a footfall (m.surge).
    const tp = m.tilt ? m.tilt.p.x : 0, tr = m.tilt ? m.tilt.r.x : 0;
    const B = chain(top || M.id(), M.T(0, -sag, 0), M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale), M.RX(tp), M.RZ((m.lean || 0) + tr), M.T(m.sway || 0, 0, m.surge || 0)), parts = R.mechParts[m.partsKey], sc = m.ch.scale;
    const BH = m.hipYaw ? chain(B, M.RY(m.hipYaw)) : B;   // the hips; the torso above them doesn't turn
    const fwd = [sin(m.yaw), 0, cos(m.yaw)];
    // Armour under a beam glows orange as it melts (another colour in a COLOURS mode), and runs hotter in IR.
    const mf = meltFrac(m), heatWas = R.drawHeat;
    const tint = mf ? mix3(VPtint || [1, 1, 1], hudPalette(app.prefs.colourMode).melt, mf * 0.6) : VPtint || [1, 1, 1];   // the glow follows COLOURS
    if (mf) R.drawHeat = min(1, R.drawHeat + mf * 0.3);
    const g = geoOf(m), back = mul(fwd, -1);
    if (R.skinned && !grab) BONES.fill(0);   // a part that isn't drawn this frame keeps a zero matrix
    putTint = tint;
    put(BONE.hip, parts.hip, chain(BH, M.T(0, g.hip, 0)));
    const hull = M.apply(B, [0, g.hip, 0]);
    // Legs reach for wherever the feet actually are; the knee bends forward,
    // backward (bird legs) or out and up (the quadruped's spider legs).
    m.feet.forEach((f, i) => {
      const leg = g.legs[i];
      if (m.hp[leg.hx > 0 ? 'LL' : 'RL'] <= 0) return;   // the leg came off; it's lying somewhere behind
      const H = M.apply(BH, [leg.hx, g.hip, leg.hz]);
      const out = norm([H[0] - hull[0], 0, H[2] - hull[2]]), splay = legSplay(m.squash ? m.squash.x : 0) + (m.dying ? (m.dying.buckle || 0) * 0.5 : 0);   // knees bow out as the legs give way
      let pole = g.knee === 'forward' ? fwd : g.knee === 'back' ? back : norm(add(out, [0, 0.9, 0]));
      if (splay > 0) pole = norm(add(pole, mul(out, splay)));   // knees bow out as the body squashes
      const A = place(add(f.pos, [0, g.ankle * sc, 0]));
      const polePlaced = top ? norm(sub(M.apply(top, add(hull, pole)), M.apply(top, hull))) : pole;
      const K = solveKnee(H, A, polePlaced, g.l1 * sc, g.l2 * sc);
      const ankle = add(K, mul(norm(sub(A, K)), g.l2 * sc));   // stays attached even if out of reach
      const bone = BONE.leg(i);
      put(bone, parts.uleg, limb(H, K, polePlaced, sc, M.id()));
      put(bone + 1, parts.lleg, limb(K, ankle, polePlaced, sc, M.id()));
      put(bone + 2, parts.foot, chain(top || M.id(), M.T(...(top ? M.apply(inverse3(top), ankle) : ankle)), M.RY(f.yaw), M.S(sc)));
    });
    // The thunk springs: a squash pulse on the whole body (down in y, out in x/z,
    // about the feet) and a wobble of the torso about the hips.
    // Armour under a beam doesn't jolt per frame; the whole mech sways slowly as it melts.
    const sway = meltFrac(m) * 0.03, swt = G.time * 2.4;
    const sq = (m.squash ? m.squash.x : 0) + (m.jet?.charge || 0) * 0.14, wp = (m.wob ? m.wob.p.x : 0) + sin(swt) * sway, wr = (m.wob ? m.wob.r.x : 0) + cos(swt * 0.8) * sway * 0.7;
    const pose = meleePose(m);
    const fists = parts.fist && meleeOf(m).fists ? fistPose(m) : null;   // with both arms gone it shoves like anyone else
    const spin = spinPose(m);   // a digger's arms turning like a paddle wheel, DIG held (sim/tools.js)
    const TB = chain(B, M.T(0, g.torsoY + (m.torsoDrop || 0), 0), M.S(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5), M.RY(m.twist + (fists ? fists.twist : 0)), M.T(0, 0, pose.lunge), M.RX(wp - pose.lean + (m.torsoNod || 0) + (m.runLean || 0)), M.RZ(wr));   // torsoDrop, torsoNod: the pendulum body; runLean: a run's lean forward (sim/gait.js)
    if (DARK > 0.05 && parts.lamps) { const l = m.lampAt || (m.lampAt = [[0, 0, 0], [0, 0, 0]]); placeInto(TB, parts.lamps[0], l[0]); placeInto(TB, parts.lamps[1], l[1]); }   // the headlamps, drawn after the run
    put(BONE.torso, parts.torso, TB);
    for (const [s, k, side] of [[1, 'LA', 0], [-1, 'RA', 1]]) {
      if (m.hp[k] <= 0) continue;
      // Fists follow the aim only a little; guns follow it all the way.
      const AM = chain(TB, M.T(s * g.armX, g.armY, 0), M.RX(spin ? -m.pitch * 0.3 + FIST_REST - spin[k] : fists ? -m.pitch * 0.3 + fists[k] : -m.pitch + pose.arm));
      put(BONE.arm[side], parts.arm, AM);
      if (parts.fist && grab) grab(BONE.arm[side], parts.fist, AM);
      else if (parts.fist && !R.skinned) R.draw(parts.fist, AM, tint);   // skinned, the fist rides on the arm's bone
      // The arm's gun, shaped by what is fitted there; nothing for an EMPTY hardpoint.
      const w = m.weapons.find(x => x.mount === k && x.def.kind !== 'fusion');
      if (w && parts.barrel) {
        const [bw, bl] = BARREL[w.type] || [1, 1], at = BARREL_AT[styleOf(m.ch)] || BARREL_AT[m.ch.legs] || BARREL_AT.forward;
        put(BONE.barrel[side], parts.barrel, chain(AM, M.T(...at), M.S(bw, bw, bl), M.T(-at[0], -at[1], -at[2])));
      }
    }
    if (R.skinned && !grab) R.drawSkinned(parts.skin, BONES, tint);
    R.drawHeat = heatWas;
  }
  // A mech's pose as the HUD's damage diagram draws it: every part's edges
  // (mesh/wire.js) with its matrix in the mech's own space (its feet at the
  // origin, facing +z, at scale 1) and its section. The same pose drawMech
  // gives it this frame (legs on their footfalls, the torso's twist and
  // wobble, the arms' aim), so the diagram walks as the mech does.
  // The pose is written into a pool that is reused every frame: { n, parts }.
  const WIRE = { n: 0, parts: Array.from({ length: 24 }, () => ({ edges: null, mat: new Float32Array(16), sec: 'T' })) };   // reused every frame
  let wireOf = null, wireInv = null, wireLegs = null;
  const wireSec = bone => {
    if (bone === BONE.arm[0] || bone === BONE.barrel[0]) return 'LA';
    if (bone === BONE.arm[1] || bone === BONE.barrel[1]) return 'RA';
    if (bone >= BONE.leg(0)) return wireLegs[Math.floor((bone - BONE.leg(0)) / 3)]?.hx > 0 ? 'LL' : 'RL';
    return 'T';
  };
  const grabWire = (bone, mesh, mat) => {
    const edges = wireOf.get(mesh);
    if (!edges || WIRE.n >= WIRE.parts.length) return;
    const p = WIRE.parts[WIRE.n++];
    p.edges = edges; p.mat.set(M.mul(wireInv, mat)); p.sec = wireSec(bone);
  };
  function poseWire(m) {
    const parts = R.mechParts[m.partsKey];
    if (!parts?.wire || !m.feet) return null;
    wireOf = parts.wire; wireLegs = geoOf(m).legs; WIRE.n = 0;
    wireInv = chain(M.S(1 / m.ch.scale), M.RY(-m.yaw), M.T(-m.x, -m.y, -m.z));
    grab = grabWire;
    try { drawMech(m); } finally { grab = null; }
    return WIRE;
  }
  // Muzzle flash: a hot streak out of the barrel for two frames. After the
  // mechs, so the skinned ones stay one run of draws in their own program.
  function drawFlash(m) {
    // Headlamps: two glowing blocks on the torso's face, at night, if they are on.
    if (DARK > 0.05 && m.lights && m.alive && !m.shutdown && m.lampAt) {
      const k = m.ch.scale * 0.42, c = LAMP_COL;
      for (const p of m.lampAt) R.draw(R.meshes.cube, chain(M.T(p[0], p[1], p[2]), M.RY(m.yaw + m.twist), M.S(k, k * 0.6, k * 0.4)), c, 1, 1);
    }
    const fl = m.flash;
    if (!fl || G.frame - fl.frame > 1) return;
    const d = fl.dir, yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1)), L = fl.big ? 3.2 : 1.6, w = fl.big ? 0.9 : 0.5;
    R.draw(R.meshes.beam, chain(M.T(...fl.p), M.RY(yw), M.RX(-pt), M.S(w, w, L)), [1, 0.9, 0.5], 1, 1);
  }

  // A blast-off's flight (docs/specs/26-blast-off.md): the view tips down with
  // the height, up to the jets' tilt at JETS_FLIGHT.tiltAt m, and eases back
  // level on landing; and a ring on the ground where it will come down, red
  // when that's on a mech's top (a stomp).
  let tiltNow = 0, tiltT = 0;
  function flightTilt(P) {
    const T = JETS[P.jets ?? 1], up = P.air && P.jet?.blasted && T ? P.y - G.ter.groundBelow(P.x, P.y, P.z) : 0;
    const want = T ? T.tilt * clampN(up / JETS_FLIGHT.tiltAt, 0, 1) : 0, dt = clampN(G.time - tiltT, 0, 0.1);
    tiltT = G.time;
    tiltNow += (want - tiltNow) * Math.min(1, dt * 5);
    return tiltNow;
  }
  const LAND_OK = [0.45, 1, 0.5], LAND_STOMP = [1, 0.3, 0.25];
  function drawLanding() {
    const P = G.player;
    if (!P?.alive || !P.air || !P.jet?.blasted) return;
    const at = landingAt(G, P);
    if (!at) return;
    const d = geoOf(P).radius * P.ch.scale * 2.4 + Math.sin(G.time * 9) * 0.4;   // a mech's width, breathing
    R.draw(R.meshes.fx.ring, chain(M.T(at.x, at.y + 0.35, at.z), M.S(d, 1, d)), at.mech ? LAND_STOMP : LAND_OK, 1);
  }

  // render()'s per-object loops live in their own functions: render() is too big
  // for the optimizing compiler, and unoptimized code boxes every number.
  function drawRemains() {
      // Shed arms and legs, tumbling or lying where they fell.
      R.drawHeat = 0.6;
      for (const d of G.debris) {
        const parts = R.mechParts[d.partsKey];
        if (!parts || !parts[d.part] || !seen(d.p[0], d.p[1], d.p[2], 5 * d.scale)) continue;
        R.draw(parts[d.part], chain(M.T(...d.p), M.RY(d.rot[1]), M.RX(d.rot[0]), M.RZ(d.rot[2]), M.S(d.scale)), [0.6, 0.58, 0.56]);   // at the end it sinks (sim/effects.js)
      }
  }
  // A wreck: the torso, hip and one leg's two halves in a heap; skinned, one
  // draw on the mech's own mesh with the other bones left at zero.
  const WRECK_DARK = [0.3, 0.28, 0.27];
  // A fresh wreck rocks and sinks a little before it lies still.
  function wreckBase(w) {
    const st = w.settle ?? 1, rock = (1 - st) * 0.2 * sin(w.t * 11), sink = 0.35 * w.scale * st;
    return chain(M.T(w.x, w.y - sink, w.z), M.RY(w.yaw), M.RX(rock), M.S(w.scale));
  }
  const wreckTorso = (B, w) => chain(B, M.T(0, 1.3, -1), M.RX(-1.2), M.RZ(w.roll));
  function drawWreck(w) {
    const parts = R.mechParts[w.type], B = wreckBase(w);
    if (R.skinned) BONES.fill(0);
    putTint = WRECK_DARK;
    put(BONE.torso, parts.torso, wreckTorso(B, w));
    put(BONE.hip, parts.hip, chain(B, M.T(0.5, 0.6, 1.5), M.RY(0.6)));
    put(BONE.leg(0), parts.uleg, chain(B, M.T(2.5, 0.6, 1), M.RZ(1.5)));
    put(BONE.leg(0) + 1, parts.lleg, chain(B, M.T(-2.6, 0.5, -0.5), M.RZ(-1.5), M.RY(1)));
    if (R.skinned) R.drawSkinned(parts.skin, BONES, WRECK_DARK);
  }
  // A burning wreck (spec 07 § Explosions): a glowing shell over its torso
  // that flickers and dies down over WRECK_BURN seconds. Its own draw, after
  // the skinned pass, so it works whichever way the wreck was drawn.
  const EMBER = [1, 0.4, 0.1], BURN_TINT = [0, 0, 0];
  function drawBurn(w) {
    const k = 1 - w.t / WRECK_BURN;
    if (k <= 0) return;
    const f = clampN(0.6 + 0.4 * sin(w.t * 13 + w.x) * sin(w.t * 7.7 + w.z), 0, 1), g = k * f;
    for (let i = 0; i < 3; i++) BURN_TINT[i] = WRECK_DARK[i] + (EMBER[i] - WRECK_DARK[i]) * g;
    R.draw(R.mechParts[w.type].torso, chain(wreckTorso(wreckBase(w), w), M.S(1.04)), BURN_TINT, g, 0.4 + 0.6 * g);
  }
  // Scorches (sim/effects.js scorch): one buffer of dark ragged octagons that
  // hug the ground, a slot per scorch. A new one rewrites only its own slot
  // (no garbage, however often missiles land); one draw for them all, with a
  // polygon offset so they sit on the terrain without fighting it.
  const SC_V = 24, SC_F = SC_V * 9, SC = new Float32Array(SCORCH_MAX * SC_F), SC_IDS = new Int32Array(SCORCH_MAX).fill(-1), SC_VER = new Int32Array(SCORCH_MAX);
  const SCORCH_COL = [0.09, 0.08, 0.07], SCORCH_MESH = { buf: null, count: SCORCH_MAX * SC_V };
  let scorchRev = -1;
  function writeScorch(s) {
    // On the ground at the blast (s.y: a crater's floor, a tunnel's), the rim on the first ground below.
    const ter = G.ter, o = s.slot * SC_F, y0 = s.y ?? ter.height(s.x, s.z), cy = y0 + 0.05;
    for (let k = 0; k < 8; k++) for (let v = 0; v < 3; v++) {
      const q = o + (k * 3 + v) * 9, j = k + v - 1, a = s.yaw + (j / 8) * TAU, r = s.r * (j % 2 ? 0.72 : 1);   // v 0: the middle; 1, 2: the rim
      const x = v === 0 ? s.x : s.x + sin(a) * r, z = v === 0 ? s.z : s.z + cos(a) * r;
      SC[q] = x; SC[q + 1] = v === 0 ? cy : ter.groundBelow(x, y0 + 3, z) + 0.05; SC[q + 2] = z;
      SC[q + 3] = 0; SC[q + 4] = 1; SC[q + 5] = 0;
      SC[q + 6] = SCORCH_COL[0]; SC[q + 7] = SCORCH_COL[1]; SC[q + 8] = SCORCH_COL[2];
    }
  }
  function drawScorches() {
    const gl = R.gl;
    if (!SCORCH_MESH.buf) { SCORCH_MESH.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, SCORCH_MESH.buf); gl.bufferData(gl.ARRAY_BUFFER, SC, gl.DYNAMIC_DRAW); R.curMesh = null; }
    if (scorchRev !== G.scorchRev) {
      scorchRev = G.scorchRev;
      gl.bindBuffer(gl.ARRAY_BUFFER, SCORCH_MESH.buf); R.curMesh = null;
      if (!G.scorches.length && SC_IDS.some(i => i >= 0)) { SC.fill(0); SC_IDS.fill(-1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, SC); }   // a new match
      for (const s of G.scorches) {
        if (SC_IDS[s.slot] === s.id && SC_VER[s.slot] === (s.v || 0)) continue;   // s.v: a dig moved it down (sim/dig.js)
        writeScorch(s); SC_IDS[s.slot] = s.id; SC_VER[s.slot] = s.v || 0;
        gl.bufferSubData(gl.ARRAY_BUFFER, s.slot * SC_F * 4, SC.subarray(s.slot * SC_F, (s.slot + 1) * SC_F));
      }
    }
    if (!G.scorches.length) return;
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -4);
    R.draw(SCORCH_MESH, M.id(), NO_SHADE, 0, 0);   // empty slots are all zeros: nothing drawn
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
  // World entities: structures and vehicles (a nav point has no body). Props
  // go into one instanced draw per mesh (render/propBatch.js); a toppled one,
  // and anything without a prop mesh, is drawn here on its own.
  const PROPS = makePropBatches(), ONE = {};
  // A construction site's hazard tape round its footprint, with a post at each
  // corner (docs/specs/23-construction-sites.md); a wall's slabs share one, drawn once.
  const TAPE = [0.95, 0.75, 0.1], POST = [0.12, 0.12, 0.13];
  function drawSite(e) {
    const [fw, fd, yaw] = e.foot, at = chain(M.T(e.x, G.ter.height(e.x, e.z), e.z), M.RY(yaw)), hw = fw / 2, hd = fd / 2;
    for (const [x, z, sx, sz] of [[0, hd, fw, 0.3], [0, -hd, fw, 0.3], [hw, 0, 0.3, fd], [-hw, 0, 0.3, fd]]) R.draw(R.meshes.cube, chain(at, M.T(x, 0.9, z), M.S(sx, 0.25, sz)), TAPE);
    for (const [x, z] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) R.draw(R.meshes.cube, chain(at, M.T(x, 0.6, z), M.S(0.3, 1.2, 0.3)), POST);
  }
  function drawEntity(e) {
    const base = M.T(e.x, e.y, e.z), w = e.radius * 1.7, dead = !e.alive;
    const col = dead ? mul(e.col, 0.35) : e.col, prop = propInto(e, ONE);
    if (prop) {
      // Punched over: rotates about its base, away from the fist, then lies there.
      const tilt = e.fall ? chain(M.RY(e.fall.yaw), M.RX(fallAngle(e)), M.RY(-e.fall.yaw)) : M.id();
      const at = chain(base, tilt, M.RY(e.yaw)), size = M.S(e.radius, prop.sy, e.radius), tint = [prop.tint, prop.tint, prop.tint];
      R.draw(R.meshes.props[prop.key], chain(at, size), tint);
      if (prop.head) R.draw(R.meshes.props[prop.head], chain(at, M.RY(e.headYaw || 0), size), tint);
      if (prop.glow) R.draw(R.meshes.props[prop.glow], chain(at, size), tint, 1);   // lava keeps its glow at night and in the fog's shade
    } else if (e.kind === 'nav') {
      return;
    } else if (e.kind === 'vehicle') {
      R.draw(R.meshes.cube, chain(base, M.RY(e.yaw), M.T(0, e.height / 2, -e.radius * 0.3), M.S(w, e.height, w * 1.6)), col);
      R.draw(R.meshes.cube, chain(base, M.RY(e.yaw), M.T(0, e.height * 0.4, e.radius * 1.35), M.S(w * 0.9, e.height * 0.8, w * 0.55)), mul(col, 0.7));
    } else if (e.fall) {   // punched over: rotates about its base, away from the fist, then lies there
      const tilt = chain(M.RY(e.fall.yaw), M.RX(fallAngle(e)), M.RY(-e.fall.yaw));
      R.draw(R.meshes.cube, chain(base, tilt, M.T(0, e.height / 2, 0), M.S(w, e.height, w)), col);
    } else {
      const h = dead ? e.height * 0.22 : e.height;   // blown up: a collapsed stump
      R.draw(R.meshes.cube, chain(base, M.RY(e.yaw), M.T(0, h / 2, 0), M.S(w, h, w)), col);
    }
  }
  function drawEntities(eye) {
    clearProps(PROPS);
    batchEntities(PROPS, G.entities, eye, FOG[1] + 60, seen, drawEntity);   // past the fog: skipped
    batchEntities(PROPS, G.scenery, eye, FOG[1] + 60, seen, drawEntity);
    R.drawProps(PROPS, R.meshes.props);
    for (const s of G.base?.sites || []) { const e = s.parts.find(p => p.alive); if (e?.foot) drawSite(e); }
  }
  function drawShotsAndBeams(eye, gd) {
      R.drawHeat = 1;
      for (const s of G.shots) {
        // The nose camera can't see its own volley flying alongside it.
        if (gd && s.guided && len(sub(s.p, eye)) < 8) continue;
        const d = norm(s.v), yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
        const sd = WEAPONS[s.type];
        if (sd?.bolt) { R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.7, 0.7, 3.4)), sd.col, 1); R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(1.3, 1.3, 1.6)), [0.8, 0.9, 1], 1); }
        else if (sd?.tracer) R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(sd.tw ?? 0.4, sd.tw ?? 0.4, sd.tl ?? 9)), sd.tracer, 1);   // a bright streak
        else if (s.kind === 'shell') R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.25, 0.25, 2.2)), [1, 0.85, 0.4], 1);
        else R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.35, 0.35, 1.2)), [1, 0.55, 0.25], 1);
      }
      // Fusion pulses: six sine waves, each in its own plane with its own
      // frequency and phase, writhing inside a packet that races down the
      // beam; the straight targeting beam stays lit underneath while it flies.
      for (const pu of G.pulses) {
        const v = sub(pu.b, pu.a), L = len(v), d = mul(v, 1 / (L || 1));
        const u = norm(cross(d, abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), w2 = cross(u, d);
        const yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
        if (!pu.hit) R.draw(R.meshes.beam, chain(M.T(...pu.a), M.RY(yw), M.RX(-pt), M.S(0.05, 0.05, L)), [0.85, 0.6, 1], 1);
        const head = min(1, pu.t / pu.dur) * L, pack = min(L, 34), fade = pu.hit ? max(0, 1 - (pu.t - pu.dur) / 0.25) : 1;
        if (fade <= 0) continue;
        const N = 28, tt = performance.now() / 1000;
        for (let k = 0; k < 6; k++) {
          const th = k * PI / 3 + pu.seed, amp = (0.9 + 0.3 * k) * fade, f = 0.22 + 0.09 * k, ph = pu.seed * (k + 1) + tt * (18 + 3 * k);
          const dirk = add(mul(u, cos(th)), mul(w2, sin(th)));
          let prev = null;
          for (let i = 0; i <= N; i++) {
            const sAlong = head - pack + (pack * i) / N;
            if (sAlong < 0) { prev = null; continue; }
            const env = sin(PI * i / N);   // the packet swells in the middle and tapers at both ends
            const q = add(add(pu.a, mul(d, sAlong)), mul(dirk, amp * env * sin(TAU * f * sAlong + ph)));
            if (prev) {
              const sv = sub(q, prev), sl = len(sv), sd = mul(sv, 1 / (sl || 1));
              R.draw(R.meshes.beam, chain(M.T(...prev), M.RY(atan2(sd[0], sd[2])), M.RX(-Math.asin(clampN(sd[1], -1, 1))), M.S(0.22, 0.22, sl)),
                mix3([1, 1, 1], [0.8, 0.55, 1], k / 8), 1);
            }
            prev = q;
          }
        }
      }
      for (const b of G.cbeams) {
        const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
        R.draw(R.meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w, b.w, l)), b.col, 1);
      }
      for (const b of G.beams) {
        const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
        const f = b.life / b.max;
        R.draw(R.meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w * (0.6 + f), b.w * (0.6 + f), l)),
          mix3([1, 1, 1], b.col, 0.4 + 0.6 * (1 - f)), 1);
      }
  }

  // The particle pool into the per-shape instance buffers. Its own small function
  // on purpose: render() is too big for the optimizing compiler, and unoptimized
  // code boxes every number it computes, which here meant ~150 bytes of garbage
  // per particle per frame.
  function fillEffects(P, hor) {
    for (let i = 0; i < P.n; i++) {
      const g = R.fx[SHAPE_BY_KIND[P.kind[i]]], i3 = i * 3;
      if (g.n >= R.FX_CAP || !seen(P.pos[i3], P.pos[i3 + 1], P.pos[i3 + 2], P.size[i] * 4)) continue;   // a flame's puff grows to ~3.5x
      effectLook(P, i, hor, LOOK);
      const d = g.data, o = g.n++ * R.FX_FLOATS;
      d[o] = P.pos[i3]; d[o + 1] = P.pos[i3 + 1]; d[o + 2] = P.pos[i3 + 2]; d[o + 3] = LOOK[0];
      d[o + 4] = P.spin[i]; d[o + 5] = P.spin[i] * TUMBLE_BY_KIND[P.kind[i]];
      d[o + 6] = LOOK[1]; d[o + 7] = LOOK[2]; d[o + 8] = LOOK[3]; d[o + 9] = LOOK[4]; d[o + 10] = LOOK[5]; d[o + 11] = LOOK[6];
    }
  }

  function render() {
    MA.reset();
    if (G.pal) fogOf(G, FOG);
    resize();
    R.draws = 0; R.culled = 0;
    if (!G.ter) return;
    R.gl.viewport(0, 0, cv.width, cv.height);
    const P = G.player, gd = G.guide, ir = !!gd;
    const IR_ZEN = [0.03, 0.03, 0.03], IR_HOR = [0.1, 0.1, 0.1];
    // Rain darkens the light; a lightning flash lifts the shading and the sky
    // toward white for 120 ms (data/weather.js).
    const wx = G.weather && WEATHER[G.weather.kind], flash = ir ? 0 : flashOf(G);
    for (let i = 0; i < 3; i++) {
      const s = (G.pal.shade ? G.pal.shade[i] : 1) * (wx && wx.dim ? wx.dim : 1);
      SHADE[i] = s + (FLASH_SHADE[i] - s) * flash;
      const wh = wx && wx.whiten ? wx.whiten * G.weather.intensity : 0;   // snow whitens the sky and the fog
      const tn = wx && wx.tint ? 0.5 * G.weather.intensity : 0, h0 = G.pal.hor[i] + (WHITE_SKY[i] - G.pal.hor[i]) * wh;   // dust turns the horizon orange
      const h = h0 + ((tn ? wx.tint[i] : 0) - h0) * tn, hz = wx && wx.haze ? wx.haze * G.weather.intensity : 0;   // fog and dust grey the zenith into the horizon
      const z0 = G.pal.zen[i] + (WHITE_SKY[i] - G.pal.zen[i]) * wh * 0.6, z = z0 + (h - z0) * hz;
      SKY_Z[i] = z + (FLASH_SKY[i] - z) * flash * 0.8;
      SKY_H[i] = h + (FLASH_SKY[i] - h) * flash * 0.6;
    }
    const hor = ir ? IR_HOR : SKY_H;
    R.gl.clearColor(hor[0], hor[1], hor[2], 1);
    R.gl.clear(R.gl.COLOR_BUFFER_BIT | R.gl.DEPTH_BUFFER_BIT);
    let fov, yaw, pitch, eye, dir, spec, walkCam, near = 0.5, far = 1800, top, up = UP;
    if ((G.state === 'edit' && (top = app.topView?.())) || (G.command && (top = app.command?.view()))) {
      // The mission editor (ui/editor.js): from above, in daylight with no fog,
      // the whole map in view. The command view (ui/command.js) the same, in the match's own light.
      fov = top.fov; eye = top.eye; dir = top.dir; near = top.near; far = top.far;
      yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
      FOG[0] = FOG[1] = 1e6;
    } else if (G.state === 'walk' && (walkCam = app.walk?.camera())) {
      // ?debug=1's walk viewer (ui/walkView.js): your mech, from outside.
      fov = walkCam.fov; eye = walkCam.eye; dir = walkCam.dir;
      yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
    } else if (G.state === 'menu') {
      // The main menu's mech: camera in front, aimed left of it so the mech
      // stands in the right-hand part of the screen beside the menu panel.
      // Pulled back a touch more on short screens, and framed so the mech
      // stands above the mech selector in the bottom-right corner.
      // The mech stands in the band between the top of the screen and the
      // top of the selector panel (menuBand), sized to fill it, whatever
      // the chassis's height and the screen's shape.
      const sel = document.querySelector('.mm-right .mm-select'), panelTop = sel ? sel.getBoundingClientRect().top - wrap.getBoundingClientRect().top : null;
      const aspect = W / max(1, H), band = menuBand(H, panelTop), tf = Math.tan((fov = 0.75) / 2);
      const h = geoOf(P).height * P.ch.scale * 1.15, mid = (band.top + band.bottom) / 2, half = (band.top - band.bottom) / 2;
      const wide = geoOf(P).radius * P.ch.scale * 1.6;   // half-width, legs splayed: the quadruped is wider than it is tall
      const R = max((h / 2) / (half * tf), aspect > 1 ? wide / (0.42 * tf * aspect) : 0);
      const c = [P.x, P.y + h / 2 / 1.15, P.z];
      eye = [c[0], c[1], c[2] + R];
      const off = aspect > 1 ? 0.4 * R * tf * aspect : 0, down = Math.atan(mid * tf);
      dir = norm(sub([c[0] - off, c[1] - Math.tan(down) * R, c[2]], eye));
      yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
    } else if (G.spectate && (spec = spectateCamera(G))) {
      // Waiting to respawn in the arena: a chase camera on another pilot (net/spectate.js).
      fov = (app.prefs?.fov || 62) * Math.PI / 180; eye = spec.eye; dir = norm(sub(spec.at, eye));
      yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
    } else if (gd) {
      // Riding just behind the volley, looking where it's going.
      fov = 0.95; yaw = gd.yaw; pitch = gd.pitch; dir = gd.dir;
      eye = add(gd.nose || gd.pos, add(mul(dir, 1.5), [0, 0.3, 0]));
    } else {
      fov = G.zoom ? 0.42 : (app.prefs?.fov || 62) * Math.PI / 180;   // the FOV setting; 62 degrees is the old 1.08 rad
      const sh = G.shake * 0.012, wv = FEEL.view.wobble * (G.reducedMotion ? FEEL.view.reducedScale : 1), wp = P.wob ? P.wob.p.x : 0, wr = P.wob ? P.wob.r.x : 0;
      yaw = viewYaw(P) + rnd(-sh, sh) + wr * wv * 0.5; pitch = P.pitch + rnd(-sh, sh) - (P.alive || P.dying || P.fallen ? 0 : 0.15) + wp * wv;
      // Your own weight: the view dips as you brake and lifts as you pull away (FEEL.inertia.view).
      if (P.tilt) pitch -= P.tilt.p.x * FEEL.inertia.view * (G.reducedMotion ? FEEL.view.reducedScale : 1);
      pitch -= flightTilt(P);   // up on a blast-off, the view tips down to the ground below (docs/specs/26-blast-off.md)
      // Running hot: the view swims, a slow breath in the field of view and a sway, until the reactor trips.
      const hot = hotFrac(P.heat) * (P.shutdown ? 0 : 1) * (G.reducedMotion ? FEEL.view.reducedScale : 1);
      if (hot > 0) { fov *= 1 + HEAT.fov * hot * sin(G.time * 2.6); yaw += HEAT.sway * hot * sin(G.time * 1.9); pitch += HEAT.sway * 0.6 * hot * cos(G.time * 1.3); }
      const drop = G.kick + (G.bob ? G.bob.x : 0);   // the instant kick plus the eased bob
      const fall = P.dying || P.fallen;
      const lurch = (P.surge || 0) * P.ch.scale * (G.reducedMotion ? FEEL.view.reducedScale : 1);   // and lurches with each step
      eye = add(G.eye, [Math.sin(P.yaw) * lurch, -drop * 0.35 - (P.squash ? P.squash.x * 2 : 0) - (P.jet?.charge || 0) * 1.1 * P.ch.scale - (P.sag ? P.sag.x : 0) - (fall ? fall.drop || 0 : 0), Math.cos(P.yaw) * lurch]); dir = dirOf(yaw, pitch - drop * 0.016);
      if (G.ter && !fall) eye = clearEye(G.ter, eye, dir, P.x, P.y + geoOf(P).torsoY * P.ch.scale, P.z);   // never see the inside of the ground
      // Going down: the view goes with the body, turned by the same topple
      // (so a fall to the side rolls the horizon), and stays there once it's
      // down until the debrief (P.fallen; spec 13 § Death).
      const top = toppleOf(P);
      if (top) {
        const o = M.apply(top, [0, 0, 0]), turn = v => norm(sub(M.apply(top, v), o));
        eye = M.apply(top, eye); dir = turn(dir); up = turn(UP);
        yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
      }
    }
    G.ear = eye; G.earYaw = yaw;   // sounds are heard from the camera
    const proj = M.persp(fov, W / max(1, H), near, far);
    const VP = M.mul(proj, M.lookAt(eye, add(eye, dir), up));
    G.VP = VP;
    frustumPlanes(VP, PLANES);   // culling (spec 14 P6): what is wholly outside the view isn't drawn

    // Sky.
    R.gl.disable(R.gl.DEPTH_TEST);
    R.gl.useProgram(R.skyProg);
    R.gl.bindBuffer(R.gl.ARRAY_BUFFER, R.skyBuf);
    const ap = R.gl.getAttribLocation(R.skyProg, 'aP');
    R.gl.enableVertexAttribArray(ap);
    R.gl.vertexAttribPointer(ap, 2, R.gl.FLOAT, false, 0, 0);
    R.gl.uniform3fv(R.SU.zen, ir ? IR_ZEN : SKY_Z); R.gl.uniform3fv(R.SU.hor, hor);
    R.gl.uniform1f(R.SU.h, 0.5 - 0.5 * Math.tan(pitch) / Math.tan(fov / 2)); R.gl.uniform1f(R.SU.res, cv.height);
    R.gl.drawArrays(R.gl.TRIANGLES, 0, 3);
    R.gl.disableVertexAttribArray(ap);

    R.gl.enable(R.gl.DEPTH_TEST);
    R.gl.useProgram(R.prog);
    R.curMesh = null;
    [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.enableVertexAttribArray(a));
    R.gl.uniformMatrix4fv(R.U.VP, false, VP);
    R.gl.uniform3fv(R.U.light, G.pal.light);
    R.gl.uniform3fv(R.U.shade, ir ? NO_SHADE : SHADE);   // the IR camera sees the same at night
    // Headlights (spec 07): one spot from the player's cockpit along the aim,
    // dipped a little, as strong as it is dark. Off in the IR camera, when the
    // player switches them off, and when the reactor is down.
    DARK = darkness(G.pal);
    const Pl = G.player;
    SPOT.on = DARK > 0.01 && !ir && G.state !== 'menu' && G.state !== 'edit' && !!(Pl && Pl.alive && Pl.lights && !Pl.shutdown && G.eye && G.view);
    if (SPOT.on) {
      SPOT.pos[0] = G.eye[0]; SPOT.pos[1] = G.eye[1] - 0.8; SPOT.pos[2] = G.eye[2];
      const dx = G.view[0], dy = G.view[1] - HEADLIGHTS.dip, dz = G.view[2], n = Math.hypot(dx, dy, dz);
      SPOT.dir[0] = dx / n; SPOT.dir[1] = dy / n; SPOT.dir[2] = dz / n;
      for (let i = 0; i < 3; i++) SPOT.col[i] = HEADLIGHTS.col[i] * DARK;
    }
    R.setSpot(R.U, SPOT);
    R.gl.uniform3fv(R.U.cam, eye);
    R.gl.uniform2f(R.U.fog, FOG[0], FOG[1]);
    R.gl.uniform3fv(R.U.fogCol, hor);
    R.gl.uniform1f(R.U.ir, ir ? 1 : 0);
    Object.assign(FRAME, { VP, spot: SPOT, light: G.pal.light, shade: ir ? NO_SHADE : SHADE, cam: eye, fog: FOG, fogCol: hor, ir: ir ? 1 : 0 }); R.frame = FRAME;   // the instanced effects shader's copy

    R.drawHeat = 0;
    drawWorld(eye);
    falls.draw(G);   // ground coming down (render/falls.js)
    drawScorches();
    // In the missile camera your own mech is out there too.
    R.drawHeat = 1;
    const shown = m => (m.alive || m.dying) && (m !== P || gd || G.state === 'menu' || G.state === 'edit' || walkCam) && seen(m.x, m.y + 6 * m.ch.scale, m.z, (m.dying ? 16 : 10) * m.ch.scale);
    if (R.skinned) R.beginSkinned();
    for (const m of G.mechs) if (shown(m)) drawMech(m);
    R.drawHeat = 0.45;
    for (const w of G.wrecks) if (seen(w.x, w.y + 2 * w.scale, w.z, 9 * w.scale)) drawWreck(w);
    R.drawHeat = 1;
    if (R.skinned) R.endSkinned();
    for (const w of G.wrecks) if (w.t < WRECK_BURN && seen(w.x, w.y + 2 * w.scale, w.z, 9 * w.scale)) drawBurn(w);
    for (const m of G.mechs) if (shown(m)) drawFlash(m);
    drawRemains();
    drawLanding();
    drawEntities(eye);
    drawShotsAndBeams(eye, gd);
    // Effects: one instanced draw per shape (spec 14 P1), each particle a
    // shape by its kind (mesh/effects.js), the dithering ones last; per-particle
    // draws where the instancing extension is missing (those don't dither:
    // smoke and dust just shrink and pop, as before).
    [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.disableVertexAttribArray(a));
    if (R.instanced) {
      fillEffects(G.parts, G.pal.hor);
      fillWeather(eye);
      R.drawEffects();
    } else {
      [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.enableVertexAttribArray(a));
      const P = G.parts;
      for (let i = 0; i < P.n; i++) {
        effectLook(P, i, G.pal.hor, LOOK);
        R.draw(R.meshes.fx[SHAPE_BY_KIND[P.kind[i]]], chain(M.T(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]), M.RY(P.spin[i]), M.RX(P.spin[i] * TUMBLE_BY_KIND[P.kind[i]]), M.S(LOOK[0])), [LOOK[1], LOOK[2], LOOK[3]], LOOK[4], LOOK[5]);
      }
      [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.disableVertexAttribArray(a));
    }

  }


  const view = { get W() { return W; }, get H() { return H; }, get dpr() { return dpr; } };
  return { resize, render, uploadWorld, view, poseWire, groundReady: () => ground.ready(), groundPending: ground.pending };
}
