// Fine digging that settles (docs/specs/27-fine-dig.md): when a fine patch
// (world/finePatch.js) slumps back into the 8 m ground (sim/dig.js
// stepFinePatches). Presentation, not balance: no ore or dirt reads it.
//   settleAfter  s since the last edit in a patch before it settles
//   settleTime   s the slump takes
//   settleWait   s more it waits while a mech stands on it (a slump only
//                fills bites in, so one standing in a bite is lifted out)
//   dust         puffs along the patch as it starts to slump
//   far          m from you past which a patch goes at once, unseen: nobody
//                is near enough to see its detail (and it costs to draw)
export const FINE_DIG = { settleAfter: 15, settleTime: 1.5, settleWait: 45, dust: 14, far: 160 };
