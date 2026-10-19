// Oficina de WonderfulOS: LibreOffice en el navegador mediante Collabora Online.
//
// WonderfulOS hace de «anfitrión WOPI»: Collabora pide el archivo a /wopi/files/<id>,
// lo edita con LibreOffice en su servidor y lo devuelve guardado. Cada acceso va
// firmado (access_token) con el usuario, el dueño, la ruta y si puede escribir.
//
// Variables:
//   COLLABORA_URL     Dirección de Collabora que ve el navegador (https://office.ejemplo.com).
//   COLLABORA_INTERNAL_URL  Opcional: dirección desde la que este servidor lee /hosting/discovery.
//   NUBEOS_WOPI_URL   Dirección de WonderfulOS que ve Collabora (por defecto, la pública del escritorio).
//   NUBEOS_OFFICE_SECRET  Clave para firmar los accesos (si falta, se genera y guarda en los datos).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import * as store from './store.mjs';
import { machineMode, machineHost } from './provision.mjs';

const { HttpError } = store;
const fail = (status, message) => { throw new HttpError(status, message); };

export const COLLABORA_URL = (process.env.COLLABORA_URL || '').replace(/\/$/, '');
const DISCOVERY_URL = (process.env.COLLABORA_INTERNAL_URL || COLLABORA_URL).replace(/\/$/, '');
export const officeEnabled = () => !!COLLABORA_URL;

const SECRET = process.env.NUBEOS_OFFICE_SECRET || (() => {
  const file = path.join(store.DATA, 'office-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
})();
const TOKEN_HOURS = 10;
const MAX_DOC = 500 * 1024 * 1024;

// Plantillas vacías para «Nuevo documento / hoja / presentación».
export const KINDS = {
  texto: { ext: 'docx', name: 'Documento' },
  calculo: { ext: 'xlsx', name: 'Hoja de cálculo' },
  diapositivas: { ext: 'pptx', name: 'Presentación' },
};
const template = (ext) => new URL(`./templates/vacio.${ext}`, import.meta.url);

// LibreOffice de cada usuario: el de su ordenador (VPS) o, en pruebas, el de este servidor.
function officeBase(user) {
  const mode = machineMode(user);
  if (mode === 'remoto') return { browser: `https://${machineHost(user)}`, internal: `https://${machineHost(user)}` };
  // LibreOffice compartido de este servidor (versión web), si está configurado.
  if (COLLABORA_URL) return { browser: COLLABORA_URL, internal: DISCOVERY_URL };
  return null;
}
export const officeAvailable = (user) => !!officeBase(user);

// ---------- Discovery: qué dirección de Collabora abre cada extensión ----------
const discoveries = new Map(); // base -> { at, map }
async function actions(base) {
  const discovery = discoveries.get(base.internal) || { at: 0, map: {} };
  if (Date.now() - discovery.at < 3600e3 && Object.keys(discovery.map).length) return discovery.map;
  const res = await fetch(`${base.internal}/hosting/discovery`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res?.ok) fail(503, 'La oficina no está disponible ahora mismo. Inténtalo en un momento.');
  const xml = await res.text();
  const map = {};
  for (const m of xml.matchAll(/<action\b([^>]*)\/?>/g)) {
    const attr = (k) => (m[1].match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
    const ext = attr('ext'), name = attr('name'), url = attr('urlsrc');
    if (ext && url && ['edit', 'view'].includes(name) && !(map[ext]?.name === 'edit')) map[ext] = { name, url };
  }
  // Las direcciones del discovery son las internas; el navegador usa la pública.
  for (const a of Object.values(map)) a.url = a.url.replace(base.internal, base.browser);
  discoveries.set(base.internal, { at: Date.now(), map });
  return map;
}

// ---------- Fichas de acceso firmadas ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString();
const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

function makeToken(claims) {
  const body = b64(JSON.stringify({ ...claims, e: Date.now() + TOKEN_HOURS * 3600e3 }));
  return `${body}.${sign(body)}`;
}
function readToken(token, fileId) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) fail(401, 'Falta el acceso');
  const good = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (good.length !== got.length || !timingSafeEqual(good, got)) fail(401, 'Acceso no válido');
  const c = JSON.parse(unb64(body));
  if (c.e < Date.now()) fail(401, 'El acceso ha caducado: vuelve a abrir el documento');
  if (c.f !== fileId) fail(401, 'Acceso no válido para este archivo');
  return c;
}
// El id es el mismo para todos los que abren el mismo archivo: así Collabora los
// junta en la misma sesión y editan a la vez.
const fileIdOf = (owner, p) => b64(`${owner}\n${p}`);

// ---------- Abrir un documento ----------
/** target: { path } (propio) o { share, rel } (compartido contigo). */
/** opts (compartido P2P): { guest: nombre de quien entra, write, origin: dirección de su escritorio }. */
export async function open(user, target, publicOrigin, opts = {}) {
  const base = officeBase(user);
  if (!base) fail(503, 'En la versión web la oficina no está disponible ahora mismo. Con WonderfulOS instalado en tu ordenador se abre con LibreOffice.');
  let owner = user, p, canWrite = true;
  if (target.share) {
    const s = store.getShare(String(target.share));
    if (!s || s.to !== user || s.kind === 'app') fail(404, 'No encontrado');
    p = s.kind === 'file' ? s.path : store.normalize(s.path + store.normalize(String(target.rel || '/')));
    owner = s.owner;
    canWrite = s.perm === 'edit';
  } else p = store.normalize(String(target.path || ''));
  const node = store.tree(owner)[p];
  if (!node || node.type !== 'file') fail(404, 'No existe ese archivo');
  const ext = (p.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || '';
  const action = (await actions(base))[ext];
  if (!action) fail(415, `La oficina no abre archivos .${ext || '?'}`);
  const fileId = fileIdOf(owner, p);
  const token = makeToken({ f: fileId, u: opts.guest || user, o: owner, p, w: canWrite && opts.write !== false && action.name === 'edit', ...(opts.origin ? { po: opts.origin } : {}) });
  const wopiBase = (process.env.NUBEOS_WOPI_URL || publicOrigin).replace(/\/$/, '');
  const url = new URL(action.url.replace(/<[^>]*>/g, '').replace(/[?&]$/, ''));
  if (opts.remoteOrigin) { const r = new URL(opts.remoteOrigin); url.protocol = r.protocol; url.host = r.host; }
  url.searchParams.set('WOPISrc', `${wopiBase}/wopi/files/${fileId}`);
  url.searchParams.set('lang', 'es');
  return { url: url.href, token, ttl: Date.now() + TOKEN_HOURS * 3600e3 };
}

/** Crea un documento vacío (docx/xlsx/pptx) en una carpeta propia. */
export function create(user, dir, kind, name) {
  const k = KINDS[kind];
  if (!k) fail(400, 'Tipo de documento no válido');
  const base = String(name || k.name).replace(/[/\\]/g, '-').replace(/\.[^.]+$/, '') || k.name;
  const t = store.tree(user);
  dir = store.normalize(String(dir || '/Documentos'));
  let p = `${dir === '/' ? '' : dir}/${base}.${k.ext}`;
  for (let i = 2; t[p]; i++) p = `${dir === '/' ? '' : dir}/${base} ${i}.${k.ext}`;
  const bytes = readFileSync(template(k.ext));
  const { id } = store.prepareUpload(user, p, bytes.length);
  writeFileSync(store.blobPath(id), bytes);
  return { path: p, node: store.finishUpload(user, p, id, bytes.length, '') };
}

// ---------- Rutas WOPI (las llama el servidor de Collabora) ----------
export async function wopiHandler(req, res, url) {
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  try {
    const [, , , fileId, sub] = url.pathname.split('/'); // /wopi/files/<id>[/contents]
    const c = readToken(url.searchParams.get('access_token'), fileId);
    const t = store.tree(c.o);
    const node = t[c.p];
    if (!node || node.type !== 'file') fail(404, 'No existe');
    const name = c.p.split('/').pop();

    if (!sub && req.method === 'GET') {
      const size = node.blob ? node.size : Buffer.byteLength(node.content || '');
      return send(200, {
        BaseFileName: name,
        Size: size,
        OwnerId: c.o,
        UserId: c.u,
        UserFriendlyName: c.u,
        Version: String(node.mtime || 0),
        LastModifiedTime: new Date(node.mtime || Date.now()).toISOString(),
        UserCanWrite: !!c.w,
        ReadOnly: !c.w,
        SupportsUpdate: true,
        SupportsLocks: false,
        UserCanNotWriteRelative: true,
        DisablePrint: false,
        DisableExport: false,
        HidePrintOption: false,
        HideSaveOption: false,
        HideExportOption: false,
        EnableOwnerTermination: false,
        PostMessageOrigin: c.po || process.env.NUBEOS_PUBLIC_ORIGIN || undefined,
      });
    }
    if (sub === 'contents' && req.method === 'GET') {
      if (!node.blob) {
        const buf = Buffer.from(node.content || '');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
        return res.end(buf);
      }
      const info = await stat(store.blobPath(node.blob)).catch(() => fail(404, 'No existe'));
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size });
      return createReadStream(store.blobPath(node.blob)).pipe(res);
    }
    if (sub === 'contents' && req.method === 'POST') {
      if (!c.w) fail(403, 'Solo lectura');
      const size = Number(req.headers['content-length']);
      if (!Number.isFinite(size) || size > MAX_DOC) fail(413, 'Documento demasiado grande');
      const { id } = store.prepareUpload(c.o, c.p, size);
      let received = 0;
      try {
        await pipeline(req, async function* (src) { for await (const chunk of src) { received += chunk.length; yield chunk; } }, createWriteStream(store.blobPath(id)));
        if (received !== size) throw new Error('Guardado incompleto');
      } catch (e) { store.removeBlob(id); throw new HttpError(400, e.message); }
      const saved = store.finishUpload(c.o, c.p, id, size, node.mime || '');
      return send(200, { LastModifiedTime: new Date(saved.mtime).toISOString() }, { 'X-COOL-WOPI-Timestamp': new Date(saved.mtime).toISOString() });
    }
    fail(404, 'No encontrado');
  } catch (err) {
    if (err instanceof HttpError) return send(err.status === 507 ? 413 : err.status, { error: err.message });
    console.error('[oficina]', err);
    return send(500, { error: 'Error interno' });
  }
}
