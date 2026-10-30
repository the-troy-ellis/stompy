import { seamAt } from '../world/seams.js';
import { cheat } from './cheats.js';
import { BIG_DIG } from '../data/debug.js';
import { DIG, CRUSH, TORQUE, WEAPONS } from '../data/weapons.js';
import { CONSTRUCT } from '../data/construct.js';
import { FINE_DIG } from '../data/fineDig.js';
import { sceneryNear, destroyEntity } from './entities.js';
import { particle, msg } from './effects.js';
import { viewYaw } from './geom.js';
import { cloneGround, VS, Y0, PX, PY } from '../world/voxels.js';
import { HALF } from '../world/terrain.js';
import { feel } from './feel.js';
import { damage } from './combat.js';
import { geoOf } from '../data/geo.js';

const { hypot, min, max, round } = Math;

// Digging in play (docs/specs/18-voxel-ground.md § Digging in play, § Sync).
// Every blast that digs comes through `dig`: the ground is carved (soft
// ground to the full radius, the rock band to DIG.rock of it, bedrock not at
// all), scorches, props and structures in reach settle onto what's left, and,
// in a networked game, the dig is queued to go out (net/client.js flushes
// G.pendingDigs with the hits). Only the client that owns a blast digs it:
// another pilot's shell explodes here without digging, and their `digs`
// arrive from the relay. Re-applying a dig changes nothing (carving takes the
// smaller of the ground and the hole), so each client applies every dig the
// relay echoes, its own included.
//
// Falls (§ Falling ground) don't commute with digs, so they are worked out
// on the confirmed ground: the digs in the relay's order and nothing else.
// Every client has the same confirmed ground, so every client finds the same
// falls, a late joiner replaying the room's list too; nothing more goes over
// the wire. In single player the ground is its own confirmed ground. Online,
// G.terC is a copy kept in the relay's order, and G.ter is it plus this
// client's own digs not echoed yet (`G.unechoed`), carved again after a fall.

// Whether this client decides blasts by `m` (a mech, a turret or null for the
// world): everything in single player; in the arena, your own; in co-op, your
// own, and as host the enemies' and the world's.
export function ownsDigs(G, m) {
  if (G.mode !== 'mp' && (G.role || 'solo') === 'solo') return true;
  if (m) return m === G.player || (!m.remote && G.role === 'host');
  return G.role === 'host';
}
// How big a hole a weapon's hit digs (data/weapons.js `dig`), and a mech's death blast.
export const digOf = type => WEAPONS[type]?.dig || 0;
export const deathDig = m => min(DIG.death * m.ch.scale, DIG.deathMax);

const q = (v, s) => round(v / s) * s;   // on the wire: positions to 0.25 m, radii to 0.5 m
const NEAR = [];
const online = G => G.mode === 'mp' || (G.role || 'solo') !== 'solo';
// The confirmed ground: the ground itself in single player; online a copy
// made from the fresh ground (before this client's first dig on it).
function confirmed(G) {
  if (!online(G)) return G.ter;
  if (!G.terC || G.terC.of !== G.ter) { G.terC = cloneGround(G.ter); G.terC.of = G.ter; G.unechoed = []; }
  return G.terC;
}

// A blast at `p` digging a hole of radius `r`, if this client owns it.
export function dig(G, p, r, owned = true) {
  if (!(r > 0) || !owned || !G.ter) return;
  const big = cheat(G, 'digs');   // BIG DIGS (sim/cheats.js): single player only, so never on the wire
  if (big) r *= BIG_DIG.scale;
  const x = q(p[0], 0.25), y = q(p[1], 0.25), z = q(p[2], 0.25), rr = q(r, 0.5);
  // Nothing within reach below it (a missile popping in the air): nothing to dig, nothing to send.
  if (G.ter.groundBelow(x, y + rr, z, y - rr) <= y - rr) return;
  if (!online(G)) { confirmDig(G, [0, x, y, z, rr], true, big ? 1 : DIG.rock); return; }
  confirmed(G);   // copied before the first dig touches the ground
  G.ter.dig([x, y, z], rr, DIG.rock);   // ours, at once; confirmed when the relay echoes it
  settle(G, x, z, rr);
  G.pendingDigs.push([0, x, y, z, rr]);
  G.unechoed.push([0, x, y, z, rr]);
}

// The digger's bite (docs/specs/20-build-and-fight.md § The digger): a dig
// of CONSTRUCT.bucket where the bucket meets the ground, rock at full size,
// that fills the hopper with ore for each rock corner (under the soft band)
// it turned to air: a little for plain rock, a lot for a seam, more the
// deeper it runs (seamOre; docs/specs/21-mining.md); soft ground gives none.
// A full hopper still digs. Single player: online a bite is a plain dig that
// syncs and gives no ore (spec 20 § Edge cases). Returns the ore it got, and
// sets `m.seamBite` when a seam paid for it (the sparkle, melee.js) and
// `m.biteCorners` to how many corners it turned to air.
export const seamOre = depth => CONSTRUCT.orePerSeam * Math.min(CONSTRUCT.seamMax, 1 + Math.max(0, depth) / CONSTRUCT.seamDeep);
export function bite(G, m, p, r = CONSTRUCT.bucket) {
  m.seamBite = false; m.biteCorners = 0;
  if (!G.ter || online(G)) { dig(G, p, r, ownsDigs(G, m)); return 0; }
  const x = q(p[0], 0.25), y = q(p[1], 0.25), z = q(p[2], 0.25), seed = G.ter.seed;
  let got = 0, seams = 0;
  const tally = { rock: 0, soft: 0, corner: (cx, cy, cz, depth) => { if (seamAt(seed, cx, cy, cz)) { got += seamOre(depth); seams++; } else got += CONSTRUCT.orePerCorner; } };
  confirmDig(G, [0, x, y, z, r], true, 1, tally);
  const ore = Math.max(0, Math.min(m.ch.hopper - (m.ore || 0), Math.round(got)));
  m.ore = (m.ore || 0) + ore;
  m.seamBite = seams > 0;
  m.biteCorners = tally.soft + tally.rock;   // none: the bucket scraped the hole's side (sim/miner.js moves on)
  m.biteRock = tally.rock > 0;   // what its clods look like (sim/tools.js)
  m.dirt = Math.min(CONSTRUCT.dirtMax, (m.dirt || 0) + (tally.soft + tally.rock) * CONSTRUCT.dirtPerCorner);   // what it digs out stays in the bucket as dirt (DUMP, below)
  return ore;
}

// DUMP (docs/specs/21-mining.md § Dirt; the ENERGY button while you drive a
// digger): tips CONSTRUCT.dumpCost of the bucket's dirt out as a pile, a
// cone dumpH high and dumpR across its foot, about the hole one bite leaves,
// dumpAt metres ahead. It lands on whatever is there, so piles stack into
// berms and ramps. Single player, as a bite's ore is: online, building ground
// isn't sent yet. True if it tipped.
export function dump(G, m) {
  if (!G.ter || online(G)) return false;
  if ((m.dirt || 0) < CONSTRUCT.dumpCost) { if (m === G.player) msg(G, 'NO DIRT', '#fc3'); return false; }
  const s = m.ch.scale, yaw = viewYaw(m), d = CONSTRUCT.dumpAt * s, r = CONSTRUCT.dumpR, h = CONSTRUCT.dumpH;
  const x = q(m.x + Math.sin(yaw) * d, 0.25), z = q(m.z + Math.cos(yaw) * d, 0.25);
  G.ter.pile(x, z, h, r);
  const y = G.ter.height(x, z) - h * 0.5;
  m.dirt -= CONSTRUCT.dumpCost;
  settle(G, x, z, r);
  if (G.nav) G.nav.mark(x, z, r);
  feel(G, 'land', { mech: m, k: 0.35, at: m === G.player ? null : [x, y, z] });
  for (let i = 0; i < 16; i++) particle(G, [x + G.rng.range(-r, r) * 0.5, y + h * 0.5, z + G.rng.range(-r, r) * 0.5], [G.rng.range(-2, 2), G.rng.range(1, 3), G.rng.range(-2, 2)], G.rng.range(0.8, 1.4), G.rng.range(1, 2), G.pal.low, 'dust');
  return true;
}

// Digs off the wire (the relay's `digs`, or the room's list in `welcome`):
// [seq, op, x, y, z, r] each, in the relay's order. Anything malformed is skipped.
// `replay`: the room's list in `welcome`, the past: falls in it land at once, unseen.
export function applyDigList(G, l, replay = false) {
  if (!Array.isArray(l) || !G.ter) return;
  for (const d of l) {
    if (!Array.isArray(d) || d.length !== 6 || !d.every(Number.isFinite)) continue;
    const [seq, op, x, y, z, r] = d;
    if (op === 0 && r > 0 && r <= DIG.deathMax) confirmDig(G, [0, x, y, z, r], !replay);
    if (seq > G.digSeq) G.digSeq = seq;
  }
}

// The DIGS AND FALLS overlay's log (?debug=1, ui/tuning.js, drawn by
// render/hud.js): each dig's box, each fall's box where it came from, and
// each overhang the torque rule weighed. G.digLog is null unless the overlay
// is on, so it costs nothing then; it keeps the last DIG_LOG_S seconds.
export const DIG_LOG_S = 10;
function logDig(G, e) {
  const L = G.digLog;
  e.t = G.time;
  while (L.length && (L[0].t < G.time - DIG_LOG_S || L[0].t > G.time)) L.shift();   // old, or from a match before this one
  L.push(e);
}

// One dig in the confirmed order: carved, the ground it leaves unheld falls,
// and what stood there settles. `seen`: the falls are shown coming down.
function confirmDig(G, e, seen, rock = DIG.rock, tally = null) {
  const [, x, y, z, r] = e, C = confirmed(G), b = C.dig([x, y, z], r, rock, tally);
  const falls = b ? C.islands(b).map(cells => C.fall(cells)) : [];
  // Then what still holds on but hangs too far off what holds it (the torque rule); a break can leave another.
  const weighed = G.digLog ? [] : null;
  for (let n = 0; b && n < TORQUE.rounds; n++) {
    const breaks = C.overhangs(b, TORQUE.rock, null, weighed);
    if (!breaks.length) break;
    for (const cells of breaks) falls.push(C.fall(cells));
  }
  if (G.digLog) {
    logDig(G, { kind: 'dig', box: [x - r, y - r, z - r, x + r, y + r, z + r] });
    for (const w of weighed) logDig(G, { kind: 'weigh', ...w });
    for (const f of falls) { const [i0, i1, j0, j1, k0, k1] = f.box; logDig(G, { kind: 'fall', box: [-HALF + i0 * VS, Y0 + j0 * VS, -HALF + k0 * VS, -HALF + i1 * VS, Y0 + j1 * VS, -HALF + k1 * VS] }); }
  }
  if (C !== G.ter) {
    const k = G.unechoed.findIndex(u => u[1] === x && u[2] === y && u[3] === z && u[4] === r);
    if (k >= 0) G.unechoed.splice(k, 1);   // our own, back from the relay
    G.ter.dig([x, y, z], r, DIG.rock);
    if (falls.length) {
      // Where ground fell and landed, ours becomes the confirmed bytes, and
      // our own digs not echoed yet are carved again on top.
      for (const f of falls) { const [i0, i1, j0, j1, k0, k1] = f.box; G.ter.copyBox(C, [i0 - 1, i1 + 1, max(j0 - f.drop - 1, 0), j1 + 1, k0 - 1, k1 + 1]); }
      for (const u of G.unechoed) G.ter.dig([u[1], u[2], u[3]], u[4], DIG.rock);
    }
    C.dirty.clear();
  }
  settle(G, x, z, r);
  for (const f of falls) startFall(G, f, seen);
  if (G.nav) {   // the AI's map looks at the ground here again (ai/nav.js)
    G.nav.mark(x, z, r);
    for (const f of falls) { const [i0, i1, , , k0, k1] = f.box; G.nav.mark(-HALF + (i0 + i1) / 2 * VS, -HALF + (k0 + k1) / 2 * VS, Math.max(i1 - i0, k1 - k0) * VS / 2 + VS); }
  }
}

// Ground coming down (world/voxels.js fall has already moved it in the
// grid): G.falls holds it while it is drawn falling (render/scene.js meshes
// it from its cells); when it lands, the thunk and what it lands on.
function startFall(G, f, seen) {
  let sx = 0, sz = 0, lo = Infinity, hi = -Infinity;
  const cols = new Set();
  for (const o of f.cells) {
    const i = o % PX, j = ((o / PX) | 0) % PY, k = (o / (PX * PY)) | 0;
    sx += i; sz += k; lo = min(lo, j); hi = max(hi, j); cols.add(i + PX * k);
  }
  const n = f.cells.length, at = [-HALF + (sx / n) * VS, Y0 + lo * VS, -HALF + (sz / n) * VS];
  const [i0, i1, , , k0, k1] = f.box, reach = hypot(i1 - i0 + 1, k1 - k0 + 1) * VS / 2;
  settle(G, at[0], at[2], reach);   // what stood on it: props break, scorches and wrecks drop
  const fall = { ...f, n, cols, at, top: Y0 + hi * VS, dropM: f.drop * VS, off: 0, vy: 0, reach };
  if (seen) G.falls.push(fall);
  else land(G, fall, false);
}
// Each frame: the falling ground drops under gravity until it lands.
export function stepFalls(G, dt) {
  if (!G.falls.length) return;
  for (const f of G.falls) {
    f.vy += 18 * dt; f.off = min(f.dropM, f.off + f.vy * dt);
    if (f.off >= f.dropM) {
      f.landed = true; land(G, f, true);
      const [i0, i1, j0, j1, k0, k1] = f.box;
      if (f.heap) G.ter.mark([i0, i1, Math.max(j0 - f.drop, 2), j1 - f.drop, k0, k1]);   // the heap shows now (render/ground.js hid it while it fell)
    }
  }
  G.falls = G.falls.filter(f => !f.landed);
}
// A fall lands: the mechs under it take the crush (on the client that owns
// each), props and structures under it break, and the landing thunks.
function land(G, f, seen) {
  const under = (x, z) => f.cols.has(round((x + HALF) / VS) + PX * round((z + HALF) / VS));
  const bottom = f.at[1] - f.dropM, top = f.top - f.dropM;
  if (seen) {
    for (const m of G.mechs) {
      if (!m.alive || !ownsDigs(G, m) || !under(m.x, m.z) || m.y > top || m.y < bottom - VS - 1) continue;   // under it: from a cell below its bottom row to its top
      damage(G, m, [m.x, m.y + (geoOf(m).legTop + 1) * m.ch.scale, m.z], min(CRUSH.max, CRUSH.perCell * f.n), null);   // to the torso
    }
  }
  const n = sceneryNear(G, f.at[0], f.at[2], f.reach + 8, NEAR);
  for (let i = 0; i < n; i++) { const e = NEAR[i]; if (e.alive && under(e.x, e.z) && e.y < top + 1) breakProp(G, e, f.at[0] + 0.01, f.at[2]); }
  if (ownsDigs(G, null)) for (const e of G.entities) if (e.alive && e.kind !== 'nav' && under(e.x, e.z) && e.y < top + 1) destroyEntity(G, e, null);
  if (!seen) return;
  const r = G.rng, p = [f.at[0], bottom, f.at[2]], big = f.n >= 40;
  const near = G.player ? max(0, 1 - hypot(G.player.x - p[0], G.player.z - p[2]) / 160) : 0;
  feel(G, 'blast', { mech: null, k: near * min(1, 0.3 + f.n / 120), at: p });
  G.fx.sfx.boom(p, big);
  const dust = min(40, 6 + f.n);
  for (let i = 0; i < dust; i++) particle(G, [p[0] + r.range(-1, 1) * f.reach, bottom + 1, p[2] + r.range(-1, 1) * f.reach], [r.range(-4, 4), r.range(1, 5), r.range(-4, 4)], r.range(1.5, 3), r.range(1.5, 3.5), [0.42, 0.36, 0.3], 'smoke');
  if (!f.heap) for (let i = 0; i < 14; i++) particle(G, [p[0], bottom + 3, p[2]], [r.range(-9, 9), r.range(4, 14), r.range(-9, 9)], r.range(1.2, 2.2), r.range(0.6, 1.4), [0.35, 0.3, 0.26], 'debris', 26);   // a small piece shatters
}

// Fine patches settling (docs/specs/27-fine-dig.md; the patches are
// world/finePatch.js's). Dug again, a patch's clock starts over. FINE_DIG
// settleAfter s after its last edit, with no mech standing on it, it slumps:
// over settleTime its ground blends into the 8 m ground's, with a rumble and
// dust, then it goes and what stood on it settles. Stood on, it waits up to
// settleWait s more. The fine ground is never rock where the 8 m ground is
// air (world/finePatch.js patchSample), so a slump only fills bites back in: a
// mech standing in one is lifted as it fills, never dropped. One pushed out
// by too many patches (`force`) doesn't wait.
export function stepFinePatches(G, dt) {
  const P = G.ter?.patches, F = FINE_DIG, me = G.player;
  if (!P) return;
  if (me) { const n = (G.ter.fineNear ||= [0, 0, F.far]); n[0] = me.x; n[1] = me.z; }   // where new patches may be born (world/voxels.js)
  if (!P.length) return;
  for (let n = P.length - 1; n >= 0; n--) {   // backwards: a patch that goes leaves the rest in place
    const p = P[n], cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (me && hypot(me.x - cx, me.z - cz) > F.far + (p.x1 - p.x0) / 2) { gone(G, p); continue; }   // far off: unseen, at once
    if (p.seen !== p.edits) { p.seen = p.edits; p.at = G.time; p.settling = false; }
    if (!p.settling) {
      const idle = G.time - p.at;
      if (!p.force && (idle < F.settleAfter || (idle < F.settleAfter + F.settleWait && standing(G, p)))) continue;
      p.settling = true; p.blend = 0;
      settleFx(G, p);
    }
    p.blend = min(1, p.blend + dt / F.settleTime);
    p.rev++;
    if (!(G.time - (p.topsAt ?? -1) < 0.1) || p.blend >= 1) { G.ter.topsOf(p); p.topsAt = G.time; }
    if (p.blend >= 1) gone(G, p);
  }
}
// A patch goes: the 8 m ground there again, and what stood on it settles onto it.
function gone(G, p) {
  G.ter.dropPatch(p);
  settle(G, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, hypot(p.x1 - p.x0, p.z1 - p.z0) / 2);
}
// Whether a mech is on the ground over a patch.
function standing(G, p) {
  for (const m of G.mechs) {
    if (!m.alive || m.air) continue;
    const r = geoOf(m).radius * m.ch.scale;
    if (m.x > p.x0 - r && m.x < p.x1 + r && m.z > p.z0 - r && m.z < p.z1 + r && m.y < p.y1 + 2 && m.y > p.y0 - 2) return true;
  }
  return false;
}
// The slump starting: a low rumble and a soft thump, felt by how near, and dust along the patch's ground.
function settleFx(G, p) {
  const r = G.rng, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, at = [cx, G.ter.height(cx, cz), cz];
  const near = G.player ? max(0, 1 - hypot(G.player.x - cx, G.player.z - cz) / 120) : 0;
  if (near > 0) feel(G, 'settle', { mech: null, k: near, at });
  G.fx.sfx.settle(at);
  for (let i = 0; i < FINE_DIG.dust; i++) {
    const x = r.range(p.x0 + VS, p.x1 - VS), z = r.range(p.z0 + VS, p.z1 - VS), y = G.ter.groundBelow(x, p.y1, z);
    particle(G, [x, y + 0.5, z], [r.range(-1.5, 1.5), r.range(0.5, 2), r.range(-1.5, 1.5)], r.range(1.4, 2.4), r.range(1.2, 2.4), G.pal.low, 'dust');
  }
}

// What stood in reach of a dig: scorches, wrecks and debris move down onto
// the new ground, structures and props settle onto it, and a prop with nothing under it breaks.
function settle(G, x, z, r) {
  const ter = G.ter;
  for (const s of G.scorches) {
    if (hypot(s.x - x, s.z - z) > r + s.r) continue;
    const y = ter.groundBelow(s.x, (s.y ?? ter.height(s.x, s.z)) + 1, s.z);
    if (y !== s.y) { s.y = y; s.v = (s.v || 0) + 1; G.scorchRev++; }
  }
  for (const w of G.wrecks) if (hypot(w.x - x, w.z - z) < r + 4 * w.scale) w.y = Math.min(w.y, ter.groundBelow(w.x, w.y + 1, w.z));
  for (const d of G.debris) if (d.landed && hypot(d.p[0] - x, d.p[2] - z) < r + 1) { d.landed = false; d.bounced = true; }   // it drops onto the new ground
  for (const e of G.entities) {
    if (hypot(e.x - x, e.z - z) > r + e.radius) continue;
    e.y = Math.min(e.y, ter.groundBelow(e.x, e.y + 1, e.z));   // a mission's own structures settle; the host decides if they break
  }
  const n = sceneryNear(G, x, z, r + 8, NEAR);
  for (let i = 0; i < n; i++) {
    const e = NEAR[i];
    if (!e.alive || hypot(e.x - x, e.z - z) > r + e.radius) continue;
    const g = ter.groundBelow(e.x, e.y + 1, e.z), drop = e.y - g;
    if (drop <= 0.05) continue;
    if (drop > PROP_DROP) breakProp(G, e, x, z);
    else e.y = g;
  }
}
// A prop that loses more than this much ground under it breaks instead of settling.
export const PROP_DROP = 3;
function breakProp(G, e, x, z) {
  e.alive = false; e.wreck = true; e.downAt = G.time;
  e.fall = { yaw: Math.atan2(e.x - x, e.z - z), t: 0 };   // over it goes, away from the blast
  const r = G.rng;
  for (let i = 0; i < 6; i++) particle(G, [e.x, e.y + e.height * 0.5, e.z], [r.range(-3, 3), r.range(1, 4), r.range(-3, 3)], r.range(1, 2), r.range(1, 2), [0.3, 0.28, 0.25], 'smoke');
}
