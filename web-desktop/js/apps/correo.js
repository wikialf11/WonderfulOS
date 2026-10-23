// Correo: cliente de correo de WonderfulOS basado en FairEmail (carpetas unificadas,
// lista compacta con estrellas y no leídos, lector y redacción) con el aspecto plano
// del sistema. Los mensajes son datos de la app "correo" (server/mail.mjs): la ventana
// se actualiza sola cuando Agentic busca, escribe, envía o borra correos.
import { appdata, emptyState } from '../appdata.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { confirm } from '../dialogs.js';
import { api } from '../api.js';
import { esc } from '../util.js';

const APP = 'correo';
const FOLDERS = [
  ['inbox', 'Recibidos', GLYPHS.download],
  ['starred', 'Destacados', GLYPHS.flame],
  ['drafts', 'Borradores', GLYPHS.rename],
  ['outbox', 'Bandeja de salida', GLYPHS.clock],
  ['sent', 'Enviados', GLYPHS.send],
  ['archive', 'Archivo', GLYPHS.doc],
  ['trash', 'Papelera', GLYPHS.trash],
];
const COLORS = ['#8b5cf6', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#ef4444', '#22c55e', '#6366f1'];

const nameOf = (addr) => String(addr || '').replace(/<.*>/, '').replace(/"/g, '').trim() || String(addr || '').replace(/[<>]/g, '') || '—';
const colorOf = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
function when(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export default {
  id: APP,
  name: 'Correo',
  description: 'Correo electrónico (basado en FairEmail)',

  async launch(ctx) {
    const win = ctx.createWindow({ title: 'Correo', width: 1100, height: 660 });
    win.body.classList.add('app-workspace', 'app-correo');
    win.body.innerHTML = `
      <aside class="cl-side">
        <button class="mail-compose">${GLYPHS.plus}<span>Redactar</span></button>
        <nav class="cl-items mail-folders"></nav>
        <span class="grow"></span>
        <div class="mail-account"></div>
      </aside>
      <section class="mail-list-pane">
        <header class="mail-list-head">
          <label class="cl-search">${GLYPHS.search}<input placeholder="Buscar en el correo"></label>
          <button class="icon-btn sync" title="Sincronizar">${GLYPHS.repeat}</button>
        </header>
        <div class="mail-list-title"><strong></strong><span class="grow"></span><button class="mail-link empty-btn" hidden>Vaciar</button></div>
        <div class="mail-list"></div>
      </section>
      <section class="cl-main mail-view"></section>`;
    const $ = (s) => win.body.querySelector(s);
    let folder = 'inbox', current = null, query = '', account = {}, editing = null;
    let composerFlush = null; // guarda pendiente del borrador abierto (al cambiar de vista o cerrar)

    try { await appdata.load(APP); } catch (e) { $('.mail-view').innerHTML = emptyState(ICONS.correo, 'No se pudo cargar', e.message); return; }
    const loadAccount = async () => { try { account = await api('email/account'); } catch { account = {}; } renderAccount(); };

    const inFolder = (d) => (folder === 'starred' ? d.data.starred && d.data.folder !== 'trash' : d.data.folder === folder);
    const visible = () => appdata.docs(APP)
      .filter((d) => (query ? d.data.folder !== 'trash' || folder === 'trash' : inFolder(d)))
      .filter((d) => !query || `${d.data.from} ${d.data.to} ${d.data.subject} ${d.data.body}`.toLowerCase().includes(query))
      .sort((a, b) => (b.data.date || b.updated) - (a.data.date || a.updated));

    function renderAccount() {
      $('.mail-account').innerHTML = account.configured
        ? `<span class="dot ok"></span><span class="name"><strong>${esc(account.name || account.email)}</strong><small${account.sync?.lastError ? ` title="${esc(account.sync.lastError)}"` : ''}>${account.sync?.lastError ? 'Error al sincronizar' : 'Conectado'}</small></span><button class="icon-btn settings" title="Cuenta">${GLYPHS.sliders}</button>`
        : `<span class="dot"></span><span class="name"><strong>Solo local</strong><small>Sin cuenta configurada</small></span><button class="icon-btn settings" title="Configurar cuenta">${GLYPHS.sliders}</button>`;
      $('.mail-account .settings').onclick = () => { current = null; editing = null; renderSettings(); };
    }

    function renderFolders() {
      const docs = appdata.docs(APP);
      $('.mail-folders').innerHTML = '';
      for (const [id, label, icon] of FOLDERS) {
        const items = docs.filter((d) => (id === 'starred' ? d.data.starred && d.data.folder !== 'trash' : d.data.folder === id));
        const n = id === 'inbox' ? items.filter((d) => !d.data.read).length : (['drafts', 'outbox'].includes(id) ? items.length : 0);
        const b = document.createElement('button');
        b.className = `cl-item${id === folder && !query ? ' on' : ''}`;
        b.innerHTML = `${icon}<span class="name">${label}</span>${n ? `<span class="count${id === 'inbox' ? ' strong' : ''}">${n}</span>` : ''}`;
        b.onclick = () => { folder = id; query = ''; $('.cl-search input').value = ''; current = null; editing = null; render(); };
        $('.mail-folders').appendChild(b);
      }
    }

    function renderList() {
      const items = visible();
      const label = query ? `Resultados para «${query}»` : FOLDERS.find(([id]) => id === folder)[1];
      $('.mail-list-title strong').textContent = `${label} · ${items.length}`;
      $('.empty-btn').hidden = query || !['trash', 'outbox', 'drafts'].includes(folder) || !items.length;
      $('.empty-btn').textContent = folder === 'trash' ? 'Vaciar papelera' : 'Vaciar';
      const list = $('.mail-list');
      list.innerHTML = '';
      if (!items.length) { list.innerHTML = `<div class="cl-hint">${query ? 'Nada coincide con la búsqueda.' : 'No hay correos en esta carpeta.'}</div>`; return; }
      for (const d of items) {
        const m = d.data;
        const who = ['sent', 'drafts', 'outbox'].includes(m.folder) ? `Para: ${nameOf(m.to) || '(sin destinatario)'}` : nameOf(m.from);
        const row = document.createElement('div');
        row.className = `mail-row${d.id === current ? ' on' : ''}${m.read ? '' : ' unread'}`;
        row.innerHTML = `
          <span class="avatar" style="background:${colorOf(who)}">${esc(who.replace(/^Para: /, '').charAt(0).toUpperCase() || '?')}</span>
          <span class="body">
            <span class="line1"><span class="who">${esc(who)}</span><span class="date">${when(m.date || d.updated)}</span></span>
            <span class="subject">${esc(m.subject || '(sin asunto)')}</span>
            <span class="snippet">${m.error && m.folder === 'outbox' ? `<em class="err">${esc(m.error)}</em>` : esc(String(m.body || '').replace(/\s+/g, ' ').slice(0, 110))}</span>
          </span>
          <button class="star${m.starred ? ' on' : ''}" title="Destacar">★</button>`;
        row.onclick = (e) => {
          if (e.target.closest('.star')) { appdata.ops(APP, d.id, [{ op: 'set', path: ['starred'], value: !m.starred }]); return; }
          current = d.id; editing = m.folder === 'drafts' || m.folder === 'outbox' ? d.id : null;
          if (!m.read) appdata.ops(APP, d.id, [{ op: 'set', path: ['read'], value: true }]);
          render();
        };
        list.appendChild(row);
      }
    }

    // ----- Lector -----
    function renderReader(d) {
      const m = d.data;
      win.setTitle(m.subject || 'Correo');
      $('.mail-view').innerHTML = `
        <header class="cl-head mail-actions">
          ${m.folder === 'trash'
            ? `<button class="btn restore">Restaurar</button><button class="btn danger forever">Eliminar para siempre</button>`
            : `<button class="icon-btn reply" title="Responder">${GLYPHS.back}</button>
               <button class="icon-btn forward" title="Reenviar">${GLYPHS.fwd}</button>
               <button class="icon-btn archive" title="Archivar">${GLYPHS.doc}</button>
               <button class="icon-btn unread" title="Marcar como no leído">${GLYPHS.mail}</button>
               <button class="icon-btn del" title="Mover a la Papelera">${GLYPHS.trash}</button>`}
          <span class="grow"></span>
          <span class="chip">${esc(FOLDERS.find(([id]) => id === m.folder)?.[1] || m.folder)}</span>
        </header>
        <article class="mail-read">
          <h1>${esc(m.subject || '(sin asunto)')}</h1>
          <div class="mail-meta">
            <span class="avatar big" style="background:${colorOf(nameOf(m.from))}">${esc(nameOf(m.from).charAt(0).toUpperCase())}</span>
            <div><strong>${esc(nameOf(m.from))}</strong> <small>${esc(m.from || '')}</small>
              <small class="to">Para: ${esc(m.to || '')}${m.cc ? ` · Cc: ${esc(m.cc)}` : ''}</small></div>
            <span class="grow"></span>
            <small>${new Date(m.date || d.updated).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</small>
          </div>
          ${m.attachments?.length ? `<div class="mail-attach">${m.attachments.map((a) => `<span>${GLYPHS.doc}${esc(a)}</span>`).join('')}</div>` : ''}
          <div class="mail-text">${esc(m.body || '')}</div>
        </article>`;
      const on = (s, fn) => { const el = $(`.mail-view ${s}`); if (el) el.onclick = fn; };
      const quote = () => `\n\n\nEl ${new Date(m.date || d.updated).toLocaleString('es-ES')}, ${m.from} escribió:\n${String(m.body || '').split('\n').map((l) => `> ${l}`).join('\n')}`;
      on('.reply', () => compose({ to: m.from, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject || ''}`, body: quote() }));
      on('.forward', () => compose({ to: '', subject: `Fwd: ${m.subject || ''}`, body: `\n\n---------- Mensaje reenviado ----------\nDe: ${m.from}\nAsunto: ${m.subject}\n\n${m.body || ''}` }));
      on('.archive', () => mailAction('move', { id: d.id, folder: 'archive' }, 'Archivado'));
      on('.unread', () => { appdata.ops(APP, d.id, [{ op: 'set', path: ['read'], value: false }]); current = null; render(); });
      on('.del', () => mailAction('trash', { id: d.id }, 'Movido a la Papelera'));
      on('.restore', () => mailAction('restore', { id: d.id }, 'Restaurado'));
      on('.forever', async () => { if (await confirm(win, '¿Eliminar este correo para siempre?')) mailAction('trash', { id: d.id, forever: true }, 'Eliminado'); });
    }

    async function mailAction(path, body, okMsg) {
      try { await api(`email/${path}`, { method: 'POST', body }); current = null; editing = null; if (okMsg) ctx.notify(okMsg); render(); }
      catch (e) { ctx.notify(e.message); }
    }

    // ----- Redacción (borradores guardados solos) -----
    async function compose(fields = {}) {
      try {
        const { doc } = await api('email/draft', { method: 'POST', body: fields });
        await appdata.load(APP, true);
        folder = 'drafts'; query = ''; current = doc.id; editing = doc.id; render();
        $('.mail-view [name=to]')?.focus();
      } catch (e) { ctx.notify(e.message); }
    }

    let saveTimer = null, saving = Promise.resolve();
    function renderComposer(d) {
      const m = d.data;
      win.setTitle(m.subject || 'Nuevo correo');
      $('.mail-view').innerHTML = `
        <header class="cl-head mail-actions">
          <button class="btn primary send">${GLYPHS.send}<span>Enviar</span></button>
          <span class="saved">Borrador guardado</span>
          <span class="grow"></span>
          <button class="icon-btn del" title="Descartar borrador">${GLYPHS.trash}</button>
        </header>
        ${m.error ? `<div class="mail-warn">${esc(m.error)}</div>` : ''}
        <form class="mail-compose-form" autocomplete="off">
          <label><span>Para</span><input name="to" value="${esc(m.to || '')}" placeholder="nombre@correo.com"></label>
          <label><span>Cc</span><input name="cc" value="${esc(m.cc || '')}"></label>
          <label><span>Asunto</span><input name="subject" value="${esc(m.subject || '')}"></label>
          <textarea name="body" placeholder="Escribe tu mensaje…">${esc(m.body || '')}</textarea>
        </form>`;
      const form = $('.mail-compose-form');
      const status = $('.mail-view .saved');
      const flush = () => {
        clearTimeout(saveTimer);
        const ops = ['to', 'cc', 'subject', 'body'].filter((k) => form[k].value !== (appdata.get(APP, d.id)?.data[k] || '')).map((k) => ({ op: 'set', path: [k], value: form[k].value }));
        if (!ops.length) return saving;
        ops.push({ op: 'set', path: ['date'], value: Date.now() });
        saving = appdata.ops(APP, d.id, ops).then(() => { status.textContent = 'Borrador guardado'; }).catch((e) => { status.textContent = e.message; });
        return saving;
      };
      composerFlush = flush;
      form.oninput = () => { status.textContent = 'Guardando…'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600); };
      form.onsubmit = (e) => e.preventDefault();
      form.body.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('.mail-view .send')?.click(); }
      };
      $('.mail-view .send').onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        await flush();
        try {
          const r = await api('email/send', { method: 'POST', body: { id: d.id } });
          composerFlush = null;
          ctx.notify(r.pendiente ? 'Sin cuenta: queda en la Bandeja de salida' : 'Correo enviado');
          current = null; editing = null; render();
        } catch (err) { ctx.notify(err.message); btn.disabled = false; }
      };
      $('.mail-view .del').onclick = async () => {
        clearTimeout(saveTimer);
        if (await confirm(win, '¿Descartar este borrador?')) { composerFlush = null; mailAction('trash', { id: d.id, forever: true }, 'Borrador descartado'); }
      };
    }

    // ----- Ajustes de la cuenta -----
    function renderSettings() {
      win.setTitle('Cuenta de correo');
      win.body.classList.add('mail-settings-open');
      renderList();
      $('.mail-view').innerHTML = `
        <header class="cl-head"><h1 class="title">Cuenta de correo</h1></header>
        <form class="mail-settings" autocomplete="off">
          <p class="cl-hint left">Escribe tu correo y contraseña: los servidores se detectan solos. En Gmail, Outlook, Yahoo o iCloud usa una <strong>contraseña de aplicación</strong> (las 16 letras, sin espacios). En Gmail, activa también IMAP en Configuración › Reenvío y correo POP/IMAP.</p>
          <label><span>Nombre</span><input name="name" value="${esc(account.name || '')}" placeholder="Tu nombre"></label>
          <label><span>Correo</span><input name="email" type="email" value="${esc(account.email || '')}" placeholder="tu@correo.com"></label>
          <label><span>Contraseña</span><input name="pass" type="password" placeholder="${account.hasPassword ? '•••••••• (guardada)' : 'Contraseña de aplicación (sin espacios)'}"></label>
          <details ${account.imapHost || account.smtpHost ? 'open' : ''}><summary>Servidores</summary>
            <label><span>IMAP</span><span class="server-fields"><input name="imapHost" value="${esc(account.imapHost || '')}" placeholder="imap.tucorreo.com"><input name="imapPort" class="port" value="${esc(account.imapPort || 993)}"></span></label>
            <label><span>SMTP</span><span class="server-fields"><input name="smtpHost" value="${esc(account.smtpHost || '')}" placeholder="smtp.tucorreo.com"><input name="smtpPort" class="port" value="${esc(account.smtpPort || 465)}"></span></label>
          </details>
          <label class="top"><span>Firma</span><textarea name="signature" rows="3">${esc(account.signature || '')}</textarea></label>
          <div class="row">
            <button class="btn primary save">Guardar y conectar</button>
            ${account.email ? '<button class="btn remove" type="button">Quitar cuenta</button>' : ''}
            <span class="status"></span>
          </div>
        </form>`;
      const f = $('.mail-settings');
      const status = f.querySelector('.status');
      f.email.onchange = async () => {
        try { const s = await api(`email/detect?email=${encodeURIComponent(f.email.value)}`); for (const k of ['imapHost', 'imapPort', 'smtpHost', 'smtpPort']) if (s[k]) f[k].value = s[k]; } catch { /* sin detección */ }
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f));
        if (!body.pass) delete body.pass;
        status.textContent = 'Conectando…';
        try {
          account = await api('email/account', { method: 'POST', body });
          if (account.configured) {
            await api('email/test', { method: 'POST' });
            status.textContent = 'Conectado. Descargando correos…';
            const r = await api('email/sync', { method: 'POST' });
            status.textContent = r.ok ? `Listo: ${r.nuevos} correos nuevos` : r.error;
          } else status.textContent = 'Guardado (falta la contraseña)';
        } catch (err) { status.textContent = err.message; }
        loadAccount();
      };
      f.querySelector('.remove')?.addEventListener('click', async () => {
        if (!(await confirm(win, '¿Quitar la cuenta? Los correos guardados se conservan.'))) return;
        account = await api('email/account', { method: 'DELETE' }); renderAccount(); renderSettings();
      });
    }

    function render() {
      // Antes de repintar se guarda lo que quede pendiente del temporizador de
      // autoguardado (al cambiar de carpeta, de correo, buscar o cerrar).
      const pendingSave = composerFlush;
      composerFlush = null;
      if (pendingSave && editing && appdata.get(APP, editing)) pendingSave();
      win.body.classList.remove('mail-settings-open');
      renderFolders();
      renderList();
      const d = current && appdata.get(APP, current);
      if (!d) {
        win.setTitle('Correo');
        $('.mail-view').innerHTML = emptyState(ICONS.correo, 'Ningún correo seleccionado', 'Elige un mensaje o pulsa Redactar. También puedes pedírselo a Agentic.');
        return;
      }
      if (editing === d.id && ['drafts', 'outbox'].includes(d.data.folder)) renderComposer(d);
      else renderReader(d);
    }

    $('.mail-compose').onclick = () => compose();
    $('.cl-search input').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
    $('.empty-btn').onclick = async () => {
      const name = FOLDERS.find(([id]) => id === folder)[1];
      if (await confirm(win, `¿Eliminar para siempre todos los correos de ${name}?`)) mailAction('empty', { folder }, `${name} vaciada`);
    };
    $('.sync').onclick = async (e) => {
      const b = e.currentTarget;
      if (!account.configured) { renderSettings(); return; }
      b.classList.add('spin');
      try { const r = await api('email/sync', { method: 'POST' }); ctx.notify(r.ok ? `${r.nuevos} correos nuevos` : r.error); }
      catch (err) { ctx.notify(err.message); }
      b.classList.remove('spin'); loadAccount();
    };

    // Cambios desde Agentic u otra ventana: no repintar el formulario mientras se escribe.
    const off = appdata.subscribe(APP, () => {
      const a = document.activeElement;
      if (a && win.body.contains(a) && a.closest('.mail-compose-form, .mail-settings')) { renderFolders(); renderList(); return; }
      if ($('.mail-settings')) { renderFolders(); renderList(); return; }
      render();
    });
    win.onClose(() => { off(); clearTimeout(saveTimer); const flush = composerFlush; composerFlush = null; flush?.(); return true; });
    await loadAccount();
    render();
  },
};
