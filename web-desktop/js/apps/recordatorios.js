// Recordatorios: avisos con fecha y hora. WonderfulOS te avisa cuando llega el momento
// (en cualquier dispositivo donde tengas WonderfulOS abierto). Las listas se pueden compartir.
import { cloud, uid, avatar, people, shareDialog, emptyState } from '../cloud.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { esc } from '../util.js';
import { parseRepeat, nextDate, repeatText, whenControls, wireWhen } from '../repeat.js';

const APP = 'recordatorios';
const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6'];
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const day = d.toDateString() === now.toDateString() ? 'Hoy'
    : d.toDateString() === new Date(now.getTime() + 864e5).toDateString() ? 'Mañana'
    : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Avisos en segundo plano: lo llama el escritorio al arrancar. */
export function startReminderAlerts(ctx) {
  const key = 'nubeos.avisados';
  const seen = new Set((() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } })());
  const check = () => {
    for (const d of cloud.docs(APP)) {
      const canEdit = ['owner', 'edit'].includes(d.role);
      for (const [id, r] of Object.entries(d.data.items || {})) {
        const key = `${id}|${r.at}`; // cada repetición avisa de nuevo
        if (r.done || !r.at || seen.has(key) || new Date(r.at) > Date.now()) continue;
        seen.add(key);
        // Solo avisamos de lo que vence ahora, no de lo atrasado de hace días.
        if (Date.now() - new Date(r.at) < 6 * 3600e3) {
          ctx.notify(r.text, 15000, { title: r.repeat ? `Recordatorio · ${repeatText(r.repeat).toLowerCase()}` : 'Recordatorio', icon: APP,
            action: r.repeat ? undefined : { label: 'Hecho', run: () => cloud.ops(APP, d.id, [{ op: 'set', path: ['items', id, 'done'], value: true }]) } });
        }
        // Los que se repiten (cumpleaños, pagos…) pasan solos a la siguiente vez.
        if (r.repeat && canEdit) cloud.ops(APP, d.id, [{ op: 'set', path: ['items', id, 'at'], value: nextDate(r.at, r.repeat) }]).catch(() => {});
      }
    }
    try { localStorage.setItem(key, JSON.stringify([...seen].slice(-500))); } catch { /* sin persistencia */ }
  };
  cloud.load(APP).then(check).catch(() => {});
  setInterval(check, 20000);
}

export default {
  id: APP,
  name: 'Recordatorios',
  description: 'Avisos a la hora que digas',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Recordatorios', width: 860, height: 560 });
    win.body.classList.add('app-cloud', 'app-recordatorios');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="cl-side-head"><span>Listas</span><button class="icon-btn add-list" title="Nueva lista">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let current = null;
    try {
      await cloud.load(APP);
      if (!cloud.docs(APP).some((d) => d.role === 'owner')) await cloud.create(APP, { name: 'Recordatorios', color: COLORS[0], items: {} });
    } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.recordatorios, 'Sin conexión', e.message); return; }

    function renderSide() {
      const lists = cloud.docs(APP);
      if (!current || !cloud.get(APP, current)) current = lists[0]?.id;
      $('.cl-items').innerHTML = '';
      for (const d of lists) {
        const n = Object.values(d.data.items || {}).filter((r) => !r.done).length;
        const b = document.createElement('button');
        b.className = `cl-item${d.id === current ? ' on' : ''}`;
        b.innerHTML = `<span class="dot" style="background:${d.data.color}"></span><span class="name">${esc(d.data.name)}</span>
          ${people(d).length > 1 ? `<span class="mini-people">${people(d).slice(0, 3).map((u) => avatar(u, 16)).join('')}</span>` : ''}<span class="count">${n || ''}</span>`;
        b.onclick = () => { current = d.id; render(); };
        $('.cl-items').appendChild(b);
      }
    }

    function render() {
      renderSide();
      const d = cloud.get(APP, current);
      const main = $('.cl-main');
      if (!d) { main.innerHTML = emptyState(ICONS.recordatorios, 'Sin listas', 'Crea una lista con +.'); return; }
      const canEdit = ['owner', 'edit'].includes(d.role);
      const items = Object.entries(d.data.items || {}).map(([id, r]) => ({ id, ...r }))
        .sort((a, b) => (a.done - b.done) || ((a.at ? new Date(a.at) : Infinity) - (b.at ? new Date(b.at) : Infinity)));
      main.innerHTML = `
        <header class="cl-head"><h2 class="title" style="color:${d.data.color}">${esc(d.data.name)}</h2><span class="grow"></span>
          <span class="people">${people(d).length > 1 ? people(d).map((u) => avatar(u, 26)).join('') : ''}</span>
          ${d.role === 'owner' ? `<button class="icon-btn share" title="Compartir">${GLYPHS.share}</button>` : ''}
          <button class="icon-btn del" title="Eliminar lista">${GLYPHS.trash}</button></header>
        ${canEdit ? `<form class="cl-add"><span class="plus">${GLYPHS.plus}</span><input class="text" placeholder="Nuevo recordatorio" autocomplete="off">
          ${whenControls(GLYPHS)}</form>` : ''}
        <div class="cl-tasks"></div>`;
      const box = main.querySelector('.cl-tasks');
      if (!items.length) box.innerHTML = '<div class="cl-hint">Nada pendiente.</div>';
      for (const r of items) {
        const late = !r.done && r.at && new Date(r.at) < Date.now();
        const el = document.createElement('div');
        el.className = `task${r.done ? ' done' : ''}`;
        el.innerHTML = `<button class="check round" style="--c:${d.data.color}" ${canEdit ? '' : 'disabled'}>${r.done ? GLYPHS.check : ''}</button>
          <div class="body"><div class="text">${esc(r.text)}</div>${r.at ? `<div class="meta"><span class="due ${late ? 'late' : ''}">${GLYPHS.clock}${when(r.at)}</span>${r.repeat ? `<span class="rep">${GLYPHS.repeat}${repeatText(r.repeat)}</span>` : ''}</div>` : ''}</div>
          ${canEdit ? `<button class="icon-btn rm" title="Eliminar">${GLYPHS.trash}</button>` : ''}`;
        el.querySelector('.check').onclick = () => {
          // Completar uno que se repite lo pasa a la próxima vez en lugar de tacharlo.
          if (r.repeat && !r.done) {
            cloud.ops(APP, d.id, [{ op: 'set', path: ['items', r.id, 'at'], value: nextDate(r.at, r.repeat) }]);
            ctx.notify(`Volverá ${when(nextDate(r.at, r.repeat)).toLowerCase()}.`, 3000, { title: r.text, icon: APP });
          } else cloud.ops(APP, d.id, [{ op: 'set', path: ['items', r.id, 'done'], value: !r.done }]);
        };
        el.querySelector('.rm')?.addEventListener('click', () => cloud.ops(APP, d.id, [{ op: 'del', path: ['items', r.id] }]));
        box.appendChild(el);
      }
      const form = main.querySelector('.cl-add');
      if (form) {
        const syncWhen = wireWhen(form);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const text = form.querySelector('.text').value.trim();
          if (!text) return;
          const at = form.querySelector('.due').value;
          const repeat = await parseRepeat(form.querySelector('.repeat').value, () => prompt(win, '¿Cada cuántos días?', '3'));
          if (repeat && !at) return ctx.notify('Para repetir un recordatorio, ponle fecha y hora (por ejemplo, el próximo cumpleaños).', 5000, { title: 'Recordatorios', icon: APP });
          cloud.ops(APP, d.id, [{ op: 'set', path: ['items', uid()], value: { text, at: at ? new Date(at).toISOString() : null, repeat, done: false, by: ctx.account.user } }]);
          form.reset();
          syncWhen();
          form.querySelector('.text').focus();
        };
        form.querySelector('.text').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } };
      }
      main.querySelector('.share')?.addEventListener('click', () => shareDialog(win, ctx, APP, d, { title: d.data.name }));
      main.querySelector('.del').onclick = async () => { if (await confirm(win, `¿${d.role === 'owner' ? 'Eliminar' : 'Dejar de ver'} «${d.data.name}»?`)) cloud.remove(APP, d.id); };
    }

    $('.add-list').onclick = async () => {
      const name = await prompt(win, 'Nombre de la lista', 'Trabajo');
      if (name) { const d = await cloud.create(APP, { name, color: COLORS[cloud.docs(APP).length % COLORS.length], items: {} }); current = d.id; render(); }
    };
    const off = cloud.subscribe(APP, () => {
      const t = win.body.querySelector('.cl-add .text');
      const keep = t && { v: t.value, at: win.body.querySelector('.cl-add .due').value, focus: document.activeElement === t };
      render();
      const t2 = win.body.querySelector('.cl-add .text');
      if (keep && t2) { t2.value = keep.v; win.body.querySelector('.cl-add .due').value = keep.at; if (keep.focus) t2.focus(); }
    });
    win.onClose(() => { off(); return true; });
    render();
  },
};
