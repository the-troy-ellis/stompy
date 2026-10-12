import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import { zipOf, crc32 } from '../scripts/zip.mjs';
import { notesFrom } from '../scripts/notes.mjs';

// Release tooling (#232, spec 11 § Deploy and release).

// Read a zip back the way an unzipper does: from the end record, through the central directory.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(end + 10), cdAt = buf.readUInt32LE(end + 16), out = {};
  let p = cdAt;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), full = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42), name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26), body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(data.length, full); assert.equal(crc32(data), crc, `${name} crc`);
    out[name] = data.toString();
    p += 46 + nameLen;
  }
  return out;
}

test('a zip of the files reads back exactly, in order, index.html first', () => {
  const files = [{ name: 'index.html', data: Buffer.from('<h1>STOMPY</h1>'.repeat(50)) }, { name: 'sounds/thump.mp3', data: Buffer.from([1, 2, 3]) }, { name: 'icons/i.png', data: Buffer.alloc(0) }];
  const back = unzip(zipOf(files));
  assert.deepEqual(Object.keys(back), ['index.html', 'sounds/thump.mp3', 'icons/i.png']);
  assert.equal(back['index.html'], '<h1>STOMPY</h1>'.repeat(50));
  assert.equal(back['sounds/thump.mp3'], '\x01\x02\x03', 'too small to deflate: stored');
});

test('the same files make the same zip (no clock in it)', () => {
  const files = [{ name: 'a.txt', data: Buffer.from('a') }];
  assert.deepEqual(zipOf(files), zipOf(files));
});

test('crc32 is the standard one', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('release notes are the merged PR titles since the last tag, oldest first', () => {
  const log = [
    'Merge pull request #12 from me/b\x1fGamepad: standard mapping (#227)\n\x1e',
    'Merge main into me/b\x1fsome merge\x1e',
    'A direct commit\x1f\x1e',
    'Merge pull request #11 from me/a\x1fInstallable and offline (#226)\n\nmore\x1e',
  ].join('\n');
  assert.equal(notesFrom(log, 'v1.0.0', 'v0.9.0'), '## Stompy v1.0.0\n\nSince v0.9.0:\n\n- Installable and offline (#226) (#11)\n- Gamepad: standard mapping (#227) (#12)\n');
  assert.match(notesFrom('', 'v0.1.0', ''), /Everything so far:\n\n- Small fixes\./);
});
