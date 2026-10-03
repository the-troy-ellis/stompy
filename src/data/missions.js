import { PALS } from './palettes.js';

export const MISSIONS = [
  { name: 'Proving Grounds', pal: 'dusk', foes: ['jackal', 'jackal'],
    intel: 'Two JACKAL scouts have been shadowing the convoy route out of Redwater. Fast, lightly armoured, armed with medium lasers. Run them down.' },
  { name: 'Ridge Patrol', pal: 'ice', foes: ['jackal', 'jackal', 'jackal'],
    intel: 'A scout lance is sweeping the glacier ridges. Visibility is poor. Use the radar and let them come to you.' },
  { name: 'Iron Rain', pal: 'volcanic', foes: ['warden', 'jackal', 'jackal'],
    intel: 'A WARDEN fire-support mech is shelling the refinery with long-range missiles, screened by two scouts. Close the distance: LRMs are weak up close.' },
  { name: 'Hammerfall', pal: 'dusk', foes: ['warden', 'warden', 'jackal', 'jackal'],
    intel: 'The Combine has committed heavies. Two WARDENs and their escorts. Watch your heat.' },
];
export function missionDef(n) {
  if (n < MISSIONS.length) return MISSIONS[n];
  const pals = Object.keys(PALS), k = 3 + Math.floor(n / 2), heavies = Math.floor(n / 3);
  return { name: `Contract ${n + 1}`, pal: pals[n % pals.length],
    foes: Array.from({ length: k }, (_, i) => (i < heavies ? 'warden' : 'jackal')),
    intel: `Open contract. ${k} hostiles reported, ${heavies} of them heavy. Pay is by the kill.` };
}
// Free play: a one-off battle on the chosen map with the chosen number of hostiles.
export const FP_MAPS = ['random', 'dusk', 'ice', 'volcanic'];
