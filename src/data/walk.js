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

// Gaits by class (docs/specs/16-body-plans.md), by leg type: how a plan's
// steps look, never how fast it goes. All live in the ?debug=1 FEEL panel.
//   cadence    footfalls a second at top speed (a quad's pairs count once); the
//              stride follows from it, within the legs' reach
//   runAt      share of top speed where a runner starts to run (2: never)
//   runSwing   share of the cycle a running foot is in the air (> 0.5: a flight phase)
//   crouch     how far the hips sink at full speed, model units
//   lift       step height at a walk and added at full speed, model units
//   liftEarly  < 1 peaks the lift early, so the foot comes down steeply
//   slam       0 eases the foot into the ground, 1 drives it in and stops it dead
//   drop       how far the hull dips at each footfall, model units
//   surge      how far the body lurches forward after each footfall and eases back over the step, model units
//   bounce     how far the hull rises over a swinging leg, model units
//   sway       how far the hips shift over the planted foot, model units
//   hipTurn    how far the hips turn with the stride, radians (the torso doesn't)
export const GAIT = {
  forward: { cadence: 1.7, runAt: 2, runSwing: 0.42, crouch: 0.8, lift: [0.6, 0.9], liftEarly: 0.6, slam: 0.85, drop: 0.24, surge: 0.35, bounce: 0.04, sway: 0.2, hipTurn: 0.08 },
  reverse: { cadence: 3.0, runAt: 0.55, runSwing: 0.62, crouch: 0.45, lift: [0.5, 1.2], liftEarly: 0.85, slam: 0.3, drop: 0.08, surge: 0.1, bounce: 0.4, sway: 0.06, hipTurn: 0.04 },
  quad: { cadence: 1.4, runAt: 2, runSwing: 0.34, crouch: 0.4, lift: [0.4, 0.6], liftEarly: 0.6, slam: 0.75, drop: 0.2, surge: 0.2, bounce: 0.03, sway: 0.1, hipTurn: 0.03 },
};
