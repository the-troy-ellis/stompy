// Every display name, in one place. Code, saves and the network use the
// keys; the owner names things after seeing them, so renaming is a change
// here and nowhere else (docs/workflow.md, "Naming things").
export const NAMES = {
  chassis: { kestrel: 'KESTREL', jackal: 'JACKAL', warden: 'WARDEN' },
  // ppc and the rest of M2's weapons carry placeholder names until the owner picks (docs/workflow.md § Naming).
  weapons: { laser: 'LG LASER', mlaser: 'MED LASER', ac: 'AUTOCANNON', lrm: 'LRM-10', fusion: 'FUSION CANNON', ppc: 'THUNDERCLAP', plaser: 'PEPPER LASER' },
  // What the menu says about each selectable mech.
  roles: {
    kestrel: { role: 'REVERSE-JOINT · MEDIUM ALL-ROUNDER', kit: '2x LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.75 },
    jackal: { role: 'FORWARD-JOINT · LIGHT, FAST', kit: '2x MED LASER · FUSION', fire: 0.35 },
    warden: { role: 'QUADRUPED · HEAVY FIRE SUPPORT', kit: 'LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.85 },
  },
  cats: { energy: 'ENERGY', ballistic: 'BALLISTIC', missile: 'MISSILE', fusion: 'FUSION' },
  sections: { T: 'Torso', LA: 'Left arm', RA: 'Right arm', LL: 'Left leg', RL: 'Right leg' },
};
