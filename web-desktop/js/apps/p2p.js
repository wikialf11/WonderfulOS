// Compartir P2P en Archivos: lo compartido viaja directamente entre ordenadores (desktop/p2p.mjs).
// Se ve mientras el ordenador que lo comparte está encendido; los documentos se abren en su
// oficina, así que varias personas pueden trabajar a la vez en el mismo documento.
import { esc, humanSize } from '../util.js';
import { fileIcon, FILE_ICONS } from '../shell/icons.js';
import { openEditor, officeAppFor } from './office.js';

export const P2P_ROOT = '@p2p';
const p2p = (op, ...args) => window.nubeosDesktop.p2p(op, ...args);
const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function modal(win, html) {
  const back = document.createElement('div');
  back.className = 'dialog-backdrop';
  back.innerHTML = `<div class="dialog p2p-dialog">${html}</div>`;
  win.body.appendChild(back);
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') back.remove(); });
  return back;
}

/** Diálogo «Compartir por P2P»: genera el código que se pasa a la otra persona. */
export async function shareDialog(win, ctx, path) {
  const back = modal(win, `<h3>Compartir por P2P</h3>
    <p class="muted">Quien tenga este código verá «${esc(path.split('/').pop() || 'Inicio')}» directamente desde tu ordenador, sin servidores. Solo mientras tu ordenador esté encendido con WonderfulOS.</p>
    <p class="muted">Si los demás no consiguen conectar, revisa que el cortafuegos de tu ordenador permita conexiones entrantes a WonderfulOS.</p>
    <label class="p2p-perm"><span>Pueden</span><select><option value="edit">Ver, descargar y editar a la vez</option><option value="read">Solo ver y descargar</option></select></label>
    <div class="p2p-code" hidden><input readonly aria-label="Código para compartir"><button class="btn primary copy">Copiar</button></div>
    <div class="actions"><button class="btn cancel">Cerrar</button><button class="btn primary ok">Crear código</button></div>`);
  back.querySelector('.cancel').onclick = () => back.remove();
  back.querySelector('.ok').onclick = async () => {
    try {
      const s = await p2p('share', { path, perm: back.querySelector('select').value });
      const box = back.querySelector('.p2p-code');
      box.hidden = false;
      box.querySelector('input').value = s.code;
      box.querySelector('input').select();
      back.querySelector('.ok').hidden = true;
      back.querySelector('select').disabled = true;
      box.querySelector('.copy').onclick = () => { navigator.clipboard.writeText(s.code); ctx.notify('Código copiado. Pásaselo a quien quieras.', 3000, { title: 'Compartir por P2P', icon: 'archivos' }); };
    } catch (e) { ctx.notify(clean(e), 6000, { title: 'Compartir por P2P', icon: 'archivos' }); }
  };
}

/** Panel «Compartido P2P» dentro de Archivos. */
export function renderP2P(host, ctx, win, setCrumbs) {
  let view = { code: null, rel: '/', name: '' }; // null = lista de compartidos
  const guest = () => ctx.account?.user || 'Invitado';

  async function home() {
    view = { code: null, rel: '/', name: '' };
    setCrumbs([['Compartido P2P', home]]);
    host.innerHTML = '<div class="empty">Buscando los ordenadores conectados…</div>';
    const [mine, joined] = await Promise.all([p2p('mine').catch(() => []), p2p('joined').catch(() => [])]);
    host.className = 'files-items p2p';
    host.innerHTML = `
      <section class="p2p-join"><strong>Abrir algo compartido</strong><span class="muted">Pega el código que te han pasado (empieza por «wos-»).</span>
        <form><input placeholder="wos-…" aria-label="Código P2P" required><button class="btn primary">Añadir</button></form></section>
      <h4>Compartido conmigo</h4>
      <div class="p2p-list joined">${joined.length ? '' : '<div class="muted">Todavía nada. Cuando alguien te pase un código, añádelo arriba.</div>'}</div>
      <h4>Lo que comparto</h4>
      <div class="p2p-list mine">${mine.length ? '' : '<div class="muted">Nada. Para compartir, haz clic derecho en un archivo o carpeta › «Compartir por P2P…».</div>'}</div>`;
    host.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const input = host.querySelector('form input');
      try {
        const r = await p2p('join', input.value);
        ctx.notify(r.online ? 'Añadido. Ya puedes abrirlo.' : 'Añadido. Lo verás cuando el otro ordenador esté conectado.', 5000, { title: 'Compartido P2P', icon: 'archivos' });
        home();
      } catch (er) { ctx.notify(clean(er), 6000, { title: 'Compartido P2P', icon: 'archivos' }); }
    };
    const row = (icon, title, sub, state, actions) => {
      const r = document.createElement('div');
      r.className = 'p2p-row';
      r.innerHTML = `<span class="ic">${icon}</span><div class="t"><strong>${esc(title)}</strong><small>${esc(sub)}</small></div>${state}<div class="acts">${actions}</div>`;
      return r;
    };
    const dot = (on) => `<span class="p2p-state ${on ? 'on' : ''}">${on ? 'Conectado' : 'Sin conexión'}</span>`;
    for (const j of joined) {
      const r = row(j.kind === 'dir' ? FILE_ICONS.sharedFolder : fileIcon(j.name, false), j.name, `De ${j.owner || 'otro ordenador'} · ${j.perm === 'edit' ? 'puedes editar' : 'solo ver'}`, dot(j.online),
        `<button class="btn open" ${j.online ? '' : 'disabled'}>Abrir</button><button class="btn leave" title="Quitar">Quitar</button>`);
      r.querySelector('.open').onclick = () => browse(j.code, '/', j.name);
      r.querySelector('.leave').onclick = () => { p2p('leave', j.code).then(home); };
      host.querySelector('.joined').appendChild(r);
    }
    for (const s of mine) {
      const r = row(s.kind === 'dir' ? FILE_ICONS.sharedFolder : fileIcon(s.name, false), s.name, `${s.path} · ${s.perm === 'edit' ? 'pueden editar' : 'solo ver'}`, dot(s.online),
        `<button class="btn copy">Copiar código</button><button class="btn stop">Dejar de compartir</button>`);
      r.querySelector('.copy').onclick = () => { navigator.clipboard.writeText(s.code); ctx.notify('Código copiado.', 2500, { title: 'Compartido P2P', icon: 'archivos' }); };
      r.querySelector('.stop').onclick = () => { p2p('unshare', s.id).then(home); };
      host.querySelector('.mine').appendChild(r);
    }
  }

  async function browse(code, rel, name) {
    view = { code, rel, name };
    const parts = rel.split('/').filter(Boolean);
    setCrumbs([['Compartido P2P', home], [name, () => browse(code, '/', name)], ...parts.map((x, i) => [x, () => browse(code, '/' + parts.slice(0, i + 1).join('/'), name)])]);
    host.innerHTML = '<div class="empty">Conectando con el otro ordenador…</div>';
    let entries;
    try { ({ entries } = await p2p('browse', code, rel)); } catch (e) { host.innerHTML = `<div class="empty">${esc(clean(e))}</div>`; return; }
    host.className = 'files-items list';
    host.innerHTML = entries.length ? '' : '<div class="empty">Esta carpeta está vacía</div>';
    for (const e of entries) {
      const it = document.createElement('div');
      it.className = 'item';
      it.tabIndex = 0;
      it.innerHTML = `<div class="ic">${fileIcon(e.name, e.type === 'dir')}</div><div class="name">${esc(e.name)}</div><div class="meta">${e.type === 'file' ? humanSize(e.size) : ''}</div>`;
      const openIt = () => (e.type === 'dir' ? browse(code, e.rel, name) : openFile(code, e));
      it.ondblclick = openIt;
      it.onkeydown = (k) => { if (k.key === 'Enter') openIt(); };
      it.oncontextmenu = (ev) => {
        ev.preventDefault();
        ctx.menu([
          { label: 'Abrir', run: openIt },
          ...(e.type === 'file' ? [{ label: 'Descargar a Descargas', run: () => download(code, e) }] : []),
        ], ev.clientX, ev.clientY);
      };
      host.appendChild(it);
    }
  }

  async function download(code, e) {
    ctx.notify(`Descargando ${e.name}…`, 3000, { title: 'Compartido P2P', icon: 'archivos' });
    try {
      const p = await p2p('download', code, e.rel, e.name);
      await ctx.fs.reload();
      ctx.notify(`${e.name} está en Archivos › Descargas.`, 6000, { title: 'Compartido P2P', icon: 'archivos', action: { label: 'Abrir', run: () => ctx.openFile(p) } });
    } catch (er) { ctx.notify(clean(er), 6000, { title: 'Compartido P2P', icon: 'archivos' }); }
  }
  // Documentos de oficina: se abren en la oficina del otro ordenador (edición a la vez).
  // El resto se descarga y se abre aquí.
  function openFile(code, e) {
    const app = officeAppFor(e.name);
    if (!app) return download(code, e);
    openEditor(ctx, app, e.name, null, () => p2p('office', code, e.rel, guest(), location.origin));
  }

  home();
  return { refresh: () => (view.code ? browse(view.code, view.rel, view.name) : home()) };
}
