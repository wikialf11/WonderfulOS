// Notas: notas rápidas locales, fijables y con color.
import { appdata, emptyState } from '../appdata.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { confirm } from '../dialogs.js';
import { esc } from '../util.js';

const APP = 'notas';
const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#e5e7eb'];

export default {
  id: APP,
  name: 'Notas',
  description: 'Notas rápidas guardadas en este ordenador',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Notas', width: 900, height: 580 });
    win.body.classList.add('app-workspace', 'app-notas');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="cl-side-head"><label class="cl-search">${GLYPHS.search}<input placeholder="Buscar"></label><button class="icon-btn add" title="Nueva nota">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let current = null, query = '';
    try { await appdata.load(APP); } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.notas, 'No se pudo cargar', e.message); return; }

    const sorted = () => appdata.docs(APP)
      .filter((d) => !query || `${d.data.title} ${d.data.body}`.toLowerCase().includes(query))
      .sort((a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || b.updated - a.updated);

    function renderSide() {
      const notes = sorted();
      if (!current || !appdata.get(APP, current)) current = notes[0]?.id || null;
      $('.cl-items').innerHTML = '';
      for (const d of notes) {
        const b = document.createElement('button');
        b.className = `cl-item note-item${d.id === current ? ' on' : ''}`;
        const first = (d.data.body || '').split('\n').find((l) => l.trim()) || 'Sin texto';
        b.innerHTML = `<span class="swatch" style="background:${d.data.color || COLORS[0]}"></span>
          <span class="name"><strong>${esc(d.data.title || 'Nota nueva')}</strong><small>${new Date(d.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${esc(first.slice(0, 50))}</small></span>
          ${d.data.pinned ? `<span class="pinned">${GLYPHS.pin}</span>` : ''}`;
        b.onclick = () => { current = d.id; render(); };
        $('.cl-items').appendChild(b);
      }
    }

    let timers = {};
    function render() {
      renderSide();
      const main = $('.cl-main');
      const d = current && appdata.get(APP, current);
      if (!d) {
        main.innerHTML = emptyState(ICONS.notas, query ? 'Nada coincide' : 'Sin notas', query ? 'Prueba con otra búsqueda.' : 'Pulsa + para escribir tu primera nota.');
        return;
      }
      win.setTitle(d.data.title || 'Notas');
      main.innerHTML = `
        <header class="cl-head note-head">
          <div class="colors">${COLORS.map((c) => `<button class="color${c === (d.data.color || COLORS[0]) ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
          <span class="grow"></span>
          <button class="icon-btn pin${d.data.pinned ? ' on' : ''}" title="Fijar arriba">${GLYPHS.pin}</button>
          <button class="icon-btn del" title="Eliminar">${GLYPHS.trash}</button>
        </header>
        <div class="note-paper" style="--note:${d.data.color || COLORS[0]}">
          <input class="note-title" placeholder="Título" value="${esc(d.data.title || '')}">
          <textarea class="note-body" placeholder="Escribe aquí…">${esc(d.data.body || '')}</textarea>
        </div>`;
      const save = (field, value) => {
        clearTimeout(timers[field]);
        timers[field] = setTimeout(() => appdata.ops(APP, d.id, [{ op: 'set', path: [field], value }]).catch((e) => ctx.notify(e.message)), 500);
      };
      main.querySelector('.note-title').oninput = (e) => save('title', e.target.value);
      main.querySelector('.note-body').oninput = (e) => save('body', e.target.value);
      main.querySelectorAll('.color').forEach((b) => { b.onclick = () => appdata.ops(APP, d.id, [{ op: 'set', path: ['color'], value: b.dataset.c }]); });
      main.querySelector('.pin').onclick = () => appdata.ops(APP, d.id, [{ op: 'set', path: ['pinned'], value: !d.data.pinned }]);
      main.querySelector('.del').onclick = async () => {
        if (await confirm(win, '¿Eliminar esta nota?')) appdata.remove(APP, d.id);
      };
    }

    $('.add').onclick = async () => {
      const d = await appdata.create(APP, { title: '', body: '', color: COLORS[appdata.docs(APP).length % COLORS.length] });
      current = d.id; render();
      win.body.querySelector('.note-title')?.focus();
    };
    $('.cl-search input').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
    const off = appdata.subscribe(APP, () => {
      const a = document.activeElement;
      if (a && win.body.contains(a) && a.matches('.note-title, .note-body')) { renderSide(); return; }
      render();
    });
    win.onClose(() => { off(); return true; });
    render();
  },
};
