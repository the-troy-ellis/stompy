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
//   runCadence the same, running (blended in as the run comes on)
//   runMin     top speed in m/s below which a mech never runs (a heavy keeps walking)
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
//   plantBack  how far the stance moves back under the body, walking and running, as a share of
//              half a stance: a foot lands nearer the hips and pushes off further behind
//   runLean    how far the torso pitches forward at a full run, radians (a sprinter's lean)
//   runDrop    how far the hips sink at a full run, model units
// The PENDULUM body only (BODY below; sim/gait.js § The pendulum body):
//   knee       the planted leg's knee right over its foot, degrees (180: dead straight); the hull rides that high
//   runKnee    the same, running (blended in as the run comes on; none: knee)
//   kneeFast   degrees less knee at a fast walk (not a run): the reach a long stride wants, with less bob
//   vault      share of the pole's fall away from upright the hull keeps (0: level; 1: a rigid pole)
//   sink       how hard a footfall pushes the hull down, m/s
//   bodyK      the spring a footfall pushes the hull down on (stiffer: a quicker bounce back), 1/s²
//   bodyZeta   its damping (1: no overshoot; less: it bobs once after a footfall)
//   speedUp    how much faster the hull goes low between steps than high over a leg (share of speed)
//   lag        how far behind the hull the torso follows, s (its spring's time)
//   nod        the torso's nod forward per metre it lags, radians
export const GAIT = {
  forward: { cadence: 1.7, runCadence: 2.6, runMin: 12, runAt: 0.55, runSwing: 0.6, crouch: 0.8, lift: [0.6, 0.9], liftEarly: 0.6, slam: 0.85, drop: 0.24, surge: 0.35, bounce: 0.04, sway: 0.2, hipTurn: 0.08, runLean: 0.2, runDrop: 0.4, plantBack: [0.1, 0.35],
    knee: 145, kneeFast: 20, vault: 0.3, sink: 1.1, bodyK: 70, bodyZeta: 0.55, speedUp: 0.12, lag: 0.045, nod: 0.3 },
  reverse: { cadence: 3.0, runCadence: 3.0, runMin: 0, runAt: 0.55, runSwing: 0.62, crouch: 0.45, lift: [0.5, 1.2], liftEarly: 0.85, slam: 0.3, drop: 0.08, surge: 0.1, bounce: 0.4, sway: 0.06, hipTurn: 0.04, runLean: 0.28, runDrop: 0.5, plantBack: [0.25, 0.5],
    knee: 100, runKnee: 125, vault: 0.5, sink: 0.5, bodyK: 140, bodyZeta: 0.6, speedUp: 0.08, lag: 0.03, nod: 0.15 },
  quad: { cadence: 1.4, runAt: 2, runSwing: 0.34, crouch: 0.4, lift: [0.4, 0.6], liftEarly: 0.6, slam: 0.75, drop: 0.2, surge: 0.2, bounce: 0.03, sway: 0.1, hipTurn: 0.03,
    knee: 105, vault: 0.5, sink: 0.8, bodyK: 90, bodyZeta: 0.6, speedUp: 0.06, lag: 0.05, nod: 0.15 },
};

// Which body rides the legs (the walk viewer's MODEL switch, ui/walkView.js):
// 'pendulum', the hull vaulting over the planted leg on a spring, the torso
// following late (the owner's pick, 2026-10-22); or 'old', the drawn bob, dip
// and lurch above, kept in the viewer to compare.
export const BODY = { model: 'pendulum' };
