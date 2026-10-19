// Escritorio de WonderfulOS: barra superior, dock, Launchpad, buscador universal,
// Centro de control, notificaciones y pantalla de bloqueo.
import { createWindow, allWindows, focusedWindow, onWindowsChange, toggleOverview, closeOverview } from './wm.js';
import { ICONS, GLYPHS, fileIcon } from './icons.js';
import { settings, ACCENTS } from './settings.js';
import ajustes from './apps/ajustes.js';
// Apps reutilizadas del prototipo anterior (funcionan en modo local, sin servidor).
import archivos from './apps/archivos.js';
import { fs, extname, initFs } from '../../web-desktop/js/fs.js';
import navegador from './apps/navegador.js';
import { createEvaluator, formatValue } from '../../web-desktop/js/apps/formulas.js';

settings.apply();
await initFs();

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Apps ----------
const APPS = [archivos, navegador, ajustes];
const appById = (id) => APPS.find((a) => a.id === id);
const iconOf = (id) => ICONS[id] || ICONS.app;

const ctx = {
  fs,
  apps: APPS,
  notify,
  // Cada ventana sabe de qué app es: así el dock muestra el punto y minimiza hacia su icono.
  createWindow(opts) {
    const app = currentLaunch || {};
    return createWindow({ ...opts, appId: app.id, icon: '' });
  },
  launch(id, arg) { launch(id, arg); },
  // En el sistema instalado, los archivos se abren con la app local que corresponda.
  openFile(path) {
    const app = APPS.find((a) => a.extensions?.includes(extname(path)));
    if (!app) return notify(`En el sistema instalado, «${path.split('/').pop()}» se abrirá con su app del equipo.`, 4000, { title: 'Abrir archivo', icon: 'archivos' });
    launch(app.id, path);
  },
  menu: (items, x, y) => showMenu(items, x, y),
  download() { throw new Error('Las descargas llegarán con la versión instalada'); },
};

let currentLaunch = null;
function launch(id, arg) {
  const app = appById(id);
  if (!app) return;
  closeOverlays();
  document.querySelector(`.dock-item[data-app="${id}"]`)?.classList.add('bounce');
  setTimeout(() => document.querySelector(`.dock-item[data-app="${id}"]`)?.classList.remove('bounce'), 1400);
  currentLaunch = app;
  try { app.launch(ctx, arg); } finally { currentLaunch = null; }
}
// Clic en el dock: si ya hay ventanas de la app, las trae al frente.
function activate(id) {
  const mine = allWindows().filter((w) => w.appId === id);
  if (!mine.length) return launch(id);
  const top = mine.find((w) => !w.minimized) || mine[0];
  if (top.el.classList.contains('focused') && !top.minimized) return top.minimize();
  top.focus();
}

// ---------- Notificaciones ----------
function notify(text, ms = 4000, { title = 'WonderfulOS', icon = 'app' } = {}) {
  if (settings.get().focus) return;
  const t = document.createElement('div');
  t.className = 'toast glass-panel';
  t.innerHTML = `<div class="ic">${iconOf(icon)}</div><div><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
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
    <button class="clock" data-action="control"></button>`;
  tick();
  $('#menubar').querySelectorAll('[data-menu]').forEach((b) => { b.onclick = (e) => openMenu(b, b.dataset.menu, e); });
  $('#menubar').querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); b.dataset.action === 'search' ? toggleSpotlight() : toggleControl(); };
  });
}
function tick() {
  const el = $('#menubar .clock');
  if (el) el.textContent = new Date().toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lockTime = $('#lock .time');
  if (lockTime) {
    const d = new Date();
    lockTime.textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    $('#lock .date').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }
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
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
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
      { label: 'Ajustes del sistema…', run: () => launch('ajustes') },
      { label: 'Launchpad', keys: 'F4', run: toggleLaunchpad },
      '-',
      { label: 'Bloquear pantalla', keys: 'Ctrl+L', run: lock },
    ],
    app: [
      { label: w ? 'Nueva ventana' : 'Abrir Archivos', run: () => launch(w?.appId || 'archivos') },
      { label: 'Cerrar ventana', keys: 'Ctrl+W', disabled: !w, run: () => w?.close() },
    ],
    window: [
      { label: 'Minimizar', disabled: !w, run: () => w?.minimize() },
      { label: 'Maximizar', disabled: !w, run: () => w?.toggleMaximize() },
      '-',
      { label: 'Todas las ventanas', keys: 'F3', run: toggleOverview },
    ],
  };
  showMenu(menus[kind], r.left, r.bottom + 6, btn);
}

// ---------- Dock (con efecto lupa) ----------
const DOCK = ['launchpad', 'archivos', 'navegador', 'ajustes'];
function renderDock() {
  const dock = $('#dock');
  dock.innerHTML = '';
  for (const id of DOCK) {
    const app = appById(id);
    const b = document.createElement('button');
    b.className = 'dock-item';
    b.dataset.app = id;
    b.innerHTML = `${iconOf(id)}<span class="dot"></span><span class="tip">${esc(app ? app.name : 'Launchpad')}</span>`;
    b.onclick = () => (id === 'launchpad' ? toggleLaunchpad() : activate(id));
    dock.appendChild(b);
  }
  dock.appendChild(Object.assign(document.createElement('span'), { className: 'dock-sep' }));
  const trash = document.createElement('button');
  trash.className = 'dock-item';
  trash.innerHTML = `${ICONS.papelera}<span class="tip">Papelera</span>`;
  trash.onclick = () => notify('La papelera está vacía.', 2500, { title: 'Papelera', icon: 'papelera' });
  dock.appendChild(trash);
  updateRunning();
}
function updateRunning() {
  const running = new Set(allWindows().map((w) => w.appId));
  document.querySelectorAll('.dock-item[data-app]').forEach((b) => b.classList.toggle('running', running.has(b.dataset.app)));
}
$('#dock').addEventListener('mousemove', (e) => {
  const s = settings.get();
  if (!s.magnify) return;
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
    APPS.filter((a) => (a.name + a.description).toLowerCase().includes(q.toLowerCase())).forEach((a, i) => {
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
  sp.innerHTML = `<div class="input">${GLYPHS.search}<input placeholder="Buscar en este equipo: apps, archivos, cálculos…" autocomplete="off"></div><div class="results"></div>`;
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
      if (typeof v === 'number') items.push({ group: 'Calculadora', svg: ICONS.app, label: `= ${formatValue(v)}`, hint: 'Enter para copiar', run: () => navigator.clipboard?.writeText(formatValue(v)) });
    }
    for (const a of APPS.filter((x) => (x.name + ' ' + (x.description || '')).toLowerCase().includes(ql))) {
      items.push({ group: 'Apps', svg: iconOf(a.id), label: a.name, hint: a.description, run: () => launch(a.id) });
    }
    const files = fs.find(() => true).filter((p) => p.split('/').pop().toLowerCase().includes(ql) && !p.includes('/.')).slice(0, 6);
    for (const p of files) {
      const dir = fs.isDir(p);
      items.push({ group: 'Archivos', svg: fileIcon(p, dir), label: p.split('/').pop(), hint: p, run: () => (dir ? launch('archivos', p) : ctx.openFile(p)) });
    }
    if (items.length === 0) items.push({ group: 'Sin resultados', svg: ICONS.buscar, label: `Nada en este equipo coincide con «${q}»`, run: () => {} });
    let lastGroup = '';
    items.forEach((it, i) => {
      if (it.group !== lastGroup) { box.insertAdjacentHTML('beforeend', `<div class="group">${esc(it.group)}</div>`); lastGroup = it.group; }
      const row = document.createElement('div');
      row.className = `item${i === sel ? ' sel' : ''}`;
      row.innerHTML = `<span class="ic">${it.svg || esc(it.icon)}</span><span>${esc(it.label)}</span><small>${esc(it.hint || '')}</small>`;
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
    cc.innerHTML = `
      ${toggle('dark', dark, GLYPHS.moon, 'Modo oscuro', dark ? 'Activado' : 'Desactivado')}
      ${toggle('night', s.night, GLYPHS.flame, 'Luz nocturna', s.night ? 'Activada' : 'Desactivada')}
      ${toggle('focus', s.focus, GLYPHS.bell, 'Concentración', s.focus ? 'Sin avisos' : 'Avisos activos')}
      <div class="tile"><button class="toggle" data-t="overview"><span class="ic">${GLYPHS.grid}</span><span>Ventanas<small>Ver todas (F3)</small></span></button></div>
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

// ---------- Pantalla de bloqueo ----------
function lock() {
  closeOverlays();
  const l = $('#lock');
  const name = settings.get().userName;
  l.innerHTML = `<div class="date"></div><div class="time"></div>
    <div class="user"><div class="avatar">${esc(name[0]?.toUpperCase() || 'U')}</div><div style="font-size:18px;font-weight:600">${esc(name)}</div>
    <div class="hint">Haz clic o pulsa una tecla para entrar</div></div>`;
  l.classList.remove('unlocked');
  tick();
}
function unlock() {
  const l = $('#lock');
  if (l.classList.contains('unlocked')) return;
  l.classList.add('unlocked');
  if (!sessionStorage.getItem('nubeos.welcome')) {
    sessionStorage.setItem('nubeos.welcome', '1');
    setTimeout(() => notify('Pulsa Ctrl+Espacio para buscar lo que quieras, o arrastra una ventana a un borde para colocarla.', 7000, { title: `Hola, ${settings.get().userName}`, icon: 'launchpad' }), 700);
  }
}
$('#lock').addEventListener('click', unlock);

// ---------- Teclado y ratón ----------
document.addEventListener('keydown', (e) => {
  const lockShown = !$('#lock').classList.contains('unlocked');
  if (lockShown) { e.preventDefault(); unlock(); return; }
  if ((e.ctrlKey || e.metaKey || e.altKey) && e.code === 'Space') { e.preventDefault(); e.stopPropagation(); toggleSpotlight(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { const w = focusedWindow(); if (w) { e.preventDefault(); w.close(); } }
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
    { label: 'Cambiar fondo de pantalla…', run: () => launch('ajustes', 'fondo') },
    { label: 'Ajustes del sistema…', run: () => launch('ajustes') },
    '-',
    { label: 'Todas las ventanas', keys: 'F3', run: toggleOverview },
  ], e.clientX, e.clientY);
});

// ---------- Arranque ----------
onWindowsChange(() => { renderMenubar(); updateRunning(); });
settings.onChange(() => renderDock());
renderMenubar();
renderDock();
setInterval(tick, 10000);
lock();
