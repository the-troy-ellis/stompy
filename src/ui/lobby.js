import { esc } from '../util/dom.js';
import { CHASSIS } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';
import { PALS } from '../data/palettes.js';

// The arena lobby (docs/specs/08-lan-polish.md § Lobby): what `welcome` opens
// before you spawn. The pilots (swatch, callsign, chassis, ping, and whether
// they are in or still here), the mode, the map and the limit, READY and
// LEAVE. Built from the scores the server sends; no DOM here, only the HTML.
export const MODE_NAMES = { ffa: 'FREE-FOR-ALL', tdm: 'TEAM DEATHMATCH' };

// The pilot rows and the heading line on their own: the client swaps these in
// place as pilots come, ready up and ping, and never rebuilds the buttons (a
// tap landing as READY was replaced would be lost).
export const lobbyRows = ({ pilots, me }) => pilots.map(p => `<tr${p.id === me ? ' class="me"' : ''}>
      <td><span class="dot" style="background:${MP_COLORS[p.color]?.css || '#9f9'}"></span>${esc(p.name)}</td>
      <td>${esc(CHASSIS[p.ch]?.name || '?')}</td>
      <td class="dim">${p.ping ? `${p.ping} ms` : '--'}</td>
      <td>${p.ready ? 'IN' : '<span class="dim">HERE</span>'}</td></tr>`).join('');
export const lobbyHead = ({ mode = 'ffa', pal, limit }) => `${MODE_NAMES[mode] || MODE_NAMES.ffa} · ${esc((PALS[pal]?.name || '').toUpperCase())} · FIRST TO ${limit}`;

export function lobbyHTML(o) {
  return `<h1>LOBBY</h1>
    <div class="panel"><div class="k lobby-head">${lobbyHead(o)}</div>
      <table class="mech-keys scoreboard lobby">${lobbyRows(o)}</table>
      <p class="dim">The match is on. READY drops you in.</p></div>
    <button class="go" data-a="ready">READY</button> <button class="go" data-a="leave">LEAVE</button>`;
}
