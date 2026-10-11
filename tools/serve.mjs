import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.itou': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

export function playgroundServer() {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return;
    }
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') pathname = '/web/index.html';
      const section = ['web', 'src', 'examples'].find(name => pathname.startsWith(`/${name}/`));
      if (!section || pathname.includes('\0') || pathname.includes('\\')) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const base = await realpath(resolve(root, section));
      const path = await realpath(resolve(root, `.${pathname}`));
      if (!path.startsWith(base + sep) || !types[extname(path)]) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': types[extname(path)], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const status = error instanceof URIError ? 400 : 404;
      response.writeHead(status); response.end(status === 400 ? 'Bad request' : 'Not found');
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const server = playgroundServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`itouLang playground: http://127.0.0.1:${port}\nCtrl+C to stop.`));
}
