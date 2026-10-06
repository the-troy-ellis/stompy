import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCampaign, saveCampaign, recordResult, restartCampaign, stripSquares, canPlay, unlockedAfter } from '../src/ui/campaign.js';

const memory = (init = {}) => { const m = { ...init }; return { m, get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; } }; };

test('a fresh save starts at mission 1 with KESTREL and JACKAL', () => {
  const s = memory(), c = loadCampaign(s.get);
  assert.equal(c.mission, 0);
  assert.deepEqual(c.best, []);
  assert.deepEqual(c.unlocked, ['kestrel', 'jackal']);
  assert.deepEqual(stripSquares(c), ['current', ...Array(11).fill('locked')]);
});

test('an old save (mech.mission / mech.best) migrates to camp.* with what it had cleared', () => {
  const s = memory({ 'mech.mission': 3, 'mech.best': 5 });
  const c = loadCampaign(s.get);
  assert.equal(c.mission, 3);
  assert.equal(c.best.filter(b => b.won).length, 5);
  assert.ok(c.unlocked.includes('warden'), 'five cleared opens WARDEN (after 4)');
  assert.ok(!c.unlocked.includes('light1'), 'PIPSQUEAK waits for 6');
  saveCampaign(s.set, c);
  const again = loadCampaign(s.get);
  assert.equal(again.mission, 3);
  assert.ok(!again.migrated, 'migrated once, then read from camp.*');
});

test('winning moves the strip on, keeps the best run, and opens WARDEN after mission 4', () => {
  const c = loadCampaign(memory().get);
  for (const n of [0, 1, 2]) assert.deepEqual(recordResult(c, n, { won: true, time: 300, objectives: [true] }), []);
  assert.deepEqual(recordResult(c, 3, { won: true, time: 400, objectives: [true] }), ['warden'], 'New chassis available.');
  assert.equal(c.mission, 4);
  assert.deepEqual(stripSquares(c).slice(0, 6), ['done', 'done', 'done', 'done', 'current', 'locked']);
  assert.deepEqual(recordResult(c, 3, { won: true, time: 350, objectives: [true] }), [], 'opens once');
  assert.equal(c.best[3].time, 350, 'a faster win replaces the slower one');
  recordResult(c, 3, { won: true, time: 500, objectives: [false] });
  assert.equal(c.best[3].time, 350, 'a slower one does not');
  assert.deepEqual(recordResult(c, 4, { won: false, time: 100 }), [], 'a loss records nothing');
  assert.equal(c.mission, 4);
});

test('replay: any won mission and the next unplayed one can launch, nothing past it', () => {
  const c = loadCampaign(memory().get);
  recordResult(c, 0, { won: true, time: 1 }); recordResult(c, 1, { won: true, time: 1 });
  assert.ok(canPlay(c, 0) && canPlay(c, 1) && canPlay(c, 2));
  assert.ok(!canPlay(c, 3));
});

test('the unlock ladder: WARDEN 4, PIPSQUEAK 6, BEANPOLE 8, PURPLE PUNCHER 11', () => {
  assert.deepEqual(unlockedAfter(3), ['kestrel', 'jackal']);
  assert.ok(unlockedAfter(4).includes('warden'));
  assert.ok(unlockedAfter(6).includes('light1') && !unlockedAfter(5).includes('light1'));
  assert.ok(unlockedAfter(8).includes('sniper1') && !unlockedAfter(7).includes('sniper1'));
  assert.ok(unlockedAfter(11).includes('puncher') && !unlockedAfter(10).includes('puncher'));
});

test('restart goes back to mission 1 and keeps the chassis already earned', () => {
  const s = memory({ 'mech.best': 6 }), c = loadCampaign(s.get);
  restartCampaign(c); saveCampaign(s.set, c);
  const after = loadCampaign(s.get);
  assert.equal(after.mission, 0);
  assert.deepEqual(after.best, []);
  assert.ok(after.unlocked.includes('light1'));
});
