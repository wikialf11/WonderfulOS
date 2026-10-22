// Almacenamiento local de WonderfulOS: archivos y archivos grandes (blobs).
// No hay cuentas, contraseñas, sesiones ni compartición: todo vive en este
// ordenador y pertenece al perfil local.

import {
  readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, statSync,
  statfsSync, readdirSync,
} from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const DATA = process.env.NUBEOS_DATA || path.join(os.homedir(), '.nubeos');
export const DISK = path.join(DATA, 'disco');
const FS_DIR = path.join(DATA, 'fs');
mkdirSync(DISK, { recursive: true });
mkdirSync(FS_DIR, { recursive: true });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Escritura atómica: primero a un temporal y luego se renombra.
function saveJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

// Perfil local. La app de escritorio puede indicar cuál usar con NUBEOS_USER para
// conservar los archivos de versiones anteriores. En el servicio local se usa el
// único perfil que ya exista o, si es nuevo, «local».
function resolveUser() {
  const env = String(process.env.NUBEOS_USER || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  if (env) return env.slice(0, 40);
  try {
    const files = readdirSync(FS_DIR).filter((f) => f.endsWith('.json'));
    if (files.length === 1) return files[0].slice(0, -5);
  } catch { /* todavía no hay archivos */ }
  return 'local';
}
export const USER = resolveUser();

// ---------- Archivos grandes (blobs) ----------
const BLOBS_FILE = path.join(DATA, 'blobs.json');
const blobs = loadJson(BLOBS_FILE, {}); // id -> { owner }

// ---------- Espacio ocupado ----------
const nodeSize = (n) => (n.type !== 'file' ? 0 : n.blob ? Number(n.size) || 0 : Buffer.byteLength(n.content || ''));
export function usage(user = USER) {
  let used = 0;
  for (const n of Object.values(tree(user))) used += nodeSize(n);
  return used;
}
export function account(user = USER) {
  const mine = usage(user);
  let free = 0, total = 0;
  try { const s = statfsSync(DATA); free = s.bavail * s.bsize; total = s.blocks * s.bsize; } catch { /* sin datos */ }
  return {
    user,
    local: true,
    quota: total || mine,
    used: total ? total - free : mine,
    mine,
    free: total ? free : 0,
  };
}
const assertSpace = (owner, extra) => {
  if (extra <= 0) return;
  const { used, quota } = account(owner);
  if (used + extra > quota) fail(507, 'No queda espacio en el disco. Libera espacio para seguir guardando.');
};

// ---------- Sistema de archivos ----------
// Mismo formato que el cliente (js/fs.js): ruta -> nodo.
const MAX_TEXT = 5 * 1024 * 1024;
const trees = new Map();

function seedTree() {
  const now = Date.now();
  const dir = { type: 'dir', mtime: now };
  return {
    '/': dir, '/Documentos': dir, '/Descargas': dir, '/Imágenes': dir,
    '/Documentos/Bienvenida.txt': {
      type: 'file', mtime: now,
      content: 'Bienvenido a WonderfulOS.\n\nTus archivos viven en este ordenador: nada sale de aquí.\n\n· Crea documentos, hojas de cálculo y presentaciones desde el dock.\n· En Archivos puedes subir archivos de tu ordenador (o arrastrarlos a la ventana).\n',
    },
  };
}

export function tree(user = USER) {
  if (!trees.has(user)) {
    const file = path.join(FS_DIR, `${user}.json`);
    trees.set(user, existsSync(file) ? loadJson(file, seedTree()) : seedTree());
  }
  return trees.get(user);
}
const saveTree = (user) => saveJson(path.join(FS_DIR, `${user}.json`), tree(user));

export function normalize(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) fail(400, 'Ruta no válida');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..' || seg.length > 255) fail(400, 'Ruta no válida');
    parts.push(seg);
  }
  return '/' + parts.join('/');
}
const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
const within = (p, root) => p === root || p.startsWith(root === '/' ? '/' : root + '/');

function cleanNode(owner, node) {
  if (!node || !['file', 'dir'].includes(node.type)) fail(400, 'Nodo no válido');
  if (node.type === 'dir') return { type: 'dir', mtime: Date.now() };
  if (node.blob !== undefined) {
    if (blobs[node.blob]?.owner !== owner) fail(403, 'Ese archivo no es válido');
    const { blob, mime, progress, received, error, source } = node;
    // El tamaño que cuenta para el espacio es el real del disco, no el que diga el navegador.
    let size = Number(node.size) || 0;
    try { size = Math.max(size, statSync(blobPath(blob)).size); } catch { /* aún no existe */ }
    return { type: 'file', blob, size, mime: String(mime || ''), progress: Number(progress) || 0, received: Number(received) || 0, error: error ? String(error) : undefined, source: source ? String(source) : undefined, mtime: Date.now() };
  }
  const content = String(node.content ?? '');
  if (content.length > MAX_TEXT) fail(413, 'El documento es demasiado grande');
  return { type: 'file', content, mtime: Date.now() };
}

/** Aplica operaciones (set / delete / rename) al árbol, restringidas a `root`. */
export function applyOps(owner, ops, { root = '/' } = {}) {
  const t = tree(owner);
  if (!Array.isArray(ops) || ops.length > 500) fail(400, 'Operaciones no válidas');
  for (const op of ops) {
    if (op.op === 'set') {
      const p = normalize(op.path);
      if (!within(p, root) || p === '/') fail(403, 'Fuera de la carpeta permitida');
      if (t[dirname(p)]?.type !== 'dir') fail(400, `No existe la carpeta ${dirname(p)}`);
      const prev = t[p];
      const node = cleanNode(owner, op.node);
      if (!node.blob) assertSpace(owner, nodeSize(node) - (prev && !prev.blob ? nodeSize(prev) : 0));
      if (prev?.blob && prev.blob !== node.blob && blobs[prev.blob]?.owner === owner) removeBlob(prev.blob);
      t[p] = node;
    } else if (op.op === 'delete') {
      const p = normalize(op.path);
      if (!within(p, root) || p === root) fail(403, 'Fuera de la carpeta permitida');
      for (const k of Object.keys(t)) {
        if (!within(k, p)) continue;
        if (t[k].blob && blobs[t[k].blob]?.owner === owner) removeBlob(t[k].blob);
        delete t[k];
      }
    } else if (op.op === 'rename') {
      const from = normalize(op.from), to = normalize(op.to);
      if (!within(from, root) || !within(to, root) || from === root) fail(403, 'Fuera de la carpeta permitida');
      if (t[to]) fail(409, 'Ya existe un elemento con ese nombre');
      if (within(to, from)) fail(400, 'No se puede mover una carpeta dentro de sí misma');
      for (const k of Object.keys(t)) if (within(k, from)) { t[to + k.slice(from.length)] = t[k]; delete t[k]; }
    } else fail(400, 'Operación desconocida');
  }
  saveTree(owner);
}

export function resetTree(user = USER) {
  for (const n of Object.values(tree(user))) if (n.blob && blobs[n.blob]?.owner === user) removeBlob(n.blob);
  trees.set(user, seedTree());
  saveTree(user);
}

// ---------- Archivos grandes (blobs) ----------
/** Prepara la subida de un archivo del ordenador a una carpeta. */
export function prepareUpload(owner, p, size) {
  p = normalize(p);
  const t = tree(owner);
  if (p === '/' || t[dirname(p)]?.type !== 'dir') fail(400, `No existe la carpeta ${dirname(p)}`);
  if (t[p]?.type === 'dir') fail(409, 'Ya hay una carpeta con ese nombre');
  if (!(size >= 0)) fail(411, 'Falta el tamaño del archivo');
  assertSpace(owner, size - (t[p] ? nodeSize(t[p]) : 0));
  return { path: p, id: newBlob(owner) };
}
export function finishUpload(owner, p, id, size, mime) {
  const t = tree(owner);
  if (t[dirname(p)]?.type !== 'dir') { removeBlob(id); fail(409, 'La carpeta ya no existe'); }
  const prev = t[p];
  if (prev?.blob && blobs[prev.blob]?.owner === owner) removeBlob(prev.blob);
  t[p] = { type: 'file', blob: id, size, mime: String(mime || '').slice(0, 100), progress: 1, mtime: Date.now() };
  saveTree(owner);
  return t[p];
}

export function newBlob(owner = USER) {
  const id = randomUUID();
  blobs[id] = { owner };
  saveJson(BLOBS_FILE, blobs);
  return id;
}
export const blobPath = (id) => path.join(DISK, id);
export function removeBlob(id) {
  delete blobs[id];
  saveJson(BLOBS_FILE, blobs);
  unlink(blobPath(id)).catch(() => {});
}
export function canReadBlob(user, id) {
  return !!blobs[id] && blobs[id].owner === user;
}
