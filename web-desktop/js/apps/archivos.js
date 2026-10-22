// Archivos: tu disco local. Sube archivos del ordenador (botón o arrastrando),
// descárgalos, crea carpetas y documentos. Todo se queda en este equipo.
import { fileIcon, GLYPHS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { normalize, dirname, basename, isCloud } from '../fs.js';
import { api } from '../api.js';
import { humanSize, esc } from '../util.js';

const PLACES = [
  ['/', 'home', 'Inicio'],
  ['/Documentos', 'doc', 'Documentos'],
  ['/Descargas', 'download', 'Descargas'],
  ['/Imágenes', 'image', 'Imágenes'],
];
const NEW_DOCS = [
  ['Documento', 'Documento', 'texto'],
  ['Hoja de cálculo', 'Hoja de cálculo', 'calculo'],
  ['Presentación', 'Presentación', 'diapositivas'],
];

export default {
  id: 'archivos',
  name: 'Archivos',
  description: 'Tus archivos, guardados en este ordenador',

  launch(ctx, arg = '/Documentos') {
    const start = typeof arg === 'string' ? arg : arg.dir;
    const win = ctx.createWindow({ title: 'Archivos', width: 940, height: 580 });
    win.body.classList.add('app-files');
    win.body.innerHTML = `
      <aside class="files-side">
        <div class="files-side-title">Favoritos</div>
        <nav class="places"></nav>
        <div class="grow"></div>
        <div class="storage" hidden></div>
      </aside>
      <section class="files-main">
        <div class="files-bar">
          <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
          <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
          <div class="crumbs"></div>
          <button class="pill upload" title="Subir archivos de tu ordenador">${GLYPHS.upload}<span>Subir</span></button>
          <button class="pill soft new" title="Crear">${GLYPHS.plusDoc}<span>Nuevo</span></button>
          <div class="seg"><button class="icon-btn grid on" title="Iconos">${GLYPHS.gridView}</button><button class="icon-btn list" title="Lista">${GLYPHS.listView}</button></div>
          <label class="files-search">${GLYPHS.search}<input placeholder="Buscar"></label>
        </div>
        <div class="files-items"></div>
        <footer class="files-status"></footer>
      </section>
      <input type="file" multiple hidden>`;
    const $ = (s) => win.body.querySelector(s);
    const items = $('.files-items');
    const picker = $('input[type=file]');
    let dir = '/';
    let history = [], pos = -1, view = 'grid', query = '';
    let sel = new Set(); // rutas seleccionadas (clic, Cmd/Ctrl+clic o rectángulo)
    const uploads = new Map(); // nombre -> progreso (0..1)
    let renderFrame = 0;
    const scheduleRender = () => {
      if (renderFrame) return;
      renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
    };

    const tryDo = (fn) => { try { fn(); } catch (e) { ctx.notify(e.message, 5000, { title: 'Archivos', icon: 'archivos' }); } };

    function go(p, push = true) {
      p = normalize(p);
      if (!ctx.fs.isDir(p)) return;
      dir = p;
      if (push) { history = history.slice(0, pos + 1); history.push(dir); pos = history.length - 1; }
      sel = new Set(); query = ''; $('.files-search input').value = '';
      render();
    }
    const open = (e) => (e.type === 'dir' ? go(e.path) : ctx.openFile(e.path));

    function renderSide() {
      const places = $('.places');
      places.innerHTML = '';
      for (const [p, g, label] of PLACES) {
        const b = document.createElement('button');
        b.className = `place${dir === p ? ' on' : ''}`;
        b.innerHTML = `${GLYPHS[g]}<span>${label}</span>`;
        b.onclick = () => go(p);
        places.appendChild(b);
      }
      const a = ctx.account?.info;
      const box = $('.storage');
      box.hidden = !a;
      if (a) {
        const pct = Math.min(100, (a.used / a.quota) * 100);
        box.innerHTML = `<div style="display:flex;align-items:center;gap:6px;color:var(--text);font-weight:600">${GLYPHS.home} Espacio</div>
          <div class="bar${pct > 90 ? ' full' : ''}"><span style="width:${Math.max(pct, 1)}%"></span></div>
          <div>${humanSize(a.used)} de ${humanSize(a.quota)}</div>`;
      }
    }

    function render() {
      win.setTitle(dir === '/' ? 'Inicio' : basename(dir));
      renderSide();
      // Migas de pan
      const crumbs = $('.crumbs');
      crumbs.innerHTML = '';
      const parts = dir.split('/').filter(Boolean);
      [['Inicio', '/'], ...parts.map((x, i) => [x, '/' + parts.slice(0, i + 1).join('/')])].forEach(([label, p], i, arr) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = i === arr.length - 1 ? 'here' : '';
        b.onclick = () => go(p);
        crumbs.appendChild(b);
        if (i < arr.length - 1) crumbs.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
      });
      $('.back').disabled = pos <= 0;
      $('.fwd').disabled = pos >= history.length - 1;
      $('.upload').hidden = !isCloud();

      // Elementos
      const all = ctx.fs.exists(dir) ? ctx.fs.list(dir) : [];
      const list = all.filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()));
      items.className = `files-items ${view}`;
      items.innerHTML = '';
      if (!list.length) {
        const msg = query ? 'Nada coincide con la búsqueda'
          : isCloud() ? 'Esta carpeta está vacía. Arrastra archivos aquí o pulsa «Subir».' : 'Esta carpeta está vacía';
        items.innerHTML = `<div class="empty">${esc(msg)}</div>`;
      }
      for (const e of list) {
        const el = document.createElement('div');
        el.className = `file${sel.has(e.path) ? ' sel' : ''}`;
        el.dataset.path = e.path;
        el.tabIndex = 0;
        const icon = fileIcon(e.name, e.type === 'dir');
        const meta = e.type === 'dir' ? 'Carpeta' : `${humanSize(ctx.fs.size(e.path))} · ${new Date(e.mtime).toLocaleDateString('es-ES')}`;
        el.innerHTML = `<div class="fi">${icon}</div><div class="fn">${esc(e.name)}</div>
          ${view === 'list' ? `<div class="fm">${esc(meta)}</div>` : ''}`;
        el.onclick = (ev) => {
          ev.stopPropagation();
          if (ev.metaKey || ev.ctrlKey) { sel.has(e.path) ? sel.delete(e.path) : sel.add(e.path); } else sel = new Set([e.path]);
          render();
        };
        el.ondblclick = () => open(e);
        el.onkeydown = (ev) => { if (ev.key === 'Enter') open(e); if (ev.key === 'Delete') removeMany(sel.size ? [...sel] : [e.path]); };
        el.oncontextmenu = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (!sel.has(e.path)) { sel = new Set([e.path]); render(); }
          if (sel.size > 1) {
            const paths = [...sel];
            const files = paths.filter((p) => !ctx.fs.isDir(p));
            return ctx.menu([
              ...(files.length ? [{ label: `Descargar ${files.length} archivo${files.length === 1 ? '' : 's'}`, run: () => files.forEach((p) => tryDo(() => ctx.fs.downloadToComputer(p))) }] : []),
              { label: `Eliminar ${paths.length} elementos`, run: () => removeMany(paths) },
            ], ev.clientX, ev.clientY);
          }
          ctx.menu([
            { label: 'Abrir', run: () => open(e) },
            ...(e.type === 'file' && window.nubeosDesktop?.openWithSystem ? [
              { label: 'Abrir con el sistema', run: () => window.nubeosDesktop.openWithSystem(e.path).catch((er) => ctx.notify(er.message)) },
              { label: 'Mostrar en la carpeta', run: () => window.nubeosDesktop.showInSystem(e.path) },
            ] : e.type === 'file' ? [{ label: 'Descargar a mi ordenador', run: () => tryDo(() => ctx.fs.downloadToComputer(e.path)) }] : []),
            '-',
            { label: 'Cambiar nombre…', run: () => rename(e.path) },
            { label: 'Eliminar', run: () => remove(e.path) },
          ], ev.clientX, ev.clientY);
        };
        items.appendChild(el);
      }
      // Subidas en curso
      for (const [name, p] of uploads) {
        const row = document.createElement('div');
        row.className = 'file';
        row.style.opacity = '.8';
        row.innerHTML = `<div class="fi">${fileIcon(name, false)}</div><div class="fn">${esc(name)}</div><div class="progress-row" style="width:100%"><div class="bar"><span style="width:${Math.round(p * 100)}%"></span></div></div>`;
        items.appendChild(row);
      }
      $('.files-status').textContent = `${list.length} elemento${list.length === 1 ? '' : 's'}${sel.size > 1 ? ` · ${sel.size} seleccionados` : ''}${uploads.size ? ` · subiendo ${uploads.size}…` : ''}`;
    }

    async function rename(p) {
      const name = await prompt(win, 'Nuevo nombre', basename(p));
      if (name) tryDo(() => ctx.fs.rename(p, normalize(dirname(p) + '/' + name)));
    }
    async function removeMany(paths) {
      if (paths.length === 1) return remove(paths[0]);
      if (await confirm(win, `¿Eliminar ${paths.length} elementos? No se puede deshacer.`)) {
        tryDo(() => paths.forEach((p) => ctx.fs.exists(p) && ctx.fs.remove(p)));
        sel = new Set();
      }
    }
    async function remove(p) {
      if (await confirm(win, `¿Eliminar «${basename(p)}»? No se puede deshacer.`)) tryDo(() => ctx.fs.remove(p));
    }

    async function uploadFiles(files, target = dir) {
      if (!isCloud()) return ctx.notify('Para subir archivos necesitas el servicio local de WonderfulOS.');
      for (const file of files) {
        uploads.set(file.name, 0);
        render();
        try {
          await ctx.fs.upload(target, file, (p) => { uploads.set(file.name, p); scheduleRender(); });
        } catch (e) {
          ctx.notify(`${file.name}: ${e.message}`, 7000, { title: 'No se pudo subir', icon: 'archivos' });
        }
        uploads.delete(file.name);
        render();
      }
      ctx.refreshAccount?.();
    }

    // ---- Barra y eventos ----
    $('.back').onclick = () => pos > 0 && go(history[--pos], false);
    $('.fwd').onclick = () => pos < history.length - 1 && go(history[++pos], false);
    $('.grid').onclick = () => { view = 'grid'; $('.grid').classList.add('on'); $('.list').classList.remove('on'); render(); };
    $('.list').onclick = () => { view = 'list'; $('.list').classList.add('on'); $('.grid').classList.remove('on'); render(); };
    $('.upload').onclick = () => picker.click();
    picker.onchange = () => { uploadFiles([...picker.files]); picker.value = ''; };
    $('.new').onclick = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const create = async (label, def, kind) => {
        const name = await prompt(win, `Nombre ${label === 'Carpeta' ? 'de la carpeta' : 'del archivo'}`, def);
        if (!name) return;
        if (label === 'Carpeta') return tryDo(() => ctx.fs.mkdir(normalize(dir + '/' + name)));
        try {
          const created = await api('office/new', { method: 'POST', body: { dir, kind, name } });
          await ctx.fs.reload();
          ctx.openFile(created.path);
        } catch (e) { ctx.notify(e.message, 6000, { title: 'Nuevo', icon: 'archivos' }); }
      };
      ctx.menu([
        { label: 'Carpeta', run: () => create('Carpeta', 'Carpeta nueva') },
        '-',
        ...(isCloud() ? NEW_DOCS.map(([label, def, kind]) => ({ label, run: () => create(label, def, kind) })) : []),
      ], r.left, r.bottom + 6);
    };
    $('.files-search input').oninput = (e) => { query = e.target.value; render(); };
    let dragged = false;
    items.onclick = () => { if (dragged) { dragged = false; return; } sel = new Set(); render(); };
    // Selección con rectángulo: arrastrar desde una zona vacía.
    items.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('.file')) return;
      const box = items.getBoundingClientRect();
      const x0 = ev.clientX - box.left + items.scrollLeft, y0 = ev.clientY - box.top + items.scrollTop;
      const base = ev.metaKey || ev.ctrlKey ? new Set(sel) : new Set();
      const band = document.createElement('div');
      band.className = 'rubber-band';
      let moved = false;
      const move = (m) => {
        const x1 = m.clientX - box.left + items.scrollLeft, y1 = m.clientY - box.top + items.scrollTop;
        if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
        if (!moved) { moved = true; items.appendChild(band); }
        const r = { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
        Object.assign(band.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
        sel = new Set(base);
        for (const f of items.querySelectorAll('.file[data-path]')) {
          const fr = f.getBoundingClientRect();
          const fx = fr.left - box.left + items.scrollLeft, fy = fr.top - box.top + items.scrollTop;
          const hit = fx < r.right && fx + fr.width > r.left && fy < r.bottom && fy + fr.height > r.top;
          f.classList.toggle('sel', hit || base.has(f.dataset.path));
          if (hit) sel.add(f.dataset.path);
        }
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        band.remove();
        if (moved) { dragged = true; render(); }
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    items.oncontextmenu = (ev) => {
      if (ev.target.closest('.file')) return;
      ev.preventDefault();
      ctx.menu([
        { label: 'Nueva carpeta…', run: () => $('.new').click() },
        ...(isCloud() ? [{ label: 'Subir archivos…', run: () => picker.click() }] : []),
      ], ev.clientX, ev.clientY);
    };
    // Arrastrar archivos del ordenador a la ventana.
    items.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); e.stopPropagation();
      items.classList.add('drop');
    });
    items.addEventListener('dragleave', () => items.classList.remove('drop'));
    items.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); e.stopPropagation();
      items.classList.remove('drop');
      uploadFiles([...e.dataTransfer.files]);
    });

    const off = ctx.fs.onChange(() => scheduleRender());
    const onAccount = () => renderSide();
    ctx.account?.listeners.add(onAccount);
    win.onClose(() => { off(); if (renderFrame) cancelAnimationFrame(renderFrame); ctx.account?.listeners.delete(onAccount); return true; });
    go(ctx.fs.isDir(start || '') ? start : '/Documentos');
    if (arg?.upload) uploadFiles(arg.upload, start);
  },
};
