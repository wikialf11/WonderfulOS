// Datos de las apps de WonderfulOS (Listas, Notas, Calendario y Llavero):
// documentos JSON guardados en el disco local y sincronizados al momento con
// las ventanas abiertas.
//
// Cada documento: { id, app, owner, data, version, updated }.
// Los cambios llegan como operaciones pequeñas sobre `data` (set / del / push).
// No hay miembros, invitaciones, roles ni documentos compartidos.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as store from './store.mjs';

const { HttpError } = store;
const fail = (status, message) => { throw new HttpError(status, message); };

export const APPS = ['listas', 'notas', 'calendario', 'llavero', 'correo'];
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
const isOwner = (d, user) => d.owner === user;
const view = (d) => d;

function get(user, app, id) {
  const d = docs.get(id);
  if (!d || d.app !== app || !isOwner(d, user)) fail(404, 'No encontrado');
  return d;
}

// ---------- Tiempo real (Server-Sent Events) ----------
const streams = new Map(); // usuario -> Set(res)
export function events(user, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (!streams.has(user)) streams.set(user, new Set());
  streams.get(user).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 60000);
  req.on('close', () => { clearInterval(ping); streams.get(user)?.delete(res); });
}
function broadcast(d, type = 'doc') {
  const payload = type === 'removed'
    ? { type: 'removed', app: d.app, id: d.id }
    : { type, doc: view(d) };
  for (const res of streams.get(d.owner) || []) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
// ---------- Operaciones ----------
export function list(user, app) {
  if (!APPS.includes(app)) fail(404, 'App desconocida');
  return [...docs.values()].filter((d) => d.app === app && isOwner(d, user)).map(view);
}

export function create(user, app, data = {}) {
  if (!APPS.includes(app)) fail(404, 'App desconocida');
  if (JSON.stringify(data).length > MAX_DOC) fail(413, 'Demasiado grande');
  const d = { id: randomUUID(), app, owner: user, data, version: 1, updated: Date.now() };
  docs.set(d.id, d);
  save(d);
  broadcast(d);
  return view(d);
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

export function patch(user, app, id, ops) {
  const d = get(user, app, id);
  if (!Array.isArray(ops) || !ops.length || ops.length > 200) fail(400, 'Operaciones no válidas');
  const next = structuredClone(d.data);
  for (const op of ops) applyOp(next, op);
  if (JSON.stringify(next).length > MAX_DOC) fail(413, 'Demasiado grande');
  d.data = next;
  d.version++;
  d.updated = Date.now();
  save(d);
  broadcast(d);
  return view(d);
}

export function remove(user, app, id) {
  const d = get(user, app, id);
  docs.delete(id);
  try { unlinkSync(path.join(DIR, `${id}.json`)); } catch { /* ya no estaba */ }
  broadcast(d, 'removed');
  return { ok: true };
}
