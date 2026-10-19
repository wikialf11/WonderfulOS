// Agente de WonderfulOS: corre en el ordenador (VPS) de cada usuario de pago.
//
//  - LibreOffice (Collabora, contenedor «nubeos-office») lo sirve Caddy directamente.
//  - Navegador: arranca y para el Chromium del usuario (contenedor de neko) y sube a su
//    nube lo que descarga.
//  - Apps de Linux: instala apps de Flathub y las muestra en el navegador con Xpra.
//
// Seguridad: Caddy pone HTTPS delante. El servidor central de WonderfulOS firma cada orden
// con el secreto de este ordenador (Bearer). Xpra y las apps se abren con un enlace de
// un solo uso que deja una cookie de sesión.
//
// Configuración: /opt/nubeos/config.json → { secret, user, plan, origin, host, ip }

import http from 'node:http';
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, createReadStream, unlinkSync, cpSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const DIR = process.env.NUBEOS_AGENT_DIR || '/opt/nubeos';
const CONFIG = JSON.parse(readFileSync(`${DIR}/config.json`, 'utf8'));
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const XPRA_PORT = 14500;
const NEKO_PORT = 8080;          // Caddy lo publica en https://<host>:8443
const NEKO_RTC = 52000;          // WebRTC (TCP y UDP), abierto en el cortafuegos
const DOWNLOADS = `${DIR}/navegador/Downloads`;
mkdirSync(DOWNLOADS, { recursive: true });

// ---------- Autenticación ----------
const sign = (payload) => createHmac('sha256', CONFIG.secret).update(payload).digest('base64url');
function validToken(t) {
  const [payload, mac] = String(t || '').split('.');
  if (!payload || !mac) return false;
  const a = Buffer.from(sign(payload)), b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); return p.u === CONFIG.user && p.e > Date.now(); } catch { return false; }
}
const oneTime = new Map(); // código -> caduca
const sessions = new Map(); // cookie -> caduca
const hasSession = (req) => { const m = /(?:^|;\s*)nubeos_m=([a-f0-9]+)/.exec(req.headers.cookie || ''); const e = m && sessions.get(m[1]); return !!e && e > Date.now(); };

const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
async function body(req) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); if (chunks.length > 100) throw new Error('Demasiado grande'); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// ---------- Navegador (Chromium de neko) ----------
const browser = { password: null, admin: null, adminToken: null };
const policies = (accent) => ({
  AutofillAddressEnabled: false, AutofillCreditCardEnabled: false, BrowserSignin: 1, DefaultNotificationsSetting: 2,
  DeveloperToolsAvailability: 2, FullscreenAllowed: true, SyncDisabled: true, AutoplayAllowed: true,
  BrowserAddPersonEnabled: false, BrowserGuestModeEnabled: false, AllowFileSelectionDialogs: true,
  DownloadRestrictions: 0, DownloadDirectory: '/home/neko/Downloads', PromptForDownloadLocation: false,
  BookmarkBarEnabled: false, PasswordManagerEnabled: true, BrowserLabsEnabled: false, CommandLineFlagSecurityWarningsEnabled: false,
  BrowserThemeColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#5b6cff', RestoreOnStartup: 5, ApplicationLocaleValue: 'es',
  URLBlocklist: ['file://*', 'chrome://policy'],
  ExtensionInstallForcelist: ['ddkjiahejlhfcafbddmgiahcphecmpfh;https://clients2.google.com/service/update2/crx'],
});
const chromiumConf = (dark) => `[program:chromium]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s",LANGUAGE="es",LANG="es_ES.UTF-8"
command=/usr/bin/chromium --no-sandbox --window-position=0,0 --display=%(ENV_DISPLAY)s --user-data-dir=/home/neko/.config/chromium --no-first-run --start-maximized --hide-crash-restore-bubble ${dark ? '--force-dark-mode --enable-features=WebContentsForceDark' : ''} --load-extension=/home/neko/nubeos-ext --disable-features=DisableLoadExtensionCommandLineSwitch --disable-file-system --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage --lang=es
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
async function browserRunning() {
  try { return (await run('docker', ['inspect', '-f', '{{.State.Running}}', 'nubeos-navegador'])).stdout.trim() === 'true'; } catch { return false; }
}
async function browserStart({ width = 1600, height = 900, dark = false, accent = '#5b6cff', extToken = '', extServer = CONFIG.origin }) {
  const w = Math.min(2560, Math.max(640, Math.round(width / 8) * 8)), h = Math.min(1600, Math.max(400, Math.round(height / 8) * 8));
  if (await browserRunning() && browser.password) { browserResize(w, h).catch(() => {}); return browserUrl(); }
  const conf = `${DIR}/navegador`;
  writeFileSync(`${conf}/policies.json`, JSON.stringify(policies(accent)));
  writeFileSync(`${conf}/chromium.conf`, chromiumConf(dark));
  cpSync(`${DIR}/navegador-ext`, `${conf}/ext`, { recursive: true });
  writeFileSync(`${conf}/ext/config.json`, JSON.stringify({ server: extServer, token: extToken }));
  browser.password = randomBytes(18).toString('base64url');
  browser.admin = randomBytes(18).toString('base64url');
  browser.adminToken = null;
  await run('docker', ['rm', '-f', 'nubeos-navegador']).catch(() => {});
  await run('docker', ['run', '-d', '--name', 'nubeos-navegador', '--shm-size=1g', '--hostname', 'nubeos-navegador',
    '-p', `127.0.0.1:${NEKO_PORT}:8080`, '-p', `${NEKO_RTC}:${NEKO_RTC}/tcp`, '-p', `${NEKO_RTC}:${NEKO_RTC}/udp`,
    '-e', `NEKO_DESKTOP_SCREEN=${w}x${h}@30`, '-e', 'NEKO_MEMBER_PROVIDER=multiuser',
    '-e', `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${browser.password}`, '-e', `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${browser.admin}`,
    '-e', 'NEKO_SESSION_IMPLICIT_HOSTING=true', '-e', 'NEKO_SESSION_MERCIFUL_RECONNECT=true',
    '-e', `NEKO_WEBRTC_TCPMUX=${NEKO_RTC}`, '-e', `NEKO_WEBRTC_UDPMUX=${NEKO_RTC}`, '-e', `NEKO_WEBRTC_NAT1TO1=${CONFIG.ip}`, '-e', 'NEKO_WEBRTC_ICELITE=true',
    '-v', 'nubeos-navegador-perfil:/home/neko/.config/chromium', '-v', `${DOWNLOADS}:/home/neko/Downloads`,
    '-v', `${conf}/policies.json:/etc/chromium/policies/managed/policies.json:ro`,
    '-v', `${conf}/chromium.conf:/etc/neko/supervisord/chromium.conf:ro`, '-v', `${conf}/ext:/home/neko/nubeos-ext:ro`,
    'nubeos-navegador'], { timeout: 120000 });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${NEKO_PORT}/health`)).ok) break; } catch { /* aún no */ } await sleep(500); }
  return browserUrl();
}
const browserUrl = () => ({ url: `https://${CONFIG.host}:8443/?${new URLSearchParams({ usr: 'nubeos', pwd: browser.password, embed: '1', lang: 'es', volume: '1' })}` });
async function browserResize(width, height) {
  if (!browser.adminToken) {
    const r = await fetch(`http://127.0.0.1:${NEKO_PORT}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: browser.admin }) });
    browser.adminToken = (await r.json()).token;
  }
  await fetch(`http://127.0.0.1:${NEKO_PORT}/api/room/screen`, { method: 'POST', headers: { authorization: `Bearer ${browser.adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ width, height, rate: 30 }) });
}
async function browserStop() {
  await run('docker', ['stop', '-t', '5', 'nubeos-navegador']).catch(() => {});
  await run('docker', ['rm', '-f', 'nubeos-navegador']).catch(() => {});
  browser.password = null;
}

// Descargas del navegador → Archivos › Descargas del usuario (el servidor central comprueba su espacio).
async function uploadDownloads() {
  let files = [];
  try { files = readdirSync(DOWNLOADS); } catch { return; }
  for (const f of files) {
    if (/\.(crdownload|part|tmp)$/i.test(f) || f.startsWith('.')) continue;
    const full = `${DOWNLOADS}/${f}`;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile() || Date.now() - st.mtimeMs < 2000) continue;
    const payload = `${CONFIG.user}|${f}|${st.size}`;
    const sig = createHmac('sha256', CONFIG.secret).update(payload).digest('hex');
    try {
      const res = await fetch(`${CONFIG.origin}/api/agent/upload?${new URLSearchParams({ u: CONFIG.user, name: f, size: String(st.size), sig })}`, {
        method: 'POST', body: createReadStream(full), duplex: 'half', headers: { 'content-length': String(st.size) },
      });
      if (res.ok || res.status === 507 || res.status === 413) unlinkSync(full); // subido, o no cabe (el usuario ya recibe el aviso)
    } catch (e) { console.error('[descargas]', f, e.message); }
  }
}
setInterval(uploadDownloads, 3000);

// ---------- Apps de Linux (Flathub) en la sesión gráfica (Xpra) ----------
const FLATPAK_ID = /^[A-Za-z0-9_.-]{3,120}$/;
const jobs = new Map(); // id -> { state, log }
async function installedApps() {
  try {
    const { stdout } = await run('flatpak', ['list', '--app', '--columns=application,name']);
    return stdout.split('\n').filter(Boolean).map((l) => { const [id, name] = l.split('\t'); return { id, name: name || id }; });
  } catch { return []; }
}
function flatpakJob(id, args) {
  jobs.set(id, { state: 'trabajando', log: '' });
  const p = spawn('flatpak', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (d) => { const j = jobs.get(id); j.log = (j.log + d).slice(-1500); };
  p.stdout.on('data', keep); p.stderr.on('data', keep);
  p.on('close', (code) => { jobs.get(id).state = code === 0 ? 'hecho' : 'error'; });
}
const openApp = (id) => spawn('sudo', ['-u', 'nubeos', 'xpra', 'control', ':100', 'start', '--', 'flatpak', 'run', id], { stdio: 'ignore', detached: true }).unref();

// ---------- Servidor ----------
function proxy(req, res, port, path = req.url) {
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Todavía arrancando. Prueba en unos segundos.'); });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // Enlace de un solo uso → cookie de sesión → apps (Xpra).
    if (url.pathname === '/agent/auth') {
      const k = url.searchParams.get('k');
      if (!k || !(oneTime.get(k) > Date.now())) { res.writeHead(403); return res.end('Enlace caducado'); }
      oneTime.delete(k);
      const id = randomBytes(24).toString('hex');
      sessions.set(id, Date.now() + 12 * 3600e3);
      res.writeHead(302, { 'set-cookie': `nubeos_m=${id}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=43200`, location: '/apps/' });
      return res.end();
    }
    if (url.pathname.startsWith('/apps/')) {
      if (!hasSession(req)) { res.writeHead(403); return res.end('Abre tus apps desde WonderfulOS'); }
      return proxy(req, res, XPRA_PORT, req.url.slice('/apps'.length) || '/');
    }
    if (!url.pathname.startsWith('/agent/')) { res.writeHead(404); return res.end(); }
    if (!validToken((req.headers.authorization || '').replace(/^Bearer /, ''))) return json(res, 401, { error: 'No autorizado' });
    const route = `${req.method} ${url.pathname.slice('/agent'.length)}`;

    if (route === 'GET /status') return json(res, 200, { browser: await browserRunning(), apps: await installedApps(), plan: CONFIG.plan });
    if (route === 'POST /browser/start') return json(res, 200, await browserStart(await body(req)));
    if (route === 'POST /browser/resize') { const b = await body(req); await browserResize(b.width, b.height).catch(() => {}); return json(res, 200, { ok: true }); }
    if (route === 'POST /browser/stop') { await browserStop(); return json(res, 200, { ok: true }); }
    if (route === 'GET /apps') return json(res, 200, { apps: await installedApps(), jobs: Object.fromEntries(jobs) });
    if (route === 'POST /apps/install' || route === 'POST /apps/uninstall') {
      const { id } = await body(req);
      if (!FLATPAK_ID.test(String(id || ''))) return json(res, 400, { error: 'App no válida' });
      flatpakJob(id, route.endsWith('install') && !route.endsWith('uninstall') ? ['install', '-y', '--noninteractive', 'flathub', id] : ['uninstall', '-y', '--noninteractive', id]);
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /apps/session') {
      const { id } = await body(req);
      if (id && FLATPAK_ID.test(String(id))) openApp(id);
      const k = randomBytes(18).toString('hex');
      oneTime.set(k, Date.now() + 60e3);
      return json(res, 200, { url: `https://${CONFIG.host}/agent/auth?k=${k}` });
    }
    json(res, 404, { error: 'No encontrado' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});
// Xpra usa WebSocket: se pasa tal cual si hay sesión.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/apps/') || !hasSession(req)) return socket.destroy();
  const up = net.connect(XPRA_PORT, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url.slice('/apps'.length) || '/'} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
});
server.listen(7000, '127.0.0.1', () => console.log(`Agente de WonderfulOS para ${CONFIG.user} en https://${CONFIG.host}`));
