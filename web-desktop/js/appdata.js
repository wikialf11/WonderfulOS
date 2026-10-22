// Datos de las apps (server/appdata.mjs), con caché local y cambios optimistas.
// El servicio es local: no hay cuentas remotas ni sincronización entre personas.
import { api } from './api.js';
import { esc } from './util.js';

const cache = new Map();     // app -> Map(id -> doc)
const listeners = new Map(); // app -> Set(fn)
let source = null;

const emit = (app) => listeners.get(app)?.forEach((fn) => fn(docsOf(app)));
const docsOf = (app) => [...(cache.get(app)?.values() || [])];
// Guarda un documento solo si es más nuevo. Así el aviso del servicio y la respuesta
// directa de una misma operación no repintan la app dos veces.
function put(app, doc) {
  const map = cache.get(app);
  if (!map) return false;
  const old = map.get(doc.id);
  if (old && Number(doc.version || 0) <= Number(old.version || 0)) return false;
  map.set(doc.id, doc);
  emit(app);
  return true;
}

function connect() {
  if (source) return;
  source = new EventSource('api/events');
  source.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const app = msg.doc?.app || msg.app;
    if (!cache.has(app)) return;
    if (msg.type === 'removed') { cache.get(app).delete(msg.id); emit(app); }
    else put(app, msg.doc);
  };
  // Si se corta (servicio reiniciado), EventSource reconecta solo; al volver, recargamos.
  source.onopen = () => { for (const app of cache.keys()) appdata.load(app, true).catch(() => {}); };
}

// Aplica operaciones en local (mismo formato que el servicio).
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

export const appdata = {
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
  async create(app, data) {
    const { doc } = await api(`apps/${app}`, { method: 'POST', body: { data } });
    cache.get(app)?.set(doc.id, doc);
    emit(app);
    return doc;
  },
  /** Cambia un documento: se ve al instante y luego se confirma con el servicio. */
  async ops(app, id, ops) {
    const doc = cache.get(app)?.get(id);
    if (doc) {
      applyOps(doc.data, ops);
      doc.version = Number(doc.version || 0) + 1;
      doc.updated = Date.now();
      emit(app);
    }
    try {
      const { doc: saved } = await api(`apps/${app}/${id}/ops`, { method: 'POST', body: { ops } });
      const map = cache.get(app);
      if (map) {
        const old = map.get(id);
        if (!old || Number(saved.version || 0) >= Number(old.version || 0)) {
          map.set(id, saved);
          if (!old || Number(saved.version || 0) > Number(old.version || 0)) emit(app);
        }
      }
      return saved;
    } catch (e) {
      await appdata.load(app, true).catch(() => {}); // deshacemos lo optimista
      throw e;
    }
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
/** Estado vacío o de error con el mismo estilo en todas las apps. */
export const emptyState = (icon, title, text) => `<div class="app-empty">${icon}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
