// API de WonderfulOS: cuentas, archivos, subidas, compartir y planes de almacenamiento.
// Todas las peticiones llevan la cabecera x-nubeos (el navegador no deja que otra
// web la envíe sin permiso) y, si traen Origin, debe ser el del propio escritorio.

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as store from './store.mjs';
import * as billing from './billing.mjs';
import * as office from './office.mjs';
import * as appdata from './appdata.mjs';
import * as browser from './browser.mjs';
import { machineOf, provisioningMode, registerAgent, agentReady, verifyAgent, agentCall, machineMode } from './provision.mjs';
import { assertPublic, unwrapRedirect, BROWSER_UA, signProxyToken } from './proxy.mjs';

const MAX_UPLOAD = Number(process.env.NUBEOS_MAX_UPLOAD_MB || 2048) * 1024 * 1024;
const { HttpError } = store;
const COOKIE = 'nubeos_sid';

const fail = (status, message) => { throw new HttpError(status, message); };

// Si se define, hace falta este código para crear una cuenta (pruebas cerradas).
const INVITE_CODE = process.env.NUBEOS_INVITE_CODE;
export const inviteRequired = () => !!INVITE_CODE;

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;

function setSession(req, res, token) {
  const secure = (isHttps(req) ? '; Secure' : '');
  res.setHeader('set-cookie', token
    ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`
    : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

async function readJson(req, limit = 6 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(413, 'Petición demasiado grande');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail(400, 'JSON no válido'); }
}

// Pequeño freno contra quien prueba contraseñas: 10 intentos fallidos por minuto e IP.
const attempts = new Map();
function throttle(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 10) fail(429, 'Demasiados intentos. Espera un minuto.');
  attempts.set(ip, list);
  return () => { list.push(now); };
}

// ---------- Descargas del Navegador: las baja el servidor directamente a tu nube ----------
const downloads = new Map(); // id -> { owner, received, total, done, error }
async function startDownload(owner, rawUrl) {
  let target = new URL(rawUrl);
  if (!['http:', 'https:'].includes(target.protocol)) throw new HttpError(400, 'Solo se admiten direcciones http(s)');
  const unwrapped = unwrapRedirect(target);
  if (unwrapped) target = new URL(unwrapped);
  await assertPublic(target);
  const { used, quota, planName } = store.account(owner);
  const free = quota - used;
  if (free <= 0) throw new HttpError(507, `No queda espacio en tu plan ${planName}`);
  const id = store.newBlob(owner);
  const state = { owner, received: 0, total: 0, done: false, error: null };
  downloads.set(id, state);
  (async () => {
    try {
      const res = await fetch(target, { headers: { 'user-agent': BROWSER_UA } });
      if (res.url) await assertPublic(new URL(res.url));
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      state.total = Number(res.headers.get('content-length')) || 0;
      if (state.total > free) throw new Error(`No cabe: ocupa más que el espacio libre de tu plan ${planName}`);
      if (state.total > MAX_UPLOAD) throw new Error('El archivo es demasiado grande');
      const count = new Transform({ transform(chunk, _, cb) {
        state.received += chunk.length;
        cb(state.received > free || state.received > MAX_UPLOAD ? new Error('No cabe en tu espacio') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(store.blobPath(id)));
      state.done = true;
    } catch (err) {
      state.error = err.message;
      store.removeBlob(id);
    }
    setTimeout(() => downloads.delete(id), 3600e3);
  })();
  return id;
}

// Sube un archivo del ordenador del usuario: el cuerpo es el archivo tal cual.
async function upload(req, user, url) {
  const size = Number(req.headers['content-length']);
  if (!Number.isFinite(size)) throw new HttpError(411, 'Falta el tamaño del archivo');
  if (size > MAX_UPLOAD) throw new HttpError(413, `El archivo es demasiado grande (máximo ${Math.round(MAX_UPLOAD / 1024 ** 2)} MB)`);
  const { path, id } = store.prepareUpload(user, String(url.searchParams.get('path') || ''), size);
  let received = 0;
  const count = new Transform({ transform(chunk, _, cb) { received += chunk.length; cb(received > size ? new Error('El archivo es más grande de lo anunciado') : null, chunk); } });
  try {
    await pipeline(req, count, createWriteStream(store.blobPath(id)));
    if (received !== size) throw new Error('La subida se cortó');
  } catch (e) {
    store.removeBlob(id);
    throw new HttpError(400, e.message);
  }
  return store.finishUpload(user, path, id, size, req.headers['content-type']);
}

export async function apiHandler(req, res, url) {
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    // Avisos de Stripe: no llevan sesión ni cabecera; se validan por su firma.
    if (url.pathname === '/api/stripe/webhook' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await billing.webhook(Buffer.concat(chunks).toString('utf8'), req.headers['stripe-signature']);
      return send(200, { received: true });
    }
    // Estado público mínimo (sin datos privados) para comprobar la configuración.
    if (url.pathname === '/api/status' && req.method === 'GET') {
      return send(200, { venta: billing.sellingEnabled(), pagosReales: billing.paymentsLive(), planes: billing.plans().map((p) => `${p.id}:${p.available ? 'sí' : 'no'}`) });
    }
    // --- Archivos subidos: verlos o bajarlos al ordenador ---
    // Va antes de la comprobación de cabecera: lo piden <img>, <iframe> y enlaces de descarga,
    // que solo llevan la cookie (SameSite=Lax: otra web no puede leer la respuesta).
    if (req.method === 'GET' && url.pathname.startsWith('/api/blobs/')) {
      const id = url.pathname.split('/')[3];
      const user = store.sessionUser(cookies(req)[COOKIE]);
      if (!user || !store.canReadBlob(user, id)) fail(404, 'No encontrado');
      const info = await stat(store.blobPath(id)).catch(() => fail(404, 'No encontrado'));
      const name = String(url.searchParams.get('name') || 'archivo').replace(/[\r\n"]/g, '');
      const inline = url.searchParams.get('inline') === '1';
      // Se ve dentro de WonderfulOS solo lo que no puede ejecutar código (imágenes, PDF, audio, vídeo).
      const mime = String(url.searchParams.get('type') || '');
      const safe = /^(image\/(png|jpeg|gif|webp)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/.test(mime);
      res.writeHead(200, {
        'content-type': inline && safe ? mime : 'application/octet-stream',
        'content-length': info.size,
        'content-disposition': `${inline && safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        // El visor de PDF del navegador no funciona dentro de un documento aislado (sandbox).
        'content-security-policy': inline && mime === 'application/pdf' ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=300',
      });
      return createReadStream(store.blobPath(id)).pipe(res);
    }

    // Ordenadores de los usuarios: se registran con su código de un solo uso y firman lo que envían.
    if (url.pathname === '/api/agent/register' && req.method === 'POST') {
      const { code, ip } = await readJson(req, 1000);
      const cfg = registerAgent(String(code || ''), String(ip || ''));
      if (!cfg) fail(404, 'Código no válido');
      return send(200, cfg);
    }
    if (url.pathname === '/api/agent/ready' && req.method === 'POST') {
      const { code } = await readJson(req, 1000);
      return send(agentReady(String(code || '')) ? 200 : 404, {});
    }
    if (url.pathname === '/api/agent/upload' && req.method === 'POST') {
      // Algo descargado con el Navegador del ordenador del usuario → su Archivos › Descargas.
      const u = String(url.searchParams.get('u') || ''), name = String(url.searchParams.get('name') || 'descarga').replace(/[\/\\]/g, '-').slice(0, 200);
      const size = Number(url.searchParams.get('size'));
      if (!verifyAgent(u, url.searchParams.get('sig'), `${u}|${url.searchParams.get('name')}|${url.searchParams.get('size')}`)) fail(403, 'Prohibido');
      const t = store.tree(u);
      const [, stem, ext] = name.match(/^(.*?)(\.[^.]*)?$/);
      let p = `/Descargas/${name}`;
      for (let i = 2; t[p]; i++) p = `/Descargas/${stem} (${i})${ext || ''}`;
      let prepared;
      try { prepared = store.prepareUpload(u, p, size); }
      catch (e) { appdata.notifyUser(u, { kind: 'download-error', name, error: e.message }); throw e; }
      let received = 0;
      try {
        await pipeline(req, new Transform({ transform(c, _, cb) { received += c.length; cb(received > size ? new Error('Tamaño incorrecto') : null, c); } }), createWriteStream(store.blobPath(prepared.id)));
        if (received !== size) throw new Error('La subida se cortó');
      } catch (e) { store.removeBlob(prepared.id); throw new HttpError(400, e.message); }
      store.finishUpload(u, p, prepared.id, size, '');
      appdata.notifyUser(u, { kind: 'download', path: p });
      return send(200, { ok: true });
    }
    // Extensión de WonderfulOS dentro del Chromium de cada usuario: va con su propia ficha.
    if (url.pathname === '/api/browser/ext/poll' && req.method === 'GET') return browser.extPoll(url.searchParams.get('t'), res);
    if (url.pathname === '/api/browser/ext/event' && req.method === 'POST') { browser.extEvent(url.searchParams.get('t'), await readJson(req, 20000)); return send(200, { ok: true }); }
    // Avisos en tiempo real: EventSource no puede mandar cabeceras, va solo con la cookie
    // (otra web no puede leer la respuesta).
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const u = store.sessionUser(cookies(req)[COOKIE]);
      if (!u) fail(401, 'Inicia sesión');
      return appdata.events(u, req, res);
    }
    if (req.headers['x-nubeos'] !== '1') fail(403, 'Prohibido');
    const origin = req.headers.origin;
    // Detrás del proxy del hosting el esquema puede no llegar bien: comparamos el host.
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { fail(403, 'Origen no permitido'); }
      if (host !== req.headers.host) fail(403, 'Origen no permitido');
    }

    const parts = url.pathname.split('/').slice(2); // tras /api/
    const route = `${req.method} /${parts[0] || ''}${parts[1] ? '/' + parts[1] : ''}`;
    const token = cookies(req)[COOKIE];

    // --- Cuentas (sin sesión) ---
    if (route === 'POST /auth/register' || route === 'POST /auth/login') {
      const done = throttle(req);
      const { username, password, invite } = await readJson(req, 10000);
      let s;
      try {
        if (parts[1] === 'register' && INVITE_CODE && invite !== INVITE_CODE) fail(403, 'El código de invitación no es correcto');
        s = parts[1] === 'register' ? store.register(username, password) : store.login(username, password);
      }
      catch (err) { done(); throw err; }
      setSession(req, res, s.token);
      return send(200, { user: s.user });
    }
    if (route === 'POST /auth/logout') { store.logout(token); setSession(req, res, null); return send(200, { ok: true }); }

    const user = store.sessionUser(token);
    if (!user) fail(401, 'Inicia sesión');
    if (route === 'GET /auth/me') return send(200, { user });
    if (route === 'GET /proxy-token') return send(200, { token: signProxyToken(user) });

    // --- Archivos propios ---
    if (route === 'GET /fs') return send(200, { nodes: store.tree(user) });
    if (route === 'POST /fs') { store.applyOps(user, (await readJson(req)).ops); return send(200, { ok: true }); }
    if (route === 'POST /fs/reset') { store.resetTree(user); return send(200, { nodes: store.tree(user) }); }

    // --- Cuenta, espacio y plan ---
    if (route === 'GET /account') return send(200, { ...store.account(user), plans: billing.plans(), selling: billing.sellingEnabled() });
    if (route === 'POST /billing/checkout') {
      const origin = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
      return send(200, { url: await billing.checkout(user, (await readJson(req, 1000)).plan, origin) });
    }
    if (route === 'POST /billing/cancel') return send(200, { url: await billing.cancel(user) });

    // --- Oficina (LibreOffice en el navegador, ver office.mjs) ---
    if (route === 'GET /office/info') return send(200, { enabled: office.officeAvailable(user) });

    // --- Buscar apps en Flathub (la tienda de apps de Linux) ---
    if (route === 'GET /flathub/search') {
      const q = String(url.searchParams.get('q') || '').slice(0, 100);
      const r = await fetch('https://flathub.org/api/v2/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, filters: [] }), signal: AbortSignal.timeout(10000) });
      const data = await r.json().catch(() => ({}));
      const hits = (data.hits || []).slice(0, 24).map((h) => ({ id: h.app_id, name: h.name, summary: h.summary, icon: h.icon }));
      return send(200, { hits });
    }

    // --- Mi ordenador (plan con ordenador propio) y sus apps de Linux ---
    if (route === 'GET /machine') return send(200, { machine: machineOf(user), mode: machineMode(user), provisioning: provisioningMode() });
    if (parts[0] === 'machine' && parts[1] === 'apps') {
      if (machineMode(user) !== 'remoto') fail(402, 'Las apps de Linux vienen con los planes con ordenador propio');
      if (req.method === 'GET' && !parts[2]) return send(200, await agentCall(user, '/apps'));
      if (req.method === 'POST' && ['install', 'uninstall', 'session'].includes(parts[2])) return send(200, await agentCall(user, `/apps/${parts[2]}`, await readJson(req, 2000)));
    }
    if (route === 'POST /office/open') {
      const origin = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
      return send(200, await office.open(user, await readJson(req, 4000), origin));
    }
    if (route === 'POST /office/new') {
      const { dir, kind, name } = await readJson(req, 4000);
      return send(200, office.create(user, dir, kind, name));
    }

    // --- Navegador completo (Chromium en un contenedor, ver browser.mjs) ---
    if (route === 'GET /browser/info') return send(200, { enabled: browser.available(user) });
    if (route === 'POST /browser/start') {
      const o = await readJson(req, 2000);
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      return send(200, await browser.start(user, { width: Number(o.width) || 1600, height: Number(o.height) || 900, dark: !!o.dark, accent: String(o.accent || ''), host }));
    }
    if (route === 'POST /browser/keepalive') { browser.keepalive(user); return send(200, { ok: true }); }
    if (route === 'POST /browser/resize') { const o = await readJson(req, 1000); await browser.resize(user, Number(o.width) || 1600, Number(o.height) || 900); return send(200, { ok: true }); }
    if (route === 'GET /browser/page') return send(200, { page: browser.currentPage(user) });
    if (route === 'POST /browser/fill') { const o = await readJson(req, 4000); browser.fill(user, o.user, o.pass); return send(200, { ok: true }); }
    if (route === 'POST /browser/stop') { await browser.stop(user); return send(200, { ok: true }); }

    // --- Descargas desde el Navegador ---
    if (route === 'POST /downloads') return send(200, { id: await startDownload(user, (await readJson(req, 10000)).url) });
    if (route.startsWith('GET /downloads/')) {
      const d = downloads.get(parts[1]);
      if (!d || d.owner !== user) fail(404, 'No encontrado');
      const { owner, ...status } = d;
      return send(200, status);
    }

    // --- Subir archivos del ordenador ---
    if (route === 'POST /upload') return send(200, { node: await upload(req, user, url) });

    // --- Datos de las apps (Listas, Notas, Calendario y Recordatorios) ---
    if (parts[0] === 'apps' && parts[1]) {
      const [, app, id, sub] = parts;
      if (req.method === 'GET' && !id) return send(200, { docs: appdata.list(user, app) });
      if (req.method === 'POST' && !id) return send(200, { doc: appdata.create(user, app, (await readJson(req)).data) });
      if (req.method === 'POST' && sub === 'ops') return send(200, { doc: appdata.patch(user, app, id, (await readJson(req)).ops) });
      if (req.method === 'DELETE' && id && !sub) return send(200, appdata.remove(user, app, id));
    }

    fail(404, 'No encontrado');
  } catch (err) {
    if (err instanceof HttpError || (err.status >= 400 && err.status < 600)) return send(err.status, { error: err.message });
    console.error(err);
    return send(500, { error: 'Error interno' });
  }
}
