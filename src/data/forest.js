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
//   kinds    each kind's share, crown radius and height ranges (m), and
//            trunk (m, the radius that stops a mech; 0: it folds underfoot)
export const TREES = {
  gap: 7, cell: 16, clear: -0.9, paths: 3, pathW: 12, slope: 0.7, draw: 250, fade: [12, 6],
  kinds: {
    pine: { share: 0.35, r: [2.5, 3.5], h: [18, 28], trunk: 0.6 },   // two to three mechs tall: the crowns are over the cockpit
    broadleaf: { share: 0.25, r: [4, 5.5], h: [16, 22], trunk: 0.9 },
    sapling: { share: 0.4, r: [1.2, 2], h: [3, 5], trunk: 0 },
  },
};
export const TREE_KINDS = Object.keys(TREES.kinds);   // a tree's `kind` is its index here
