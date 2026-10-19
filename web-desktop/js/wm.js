// Gestor de ventanas: crear, mover, redimensionar, minimizar, maximizar y foco.

const layer = () => document.getElementById('windows');
const taskButtons = () => document.getElementById('task-buttons');
const windows = new Map();
let zTop = 10;
let nextId = 1;
let cascade = 0;

export function createWindow({ title, icon = '🗔', width = 720, height = 480 }) {
  const id = nextId++;
  const el = document.createElement('section');
  el.className = 'window';
  el.innerHTML = `
    <header class="titlebar">
      <span class="ico"></span>
      <span class="title"></span>
      <button class="min" title="Minimizar">–</button>
      <button class="max" title="Maximizar">□</button>
      <button class="close" title="Cerrar">✕</button>
    </header>
    <div class="window-body"></div>
    <div class="resize-handle"></div>`;

  const rect = layer().getBoundingClientRect();
  // Si la pestaña aún no tiene tamaño (p. ej. abierta en segundo plano), usamos la ventana.
  const area = rect.width > 300 && rect.height > 200 ? rect : { width: innerWidth, height: innerHeight - 48 };
  const w = Math.min(width, area.width - 20);
  const h = Math.min(height, area.height - 20);
  const offset = (cascade++ % 8) * 28;
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.max(0, (area.width - w) / 2 - 100 + offset) + 'px';
  el.style.top = Math.max(0, (area.height - h) / 2 - 60 + offset) + 'px';

  el.querySelector('.ico').textContent = icon;
  const taskBtn = document.createElement('button');
  taskBtn.textContent = `${icon} ${title}`;
  taskButtons().appendChild(taskBtn);

  const closeHandlers = [];
  const win = {
    id, el,
    body: el.querySelector('.window-body'),
    setTitle(t) {
      el.querySelector('.title').textContent = t;
      taskBtn.textContent = `${icon} ${t}`;
      taskBtn.title = t;
    },
    focus() {
      el.classList.remove('minimized');
      el.style.zIndex = ++zTop;
      windows.forEach((o) => { o.el.classList.toggle('focused', o === win); o.taskBtn.classList.toggle('active', o === win); });
    },
    minimize() { el.classList.add('minimized'); el.classList.remove('focused'); taskBtn.classList.remove('active'); },
    toggleMaximize() { el.classList.toggle('maximized'); },
    onClose(fn) { closeHandlers.push(fn); },
    // Los handlers pueden devolver false para cancelar el cierre (p. ej. cambios sin guardar).
    close() {
      if (closeHandlers.some((fn) => fn() === false)) return;
      el.remove(); taskBtn.remove(); windows.delete(id);
    },
    taskBtn,
  };
  win.setTitle(title);
  windows.set(id, win);

  el.addEventListener('pointerdown', () => win.focus());
  el.querySelector('.min').onclick = (e) => { e.stopPropagation(); win.minimize(); };
  el.querySelector('.max').onclick = () => win.toggleMaximize();
  el.querySelector('.close').onclick = () => win.close();
  el.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (e.target.tagName !== 'BUTTON') win.toggleMaximize(); });
  taskBtn.onclick = () => {
    const isTop = el.classList.contains('focused') && !el.classList.contains('minimized');
    isTop ? win.minimize() : win.focus();
  };

  makeDraggable(el, el.querySelector('.titlebar'));
  makeResizable(el, el.querySelector('.resize-handle'));

  layer().appendChild(el);
  win.focus();
  return win;
}

function makeDraggable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON' || el.classList.contains('maximized')) return;
    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;
    const move = (ev) => {
      el.style.left = Math.max(-el.offsetWidth + 80, ev.clientX - startX) + 'px';
      el.style.top = Math.max(0, ev.clientY - startY) + 'px';
    };
    trackPointer(handle, e, move);
  });
}

function makeResizable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
    trackPointer(handle, e, (ev) => {
      el.style.width = Math.max(320, sw + ev.clientX - sx) + 'px';
      el.style.height = Math.max(200, sh + ev.clientY - sy) + 'px';
    });
  });
}

function trackPointer(target, e, move) {
  target.setPointerCapture(e.pointerId);
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
}
