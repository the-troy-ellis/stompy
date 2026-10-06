import { fmtClock } from '../render/hud.js';

// The debrief's objective rows (docs/specs/03-objectives.md § Player
// experience): each objective as it ended, with a tick or a cross.
// Secondaries are flagged and never decide the mission. A mission without
// listed objectives is plain ELIMINATE, which the KILLS line already covers.
export function objectiveRows(G) {
  if (!G.def?.objectives || !G.objectives) return [];
  return G.objectives.map(o => ({ text: resultText(G, o), ok: o.state === 'done', secondary: !!o.def.secondary }));
}

function resultText(G, o) {
  const d = o.def, label = s => (s || '').toUpperCase().slice(0, 14);
  switch (d.type) {
    case 'eliminate': return `ELIMINATE ${(o.total ?? 0) - (o.left ?? 0)}/${o.total ?? 0}`;
    case 'destroy': {   // one that never started still counts its targets
      const total = o.total ?? (o.targets || G.entities.filter(e => e.tags.some(t => d.targets.includes(t)))).length;
      return `DESTROY ${label(d.label || 'TARGETS')} ${o.done ?? 0}/${total}`;
    }
    case 'survive': return `SURVIVE ${fmtClock(d.seconds)}`;
    case 'escort': return `ESCORT ${label(d.label || 'CONVOY')} ${o.home ?? 0}/${d.minAlive ?? 1} HOME`;
    case 'extract': return d.within != null ? `EXTRACT IN ${fmtClock(d.within)}` : 'EXTRACT';
    case 'protect': return `PROTECT ${label(d.label || 'TARGETS')} ${o.alive ?? o.targets?.length ?? 0}/${o.total ?? o.targets?.length ?? 0}`;
    default: return d.type.toUpperCase();
  }
}

// The banner: a failed objective is not the same as a lost mech.
export function debriefTitle(G) {
  if (G.won) return 'MISSION COMPLETE';
  return G.player?.alive ? 'MISSION FAILED' : 'MECH DESTROYED';
}

// "MISSION 2: TOWER TROUBLE", or just "MISSION 2" while it has no name of its own.
export function missionTitle(n, name) {
  const up = (name || '').toUpperCase();
  if (/^CONTRACT \d+$/.test(up)) return up;   // after the twelve, contracts carry their own number
  return !up || up === `MISSION ${n}` ? `MISSION ${n}` : `MISSION ${n}: ${up}`;
}
// The voice's version at launch: "Mission 2. Tower Trouble." or "Mission 2."
export function missionSpoken(n, name) {
  const t = missionTitle(n, name).split(': ');
  const cap = w => w.charAt(0) + w.slice(1).toLowerCase();
  return t.map(w => `${w.split(' ').map(cap).join(' ')}.`).join(' ');
}
