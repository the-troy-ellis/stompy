import { esc } from '../util/dom.js';
import { CHASSIS } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';
import { PALS } from '../data/palettes.js';
import { TEAM_COLORS, teamName } from '../net/teams.js';
import { missionDef } from '../data/missions.js';
import { DIFF } from '../data/ai.js';
import { missionTitle } from './debrief.js';

// The arena lobby (docs/specs/08-lan-polish.md § Lobby): what `welcome` opens
// before you spawn. The pilots (swatch, callsign, chassis, ping, and whether
// they are in or still here), the mode, the map and the limit, READY and
// LEAVE; in team deathmatch, each pilot's side and the picker. Built from the
// scores the server sends; no DOM here, only the HTML.
export const MODE_NAMES = { ffa: 'FREE-FOR-ALL', tdm: 'TEAM DEATHMATCH', coop: 'CO-OP' };

// The pilot rows and the heading line on their own: the client swaps these in
// place as pilots come, ready up, change sides and ping, and never rebuilds
// the buttons (a tap landing as READY was replaced would be lost). In team
// deathmatch the rows go by side, STEEL first.
export const lobbyRows = ({ pilots, me, mode, coop }) => {
  const tdm = mode === 'tdm', list = tdm ? [...pilots].sort((a, b) => (a.team || 0) - (b.team || 0) || a.id - b.id) : pilots;
  return list.map(p => `<tr${p.id === me ? ' class="me"' : ''}>
      <td><span class="dot" style="background:${MP_COLORS[p.color]?.css || '#9f9'}"></span>${esc(p.name)}</td>${tdm ? `
      <td>${teamName(p.team || 0)}</td>` : ''}
      <td>${esc(CHASSIS[p.ch]?.name || '?')}</td>
      <td class="dim">${p.ping ? `${p.ping} ms` : '--'}</td>
      <td>${coop && p.id === coop.host ? 'HOST' : p.ready ? (coop ? 'READY' : 'IN') : '<span class="dim">HERE</span>'}</td></tr>`).join('');
};
export const lobbyHead = ({ mode = 'ffa', pal, limit, coop }) => (coop
  // Co-op: the room's code (read it out to the others), the mission and how hard.
  ? `ROOM ${esc(coop.room)} · ${esc(missionTitle(coop.mission + 1, missionDef(coop.mission).name))} · ${DIFF[coop.diff]?.label || ''}`
  : `${MODE_NAMES[mode] || MODE_NAMES.ffa} · ${esc((PALS[pal]?.name || '').toUpperCase())} · FIRST TO ${limit}`);
// Co-op's line under the pilots: the host starts it; the others wait for the host.
export const coopNote = ({ me, coop }) => (me === coop.host ? 'READY starts the mission for everyone.' : coop.readied ? 'WAITING FOR HOST' : 'READY, then the host starts it.');

// The side picker (team deathmatch): one button per team in its colour, the
// pilot's own lit. Tapping one asks the relay; its answer moves you.
const teamPicker = ({ pilots, me }) => {
  const mine = pilots.find(p => p.id === me)?.team || 0;
  return `<div class="opts lobby-teams">${TEAM_COLORS.map((c, t) => `<button class="go${t === mine ? ' on' : ''}" data-a="team" data-team="${t}">
      <span class="dot" style="background:${MP_COLORS[c].css}"></span>${teamName(t)}</button>`).join('')}</div>`;
};

// A private arena's code, large, to read out over a call.
const roomCode = room => `<div class="lobby-code">ROOM <b>${esc(room)}</b></div>`;

export function lobbyHTML(o) {
  const tdm = o.mode === 'tdm', coop = o.mode === 'coop' && o.coop;
  return `<h1>LOBBY</h1>
    <div class="panel" data-mode="${coop ? 'coop' : tdm ? 'tdm' : 'ffa'}">${o.room ? roomCode(o.room) : ''}<div class="k lobby-head">${lobbyHead(o)}</div>
      <table class="mech-keys scoreboard lobby">${lobbyRows(o)}</table>
      ${coop ? `<p class="dim lobby-note">${coopNote(o)}</p>` : tdm ? `${teamPicker(o)}<p class="dim">Pick a side. Then READY drops you in.</p>` : '<p class="dim">The match is on. READY drops you in.</p>'}</div>
    <button class="go" data-a="ready">READY</button> <button class="go" data-a="leave">LEAVE</button>`;
}
