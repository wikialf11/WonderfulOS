// Servidor de equipo: un ordenador (el que más tiempo está encendido) guarda los datos del equipo
// y los demás WonderfulOS se conectan a él con un código, por la red P2P (HyperDHT, cifrada, sin
// servidores de terceros). Así los archivos, las listas, las notas, el calendario, los mensajes y
// los documentos de oficina se comparten y se sincronizan al momento, y nada desaparece cuando un
// miembro se desconecta: todo queda guardado en el servidor del equipo.
//  - Servidor: su propio escritorio de WonderfulOS (cuentas, datos y oficina) se abre al equipo
//    a través de una «puerta» que solo deja pasar el escritorio y la oficina.
//  - Miembro: su ventana de WonderfulOS muestra el escritorio del equipo (con su propia cuenta).
import DHT from 'hyperdht';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

let cfg = null; // { dataDir, webPort, officeUrl }
let dht = null;
let state = { host: null, joined: null }; // host: { seed, name } · joined: { code, name }
let hosting = null; // { server, gate }
let tunnel = null; // { server, port, code }

const file = () => path.join(cfg.dataDir, 'equipo.json');
const save = () => writeFileSync(file(), JSON.stringify(state, null, 2));
const ALPHA = 'abcdefghijkmnopqrstuvwxyz23456789';
const encode = (buf) => { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += ALPHA[(val << (5 - bits)) & 31]; return out; };
const decode = (s) => { const out = []; let bits = 0, val = 0; for (const c of s) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error('Código no válido'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
/** Código del equipo: «equipo-» + 32 bytes. Es la llave para llegar al servidor (luego cada uno entra con su cuenta). */
const codeOf = (seed) => `equipo-${encode(Buffer.from(seed, 'hex'))}`;
function seedOf(code) {
  const m = String(code).trim().toLowerCase().replace(/\s+/g, '').match(/^equipo-([a-z2-9]+)$/);
  const seed = m && decode(m[1]).subarray(0, 32);
  if (!seed || seed.length !== 32) throw new Error('Ese no es un código de equipo de WonderfulOS (empieza por «equipo-»)');
  return seed;
}

export async function init(c) {
  cfg = c;
  try { state = { ...state, ...JSON.parse(readFileSync(file(), 'utf8')) }; } catch { /* primera vez */ }
  dht = new DHT();
  await dht.ready().catch(() => {});
  if (state.host) await startHost().catch((e) => console.error('Equipo:', e.message));
}
export async function stop() {
  if (hosting) { await hosting.server.close().catch(() => {}); hosting.gate.close(); }
  tunnel?.server.close();
  await dht?.destroy().catch(() => {});
}
export const status = () => ({
  host: state.host ? { name: state.host.name, code: codeOf(state.host.seed), online: !!hosting } : null,
  joined: state.joined ? { name: state.joined.name, code: state.joined.code } : null,
});

// ---------- Ser el servidor del equipo ----------
const officePath = (u) => /^\/(browser|cool|hosting|lool|loleaflet)\//.test(String(u));
function forward(port, req, res, extra = {}) {
  const fwd = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, ...extra } }, (r) => {
    const headers = { ...r.headers };
    if (officePath(req.url)) { delete headers['content-security-policy']; delete headers['x-frame-options']; }
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });
  fwd.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(fwd);
}
async function startHost() {
  const gate = http.createServer((req, res) => {
    // La oficina va al Collabora de este ordenador; todo lo demás, al escritorio de WonderfulOS.
    if (officePath(req.url)) return forward(new URL(cfg.officeUrl()).port, req, res);
    // Por la puerta del equipo nunca se entra con la sesión del dueño: cada miembro usa su cuenta.
    forward(cfg.webPort(), req, res, { 'x-wos-equipo': '1' });
  });
  gate.on('upgrade', (req, sock, head) => {
    const port = officePath(req.url) ? new URL(cfg.officeUrl()).port : cfg.webPort();
    const up = net.connect(port, '127.0.0.1', () => {
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
  await server.listen(DHT.keyPair(Buffer.from(state.host.seed, 'hex')));
  hosting = { server, gate };
  if (process.env.NUBEOS_P2P_TEST) writeFileSync(`${process.env.NUBEOS_P2P_TEST}.equipo`, JSON.stringify({ [codeOf(state.host.seed)]: port }));
}
export async function createTeam(name) {
  if (!state.host) state.host = { seed: crypto.randomBytes(32).toString('hex'), name: String(name || 'Mi equipo').slice(0, 60) };
  save();
  if (!hosting) await startHost();
  return status();
}
export async function stopTeam() {
  if (hosting) { await hosting.server.close().catch(() => {}); hosting.gate.close(); hosting = null; }
  state.host = null;
  save();
  return status();
}

// ---------- Unirse a un equipo ----------
/** Abre (o reutiliza) el túnel hasta el servidor del equipo y devuelve su dirección local. */
export async function teamUrl() {
  if (!state.joined) return null;
  if (tunnel?.code === state.joined.code) return `http://127.0.0.1:${tunnel.port}/`;
  tunnel?.server.close();
  const code = state.joined.code;
  const pub = DHT.keyPair(seedOf(code)).publicKey;
  const server = net.createServer((sock) => {
    if (process.env.NUBEOS_P2P_TEST) { // pruebas en un mismo equipo: directo a la puerta, sin DHT
      const p = JSON.parse(readFileSync(`${process.env.NUBEOS_P2P_TEST}.equipo`, 'utf8'))[code];
      const l = net.connect(p, '127.0.0.1'); sock.pipe(l).pipe(sock); l.on('error', () => sock.destroy()); return;
    }
    const conn = dht.connect(pub);
    sock.pipe(conn).pipe(sock);
    conn.on('error', () => sock.destroy()); sock.on('error', () => conn.destroy());
  });
  // Siempre el mismo puerto para este equipo: así la sesión (cookie) del miembro se conserva entre reinicios.
  const listen = (p) => new Promise((ok, ko) => { server.once('error', ko); server.listen(p, '127.0.0.1', () => ok(server.address().port)); });
  const port = await listen(state.joined.port || 0).catch(() => listen(0));
  if (state.joined.port !== port) { state.joined.port = port; save(); }
  tunnel = { server, port, code };
  return `http://127.0.0.1:${port}/`;
}
/** Comprueba que el servidor responde (hasta `ms`). */
export async function reachable(ms = 20000) {
  const url = await teamUrl();
  if (!url) return false;
  return fetch(`${url}nubeos-config.json`, { signal: AbortSignal.timeout(ms) }).then((r) => r.ok, () => false);
}
export async function joinTeam(code) {
  code = String(code).trim().toLowerCase().replace(/\s+/g, '');
  seedOf(code);
  if (state.host && codeOf(state.host.seed) === code) throw new Error('Ese es tu propio equipo: este ordenador ya es su servidor.');
  state.joined = { code, name: 'Equipo' };
  save();
  if (!(await reachable())) throw Object.assign(new Error('No se pudo conectar con el servidor del equipo. Comprueba que está encendido y que su cortafuegos deja entrar a WonderfulOS.'), { offline: true });
  return status();
}
export function leaveTeam() {
  state.joined = null;
  save();
  tunnel?.server.close();
  tunnel = null;
  return status();
}
