import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, missionDef } from '../src/data/missions.js';
import { NAMES } from '../src/data/names.js';

// The board-book voice (docs/vision.md § Tone guide): short, plain sentences
// that say what is happening. Describing, not cheering, not baby talk.
const sentences = t => t.split(/(?<=\.)\s+/).filter(Boolean);
const words = s => s.replace(/[.,;:]/g, ' ').split(/\s+/).filter(Boolean);

function boardBook(text, where) {
  assert.ok(!/[!?]/.test(text), `${where}: no exclamations or questions: ${text}`);
  assert.ok(!/\d/.test(text), `${where}: numbers as words: ${text}`);
  const ss = sentences(text);
  assert.ok(ss.length >= 1 && ss.length <= 4, `${where}: one to four sentences: ${text}`);
  for (const s of ss) {
    assert.ok(s.endsWith('.'), `${where}: every sentence ends with a full stop: ${s}`);
    assert.ok(words(s).length <= 8, `${where}: eight words at most: ${s}`);
  }
}

test('every brief is board-book short: a few plain sentences, eight words or fewer each', () => {
  for (const m of MISSIONS) boardBook(m.intel, m.key);
  for (let n = MISSIONS.length; n < 40; n++) boardBook(missionDef(n).intel, `contract ${n + 1}`);
});

test('every mech role line is board-book short too', () => {
  for (const [k, r] of Object.entries(NAMES.roles)) {
    boardBook(r.role.toLowerCase(), k);
    assert.ok(r.role.length <= 34, `${k}: fits the selector: ${r.role}`);
  }
});
