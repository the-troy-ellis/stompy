// The construction mechs' tools (docs/specs/25-hold-to-dig.md): what the
// primary button does on a chassis with a `tool`, held. The digger's is DIG:
// its two arms spin like a paddle wheel, half a turn apart, and each bucket
// scoops as it comes round. Starting values; the pace is today's bite's
// (one 6 m bite every 1.2 s), so any change to it is a balance issue.
//   turn     s for a full turn of the arms at speed: a bucket comes round
//            every turn / 2
//   spinUp   s from still to full speed
//   bite     rad past hanging down where a bucket meets the face (forward,
//            a little below level): the scoop fires as it passes
//   r0, grow, steps   a run of scoops into one face (sim/tools.js runPoint):
//            the first r0 m across from its centre, each next one grow m
//            more, for steps scoops; then a new run where the face is now.
//            The 4 m ground needs a scoop past about 3.5 m to always take a
//            corner (docs/specs/29-ground-4m.md: on the 8 m grid it was 7 m,
//            with r0 3 and grow 1), so a run's later scoops are what make it
//            pay, and its biggest stays clear of the floor it stands on
//   into     m past the surface a run is centred
//   drift    m the aim's line can pass off a run's centre and keep it
//            The run is set so a held DIG at a face brings ore in at the
//            punch's pace: over 80 seeds at the range's mesa, 2% more ore than
//            the punch. A scoop cuts deeper rock than the punch's big bite
//            (which also took the soft top, no ore), so the same ore is fewer
//            corners: dirt comes in at about 70% of the punch's
//   reach    m (times the chassis's scale) the aim looks for ground: the
//            bucket's reach, as the punch's was
//   ramp     the steepest a scoop aimed up slopes its floor, rise over run
//            (docs/specs/30-dig-up.md): about 40°, under the digger's climb.
//            A ramp's scoops are centred rampAt m ahead (× scale), rampLift m
//            over where its floor will be
//   heat     a scoop's heat
//   clods    how many clods a scoop throws out of the face: [least, most]
//   dry      scoops in a row that turn no ground to air before a parked
//            digger tries its next aim (sim/miner.js): about one old bite
//   build    the builder's BUILD (docs/specs/31-builder.md): swing, s a crane
//            swing takes, held, and each one at a site in reach slams one
//            piece in (base.js buildSwing): the pace a digger built at, three
//            scoops a swing. heat: a swing's heat
export const TOOL = {
  build: { swing: 1.2, heat: 1 / 3 },
  dig: { turn: 0.8, spinUp: 0.15, bite: 1.0, lift: 4, ramp: 0.85, rampAt: 6, rampLift: 2, r0: 3, grow: 1, steps: 6, drift: 4, into: 2, reach: 14.3, heat: 1 / 3, dry: 3, clods: [4, 6] },
};
