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
//            The 8 m ground needs a scoop past about 7 m to always take a
//            corner, so a run's last scoops are what make it pay
//   into     m past the surface a run is centred
//   drift    m the aim's line can pass off a run's centre and keep it
//            The run is set so a held DIG at a face brings ore in at the
//            punch's pace: over 80 seeds at the range's mesa, 2% more ore than
//            the punch. A scoop cuts deeper rock than the punch's big bite
//            (which also took the soft top, no ore), so the same ore is fewer
//            corners: dirt comes in at about 70% of the punch's
//   reach    m (times the chassis's scale) the aim looks for ground: the
//            bucket's reach, as the punch's was
//   heat     a scoop's heat
//   perSwing scoops at a construction site that make one swing of work
//            (docs/specs/23-construction-sites.md): today's pace
//   dry      scoops in a row that turn no ground to air before a parked
//            digger tries its next aim (sim/miner.js): about one old bite
export const TOOL = {
  dig: { turn: 0.8, spinUp: 0.15, bite: 1.0, r0: 3, grow: 1, steps: 6, drift: 4, into: 2, reach: 14.3, heat: 1 / 3, perSwing: 3, dry: 3 },
};
