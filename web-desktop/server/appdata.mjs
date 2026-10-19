// Datos de las apps de WonderfulOS (Listas, Notas, Calendario, Recordatorios, Mensajes):
// documentos JSON en la nube, compartidos entre cuentas y sincronizados al momento.
//
// Cada documento: { id, app, owner, members: { usuario: rol }, data, version, updated }.
// Roles: owner (todo), edit (cambiar el contenido), complete (solo marcar tareas),
// read (solo ver). Los cambios llegan como operaciones pequeñas sobre `data`
// (set / del / push), así dos personas pueden tocar el mismo documento a la vez
// sin pisarse; cada cambio se envía al instante a los miembros conectados (SSE).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as store from './store.mjs';

const { HttpError } = store;
const fail = (status, message) => { throw new HttpError(status, message); };

export const APPS = ['listas', 'notas', 'calendario', 'recordatorios', 'mensajes', 'llavero'];
const ROLES = ['read', 'complete', 'edit'];
const MAX_DOC = 2 * 1024 * 1024;
const DIR = path.join(store.DATA, 'apps');
mkdirSync(DIR, { recursive: true });

// ---------- Almacenamiento ----------
const docs = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  try { const d = JSON.parse(readFileSync(path.join(DIR, f), 'utf8')); docs.set(d.id, d); } catch { /* archivo dañado: se ignora */ }
}
function save(d) {
  const file = path.join(DIR, `${d.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(d));
  renameSync(`${file}.tmp`, file);
}
const roleOf = (d, user) => (d.owner === user ? 'owner' : d.members[user] || null);
const view = (d, user) => ({ ...d, role: roleOf(d, user) });

function get(user, app, id) {
  const d = docs.get(id);
  if (!d || d.app !== app || !roleOf(d, user)) fail(404, 'No encontrado');
  return d;
}

// ---------- Tiempo real (Server-Sent Events) ----------
const streams = new Map(); // usuario -> Set(res)
export function events(user, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (!streams.has(user)) streams.set(user, new Set());
  streams.get(user).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); streams.get(user)?.delete(res); });
}
function broadcast(d, type = 'doc', extra = []) {
  const users = new Set([d.owner, ...Object.keys(d.members), ...extra]);
  for (const u of users) {
    const payload = type === 'removed' || !roleOf(d, u) ? { type: 'removed', app: d.app, id: d.id } : { type, doc: view(d, u) };
    for (const res of streams.get(u) || []) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}
/** Aviso a una cuenta (p. ej. «te han compartido una lista»), si está conectada. */
export function notifyUser(user, payload) {
  for (const res of streams.get(user) || []) res.write(`data: ${JSON.stringify({ type: 'notice', ...payload })}\n\n`);
}

// ---------- Operaciones ----------
export function list(user, app) {
  if (!APPS.includes(app)) fail(404, 'App desconocida');
  return [...docs.values()].filter((d) => d.app === app && roleOf(d, user)).map((d) => view(d, user));
}

export function create(user, app, data = {}) {
  if (!APPS.includes(app)) fail(404, 'App desconocida');
  if (JSON.stringify(data).length > MAX_DOC) fail(413, 'Demasiado grande');
  const d = { id: randomUUID(), app, owner: user, members: {}, data, version: 1, updated: Date.now() };
  docs.set(d.id, d);
  save(d);
  broadcast(d);
  return view(d, user);
}

// Ruta dentro de data: lista de claves (texto o número). Nada de __proto__ y compañía.
function walk(obj, keys, create) {
  let o = obj;
  for (const k of keys) {
    if (['__proto__', 'prototype', 'constructor'].includes(String(k))) fail(400, 'Ruta no válida');
    if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') { if (!create) return undefined; o[k] = {}; }
    o = o[k];
  }
  return o;
}
function applyOp(data, op) {
  const p = Array.isArray(op.path) ? op.path.map((k) => (typeof k === 'number' ? k : String(k))) : fail(400, 'Ruta no válida');
  if (!p.length || p.length > 8) fail(400, 'Ruta no válida');
  const last = p.at(-1);
  if (['__proto__', 'prototype', 'constructor'].includes(String(last))) fail(400, 'Ruta no válida');
  if (op.op === 'set') walk(data, p.slice(0, -1), true)[last] = op.value;
  else if (op.op === 'del') { const parent = walk(data, p.slice(0, -1), false); if (parent) delete parent[last]; }
  else if (op.op === 'push') {
    const parent = walk(data, p.slice(0, -1), true);
    if (!Array.isArray(parent[last])) parent[last] = [];
    parent[last].push(op.value);
    if (parent[last].length > 5000) parent[last].splice(0, parent[last].length - 5000);
  } else fail(400, 'Operación desconocida');
}

// Qué puede tocar cada rol. «complete» solo marca tareas: tasks.<id>.done / doneAt / doneBy / due.
function allowed(role, app, ops) {
  if (role === 'owner' || role === 'edit') return true;
  if (role === 'complete' && app === 'listas') {
    return ops.every((o) => o.op === 'set' && o.path?.[0] === 'tasks' && o.path.length === 3 && ['done', 'doneAt', 'doneBy', 'due'].includes(o.path[2]));
  }
  // En Mensajes cualquiera de la conversación escribe (añadir mensajes y marcar leído).
  if (app === 'mensajes' && role) return ops.every((o) => (o.op === 'push' && o.path?.[0] === 'messages') || (o.op === 'set' && o.path?.[0] === 'read'));
  return false;
}

export function patch(user, app, id, ops) {
  const d = get(user, app, id);
  if (!Array.isArray(ops) || !ops.length || ops.length > 200) fail(400, 'Operaciones no válidas');
  const role = roleOf(d, user);
  if (!allowed(role, app, ops)) fail(403, role === 'complete' ? 'Solo puedes marcar tareas en esta lista' : 'Solo puedes ver este elemento');
  const next = structuredClone(d.data);
  for (const op of ops) {
    // Los mensajes los firma el servidor: nadie escribe en nombre de otro.
    if (app === 'mensajes' && op.op === 'push' && op.path[0] === 'messages') op.value = { ...op.value, from: user, at: Date.now(), text: String(op.value?.text || '').slice(0, 5000) };
    applyOp(next, op);
  }
  if (JSON.stringify(next).length > MAX_DOC) fail(413, 'Demasiado grande');
  d.data = next;
  d.version++;
  d.updated = Date.now();
  save(d);
  broadcast(d);
  return view(d, user);
}

export function share(user, app, id, to, role) {
  const d = get(user, app, id);
  if (app === 'llavero') fail(400, 'El llavero es personal: está cifrado con tu contraseña maestra');
  if (roleOf(d, user) !== 'owner' && app !== 'mensajes') fail(403, 'Solo quien lo creó puede invitar');
  to = String(to || '').trim().toLowerCase();
  if (!store.userExists(to)) fail(404, `No existe el usuario ${to}`);
  if (to === d.owner) fail(400, 'Ya es el dueño');
  if (!ROLES.includes(role)) role = 'edit';
  const isNew = !d.members[to];
  d.members[to] = role;
  d.updated = Date.now();
  save(d);
  broadcast(d);
  if (isNew) notifyUser(to, { app, id, from: user, title: d.data?.title || d.data?.name || '' });
  return view(d, user);
}

export function unshare(user, app, id, who) {
  const d = get(user, app, id);
  who = String(who || '').toLowerCase();
  if (roleOf(d, user) !== 'owner' && who !== user) fail(403, 'Solo quien lo creó puede quitar a otros');
  delete d.members[who];
  d.updated = Date.now();
  save(d);
  broadcast(d, 'doc', [who]);
  return { ok: true };
}

export function remove(user, app, id) {
  const d = get(user, app, id);
  if (roleOf(d, user) !== 'owner') return unshare(user, app, id, user); // salir de algo compartido
  docs.delete(id);
  try { unlinkSync(path.join(DIR, `${id}.json`)); } catch { /* ya no estaba */ }
  broadcast(d, 'removed');
  return { ok: true };
}
