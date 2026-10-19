// Compartir P2P: un archivo o una carpeta se comparte con un código. Quien tenga el código se
// conecta directamente a este ordenador (HyperDHT: red P2P cifrada, sin servidor central, que
// atraviesa routers). Solo funciona mientras el ordenador que comparte está encendido.
//  - Cada compartido tiene su par de claves (derivado del código) y su pequeño servidor HTTP
//    local (la «puerta»), limitado a lo compartido: listar, descargar, subir cambios y abrir
//    los documentos en la oficina de este ordenador, para editarlos a la vez.
//  - Quien se une abre un túnel: un puerto local cuyas conexiones viajan cifradas hasta la puerta.
import DHT from 'hyperdht';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, createReadStream, mkdirSync } from 'node:fs';

let cfg = null; // { dataDir, store, user, office (módulo server/office.mjs), officeUrl, send, importFile }
let dht = null;
let state = { shares: [], joined: [] };
const hosts = new Map(); // id de compartido -> { server (dht), gate (http), port }
const tunnels = new Map(); // código -> { server (net), port }

const file = () => path.join(cfg.dataDir, 'p2p.json');
const save = () => writeFileSync(file(), JSON.stringify(state, null, 2));
const ALPHA = 'abcdefghijkmnopqrstuvwxyz23456789'; // sin letras que se confunden (l, 1, 0)
/** Código legible: «wos-» + 32 bytes en base 32 propia. Es la llave: quien lo tiene, entra. */
const encode = (buf) => { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += ALPHA[(val << (5 - bits)) & 31]; return out; };
const decode = (s) => { const out = []; let bits = 0, val = 0; for (const c of s) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error('Código no válido'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
export const codeOf = (seed) => `wos-${encode(Buffer.from(seed, 'hex'))}`;
function seedOf(code) {
  const m = String(code).trim().toLowerCase().replace(/\s+/g, '').match(/^wos-([a-z2-9]+)$/);
  const seed = m && decode(m[1]).subarray(0, 32);
  if (!seed || seed.length !== 32) throw new Error('Ese código no es de WonderfulOS');
  return seed;
}
const keyPairOf = (seed) => DHT.keyPair(seed);

export async function init(c) {
  cfg = c;
  try { state = { shares: [], joined: [], ...JSON.parse(readFileSync(file(), 'utf8')) }; } catch { /* primera vez */ }
  dht = new DHT();
  await dht.ready().catch(() => {});
  for (const s of state.shares) host(s).catch((e) => console.error('P2P', s.name, e.message));
}
export async function stop() {
  for (const h of hosts.values()) { await h.server.close().catch(() => {}); h.gate.close(); }
  for (const t of tunnels.values()) t.server.close();
  await dht?.destroy().catch(() => {});
}

// ---------- Compartir (este ordenador) ----------
const tree = () => cfg.store.tree(cfg.user);
const norm = (p) => cfg.store.normalize(String(p || '/'));
export function share({ path: p, perm = 'edit' }) {
  p = norm(p);
  const node = tree()[p];
  if (!node) throw new Error('No existe ese archivo');
  const existing = state.shares.find((s) => s.path === p);
  if (existing) return { ...existing, code: codeOf(existing.seed) };
  const s = { id: crypto.randomUUID(), seed: crypto.randomBytes(32).toString('hex'), path: p, kind: node.type === 'dir' ? 'dir' : 'file', perm: perm === 'read' ? 'read' : 'edit', name: p.split('/').pop() || 'Inicio', created: Date.now() };
  state.shares.push(s);
  save();
  host(s);
  return { ...s, code: codeOf(s.seed) };
}
export async function unshare(id) {
  const h = hosts.get(id);
  if (h) { await h.server.close().catch(() => {}); h.gate.close(); hosts.delete(id); }
  state.shares = state.shares.filter((s) => s.id !== id);
  save();
}
export const myShares = () => state.shares.map((s) => ({ id: s.id, path: s.path, name: s.name, kind: s.kind, perm: s.perm, code: codeOf(s.seed), online: hosts.has(s.id) }));

async function host(s) {
  const gate = http.createServer((req, res) => handle(s, req, res).catch((e) => {
    if (!res.headersSent) res.writeHead(e.status || 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }));
  // WebSocket de la oficina (edición a la vez): se pasa tal cual a Collabora.
  gate.on('upgrade', (req, sock, head) => {
    if (!officePath(req.url)) return sock.destroy();
    const up = net.connect(new URL(cfg.officeUrl()).port, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  const port = await new Promise((ok) => gate.listen(0, '127.0.0.1', () => ok(gate.address().port)));
  const server = dht.createServer((conn) => {
    const local = net.connect(port, '127.0.0.1');
    conn.pipe(local).pipe(conn);
    conn.on('error', () => local.destroy()); local.on('error', () => conn.destroy());
  });
  await server.listen(keyPairOf(Buffer.from(s.seed, 'hex')));
  hosts.set(s.id, { server, gate, port });
  // Solo para pruebas en un mismo equipo (dos copias de WonderfulOS): apunta qué puerta tiene cada código.
  if (process.env.NUBEOS_P2P_TEST) { const f = process.env.NUBEOS_P2P_TEST; let m = {}; try { m = JSON.parse(readFileSync(f, 'utf8')); } catch { /* nuevo */ } m[codeOf(s.seed)] = port; writeFileSync(f, JSON.stringify(m)); }
}

const officePath = (u) => /^\/(browser|cool|hosting|lool|loleaflet)\//.test(String(u));
function within(s, rel) {
  rel = norm(rel);
  const p = s.kind === 'file' ? s.path : norm(`${s.path}/${rel}`);
  if (s.kind === 'dir' && p !== s.path && !p.startsWith(`${s.path === '/' ? '' : s.path}/`)) throw Object.assign(new Error('Fuera de lo compartido'), { status: 403 });
  return p;
}
const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max) => new Promise((ok, ko) => { const parts = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { ko(new Error('Demasiado grande')); req.destroy(); } else parts.push(c); }); req.on('end', () => ok(Buffer.concat(parts))); req.on('error', ko); });

async function handle(s, req, res) {
  const url = new URL(req.url, 'http://p2p');
  // Oficina: las páginas y archivos de Collabora pasan al Collabora de este ordenador.
  if (officePath(url.pathname)) {
    const target = new URL(cfg.officeUrl());
    const fwd = http.request({ host: '127.0.0.1', port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      const headers = { ...r.headers };
      delete headers['content-security-policy']; delete headers['x-frame-options'];
      res.writeHead(r.statusCode, headers); r.pipe(res);
    });
    fwd.on('error', () => { res.writeHead(502); res.end(); });
    return req.pipe(fwd);
  }
  const rel = url.searchParams.get('rel') || '/';
  if (url.pathname === '/p2p/info') return json(res, { name: s.name, kind: s.kind, perm: s.perm, owner: cfg.user });
  if (url.pathname === '/p2p/list') {
    const dir = within(s, rel);
    const t = tree();
    if (s.kind === 'file') { const n = t[s.path]; return json(res, { entries: n ? [{ name: s.name, rel: '/', type: 'file', size: n.size ?? Buffer.byteLength(n.content || ''), mtime: n.mtime }] : [] }); }
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const entries = Object.entries(t).filter(([k]) => k.startsWith(prefix) && k !== dir && !k.slice(prefix.length).includes('/'))
      .map(([k, n]) => ({ name: k.slice(prefix.length), rel: k.slice(s.path === '/' ? 0 : s.path.length) || '/', type: n.type, size: n.type === 'file' ? (n.size ?? Buffer.byteLength(n.content || '')) : 0, mtime: n.mtime }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return json(res, { entries });
  }
  if (url.pathname === '/p2p/file' && req.method === 'GET') {
    const p = within(s, rel);
    const n = tree()[p];
    if (!n || n.type !== 'file') throw Object.assign(new Error('No existe'), { status: 404 });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.split('/').pop())}` });
    return n.blob ? createReadStream(cfg.store.blobPath(n.blob)).pipe(res) : res.end(n.content || '');
  }
  if (url.pathname === '/p2p/office' && req.method === 'POST') {
    const p = within(s, rel);
    const guest = String(url.searchParams.get('as') || 'Invitado').replace(/[^\p{L}\p{N} ._@-]/gu, '').slice(0, 40) || 'Invitado';
    const origin = /^http:\/\/127\.0\.0\.1:\d+$/.test(url.searchParams.get('origin') || '') ? url.searchParams.get('origin') : undefined;
    await cfg.ensureOffice(); // la oficina de este ordenador, encendida
    const r = await cfg.office.open(cfg.user, { path: p }, cfg.publicOrigin(), { guest, write: s.perm === 'edit', origin });
    const u = new URL(r.url);
    return json(res, { path: u.pathname + u.search, token: r.token, ttl: r.ttl });
  }
  throw Object.assign(new Error('No encontrado'), { status: 404 });
}

// ---------- Unirse (otro ordenador) ----------
async function tunnel(code) {
  if (tunnels.has(code)) return tunnels.get(code).port;
  const pub = keyPairOf(seedOf(code)).publicKey;
  const server = net.createServer((sock) => {
    if (process.env.NUBEOS_P2P_TEST) { // pruebas: directo a la puerta de la otra copia, sin DHT
      const port = JSON.parse(readFileSync(process.env.NUBEOS_P2P_TEST, 'utf8'))[code];
      const local = net.connect(port, '127.0.0.1'); sock.pipe(local).pipe(sock); local.on('error', () => sock.destroy()); return;
    }
    const conn = dht.connect(pub);
    sock.pipe(conn).pipe(sock);
    conn.on('error', () => sock.destroy()); sock.on('error', () => conn.destroy());
  });
  const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
  tunnels.set(code, { server, port });
  return port;
}
async function call(code, p, { method = 'GET', timeout = 20000, raw = false } = {}) {
  const port = await tunnel(code);
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, signal: AbortSignal.timeout(timeout) }).catch(() => null);
  if (!r) throw Object.assign(new Error('No se pudo conectar con el ordenador que lo comparte. Puede que esté apagado o que su cortafuegos no deje entrar a WonderfulOS.'), { offline: true });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
  return raw ? r : r.json();
}
export async function join(code) {
  code = String(code).trim().toLowerCase().replace(/\s+/g, '');
  seedOf(code);
  if (state.shares.some((s) => codeOf(s.seed) === code)) throw new Error('Ese compartido es tuyo: lo tienes en tus archivos.');
  const info = await call(code, '/p2p/info').catch((e) => (e.offline ? null : Promise.reject(e)));
  if (!state.joined.find((j) => j.code === code)) state.joined.push({ code, name: info?.name || 'Compartido', owner: info?.owner || '', kind: info?.kind || 'dir', perm: info?.perm || 'read', added: Date.now() });
  save();
  return { online: !!info };
}
export function leave(code) { state.joined = state.joined.filter((j) => j.code !== code); save(); const t = tunnels.get(code); if (t) { t.server.close(); tunnels.delete(code); } }
/** Lo compartido conmigo, con si está conectado ahora (se prueba en paralelo). */
export async function joined() {
  return Promise.all(state.joined.map(async (j) => {
    const info = await call(j.code, '/p2p/info', { timeout: 12000 }).catch(() => null);
    if (info) Object.assign(j, { name: info.name, owner: info.owner, kind: info.kind, perm: info.perm });
    return { ...j, online: !!info };
  })).finally(save);
}
export const browse = (code, rel) => call(code, `/p2p/list?rel=${encodeURIComponent(rel || '/')}`);
/** Descarga a Archivos › Descargas. */
export async function download(code, rel, name) {
  const r = await call(code, `/p2p/file?rel=${encodeURIComponent(rel)}`, { raw: true, timeout: 600000 });
  const tmpDir = path.join(cfg.dataDir, 'p2p-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${Date.now()}-${String(name).replace(/[/\\]/g, '-')}`);
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  return cfg.importFile(tmp, `/Descargas/${String(name).replace(/[/\\]/g, '-')}`);
}
/** Abre un documento compartido en la oficina del ordenador que lo comparte (editar a la vez). */
export async function office(code, rel, guest, origin) {
  const port = await tunnel(code);
  const r = await call(code, `/p2p/office?rel=${encodeURIComponent(rel)}&as=${encodeURIComponent(guest || '')}&origin=${encodeURIComponent(origin || '')}`, { method: 'POST', timeout: 600000 });
  return { url: `http://127.0.0.1:${port}${r.path}`, token: r.token, ttl: r.ttl };
}
export const tunnelPorts = () => [...tunnels.values()].map((t) => t.port);
