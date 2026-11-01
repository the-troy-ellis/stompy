// Every display name, in one place. Code, saves and the network use the
// keys; the owner names things after seeing them, so renaming is a change
// here and nowhere else (docs/workflow.md, "Naming things").
export const NAMES = {
  chassis: { kestrel: 'BARRY', jackal: 'SKEDADDLE', warden: 'SLOWPOKE', puncher: 'PURPLE PUNCHER', light1: 'BIG TROUBLE', sniper1: 'LONG LARRY', digger: 'BIG SCOOPER', hauler: 'HAULER', builder: 'BIG STACKER' },   // every one the owner's, confirmed, but the hauler's and the builder's (placeholders)
  // Every one the owner's, confirmed (docs/workflow.md § Naming).
  weapons: { laser: 'BIG ZAPPER', mlaser: 'LIL ZAPPER', ac: 'BIG BOOMER', lrm: 'ANGRY BEES', fusion: 'OOPS BUTTON', ppc: 'ANGRY ZAPPER', plaser: 'BLINKY', srm: 'FIRECRACKERS', gauss: 'BIG BONKER', mg: 'RATATAT', flamer: 'TOASTER' },
  // What the menu says about each selectable mech, in the board-book voice (docs/vision.md § Tone guide).
  roles: {
    kestrel: { role: 'IT DOES A LITTLE OF EVERYTHING.', kit: '2x BIG ZAPPER · BIG BOOMER · ANGRY BEES · OOPS BUTTON', fire: 0.75 },
    jackal: { role: 'IT RUNS FAST. IT BREAKS FAST.', kit: '2x LIL ZAPPER · OOPS BUTTON', fire: 0.35 },
    warden: { role: 'FOUR LEGS. SLOW. DOES NOT STOP.', kit: 'BIG ZAPPER · BIG BOOMER · ANGRY BEES · OOPS BUTTON', fire: 0.85 },
    puncher: { role: 'IT PUNCHES.', kit: 'BIG BOOMER · FIRECRACKERS · OOPS BUTTON · FISTS', fire: 0.45 },
    light1: { role: 'IT IS SMALL. IT IS RUDE.', kit: 'FIRECRACKERS · LIL ZAPPER · RATATAT · OOPS BUTTON', fire: 0.4 },
    sniper1: { role: 'LONG LEGS. LONG GUN.', kit: 'BIG BONKER · ANGRY ZAPPER · LIL ZAPPER · OOPS BUTTON', fire: 0.7 },
    digger: { role: 'IT DIGS.', kit: 'TWO BUCKETS · A HOPPER', fire: 0.05 },   // the BIG SCOOPER (the owner's name); role and kit lines are placeholders
    hauler: { role: 'IT CARRIES.', kit: 'A BIG TUB · FOUR LEGS', fire: 0 },   // placeholders
    builder: { role: 'IT BUILDS.', kit: 'A CRANE · A HOOK', fire: 0 },   // placeholders (docs/specs/31-builder.md)
  },
  // Campaign missions by key. Act I's are the owner's, picked after seeing them (docs/workflow.md § Naming).
  // The base's buildings (docs/specs/20-build-and-fight.md, 21-mining.md): placeholders.
  buildings: { silo: 'SILO', factory: 'FACTORY', bay: 'BAY', wall: 'WALL', beacon: 'BEACON' },   // BEACON a placeholder (docs/specs/33-production.md)
  // The construction mechs' tools, on their primary button (docs/specs/25-hold-to-dig.md).
  tools: { dig: 'DIG', build: 'BUILD' },
  missions: { m01: 'LIL SNOOZERS', m02: 'TOWER TOPPLER', m03: 'HELPLESS LIL BUDDIES', m04: 'FOUR LEGS BAD', b01: 'FIRST FACTORY', y01: 'THE YARD' },   // b01: spec 20's base mission; y01: the DEBUG tab's yard, a placeholder
  // The debrief's one word (docs/specs/04-campaign.md § Debrief verdicts): spec drafts until the owner picks.
  verdicts: { won: 'STOMPED.', untouched: 'UNTOUCHED.', punched: 'PUNCHED.', lost: 'SQUASHED.', awkward: 'AWKWARD.', flattened: 'FLATTENED.' },
  locked: n => `LOCKED · CLEAR MISSION ${n}`,
  cats: { energy: 'ENERGY', ballistic: 'BALLISTIC', missile: 'MISSILE', fusion: 'FUSION' },
  sections: { T: 'Torso', LA: 'Left arm', RA: 'Right arm', LL: 'Left leg', RL: 'Right leg' },
};
