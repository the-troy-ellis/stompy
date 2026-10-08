import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalRelay, resolveRelay, RELAY_PORT } from '../src/net/relay.js';

// The relay address (#184, spec 08 § Relay URL).
test('an entry becomes a full relay address: a bare host gets the port and /ws, a full one keeps its own', () => {
  assert.equal(normalRelay('192.168.1.5'), `ws://192.168.1.5:${RELAY_PORT}/ws`);
  assert.equal(normalRelay('192.168.1.5:9000'), 'ws://192.168.1.5:9000/ws');
  assert.equal(normalRelay('pi.local', true), `wss://pi.local:${RELAY_PORT}/ws`, 'from an https page, wss');
  assert.equal(normalRelay('ws://pi.local:8096/ws'), 'ws://pi.local:8096/ws');
  assert.equal(normalRelay('wss://relay.example/stompy'), 'wss://relay.example/stompy', 'behind TLS: the scheme\'s own port');
  assert.equal(normalRelay('[::1]:8096'), 'ws://[::1]:8096/ws');
  for (const bad of ['', '  ', null, 'a b', 'http://x', 'https://relay.example', 'javascript:alert(1)', 'ws://user:pw@host/ws'])
    assert.equal(normalRelay(bad), null, String(bad));
});

test('the address comes from ?relay=, then the RELAY field, then this page\'s host', () => {
  const location = { protocol: 'http:', hostname: 'stompy.lan' };
  assert.deepEqual(resolveRelay({ query: '10.0.0.2', saved: '10.0.0.3', location }), { url: `ws://10.0.0.2:${RELAY_PORT}/ws`, from: 'query' });
  assert.deepEqual(resolveRelay({ query: null, saved: '10.0.0.3', location }), { url: `ws://10.0.0.3:${RELAY_PORT}/ws`, from: 'saved' });
  assert.deepEqual(resolveRelay({ query: null, saved: '', location }), { url: `ws://stompy.lan:${RELAY_PORT}/ws`, from: 'page' });
  assert.equal(resolveRelay({ query: 'not a relay', saved: 'http://nope', location }).from, 'page', 'junk falls through');
  assert.equal(resolveRelay({ query: null, saved: '', location: { protocol: 'https:', hostname: 'x.io' } }).url, `wss://x.io:${RELAY_PORT}/ws`);
});

test('a build\'s RELAY_DEFAULT comes after ?relay= and the RELAY field, before this page\'s host (#217)', () => {
  const location = { protocol: 'https:', hostname: 'me.github.io' }, fallback = 'wss://relay.example/ws';
  assert.deepEqual(resolveRelay({ query: null, saved: '', location, fallback }), { url: 'wss://relay.example/ws', from: 'default' });
  assert.equal(resolveRelay({ query: null, saved: '10.0.0.3', location, fallback }).from, 'saved', 'the field wins');
  assert.equal(resolveRelay({ query: 'pi.local', saved: '', location, fallback }).from, 'query', 'and ?relay= wins');
  assert.equal(resolveRelay({ query: null, saved: '', location, fallback: null }).from, 'page', 'no default: the page\'s host, as before');
  assert.equal(resolveRelay({ query: null, saved: '', location, fallback: 'http://nope' }).from, 'page', 'a junk default falls through');
});

test('the release build bakes RELAY_DEFAULT in, and refuses one that is not a relay', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  execFileSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, RELAY_DEFAULT: 'wss://relay.example/ws' }, stdio: 'ignore' });
  assert.ok(readFileSync('dist/stompy.js', 'utf8').includes('wss://relay.example/ws'));
  assert.throws(() => execFileSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, RELAY_DEFAULT: 'http://nope' }, stdio: 'ignore' }));
  execFileSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, RELAY_DEFAULT: '' }, stdio: 'ignore' });
  assert.ok(!readFileSync('dist/stompy.js', 'utf8').includes('relay.example'), 'without it, nothing baked in');
});
