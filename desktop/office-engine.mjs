// Oficina de WonderfulOS en el propio ordenador: Collabora Online con el aspecto de
// WonderfulOS, funcionando con la potencia del equipo.
//  - Mac (Apple Silicon): dentro del motor Linux (linux.mjs).
//  - Linux y el sistema WonderfulOS para PC: instalada directamente (en la ISO ya viene).
//  - Windows: dentro de WSL, el Linux que trae Windows.
// En todos, Collabora queda en http://127.0.0.1:9980 y pide los archivos al servicio
// local de WonderfulOS (WOPI) por la dirección que devuelve wopiUrl().
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as linux from './linux.mjs';

const run = promisify(execFile);
export const OFFICE_URL = 'http://127.0.0.1:9980';
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';
let cfg = null; // { here, web, dataDir, port, send, exe }
let ready = null;
let winServer = null; // coolwsd dentro de WSL (proceso de wsl.exe)

export function init(c) { cfg = c; }
/** ¿Puede este ordenador tener la oficina de WonderfulOS? (Mac con Intel: LibreOffice de escritorio) */
export const supported = () => (MAC ? process.arch === 'arm64' && linux.supported() : true);

const up = async () => {
  try { return (await fetch(`${OFFICE_URL}/hosting/discovery`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};
async function waitUp(secs = 120) {
  for (let i = 0; i < secs / 2; i++) { if (await up()) return; await new Promise((r) => setTimeout(r, 2000)); }
  throw new Error('La oficina no arrancó. Inténtalo de nuevo.');
}
// Copia del script y la hoja de estilo fuera de la app (root no puede leer dentro de una AppImage).
function files() {
  const dir = path.join(cfg.dataDir, 'oficina');
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'office-setup.sh'), css = path.join(dir, 'nubeos-office.css');
  copyFileSync(path.join(cfg.here, 'linux', 'office-setup.sh'), script);
  copyFileSync(path.join(cfg.web, 'agent', 'office', 'nubeos.css'), css);
  return { script, css };
}
const notice = (text) => cfg.send('nubeos:notice', { kind: 'linux', text });

/** Enciende la oficina (la primera vez la instala). */
export function start() {
  if (ready) return ready;
  ready = (MAC ? linux.startOffice() : WIN ? startWindows() : startLinux()).catch((e) => { ready = null; throw e; });
  return ready;
}
export function stop() {
  ready = null;
  if (winServer) { winServer.kill(); winServer = null; }
}

// ---------- Linux ----------
async function startLinux() {
  if (await up()) return;
  if (!existsSync('/usr/bin/coolwsd')) notice('Preparando la oficina de WonderfulOS. La primera vez tarda unos minutos.');
  const { script, css } = files();
  // El sistema pide la contraseña una vez para instalarla o encenderla.
  await run('pkexec', ['bash', script, css], { timeout: 3600000 });
  await waitUp();
}

// ---------- Windows (WSL) ----------
const DISTRO = 'WonderfulOS';
const wsl = (args, opts = {}) => run('wsl.exe', args, { windowsHide: true, encoding: 'utf16le', maxBuffer: 1 << 24, ...opts });
const toWsl = (p) => p.replace(/^([A-Za-z]):\\/, (m, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
const COOL = ['runuser', '-u', 'cool', '--', '/usr/bin/coolwsd', '--o:sys_template_path=/opt/cool/systemplate',
  '--o:child_root_path=/opt/cool/child-roots', '--o:file_server_root_path=/usr/share/coolwsd', '--o:cache_files.path=/opt/cool/cache'];
const wslWorks = () => wsl(['--status']).then(() => true, () => false);

async function distroInstalled() {
  const { stdout } = await wsl(['--list', '--quiet']).catch(() => ({ stdout: '' }));
  return stdout.replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).includes(DISTRO);
}
// Una sola vez, con permiso de administrador: activar WSL y dejar que Collabora (dentro de
// WSL) pida los archivos a WonderfulOS por la red interna de WSL.
async function elevatedSetup() {
  const ps = [
    'wsl.exe --install --no-distribution',
    `New-NetFirewallRule -DisplayName 'WonderfulOS oficina' -Direction Inbound -Action Allow -Program '${cfg.exe.replace(/'/g, "''")}' -InterfaceAlias 'vEthernet (WSL*)' -ErrorAction SilentlyContinue`,
  ].join('; ');
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`], { timeout: 1800000, windowsHide: true });
}
async function startWindows() {
  if (winServer && await up()) return;
  if (!(await wslWorks()) || !(await distroInstalled())) {
    notice('Preparando la oficina de WonderfulOS: Windows te pedirá permiso una vez. La primera vez tarda unos minutos.');
    if (!(await wslWorks())) await elevatedSetup();
    if (!(await wslWorks())) throw new Error('Reinicia el ordenador y vuelve a abrir el documento: Windows está terminando de activar la oficina (WSL).');
    if (!(await distroInstalled())) await wsl(['--install', 'Debian', '--name', DISTRO, '--no-launch', '--web-download'], { timeout: 1800000 });
  }
  const { script, css } = files();
  await wsl(['-d', DISTRO, '-u', 'root', '--', 'env', 'NUBEOS_NO_START=1', 'bash', toWsl(script), toWsl(css)], { timeout: 3600000 });
  if (!winServer) {
    winServer = spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', ...COOL], { windowsHide: true, stdio: 'ignore' });
    winServer.on('exit', () => { winServer = null; ready = null; });
  }
  await waitUp();
}

// ---------- Dirección por la que Collabora pide los archivos al servicio local ----------
let bridge = null;
/** Mac: el Mac visto desde Linux. Windows: un puente solo para /wopi/ en la red de WSL. Linux: directo. */
export async function wopiUrl() {
  if (MAC) return `http://host.lima.internal:${cfg.port}`;
  if (!WIN) return `http://127.0.0.1:${cfg.port}`;
  if (bridge) return bridge;
  // La IP de Windows vista desde WSL es su puerta de enlace (con la red «mirrored» basta 127.0.0.1).
  const { stdout } = await wsl(['-d', DISTRO, '--', 'sh', '-c', "ip route show default | cut -d' ' -f3"], { encoding: 'utf8' }).catch(() => ({ stdout: '' }));
  const ip = stdout.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.startsWith('127.')) return (bridge = `http://127.0.0.1:${cfg.port}`);
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/wopi/')) { res.writeHead(404); return res.end(); }
    const fwd = http.request({ host: '127.0.0.1', port: cfg.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    fwd.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(fwd);
  });
  const port = await new Promise((ok, ko) => { server.once('error', ko); server.listen(0, ip, () => ok(server.address().port)); }).catch(() => 0);
  return (bridge = port ? `http://${ip}:${port}` : `http://127.0.0.1:${cfg.port}`);
}
