import { add, clampN, dirOf, dot, mul, norm, sub } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { CAT_OF } from '../data/weapons.js';
import { damage, fire } from './combat.js';
import { explode } from './effects.js';
import { r2 } from '../net/protocol.js';
import { knock } from './knock.js';
import { damageEntity, solid } from './entities.js';
import { FEEL } from '../data/feel.js';
import { sendsFx } from './hitqueue.js';

const { atan2, hypot, max } = Math;

// Missiles: tap to fire, hold to fly them, let go to detonate.
export const HOLD_TO_GUIDE = 220;   // ms: shorter is a tap
export const BLAST_R = 10;          // metres: a near miss still hurts
export const SEND_HZ = 15;

// Called every frame with whether the missile control is held. One volley
// per press; hold past HOLD_TO_GUIDE and you take over that volley.
export function missileTrigger(G, down) {
  if (down && !G.mDown) {
    G.mDown = true; G.mAt = G.clock;
    G.mVid = fireCat(G, 'missile') ? G.lastVolley : 0;
  } else if (down) {
    if (!G.guide && G.mVid && G.clock - G.mAt >= HOLD_TO_GUIDE) startGuide(G, G.mVid);
  } else if (G.mDown) {
    G.mDown = false;
    if (G.guide) endGuide(G, true);
  }
}

const guidedLive = (G, vid) => G.shots.filter(s => s.vid === vid && s.owner === G.player && s.life > 0 && !s.ghost);
const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);

export function startGuide(G, vid) {
  const ms = guidedLive(G, vid);
  if (!ms.length) return;
  const d = norm(ms[0].v);
  G.guide = { vid, yaw: atan2(d[0], d[2]), pitch: Math.asin(clampN(d[1], -1, 1)), dir: d, pos: centroid(ms), lost: 0, sendT: 0, n: ms.length };
  for (const s of ms) { s.guided = true; s.target = null; s.life = max(s.life, 9); }
  G.zoom = false;
  G.fx.sfx.beep();
}

// Each frame while flying: aim follows input, camera follows the volley.
export function steerVolley(G, dt) {
  const g = G.guide;
  g.dir = dirOf(g.yaw, g.pitch);
  const ms = guidedLive(G, g.vid);
  g.n = ms.length;
  if (ms.length) {
    g.pos = centroid(ms); g.fuel = max(...ms.map(s => s.life));
    // The camera rides in the nose of whichever missile is out in front,
    // so the volley and its smoke trail are behind it, not in the shot.
    g.nose = ms.reduce((a, s) => (dot(sub(s.p, g.pos), g.dir) > dot(sub(a.p, g.pos), g.dir) ? s : a)).p;
  }
  else if ((g.lost += dt) > 0.6) { endGuide(G, false); return; }   // all hit something: "signal lost", then home
  if (sendsFx(G, G.player) && (g.sendT += dt) >= 1 / SEND_HZ && ms.length) { g.sendT = 0; G.fx.netSend({ t: 'fx', k: 'mg', v: g.vid, p: g.pos.map(r2), d: g.dir.map(r2) }); }
}
export function steerBy(G, dx, dy, sens, invertY) {
  const g = G.guide;
  g.yaw -= dx * sens;
  g.pitch = clampN(g.pitch - dy * sens * (invertY ? -1 : 1), -1.3, 1.3);
}

// Let go: every missile still flying blows up where it is. Then back to the cockpit.
export function endGuide(G, detonate) {
  const g = G.guide;
  if (!g) return;
  if (detonate) {
    for (const s of guidedLive(G, g.vid)) { s.life = -1; blast(G, s.p, s.dmg, s.owner, null); explode(G, s.p, false); }
    if (sendsFx(G, G.player)) G.fx.netSend({ t: 'fx', k: 'md', v: g.vid });
  }
  G.guide = null;
}

// Splash: anything within BLAST_R takes damage falling off with distance,
// on the side facing the blast. Not the mech it hit directly (that took
// the full hit), and never the mech that fired it.
export function blast(G, p, dmg, owner, direct) {
  for (const m of G.mechs) {
    if (!m.alive || m === owner || m === direct) continue;
    const g = geoOf(m), R = g.radius * m.ch.scale, top = m.y + g.height * m.ch.scale;
    const hx = p[0] - m.x, hz = p[2] - m.z, hd = hypot(hx, hz);
    const dy = p[1] < m.y ? m.y - p[1] : p[1] > top ? p[1] - top : 0;
    const d = hypot(max(0, hd - R), dy);
    if (d >= BLAST_R) continue;
    const nx = hd > 0.01 ? hx / hd : 1, nz = hd > 0.01 ? hz / hd : 0;
    const at = [m.x + nx * R, clampN(p[1], m.y + 1, top - 1), m.z + nz * R];
    damage(G, m, at, dmg * 0.8 * (1 - d / BLAST_R), owner);
    // The blast shoves too: away from it, falling off with distance, by the masses involved.
    if (m.alive) knock(G, { target: m, attacker: owner, base: FEEL.blast.push * (1 - d / BLAST_R), dir: [-nx, -nz], recoil: false });   // the firer is far away
  }
  // Structures and vehicles in the radius take the same falloff (the one hit directly took the full shot already).
  for (const e of G.entities) {
    if (!solid(e) || e === direct) continue;
    const hd = hypot(p[0] - e.x, p[2] - e.z), top = e.y + e.height;
    const dy = p[1] < e.y ? e.y - p[1] : p[1] > top ? p[1] - top : 0, d = hypot(Math.max(0, hd - e.radius), dy);
    if (d < BLAST_R) damageEntity(G, e, dmg * 0.8 * (1 - d / BLAST_R), owner, [e.x, clampN(p[1], e.y + 0.5, top - 0.5), e.z]);
  }
}

// Fire every weapon of one kind that's ready; held, each refires as it recharges.
export function fireCat(G, cat) {
  const P = G.player;
  let any = false;
  for (const w of P.weapons) if (CAT_OF[w.type] === cat) any = fire(G, P, w, G.aim, G.lock ? G.target : null) || any;
  return any;
}
export function alpha(G) {
  const P = G.player;
  for (const w of P.weapons) fire(G, P, w, G.aim, G.lock ? G.target : null);   // beams skip themselves
}
export function cycleTarget(G) {
  const foes = [...G.mechs.filter(m => m.alive && m.team !== 0), ...G.entities.filter(e => e.alive && e.targetable)]
    .sort((a, b) => hypot(a.x - G.player.x, a.z - G.player.z) - hypot(b.x - G.player.x, b.z - G.player.z));
  if (!foes.length) return;
  const i = foes.indexOf(G.target);
  G.target = foes[(i + 1) % foes.length];
  G.fx.sfx.beep();
}
