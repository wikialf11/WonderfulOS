// Escritorio de WonderfulOS en la nube: barra superior, dock, Launchpad, buscador,
// Centro de control y notificaciones. Las apps de oficina funcionan en el
// navegador del usuario; los archivos viven en su cuenta (server/api.mjs).
import { createWindow, allWindows, focusedWindow, onWindowsChange, toggleOverview, closeOverview } from './shell/wm.js';
import { ICONS, GLYPHS, fileIcon } from './shell/icons.js';
import { settings, ACCENTS } from './shell/settings.js';
import { fs, extname, basename, initFs, isCloud, refreshShares } from './fs.js';
import { createEvaluator, formatValue } from './apps/formulas.js';
import { showLogin, logout, currentUser } from './login.js';
import { api } from './api.js';
import { humanSize } from './util.js';
import archivos from './apps/archivos.js';
import { texto, calculo, diapositivas } from './apps/office.js';
import ajustes from './apps/ajustes.js';
import visor from './apps/visor.js';
import listas from './apps/listas.js';
import notas from './apps/notas.js';
import calendario from './apps/calendario.js';
import mensajes, { unread, chatName } from './apps/mensajes.js';
import { cloud } from './cloud.js';
import navegador from './apps/navegador.js';
import llavero from './apps/llavero.js';
import { keychain, hostOf } from './keychain.js';
import { startDownload, resumeDownloads } from './downloads.js';
import { refreshProxyToken } from './proxy.js';

settings.apply();
// En el móvil (pantalla estrecha o táctil pequeña) WonderfulOS se ve como un teléfono:
// pantalla de inicio con iconos, apps a pantalla completa y barra de inicio abajo.
const mobileQuery = matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 1024px) and (orientation: portrait)');
const isMobile = () => mobileQuery.matches;
document.body.classList.toggle('mobile', isMobile());
if ((await initFs()) === 'login') {
  await showLogin();
  await new Promise(() => {}); // el escritorio arranca tras iniciar sesión (recarga la página)
}

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Apps ----------
// Solo apps de trabajo (decisión del usuario): sin Fotos, Tienda ni Recordatorios.
const APPS = [navegador, archivos, listas, mensajes, notas, calendario, llavero, texto, calculo, diapositivas, ajustes, visor];
const VISIBLE = APPS.filter((a) => !a.hidden);
const appById = (id) => APPS.find((a) => a.id === id);
const iconOf = (id) => ICONS[id] || ICONS.app;

// Cuenta: plan y espacio ocupado (se refresca al cambiar archivos).
const account = { user: null, info: null, listeners: new Set() };
async function refreshAccount() {
  if (!isCloud()) return null;
  try { account.info = await api('account'); account.listeners.forEach((fn) => fn(account.info)); } catch { /* sin conexión */ }
  return account.info;
}

const ctx = {
  fs,
  apps: VISIBLE,
  notify,
  account,
  refreshAccount,
  logout,
  // Cada ventana sabe de qué app es: así el dock muestra el punto y minimiza hacia su icono.
  createWindow(opts) {
    const app = currentLaunch || {};
    const win = createWindow({ ...opts, appId: app.id, icon: '' });
    if (isMobile()) {
      win.el.classList.add('maximized');
      // En el móvil, el botón de cerrar es una flecha «atrás» a la izquierda.
      const close = win.el.querySelector('.close');
      close.innerHTML = GLYPHS.back;
      close.title = 'Atrás';
      win.el.querySelector('.titlebar').prepend(close);
    }
    return win;
  },
  launch(id, arg) { launch(id, arg); },
  windows: () => allWindows(),
  openFile(path) {
    const node = fs.stat(path);
    if (!node) return;
    if (node.blob && visor.canShow(path, node)) return launch('visor', path);
    const app = APPS.find((a) => a.extensions?.includes(extname(path)));
    if (app) return launch(app.id, path);
    // Apps de Linux (.AppImage, .deb, Flatpak) en el Mac: se abren con el motor Linux de WonderfulOS.
    if (window.nubeosDesktop?.linux && /\.(appimage|deb|flatpakref|flatpak)$/i.test(path) && desktopPlatform === 'darwin') return openLinuxFile(path);
    // WonderfulOS instalado: todo lo demás (programas, instaladores, zip…) lo abre el sistema del ordenador.
    if (window.nubeosDesktop?.openWithSystem) return window.nubeosDesktop.openWithSystem(path).catch((e) => notify(e.message, 7000, { title: 'Abrir', icon: 'archivos' }));
    notify(`WonderfulOS todavía no abre «${basename(path)}». Puedes descargarlo a tu ordenador.`, 7000, {
      title: 'Abrir archivo', icon: 'archivos',
      action: { label: 'Descargar', run: () => fs.downloadToComputer(path) },
    });
  },
  menu: (items, x, y) => showMenu(items, x, y),
  download: (opts) => startDownload(ctx, opts),
};

let currentLaunch = null;
function launch(id, arg) {
  const app = appById(id);
  if (!app) return;
  closeOverlays();
  if (isMobile()) allWindows().filter((w) => !w.minimized).forEach((w) => w.minimize()); // una app a la vez
  const dockItem = document.querySelector(`.dock-item[data-app="${id}"]`);
  dockItem?.classList.add('bounce');
  setTimeout(() => dockItem?.classList.remove('bounce'), 1400);
  currentLaunch = app;
  try { app.launch(ctx, arg); } finally { currentLaunch = null; }
}
// Clic en el dock: si ya hay ventanas de la app, las trae al frente.
function activate(id) {
  if (isMobile()) allWindows().filter((w) => w.appId !== id && !w.minimized).forEach((w) => w.minimize());
  const mine = allWindows().filter((w) => w.appId === id);
  if (!mine.length) return launch(id);
  const top = mine.find((w) => !w.minimized) || mine[0];
  if (top.el.classList.contains('focused') && !top.minimized) return top.minimize();
  top.focus();
}

// ---------- Notificaciones ----------
function notify(text, ms = 4000, { title = 'WonderfulOS', icon = 'logo', action } = {}) {
  if (settings.get().focus && !action) return;
  const t = document.createElement('div');
  t.className = 'toast glass-panel';
  t.innerHTML = `<div class="ic">${iconOf(icon)}</div><div style="flex:1"><strong>${esc(title)}</strong><span>${esc(text)}</span>${action ? '<div style="margin-top:8px"><button class="btn primary"></button></div>' : ''}</div>`;
  if (action) {
    const b = t.querySelector('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); t.remove(); };
  }
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Barra superior ----------
function renderMenubar() {
  const w = focusedWindow();
  const app = w ? appById(w.appId) : null;
  $('#menubar').innerHTML = `
    <button class="logo" data-menu="system" title="WonderfulOS">${GLYPHS.logo}</button>
    <button class="app-name" data-menu="app">${esc(app ? app.name : 'Escritorio')}</button>
    <button data-menu="window">Ventana</button>
    <span class="spacer"></span>
    <button data-action="search" title="Buscar (Ctrl+Espacio)">${GLYPHS.search}</button>
    <button data-action="control" title="Centro de control">${GLYPHS.sliders}</button>
    ${account.user && !window.nubeosDesktop ? `<button data-menu="user" title="Tu cuenta">${GLYPHS.user}<span>${esc(account.user)}</span></button>` : ''}
    <button class="clock" data-action="control"></button>`;
  tick();
  $('#menubar').querySelectorAll('[data-menu]').forEach((b) => { b.onclick = (e) => openMenu(b, b.dataset.menu, e); });
  $('#menubar').querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); b.dataset.action === 'search' ? toggleSpotlight() : toggleControl(); };
  });
}
function tick() {
  const el = $('#menubar .clock');
  if (el) el.textContent = isMobile()
    ? new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- Menús ----------
let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl = null; document.querySelectorAll('#menubar .open').forEach((b) => b.classList.remove('open')); }
function showMenu(items, x, y, anchor) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu glass-panel pop';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.innerHTML = `<span>${esc(it.label)}</span>${it.keys ? `<small>${esc(it.keys)}</small>` : ''}`;
    b.disabled = !!it.disabled;
    if (it.disabled) b.style.opacity = '.4';
    b.onclick = () => { closeMenu(); it.run?.(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  openMenuEl = m;
  anchor?.classList.add('open');
}
function openMenu(btn, kind, e) {
  e.stopPropagation();
  if (btn.classList.contains('open')) return closeMenu();
  const r = btn.getBoundingClientRect();
  const w = focusedWindow();
  const menus = {
    system: [
      { label: 'Acerca de WonderfulOS', run: () => launch('ajustes', 'acerca') },
      '-',
      { label: 'Ajustes…', run: () => launch('ajustes') },
      { label: 'Launchpad', keys: 'F4', run: toggleLaunchpad },
      // WonderfulOS como sistema del PC: instalar (desde el USB), reiniciar y apagar.
      ...(desktopSystem.session ? ['-', ...(desktopSystem.live ? [{ label: 'Instalar WonderfulOS en este ordenador…', run: () => window.nubeosDesktop.installSystem() }] : []),
        { label: 'Reiniciar', run: () => window.nubeosDesktop.power('reboot') }, { label: 'Apagar', run: () => window.nubeosDesktop.power('poweroff') }]
        : window.nubeosDesktop ? ['-', { label: 'Salir de WonderfulOS', run: () => window.nubeosDesktop.quit() }]
        : isCloud() ? ['-', { label: 'Cerrar sesión', run: logout }] : []),
    ],
    app: [
      { label: w ? 'Nueva ventana' : 'Abrir Archivos', run: () => launch(w?.appId || 'archivos') },
      { label: 'Cerrar ventana', disabled: !w, run: () => w?.close() },
    ],
    window: [
      { label: 'Minimizar', disabled: !w, run: () => w?.minimize() },
      { label: 'Maximizar', disabled: !w, run: () => w?.toggleMaximize() },
      '-',
      { label: 'Todas las ventanas', keys: 'F3', run: toggleOverview },
    ],
    user: [
      { label: 'Cuenta y espacio…', run: () => launch('ajustes', 'cuenta') },
      { label: 'Compartido conmigo', run: () => launch('archivos', '/Compartido conmigo') },
      '-',
      { label: 'Cerrar sesión', run: logout },
    ],
  };
  showMenu(menus[kind], kind === 'user' ? r.right - 220 : r.left, r.bottom + 6, btn);
}

// ---------- Dock (con efecto lupa) ----------
const DOCK = ['launchpad', 'navegador', 'archivos', 'mensajes', 'listas', 'notas', 'calendario', 'texto', 'calculo', 'diapositivas', 'llavero', 'ajustes'];
const MOBILE_DOCK = ['navegador', 'archivos', 'mensajes', 'listas'];
function renderDock() {
  const dock = $('#dock');
  dock.innerHTML = '';
  for (const id of isMobile() ? MOBILE_DOCK : DOCK) {
    const app = appById(id);
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.setAttribute('aria-label', app ? app.name : 'Launchpad');
    b.dataset.app = id;
    b.innerHTML = `${iconOf(id)}<span class="dot"></span><span class="tip">${esc(app ? app.name : 'Launchpad')}</span>`;
    b.onclick = () => (id === 'launchpad' ? toggleLaunchpad() : activate(id));
    dock.appendChild(b);
  }
  updateRunning();
}
function updateRunning() {
  const running = new Set(allWindows().map((w) => w.appId));
  document.querySelectorAll('.dock-item[data-app]').forEach((b) => b.classList.toggle('running', running.has(b.dataset.app)));
}
$('#dock').addEventListener('mousemove', (e) => {
  const s = settings.get();
  if (!s.magnify || s.reduceMotion || isMobile()) return;
  for (const item of document.querySelectorAll('.dock-item')) {
    const r = item.getBoundingClientRect();
    const d = Math.abs(e.clientX - (r.left + r.width / 2));
    const size = s.dockSize + Math.max(0, 1 - d / 160) * s.dockSize * 0.55;
    item.style.width = item.style.height = `${size}px`;
  }
});
$('#dock').addEventListener('mouseleave', () => {
  document.querySelectorAll('.dock-item').forEach((i) => { i.style.width = i.style.height = ''; });
});

// ---------- Launchpad ----------
function toggleLaunchpad(force) {
  const lp = $('#launchpad');
  const show = force ?? lp.hidden;
  closeOverlays();
  if (!show) return;
  lp.hidden = false;
  lp.innerHTML = '<input placeholder="Buscar apps" autocomplete="off"><div class="grid"></div>';
  const grid = lp.querySelector('.grid');
  const draw = (q = '') => {
    grid.innerHTML = '';
    VISIBLE.filter((a) => (a.name + a.description).toLowerCase().includes(q.toLowerCase())).forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'app';
      b.style.animationDelay = `${i * 25}ms`;
      b.innerHTML = `${iconOf(a.id)}<span>${esc(a.name)}</span>`;
      b.onclick = (e) => { e.stopPropagation(); launch(a.id); };
      grid.appendChild(b);
    });
  };
  const input = lp.querySelector('input');
  input.oninput = () => draw(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') grid.querySelector('.app')?.click(); };
  lp.onclick = (e) => { if (e.target === lp || e.target === grid) toggleLaunchpad(false); };
  draw();
  input.focus();
}

// ---------- Buscador universal ----------
function toggleSpotlight(force) {
  const sp = $('#spotlight');
  const show = force ?? sp.hidden;
  closeOverlays();
  if (!show) return;
  sp.hidden = false;
  sp.classList.add('pop');
  sp.innerHTML = `<div class="input">${GLYPHS.search}<input placeholder="Buscar apps, archivos o hacer un cálculo…" autocomplete="off"></div><div class="results"></div>`;
  const input = sp.querySelector('input');
  const box = sp.querySelector('.results');
  let items = [], sel = 0;
  const draw = () => {
    const q = input.value.trim();
    items = [];
    box.innerHTML = '';
    if (!q) return;
    const ql = q.toLowerCase();
    // Calculadora: "12*3+4" → 40
    if (/^[\d\s+\-*/().,%^]+$/.test(q) && /\d/.test(q)) {
      const v = createEvaluator({ A1: `=${q.replace(/,/g, '.')}` }).value('A1');
      if (typeof v === 'number') items.push({ group: 'Calculadora', svg: ICONS.calculo, label: `= ${formatValue(v)}`, hint: 'Enter para copiar', run: () => navigator.clipboard?.writeText(formatValue(v)) });
    }
    for (const a of VISIBLE.filter((x) => (x.name + ' ' + (x.description || '')).toLowerCase().includes(ql))) {
      items.push({ group: 'Apps', svg: iconOf(a.id), label: a.name, hint: a.description, run: () => launch(a.id) });
    }
    const files = fs.find(() => true).filter((p) => basename(p).toLowerCase().includes(ql) && !p.includes('/.')).slice(0, 8);
    for (const p of files) {
      const dir = fs.isDir(p);
      items.push({ group: 'Archivos', svg: fileIcon(p, dir), label: basename(p), hint: p, run: () => (dir ? launch('archivos', p) : ctx.openFile(p)) });
    }
    if (items.length === 0) items.push({ group: 'Sin resultados', svg: ICONS.buscar, label: `Nada coincide con «${q}»`, run: () => {} });
    let lastGroup = '';
    items.forEach((it, i) => {
      if (it.group !== lastGroup) { box.insertAdjacentHTML('beforeend', `<div class="group">${esc(it.group)}</div>`); lastGroup = it.group; }
      const row = document.createElement('div');
      row.className = `item${i === sel ? ' sel' : ''}`;
      row.innerHTML = `<span class="ic">${it.svg}</span><span>${esc(it.label)}</span><small>${esc(it.hint || '')}</small>`;
      row.onmouseenter = () => { sel = i; box.querySelectorAll('.item').forEach((r, j) => r.classList.toggle('sel', j === sel)); };
      row.onclick = () => { closeOverlays(); it.run(); };
      box.appendChild(row);
    });
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
      box.querySelectorAll('.item').forEach((r, j) => r.classList.toggle('sel', j === sel));
    }
    if (e.key === 'Enter' && items[sel]) { const it = items[sel]; closeOverlays(); it.run(); }
  };
  input.focus();
}

// ---------- Centro de control ----------
function toggleControl(force) {
  const cc = $('#control');
  const show = force ?? cc.hidden;
  closeOverlays();
  if (!show) return;
  cc.hidden = false;
  cc.classList.add('pop');
  const draw = () => {
    const s = settings.get();
    const dark = settings.isDark(s);
    const toggle = (key, on, icon, label, hint) => `<div class="tile"><button class="toggle ${on ? 'on' : ''}" data-t="${key}"><span class="ic">${icon}</span><span>${label}<small>${hint}</small></span></button></div>`;
    const a = account.info;
    const pct = a ? Math.min(100, (a.used / a.quota) * 100) : 0;
    cc.innerHTML = `
      ${toggle('dark', dark, GLYPHS.moon, 'Modo oscuro', dark ? 'Activado' : 'Desactivado')}
      ${toggle('night', s.night, GLYPHS.flame, 'Luz nocturna', s.night ? 'Activada' : 'Desactivada')}
      ${toggle('focus', s.focus, GLYPHS.bell, 'Concentración', s.focus ? 'Sin avisos' : 'Avisos activos')}
      <div class="tile"><button class="toggle" data-t="overview"><span class="ic">${GLYPHS.grid}</span><span>Ventanas<small>Ver todas (F3)</small></span></button></div>
      ${a ? `<div class="tile wide"><label>Almacenamiento</label><div class="storage" style="padding:0"><div class="bar${pct > 90 ? ' full' : ''}"><span style="width:${pct}%"></span></div>${humanSize(a.used)} de ${humanSize(a.quota)}</div></div>` : ''}
      <div class="tile wide"><label>Pantalla</label><input type="range" min="0" max="60" value="${Math.round((0.6 - s.dim) * 100)}" data-r="brightness"></div>
      <div class="tile wide"><label>Color de acento</label><div class="swatches">${ACCENTS.map((c) => `<button class="swatch ${c === s.accent ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>`;
    cc.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'dark') settings.set({ theme: settings.isDark() ? 'light' : 'dark' });
        if (t === 'night') settings.set({ night: !settings.get().night });
        if (t === 'focus') settings.set({ focus: !settings.get().focus });
        if (t === 'overview') { closeOverlays(); return toggleOverview(); }
        draw();
      };
    });
    cc.querySelector('[data-r]').oninput = (e) => settings.set({ dim: +(0.6 - e.target.value / 100).toFixed(2) });
    cc.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { settings.set({ accent: b.dataset.c }); draw(); }; });
  };
  draw();
}

function closeOverlays() {
  closeMenu();
  $('#launchpad').hidden = true;
  $('#spotlight').hidden = true;
  $('#control').hidden = true;
}

// ---------- Teclado y ratón ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey || e.altKey) && e.code === 'Space') { e.preventDefault(); e.stopPropagation(); toggleSpotlight(); }
  else if (e.key === 'F4') { e.preventDefault(); toggleLaunchpad(); }
  else if (e.key === 'F3') { e.preventDefault(); toggleOverview(); }
  else if (e.key === 'Escape') { closeOverlays(); closeOverview(); }
}, true); // en captura: los atajos del sistema funcionan aunque una app tenga el foco
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.menu, #spotlight, #control, #menubar, #launchpad')) closeOverlays();
});
$('#screen').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showMenu([
    { label: 'Nuevo documento', run: () => launch('texto') },
    { label: 'Nueva hoja de cálculo', run: () => launch('calculo') },
    { label: 'Nueva presentación', run: () => launch('diapositivas') },
    '-',
    { label: 'Cambiar fondo de pantalla…', run: () => launch('ajustes', 'fondo') },
    { label: 'Todas las ventanas', keys: 'F3', run: toggleOverview },
  ], e.clientX, e.clientY);
});
// Rectángulo de selección al arrastrar sobre el fondo del escritorio.
$('#screen').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const band = document.createElement('div');
  band.className = 'rubber-band';
  const x0 = ev.clientX, y0 = ev.clientY;
  const move = (m) => {
    if (!band.isConnected) $('#screen').appendChild(band);
    Object.assign(band.style, { left: `${Math.min(x0, m.clientX)}px`, top: `${Math.min(y0, m.clientY)}px`, width: `${Math.abs(m.clientX - x0)}px`, height: `${Math.abs(m.clientY - y0)}px` });
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); band.remove(); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
});
// Soltar archivos del ordenador sobre el escritorio: se suben a Documentos.
$('#screen').addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
$('#screen').addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  launch('archivos', { dir: '/Documentos', upload: [...e.dataTransfer.files] });
});

// ---------- WonderfulOS instalado en el ordenador ----------
let desktopPlatform = '';
let desktopSystem = {}; // { session, live } cuando WonderfulOS es el sistema del PC
/** Ventana de WonderfulOS con una app de Linux (sesión de Xpra del motor Linux). */
export function openLinuxWindow(url, title) {
  launchWith('archivos', () => {
    const win = ctx.createWindow({ title, width: 1100, height: 720 });
    // <webview> (no iframe): Xpra no deja que lo enmarquen otras páginas.
    win.body.innerHTML = `<webview src="${esc(url)}" partition="linux" style="flex:1;width:100%;background:#111"></webview>`;
    const view = win.body.querySelector('webview');
    view.addEventListener('dom-ready', () => view.insertCSS('body,#screen{background:#14161f!important}.windowhead{display:none!important}'));
    // La app de Linux es la ventana: la de WonderfulOS toma su tamaño y su título, la app la
    // llena entera (sin ventana dentro de otra) y, si la app se cierra, se cierra la ventana.
    let seen = false, sized = false, empty = 0, connected = false;
    const timer = setInterval(async () => {
      const r = await view.executeJavaScript(`(() => {
        const ws = Object.values(window.client?.id_to_window || {});
        const main = ws.filter((w) => !w.windowtype || w.windowtype.includes('NORMAL'));
        for (const w of main) if (!w.maximized) w.set_maximized(true);
        const w = main[0];
        return { n: ws.length, up: !!window.client?.connected, title: w?.title || '', w: w?.saved_geometry?.w || w?.w || 0, h: w?.saved_geometry?.h || w?.h || 0 };
      })()`).catch(() => null);
      if (!r) return;
      // Se cierra cuando la app termina de verdad o tras 40 s sin ventanas (algunas tardan en cargar).
      if (r.up) connected = true;
      if (r.n) { seen = true; empty = 0; }
      if ((connected && !r.up) || (seen && !r.n && ++empty >= 57)) { clearInterval(timer); win.close(); return; }
      if (r.title) win.setTitle(r.title);
      if (!sized && r.w > 100 && r.h > 100 && !win.el.classList.contains('maximized')) {
        sized = true;
        Object.assign(win.el.style, { width: `${Math.min(r.w, innerWidth - 40)}px`, height: `${Math.min(r.h + 40, innerHeight - 140)}px` });
      }
    }, 700);
    win.onClose(() => { clearInterval(timer); return true; });
  });
}
function launchWith(appId, fn) { currentLaunch = appById(appId); try { fn(); } finally { currentLaunch = null; } }
ctx.openLinuxWindow = openLinuxWindow;
async function openLinuxFile(path) {
  const name = path.split('/').pop();
  notify(`Abriendo ${name} con el motor Linux… la primera vez tarda unos minutos.`, 6000, { title: 'Apps de Linux', icon: 'tienda' });
  try {
    const r = await window.nubeosDesktop.linux.openFile(path);
    if (r.url) openLinuxWindow(r.url, name);
    else notify(`${name} instalado. Lo tienes en Tienda › Apps de Linux.`, 6000, { title: 'Apps de Linux', icon: 'tienda' });
  } catch (e) { notify(e.message, 8000, { title: 'Apps de Linux', icon: 'tienda' }); }
}
if (window.nubeosDesktop) {
  window.nubeosDesktop.info().then((i) => { desktopPlatform = i.platform; desktopSystem = { session: i.session, live: i.live };
    if (i.live) notify('Estás probando WonderfulOS desde el USB. Para quedártelo, abre el menú de WonderfulOS › «Instalar WonderfulOS en este ordenador»: puedes conservar Windows y elegir al encender.', 15000, { title: 'Bienvenido a WonderfulOS', icon: 'ajustes' });
  });
  document.body.classList.add('desktop-app');
  window.nubeosDesktop.onOpenUrl((url) => launch('navegador', url));
  window.nubeosDesktop.onNotice((n) => {
    if (n.kind === 'saved') return fs.reload().catch(() => {}); // guardado desde LibreOffice
    if (n.kind === 'download') {
      fs.reload().then(() => refreshAccount()).catch(() => {});
      return notify(`${n.path.split('/').pop()} está en Archivos › Descargas.`, 8000, { title: 'Descarga terminada', icon: 'navegador', action: { label: 'Abrir', run: () => ctx.openFile(n.path) } });
    }
    if (n.kind === 'download-error') return notify(`${n.name}: ${n.error}`, 10000, { title: 'No se pudo guardar', icon: 'navegador' });
    if (n.kind === 'linux') return notify(n.text, 7000, { title: 'WonderfulOS', icon: 'ajustes' });
  });
}

// ---------- Llavero: guardar lo que inicias en el Navegador ----------
async function offerToSave(n) {
  await keychain.init().catch(() => {});
  const site = hostOf(n.url);
  if (!keychain.isSetUp()) return; // sin Llavero creado no molestamos
  if (keychain.isUnlocked()) {
    const same = keychain.matching(n.url).find((e) => e.user === n.user);
    if (same && same.pass === n.pass) return; // ya la tienes
    notify(`${n.user || 'Tu cuenta'} en ${site}`, 12000, {
      title: same ? '¿Actualizar la contraseña?' : '¿Guardar la contraseña?', icon: 'llavero',
      action: { label: same ? 'Actualizar' : 'Guardar', run: () => keychain.save({ id: same?.id, name: same?.name || site, site, user: n.user, pass: n.pass, notes: same?.notes })
        .then(() => notify(`Guardada en el Llavero.`, 3000, { title: site, icon: 'llavero' })).catch((e) => notify(e.message)) },
    });
  } else {
    notify(`${n.user || 'Tu cuenta'} en ${site}`, 12000, { title: '¿Guardar la contraseña?', icon: 'llavero',
      action: { label: 'Guardar…', run: () => launch('llavero', { new: { site, name: site, user: n.user, pass: n.pass } }) } });
  }
}

// ---------- Móvil: pantalla de inicio y barra de inicio ----------
function renderHome() {
  const home = $('#home');
  if (!isMobile()) { home.innerHTML = ''; return; }
  const t = new Date();
  home.innerHTML = `<div class="home-clock"><strong>${t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</strong><span>${t.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div><div class="home-grid"></div>`;
  const grid = home.querySelector('.home-grid');
  VISIBLE.filter((a) => !MOBILE_DOCK.includes(a.id)).forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'home-app';
    b.style.animationDelay = `${i * 20}ms`;
    b.innerHTML = `${iconOf(a.id)}<span>${esc(a.name)}</span>`;
    b.onclick = () => activate(a.id);
    grid.appendChild(b);
  });
}
const updateMobile = () => {
  const open = isMobile() && allWindows().some((w) => !w.minimized);
  document.body.classList.toggle('app-open', open);
};
$('#home-bar').onclick = () => allWindows().forEach((w) => !w.minimized && w.minimize());
mobileQuery.addEventListener('change', () => { document.body.classList.toggle('mobile', isMobile()); renderDock(); renderHome(); renderMenubar(); updateMobile(); });

// ---------- Arranque ----------
onWindowsChange(() => { renderMenubar(); updateRunning(); updateMobile(); });
settings.onChange(() => renderDock());
fs.onError((msg) => notify(msg, 7000, { title: 'No se pudo guardar', icon: 'archivos' }));

if (isCloud()) {
  account.user = await currentUser();
  if (account.user && settings.get().userName !== account.user) settings.set({ userName: account.user });
  await refreshAccount();
  let t;
  fs.onChange(() => { clearTimeout(t); t = setTimeout(refreshAccount, 1500); });
  // Avisamos cuando alguien comparte algo contigo.
  setInterval(async () => {
    try {
      for (const s of await refreshShares()) {
        if (s.kind === 'app') continue;
        notify(`${s.owner} ha compartido contigo «${s.path.split('/').pop()}».`, 8000, {
          title: 'Nuevo compartido', icon: 'archivos',
          action: { label: 'Ver', run: () => launch('archivos', '/Compartido conmigo') },
        });
      }
    } catch { /* sin conexión: se reintenta */ }
  }, 10000);

  // Navegador: ficha para el proxy (caduca, se renueva) y descargas que seguían en curso.
  await refreshProxyToken();
  setInterval(refreshProxyToken, 3600e3);
  resumeDownloads(ctx);

  // Apps de la nube: avisos de mensajes nuevos, de recordatorios y de cosas compartidas.
  const NAMES = { listas: 'una lista', notas: 'una nota', calendario: 'un calendario', recordatorios: 'una lista de recordatorios', mensajes: 'una conversación' };
  cloud.onNotice((n) => {
    // Algo descargado con el Navegador ya está en tu nube.
    // Has iniciado sesión en una web desde el Navegador: ofrecer guardarla en el Llavero.
    if (n.kind === 'login') return offerToSave(n);
    if (n.kind === 'download') {
      fs.reload().then(() => refreshAccount()).catch(() => {});
      return notify(`${n.path.split('/').pop()} está en Archivos › Descargas.`, 8000, { title: 'Descarga terminada', icon: 'navegador', action: { label: 'Abrir', run: () => ctx.openFile(n.path) } });
    }
    if (n.kind === 'download-error') return notify(`${n.name}: ${n.error}`, 10000, { title: 'No se pudo guardar la descarga', icon: 'navegador', action: { label: 'Ver mi espacio', run: () => launch('ajustes', 'cuenta') } });
    if (n.app === 'mensajes') return;
    notify(`${n.from} ha compartido contigo ${NAMES[n.app] || 'algo'}${n.title ? ` «${n.title}»` : ''}.`, 8000, { title: 'Compartido contigo', icon: n.app, action: { label: 'Abrir', run: () => launch(n.app) } });
  });
  const seenMsg = new Map();
  const badge = () => {
    const n = cloud.docs('mensajes').reduce((s, d) => s + unread(d, account.user), 0);
    const item = document.querySelector('.dock-item[data-app="mensajes"]');
    if (!item) return;
    item.querySelector('.count')?.remove();
    if (n) item.insertAdjacentHTML('beforeend', `<span class="count">${n > 99 ? '99+' : n}</span>`);
  };
  cloud.load('mensajes').then((docs) => {
    for (const d of docs) seenMsg.set(d.id, (d.data.messages || []).length);
    badge();
    cloud.subscribe('mensajes', (all) => {
      for (const d of all) {
        const msgs = d.data.messages || [];
        const before = seenMsg.get(d.id) ?? 0;
        seenMsg.set(d.id, msgs.length);
        const fresh = msgs.slice(before).filter((m) => m.from !== account.user);
        const chatOpen = allWindows().some((w) => w.appId === 'mensajes' && !w.minimized && w.el.classList.contains('focused'));
        if (fresh.length && !chatOpen) {
          const m = fresh.at(-1);
          notify(m.text, 7000, { title: `${m.from}${chatName(d, account.user) !== m.from ? ` · ${chatName(d, account.user)}` : ''}`, icon: 'mensajes', action: { label: 'Responder', run: () => launch('mensajes', d.id) } });
        }
      }
      badge();
    });
  }).catch(() => {});
}
renderMenubar();
renderDock();
renderHome();
setInterval(() => { tick(); if (isMobile() && !document.body.classList.contains('app-open')) renderHome(); }, 10000);

const pago = new URLSearchParams(location.search).get('pago');
if (pago) {
  history.replaceState(null, '', location.pathname);
  if (pago === 'ok') notify('Pago recibido. En unos segundos tendrás el espacio nuevo.', 8000, { title: '¡Gracias!' });
  else notify('Pago cancelado. No se ha cobrado nada.', 6000, { title: 'Pago' });
  setTimeout(refreshAccount, 4000);
}
if (!sessionStorage.getItem('nubeos.welcome')) {
  sessionStorage.setItem('nubeos.welcome', '1');
  setTimeout(() => notify(isCloud()
    ? 'Tus archivos se guardan en tu cuenta. Arrastra archivos de tu ordenador a la pantalla para subirlos.'
    : 'Modo local: tus archivos se guardan solo en este navegador.', 7000, { title: `Hola, ${settings.get().userName}` }), 600);
}
