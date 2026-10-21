// WonderfulOS en tu ordenador (Mac, Windows y Linux).
//
// Ocupa toda la pantalla y se usa como el sistema: el mismo escritorio de WonderfulOS,
// pero con la potencia real del equipo. Dentro corre el servidor de WonderfulOS en modo
// local (archivos en este disco, sin internet obligatorio) y el equipo aporta:
//  - Navegador: Chromium de verdad (el de esta app), con descargas a tus Descargas.
//  - Oficina: LibreOffice de escritorio con el aspecto de WonderfulOS (perfil propio).
//  - Tienda: programas del sistema (Homebrew en Mac, winget en Windows, Flathub en Linux).
import { app, BrowserWindow, ipcMain, session, shell, dialog, Menu, clipboard } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as local from './local.mjs';
import * as linux from './linux.mjs';
import * as office from './office-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Para probar sin tocar el WonderfulOS instalado: NUBEOS_USERDATA=/otra/carpeta npm start
if (process.env.NUBEOS_USERDATA) app.setPath('userData', process.env.NUBEOS_USERDATA);
// Antes se llamaba NubeOS y luego ColorOS: se conservan los archivos y ajustes de esas versiones.
for (const old of ['Color' + 'OS', 'Nube' + 'OS'].map((n) => path.join(app.getPath('appData'), n))) {
  if (!process.env.NUBEOS_USERDATA && !existsSync(app.getPath('userData')) && existsSync(old)) renameSync(old, app.getPath('userData'));
}
const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web-desktop') : path.join(HERE, '..', 'web-desktop');
const DATA = path.join(app.getPath('userData'), 'datos');
mkdirSync(DATA, { recursive: true });
// El Llavero no usa cuentas ni el servicio local: guarda un único archivo cifrado en el disco.
const LLAVERO_FILE = path.join(DATA, 'llavero.json');
let LLAVERO_USER = '';

if (!app.requestSingleInstanceLock()) app.quit();
// Rendimiento: dibujar con la tarjeta gráfica siempre que se pueda (el navegador va mucho más fluido).
for (const f of ['ignore-gpu-blocklist', 'enable-gpu-rasterization', 'enable-zero-copy']) app.commandLine.appendSwitch(f);

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

function writeLlavero(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Datos del llavero no válidos');
  const json = JSON.stringify(data);
  if (json.length > 5 * 1024 * 1024) throw new Error('El llavero es demasiado grande');
  const tmp = `${LLAVERO_FILE}.tmp`;
  writeFileSync(tmp, json, { mode: 0o600 });
  renameSync(tmp, LLAVERO_FILE);
}
function readLlavero() {
  if (existsSync(LLAVERO_FILE)) return JSON.parse(readFileSync(LLAVERO_FILE, 'utf8'));
  // Migración: si ya había un llavero en los datos de la app, se pasa al archivo local.
  try {
    const dir = path.join(DATA, 'apps');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (d.app === 'llavero' && d.owner === LLAVERO_USER && d.data?.salt) {
        writeLlavero(d.data);
        return d.data;
      }
    }
  } catch { /* todavía no hay llavero */ }
  return null;
}

let win = null;
let LOCAL_ORIGIN = '';
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => rawHandle(ch, (e, ...args) => {
  const from = (() => { try { return new URL(e.senderFrame?.url || '').origin; } catch { return ''; } })();
  if (from !== LOCAL_ORIGIN) throw new Error('No permitido desde fuera de este ordenador');
  return fn(e, ...args);
});
async function start() {
  // Servicio local de la interfaz, solo accesible desde este equipo.
  const port = await freePort();
  Object.assign(process.env, { NUBEOS_DATA: DATA, PORT: String(port), PROXY_PORT: String(await freePort()), HOST: '127.0.0.1', NUBEOS_LOCAL: '1' });
  // La oficina es la misma que la versión online (Collabora), en este ordenador: ver office-engine.mjs.
  Object.assign(process.env, { COLLABORA_URL: office.OFFICE_URL, NUBEOS_PUBLIC_ORIGIN: `http://127.0.0.1:${port}` });
  await import(pathToFileURL(path.join(WEB, 'server.mjs')).href);
  const store = await import(pathToFileURL(path.join(WEB, 'server', 'store.mjs')).href);
  const origin = `http://127.0.0.1:${port}`;
  LOCAL_ORIGIN = origin;

  // Cuenta local (el usuario del sistema); su contraseña la guarda la app.
  const accountFile = path.join(DATA, 'cuenta-local.json');
  const name = (process.env.USER || process.env.USERNAME || 'yo').toLowerCase().replace(/[^a-z0-9_.-]/g, '').padEnd(3, '0').slice(0, 30);
  let acct = existsSync(accountFile) ? JSON.parse(readFileSync(accountFile, 'utf8')) : null;
  if (!acct) {
    acct = { user: name, password: randomBytes(24).toString('hex') };
    try { store.register(acct.user, acct.password); } catch { /* ya existía */ }
    writeFileSync(accountFile, JSON.stringify(acct), { mode: 0o600 });
  }
  const { token } = store.login(acct.user, acct.password);
  LLAVERO_USER = acct.user;
  await session.defaultSession.cookies.set({ url: origin, name: 'nubeos_sid', value: token, httpOnly: true, sameSite: 'lax' });

  local.init({ store, user: acct.user, dataDir: DATA, send: (ch, msg) => win?.webContents.send(ch, msg) });
  office.init({ here: app.isPackaged ? process.resourcesPath : HERE, web: WEB, dataDir: DATA, port, exe: process.execPath, send: (ch, msg) => win?.webContents.send(ch, msg) });
  linux.init({ resources: app.isPackaged ? process.resourcesPath : HERE, dataDir: DATA, here: app.isPackaged ? process.resourcesPath : HERE, web: WEB, send: (ch, msg) => win?.webContents.send(ch, msg) });

  win = new BrowserWindow({
    title: 'WonderfulOS', backgroundColor: '#14161f', show: false,
    fullscreen: !process.env.NUBEOS_WINDOWED, width: 1440, height: 900, autoHideMenuBar: true, frame: process.platform === 'darwin',
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), webviewTag: true, contextIsolation: true },
  });
  // Los enlaces que piden ventana nueva se abren como pestaña del Navegador de WonderfulOS.
  win.webContents.setWindowOpenHandler(({ url }) => { win.webContents.send('nubeos:open-url', url); return { action: 'deny' }; });
  win.once('ready-to-show', () => { win.show(); setTimeout(prepareOffice, 8000); });
  win.loadURL(origin);
  win.webContents.on('will-attach-webview', (e, prefs) => { delete prefs.preload; prefs.nodeIntegration = false; prefs.contextIsolation = true; });

  // Descargas del Navegador (sus pestañas usan la sesión «persist:navegador») → Archivos › Descargas.
  for (const s of [session.defaultSession, session.fromPartition('persist:navegador')]) {
    s.on('will-download', (event, item) => local.handleDownload(item));
    s.setUserAgent(CHROME_UA, 'es-ES,es;q=0.9,en;q=0.8');
  }
  // La oficina (Collabora del motor Linux) se muestra dentro del escritorio de WonderfulOS.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:9980/*', 'http://127.0.0.1:9990/*'] }, ({ responseHeaders }, done) => {
    for (const k of Object.keys(responseHeaders)) if (/^(content-security-policy|x-frame-options)$/i.test(k)) delete responseHeaders[k];
    done({ responseHeaders });
  });
  // Apps de Linux (Xpra del motor Linux): Xpra prohíbe que lo enmarquen; dentro de WonderfulOS sí se puede.
  session.fromPartition('linux').webRequest.onHeadersReceived(({ responseHeaders }, done) => {
    for (const k of Object.keys(responseHeaders)) if (/^(content-security-policy|x-frame-options|cross-origin-.*-policy)$/i.test(k)) delete responseHeaders[k];
    done({ responseHeaders });
  });
}

// El Navegador se presenta como un Chrome normal: con «Electron» o «WonderfulOS» en el agente de
// usuario, Google y otros sitios piden captchas sin parar o van mal.
const CHROME_UA = `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;
app.commandLine.appendSwitch('lang', 'es-ES');
/** La oficina (Texto, Cálculo, Presentaciones) viene lista: la primera vez se instala sola en segundo
 *  plano y, a partir de ahí, se enciende al arrancar para que los documentos se abran al momento. */
async function prepareOffice() {
  if (!office.supported()) return;
  const flag = path.join(DATA, 'oficina-lista');
  const first = !existsSync(flag);
  if (first) win?.webContents.send('nubeos:notice', { kind: 'linux', text: 'Preparando la oficina (Texto, Cálculo y Presentaciones). Se hace una sola vez y tarda unos minutos; puedes seguir usando WonderfulOS.' });
  try {
    await office.start();
    process.env.NUBEOS_WOPI_URL = await office.wopiUrl();
    if (first) { writeFileSync(flag, new Date().toISOString()); win?.webContents.send('nubeos:notice', { kind: 'linux', text: 'La oficina está lista.' }); }
  } catch (e) { console.error('Oficina:', e); }
}
app.whenReady().then(start).catch((e) => { dialog.showErrorBox('WonderfulOS no pudo arrancar', String(e?.stack || e)); app.quit(); });
// Las páginas que abren otra ventana (enlaces con target=_blank…) se abren como pestaña nueva.
app.on('web-contents-created', (e, contents) => {
  // Menú del clic derecho en las páginas web: guardar imágenes, descargar enlaces, copiar…
  if (contents.getType() === 'webview') contents.on('context-menu', (ev, p) => {
    const items = [];
    const sep = () => items.length && items.at(-1).type !== 'separator' && items.push({ type: 'separator' });
    if (p.linkURL) {
      items.push({ label: 'Abrir enlace en una pestaña nueva', click: () => win?.webContents.send('nubeos:open-url', p.linkURL) });
      items.push({ label: 'Descargar el archivo del enlace', click: () => contents.downloadURL(p.linkURL) });
      items.push({ label: 'Copiar dirección del enlace', click: () => clipboard.writeText(p.linkURL) });
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Guardar imagen en Descargas', click: () => contents.downloadURL(p.srcURL) });
      items.push({ label: 'Copiar imagen', click: () => contents.copyImageAt(p.x, p.y) });
      items.push({ label: 'Abrir imagen en una pestaña nueva', click: () => win?.webContents.send('nubeos:open-url', p.srcURL) });
      sep();
    }
    if (['video', 'audio'].includes(p.mediaType) && p.srcURL && !p.srcURL.startsWith('blob:')) {
      items.push({ label: `Guardar ${p.mediaType === 'video' ? 'vídeo' : 'audio'} en Descargas`, click: () => contents.downloadURL(p.srcURL) });
      sep();
    }
    if (p.selectionText) {
      items.push({ label: 'Copiar', role: 'copy' });
      items.push({ label: `Buscar «${p.selectionText.slice(0, 30)}» en Google`, click: () => win?.webContents.send('nubeos:open-url', `https://www.google.com/search?q=${encodeURIComponent(p.selectionText)}`) });
      sep();
    }
    if (p.isEditable) {
      items.push({ label: 'Cortar', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copiar', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Pegar', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Seleccionar todo', role: 'selectAll' });
      sep();
    }
    if (!p.linkURL && !p.srcURL && !p.selectionText && !p.isEditable) {
      items.push({ label: 'Atrás', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: 'Adelante', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
        { label: 'Recargar', click: () => contents.reload() }, { type: 'separator' },
        { label: 'Guardar página en Descargas', click: () => contents.downloadURL(contents.getURL()) });
    }
    if (items.at(-1)?.type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  if (contents.getType() === 'webview') contents.setWindowOpenHandler(({ url }) => { win?.webContents.send('nubeos:open-url', url); return { action: 'deny' }; });
});
app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

// ---------- Lo que el escritorio pide al equipo (ver preload.cjs) ----------
// session: WonderfulOS es el sistema del PC (la ISO); live: arrancado desde el USB, sin instalar.
const SESSION = process.platform === 'linux' && process.env.NUBEOS_SESSION === '1';
ipcMain.handle('nubeos:info', () => ({ platform: process.platform, version: app.getVersion(), openAtLogin: app.getLoginItemSettings().openAtLogin,
  session: SESSION, live: SESSION && existsSync('/run/live/medium') }));
ipcMain.handle('nubeos:power', (e, what) => {
  if (!SESSION || !['poweroff', 'reboot'].includes(what)) return;
  spawn('systemctl', [what], { stdio: 'ignore', detached: true }).unref();
});
// El instalador (Calamares): al disco entero o junto a Windows, con menú para elegir al arrancar.
ipcMain.handle('nubeos:install-system', () => {
  if (!SESSION) return;
  spawn('pkexec', ['env', `WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || ''}`, `XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR || ''}`, 'QT_QPA_PLATFORM=wayland', 'calamares'], { stdio: 'ignore', detached: true }).unref();
});
ipcMain.handle('nubeos:quit', () => app.quit());
ipcMain.handle('nubeos:zoom', (e, z) => { const f = Math.min(1.6, Math.max(0.8, Number(z) || 1)); win?.webContents.setZoomFactor(f); return f; });
ipcMain.handle('nubeos:open-at-login', (e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle('nubeos:fullscreen', (e, on) => { win.setFullScreen(!!on); return win.isFullScreen(); });
ipcMain.handle('nubeos:llavero-load', () => readLlavero());
ipcMain.handle('nubeos:llavero-save', (e, data) => { writeLlavero(data); return { ok: true }; });
ipcMain.handle('nubeos:mail-start', async () => { await office.startMail(); return office.MAIL_URL; });
ipcMain.handle('nubeos:office-mode', () => (office.supported() ? 'motor' : 'escritorio'));
ipcMain.handle('nubeos:office-start', async () => { await office.start(); process.env.NUBEOS_WOPI_URL = await office.wopiUrl(); });
ipcMain.handle('nubeos:office-open', (e, p, theme) => local.openInOffice(p, theme));
ipcMain.handle('nubeos:office-available', () => local.officeInstalled());
ipcMain.handle('nubeos:office-install', () => local.installOffice());
ipcMain.handle('nubeos:show-in-system', (e, p) => local.reveal(p));
ipcMain.handle('nubeos:open-with-system', (e, p) => local.openWithSystem(p));
ipcMain.handle('nubeos:apps-search', (e, q) => local.searchApps(q));
ipcMain.handle('nubeos:apps-installed', () => local.installedApps());
ipcMain.handle('nubeos:apps-install', (e, id) => local.installApp(id));
ipcMain.handle('nubeos:apps-uninstall', (e, id) => local.uninstallApp(id));
ipcMain.handle('nubeos:apps-open', (e, id) => local.openApp(id));
// Motor Linux (Mac): apps de Linux en ventanas de WonderfulOS.
ipcMain.handle('nubeos:linux-status', () => linux.status());
ipcMain.handle('nubeos:linux-start', () => linux.start().then(() => linux.status()));
ipcMain.handle('nubeos:linux-stop', () => linux.stop());
ipcMain.handle('nubeos:linux-installed', () => linux.installed());
ipcMain.handle('nubeos:linux-install', (e, id) => linux.install(id));
ipcMain.handle('nubeos:linux-uninstall', (e, id) => linux.uninstall(id));
ipcMain.handle('nubeos:linux-open', (e, id) => linux.open(id));
ipcMain.handle('nubeos:linux-open-file', (e, p) => linux.openFile(local.realCopy(p), path.basename(p)));
app.on('before-quit', () => { office.stop(); linux.stop(); });
ipcMain.handle('nubeos:open-external', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
