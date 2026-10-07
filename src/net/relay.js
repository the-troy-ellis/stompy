// The arena relay's address (docs/specs/08-lan-polish.md § Relay URL), in
// order: a `?relay=` on the page's address (main.js saves it), the RELAY
// field (saved as `net.relay`), the build's RELAY_DEFAULT if it has one
// (docs/specs/10-internet-play.md: a hosted site bakes in its relay), else
// the page's own host on RELAY_PORT, as before. An entry can be a full ws:// or wss:// address (its own port, or
// the scheme's), or just a host or host:port (RELAY_PORT, path /ws). No DOM here: tests pass a fake location.
export const RELAY_PORT = 8096;
// The release build's `RELAY_DEFAULT=wss://... npm run build` (scripts/build.mjs
// defines __RELAY_DEFAULT__); null otherwise, and in development.
/* global __RELAY_DEFAULT__ */
export const RELAY_DEFAULT = typeof __RELAY_DEFAULT__ === 'string' ? __RELAY_DEFAULT__ : null;
const { URL } = globalThis;   // the browser's and Node's own

// A usable ws[s]://host:port/ws from what was typed, or null.
export function normalRelay(raw, secure = false) {
  let s = String(raw || '').trim();
  if (!s || /\s/.test(s) || /^(?!wss?:)[a-z][\w+.-]*:\/\//i.test(s)) return null;   // http:// and friends are not relays
  const full = /^wss?:\/\//i.test(s);   // a full address keeps its own port (443 behind TLS); a bare host gets RELAY_PORT
  if (!full) s = `${secure ? 'wss' : 'ws'}://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^wss?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  const port = u.port || (full ? '' : String(RELAY_PORT));
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}${u.pathname === '/' ? '/ws' : u.pathname}`;
}

// Which address to connect to, and where it came from ('query', 'saved',
// 'default' or 'page'). `fallback`: the build's default (tests pass their own).
export function resolveRelay({ query, saved, location, fallback = RELAY_DEFAULT }) {
  const secure = location.protocol === 'https:';
  const q = normalRelay(query, secure);
  if (q) return { url: q, from: 'query' };
  const s = normalRelay(saved, secure);
  if (s) return { url: s, from: 'saved' };
  const d = normalRelay(fallback, secure);
  if (d) return { url: d, from: 'default' };
  return { url: `${secure ? 'wss' : 'ws'}://${location.hostname}:${RELAY_PORT}/ws`, from: 'page' };
}
