// Every display name, in one place. Code, saves and the network use the
// keys; the owner names things after seeing them, so renaming is a change
// here and nowhere else (docs/workflow.md, "Naming things").
export const NAMES = {
  chassis: { kestrel: 'KESTREL', jackal: 'JACKAL', warden: 'WARDEN', puncher: 'PURPLE PUNCHER', light1: 'PIPSQUEAK', sniper1: 'BEANPOLE' },   // light1, sniper1: placeholders until the owner picks   // PURPLE PUNCHER is the owner's, confirmed
  // ppc and the rest of M2's weapons carry placeholder names until the owner picks (docs/workflow.md § Naming).
  weapons: { laser: 'LG LASER', mlaser: 'MED LASER', ac: 'AUTOCANNON', lrm: 'LRM-10', fusion: 'FUSION CANNON', ppc: 'THUNDERCLAP', plaser: 'PEPPER LASER', srm: 'FIRECRACKERS', gauss: 'BIG BONKER', mg: 'PEASHOOTER', flamer: 'TOASTER' },
  // What the menu says about each selectable mech.
  roles: {
    kestrel: { role: 'REVERSE-JOINT · DOES A BIT OF EVERYTHING', kit: '2x LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.75 },
    jackal: { role: 'FORWARD-JOINT · FAST, FLIMSY', kit: '2x MED LASER · FUSION', fire: 0.35 },
    warden: { role: 'QUADRUPED · SLOW, STUBBORN', kit: 'LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.85 },
    puncher: { role: 'ASSAULT · IT PUNCHES', kit: 'AUTOCANNON · FIRECRACKERS · FUSION · FISTS', fire: 0.45 },
    light1: { role: 'REVERSE-JOINT · SMALL, RUDE', kit: 'FIRECRACKERS · MED LASER · PEASHOOTER · FUSION', fire: 0.4 },
    sniper1: { role: 'FORWARD-JOINT · LONG GUN, LONG LEGS', kit: 'BIG BONKER · THUNDERCLAP · MED LASER · FUSION', fire: 0.7 },
  },
  // Campaign missions by key: placeholders until the owner picks (docs/workflow.md § Naming).   // unnamed
  missions: { m01: 'MISSION 1', m02: 'MISSION 2', m03: 'MISSION 3', m04: 'MISSION 4' },
  locked: n => `LOCKED · CLEAR MISSION ${n}`,
  cats: { energy: 'ENERGY', ballistic: 'BALLISTIC', missile: 'MISSILE', fusion: 'FUSION' },
  sections: { T: 'Torso', LA: 'Left arm', RA: 'Right arm', LL: 'Left leg', RL: 'Right leg' },
};
