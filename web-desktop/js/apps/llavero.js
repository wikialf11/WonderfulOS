// Llavero: tus contraseñas, cifradas con tu contraseña maestra (ver js/keychain.js).
import { keychain, generatePassword, strength, hostOf } from '../keychain.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { confirm } from '../dialogs.js';
import { avatarColor, emptyState } from '../cloud.js';
import { esc } from '../util.js';

const STRENGTH = [['Muy débil', '#ef4444'], ['Débil', '#f97316'], ['Aceptable', '#eab308'], ['Fuerte', '#22c55e'], ['Muy fuerte', '#10b981']];
const copy = (ctx, text, what) => {
  const write = navigator.clipboard?.writeText(text);
  if (!write) return ctx.notify('No se pudo copiar al portapapeles.', 4000, { title: 'Llavero', icon: 'llavero' });
  return write.then(() => {
    ctx.notify(`Copiado: ${what}. Se borrará del portapapeles en 30 s.`, 3000, { title: 'Llavero', icon: 'llavero' });
    setTimeout(() => navigator.clipboard.readText().then((t) => t === text && navigator.clipboard.writeText('')).catch(() => {}), 30000);
  }).catch(() => ctx.notify('No se pudo copiar al portapapeles.', 4000, { title: 'Llavero', icon: 'llavero' }));
};

export default {
  id: 'llavero',
  name: 'Llavero',
  description: 'Tus contraseñas, cifradas en tu disco',

  async launch(ctx, opts = {}) {
    const win = ctx.createWindow({ title: 'Llavero', width: 880, height: 580 });
    win.body.classList.add('app-cloud', 'app-llavero');
    const $ = (s) => win.body.querySelector(s);
    let current = null, query = '', editing = null, reveal = false;
    try { await keychain.init(); } catch (e) { win.body.innerHTML = emptyState(ICONS.llavero, 'No se pudo abrir el llavero', e.message); return; }

    function lockScreen() {
      const first = !keychain.isSetUp();
      win.body.innerHTML = `<form class="kc-lock">
        <div class="kc-icon">${ICONS.llavero}</div>
        <h2>${first ? 'Crea tu llavero' : 'Llavero bloqueado'}</h2>
        <p>${first ? 'Elige una contraseña maestra. Tus contraseñas se guardan cifradas en este dispositivo, sin cuenta ni conexión: nadie más puede leerlas, ni siquiera WonderfulOS. <strong>Si la olvidas, no se pueden recuperar.</strong>' : 'Escribe tu contraseña maestra para ver tus contraseñas.'}</p>
        <input type="password" name="p1" placeholder="Contraseña maestra" autocomplete="${first ? 'new-password' : 'current-password'}" required>
        ${first ? '<input type="password" name="p2" placeholder="Repítela" autocomplete="new-password" required>' : ''}
        <p class="err" hidden></p>
        <button class="btn primary">${first ? 'Crear llavero' : 'Desbloquear'}</button>
      </form>`;
      const f = win.body.querySelector('form');
      f.p1.focus();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.err');
        const btn = f.querySelector('button');
        btn.disabled = true; err.hidden = true;
        try {
          if (first) {
            if (f.p1.value !== f.p2.value) throw new Error('Las dos contraseñas no coinciden');
            await keychain.setUp(f.p1.value);
          } else await keychain.unlock(f.p1.value);
          render();
        } catch (er) { err.textContent = er.message; err.hidden = false; btn.disabled = false; f.p1.select(); }
      };
    }

    function render() {
      if (!keychain.isUnlocked()) return lockScreen();
      if (!$('.cl-side')) {
        win.body.innerHTML = `
          <aside class="cl-side">
            <div class="cl-side-head"><label class="cl-search">${GLYPHS.search}<input placeholder="Buscar"></label><button class="icon-btn add" title="Nueva contraseña">${GLYPHS.plus}</button></div>
            <nav class="cl-items"></nav>
            <button class="btn lock" style="margin-top:auto">Bloquear</button>
          </aside>
          <section class="cl-main"></section>`;
        $('.cl-search input').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
        $('.add').onclick = () => { editing = {}; current = null; render(); };
        $('.lock').onclick = () => keychain.lock();
      }
      const list = keychain.entries().filter((e) => !query || `${e.name} ${e.site} ${e.user}`.toLowerCase().includes(query));
      if (!editing && (!current || !list.some((e) => e.id === current))) current = list[0]?.id || null;
      $('.cl-items').innerHTML = '';
      for (const e of list) {
        const b = document.createElement('button');
        b.className = `cl-item${e.id === current && !editing ? ' on' : ''}`;
        const label = e.name || e.site || 'Sin nombre';
        b.innerHTML = `<span class="site-av" style="background:${avatarColor(e.site || label)}">${esc(label[0].toUpperCase())}</span><span class="name">${esc(label)}<small>${esc(e.user)}</small></span>`;
        b.onclick = () => { current = e.id; editing = null; reveal = false; render(); };
        $('.cl-items').appendChild(b);
      }
      const main = $('.cl-main');
      if (editing) return editForm(main, editing);
      const e = keychain.entries().find((x) => x.id === current);
      if (!e) { main.innerHTML = emptyState(ICONS.llavero, 'Sin contraseñas', 'Pulsa + para guardar la primera, o guárdalas al iniciar sesión desde el Navegador.'); return; }
      const [sLabel, sColor] = STRENGTH[strength(e.pass)];
      main.innerHTML = `
        <header class="cl-head"><span class="site-av big" style="background:${avatarColor(e.site || e.name)}">${esc((e.name || e.site || '?')[0].toUpperCase())}</span>
          <h2 class="title">${esc(e.name || e.site)}</h2><span class="grow"></span>
          <button class="icon-btn edit" title="Editar">${GLYPHS.rename}</button><button class="icon-btn del" title="Eliminar">${GLYPHS.trash}</button></header>
        <div class="kc-fields">
          ${e.site ? `<div class="kc-field"><label>Web</label><span>${esc(e.site)}</span><button class="btn open">Abrir</button></div>` : ''}
          <div class="kc-field"><label>Usuario</label><span>${esc(e.user || '—')}</span>${e.user ? '<button class="btn cu">Copiar</button>' : ''}</div>
          <div class="kc-field"><label>Contraseña</label><span class="mono">${reveal ? esc(e.pass) : '••••••••••••'}</span><button class="btn rv">${reveal ? 'Ocultar' : 'Mostrar'}</button><button class="btn primary cp">Copiar</button></div>
          <div class="kc-strength"><span style="width:${(strength(e.pass) + 1) * 20}%;background:${sColor}"></span></div><small style="color:${sColor}">${sLabel}</small>
          ${e.notes ? `<div class="kc-field notes"><label>Notas</label><span>${esc(e.notes)}</span></div>` : ''}
        </div>`;
      main.querySelector('.cu')?.addEventListener('click', () => copy(ctx, e.user, 'Usuario'));
      main.querySelector('.cp').onclick = () => copy(ctx, e.pass, 'Contraseña');
      main.querySelector('.rv').onclick = () => { reveal = !reveal; render(); };
      main.querySelector('.open')?.addEventListener('click', () => ctx.launch('navegador', `https://${e.site}`));
      main.querySelector('.edit').onclick = () => { editing = { ...e }; render(); };
      main.querySelector('.del').onclick = async () => { if (await confirm(win, `¿Eliminar la contraseña de «${e.name || e.site}»?`)) keychain.remove(e.id); };
    }

    function editForm(main, e) {
      main.innerHTML = `<form class="kc-edit">
        <h2>${e.id ? 'Editar' : 'Nueva contraseña'}</h2>
        <label>Nombre<input name="name" value="${esc(e.name || '')}" placeholder="Correo personal"></label>
        <label>Web<input name="site" value="${esc(e.site || '')}" placeholder="ejemplo.com" autocapitalize="none" spellcheck="false"></label>
        <label>Usuario<input name="user" value="${esc(e.user || '')}" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
        <label>Contraseña<div class="row"><input name="pass" value="${esc(e.pass || '')}" class="mono" autocomplete="off" spellcheck="false"><button type="button" class="btn gen">Generar</button></div></label>
        <div class="kc-strength"><span></span></div>
        <label>Notas<textarea name="notes" rows="3">${esc(e.notes || '')}</textarea></label>
        <div class="actions"><button type="button" class="btn cancel">Cancelar</button><button class="btn primary">Guardar</button></div>
      </form>`;
      const form = main.querySelector('form');
      const f = form.elements;
      const meter = () => { const s = strength(f.pass.value); const bar = form.querySelector('.kc-strength span'); bar.style.width = `${(s + 1) * 20}%`; bar.style.background = STRENGTH[s][1]; };
      f.pass.oninput = meter; meter();
      form.querySelector('.gen').onclick = () => { f.pass.value = generatePassword(); meter(); };
      form.querySelector('.cancel').onclick = () => { editing = null; render(); };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (!f.pass.value) return f.pass.focus();
        try {
          current = await keychain.save({ id: e.id, name: f.name.value.trim(), site: f.site.value.trim(), user: f.user.value.trim(), pass: f.pass.value, notes: f.notes.value });
          editing = null; render();
        } catch (er) { ctx.notify(er.message, 5000, { title: 'Llavero', icon: 'llavero' }); }
      };
      (e.id ? f.pass : f.name).focus();
    }

    if (opts.new) editing = opts.new;
    const off = keychain.onChange(() => { if (!editing || !keychain.isUnlocked()) { if (!keychain.isUnlocked()) editing = null; render(); } });
    win.onClose(() => { off(); return true; });
    render();
  },
};
