// Servicio local de WonderfulOS (sin dependencias):
//  - Escritorio + API (archivos, subidas y apps): puerto 4310.
//  - Proxy del Navegador (server/proxy.mjs): puerto 4311, u otro dominio si se define
//    PROXY_HOST. Va aparte a propósito: es otro origen y las webs visitadas no pueden
//    leer los datos del escritorio.
//
// Variables: PORT, PROXY_PORT, HOST, PROXY_HOST, PUBLIC_PROXY_ORIGIN, NUBEOS_ROLE (proxy),
// NUBEOS_PROXY_SECRET, NUBEOS_DATA, NUBEOS_USER y NUBEOS_MAX_UPLOAD_MB.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiHandler } from './server/api.mjs';
import { wopiHandler } from './server/office.mjs';
import { proxyHandler } from './server/proxy.mjs';
import { DATA } from './server/store.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4310);
const HOST = process.env.HOST || '127.0.0.1';
const PROXY_PORT = Number(process.env.PROXY_PORT || PORT + 1);
const PROXY_HOST = process.env.PROXY_HOST; // p. ej. proxy.local
const LOCAL = process.env.NUBEOS_LOCAL === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
// Lo que no debe servirse como archivo estático.
const PRIVATE = /^\/(server|tests|node_modules)(\/|$)|^\/(server\.mjs|package\.json)$/;

async function desktopHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return apiHandler(req, res, url);
  if (url.pathname.startsWith('/wopi/files/')) return wopiHandler(req, res, url);
  if (url.pathname.endsWith('/nubeos-config.json')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    const proxyOrigin = process.env.PUBLIC_PROXY_ORIGIN || (PROXY_HOST ? `https://${PROXY_HOST}` : null);
    const proxy = proxyOrigin ? { proxyOrigin } : LOCAL ? {} : { proxyPort: PROXY_PORT };
    return res.end(JSON.stringify(proxy));
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (PRIVATE.test(pathname)) { res.writeHead(404); return res.end(); }
  // En desarrollo también se sirve el prototipo del SO local (../os), que usa las
  // apps de este escritorio por la ruta /web-desktop/.
  let base = ROOT;
  if (pathname.startsWith('/os/')) base = path.join(ROOT, '..');
  else if (pathname.startsWith('/web-desktop/')) pathname = pathname.slice('/web-desktop'.length);
  if (PRIVATE.test(pathname)) { res.writeHead(404); return res.end(); }
  let file = path.normalize(path.join(base, pathname));
  if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403); return res.end(); }
  if (base !== ROOT && !file.startsWith(path.join(base, 'os') + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

if (process.env.NUBEOS_ROLE === 'proxy') {
  // El proxy desplegado como app aparte, en su propio dominio.
  http.createServer(proxyHandler).listen(PORT, HOST, () => console.log(`Proxy del Navegador WonderfulOS en el puerto ${PORT}`));
} else if (PROXY_HOST) {
  // Un solo puerto: el dominio decide si es el escritorio o el proxy.
  http.createServer((req, res) => ((req.headers.host || '').split(':')[0] === PROXY_HOST ? proxyHandler(req, res) : desktopHandler(req, res)))
    .listen(PORT, HOST, () => console.log(`WonderfulOS en el puerto ${PORT} (proxy en ${PROXY_HOST}). Datos: ${DATA}`));
} else {
  http.createServer(desktopHandler).listen(PORT, HOST, () => console.log(`Escritorio WonderfulOS: http://${HOST}:${PORT}  (datos en ${DATA})`));
  // En la app de escritorio el Navegador es su propio Chromium: no hace falta el proxy.
  if (!LOCAL) http.createServer(proxyHandler).listen(PROXY_PORT, HOST, () => console.log(`Proxy del Navegador: http://${HOST}:${PROXY_PORT}`));
}
