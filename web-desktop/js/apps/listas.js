// Listas (Wonderful Lists dentro de WonderfulOS): listas de tareas compartidas en tiempo
// real, con cuenta atrás en cada tarea, recurrencias y permisos claros
// («Puede editar», «Solo completar tareas», «Solo ver»).
import { cloud, uid, avatar, people, shareDialog, emptyState } from '../cloud.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { esc } from '../util.js';
import { parseRepeat, nextDate, repeatText, whenControls, wireWhen } from '../repeat.js';

const APP = 'listas';
const ROLES = [['edit', 'Puede editar'], ['complete', 'Solo completar tareas'], ['read', 'Solo ver']];
const EMOJIS = ['🏠', '🛒', '💼', '✈️', '🎉', '📚', '💪', '🧹', '🎯', '❤️'];

// ---------- Tiempo ----------
function countdown(due, done) {
  if (!due || done) return null;
  const ms = new Date(due) - Date.now();
  const abs = Math.abs(ms), m = Math.round(abs / 60000), h = Math.floor(abs / 3600000), d = Math.floor(abs / 86400000);
  const span = d >= 1 ? `${d} d${h % 24 ? ` ${h % 24} h` : ''}` : h >= 1 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.max(1, m)} min`;
  if (ms < 0) return { text: `Vencida hace ${span}`, cls: 'late' };
  if (ms < 86400000) return { text: `Quedan ${span}`, cls: 'soon' };
  return { text: `Quedan ${span}`, cls: '' };
}
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default {
  id: APP,
  name: 'Listas',
  description: 'Listas de tareas compartidas en tiempo real',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Listas', width: 980, height: 620 });
    win.body.classList.add('app-cloud', 'app-listas');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="cl-side-head"><span>Mis listas</span><button class="icon-btn add-list" title="Nueva lista">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let current = null, showDone = false;

    try { await cloud.load(APP); } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.listas, 'Sin conexión', e.message); return; }

    const sortLists = (a, b) => (a.data.created || 0) - (b.data.created || 0);
    function renderSide() {
      const lists = cloud.docs(APP).sort(sortLists);
      if (!current || !cloud.get(APP, current)) current = lists[0]?.id || null;
      $('.cl-items').innerHTML = '';
      for (const d of lists) {
        const tasks = Object.values(d.data.tasks || {});
        const pending = tasks.filter((t) => !t.done).length;
        const late = tasks.some((t) => !t.done && t.due && new Date(t.due) < Date.now());
        const b = document.createElement('button');
        b.className = `cl-item${d.id === current ? ' on' : ''}`;
        b.innerHTML = `<span class="emoji">${esc(d.data.emoji || '📝')}</span><span class="name">${esc(d.data.title || 'Sin nombre')}</span>
          ${people(d).length > 1 ? `<span class="mini-people">${people(d).slice(0, 3).map((u) => avatar(u, 16)).join('')}</span>` : ''}
          <span class="count${late ? ' late' : ''}">${pending || ''}</span>`;
        b.onclick = () => { current = d.id; showDone = false; render(); };
        $('.cl-items').appendChild(b);
      }
    }

    function render() {
      renderSide();
      const main = $('.cl-main');
      const d = current && cloud.get(APP, current);
      if (!d) {
        main.innerHTML = emptyState(ICONS.listas, 'Crea tu primera lista', 'La compra, las tareas de casa, un viaje… e invita a quien quieras para hacerla juntos.');
        main.insertAdjacentHTML('beforeend', '<div style="text-align:center"><button class="btn primary first">Nueva lista</button></div>');
        main.querySelector('.first').onclick = newList;
        return;
      }
      win.setTitle(d.data.title || 'Listas');
      const canEdit = ['owner', 'edit'].includes(d.role);
      const canComplete = canEdit || d.role === 'complete';
      const tasks = Object.entries(d.data.tasks || {}).map(([id, t]) => ({ id, ...t }));
      const pending = tasks.filter((t) => !t.done).sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity) || (a.created || 0) - (b.created || 0));
      const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      const roleLabel = { owner: '', edit: '', complete: 'Puedes completar tareas', read: 'Solo lectura' }[d.role];

      main.innerHTML = `
        <header class="cl-head">
          <button class="emoji-btn" ${canEdit ? '' : 'disabled'}>${esc(d.data.emoji || '📝')}</button>
          <h2 class="title" ${canEdit ? 'contenteditable="plaintext-only" spellcheck="false"' : ''}>${esc(d.data.title || '')}</h2>
          ${roleLabel ? `<span class="chip">${roleLabel}</span>` : ''}
          <span class="people">${people(d).map((u) => avatar(u, 28)).join('')}</span>
          ${d.role === 'owner' ? `<button class="pill share">${GLYPHS.share}<span>Compartir</span></button>` : ''}
          <button class="icon-btn more" title="Más">${GLYPHS.more}</button>
        </header>
        ${canEdit ? `<form class="cl-add">
          <span class="plus">${GLYPHS.plus}</span>
          <input class="text" placeholder="Añadir una tarea" autocomplete="off">
          ${whenControls(GLYPHS)}
        </form>` : ''}
        <div class="cl-tasks"></div>`;
      const box = main.querySelector('.cl-tasks');
      const row = (t) => {
        const el = document.createElement('div');
        el.className = `task${t.done ? ' done' : ''}`;
        const cd = countdown(t.due, t.done);
        el.innerHTML = `
          <button class="check" ${canComplete ? '' : 'disabled'} title="${t.done ? 'Marcar como pendiente' : 'Completar'}">${t.done ? GLYPHS.check : ''}</button>
          <div class="body">
            <div class="text" ${canEdit ? 'contenteditable="plaintext-only" spellcheck="false"' : ''}>${esc(t.text)}</div>
            <div class="meta">
              ${cd ? `<span class="due ${cd.cls}">${GLYPHS.clock}${cd.text}</span>` : ''}
              ${t.repeat ? `<span class="rep">${GLYPHS.repeat}${repeatText(t.repeat)}</span>` : ''}
              ${t.done && t.doneBy ? `<span>Hecha por ${esc(t.doneBy)}</span>` : ''}
            </div>
          </div>
          ${t.assignee ? avatar(t.assignee, 24) : ''}
          ${canEdit ? `<button class="icon-btn menu" title="Opciones">${GLYPHS.more}</button>` : ''}`;
        el.querySelector('.check').onclick = () => toggle(d, t);
        const text = el.querySelector('.text');
        if (canEdit) {
          text.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } };
          text.onblur = () => { const v = text.textContent.trim(); if (v && v !== t.text) change(d, [{ op: 'set', path: ['tasks', t.id, 'text'], value: v }]); else text.textContent = t.text; };
          el.querySelector('.menu').onclick = (e) => taskMenu(d, t, e);
        }
        return el;
      };
      if (!tasks.length) box.innerHTML = `<div class="cl-hint">${canEdit ? 'Escribe arriba tu primera tarea y pulsa Intro.' : 'Esta lista aún no tiene tareas.'}</div>`;
      pending.forEach((t) => box.appendChild(row(t)));
      if (done.length) {
        const b = document.createElement('button');
        b.className = 'done-toggle';
        b.textContent = `${showDone ? '▾' : '▸'} Completadas (${done.length})`;
        b.onclick = () => { showDone = !showDone; render(); };
        box.appendChild(b);
        if (showDone) done.forEach((t) => box.appendChild(row(t)));
      }

      // Cabecera
      const title = main.querySelector('.title');
      if (canEdit) {
        title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
        title.onblur = () => { const v = title.textContent.trim(); if (v && v !== d.data.title) change(d, [{ op: 'set', path: ['title'], value: v }]); };
        main.querySelector('.emoji-btn').onclick = (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctx.menu(EMOJIS.map((em) => ({ label: em, run: () => change(d, [{ op: 'set', path: ['emoji'], value: em }]) })), r.left, r.bottom + 6);
        };
      }
      main.querySelector('.share')?.addEventListener('click', () => shareDialog(win, ctx, APP, d, { title: d.data.title, roles: ROLES }));
      main.querySelector('.more').onclick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        ctx.menu([
          ...(d.role === 'owner' ? [{ label: 'Compartir…', run: () => shareDialog(win, ctx, APP, d, { title: d.data.title, roles: ROLES }) }] : []),
          ...(done.length && canEdit ? [{ label: 'Borrar completadas', run: () => change(d, done.map((t) => ({ op: 'del', path: ['tasks', t.id] }))) }] : []),
          '-',
          { label: d.role === 'owner' ? 'Eliminar lista' : 'Salir de la lista', run: async () => {
            if (await confirm(win, d.role === 'owner' ? `¿Eliminar «${d.data.title}» para todos?` : `¿Salir de «${d.data.title}»?`)) cloud.remove(APP, d.id).catch((er) => ctx.notify(er.message));
          } },
        ], r.right - 220, r.bottom + 6);
      };
      // Añadir tarea
      const form = main.querySelector('.cl-add');
      if (form) {
        const input = form.querySelector('.text');
        const syncWhen = wireWhen(form);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const dueVal = form.querySelector('.due').value;
          const repeat = await parseRepeat(form.querySelector('.repeat').value, () => prompt(win, '¿Cada cuántos días?', '3'));
          const due = dueVal ? new Date(dueVal).toISOString() : null; // la fecha es opcional
          change(d, [{ op: 'set', path: ['tasks', uid()], value: { text, done: false, due, repeat, created: Date.now(), by: ctx.account.user } }]);
          input.value = '';
          form.querySelector('.due').value = '';
          form.querySelector('.repeat').value = '';
          syncWhen();
          input.focus();
        };
        form.querySelector('.text').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } };
        if (!document.activeElement || document.activeElement === document.body) input.focus();
      }
    }

    function change(d, ops) { cloud.ops(APP, d.id, ops).catch((e) => ctx.notify(e.message, 5000, { title: 'Listas', icon: APP })); }
    function toggle(d, t) {
      if (!t.done && t.repeat) {
        // Las tareas recurrentes no se quedan hechas: vuelven con la siguiente fecha.
        change(d, [{ op: 'set', path: ['tasks', t.id, 'due'], value: nextDate(t.due, t.repeat) }]);
        ctx.notify(`«${t.text}» volverá ${repeatText(t.repeat).toLowerCase()}.`, 3000, { title: 'Hecho', icon: APP });
        return;
      }
      change(d, [
        { op: 'set', path: ['tasks', t.id, 'done'], value: !t.done },
        { op: 'set', path: ['tasks', t.id, 'doneAt'], value: t.done ? null : Date.now() },
        { op: 'set', path: ['tasks', t.id, 'doneBy'], value: t.done ? null : ctx.account.user },
      ]);
    }
    function taskMenu(d, t, e) {
      const r = e.currentTarget.getBoundingClientRect();
      const members = people(d);
      ctx.menu([
        { label: 'Cambiar fecha límite…', run: async () => {
          const v = await prompt(win, 'Fecha límite (AAAA-MM-DD HH:MM, vacío para quitarla)', toLocalInput(t.due).replace('T', ' '));
          if (v === null) return;
          const due = v.trim() ? new Date(v.trim().replace(' ', 'T')) : null;
          if (due && isNaN(due)) return ctx.notify('Fecha no válida');
          change(d, [{ op: 'set', path: ['tasks', t.id, 'due'], value: due ? due.toISOString() : null }]);
        } },
        { label: t.repeat ? 'Dejar de repetir' : 'Repetir cada semana', run: () => change(d, [{ op: 'set', path: ['tasks', t.id, 'repeat'], value: t.repeat ? null : { unit: 'week', n: 1 } }]) },
        ...(members.length > 1 ? ['-', ...members.map((u) => ({ label: `${t.assignee === u ? '✓ ' : ''}Asignar a ${u}`, run: () => change(d, [{ op: 'set', path: ['tasks', t.id, 'assignee'], value: t.assignee === u ? null : u }]) }))] : []),
        '-',
        { label: 'Eliminar tarea', run: () => change(d, [{ op: 'del', path: ['tasks', t.id] }]) },
      ], r.right - 220, r.bottom + 6);
    }
    async function newList() {
      const title = await prompt(win, 'Nombre de la lista', 'Lista de casa');
      if (!title) return;
      try {
        const d = await cloud.create(APP, { title, emoji: EMOJIS[cloud.docs(APP).length % EMOJIS.length], tasks: {}, created: Date.now() });
        current = d.id; render();
      } catch (e) { ctx.notify(e.message); }
    }
    $('.add-list').onclick = newList;

    // Tiempo real y cuenta atrás que avanza sola.
    const off = cloud.subscribe(APP, () => {
      // No repintar mientras escribes en un campo editable.
      const a = document.activeElement;
      if (a && win.body.contains(a) && a.isContentEditable) { renderSide(); return; } // editando un texto
      // Repintamos conservando lo que estés escribiendo en «Añadir una tarea».
      const form = win.body.querySelector('.cl-add');
      const keep = form && { text: form.querySelector('.text').value, due: form.querySelector('.due').value, repeat: form.querySelector('.repeat').value, focus: a === form.querySelector('.text') };
      render();
      const f2 = win.body.querySelector('.cl-add');
      if (keep && f2) {
        f2.querySelector('.text').value = keep.text; f2.querySelector('.due').value = keep.due; f2.querySelector('.repeat').value = keep.repeat;
        if (keep.focus) f2.querySelector('.text').focus();
      }
    });
    const tick = setInterval(() => { if (!document.activeElement?.isContentEditable) win.body.querySelectorAll('.task').length && render(); }, 30000);
    win.onClose(() => { off(); clearInterval(tick); return true; });
    render();
  },
};
