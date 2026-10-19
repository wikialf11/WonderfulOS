// Navegador de WonderfulOS: un Chromium de verdad para cada usuario, en un contenedor de
// neko (código abierto, https://github.com/m1k1o/neko) que se ve en la ventana por
// WebRTC. Así funcionan Google, YouTube, iniciar sesión, pestañas… todo.
//
//  - Se arranca al abrir el Navegador y se para tras un rato sin usarlo.
//  - El perfil (sesiones, historial) se guarda por usuario y sobrevive entre usos.
//  - Lo que se descarga cae en una carpeta del usuario y WonderfulOS lo pasa a
//    Archivos › Descargas (si cabe en su plan).
//
// Necesita Docker en el servidor. Variables:
//   NUBEOS_BROWSER=docker            activa el navegador real (si falta, se usa el ligero por proxy)
//   NUBEOS_BROWSER_IMAGE             imagen (por defecto ghcr.io/m1k1o/neko/chromium:latest)
//   NUBEOS_BROWSER_PUBLIC_HOST       nombre o IP con el que el navegador del usuario llega a los puertos
//   NUBEOS_BROWSER_BASE_PORT         primer puerto (por defecto 5200; cada usuario usa 2 seguidos)
//   NUBEOS_MAX_BROWSERS              cuántos a la vez (por defecto 4)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readdirSync, statSync, renameSync, unlinkSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import * as store from './store.mjs';
import { notifyUser } from './appdata.mjs';
import { machineMode, agentCall, PUBLIC_ORIGIN } from './provision.mjs';

const run = promisify(execFile);
const { HttpError } = store;
const fail = (status, message) => { throw new HttpError(status, message); };

export const browserEnabled = () => process.env.NUBEOS_BROWSER === 'docker';
const IMAGE = process.env.NUBEOS_BROWSER_IMAGE || 'nubeos-navegador'; // ver navegador/Dockerfile
const BASE_PORT = Number(process.env.NUBEOS_BROWSER_BASE_PORT || 5200);
const MAX = Number(process.env.NUBEOS_MAX_BROWSERS || 4);
const IDLE_MS = 15 * 60e3;
const ROOT = path.join(store.DATA, 'navegador');

const sessions = new Map(); // usuario -> { name, port, password, admin, token, page, queue, waiters, last, starting }
const byToken = new Map(); // ficha de la extensión -> usuario
const EXT = fileURLToPath(new URL('../agent/navegador/extension', import.meta.url));
// Dirección con la que el Chromium del contenedor llega a este servidor.
const SERVER_FOR_EXT = process.env.NUBEOS_BROWSER_SERVER_URL || `http://host.docker.internal:${process.env.PORT || 4310}`;
const safe = (u) => u.replace(/[^a-z0-9_.-]/g, '_');

// Políticas de Chromium: las de neko, con descargas permitidas y el color de WonderfulOS.
function policies(accent) {
  const rgb = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#5b6cff';
  return {
    AutofillAddressEnabled: false, AutofillCreditCardEnabled: false, BrowserSignin: 1, DefaultNotificationsSetting: 2,
    DeveloperToolsAvailability: 2, FullscreenAllowed: true, SyncDisabled: true, AutoplayAllowed: true,
    BrowserAddPersonEnabled: false, BrowserGuestModeEnabled: false, AllowFileSelectionDialogs: true, // «Guardar imagen como…», guardar PDFs…
    DownloadRestrictions: 0, DownloadDirectory: '/home/neko/Downloads', PromptForDownloadLocation: false,
    BookmarkBarEnabled: false, PasswordManagerEnabled: true, BrowserLabsEnabled: false, CommandLineFlagSecurityWarningsEnabled: false,
    BrowserThemeColor: rgb, DefaultSearchProviderEnabled: true, DefaultSearchProviderName: 'Google',
    DefaultSearchProviderSearchURL: 'https://www.google.com/search?q={searchTerms}', HomepageLocation: 'https://www.google.com',
    RestoreOnStartup: 5, ApplicationLocaleValue: 'es',
    URLBlocklist: ['file://*', 'chrome://policy', 'chrome://settings/reset'],
    ExtensionInstallForcelist: ['ddkjiahejlhfcafbddmgiahcphecmpfh;https://clients2.google.com/service/update2/crx'], // uBlock Origin Lite
    // La extensión de WonderfulOS (Llavero) se carga con --load-extension.
  };
}
// Arranque de Chromium: como el de neko, pero con perfil propio (sin --bwsi) y el tema del usuario.
const chromiumConf = (dark) => `[program:chromium]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s",LANGUAGE="es",LANG="es_ES.UTF-8"
command=/usr/bin/chromium --no-sandbox --window-position=0,0 --display=%(ENV_DISPLAY)s --user-data-dir=/home/neko/.config/chromium --no-first-run --start-maximized --hide-crash-restore-bubble --disable-session-crashed-bubble ${dark ? '--force-dark-mode --enable-features=WebContentsForceDark' : ''} --load-extension=/home/neko/nubeos-ext --disable-features=DisableLoadExtensionCommandLineSwitch --disable-file-system --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage --lang=es
stopsignal=INT
autorestart=true
priority=800
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/chromium.log
redirect_stderr=true

[program:openbox]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/openbox --config-file /etc/neko/openbox.xml
autorestart=true
priority=300
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/openbox.log
redirect_stderr=true
`;

async function running(name) {
  try { const { stdout } = await run('docker', ['inspect', '-f', '{{.State.Running}}', name]); return stdout.trim() === 'true'; } catch { return false; }
}
function freePort() {
  const used = new Set([...sessions.values()].map((s) => s.port));
  for (let p = BASE_PORT; p < BASE_PORT + MAX * 2; p += 2) if (!used.has(p)) return p;
  fail(503, 'Ahora mismo hay muchos navegadores abiertos. Inténtalo en unos minutos.');
}

/** ¿Este usuario tiene navegador completo? (en su ordenador, o en este servidor en pruebas) */
export const available = (user) => machineMode(user) === 'remoto' || browserEnabled();

/** Arranca (o reutiliza) el Chromium del usuario y devuelve cómo conectarse. */
export async function start(user, opts = {}) {
  const mode = machineMode(user);
  if (mode === 'remoto') {
    // En su propio ordenador: el agente lo arranca; aquí solo guardamos la ficha de la extensión.
    let s = sessions.get(user);
    if (!s?.remote) {
      if (s) byToken.delete(s.token);
      s = { remote: true, token: randomBytes(24).toString('base64url'), page: null, queue: [], waiters: [], last: Date.now() };
      sessions.set(user, s);
      byToken.set(s.token, user);
    }
    s.last = Date.now();
    return agentCall(user, '/browser/start', { width: opts.width, height: opts.height, dark: opts.dark, accent: opts.accent, extToken: s.token, extServer: PUBLIC_ORIGIN });
  }
  if (!browserEnabled()) fail(503, 'El navegador completo no está activado en este servidor');
  return startLocal(user, opts);
}

async function startLocal(user, { width = 1600, height = 900, dark = false, accent = '#5b6cff', host } = {}) {
  let s = sessions.get(user);
  if (s && (await running(s.name))) { s.last = Date.now(); resize(user, width, height).catch(() => {}); return connection(s, host); }
  if (s?.starting) { await s.starting; return connection(sessions.get(user), host); }
  const dir = path.join(ROOT, safe(user));
  for (const d of ['Downloads', 'conf']) mkdirSync(path.join(dir, d), { recursive: true });
  // Extensión de WonderfulOS con su ficha propia para hablar con este servidor.
  const token = randomBytes(24).toString('base64url');
  cpSync(EXT, path.join(dir, 'ext'), { recursive: true });
  writeFileSync(path.join(dir, 'ext', 'config.json'), JSON.stringify({ server: SERVER_FOR_EXT, token }));
  writeFileSync(path.join(dir, 'conf', 'policies.json'), JSON.stringify(policies(accent)));
  writeFileSync(path.join(dir, 'conf', 'chromium.conf'), chromiumConf(dark));
  const w = Math.min(2560, Math.max(800, Math.round(width / 8) * 8)), h = Math.min(1600, Math.max(600, Math.round(height / 8) * 8));
  s = { name: `nubeos-nav-${safe(user)}`, port: freePort(), password: randomBytes(18).toString('base64url'), admin: randomBytes(18).toString('base64url'),
    token, page: null, queue: [], waiters: [], last: Date.now() };
  sessions.set(user, s);
  byToken.set(token, user);
  s.starting = (async () => {
    await run('docker', ['rm', '-f', s.name]).catch(() => {});
    await run('docker', ['run', '-d', '--name', s.name, '--shm-size=1g', '--memory=1500m',
      '-p', `${s.port}:8080`, '-p', `${s.port + 1}:${s.port + 1}/tcp`, '-p', `${s.port + 1}:${s.port + 1}/udp`,
      '-e', `NEKO_DESKTOP_SCREEN=${w}x${h}@30`,
      '-e', 'NEKO_MEMBER_PROVIDER=multiuser',
      '-e', `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${s.password}`,
      '-e', `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${s.admin}`,
      '-e', 'NEKO_SESSION_IMPLICIT_HOSTING=true',
      '-e', 'NEKO_SESSION_MERCIFUL_RECONNECT=true',
      '-e', `NEKO_WEBRTC_TCPMUX=${s.port + 1}`, '-e', `NEKO_WEBRTC_UDPMUX=${s.port + 1}`,
      '-e', `NEKO_WEBRTC_NAT1TO1=${process.env.NUBEOS_BROWSER_NAT_IP || '127.0.0.1'}`,
      '-e', 'NEKO_WEBRTC_ICELITE=true',
      // El perfil va en un volumen de Docker (no en una carpeta compartida con el sistema):
      // Chromium escribe mucho en él y así es más rápido y estable.
      '-v', `${s.name}-perfil:/home/neko/.config/chromium`, '--hostname', 'nubeos-navegador',
      '-v', `${path.join(dir, 'Downloads')}:/home/neko/Downloads`,
      '-v', `${path.join(dir, 'conf', 'policies.json')}:/etc/chromium/policies/managed/policies.json:ro`,
      '-v', `${path.join(dir, 'conf', 'chromium.conf')}:/etc/neko/supervisord/chromium.conf:ro`,
      '-v', `${path.join(dir, 'ext')}:/home/neko/nubeos-ext:ro`,
      '--add-host=host.docker.internal:host-gateway',
      IMAGE], { timeout: 120000 });
    // neko tarda unos segundos en estar listo.
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${s.port}/health`); if (r.ok) break; } catch { /* aún no */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  try { await s.starting; } catch (e) { sessions.delete(user); console.error('[navegador]', e.message); fail(500, 'No se pudo arrancar el navegador'); }
  s.starting = null;
  return connection(s, host);
}
function connection(s, host) {
  const h = process.env.NUBEOS_BROWSER_PUBLIC_HOST || host || '127.0.0.1';
  const url = `http://${h}:${s.port}/?${new URLSearchParams({ usr: 'nubeos', pwd: s.password, embed: '1', lang: 'es', volume: '1' })}`;
  return { url, origin: `http://${h}:${s.port}` };
}

export function keepalive(user) { const s = sessions.get(user); if (s) s.last = Date.now(); }

// ---------- Tamaño de la pantalla: sigue al de la ventana de WonderfulOS ----------
async function nekoAdmin(s) {
  if (s.adminToken) return s.adminToken;
  const r = await fetch(`http://127.0.0.1:${s.port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: s.admin }) });
  if (!r.ok) throw new Error('neko no acepta el acceso');
  return (s.adminToken = (await r.json()).token);
}
export async function resize(user, width, height) {
  const s = sessions.get(user);
  if (s?.remote) return agentCall(user, '/browser/resize', { width, height });
  if (!s || s.starting) return;
  const w = Math.min(2560, Math.max(640, Math.round(width / 8) * 8)), h = Math.min(1600, Math.max(400, Math.round(height / 8) * 8));
  const r = await fetch(`http://127.0.0.1:${s.port}/api/room/screen`, {
    method: 'POST', headers: { authorization: `Bearer ${await nekoAdmin(s)}`, 'content-type': 'application/json' }, body: JSON.stringify({ width: w, height: h, rate: 30 }),
  });
  if (r.status === 401) { s.adminToken = null; }
}

// ---------- Extensión de WonderfulOS dentro de Chromium (Llavero) ----------
const sessionOf = (token) => { const user = byToken.get(String(token || '')); const s = user && sessions.get(user); return s ? { user, s } : null; };
/** La extensión espera órdenes (hasta 25 s). */
export function extPoll(token, res) {
  const found = sessionOf(token);
  if (!found) fail(401, 'Ficha no válida');
  const { s } = found;
  if (process.env.NUBEOS_DEBUG) console.log('[navegador] poll', s.queue.length);
  const reply = (cmds) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(cmds)); };
  if (s.queue.length) return reply(s.queue.splice(0));
  const waiter = { reply, timer: setTimeout(() => { s.waiters = s.waiters.filter((x) => x !== waiter); reply([]); }, 25000) };
  s.waiters.push(waiter);
}
const recent = new Map();
/** Lo que cuenta la extensión: la web abierta y los inicios de sesión. */
export function extEvent(token, ev) {
  const found = sessionOf(token);
  if (!found) fail(401, 'Ficha no válida');
  const { user, s } = found;
  if (ev.type === 'url' && /^https?:/.test(String(ev.url))) s.page = { url: String(ev.url).slice(0, 2000), title: String(ev.title || '').slice(0, 200) };
  if (ev.type === 'login' && ev.pass) {
    const key = `${user}|${ev.url}|${ev.user}|${ev.pass}`;
    if (Date.now() - (recent.get(key) || 0) < 15000) return; // el mismo envío llega por varios caminos
    recent.set(key, Date.now());
    notifyUser(user, { kind: 'login', url: String(ev.url || '').slice(0, 2000), user: String(ev.user || '').slice(0, 300), pass: String(ev.pass).slice(0, 300) });
  }
}
export function currentPage(user) { return sessions.get(user)?.page || null; }
/** Rellenar en la web abierta (lo pide el Llavero desde WonderfulOS). */
export function fill(user, login, pass) {
  const s = sessions.get(user);
  if (!s) fail(409, 'El navegador no está abierto');
  const cmd = { type: 'fill', user: String(login || ''), pass: String(pass || '') };
  const w = s.waiters.shift();
  if (w) { clearTimeout(w.timer); w.reply([cmd]); } else s.queue.push(cmd);
}

export async function stop(user) {
  const s = sessions.get(user);
  sessions.delete(user);
  if (s) byToken.delete(s.token);
  if (s?.remote) return agentCall(user, '/browser/stop', {}).catch(() => {});
  if (s) { await run('docker', ['stop', '-t', '5', s.name]).catch(() => {}); await run('docker', ['rm', '-f', s.name]).catch(() => {}); }
}

// ---------- Descargas → Archivos › Descargas ----------
function importDownloads() {
  for (const [user, sess] of sessions) {
    if (sess.remote) continue;
    const dir = path.join(ROOT, safe(user), 'Downloads');
    let files = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (/\.(crdownload|part|tmp)$/i.test(f) || f.startsWith('.')) continue;
      const full = path.join(dir, f);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isFile() || Date.now() - st.mtimeMs < 2000) continue; // aún escribiéndose
      try {
        let name = f, p = `/Descargas/${name}`;
        const t = store.tree(user);
        const [, stem, ext] = name.match(/^(.*?)(\.[^.]*)?$/);
        for (let i = 2; t[p]; i++) p = `/Descargas/${stem} (${i})${ext || ''}`;
        const { id } = store.prepareUpload(user, p, st.size);
        renameSync(full, store.blobPath(id));
        store.finishUpload(user, p, id, st.size, '');
        console.log(`[navegador] ${user}: ${p}`);
        notifyUser(user, { kind: 'download', path: p });
      } catch (e) {
        console.error('[navegador] descarga no guardada:', user, f, e.message);
        try { unlinkSync(full); } catch { /* */ }
        notifyUser(user, { kind: 'download-error', name: f, error: e.message });
      }
    }
  }
}

// Mantenimiento: importa descargas y apaga navegadores sin uso.
if (browserEnabled()) {
  setInterval(importDownloads, 3000).unref();
  setInterval(() => {
    for (const [user, s] of sessions) if (!s.starting && Date.now() - s.last > IDLE_MS) stop(user);
  }, 60e3).unref();
}
// Los navegadores en el ordenador de cada usuario también se apagan sin uso.
{
  setInterval(() => {
    for (const [user, s] of sessions) if (s.remote && Date.now() - s.last > IDLE_MS) stop(user);
  }, 60e3).unref();
  // Si el servidor se reinició, los contenedores huérfanos se paran.
  run('docker', ['ps', '-aq', '--filter', 'name=nubeos-nav-']).then(({ stdout }) => {
    const ids = stdout.split('\n').filter(Boolean);
    if (ids.length) run('docker', ['rm', '-f', ...ids]).catch(() => {});
  }).catch(() => {});
}
