// Walking feel (roadmap M1): the ground pushes back. Uphill is slow, downhill
// is a little quick, and a landing digs the feet in before the legs get going
// again. Footfall dust and the landing dust live in the feel table.
export const WALK = {
  slopeUp: 2.5,     // speed factor lost per unit of grade going up (a 20% grade costs half)
  slopeDown: 0.75,  // gained per unit of grade going down
  slopeMin: 0.5, slopeMax: 1.15,
  digCut: 0.6,      // fraction of forward speed a full-force landing takes away
  digHold: 0.35,    // s a full-force landing holds the legs before they drive again
  digSlow: 0.3,     // top speed factor while held
};
