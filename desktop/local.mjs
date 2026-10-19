// Lo que WonderfulOS hace con el propio equipo: LibreOffice, descargas y programas.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, statSync, watch, unlinkSync } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';

const run = promisify(execFile);
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';
let ctx = null; // { store, user, dataDir, send }
export function init(c) { ctx = c; }

const nodeOf = (p) => ctx.store.tree(ctx.user)[p];
const extOf = (name) => (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

// ---------- Guardar un archivo del equipo en WonderfulOS ----------
export function importFile(file, nubeosPath, { replace = false } = {}) {
  const t = ctx.store.tree(ctx.user);
  let p = nubeosPath;
  if (!replace) {
    const [, stem, ext] = p.match(/^(.*?)(\.[^./]*)?$/);
    for (let i = 2; t[p]; i++) p = `${stem} (${i})${ext || ''}`;
  }
  const size = statSync(file).size;
  const { id } = ctx.store.prepareUpload(ctx.user, p, size);
  copyFileSync(file, ctx.store.blobPath(id));
  ctx.store.finishUpload(ctx.user, p, id, size, '');
  return p;
}

// ---------- Navegador: descargas ----------
export function handleDownload(item) {
  const dir = path.join(ctx.dataDir, 'descargando');
  mkdirSync(dir, { recursive: true });
  const name = item.getFilename().replace(/[\\/]/g, '-');
  const tmp = path.join(dir, `${Date.now()}-${name}`);
  item.setSavePath(tmp);
  ctx.send('nubeos:download-progress', { name, state: 'empezada' });
  item.once('done', (e, state) => {
    if (state !== 'completed') return ctx.send('nubeos:notice', { kind: 'download-error', name, error: state === 'cancelled' ? 'Cancelada' : 'Se interrumpió' });
    try {
      const p = importFile(tmp, `/Descargas/${name}`);
      ctx.send('nubeos:notice', { kind: 'download', path: p });
    } catch (err) { ctx.send('nubeos:notice', { kind: 'download-error', name, error: err.message }); }
    try { unlinkSync(tmp); } catch { /* ya no estaba */ }
  });
}

// ---------- Oficina: LibreOffice de escritorio con el aspecto de WonderfulOS ----------
function sofficePath() {
  const candidates = MAC ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
    : WIN ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
      : ['/usr/bin/libreoffice', '/usr/bin/soffice', '/snap/bin/libreoffice', '/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice'];
  return candidates.find((c) => existsSync(c)) || null;
}
export const officeInstalled = () => !!sofficePath();

export async function installOffice() {
  try {
    if (MAC && existsSync('/opt/homebrew/bin/brew')) await run('/opt/homebrew/bin/brew', ['install', '--cask', 'libreoffice'], { timeout: 900000 });
    else if (MAC && existsSync('/usr/local/bin/brew')) await run('/usr/local/bin/brew', ['install', '--cask', 'libreoffice'], { timeout: 900000 });
    else if (WIN) await run('winget', ['install', '-e', '--id', 'TheDocumentFoundation.LibreOffice', '--accept-package-agreements', '--accept-source-agreements'], { timeout: 900000 });
    else if (!MAC) await run('flatpak', ['install', '-y', '--user', 'flathub', 'org.libreoffice.LibreOffice'], { timeout: 900000 });
    else { shell.openExternal('https://www.libreoffice.org/download/download-libreoffice/'); return { manual: true }; }
    return { ok: officeInstalled() };
  } catch (e) {
    shell.openExternal('https://www.libreoffice.org/download/download-libreoffice/');
    return { manual: true, error: e.message };
  }
}

// Perfil de LibreOffice propio de WonderfulOS: modo claro u oscuro, iconos y cinta de pestañas.
function officeProfile(theme = {}) {
  const dir = path.join(ctx.dataDir, 'libreoffice-perfil');
  const user = path.join(dir, 'user');
  mkdirSync(user, { recursive: true });
  const item = (p, name, value, type = 'string') => `<item oor:path="${p}"><prop oor:name="${name}" oor:op="fuse"><value>${value}</value></prop></item>`;
  const dark = !!theme.dark;
  writeFileSync(path.join(user, 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${item('/org.openoffice.Office.Common/Misc', 'ApplicationAppearance', dark ? 2 : 1)}
${item('/org.openoffice.Office.Common/Misc', 'SymbolStyle', dark ? 'colibre_dark' : 'colibre')}
${item('/org.openoffice.Office.Common/Misc', 'ShowTipOfTheDay', 'false')}
${item('/org.openoffice.Office.Common/Misc', 'FirstRun', 'false')}
${item('/org.openoffice.Office.UI.ToolbarMode/Applications/org.openoffice.Office.UI.ToolbarMode:ApplicationItem[\'Writer\']', 'Active', 'notebookbar.ui')}
${item('/org.openoffice.Office.UI.ToolbarMode/Applications/org.openoffice.Office.UI.ToolbarMode:ApplicationItem[\'Calc\']', 'Active', 'notebookbar.ui')}
${item('/org.openoffice.Office.UI.ToolbarMode/Applications/org.openoffice.Office.UI.ToolbarMode:ApplicationItem[\'Impress\']', 'Active', 'notebookbar.ui')}
${item('/org.openoffice.Setup/Office', 'ooSetupInstCompleted', 'true')}
${item('/org.openoffice.Office.Common/Save/Document', 'WarnAlienFormat', 'false')}
</oor:items>`);
  return `file://${dir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`;
}

/** Abre un documento de WonderfulOS en LibreOffice y guarda en WonderfulOS cada cambio. */
export async function openInOffice(nubeosPath, theme) {
  const soffice = sofficePath();
  if (!soffice) return { missing: true };
  const node = nodeOf(nubeosPath);
  if (!node) throw new Error('No existe ese archivo');
  // Copia de trabajo con su nombre (LibreOffice necesita un archivo con extensión).
  const work = path.join(ctx.dataDir, 'abiertos', String(Date.now()));
  mkdirSync(work, { recursive: true });
  const file = path.join(work, path.basename(nubeosPath));
  if (node.blob) copyFileSync(ctx.store.blobPath(node.blob), file);
  else writeFileSync(file, node.content || '');
  let last = statSync(file).mtimeMs;
  const watcher = watch(work, () => {
    let st;
    try { st = statSync(file); } catch { return; }
    if (st.mtimeMs === last || st.size === 0) return;
    last = st.mtimeMs;
    try { importFile(file, nubeosPath, { replace: true }); ctx.send('nubeos:notice', { kind: 'saved', path: nubeosPath }); }
    catch (e) { ctx.send('nubeos:notice', { kind: 'download-error', name: path.basename(nubeosPath), error: e.message }); }
  });
  const p = spawn(soffice, [`-env:UserInstallation=${officeProfile(theme)}`, '--nologo', file], { stdio: 'ignore', detached: true });
  p.on('exit', () => setTimeout(() => watcher.close(), 5000));
  p.unref();
  return { ok: true };
}

// Copia real (con su nombre) de un archivo de WonderfulOS, para que el sistema pueda usarlo.
export function realCopy(nubeosPath) {
  const node = nodeOf(nubeosPath);
  if (!node || node.type !== 'file') throw new Error('No existe ese archivo');
  const dir = path.join(ctx.dataDir, 'abrir', String(node.mtime || Date.now()));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(nubeosPath));
  if (!existsSync(file)) {
    if (node.blob) copyFileSync(ctx.store.blobPath(node.blob), file);
    else writeFileSync(file, node.content || '');
  }
  return file;
}
/** Abre o ejecuta un archivo con el programa del sistema (instaladores, programas, lo que sea). */
export async function openWithSystem(nubeosPath) {
  const file = realCopy(nubeosPath);
  if (process.platform === 'linux' && /\.(appimage|deb|flatpakref|flatpak)$/i.test(file)) return openLinuxApp(file);
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
  return { ok: true };
}
// En Linux (WonderfulOS como sistema del PC) las apps de Linux se ejecutan o instalan directamente.
async function openLinuxApp(file) {
  const ext = file.split('.').pop().toLowerCase();
  if (ext === 'appimage') {
    const { chmodSync } = await import('node:fs');
    chmodSync(file, 0o755);
    spawn(file, [], { stdio: 'ignore', detached: true, cwd: path.dirname(file) }).unref();
    return { ok: true };
  }
  ctx.send('nubeos:notice', { kind: 'linux', text: `Instalando ${path.basename(file)}…` });
  if (ext === 'deb') await run('pkexec', ['apt-get', 'install', '-y', file], { timeout: 1800000 });
  else await run('flatpak', ['install', '-y', '--user', file], { timeout: 1800000 });
  ctx.send('nubeos:notice', { kind: 'linux', text: `${path.basename(file)} instalado. Lo tienes en la Tienda › Instalados.` });
  return { ok: true };
}
export function reveal(nubeosPath) { shell.showItemInFolder(realCopy(nubeosPath)); }

// ---------- Tienda: programas del sistema ----------
const brew = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => existsSync(b));
export async function searchApps(q) {
  q = String(q || '').trim();
  if (!q) return [];
  if (MAC) {
    if (!brew()) return [];
    const { stdout } = await run(brew(), ['search', '--cask', q], { timeout: 60000 }).catch(() => ({ stdout: '' }));
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('==>')).slice(0, 24).map((id) => ({ id, name: id }));
  }
  if (WIN) {
    const { stdout } = await run('winget', ['search', q, '--source', 'winget', '--accept-source-agreements'], { timeout: 60000 }).catch(() => ({ stdout: '' }));
    return stdout.split('\n').slice(2).map((l) => l.trim().split(/\s{2,}/)).filter((c) => c.length >= 2).slice(0, 24).map(([name, id]) => ({ id, name }));
  }
  const r = await fetch('https://flathub.org/api/v2/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, filters: [] }) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return (d.hits || []).slice(0, 24).map((h) => ({ id: h.app_id, name: h.name, summary: h.summary, icon: h.icon }));
}
export async function installedApps() {
  if (MAC) {
    if (!brew()) return [];
    const { stdout } = await run(brew(), ['list', '--cask'], { timeout: 60000 }).catch(() => ({ stdout: '' }));
    return stdout.split('\n').filter(Boolean).map((id) => ({ id, name: id }));
  }
  if (WIN) return []; // winget no distingue bien lo instalado por WonderfulOS; se muestran los de la búsqueda
  const { stdout } = await run('flatpak', ['list', '--app', '--columns=application,name']).catch(() => ({ stdout: '' }));
  return stdout.split('\n').filter(Boolean).map((l) => { const [id, name] = l.split('\t'); return { id, name: name || id }; });
}
const SAFE = /^[A-Za-z0-9_.+@-]{2,120}$/;
export async function installApp(id) {
  if (!SAFE.test(String(id))) throw new Error('Programa no válido');
  if (MAC) { if (!brew()) throw new Error('Para instalar programas en el Mac hace falta Homebrew (brew.sh)'); await run(brew(), ['install', '--cask', id], { timeout: 1800000 }); }
  else if (WIN) await run('winget', ['install', '-e', '--id', id, '--accept-package-agreements', '--accept-source-agreements'], { timeout: 1800000 });
  else await run('flatpak', ['install', '-y', '--user', 'flathub', id], { timeout: 1800000 });
  return { ok: true };
}
export async function uninstallApp(id) {
  if (!SAFE.test(String(id))) throw new Error('Programa no válido');
  if (MAC) await run(brew(), ['uninstall', '--cask', id], { timeout: 600000 });
  else if (WIN) await run('winget', ['uninstall', '-e', '--id', id], { timeout: 600000 });
  else await run('flatpak', ['uninstall', '-y', '--user', id], { timeout: 600000 });
  return { ok: true };
}
export async function openApp(id) {
  if (!SAFE.test(String(id))) throw new Error('Programa no válido');
  if (MAC) {
    // El nombre de la app instalada sale de la información de Homebrew.
    const { stdout } = await run(brew(), ['info', '--cask', '--json=v2', id]).catch(() => ({ stdout: '{}' }));
    const app = JSON.parse(stdout).casks?.[0]?.artifacts?.flatMap((a) => a.app || []).find((a) => typeof a === 'string');
    if (app) return shell.openPath(path.join('/Applications', app));
    throw new Error('No encuentro cómo abrir este programa');
  }
  if (WIN) return shell.openExternal(`shell:AppsFolder`);
  spawn('flatpak', ['run', id], { stdio: 'ignore', detached: true }).unref();
  return { ok: true };
}
