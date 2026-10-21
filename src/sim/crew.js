import { feel } from './feel.js';

// The crew (docs/specs/20-build-and-fight.md § Swapping mechs): the mechs
// on your side you can drive, in G.crew, in order; G.player is the one you
// are in. SWAP moves you to the next live one. The one you leave is parked:
// it stands where it is (no throttle, no jets, no shots), takes hits and can
// die. Ordering parked mechs about comes later (spec 20 § Room to grow).
// A match without a crew is a crew of one, and nothing here changes it.
export const SWAP_WIPE = 0.3;   // s: the cockpit's static wipe after a swap (render/hud.js)
export const HANDOVER = 2.2;    // s: after the mech you are in dies, the next live one is yours

export const crewOf = G => (G.crew && G.crew.length ? G.crew : [G.player]);
// The next live crew mech after the one you are in, or null.
export function nextCrew(G) {
  const c = crewOf(G), i = c.indexOf(G.player);
  for (let k = 1; k < c.length; k++) { const m = c[(i + k) % c.length]; if (m.alive) return m; }
  return null;
}
export function park(m) { m.parked = true; m.throttle = 0; m.jetting = false; m.beamOn = false; m.centring = false; }
// Into the next live crew mech. False when there is none.
export function swap(G) {
  const n = nextCrew(G);
  if (!n) return false;
  if (G.player.alive) park(G.player);
  G.player = n; n.parked = false;
  G.target = null; G.guide = null; G.mDown = false;
  G.swapT = G.time;
  feel(G, 'land', { mech: n, k: 0.5 });
  G.fx.say(`${n.ch.name}.`);   // the voice's caption puts the name on screen too
  return true;
}
