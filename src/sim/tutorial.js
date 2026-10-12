// Mission 1's silent tutorial (docs/specs/11-release.md § Silent tutorial):
// which prompt is up, and when the pilot has done it. Steps (data/tutorial.js)
// come one at a time, in order, skipping any this mech can't do; events
// (a JACKAL in reach, heat over 60, a second hostile) break in once each when
// they happen. Nothing shows twice. The screens decide whether it runs (first
// time only) and remember it ran; render/hud.js draws G.tut.cur.
import { TUT_STEPS, TUT_EVENTS, TUT } from '../data/tutorial.js';
import { CAT_OF } from '../data/weapons.js';
import { meleeOf } from '../data/melee.js';
import { wrapA } from '../util/math.js';

const { abs, hypot } = Math;

export function newTutorial(G) {
  return { seen: new Set(), cur: null, wait: TUT.gap, yaw: G.player.yaw, turned: 0, held: 0, cycles: 0, done: false };
}

// Whether the player's mech can do a step at all (no missiles: no missile prompt).
function can(P, s) {
  if (s.cat) return P.weapons.some(w => CAT_OF[w.type] === s.cat);
  if (s.jets) return P.jets > 0;
  return true;
}

// Whether an event is happening now.
function happening(G, id) {
  const P = G.player, foes = G.mechs.filter(m => m.alive && m.team !== 0);
  if (id === 'heat') return P.heat > TUT.heatAt;
  if (id === 'punch') {
    const reach = meleeOf(P).reach * P.ch.scale * 1.3;
    return foes.some(m => m.type === 'jackal' && hypot(m.x - P.x, m.z - P.z) < reach);
  }
  if (id === 'target') return foes.filter(m => hypot(m.x - P.x, m.z - P.z) < TUT.pair).length >= 2;
  return false;
}

// Whether the pilot has done what the prompt up now asks.
function did(G, T, id, input) {
  const P = G.player;
  switch (id) {
    case 'go': return P.throttle > TUT.going;
    case 'legs': return T.turned > TUT.turned;
    case 'torso': return abs(P.twist) > TUT.twisted;
    case 'melt': return T.held > TUT.melted;
    case 'thump': return !!input.held?.ballistic;
    case 'missiles': return !!input.missileTap || !!input.held?.missile;
    case 'jump': return !!P.jetting;
    case 'punch': return !!input.punch || !!P.melee;
    case 'heat': return P.heat < TUT.heatAt - 20;
    case 'target': return (G.cycles || 0) > T.cycles;
    default: return true;
  }
}

// Up it comes; T.cycles is how many T presses there had been, so T: NEXT ONE knows the next one.
const show = (G, T, s, event) => { T.cur = { ...s, event, t: 0, fade: 0 }; T.cycles = G.cycles || 0; };

// One frame. `input` is the sim's snapshot.
export function tickTutorial(G, input, dt) {
  const T = G.tut, P = G.player;
  if (!T || !P?.alive) return;
  T.turned += abs(wrapA(P.yaw - T.yaw)); T.yaw = P.yaw;
  if (input.held?.energy) T.held += dt;
  const c = T.cur;
  if (c) {
    c.t += dt;
    if (c.fade > 0) {
      c.fade += dt;
      if (c.fade >= TUT.fade) { T.cur = null; T.wait = TUT.gap; }
      return;
    }
    const timedOut = c.t > (c.event ? TUT.eventFor : TUT.giveUp);
    if (did(G, T, c.id, input) || timedOut) { T.seen.add(c.id); c.fade = 1e-6; return; }
    // An event breaks in on a step not yet done (the step comes back later).
    if (!c.event) {
      const e = TUT_EVENTS.find(e => !T.seen.has(e.id) && happening(G, e.id));
      if (e) show(G, T, e, true);
    }
    return;
  }
  if ((T.wait -= dt) > 0) return;
  const e = TUT_EVENTS.find(e => !T.seen.has(e.id) && happening(G, e.id));
  if (e) { show(G, T, e, true); return; }
  const s = TUT_STEPS.find(s => !T.seen.has(s.id) && can(P, s));
  for (const x of TUT_STEPS) if (!can(P, x)) T.seen.add(x.id);
  if (s) show(G, T, s, false);
  else T.done = true;   // every step shown; events may still come
}
