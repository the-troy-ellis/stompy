import { esc } from '../util/dom.js';
import { MP_COLORS } from '../data/colors.js';
import { teamName } from '../net/teams.js';
import { MODE_NAMES } from './lobby.js';

// The round's end in the arena (docs/specs/08-lan-polish.md § Vote): who won,
// each pilot's kills, deaths, accuracy and best streak, and the vote for the
// next round: a new map, the same map, or the other mode. Built from the
// scores the server sends; no DOM here, only the HTML. The client swaps the
// rows and the counts in place as votes and accuracies come in, so a tap on a
// button is never lost to a rebuild.
export const VOTES = ['next', 'same', 'mode'];   // server/server.py VOTES, in order
export const otherMode = mode => (mode === 'tdm' ? 'ffa' : 'tdm');
// What each button sends: `vote { map, mode }`.
export const voteOf = (i, mode) => ({ map: VOTES[i] === 'same' ? 'same' : 'next', mode: VOTES[i] === 'mode' ? otherMode(mode) : mode });
const LABELS = { next: () => 'NEXT MAP', same: () => 'SAME MAP', mode: mode => MODE_NAMES[otherMode(mode)] };

export const summaryRows = ({ pilots, me, mode }) => {
  const tdm = mode === 'tdm';
  const list = [...pilots].sort((a, b) => (tdm ? (a.team || 0) - (b.team || 0) : 0) || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  return `<tr class="dim"><td>PILOT</td>${tdm ? '<td></td>' : ''}<td>K</td><td>D</td><td>ACC</td><td>BEST</td></tr>` + list.map(p => `<tr${p.id === me ? ' class="me"' : ''}>
      <td><span class="dot" style="background:${MP_COLORS[p.color]?.css || '#9f9'}"></span>${esc(p.name)}</td>${tdm ? `<td>${teamName(p.team || 0)}</td>` : ''}
      <td>${p.kills}</td><td>${p.deaths}</td><td>${p.acc >= 0 ? `${p.acc}%` : '<span class="dim">--</span>'}</td><td>${p.best || 0}</td></tr>`).join('');
};
export const voteCount = n => (n ? ` · ${n}` : '');

export function summaryHTML(o) {
  const { title, mode, votes = [0, 0, 0], mine = -1, next = 10 } = o;
  return `<h1>${esc(title)}</h1>
    <div class="panel"><table class="mech-keys scoreboard summary">${summaryRows(o)}</table>
      <p class="dim">Pick the next round. Most votes wins. Next round in <span class="next-in">${next}</span> s.</p></div>
    <div class="opts vote">${VOTES.map((v, i) => `<button class="go${i === mine ? ' on' : ''}" data-a="vote" data-v="${i}">${LABELS[v](mode)}<span class="n">${voteCount(votes[i])}</span></button>`).join('')}</div>`;
}
