// The arena's kill feed (docs/specs/08-lan-polish.md § Kill feed): the last
// KILLFEED_MAX kills, each fading out over KILLFEED_LIFE ms, drawn top right in
// the pilots' colours by the HUD. An entry is { killer, victim, me, at }:
// killer 0 is a pilot who went down on their own; me, a punch. No DOM here.
export const KILLFEED_MAX = 4, KILLFEED_LIFE = 6000;

export function addKill(feed, entry) {
  feed.push(entry);
  if (feed.length > KILLFEED_MAX) feed.splice(0, feed.length - KILLFEED_MAX);
  return feed;
}

// The entries still showing at `now`, newest last, each with its alpha;
// expired ones are dropped from the feed.
export function liveKills(feed, now) {
  for (let i = feed.length - 1; i >= 0; i--) if (now - feed[i].at >= KILLFEED_LIFE) feed.splice(i, 1);
  return feed.map(e => ({ ...e, alpha: 1 - (now - e.at) / KILLFEED_LIFE }));
}

// What an entry says, in three parts: [killer, verb, victim] (killer '' when none).
export const killWords = (e, name) => (e.killer ? [name(e.killer), e.me ? 'PUNCHED OUT' : 'DESTROYED', name(e.victim)] : ['', 'WENT DOWN', name(e.victim)]);
