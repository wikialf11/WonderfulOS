// Mensajes: chats con otras cuentas de WonderfulOS, uno a uno o en grupo, al instante.
import { cloud, uid, avatar, people, emptyState } from '../cloud.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { api } from '../api.js';
import { esc } from '../util.js';

const APP = 'mensajes';
const others = (d, me) => people(d).filter((u) => u !== me);
export const chatName = (d, me) => d.data.title || others(d, me).join(', ') || 'Solo tú';
const timeOf = (t) => {
  const d = new Date(t), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};
/** Mensajes sin leer de una conversación para `me`. */
export const unread = (d, me) => (d.data.messages || []).filter((m) => m.from !== me && m.at > (d.data.read?.[me] || 0)).length;

export default {
  id: APP,
  name: 'Mensajes',
  description: 'Chatea con otras cuentas de WonderfulOS',

  async launch(ctx, openId) {
    const me = ctx.account.user;
    const win = ctx.createWindow({ title: 'Mensajes', width: 900, height: 600 });
    win.body.classList.add('app-cloud', 'app-mensajes');
    win.body.innerHTML = `
      <aside class="cl-side">
        <div class="cl-side-head"><span>Mensajes</span><button class="icon-btn add" title="Nueva conversación">${GLYPHS.plus}</button></div>
        <nav class="cl-items"></nav>
      </aside>
      <section class="cl-main"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let current = openId || null;
    try { await cloud.load(APP); } catch (e) { $('.cl-main').innerHTML = emptyState(ICONS.mensajes, 'Sin conexión', e.message); return; }

    const lastAt = (d) => (d.data.messages || []).at(-1)?.at || d.data.created || 0;
    function renderSide() {
      const chats = cloud.docs(APP).sort((a, b) => lastAt(b) - lastAt(a));
      if (!current || !cloud.get(APP, current)) current = chats[0]?.id || null;
      $('.cl-items').innerHTML = '';
      for (const d of chats) {
        const last = (d.data.messages || []).at(-1);
        const n = d.id === current ? 0 : unread(d, me);
        const b = document.createElement('button');
        b.className = `cl-item chat-item${d.id === current ? ' on' : ''}`;
        const who = others(d, me);
        b.innerHTML = `${who.length > 1 ? `<span class="group-av">${who.slice(0, 2).map((u) => avatar(u, 22)).join('')}</span>` : avatar(who[0] || me, 36)}
          <span class="name"><strong>${esc(chatName(d, me))}</strong><small>${last ? esc(`${last.from === me ? 'Tú: ' : ''}${last.text}`).slice(0, 60) : 'Sin mensajes'}</small></span>
          <span class="when">${last ? timeOf(last.at) : ''}${n ? `<b class="badge-n">${n}</b>` : ''}</span>`;
        b.onclick = () => { current = d.id; render(); };
        $('.cl-items').appendChild(b);
      }
    }

    function render() {
      renderSide();
      const main = $('.cl-main');
      const d = current && cloud.get(APP, current);
      if (!d) {
        main.innerHTML = emptyState(ICONS.mensajes, 'Sin conversaciones', 'Pulsa + y escribe el nombre de usuario de otra persona de WonderfulOS.');
        return;
      }
      win.setTitle(chatName(d, me));
      const msgs = d.data.messages || [];
      main.innerHTML = `
        <header class="cl-head chat-head">
          <span class="people">${others(d, me).map((u) => avatar(u, 30)).join('') || avatar(me, 30)}</span>
          <h2 class="title">${esc(chatName(d, me))}</h2>
          <span class="grow"></span>
          <button class="icon-btn invite" title="Añadir persona">${GLYPHS.share}</button>
          <button class="icon-btn del" title="Salir de la conversación">${GLYPHS.trash}</button>
        </header>
        <div class="chat-log"></div>
        <form class="chat-input"><input placeholder="Escribe un mensaje" autocomplete="off"><button class="send" title="Enviar">${GLYPHS.send}</button></form>`;
      const log = main.querySelector('.chat-log');
      let prev = null;
      for (const m of msgs) {
        const mine = m.from === me;
        if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) {
          log.insertAdjacentHTML('beforeend', `<div class="day">${new Date(m.at).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`);
        }
        const group = prev && prev.from === m.from && m.at - prev.at < 120000;
        log.insertAdjacentHTML('beforeend', `<div class="msg${mine ? ' mine' : ''}${group ? ' cont' : ''}">
          ${!mine && !group && others(d, me).length > 1 ? `<small class="from">${esc(m.from)}</small>` : ''}
          <div class="bubble">${esc(m.text)}<span class="t">${new Date(m.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span></div></div>`);
        prev = m;
      }
      if (!msgs.length) log.innerHTML = '<div class="cl-hint">Di hola 👋</div>';
      log.scrollTop = log.scrollHeight;
      const form = main.querySelector('.chat-input');
      const input = form.querySelector('input');
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        cloud.ops(APP, d.id, [{ op: 'push', path: ['messages'], value: { id: uid(), from: me, at: Date.now(), text } }, { op: 'set', path: ['read', me], value: Date.now() }])
          .catch((er) => ctx.notify(er.message, 5000, { title: 'Mensajes', icon: APP }));
      };
      main.querySelector('.invite').onclick = async () => {
        const u = await prompt(win, 'Añadir a la conversación (usuario)', '');
        if (u) cloud.share(APP, d.id, u.trim().toLowerCase(), 'edit').catch((er) => ctx.notify(er.message));
      };
      main.querySelector('.del').onclick = async () => {
        if (await confirm(win, '¿Salir de esta conversación?')) cloud.remove(APP, d.id);
      };
      input.focus();
      // Marcar como leído.
      if (unread(d, me)) cloud.ops(APP, d.id, [{ op: 'set', path: ['read', me], value: Date.now() }]).catch(() => {});
    }

    $('.add').onclick = async () => {
      const raw = await prompt(win, 'Escribir a (usuario o usuarios separados por comas)', '');
      if (!raw) return;
      const users = raw.split(',').map((u) => u.trim().toLowerCase()).filter(Boolean);
      try {
        // Si ya hay un chat con esa persona, se abre ese.
        const existing = users.length === 1 && cloud.docs(APP).find((c) => others(c, me).length === 1 && others(c, me)[0] === users[0]);
        if (existing) { current = existing.id; return render(); }
        for (const u of users) {
          const { users: found } = await api(`users?q=${encodeURIComponent(u)}`);
          if (!found.includes(u)) throw new Error(`No existe el usuario ${u}`);
        }
        const d = await cloud.create(APP, { messages: [], read: {}, created: Date.now() });
        for (const u of users) await cloud.share(APP, d.id, u, 'edit');
        current = d.id; render();
      } catch (e) { ctx.notify(e.message, 5000, { title: 'Mensajes', icon: APP }); }
    };
    const off = cloud.subscribe(APP, () => {
      const a = document.activeElement;
      const typing = a && win.body.contains(a) && a.matches('.chat-input input') ? a.value : null;
      render();
      if (typing) { const i = win.body.querySelector('.chat-input input'); i.value = typing; }
    });
    win.onClose(() => { off(); return true; });
    render();
  },
};
