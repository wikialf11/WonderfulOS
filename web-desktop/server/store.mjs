// Almacenamiento de WonderfulOS en el servidor: cuentas, sesiones, archivos de cada
// usuario, archivos grandes (blobs) y elementos compartidos.
// Todo vive en una carpeta de datos (NUBEOS_DATA, por defecto ~/.nubeos), que en
// producción es el volumen persistente de la nube.

import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, statSync, statfsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { PLANS, DEFAULT_PLAN, planOf } from './plans.mjs';

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

const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SHARES_FILE = path.join(DATA, 'shares.json');
const BLOBS_FILE = path.join(DATA, 'blobs.json');
const users = loadJson(USERS_FILE, {});       // nombre -> { salt, hash, created, plan?, stripeSubscription?, stripeCustomer? }
const sessions = loadJson(SESSIONS_FILE, {}); // token -> { user, created }
let shares = loadJson(SHARES_FILE, []);       // [{ id, owner, to, perm, kind, path?, app?, created }]
const blobs = loadJson(BLOBS_FILE, {});       // id -> { owner }

// ---------- Cuentas ----------
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,29}$/;
const SESSION_DAYS = 30;

const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');

export function register(username, password) {
  username = String(username || '').trim().toLowerCase();
  if (!USERNAME.test(username)) fail(400, 'El usuario debe tener de 3 a 30 letras minúsculas, números, punto, guion o guion bajo');
  if (String(password || '').length < 8) fail(400, 'La contraseña debe tener al menos 8 caracteres');
  if (users[username]) fail(409, 'Ese nombre de usuario ya existe');
  const salt = randomBytes(16).toString('hex');
  users[username] = { salt, hash: hashPassword(password, salt), created: Date.now() };
  saveJson(USERS_FILE, users);
  return createSession(username);
}

export function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  const u = users[username];
  // Mismo coste aunque el usuario no exista, para no revelar qué cuentas hay.
  const hash = Buffer.from(hashPassword(String(password || ''), u?.salt || 'x'), 'hex');
  if (!u || !timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) fail(401, 'Usuario o contraseña incorrectos');
  return createSession(username);
}

function createSession(user) {
  const token = randomBytes(32).toString('hex');
  sessions[token] = { user, created: Date.now() };
  saveJson(SESSIONS_FILE, sessions);
  return { token, user };
}

export function sessionUser(token) {
  const s = token && Object.hasOwn(sessions, token) ? sessions[token] : null;
  if (!s) return null;
  if (Date.now() - s.created > SESSION_DAYS * 864e5) { logout(token); return null; }
  return s.user;
}

export function logout(token) {
  if (Object.hasOwn(sessions, token)) { delete sessions[token]; saveJson(SESSIONS_FILE, sessions); }
}

export const userExists = (u) => Object.hasOwn(users, u);

export function searchUsers(q, exclude) {
  q = String(q || '').toLowerCase();
  return Object.keys(users).filter((u) => u !== exclude && u.startsWith(q)).sort().slice(0, 10);
}

// ---------- Plan y espacio ocupado ----------
const nodeSize = (n) => (n.type !== 'file' ? 0 : n.blob ? Number(n.size) || 0 : Buffer.byteLength(n.content || ''));
export function usage(user) {
  let used = 0;
  for (const n of Object.values(tree(user))) used += nodeSize(n);
  return used;
}
export function account(user) {
  const u = users[user] || {};
  // WonderfulOS instalado en el ordenador: el espacio es el del propio disco.
  if (process.env.NUBEOS_LOCAL === '1') {
    // Espacio real del disco: lo ocupado por todo (sistema, apps y archivos) y su tamaño total.
    let free = 0, total = 0;
    try { const s = statfsSync(DATA); free = s.bavail * s.bsize; total = s.blocks * s.bsize; } catch { /* sin datos */ }
    const mine = usage(user);
    return { user, plan: 'local', planName: 'Este ordenador', quota: total || mine + free, used: total ? total - free : mine, mine, subscribed: false, local: true };
  }
  const id = PLANS[u.plan] ? u.plan : DEFAULT_PLAN;
  return { user, plan: id, planName: planOf(id).name, quota: planOf(id).quota, used: usage(user), subscribed: !!u.stripeSubscription };
}
/** Lo llama el cobro cuando Stripe confirma o termina una suscripción. */
export function setPlan(user, plan, { stripeSubscription = null, stripeCustomer = null } = {}) {
  if (!users[user]) return false;
  Object.assign(users[user], { plan: PLANS[plan] ? plan : DEFAULT_PLAN, stripeSubscription, stripeCustomer: stripeCustomer || users[user].stripeCustomer || null });
  saveJson(USERS_FILE, users);
  return true;
}
export const userBySubscription = (sub) => Object.keys(users).find((u) => sub && users[u].stripeSubscription === sub) || null;
export const subscriptionOf = (user) => users[user]?.stripeSubscription || null;
const assertSpace = (owner, extra) => {
  if (extra <= 0) return;
  const { used, quota, planName } = account(owner);
  if (used + extra > quota) fail(507, `No queda espacio en el disco. Libera espacio para seguir guardando.`);
};

// ---------- Sistema de archivos por usuario ----------
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
      content: 'Bienvenido a tu WonderfulOS.\n\nTus archivos viven en la nube: los verás igual desde cualquier equipo con tu cuenta.\n\n· Crea documentos, hojas de cálculo y presentaciones desde el dock (funcionan con LibreOffice y abren archivos de Word, Excel y PowerPoint).\n· En Archivos puedes subir archivos de tu ordenador (o arrastrarlos a la ventana).\n· Selecciona un archivo o una carpeta y pulsa «Compartir» para trabajar con otra persona de WonderfulOS.\n',
    },
  };
}

export function tree(user) {
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

function cleanNode(user, node) {
  if (!node || !['file', 'dir'].includes(node.type)) fail(400, 'Nodo no válido');
  if (node.type === 'dir') return { type: 'dir', mtime: Date.now() };
  if (node.blob !== undefined) {
    if (blobs[node.blob]?.owner !== user) fail(403, 'Ese archivo no es tuyo');
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

/** Aplica operaciones (set / delete / rename) al árbol de `owner`, restringidas a `root`. */
export function applyOps(owner, ops, { actor = owner, root = '/' } = {}) {
  const t = tree(owner);
  if (!Array.isArray(ops) || ops.length > 500) fail(400, 'Operaciones no válidas');
  for (const op of ops) {
    if (op.op === 'set') {
      const p = normalize(op.path);
      if (!within(p, root) || p === '/') fail(403, 'Fuera de la carpeta permitida');
      if (t[dirname(p)]?.type !== 'dir') fail(400, `No existe la carpeta ${dirname(p)}`);
      const prev = t[p];
      const node = cleanNode(actor, op.node);
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
      for (const s of shares) if (s.owner === owner && s.path && within(s.path, from)) s.path = to + s.path.slice(from.length);
      saveJson(SHARES_FILE, shares);
    } else fail(400, 'Operación desconocida');
  }
  saveTree(owner);
}

export function resetTree(user) {
  for (const n of Object.values(tree(user))) if (n.blob && blobs[n.blob]?.owner === user) removeBlob(n.blob);
  trees.set(user, seedTree());
  saveTree(user);
  shares = shares.filter((s) => s.owner !== user || s.kind === 'app');
  saveJson(SHARES_FILE, shares);
}

// ---------- Archivos grandes (blobs) ----------
/** Prepara la subida de un archivo del ordenador del usuario a una de sus carpetas. */
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

export function newBlob(owner) {
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
  if (!blobs[id]) return false;
  if (blobs[id].owner === user) return true;
  return shares.some((s) => s.to === user && s.path && Object.entries(tree(s.owner)).some(([k, n]) => n.blob === id && within(k, s.path)));
}

// ---------- Compartir ----------
export function createShare(owner, { to, perm = 'read', path: p, app }) {
  to = String(to || '').trim().toLowerCase();
  if (!users[to]) fail(404, `No existe el usuario ${to}`);
  if (to === owner) fail(400, 'No puedes compartir contigo mismo');
  if (!['read', 'edit'].includes(perm)) fail(400, 'Permiso no válido');
  let share;
  if (app) {
    const url = new URL(String(app.url));
    if (!['http:', 'https:'].includes(url.protocol)) fail(400, 'App no válida');
    share = { kind: 'app', app: { name: String(app.name || url.hostname).slice(0, 40), url: url.href, icon: String(app.icon || '🌐').slice(0, 4), description: String(app.description || '').slice(0, 80) } };
  } else {
    p = normalize(p);
    const node = tree(owner)[p];
    if (!node || p === '/') fail(404, 'No existe ese archivo o carpeta');
    share = { kind: node.type, path: p, perm };
  }
  const dup = shares.find((s) => s.owner === owner && s.to === to && s.kind === share.kind && (s.path ?? s.app?.url) === (share.path ?? share.app?.url));
  if (dup) { Object.assign(dup, share); saveJson(SHARES_FILE, shares); return dup; }
  const full = { id: randomUUID(), owner, to, created: Date.now(), ...share };
  shares.push(full);
  saveJson(SHARES_FILE, shares);
  return full;
}

export function getShare(id) { return shares.find((s) => s.id === id) || null; }

export function deleteShare(user, id) {
  const s = getShare(id);
  if (!s || (s.owner !== user && s.to !== user)) fail(404, 'No encontrado');
  shares = shares.filter((x) => x.id !== id);
  saveJson(SHARES_FILE, shares);
}

export const outgoingShares = (user) => shares.filter((s) => s.owner === user);

/** Lo compartido con `user`, con una copia de los archivos (rutas relativas a la raíz compartida). */
export function incomingShares(user) {
  return shares.filter((s) => s.to === user).flatMap((s) => {
    if (s.kind === 'app') return [{ ...s }];
    const t = tree(s.owner);
    if (!t[s.path]) return []; // el original se borró
    const nodes = {};
    for (const [k, n] of Object.entries(t)) if (within(k, s.path)) nodes[k.slice(s.path.length) || '/'] = n;
    return [{ ...s, nodes }];
  });
}

/** Operaciones de un invitado con permiso de edición sobre lo compartido. */
export function applyShareOps(user, id, ops) {
  const s = getShare(id);
  if (!s || s.to !== user) fail(404, 'No encontrado');
  if (s.perm !== 'edit') fail(403, 'Solo tienes permiso de lectura');
  const mapped = ops.map((op) => {
    const abs = (rel) => normalize(s.path + (s.kind === 'file' ? '' : normalize(rel)));
    if (op.op === 'rename') return { ...op, from: abs(op.from), to: abs(op.to) };
    if (op.node?.blob !== undefined) fail(403, 'No se pueden guardar descargas en algo compartido');
    return { ...op, path: abs(op.path) };
  });
  // Un archivo compartido solo se puede modificar, no borrar ni renombrar.
  const root = s.kind === 'file' ? dirname(s.path) : s.path;
  if (s.kind === 'file' && mapped.some((op) => op.op !== 'set' || op.path !== s.path)) fail(403, 'Solo puedes editar el contenido de este archivo');
  applyOps(s.owner, mapped, { actor: user, root });
}
