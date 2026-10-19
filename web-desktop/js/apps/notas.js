// Notas: notas rápidas en la nube, fijables, con color y compartibles una a una.
import { cloud, avatar, people, shareDialog, emptyState } from '../cloud.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { confirm } from '../dialogs.js';
import { esc } from '../util.js';

const APP = 'notas';
const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#e5e7eb'];

export default {
  id: APP,
  name: 'Notas',
  description: 'Notas rápidas sincronizadas',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Notas', width: 900, height: 580 });
    win.body.classList.add('app-cloud', 'app-notas');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="cl-side-head"><label class="cl-search">${GLYPHS.search}<input placeholder="Buscar"></label><button class="icon-btn add" title="Nueva nota">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let current = null, query = '';
    try { await cloud.load(APP); } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.notas, 'Sin conexión', e.message); return; }

    const sorted = () => cloud.docs(APP)
      .filter((d) => !query || `${d.data.title} ${d.data.body}`.toLowerCase().includes(query))
      .sort((a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || b.updated - a.updated);

    function renderSide() {
      const notes = sorted();
      if (!current || !cloud.get(APP, current)) current = notes[0]?.id || null;
      $('.cl-items').innerHTML = '';
      for (const d of notes) {
        const b = document.createElement('button');
        b.className = `cl-item note-item${d.id === current ? ' on' : ''}`;
        const first = (d.data.body || '').split('\n').find((l) => l.trim()) || 'Sin texto';
        b.innerHTML = `<span class="swatch" style="background:${d.data.color || COLORS[0]}"></span>
          <span class="name"><strong>${esc(d.data.title || 'Nota nueva')}</strong><small>${new Date(d.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${esc(first.slice(0, 50))}</small></span>
          ${d.data.pinned ? `<span class="pinned">${GLYPHS.pin}</span>` : ''}${people(d).length > 1 ? `<span class="mini-people">${avatar(people(d).find((u) => u !== ctx.account.user) || d.owner, 16)}</span>` : ''}`;
        b.onclick = () => { current = d.id; render(); };
        $('.cl-items').appendChild(b);
      }
    }

    let timers = {};
    function render() {
      renderSide();
      const main = $('.cl-main');
      const d = current && cloud.get(APP, current);
      if (!d) {
        main.innerHTML = emptyState(ICONS.notas, query ? 'Nada coincide' : 'Sin notas', query ? 'Prueba con otra búsqueda.' : 'Pulsa + para escribir tu primera nota.');
        return;
      }
      win.setTitle(d.data.title || 'Notas');
      const canEdit = ['owner', 'edit'].includes(d.role);
      main.innerHTML = `
        <header class="cl-head note-head">
          <div class="colors">${COLORS.map((c) => `<button class="color${c === (d.data.color || COLORS[0]) ? ' on' : ''}" data-c="${c}" style="background:${c}" ${canEdit ? '' : 'disabled'}></button>`).join('')}</div>
          <span class="grow"></span>
          <span class="people">${people(d).length > 1 ? people(d).map((u) => avatar(u, 26)).join('') : ''}</span>
          <button class="icon-btn pin${d.data.pinned ? ' on' : ''}" title="Fijar arriba" ${canEdit ? '' : 'disabled'}>${GLYPHS.pin}</button>
          ${d.role === 'owner' ? `<button class="icon-btn share" title="Compartir">${GLYPHS.share}</button>` : ''}
          <button class="icon-btn del" title="${d.role === 'owner' ? 'Eliminar' : 'Dejar de ver'}">${GLYPHS.trash}</button>
        </header>
        <div class="note-paper" style="--note:${d.data.color || COLORS[0]}">
          <input class="note-title" placeholder="Título" value="${esc(d.data.title || '')}" ${canEdit ? '' : 'readonly'}>
          <textarea class="note-body" placeholder="Escribe aquí…" ${canEdit ? '' : 'readonly'}>${esc(d.data.body || '')}</textarea>
        </div>`;
      const save = (field, value) => {
        clearTimeout(timers[field]);
        timers[field] = setTimeout(() => cloud.ops(APP, d.id, [{ op: 'set', path: [field], value }]).catch((e) => ctx.notify(e.message)), 500);
      };
      main.querySelector('.note-title').oninput = (e) => save('title', e.target.value);
      main.querySelector('.note-body').oninput = (e) => save('body', e.target.value);
      main.querySelectorAll('.color').forEach((b) => { b.onclick = () => cloud.ops(APP, d.id, [{ op: 'set', path: ['color'], value: b.dataset.c }]); });
      main.querySelector('.pin').onclick = () => cloud.ops(APP, d.id, [{ op: 'set', path: ['pinned'], value: !d.data.pinned }]);
      main.querySelector('.share')?.addEventListener('click', () => shareDialog(win, ctx, APP, d, { title: d.data.title || 'Nota' }));
      main.querySelector('.del').onclick = async () => {
        if (await confirm(win, d.role === 'owner' ? '¿Eliminar esta nota?' : '¿Dejar de ver esta nota compartida?')) cloud.remove(APP, d.id);
      };
    }

    $('.add').onclick = async () => {
      const d = await cloud.create(APP, { title: '', body: '', color: COLORS[cloud.docs(APP).length % COLORS.length] });
      current = d.id; render();
      win.body.querySelector('.note-title')?.focus();
    };
    $('.cl-search input').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
    const off = cloud.subscribe(APP, () => {
      const a = document.activeElement;
      if (a && win.body.contains(a) && a.matches('.note-title, .note-body')) { renderSide(); return; }
      render();
    });
    win.onClose(() => { off(); return true; });
    render();
  },
};
