// Fotos: todas las imágenes guardadas en este ordenador, en una galería.
import { ICONS, GLYPHS } from '../shell/icons.js';
import { extname, basename, dirname, isCloud } from '../fs.js';
import { emptyState } from '../cloud.js';
import { esc } from '../util.js';

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export default {
  id: 'fotos',
  name: 'Fotos',
  description: 'Tus fotos',

  launch(ctx) {
    const win = ctx.createWindow({ title: 'Fotos', width: 980, height: 640 });
    win.body.classList.add('app-cloud', 'app-fotos');
    win.body.innerHTML = `
      <aside class="cl-side">
        <nav class="cl-items">
          <button class="cl-item on" data-f="all">${GLYPHS.image}<span class="name">Todas</span></button>
        </nav>
      </aside>
      <section class="cl-main">
        <header class="cl-head"><h2 class="title">Fotos</h2><span class="grow"></span>
          <button class="pill upload">${GLYPHS.upload}<span>Añadir fotos</span></button></header>
        <div class="photo-grid"></div>
      </section>
      <input type="file" accept="image/*" multiple hidden>`;
    const $ = (s) => win.body.querySelector(s);

    const photos = () => ctx.fs.find((n) => n.type === 'file' && !!n.blob)
      .filter((p) => IMG.includes(extname(p)))
      .map((p) => ({ path: p, node: ctx.fs.stat(p) }))
      .filter((x) => x.node?.blob && (x.node.progress ?? 1) >= 1)
      .sort((a, b) => (b.node.mtime || 0) - (a.node.mtime || 0));

    function render() {
      const list = photos();
      const grid = $('.photo-grid');
      grid.innerHTML = '';
      if (!list.length) {
        grid.innerHTML = emptyState(ICONS.fotos, 'Aún no hay fotos', isCloud() ? 'Pulsa «Añadir fotos» o arrástralas aquí. Se guardan en Archivos › Imágenes.' : 'Añade fotos desde Archivos › Imágenes.');
        return;
      }
      let lastMonth = '';
      for (const { path, node } of list) {
        const m = new Date(node.mtime || Date.now()).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        if (m !== lastMonth) { grid.insertAdjacentHTML('beforeend', `<h3 class="month">${esc(m[0].toUpperCase() + m.slice(1))}</h3>`); lastMonth = m; }
        const b = document.createElement('button');
        b.className = 'photo';
        b.title = `${basename(path)} · ${dirname(path)}`;
        const src = `api/blobs/${node.blob}?${new URLSearchParams({ name: basename(path), inline: '1', type: MIME[extname(path)] })}`;
        b.innerHTML = `<img loading="lazy" alt="${esc(basename(path))}" src="${src}">`;
        b.ondblclick = b.onclick = () => ctx.openFile(path);
        b.oncontextmenu = (e) => {
          e.preventDefault();
          ctx.menu([
            { label: 'Abrir', run: () => ctx.openFile(path) },
            { label: 'Descargar a mi ordenador', run: () => ctx.fs.downloadToComputer(path) },
            { label: 'Mostrar en Archivos', run: () => ctx.launch('archivos', dirname(path)) },
          ], e.clientX, e.clientY);
        };
        grid.appendChild(b);
      }
    }

    async function upload(files) {
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      for (const f of imgs) {
        try { await ctx.fs.upload('/Imágenes', f); } catch (e) { ctx.notify(`${f.name}: ${e.message}`, 6000, { title: 'Fotos', icon: 'fotos' }); }
      }
      ctx.refreshAccount?.();
    }
    const picker = win.body.querySelector('input[type=file]');
    $('.upload').onclick = () => picker.click();
    picker.onchange = () => { upload([...picker.files]); picker.value = ''; };
    const grid = $('.photo-grid');
    grid.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); grid.classList.add('drop'); } });
    grid.addEventListener('dragleave', () => grid.classList.remove('drop'));
    grid.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); grid.classList.remove('drop'); upload([...e.dataTransfer.files]); });
    const off = ctx.fs.onChange(render);
    win.onClose(() => { off(); return true; });
    render();
  },
};
