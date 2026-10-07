// Release build: one minified bundle plus the static files, in dist/.
// Development needs none of this; index.html loads src/main.js directly.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { normalRelay } from '../src/net/relay.js';

// RELAY_DEFAULT=wss://relay.example/ws bakes in the relay a hosted site uses
// (docs/specs/10-internet-play.md); ?relay= and the RELAY field still win.
const relay = process.env.RELAY_DEFAULT || '';
if (relay && !normalRelay(relay, true)) { console.error(`RELAY_DEFAULT is not a relay address: ${relay}`); process.exit(1); }

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  outfile: 'dist/stompy.js', sourcemap: true, legalComments: 'none', logLevel: 'info',
  define: relay ? { __RELAY_DEFAULT__: JSON.stringify(relay) } : {} });
const html = (await readFile('index.html', 'utf8')).replace('<script type="module" src="src/main.js"></script>', '<script src="stompy.js"></script>');
await writeFile('dist/index.html', html);
for (const f of ['style.css', 'favicon.svg']) await cp(f, `dist/${f}`);
await cp('sounds', 'dist/sounds', { recursive: true });
console.log(`built dist/${relay ? ` (relay ${relay})` : ''}`);
