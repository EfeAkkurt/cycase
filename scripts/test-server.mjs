#!/usr/bin/env node
/**
 * The static server the browser suites run against.
 *
 * `vite preview` kept dying part-way through long headed runs, and every test
 * after it failed with ERR_CONNECTION_REFUSED — a cascade that reads as a wall
 * of product regressions and sends you hunting for bugs that are not there. It
 * cost hours across this project twice.
 *
 * This does the three things the suites actually need — serve `dist/`, fall back
 * to `index.html` for client routes, and set correct MIME types — and it does
 * not exit on a request error. `server.on('error')` and the two process-level
 * handlers are the point: a single bad request must never take the suite with it.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { resolveTestPort, testDistDir } from './test-port.mjs';

/*
 * `CYCASE_DIST_DIR` is set by Playwright's `webServer` from the same resolver
 * the config built the `--outDir` from, so the server always serves the bytes
 * this run just produced. Unset, this is `dist`.
 */
const ROOT = join(process.cwd(), process.env.CYCASE_DIST_DIR || testDistDir());

/*
 * `PORT` first, because Playwright's `webServer` sets it explicitly from the
 * same resolver the config used — so the server binds exactly what the suite is
 * waiting on. Run by hand with neither variable set, this is 4183 as before.
 */
const PORT = process.env.PORT ? Number(process.env.PORT) : resolveTestPort();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

if (!existsSync(ROOT)) {
  console.error(`dist/ is missing. Run \`npm run build\` first.`);
  process.exit(1);
}

/** Resolves a URL to a file inside dist/, or null. Refuses to escape the root. */
function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const target = join(ROOT, clean);
  if (!target.startsWith(ROOT)) return null;
  try {
    const stat = statSync(target);
    if (stat.isDirectory()) return resolve(join(clean, 'index.html'));
    return target;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  try {
    const direct = resolve(request.url ?? '/');

    /*
     * SPA fallback — but never for a file extension the app asked for by name.
     * Returning index.html for a missing .wav is what made three absent alarm
     * samples look like HTTP 200s in the network panel while the decoder
     * correctly rejected them, which is exactly the sort of thing that hides a
     * missing asset for a week.
     */
    const hasExtension = extname((request.url ?? '/').split('?')[0]) !== '';
    const file = direct ?? (hasExtension ? null : resolve('/index.html'));

    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    /*
     * `content-length` matters here beyond politeness: the transfer-budget test
     * sums it per response, and without it every response reads as zero bytes —
     * a 12 MB budget that can never be exceeded is not a budget.
     */
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch {
    // A malformed request must not end the process the whole suite depends on.
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});

server.on('clientError', (_error, socket) => socket.destroy());

/*
 * Retry the bind rather than exit.
 *
 * After the previous child is killed its socket lingers for a moment, so the
 * replacement's first `listen` fails with EADDRINUSE. Exiting there turns one
 * restart into a tight loop; waiting a beat and trying again turns it into a
 * pause of a few hundred milliseconds that no test notices.
 */
let bindAttempts = 0;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && bindAttempts < 40) {
    bindAttempts += 1;
    setTimeout(() => server.listen(PORT, '127.0.0.1'), 250);
    return;
  }
  console.error(`server error (continuing): ${error.message}`);
});
process.on('uncaughtException', (error) => console.error(`uncaught (continuing): ${error.message}`));
process.on('unhandledRejection', (error) => console.error(`unhandled (continuing): ${String(error)}`));

server.listen(PORT, '127.0.0.1', () => console.log(`serving dist/ on http://127.0.0.1:${PORT}`));
