import { backingSize } from './look.js';
import { effectLook, SHAPE_BY_KIND } from '../mesh/effects.js';
import { M as M0, add, makeMatrixArena, frustumPlanes, sphereVisible, clampN, dirOf, mix3, mul, norm, rnd, sub, len, cross, TAU } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { buildTerrainMesh } from '../world/terrainMesh.js';
import { viewYaw } from '../sim/geom.js';
import { solveKnee, limb } from '../sim/gait.js';
import { meltFrac } from '../sim/beams.js';
import { FEEL, HEAT, hotFrac } from '../data/feel.js';
import { meleeOf } from '../data/melee.js';
import { BARREL_AT, styleOf, BONE, BONE_COUNT } from '../mesh/mechParts.js';
import { darkness, HEADLIGHTS } from '../data/palettes.js';
import { fogOf, flashOf, WEATHER } from '../data/weather.js';
import { makeWeatherBox, stepWeatherBox } from './weatherBox.js';
import { fallAngle } from '../sim/entities.js';
import { propFor } from '../mesh/props.js';
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
export function toppleOf(m) {
  const d = m.dying;
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
export function createScene(app) {
  const G = app.G, R = app.R, wrap = app.wrap, cv = app.cv, hud = app.hud;
  let world = null;
  // The terrain mesh on the GPU, rebuilt whenever the sim builds a new world.
  function uploadWorld() {
    if (world) R.gl.deleteBuffer(world.buf);
    world = R.upload(buildTerrainMesh(G.ter, G.pal, G.ter.seed));
  }

  // Scan tone: a pulsing whine that climbs as the scan converges.


  // The HUD canvas is always full resolution; the 3D canvas renders R.look.lines
  // tall (0: full) and the browser scales it up with hard edges (render/look.js).
  const NO_SHADE = [1, 1, 1], LAMP_COL = [1, 0.95, 0.75];
  const SPOT = { on: false, pos: [0, 0, 0], dir: [0, 0, 1], col: [0, 0, 0], cone: [Math.cos(HEADLIGHTS.cone[0]), Math.cos(HEADLIGHTS.cone[1])], range: HEADLIGHTS.range };
  let DARK = 0;   // how dark this frame is (palettes.js darkness)
  const FOG = [0, 0];   // this frame's fog distances: the palette's, cut by the weather (data/weather.js)
  const SHADE = [1, 1, 1], SKY_Z = [0, 0, 0], SKY_H = [0, 0, 0], FLASH_SHADE = [1.8, 1.8, 2.0], FLASH_SKY = [0.78, 0.8, 0.92], WHITE_SKY = [0.86, 0.89, 0.94];
  // Rain and snow (spec 07): drops in a box round the camera, one instanced
  // draw each. Rain is thin streaks leaning with the wind; snow is small
  // octahedra drifting down, turning and swaying. `clear`: metres round the
  // cockpit kept free, so nothing sits on the canopy.
  const WX_LOOK = {
    rain: { shape: 'streak', count: 1500, fall: 22, size: 1.8, col: [0.6, 0.66, 0.76], glow: 0.3, clear: 6, lean: true },
    snow: { shape: 'octa', count: 800, fall: 1.6, size: 0.32, col: [0.95, 0.96, 1], glow: 0.55, clear: 5, sway: 0.5 },
  };
  const box = makeWeatherBox(2500), WX_VEL = [0, 0, 0];
  let wxTime = null;
  function fillWeather(eye) {
    const w = G.weather, L = w && WX_LOOK[w.kind];
    if (!L) { box.n = 0; return; }
    const dt = wxTime == null ? 0 : Math.min(0.1, Math.max(0, G.time - wxTime));
    wxTime = G.time;
    WX_VEL[0] = w.wind[0]; WX_VEL[1] = -L.fall; WX_VEL[2] = w.wind[1];   // the wind is [x, z]
    stepWeatherBox(box, eye, Math.round(L.count * w.intensity * (G.touchUI ? 0.6 : 1)), WX_VEL, dt);
    const g = R.fx[L.shape], yaw = Math.atan2(w.wind[0], w.wind[1]), lean = L.lean ? Math.atan2(Math.hypot(w.wind[0], w.wind[1]), L.fall) : 0, t = G.time;
    for (let i = 0; i < box.n && g.n < R.FX_CAP; i++) {
      const i3 = i * 3, dx = box.pos[i3] - eye[0], dz = box.pos[i3 + 2] - eye[2];
      if (dx * dx + dz * dz < L.clear * L.clear) continue;
      const d = g.data, o = g.n++ * R.FX_FLOATS, sw = L.sway ? Math.sin(t * 0.9 + i * 1.7) * L.sway : 0;
      d[o] = box.pos[i3] + sw; d[o + 1] = box.pos[i3 + 1]; d[o + 2] = box.pos[i3 + 2] + sw * 0.6; d[o + 3] = L.size;
      d[o + 4] = L.lean ? yaw : t * 0.7 + i * 1.3; d[o + 5] = L.lean ? lean : t * 0.45 + i;
      d[o + 6] = L.col[0]; d[o + 7] = L.col[1]; d[o + 8] = L.col[2]; d[o + 9] = L.glow; d[o + 10] = 0; d[o + 11] = 0;
    }
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
  let putTint = null;
  const put = (bone, mesh, mat) => {
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
    const B = chain(top || M.id(), M.T(0, -sag, 0), M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale), M.RZ(m.lean || 0)), parts = R.mechParts[m.partsKey], sc = m.ch.scale;
    const fwd = [sin(m.yaw), 0, cos(m.yaw)];
    // Armour under a beam glows orange as it melts, and runs hotter in IR.
    const mf = meltFrac(m), heatWas = R.drawHeat;
    const tint = mf ? mix3(VPtint || [1, 1, 1], [2.2, 0.8, 0.25], mf * 0.6) : VPtint || [1, 1, 1];
    if (mf) R.drawHeat = min(1, R.drawHeat + mf * 0.3);
    const g = geoOf(m), back = mul(fwd, -1);
    if (R.skinned) BONES.fill(0);   // a part that isn't drawn this frame keeps a zero matrix
    putTint = tint;
    put(BONE.hip, parts.hip, chain(B, M.T(0, g.hip, 0)));
    const hull = M.apply(B, [0, g.hip, 0]);
    // Legs reach for wherever the feet actually are; the knee bends forward,
    // backward (bird legs) or out and up (the quadruped's spider legs).
    m.feet.forEach((f, i) => {
      const leg = g.legs[i];
      if (m.hp[leg.hx > 0 ? 'LL' : 'RL'] <= 0) return;   // the leg came off; it's lying somewhere behind
      const H = M.apply(B, [leg.hx, g.hip, leg.hz]);
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
    const sq = m.squash ? m.squash.x : 0, wp = (m.wob ? m.wob.p.x : 0) + sin(swt) * sway, wr = (m.wob ? m.wob.r.x : 0) + cos(swt * 0.8) * sway * 0.7;
    const pose = meleePose(m);
    const fists = parts.fist && meleeOf(m).fists ? fistPose(m) : null;   // with both arms gone it shoves like anyone else
    const TB = chain(B, M.T(0, g.torsoY, 0), M.S(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5), M.RY(m.twist + (fists ? fists.twist : 0)), M.T(0, 0, pose.lunge), M.RX(wp - pose.lean), M.RZ(wr));
    if (DARK > 0.05 && parts.lamps) { const l = m.lampAt || (m.lampAt = [[0, 0, 0], [0, 0, 0]]); placeInto(TB, parts.lamps[0], l[0]); placeInto(TB, parts.lamps[1], l[1]); }   // the headlamps, drawn after the run
    put(BONE.torso, parts.torso, TB);
    for (const [s, k, side] of [[1, 'LA', 0], [-1, 'RA', 1]]) {
      if (m.hp[k] <= 0) continue;
      // Fists follow the aim only a little; guns follow it all the way.
      const AM = chain(TB, M.T(s * g.armX, g.armY, 0), M.RX(fists ? -m.pitch * 0.3 + fists[k] : -m.pitch + pose.arm));
      put(BONE.arm[side], parts.arm, AM);
      if (parts.fist && !R.skinned) R.draw(parts.fist, AM, tint);   // skinned, the fist rides on the arm's bone
      // The arm's gun, shaped by what is fitted there; nothing for an EMPTY hardpoint.
      const w = m.weapons.find(x => x.mount === k && x.def.kind !== 'fusion');
      if (w && parts.barrel) {
        const [bw, bl] = BARREL[w.type] || [1, 1], at = BARREL_AT[styleOf(m.ch)] || BARREL_AT[m.ch.legs] || BARREL_AT.forward;
        put(BONE.barrel[side], parts.barrel, chain(AM, M.T(...at), M.S(bw, bw, bl), M.T(-at[0], -at[1], -at[2])));
      }
    }
    if (R.skinned) R.drawSkinned(parts.skin, BONES, tint);
    R.drawHeat = heatWas;
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

  // render()'s per-object loops live in their own functions: render() is too big
  // for the optimizing compiler, and unoptimized code boxes every number.
  function drawRemains() {
      // Shed arms and legs, tumbling or lying where they fell.
      R.drawHeat = 0.6;
      for (const d of G.debris) {
        const parts = R.mechParts[d.partsKey];
        if (!parts || !parts[d.part] || !seen(d.p[0], d.p[1], d.p[2], 5 * d.scale)) continue;
        const fade = d.t > d.life - 2 ? (d.life - d.t) / 2 : 1;
        R.draw(parts[d.part], chain(M.T(...d.p), M.RY(d.rot[1]), M.RX(d.rot[0]), M.RZ(d.rot[2]), M.S(d.scale * (0.6 + 0.4 * fade))), [0.6, 0.58, 0.56]);
      }
  }
  // A wreck: the torso, hip and one leg's two halves in a heap; skinned, one
  // draw on the mech's own mesh with the other bones left at zero.
  const WRECK_DARK = [0.3, 0.28, 0.27];
  function drawWreck(w) {
    // A fresh wreck rocks and sinks a little before it lies still.
    const st = w.settle ?? 1, rock = (1 - st) * 0.2 * sin(w.t * 11), sink = 0.35 * w.scale * st;
    const parts = R.mechParts[w.type], B = chain(M.T(w.x, w.y - sink, w.z), M.RY(w.yaw), M.RX(rock), M.S(w.scale));
    if (R.skinned) BONES.fill(0);
    putTint = WRECK_DARK;
    put(BONE.torso, parts.torso, chain(B, M.T(0, 1.3, -1), M.RX(-1.2), M.RZ(w.roll)));
    put(BONE.hip, parts.hip, chain(B, M.T(0.5, 0.6, 1.5), M.RY(0.6)));
    put(BONE.leg(0), parts.uleg, chain(B, M.T(2.5, 0.6, 1), M.RZ(1.5)));
    put(BONE.leg(0) + 1, parts.lleg, chain(B, M.T(-2.6, 0.5, -0.5), M.RZ(-1.5), M.RY(1)));
    if (R.skinned) R.drawSkinned(parts.skin, BONES, WRECK_DARK);
  }
  function drawEntities(eye) {
      // World entities: structures and vehicles (a nav point has no body). Plain
      // boxes until the prop meshes (#98) arrive; past the fog they are skipped.
      const far = FOG[1] + 60;
      for (const e of G.entities) {
        if ((e.kind === 'nav' && !e.mesh) || (!e.alive && !e.wreck)) continue;
        if (Math.hypot(e.x - eye[0], e.z - eye[2]) > far) continue;
        if (!seen(e.x, e.y + (e.height || 0) / 2, e.z, Math.max(e.height || 0, e.radius * 2) + 2)) continue;
        const base = M.T(e.x, e.y, e.z), w = e.radius * 1.7, dead = !e.alive;
        const col = dead ? mul(e.col, 0.35) : e.col, prop = propFor(e);
        if (prop) {
          // Punched over: rotates about its base, away from the fist, then lies there.
          const tilt = e.fall ? chain(M.RY(e.fall.yaw), M.RX(fallAngle(e)), M.RY(-e.fall.yaw)) : M.id();
          const at = chain(base, tilt, M.RY(e.yaw)), size = M.S(e.radius, prop.sy, e.radius), tint = [prop.tint, prop.tint, prop.tint];
          R.draw(R.meshes.props[prop.key], chain(at, size), tint);
          if (prop.head) R.draw(R.meshes.props[prop.head], chain(at, M.RY(e.headYaw || 0), size), tint);
        } else if (e.kind === 'nav') {
          continue;
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
      d[o + 4] = P.spin[i]; d[o + 5] = P.spin[i] * 0.7;
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
      const h = G.pal.hor[i] + (WHITE_SKY[i] - G.pal.hor[i]) * wh, hz = wx && wx.haze ? wx.haze * G.weather.intensity : 0;   // fog and dust grey the zenith into the horizon
      const z0 = G.pal.zen[i] + (WHITE_SKY[i] - G.pal.zen[i]) * wh * 0.6, z = z0 + (h - z0) * hz;
      SKY_Z[i] = z + (FLASH_SKY[i] - z) * flash * 0.8;
      SKY_H[i] = h + (FLASH_SKY[i] - h) * flash * 0.6;
    }
    const hor = ir ? IR_HOR : SKY_H;
    R.gl.clearColor(hor[0], hor[1], hor[2], 1);
    R.gl.clear(R.gl.COLOR_BUFFER_BIT | R.gl.DEPTH_BUFFER_BIT);
    let fov, yaw, pitch, eye, dir;
    if (G.state === 'menu') {
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
    } else if (gd) {
      // Riding just behind the volley, looking where it's going.
      fov = 0.95; yaw = gd.yaw; pitch = gd.pitch; dir = gd.dir;
      eye = add(gd.nose || gd.pos, add(mul(dir, 1.5), [0, 0.3, 0]));
    } else {
      fov = G.zoom ? 0.42 : (app.prefs?.fov || 62) * Math.PI / 180;   // the FOV setting; 62 degrees is the old 1.08 rad
      const sh = G.shake * 0.012, wv = FEEL.view.wobble * (G.reducedMotion ? FEEL.view.reducedScale : 1), wp = P.wob ? P.wob.p.x : 0, wr = P.wob ? P.wob.r.x : 0;
      yaw = viewYaw(P) + rnd(-sh, sh) + wr * wv * 0.5; pitch = P.pitch + rnd(-sh, sh) - (P.alive || P.dying ? 0 : 0.15) + wp * wv;
      // Running hot: the view swims, a slow breath in the field of view and a sway, until the reactor trips.
      const hot = hotFrac(P.heat) * (P.shutdown ? 0 : 1) * (G.reducedMotion ? FEEL.view.reducedScale : 1);
      if (hot > 0) { fov *= 1 + HEAT.fov * hot * sin(G.time * 2.6); yaw += HEAT.sway * hot * sin(G.time * 1.9); pitch += HEAT.sway * 0.6 * hot * cos(G.time * 1.3); }
      const drop = G.kick + (G.bob ? G.bob.x : 0);   // the instant kick plus the eased bob
      eye = add(G.eye, [0, -drop * 0.35 - (P.squash ? P.squash.x * 2 : 0) - (P.sag ? P.sag.x : 0) - (P.dying ? P.dying.drop || 0 : 0), 0]); dir = dirOf(yaw, pitch - drop * 0.016);
      // Going down: the view goes with the body.
      const top = toppleOf(P);
      if (top) { eye = M.apply(top, eye); const toward = cos(P.dying.fallYaw - yaw); pitch -= P.dying.angle * toward; yaw += P.dying.angle * 0.3 * sin(P.dying.fallYaw - yaw); dir = dirOf(yaw, pitch); }
    }
    G.ear = eye; G.earYaw = yaw;   // sounds are heard from the camera
    const proj = M.persp(fov, W / max(1, H), 0.5, 1800);
    const VP = M.mul(proj, M.lookAt(eye, add(eye, dir)));
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
    SPOT.on = DARK > 0.01 && !ir && G.state !== 'menu' && !!(Pl && Pl.alive && Pl.lights && !Pl.shutdown && G.eye && G.view);
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
    R.draw(world, M.id());
    // In the missile camera your own mech is out there too.
    R.drawHeat = 1;
    const shown = m => (m.alive || m.dying) && (m !== P || gd || G.state === 'menu') && seen(m.x, m.y + 6 * m.ch.scale, m.z, (m.dying ? 16 : 10) * m.ch.scale);
    if (R.skinned) R.beginSkinned();
    for (const m of G.mechs) if (shown(m)) drawMech(m);
    R.drawHeat = 0.45;
    for (const w of G.wrecks) if (seen(w.x, w.y + 2 * w.scale, w.z, 9 * w.scale)) drawWreck(w);
    R.drawHeat = 1;
    if (R.skinned) R.endSkinned();
    for (const m of G.mechs) if (shown(m)) drawFlash(m);
    drawRemains();
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
        R.draw(R.meshes.fx[SHAPE_BY_KIND[P.kind[i]]], chain(M.T(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]), M.RY(P.spin[i]), M.RX(P.spin[i] * 0.7), M.S(LOOK[0])), [LOOK[1], LOOK[2], LOOK[3]], LOOK[4], LOOK[5]);
      }
      [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.disableVertexAttribArray(a));
    }

  }


  const view = { get W() { return W; }, get H() { return H; }, get dpr() { return dpr; } };
  return { resize, render, uploadWorld, view };
}
