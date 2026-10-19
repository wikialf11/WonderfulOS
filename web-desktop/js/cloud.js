// Datos de las apps en la nube (server/appdata.mjs), con caché local, cambios
// optimistas y avisos en tiempo real: lo que cambia otra persona llega solo.
import { api } from './api.js';
import { esc } from './util.js';

const cache = new Map();     // app -> Map(id -> doc)
const listeners = new Map(); // app -> Set(fn)
const noticeListeners = new Set();
let source = null;

const emit = (app) => listeners.get(app)?.forEach((fn) => fn(docsOf(app)));
const docsOf = (app) => [...(cache.get(app)?.values() || [])];

function connect() {
  if (source) return;
  source = new EventSource('api/events');
  source.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'notice') return noticeListeners.forEach((fn) => fn(msg));
    const app = msg.doc?.app || msg.app;
    if (!cache.has(app)) return;
    if (msg.type === 'removed') cache.get(app).delete(msg.id);
    else cache.get(app).set(msg.doc.id, msg.doc);
    emit(app);
  };
  // Si se corta (servidor reiniciado, sin red), EventSource reconecta solo; al volver, recargamos.
  source.onopen = () => { for (const app of cache.keys()) cloud.load(app, true).catch(() => {}); };
}

// Aplica operaciones en local (mismo formato que el servidor).
function applyOps(data, ops) {
  for (const op of ops) {
    const keys = op.path;
    let o = data;
    for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    const last = keys.at(-1);
    if (op.op === 'set') o[last] = op.value;
    if (op.op === 'del') delete o[last];
    if (op.op === 'push') (o[last] = Array.isArray(o[last]) ? o[last] : []).push(op.value);
  }
}

export const cloud = {
  async load(app, force = false) {
    connect();
    if (!cache.has(app) || force) {
      const { docs } = await api(`apps/${app}`);
      cache.set(app, new Map(docs.map((d) => [d.id, d])));
      emit(app);
    }
    return docsOf(app);
  },
  docs: docsOf,
  get: (app, id) => cache.get(app)?.get(id) || null,
  subscribe(app, fn) {
    if (!listeners.has(app)) listeners.set(app, new Set());
    listeners.get(app).add(fn);
    return () => listeners.get(app).delete(fn);
  },
  onNotice(fn) { connect(); noticeListeners.add(fn); return () => noticeListeners.delete(fn); },

  async create(app, data) {
    const { doc } = await api(`apps/${app}`, { method: 'POST', body: { data } });
    cache.get(app)?.set(doc.id, doc);
    emit(app);
    return doc;
  },
  /** Cambia un documento: se ve al instante y luego se confirma con el servidor. */
  async ops(app, id, ops) {
    const doc = cache.get(app)?.get(id);
    if (doc) { applyOps(doc.data, structuredClone(ops)); emit(app); }
    try {
      const { doc: saved } = await api(`apps/${app}/${id}/ops`, { method: 'POST', body: { ops } });
      cache.get(app)?.set(id, saved);
      emit(app);
      return saved;
    } catch (e) {
      await cloud.load(app, true).catch(() => {}); // deshacemos lo optimista
      throw e;
    }
  },
  async share(app, id, to, role) {
    const { doc } = await api(`apps/${app}/${id}/members`, { method: 'POST', body: { to, role } });
    cache.get(app)?.set(id, doc); emit(app);
    return doc;
  },
  async unshare(app, id, who) {
    await api(`apps/${app}/${id}/members/${encodeURIComponent(who)}`, { method: 'DELETE' });
    await cloud.load(app, true);
  },
  async remove(app, id) {
    await api(`apps/${app}/${id}`, { method: 'DELETE' });
    cache.get(app)?.delete(id); emit(app);
  },
};

export const uid = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) .slice(0, 12);

// ---------- Piezas de interfaz comunes ----------
const COLORS = ['#f97316', '#3b82f6', '#10b981', '#eab308', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
export function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export const avatar = (name, size = 26) =>
  `<span class="avatar" title="${esc(name)}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${avatarColor(name)}">${esc(String(name)[0]?.toUpperCase() || '?')}</span>`;
export const people = (doc) => [doc.owner, ...Object.keys(doc.members || {})];

/** Diálogo «Compartir» genérico: invitar por usuario con un rol, ver y quitar. */
export function shareDialog(win, ctx, app, doc, { title, roles = [['edit', 'Puede editar'], ['read', 'Solo ver']] }) {
  const back = document.createElement('div');
  back.className = 'dialog-backdrop';
  back.innerHTML = `
    <div class="dialog share-dialog">
      <div class="head"><h3>Compartir «${esc(title)}»<small>Las personas que añadas lo verán al momento en su WonderfulOS.</small></h3></div>
      <div class="row">
        <input class="to" placeholder="Nombre de usuario de WonderfulOS" autocomplete="off" autocapitalize="none" spellcheck="false">
        ${roles.length > 1 ? `<select class="perm">${roles.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : ''}
      </div>
      <div class="suggest"></div>
      <div class="people"></div>
      <div class="actions"><button class="btn cancel">Listo</button><button class="btn primary ok">Invitar</button></div>
    </div>`;
  win.body.appendChild(back);
  const to = back.querySelector('.to');
  const suggest = back.querySelector('.suggest');
  const box = back.querySelector('.people');
  const roleName = Object.fromEntries(roles);
  const render = () => {
    const d = cloud.get(app, doc.id) || doc;
    box.innerHTML = '<small style="color:var(--muted)">Con acceso:</small>';
    for (const u of people(d)) {
      const row = document.createElement('div');
      row.className = 'person';
      const isOwner = u === d.owner;
      row.innerHTML = `${avatar(u, 30)}<span>${esc(u)}</span><small>${isOwner ? 'Propietario' : esc(roleName[d.members[u]] || d.members[u])}</small>${!isOwner && d.role === 'owner' ? '<button class="btn">Quitar</button>' : ''}`;
      row.querySelector('button')?.addEventListener('click', async () => {
        try { await cloud.unshare(app, d.id, u); render(); } catch (e) { ctx.notify(e.message); }
      });
      box.appendChild(row);
    }
  };
  render();
  let timer;
  to.oninput = () => {
    clearTimeout(timer);
    const q = to.value.trim().toLowerCase();
    if (!q) { suggest.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const { users } = await api(`users?q=${encodeURIComponent(q)}`);
        suggest.innerHTML = '';
        for (const u of users) {
          const b = document.createElement('button');
          b.textContent = u;
          b.onclick = () => { to.value = u; suggest.innerHTML = ''; to.focus(); };
          suggest.appendChild(b);
        }
      } catch { /* sin sugerencias */ }
    }, 200);
  };
  const submit = async () => {
    const user = to.value.trim().toLowerCase();
    if (!user) return to.focus();
    try {
      await cloud.share(app, doc.id, user, back.querySelector('.perm')?.value || roles[0][0]);
      to.value = ''; suggest.innerHTML = '';
      render();
    } catch (e) { ctx.notify(e.message, 5000, { title: 'Compartir' }); }
  };
  back.querySelector('.ok').onclick = submit;
  to.onkeydown = (e) => e.key === 'Enter' && submit();
  back.querySelector('.cancel').onclick = () => back.remove();
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  to.focus();
}

/** Estado vacío o de error con el mismo estilo en todas las apps. */
export const emptyState = (icon, title, text) => `<div class="app-empty">${icon}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
