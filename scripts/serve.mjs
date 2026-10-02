// A static server for development and the smoke test: the game needs only
// this (ES modules won't load from file://). `node scripts/serve.mjs [port] [dir]`.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = +(process.argv[2] || 8000), root = process.argv[3] || '.';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log(`stompy on http://localhost:${port}/ (${root})`));
