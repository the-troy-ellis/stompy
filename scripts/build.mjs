// Release build: one minified bundle plus the static files, in dist/.
// Development needs none of this; index.html loads src/main.js directly.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { normalRelay } from '../src/net/relay.js';
import { iconFiles } from './icons.mjs';

// RELAY_DEFAULT=wss://relay.example/ws bakes in the relay a hosted site uses
// (docs/specs/10-internet-play.md); ?relay= and the RELAY field still win.
const relay = process.env.RELAY_DEFAULT || '';
if (relay && !normalRelay(relay, true)) { console.error(`RELAY_DEFAULT is not a relay address: ${relay}`); process.exit(1); }

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  outfile: 'dist/stompy.js', sourcemap: true, legalComments: 'none', logLevel: 'info',
  define: { __PWA__: 'true', ...(relay ? { __RELAY_DEFAULT__: JSON.stringify(relay) } : {}) } });
// The built page: the bundle instead of the modules, and what makes it an app
// (docs/specs/11-release.md § PWA): the manifest and an icon for iOS.
const html = (await readFile('index.html', 'utf8'))
  .replace('<script type="module" src="src/main.js"></script>', '<script src="stompy.js"></script>')
  .replace('</head>', '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n</head>');
await writeFile('dist/index.html', html);
for (const f of ['style.css', 'favicon.svg', 'manifest.webmanifest']) await cp(f, `dist/${f}`);
await cp('sounds', 'dist/sounds', { recursive: true });
await mkdir('dist/icons');
for (const [name, buf] of Object.entries(iconFiles(await readFile('favicon.svg', 'utf8')))) await writeFile(`dist/icons/${name}`, buf);
// The service worker caches every file but the page (network first) and the
// source map, under a version that changes whenever any of them does.
const files = (await readdir('dist', { recursive: true, withFileTypes: true })).filter(e => e.isFile())
  .map(e => `${e.parentPath ?? e.path}/${e.name}`.replace(/^dist\//, '')).filter(f => f !== 'index.html' && !f.endsWith('.map')).sort();
const hash = createHash('sha256');
for (const f of ['index.html', ...files]) hash.update(f).update(await readFile(`dist/${f}`));
const version = hash.digest('hex').slice(0, 12), sw = await readFile('src/sw.js', 'utf8');
const swLine = "const VERSION = 'dev', FILES = [];";
if (!sw.includes(swLine)) { console.error(`src/sw.js lost its line: ${swLine}`); process.exit(1); }
await writeFile('dist/sw.js', sw.replace(swLine, `const VERSION = '${version}', FILES = ${JSON.stringify(files)};`));
console.log(`built dist/ (${files.length} files cached as ${version})${relay ? ` (relay ${relay})` : ''}`);
