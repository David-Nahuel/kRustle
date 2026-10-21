// Sirve el build de producción (dist/web/browser) para las pruebas de humo, con la misma regla que
// Vercel (web/vercel/config.json): lo que no es un fichero va a index.html.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/web/browser/', import.meta.url));
const port = Number(process.argv[2] ?? 4300);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = resolve(join(root, path));
  if (!file.startsWith(resolve(root)) || !isFile(file)) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port);
