// Release build: one minified bundle plus the static files, in dist/.
// Development needs none of this; index.html loads src/main.js directly.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  outfile: 'dist/stompy.js', sourcemap: true, legalComments: 'none', logLevel: 'info' });
const html = (await readFile('index.html', 'utf8')).replace('<script type="module" src="src/main.js"></script>', '<script src="stompy.js"></script>');
await writeFile('dist/index.html', html);
for (const f of ['style.css', 'favicon.svg']) await cp(f, `dist/${f}`);
await cp('sounds', 'dist/sounds', { recursive: true });
console.log('built dist/');
