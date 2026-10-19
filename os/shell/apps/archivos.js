// Archivos: explorador de los archivos del equipo, con el estilo de WonderfulOS.
import { fileIcon, GLYPHS } from '../icons.js';
import { prompt, confirm } from '../../../web-desktop/js/dialogs.js';
import { normalize, dirname, basename } from '../../../web-desktop/js/fs.js';

const PLACES = [
  ['/', 'home', 'Inicio'],
  ['/Documentos', 'doc', 'Documentos'],
  ['/Descargas', 'download', 'Descargas'],
  ['/Imágenes', 'image', 'Imágenes'],
];
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  id: 'archivos',
  name: 'Archivos',
  description: 'Tus documentos y carpetas',

  launch(ctx, start = '/Documentos') {
    const win = ctx.createWindow({ title: 'Archivos', width: 860, height: 540 });
    win.body.classList.add('app-files');
    win.body.innerHTML = `
      <aside class="files-side">
        <div class="files-side-title">Favoritos</div>
        <nav class="places"></nav>
      </aside>
      <section class="files-main">
        <div class="files-bar">
          <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
          <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
          <div class="crumbs"></div>
          <div class="seg"><button class="icon-btn grid on" title="Iconos">${GLYPHS.gridView}</button><button class="icon-btn list" title="Lista">${GLYPHS.listView}</button></div>
          <button class="icon-btn mkdir" title="Nueva carpeta">${GLYPHS.plusFolder}</button>
          <label class="files-search">${GLYPHS.search}<input placeholder="Buscar"></label>
        </div>
        <div class="files-items"></div>
        <footer class="files-status"></footer>
      </section>`;
    const $ = (s) => win.body.querySelector(s);
    const items = $('.files-items');
    let dir = ctx.fs.isDir(start) ? normalize(start) : '/';
    let history = [dir], pos = 0, selected = null, view = 'grid', query = '';

    const tryDo = (fn) => { try { fn(); } catch (e) { ctx.notify(e.message); } };
    function go(p, push = true) {
      if (!ctx.fs.isDir(p)) return;
      dir = normalize(p);
      if (push) { history = history.slice(0, pos + 1); history.push(dir); pos = history.length - 1; }
      selected = null; query = ''; $('.files-search input').value = '';
      render();
    }
    function open(e) {
      if (e.type === 'dir') return go(e.path);
      ctx.openFile(e.path);
    }

    function render() {
      win.setTitle(dir === '/' ? 'Inicio' : basename(dir));
      // Lugares
      const places = $('.places');
      places.innerHTML = '';
      for (const [p, g, label] of PLACES) {
        const b = document.createElement('button');
        b.className = `place${dir === p ? ' on' : ''}`;
        b.innerHTML = `${GLYPHS[g]}<span>${label}</span>`;
        b.onclick = () => go(p);
        places.appendChild(b);
      }
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
      // Elementos
      const list = ctx.fs.list(dir).filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()));
      items.className = `files-items ${view}`;
      items.innerHTML = list.length ? '' : `<div class="empty">${query ? 'Nada coincide con la búsqueda' : 'Esta carpeta está vacía'}</div>`;
      for (const e of list) {
        const el = document.createElement('div');
        el.className = `file${e.path === selected ? ' sel' : ''}`;
        el.tabIndex = 0;
        el.innerHTML = `<div class="fi">${fileIcon(e.name, e.type === 'dir')}</div><div class="fn">${esc(e.name)}</div>
          ${view === 'list' ? `<div class="fm">${e.type === 'dir' ? 'Carpeta' : new Date(e.mtime).toLocaleDateString('es-ES')}</div>` : ''}`;
        el.onclick = (ev) => { ev.stopPropagation(); selected = e.path; render(); };
        el.ondblclick = () => open(e);
        el.onkeydown = (ev) => { if (ev.key === 'Enter') open(e); if (ev.key === 'Delete' || ev.key === 'Backspace') remove(e.path); };
        el.oncontextmenu = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          selected = e.path; render();
          ctx.menu([
            { label: 'Abrir', run: () => open(e) },
            { label: 'Cambiar nombre…', run: () => rename(e.path) },
            '-',
            { label: 'Mover a la papelera', run: () => remove(e.path) },
          ], ev.clientX, ev.clientY);
        };
        items.appendChild(el);
      }
      $('.files-status').textContent = `${list.length} elemento${list.length === 1 ? '' : 's'}`;
    }

    async function rename(p) {
      const name = await prompt(win, 'Nuevo nombre', basename(p));
      if (name) tryDo(() => ctx.fs.rename(p, normalize(dirname(p) + '/' + name)));
    }
    async function remove(p) {
      if (await confirm(win, `¿Mover «${basename(p)}» a la papelera?`)) tryDo(() => ctx.fs.remove(p));
    }

    $('.back').onclick = () => pos > 0 && go(history[--pos], false);
    $('.fwd').onclick = () => pos < history.length - 1 && go(history[++pos], false);
    $('.grid').onclick = () => { view = 'grid'; $('.grid').classList.add('on'); $('.list').classList.remove('on'); render(); };
    $('.list').onclick = () => { view = 'list'; $('.list').classList.add('on'); $('.grid').classList.remove('on'); render(); };
    $('.mkdir').onclick = async () => {
      const name = await prompt(win, 'Nombre de la carpeta', 'Carpeta nueva');
      if (name) tryDo(() => ctx.fs.mkdir(normalize(dir + '/' + name)));
    };
    $('.files-search input').oninput = (e) => { query = e.target.value; render(); };
    items.onclick = () => { selected = null; render(); };
    items.oncontextmenu = (ev) => {
      if (ev.target !== items) return;
      ev.preventDefault();
      ctx.menu([{ label: 'Nueva carpeta', run: () => $('.mkdir').click() }], ev.clientX, ev.clientY);
    };
    const off = ctx.fs.onChange(render);
    win.onClose(() => { off(); return true; });
    render();
  },
};
