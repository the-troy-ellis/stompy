// The cockpit voice's line pools (docs/vision.md § The voice). The first line
// of each pool is the flat statement; the rest are the dry ones. The sim picks
// one by seeded random, never repeats a dry line in one mission, and lets at
// most one dry line through per DRY_GAP seconds; the flat line fills in
// otherwise. Warnings are not pooled: they stay flat, always.
// The owner edits these; agents add candidates in a PR's NAMING section.
export const VOICE = {
  kill: ['Target destroyed.', 'Target stomped.', 'That one is done.'],
  killPunch: ['Target punched.', 'Fist contact confirmed.'],
  killStomp: ['Target stomped.', 'Target stomped. Literally.'],
  legLost: ['Leg destroyed.', 'Leg destroyed. Recommend hopping.', 'Leg destroyed. Speed is now optional.'],
  armLost: ['Arm destroyed.', 'Arm destroyed. We have another.'],
  legsLost: ['Legs destroyed.', 'Legs destroyed. We are now a turret.'],
  shutdown: ['Reactor shutdown.', 'Reactor shutdown. Please hold.'],
  online: ['Reactor online.', 'Reactor online. Carry on.'],
  complete: ['Mission complete.', 'Mission complete. Good stomping.'],
  failed: ['Mission failed.'],   // an objective failed (the player's own death has its own lines)
};
export const DRY_GAP = 60;
