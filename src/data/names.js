// Every display name, in one place. Code, saves and the network use the
// keys; the owner names things after seeing them, so renaming is a change
// here and nowhere else (docs/workflow.md, "Naming things").
export const NAMES = {
  chassis: { kestrel: 'KESTREL', jackal: 'JACKAL', warden: 'WARDEN', puncher: 'PURPLE PUNCHER', light1: 'PIPSQUEAK', sniper1: 'BEANPOLE' },   // light1, sniper1: placeholders until the owner picks   // PURPLE PUNCHER is the owner's, confirmed
  // ppc and the rest of M2's weapons carry placeholder names until the owner picks (docs/workflow.md § Naming).
  weapons: { laser: 'LG LASER', mlaser: 'MED LASER', ac: 'AUTOCANNON', lrm: 'LRM-10', fusion: 'FUSION CANNON', ppc: 'THUNDERCLAP', plaser: 'PEPPER LASER', srm: 'FIRECRACKERS', gauss: 'BIG BONKER', mg: 'PEASHOOTER', flamer: 'TOASTER' },
  // What the menu says about each selectable mech, in the board-book voice (docs/vision.md § Tone guide).
  roles: {
    kestrel: { role: 'IT DOES A LITTLE OF EVERYTHING.', kit: '2x LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.75 },
    jackal: { role: 'IT RUNS FAST. IT BREAKS FAST.', kit: '2x MED LASER · FUSION', fire: 0.35 },
    warden: { role: 'FOUR LEGS. SLOW. DOES NOT STOP.', kit: 'LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.85 },
    puncher: { role: 'IT PUNCHES.', kit: 'AUTOCANNON · FIRECRACKERS · FUSION · FISTS', fire: 0.45 },
    light1: { role: 'IT IS SMALL. IT IS RUDE.', kit: 'FIRECRACKERS · MED LASER · PEASHOOTER · FUSION', fire: 0.4 },
    sniper1: { role: 'LONG LEGS. LONG GUN.', kit: 'BIG BONKER · THUNDERCLAP · MED LASER · FUSION', fire: 0.7 },
  },
  // Campaign missions by key. Act I's are the owner's, picked after seeing them (docs/workflow.md § Naming).
  missions: { m01: 'LIL SNOOZERS', m02: 'TOWER TOPPLER', m03: 'HELPLESS LIL BUDDIES', m04: 'FOUR LEGS BAD' },
  // The debrief's one word (docs/specs/04-campaign.md § Debrief verdicts): spec drafts until the owner picks.
  verdicts: { won: 'STOMPED.', untouched: 'UNTOUCHED.', punched: 'PUNCHED.', lost: 'SQUASHED.', awkward: 'AWKWARD.', flattened: 'FLATTENED.' },
  locked: n => `LOCKED · CLEAR MISSION ${n}`,
  cats: { energy: 'ENERGY', ballistic: 'BALLISTIC', missile: 'MISSILE', fusion: 'FUSION' },
  sections: { T: 'Torso', LA: 'Left arm', RA: 'Right arm', LL: 'Left leg', RL: 'Right leg' },
};
