// Calendario: vista de mes con varios calendarios (propios y compartidos).
import { cloud, uid, avatar, people, shareDialog, emptyState } from '../cloud.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { esc } from '../util.js';

const APP = 'calendario';
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#0ea5e9', '#a855f7'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export default {
  id: APP,
  name: 'Calendario',
  description: 'Tus citas y recordatorios',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Calendario', width: 1040, height: 660 });
    win.body.classList.add('app-cloud', 'app-calendario');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="mini-today"></div>
        <div class="cl-side-head"><span>Calendarios</span><button class="icon-btn add-cal" title="Nuevo calendario">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
        <div class="day-list"></div>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let month = new Date(); month.setDate(1);
    let selected = ymd(new Date());
    const hidden = new Set();
    try {
      await cloud.load(APP);
      if (!cloud.docs(APP).some((d) => d.role === 'owner')) await cloud.create(APP, { name: 'Personal', color: COLORS[0], events: {} });
    } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.calendario, 'Sin conexión', e.message); return; }

    const cals = () => cloud.docs(APP).sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1));
    const eventsOn = (day) => cals().filter((c) => !hidden.has(c.id)).flatMap((c) =>
      Object.entries(c.data.events || {}).filter(([, e]) => e.date === day).map(([id, e]) => ({ id, cal: c, ...e })))
      .sort((a, b) => (a.start || '00:00').localeCompare(b.start || '00:00'));

    function renderSide() {
      const t = new Date();
      $('.mini-today').innerHTML = `<small>${t.toLocaleDateString('es-ES', { weekday: 'long' })}</small><strong>${t.getDate()}</strong><span>${t.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</span>`;
      $('.cl-items').innerHTML = '';
      for (const c of cals()) {
        const b = document.createElement('div');
        b.className = 'cl-item cal-item';
        b.innerHTML = `<input type="checkbox" ${hidden.has(c.id) ? '' : 'checked'} style="accent-color:${c.data.color}">
          <span class="name">${esc(c.data.name)}${c.role !== 'owner' ? ` <small>de ${esc(c.owner)}</small>` : ''}</span>
          ${people(c).length > 1 ? `<span class="mini-people">${people(c).slice(0, 3).map((u) => avatar(u, 16)).join('')}</span>` : ''}
          <button class="icon-btn more" title="Opciones">${GLYPHS.more}</button>`;
        b.querySelector('input').onchange = (e) => { e.target.checked ? hidden.delete(c.id) : hidden.add(c.id); render(); };
        b.querySelector('.more').onclick = (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctx.menu([
            ...(c.role === 'owner' ? [
              { label: 'Compartir…', run: () => shareDialog(win, ctx, APP, c, { title: c.data.name }) },
              { label: 'Cambiar nombre…', run: async () => { const n = await prompt(win, 'Nombre del calendario', c.data.name); if (n) cloud.ops(APP, c.id, [{ op: 'set', path: ['name'], value: n }]); } },
              ...COLORS.map((col) => ({ label: `${col === c.data.color ? '● ' : '○ '}Color`, run: () => cloud.ops(APP, c.id, [{ op: 'set', path: ['color'], value: col }]) })),
            ] : []),
            '-',
            { label: c.role === 'owner' ? 'Eliminar calendario' : 'Dejar de ver', run: async () => { if (await confirm(win, `¿${c.role === 'owner' ? 'Eliminar' : 'Dejar de ver'} «${c.data.name}»?`)) cloud.remove(APP, c.id); } },
          ], r.right - 200, r.bottom + 4);
        };
        $('.cl-items').appendChild(b);
      }
      // Lista del día elegido
      const list = eventsOn(selected);
      const dayTitle = new Date(`${selected}T12:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      $('.day-list').innerHTML = `<div class="dl-head"><strong>${esc(dayTitle)}</strong><button class="icon-btn add-ev" title="Nuevo evento">${GLYPHS.plus}</button></div>
        ${list.length ? list.map((e) => `<button class="ev-row" data-id="${e.id}" data-cal="${e.cal.id}"><span class="bar" style="background:${e.cal.data.color}"></span><span><strong>${esc(e.title)}</strong><small>${e.start ? `${e.start}${e.end ? `–${e.end}` : ''}` : 'Todo el día'} · ${esc(e.cal.data.name)}</small></span></button>`).join('') : '<div class="cl-hint">Nada este día</div>'}`;
      $('.add-ev').onclick = () => editEvent(null, selected);
      $('.day-list').querySelectorAll('.ev-row').forEach((b) => { b.onclick = () => editEvent(cloud.get(APP, b.dataset.cal), selected, b.dataset.id); });
    }

    function render() {
      renderSide();
      const main = $('.cl-main');
      const title = month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      win.setTitle('Calendario');
      main.innerHTML = `
        <header class="cl-head cal-head">
          <h2 class="title">${title[0].toUpperCase() + title.slice(1)}</h2>
          <span class="grow"></span>
          <div class="seg"><button class="icon-btn prev">${GLYPHS.back}</button><button class="today btn">Hoy</button><button class="icon-btn next">${GLYPHS.fwd}</button></div>
        </header>
        <div class="cal-grid">${DAYS.map((d) => `<div class="dow">${d}</div>`).join('')}</div>`;
      const grid = main.querySelector('.cal-grid');
      const first = new Date(month);
      const offset = (first.getDay() + 6) % 7;
      const start = new Date(first); start.setDate(1 - offset);
      const today = ymd(new Date());
      for (let i = 0; i < 42; i++) {
        const day = new Date(start); day.setDate(start.getDate() + i);
        const key = ymd(day);
        const evs = eventsOn(key);
        const cell = document.createElement('div');
        cell.className = `cell${day.getMonth() !== month.getMonth() ? ' out' : ''}${key === today ? ' today' : ''}${key === selected ? ' sel' : ''}`;
        cell.innerHTML = `<span class="num">${day.getDate()}</span>${evs.slice(0, 3).map((e) => `<span class="ev" style="--c:${e.cal.data.color}">${e.start ? `<b>${e.start}</b> ` : ''}${esc(e.title)}</span>`).join('')}${evs.length > 3 ? `<span class="more-ev">+${evs.length - 3} más</span>` : ''}`;
        // Un clic elige el día; otro clic en el día ya elegido crea un evento.
        cell.onclick = () => { if (selected === key) editEvent(null, key); else { selected = key; render(); } };
        grid.appendChild(cell);
      }
      main.querySelector('.prev').onclick = () => { month.setMonth(month.getMonth() - 1); render(); };
      main.querySelector('.next').onclick = () => { month.setMonth(month.getMonth() + 1); render(); };
      main.querySelector('.today').onclick = () => { month = new Date(); month.setDate(1); selected = ymd(new Date()); render(); };
    }

    // Crear o editar un evento en un diálogo.
    function editEvent(cal, day, id) {
      const writable = cals().filter((c) => ['owner', 'edit'].includes(c.role));
      const ev = id ? cal.data.events[id] : null;
      const canEdit = !ev || ['owner', 'edit'].includes(cal.role);
      const back = document.createElement('div');
      back.className = 'dialog-backdrop';
      back.innerHTML = `<form class="dialog ev-dialog">
        <h3>${ev ? (canEdit ? 'Editar evento' : esc(ev.title)) : 'Nuevo evento'}</h3>
        <input name="title" placeholder="Título" value="${esc(ev?.title || '')}" ${canEdit ? '' : 'readonly'} required>
        <div class="row"><input type="date" name="date" value="${ev?.date || day}" ${canEdit ? '' : 'readonly'}>
          <input type="time" name="start" value="${ev?.start || ''}" ${canEdit ? '' : 'readonly'}><input type="time" name="end" value="${ev?.end || ''}" ${canEdit ? '' : 'readonly'}></div>
        <select name="cal" ${ev ? 'disabled' : ''}>${(ev ? [cal] : writable).map((c) => `<option value="${c.id}">${esc(c.data.name)}</option>`).join('')}</select>
        <textarea name="notes" placeholder="Notas" rows="3" ${canEdit ? '' : 'readonly'}>${esc(ev?.notes || '')}</textarea>
        <div class="actions">${ev && canEdit ? '<button type="button" class="btn del" style="margin-right:auto">Eliminar</button>' : ''}<button type="button" class="btn cancel">Cerrar</button>${canEdit ? '<button class="btn primary">Guardar</button>' : ''}</div>
      </form>`;
      win.body.appendChild(back);
      const form = back.querySelector('form');
      const f = form.elements;
      f.title.focus();
      back.querySelector('.cancel').onclick = () => back.remove();
      back.querySelector('.del')?.addEventListener('click', () => { cloud.ops(APP, cal.id, [{ op: 'del', path: ['events', id] }]); back.remove(); });
      form.onsubmit = (e) => {
        e.preventDefault();
        const target = ev ? cal : cloud.get(APP, f.cal.value);
        const value = { title: f.title.value.trim(), date: f.date.value, start: f.start.value, end: f.end.value, notes: f.notes.value, by: ctx.account.user };
        cloud.ops(APP, target.id, [{ op: 'set', path: ['events', id || uid()], value }]).catch((er) => ctx.notify(er.message));
        selected = value.date;
        back.remove();
      };
    }

    $('.add-cal').onclick = async () => {
      const name = await prompt(win, 'Nombre del calendario', 'Trabajo');
      if (name) cloud.create(APP, { name, color: COLORS[cloud.docs(APP).length % COLORS.length], events: {} });
    };
    const off = cloud.subscribe(APP, render);
    win.onClose(() => { off(); return true; });
    render();
  },
};
