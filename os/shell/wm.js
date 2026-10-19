// Gestor de ventanas de WonderfulOS: animaciones al abrir, minimizar hacia el dock y
// maximizar; arrastrar a los bordes para colocar la ventana en media pantalla
// (o maximizarla arrastrándola arriba); y vista de todas las ventanas.
import { GLYPHS } from './icons.js';

const layer = () => document.getElementById('windows');
const windows = new Map();
const listeners = new Set();
let zTop = 10;
let nextId = 1;
let cascade = 0;

export const onWindowsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => fn());
export const allWindows = () => [...windows.values()];
export const focusedWindow = () => allWindows().find((w) => w.el.classList.contains('focused') && !w.minimized) || null;

// Rectángulo útil: entre la barra superior y el dock.
function workArea() {
  const r = layer().getBoundingClientRect();
  return { width: r.width || innerWidth, height: r.height || innerHeight - 110 };
}

export function createWindow({ title, icon = '', width = 760, height = 500, appId = null, dockIcon = null }) {
  const id = nextId++;
  const el = document.createElement('section');
  el.className = 'window opening';
  el.innerHTML = `
    <header class="titlebar">
      <span class="title"></span>
      <div class="controls">
        <button class="min" title="Minimizar">${GLYPHS.min}</button>
        <button class="max" title="Maximizar">${GLYPHS.max}</button>
        <button class="close" title="Cerrar">${GLYPHS.close}</button>
      </div>
    </header>
    <div class="window-body"></div>
    <div class="resize-handle"></div>`;

  const area = workArea();
  const w = Math.min(width, area.width - 40);
  const h = Math.min(height, area.height - 30);
  const offset = (cascade++ % 6) * 26;
  Object.assign(el.style, {
    width: `${w}px`, height: `${h}px`,
    left: `${Math.max(10, (area.width - w) / 2 - 60 + offset)}px`,
    top: `${Math.max(8, (area.height - h) / 2 - 30 + offset)}px`,
  });

  const closeHandlers = [];
  const win = {
    id, el, appId, icon, dockIcon, minimized: false,
    body: el.querySelector('.window-body'),
    get title() { return el.querySelector('.title').textContent; },
    setTitle(t) { el.querySelector('.title').textContent = t; changed(); },
    focus() {
      if (win.minimized) restore();
      el.style.zIndex = ++zTop;
      windows.forEach((o) => o.el.classList.toggle('focused', o === win));
      changed();
    },
    minimize() {
      // "Se va" hacia su icono del dock.
      const target = document.querySelector(`.dock-item[data-app="${appId}"]`)?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (target) {
        el.style.transformOrigin = `${target.left + target.width / 2 - r.left}px ${target.top - r.top}px`;
      }
      el.classList.add('minimizing');
      setTimeout(() => { el.classList.remove('minimizing'); el.classList.add('minimized'); }, 320);
      win.minimized = true;
      el.classList.remove('focused');
      changed();
    },
    toggleMaximize() {
      el.classList.add('animating');
      el.classList.toggle('maximized');
      el.classList.remove('snapped-left', 'snapped-right');
      setTimeout(() => el.classList.remove('animating'), 260);
    },
    onClose(fn) { closeHandlers.push(fn); },
    close() {
      if (closeHandlers.some((fn) => fn() === false)) return;
      el.classList.add('closing');
      windows.delete(id);
      changed();
      setTimeout(() => el.remove(), 180);
    },
  };
  function restore() {
    win.minimized = false;
    el.classList.remove('minimized');
    el.classList.add('restoring');
    setTimeout(() => el.classList.remove('restoring'), 320);
  }
  win.setTitle(title);
  windows.set(id, win);

  el.addEventListener('pointerdown', () => win.focus());
  el.querySelector('.min').onclick = (e) => { e.stopPropagation(); win.minimize(); };
  el.querySelector('.max').onclick = () => win.toggleMaximize();
  el.querySelector('.close').onclick = () => win.close();
  el.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) win.toggleMaximize(); });

  makeDraggable(win);
  makeResizable(el, el.querySelector('.resize-handle'));
  layer().appendChild(el);
  setTimeout(() => el.classList.remove('opening'), 260);
  win.focus();
  return win;
}

// ---------- Arrastrar, con colocación en media pantalla ----------
function makeDraggable(win) {
  const { el } = win;
  const handle = el.querySelector('.titlebar');
  const preview = document.getElementById('snap-preview');
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const area = layer().getBoundingClientRect();
    let startX = e.clientX - el.offsetLeft;
    let startY = e.clientY - el.offsetTop;
    let snap = null;
    // Si estaba maximizada o colocada, se "despega" al arrastrar.
    if (el.matches('.maximized, .snapped-left, .snapped-right')) {
      const ratio = (e.clientX - area.left) / area.width;
      el.classList.remove('maximized', 'snapped-left', 'snapped-right');
      startX = el.offsetWidth * ratio;
      startY = 16;
    }
    const move = (ev) => {
      el.style.left = `${ev.clientX - area.left - startX}px`;
      el.style.top = `${Math.max(0, ev.clientY - area.top - startY)}px`;
      const x = ev.clientX - area.left, y = ev.clientY - area.top;
      snap = y < 4 ? 'max' : x < 6 ? 'left' : x > area.width - 6 ? 'right' : null;
      preview.className = snap ? `show ${snap}` : '';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      preview.className = '';
      if (snap) {
        el.classList.add('animating');
        el.classList.add(snap === 'max' ? 'maximized' : `snapped-${snap}`);
        setTimeout(() => el.classList.remove('animating'), 260);
      }
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function makeResizable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
    const move = (ev) => {
      el.style.width = `${Math.max(340, sw + ev.clientX - sx)}px`;
      el.style.height = `${Math.max(220, sh + ev.clientY - sy)}px`;
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

// ---------- Vista de todas las ventanas ----------
let overview = null;
export function toggleOverview() {
  if (overview) return closeOverview();
  const list = allWindows();
  if (!list.length) return;
  const area = layer().getBoundingClientRect();
  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  const cellW = area.width / cols, cellH = area.height / rows;
  overview = { saved: new Map() };
  document.body.classList.add('overview');
  list.forEach((w, i) => {
    w.el.classList.remove('minimized');
    const r = w.el.getBoundingClientRect();
    const scale = Math.min((cellW - 50) / r.width, (cellH - 70) / r.height, 1);
    const cx = (i % cols) * cellW + cellW / 2, cy = Math.floor(i / cols) * cellH + cellH / 2;
    const pick = (ev) => { ev.stopPropagation(); closeOverview(); w.focus(); };
    overview.saved.set(w, { transform: w.el.style.transform, pick });
    w.el.style.transform = `translate(${cx - (r.left - area.left) - r.width / 2}px, ${cy - (r.top - area.top) - r.height / 2}px) scale(${scale})`;
    w.el.addEventListener('click', pick, { capture: true });
  });
}
export function closeOverview() {
  if (!overview) return;
  for (const [w, { transform, pick }] of overview.saved) {
    w.el.removeEventListener('click', pick, { capture: true });
    w.el.style.transform = transform;
    if (w.minimized) w.el.classList.add('minimized');
  }
  document.body.classList.remove('overview');
  overview = null;
}
