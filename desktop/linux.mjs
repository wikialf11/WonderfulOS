// Motor Linux de WonderfulOS en el Mac: una máquina virtual pequeña (Lima + la
// virtualización de Apple, con Rosetta para las apps de Intel) donde se instalan y
// ejecutan apps de Linux. Cada app se ve en una ventana de WonderfulOS con Xpra.
// En Linux no hace falta (las apps van directas) y en Windows se usa el sistema.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const NAME = 'nubeos';
let cfg = null; // { limactl, home, shared, template, send }
const state = { starting: null, ports: new Map() };

export function init({ resources, dataDir, here, web, send }) {
  // El Lima incluido es para Apple Silicon (los Mac con Intel usarán el de Homebrew si lo tienen).
  const bundled = process.arch === 'arm64' ? path.join(resources, 'lima', 'bin', 'limactl') : '';
  const limactl = [bundled, '/opt/homebrew/bin/limactl', '/usr/local/bin/limactl'].find((p) => existsSync(p)) || null;
  // Ruta corta: los sockets de Lima no admiten rutas largas (máx. 104 caracteres).
  cfg = { limactl, home: process.env.NUBEOS_LIMA_HOME || path.join(os.homedir(), '.nubeos', 'lima'), shared: path.join(dataDir, 'linux-compartido'), template: path.join(here, 'linux', 'nubeos-linux.yaml'), officeScript: path.join(here, 'linux', 'office-setup.sh'), officeCss: path.join(web, 'agent', 'office', 'nubeos.css'), send };
  mkdirSync(cfg.home, { recursive: true });
  mkdirSync(cfg.shared, { recursive: true });
}
export const supported = () => process.platform === 'darwin' && !!cfg?.limactl;
// Lima en su propia carpeta: no se mezcla con otras máquinas virtuales del usuario.
const lima = (args, opts = {}) => run(cfg.limactl, args, { env: { ...process.env, LIMA_HOME: cfg.home }, maxBuffer: 1 << 24, ...opts });
const sh = (cmd, timeout = 600000) => lima(['shell', '--workdir', '/', NAME, 'bash', '-lc', cmd], { timeout });
/** Ejecuta una orden dentro del motor Linux (para WonderfulApps). */
export const shell = (cmd, timeout) => sh(cmd, timeout);

export async function status() {
  if (!supported()) return { supported: false };
  if (state.starting) return { supported: true, state: 'preparando' };
  try {
    const { stdout } = await lima(['list', '--json']);
    const vm = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((v) => v.name === NAME);
    return { supported: true, state: !vm ? 'sin instalar' : vm.status === 'Running' ? 'encendido' : 'apagado' };
  } catch { return { supported: true, state: 'sin instalar' }; }
}

/** Instala (la primera vez descarga Debian, unos minutos) o enciende el motor Linux. */
export function start() {
  if (state.starting) return state.starting;
  state.starting = (async () => {
    let s = await status();
    // La carpeta compartida tiene que ser la de esta versión (al pasar de NubeOS a WonderfulOS
    // cambió de sitio): si el motor apunta a otra, se corrige y se reinicia.
    const vmYaml = path.join(cfg.home, NAME, 'lima.yaml');
    if (s.state !== 'sin instalar' && existsSync(vmYaml)) {
      const y = readFileSync(vmYaml, 'utf8');
      const m = y.match(/- location: "([^"]*linux-compartido)"/);
      if (m && m[1] !== cfg.shared) {
        mkdirSync(cfg.shared, { recursive: true });
        if (s.state === 'encendido') await lima(['stop', NAME], { timeout: 180000 }).catch(() => lima(['stop', '-f', NAME], { timeout: 60000 }));
        writeFileSync(vmYaml, y.replace(m[0], `- location: ${JSON.stringify(cfg.shared)}`));
        s = await status();
      }
    }
    if (s.state === 'encendido') return;
    // Recursos del motor según el Mac: deja al menos 4 núcleos y 2/3 de la memoria para macOS.
    const cpus = Math.max(4, Math.min(8, os.cpus().length - 4));
    const memGiB = Math.max(4, Math.min(12, Math.floor(os.totalmem() / 2 ** 30 / 3)));
    if (s.state === 'sin instalar') {
      const yaml = readFileSync(cfg.template, 'utf8').replaceAll('__COMPARTIDO__', cfg.shared)
        .replace(/^cpus: .*/m, `cpus: ${cpus}`).replace(/^memory: .*/m, `memory: "${memGiB}GiB"`);
      const file = path.join(cfg.home, 'nubeos-linux.yaml');
      writeFileSync(file, yaml);
      cfg.send('nubeos:notice', { kind: 'linux', text: 'Preparando el motor Linux. La primera vez tarda unos minutos.' });
      await lima(['start', '--name', NAME, '--tty=false', file], { timeout: 3600000 });
    } else {
      await lima(['edit', '--tty=false', '--cpus', String(cpus), '--memory', String(memGiB), NAME], { timeout: 120000 }).catch(() => {});
      await lima(['start', '--tty=false', NAME], { timeout: 600000 });
    }
    cfg.send('nubeos:notice', { kind: 'linux', text: 'El motor Linux está listo.' });
  })().finally(() => { state.starting = null; });
  return state.starting;
}
export async function stop() { await lima(['stop', NAME], { timeout: 120000 }).catch(() => {}); state.ports.clear(); officeReady = null; }

// ---------- Apps ----------
const SAFE = /^[A-Za-z0-9_.-]{3,120}$/;
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
export async function installed() {
  if ((await status()).state !== 'encendido') return [];
  const { stdout } = await sh('flatpak list --app --columns=application,name 2>/dev/null || true');
  return stdout.split('\n').filter(Boolean).map((l) => { const [id, name] = l.split('\t'); return { id, name: name || id }; });
}
export async function install(id) {
  if (!SAFE.test(String(id))) throw new Error('App no válida');
  await start();
  await sh(`flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo && flatpak config --user --set languages 'es;en' && flatpak install -y --noninteractive --user flathub ${q(id)}`, 3600000);
  return { ok: true };
}
export async function uninstall(id) {
  if (!SAFE.test(String(id))) throw new Error('App no válida');
  await sh(`flatpak uninstall -y --noninteractive --user ${q(id)}`);
  return { ok: true };
}

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function waitPort(port) {
  for (let i = 0; i < 80; i++) {
    const up = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('La app de Linux no arrancó');
}
/** Arranca una app (flatpak o archivo) en su propia sesión de Xpra y devuelve su dirección. */
const portUp = (port) => new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
const urlFor = (port, title) => `http://127.0.0.1:${port}/?${new URLSearchParams({ floating_menu: 'false', sharing: 'false', clipboard: 'true', keyboard_layout: 'es', title })}`;
async function launch(command, title, key = null) {
  await start();
  // Si esa app ya está abierta (por ejemplo, se cerró su ventana pero no la app), se vuelve a ella.
  if (key && state.ports.has(key) && await portUp(state.ports.get(key))) return { url: urlFor(state.ports.get(key), title), reused: true };
  const port = await freePort();
  const display = 100 + (port % 800);
  // Lima reenvía al Mac los puertos que abre la máquina virtual.
  await sh(`nohup xpra start :${display} --bind-tcp=0.0.0.0:${port} --html=on --daemon=yes --mdns=no --notifications=no --pulseaudio=no --dpi=96 \
    --start-child=${q(command)} --exit-with-children=yes --title=${q(title)} >/dev/null 2>&1 &`, 60000);
  await waitPort(port);
  if (key) state.ports.set(key, port);
  return { url: urlFor(port, title) };
}
export async function open(id, args = []) {
  if (!SAFE.test(String(id))) throw new Error('App no válida');
  // En español: las traducciones de cada app vienen con su paquete de idioma (ver install).
  // Las opciones de flatpak (--env=…) van antes del id; las de la app, después.
  const opt = (x) => /^--(env|filesystem)=/.test(x);
  const opts = args.filter(opt).map(q).join(' ');
  const appArgs = args.filter((x) => !opt(x)).map(q).join(' ');
  // Sin archivo ni dirección que abrir, se reutiliza la app si ya está en marcha.
  return launch(`env LANG=es_ES.UTF-8 LANGUAGE=es:en LC_ALL=es_ES.UTF-8 flatpak run ${opts} ${id} ${appArgs}`.replace(/ +/g, ' ').trim(), id, appArgs ? null : id);
}
/** Abre o instala un archivo de Linux descargado (.AppImage, .deb, .flatpakref). */
export async function openFile(file, name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  const dest = path.join(cfg.shared, name);
  copyFileSync(file, dest);
  const inVm = `/mnt/nubeos/${name}`;
  await start();
  if (ext === 'appimage') {
    // Sin FUSE dentro de la máquina: se extrae y se ejecuta. Rosetta ejecuta las de Intel (x86_64).
    await sh(`chmod +x ${q(inVm)}`);
    return launch(`env APPIMAGE_EXTRACT_AND_RUN=1 ${inVm}`, name);
  }
  if (ext === 'flatpakref' || ext === 'flatpak') { await sh(`flatpak install -y --noninteractive --user ${q(inVm)}`, 3600000); return { installed: true }; }
  if (ext === 'deb') { await sh(`sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${q(inVm)}`, 3600000); return { installed: true }; }
  throw new Error('Este archivo no es una app de Linux');
}
// ---------- Oficina ----------
// La oficina de WonderfulOS (Collabora con su aspecto), dentro del motor Linux; Lima trae
// su puerto 9980 a este Mac. La primera vez se descarga (~500 MB).
let officeReady = null;
export function startOffice() {
  if (officeReady) return officeReady;
  officeReady = (async () => {
    await start();
    copyFileSync(cfg.officeScript, path.join(cfg.shared, 'office-setup.sh'));
    copyFileSync(cfg.officeCss, path.join(cfg.shared, 'nubeos-office.css'));
    const first = !(await sh('command -v coolwsd || true')).stdout.trim();
    if (first) cfg.send('nubeos:notice', { kind: 'linux', text: 'Preparando la oficina de WonderfulOS. La primera vez tarda unos minutos.' });
    await sh('sudo bash /mnt/nubeos/office-setup.sh /mnt/nubeos/nubeos-office.css', 3600000);
  })().catch((e) => { officeReady = null; throw e; });
  return officeReady;
}
export const isLinuxApp = (name) => /\.(appimage|deb|flatpakref|flatpak)$/i.test(name);
