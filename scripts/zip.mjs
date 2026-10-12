// `npm run zip`: dist/ as stompy-<version>.zip for itch.io, with index.html
// at the root as itch wants (docs/specs/11-release.md § Deploy and release).
// Plain Node: a zip is a few headers around deflated files, so no new
// dependency. Run `npm run build` first; `node scripts/zip.mjs [dir] [out]`.
import { Buffer } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const DOS_DATE = (1 << 5) | 1 | ((2026 - 1980) << 9), DOS_TIME = 0;   // a fixed stamp, so the same dist/ makes the same zip

// The zip's bytes for [{ name, data }]: each file deflated (or stored, if
// that's no smaller), then the central directory and its end record.
export function zipOf(files) {
  const parts = [], dir = [];
  let at = 0;
  for (const { name, data } of files) {
    const n = Buffer.from(name, 'utf8'), crc = crc32(data), packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length, body = stored ? data : packed, method = stored ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);   // version 2.0; names are UTF-8
    local.writeUInt16LE(method, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(at, 42);
    parts.push(local, n, body);
    dir.push(central, n);
    at += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, cd, end]);
}

// Every file under dir, as zip names relative to it (index.html first), skipping source maps.
export async function filesOf(dir) {
  const names = (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile())
    .map(e => `${e.parentPath ?? e.path}/${e.name}`.slice(dir.length + 1).replaceAll('\\', '/'))
    .filter(f => !f.endsWith('.map')).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : 1));
  return Promise.all(names.map(async name => ({ name, data: await readFile(`${dir}/${name}`) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'dist';
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const files = await filesOf(dir).catch(() => []);
  if (!files.some(f => f.name === 'index.html')) { console.error(`zip: no ${dir}/index.html; run npm run build first`); process.exit(1); }
  const out = process.argv[3] || `stompy-${version}.zip`, zip = zipOf(files);
  await writeFile(out, zip);
  console.log(`${out}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB`);
}
