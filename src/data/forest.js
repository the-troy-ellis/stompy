// The forest (docs/specs/39-forest.md): starting values to tune in play.
// This spec is the balance issue for them.
//   gap      the trees' average spacing in thick woods (m)
//   cell     the field's cells (m): trees are kept sorted by them
//   clear    how much of the woods are clearings (the noise's cut, -2..2: higher, more clearing)
//   paths    old logging roads across the map, `pathW` m wide
//   slope    no tree where the ground climbs more than this a metre
//   draw     how far round the map view's focus trees are drawn (m); in the cockpit, the fog's end
//   fade     [whole past, gone inside] (m from the cockpit): what's this close dithers away, so
//            the boughs a mech brushes past don't fill the view
//   push     a mech at least this heavy (t) shoves a tree over instead of stopping
//   shove    and is slowed to this share of its speed doing it
//   hp       a tree's: what a punch, a shell or a beam's dps has to put in to fell it
//   hitR     a trunk's radius for shots, at least (m): saplings take none
//   fall     a felled tree's fall time (s) per square-root metre of its height
//   crush    damage to a mech a falling tree lands on, per metre of tree, at most `crushMax`
//   blastR   a missile's blast fells trees this near (m)
//   hide     sight lost to woods in between: each 10 m of them takes this share off what's left (part 3)
//   carry    in a forest, sounds carry this much further before they fall off (part 3)
//   among    woods this thick (0..1, the density grid) where a foe stands is among trees: an ambusher holds there (part 4)
//   wait     and waits this long (s) since it last saw you before it goes looking
//   hear     a foe moving within this (m) that the woods hide gets a HEARD pointer (part 4)
//   pieces   trees falling at once; past it the oldest lands now (shared with spec 38's rigid pieces)
//   kinds    each kind's share, crown radius and height ranges (m), and
//            trunk (m, the radius that stops a mech; 0: it folds underfoot)
export const TREES = {
  gap: 7, cell: 16, clear: -0.9, paths: 3, pathW: 12, slope: 0.7, draw: 250, fade: [12, 6],
  push: 60, shove: 0.6, hp: 8, hitR: 0.8, fall: 0.35, crush: 1.5, crushMax: 40, blastR: 10, pieces: 4, hide: 0.15, carry: 1.5, among: 0.5, wait: 30, hear: 200,
  kinds: {
    pine: { share: 0.35, r: [2.5, 3.5], h: [18, 28], trunk: 0.6 },   // two to three mechs tall: the crowns are over the cockpit
    broadleaf: { share: 0.25, r: [4, 5.5], h: [16, 22], trunk: 0.9 },
    sapling: { share: 0.4, r: [1.2, 2], h: [3, 5], trunk: 0 },
  },
};
export const TREE_KINDS = Object.keys(TREES.kinds);   // a tree's `kind` is its index here
