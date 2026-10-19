// Sistema de archivos del escritorio.
//
// Modo nube (con server.mjs): los archivos de cada usuario viven en el servidor.
// Se cargan al iniciar sesión y cada cambio se aplica al momento en memoria y se
// envía al servidor en segundo plano, así las apps usan una API síncrona.
// Modo local (sin servidor): todo en localStorage, como en el primer MVP.
//
// Lo que otros usuarios comparten contigo aparece montado en "/Compartido conmigo".

import { api } from './api.js';

export const SHARED_ROOT = '/Compartido conmigo';
const LOCAL_KEY = 'nubeos.fs.v1';

let mode = 'local';
let nodes = {};
let mounts = {};      // ruta -> nodo, para lo compartido contigo (con .share, .rel, .perm)
let incoming = [];    // compartidos recibidos tal como los da el servidor
let outgoing = [];
const listeners = new Set();
const errorListeners = new Set();
let queue = [];
let flushing = null;

export const normalize = (p) => {
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return '/' + parts.join('/');
};
export const dirname = (p) => normalize(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p) => normalize(p).split('/').pop();
export const extname = (p) => { const m = basename(p).match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ''; };
const within = (p, root) => p === root || p.startsWith(root === '/' ? '/' : root + '/');

function localSeed() {
  const now = Date.now();
  return {
    '/': { type: 'dir', mtime: now },
    '/Documentos': { type: 'dir', mtime: now },
    '/Descargas': { type: 'dir', mtime: now },
    '/Imágenes': { type: 'dir', mtime: now },
    '/Documentos/Bienvenida.txt': {
      type: 'file', mtime: now,
      content: 'Bienvenido a WonderfulOS.\n\nEstás en modo local: tus archivos se guardan solo en este navegador.\nArranca WonderfulOS con "node server.mjs" para tener cuenta, archivos en la nube y compartir.\n',
    },
  };
}

// ---------- Arranque ----------
/** Devuelve 'cloud', 'login' (hay servidor pero falta sesión) o 'local'. */
export async function initFs() {
  try {
    const { nodes: remote } = await api('fs');
    mode = 'cloud';
    nodes = remote;
    await refreshShares();
    return 'cloud';
  } catch (err) {
    if (err.status === 401) return 'login';
    mode = 'local';
    try { nodes = JSON.parse(localStorage.getItem(LOCAL_KEY)) || localSeed(); } catch { nodes = localSeed(); }
    for (const d of ['/Documentos', '/Descargas', '/Imágenes']) nodes[d] ??= { type: 'dir', mtime: Date.now() };
    return 'local';
  }
}

export const isCloud = () => mode === 'cloud';

// ---------- Persistencia ----------
function changed() { listeners.forEach((fn) => fn()); }

function commit(op) {
  if (mode === 'local') {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(nodes)); } catch { /* sin persistencia */ }
  } else {
    queue.push(op);
    flushing ??= Promise.resolve().then(flush);
  }
  changed();
}

async function flush() {
  while (queue.length) {
    const batch = queue;
    queue = [];
    // Las operaciones sobre lo compartido van a su propia ruta de la API.
    const groups = [];
    for (const op of batch) {
      const key = op.share || '';
      const last = groups.at(-1);
      if (last && last.key === key) last.ops.push(op.body); else groups.push({ key, ops: [op.body] });
    }
    for (const g of groups) {
      try {
        await api(g.key ? `shares/${g.key}/ops` : 'fs', { method: 'POST', body: { ops: g.ops } });
      } catch (err) {
        errorListeners.forEach((fn) => fn(`No se pudo guardar: ${err.message}`));
        if (g.key) await refreshShares();
      }
    }
  }
  flushing = null;
}

// ---------- Compartido conmigo ----------
// "Informe.txt" de ana → "Informe (de ana).txt": así conserva su extensión y se abre con su app.
const shareName = (s) => {
  if (s.kind === 'app') return `${s.app.name} (app de ${s.owner})`;
  const name = (s.path || '').split('/').pop();
  const m = s.kind === 'file' && name.match(/^(.+)(\.[^.]+)$/);
  return m ? `${m[1]} (de ${s.owner})${m[2]}` : `${name} (de ${s.owner})`;
};

function buildMounts() {
  mounts = {};
  if (!incoming.length) return;
  mounts[SHARED_ROOT] = { type: 'dir', mtime: Date.now(), virtual: true };
  for (const s of incoming) {
    const base = `${SHARED_ROOT}/${shareName(s).replace(/\//g, '-')}`;
    const meta = { share: s.id, owner: s.owner, perm: s.perm || 'read' };
    if (s.kind === 'app') { mounts[base] = { type: 'file', sharedApp: s.app, ...meta, perm: 'read', mtime: s.created }; continue; }
    for (const [rel, n] of Object.entries(s.nodes || {})) {
      mounts[rel === '/' ? base : base + rel] = { ...n, ...meta, rel, shareKind: s.kind, shareBase: base };
    }
  }
}

/** Vuelve a pedir lo compartido. Devuelve los compartidos nuevos desde la última vez. */
export async function refreshShares() {
  if (mode !== 'cloud') return [];
  const before = new Set(incoming.map((s) => s.id));
  const res = await api('shares');
  incoming = res.incoming;
  outgoing = res.outgoing;
  buildMounts();
  changed();
  return incoming.filter((s) => !before.has(s.id));
}

const node = (p) => mounts[p] || nodes[p];

function shareOp(p, body) {
  const m = mounts[p] || mounts[dirname(p)];
  if (!m?.share || m.virtual) throw new Error('No se puede modificar "Compartido conmigo"');
  if (m.perm !== 'edit') throw new Error(`Solo tienes permiso de lectura (compartido por ${m.owner})`);
  return { share: m.share, base: m.shareBase || dirname(p) };
}
const relTo = (p, base, kind) => (kind === 'file' ? '/' : (p.slice(base.length) || '/'));

// ---------- API pública ----------
export const fs = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },

  exists(p) { return !!node(normalize(p)); },
  isDir(p) { return node(normalize(p))?.type === 'dir'; },
  stat(p) { return node(normalize(p)) || null; },
  isShared(p) { return within(normalize(p), SHARED_ROOT) && !!mounts[normalize(p)]; },

  list(dir) {
    dir = normalize(dir);
    const prefix = dir === '/' ? '/' : dir + '/';
    const all = within(dir, SHARED_ROOT) ? mounts : { ...nodes, ...(dir === '/' ? { [SHARED_ROOT]: mounts[SHARED_ROOT] } : {}) };
    return Object.keys(all)
      .filter((k) => all[k] && k !== dir && k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && !basename(k).startsWith('.'))
      .map((k) => ({ path: k, name: basename(k), ...all[k] }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  },

  read(p) {
    const n = node(normalize(p));
    if (!n || n.type !== 'file') throw new Error(`No existe el archivo ${p}`);
    if (n.blob) throw new Error(`${basename(p)} está en el disco de WonderfulOS y no se puede abrir como texto`);
    if (n.sharedApp) throw new Error(`${basename(p)} es una app compartida: ábrela desde Archivos para instalarla`);
    return n.content;
  },

  write(p, content) {
    p = normalize(p);
    const parent = node(dirname(p));
    if (parent?.type !== 'dir') throw new Error(`No existe la carpeta ${dirname(p)}`);
    if (node(p)?.type === 'dir') throw new Error(`${p} es una carpeta`);
    const n = { type: 'file', content: String(content), mtime: Date.now() };
    if (within(p, SHARED_ROOT)) {
      const { share, base } = shareOp(p, n);
      const m = mounts[p];
      mounts[p] = { ...(m || mounts[dirname(p)]), ...n, rel: relTo(p, base, m?.shareKind) };
      delete mounts[p].blob;
      return commit({ share, body: { op: 'set', path: relTo(p, base, m?.shareKind), node: n } });
    }
    nodes[p] = n;
    commit({ body: { op: 'set', path: p, node: n } });
  },

  /** Archivo grande guardado en el disco de WonderfulOS (descargas). props: { blob, size, mime, progress?, error? } */
  setBlob(p, props) {
    p = normalize(p);
    if (within(p, SHARED_ROOT)) throw new Error('Las descargas se guardan en tus carpetas, no en lo compartido');
    if (!this.isDir(dirname(p))) throw new Error(`No existe la carpeta ${dirname(p)}`);
    nodes[p] = { ...(nodes[p]?.blob === props.blob ? nodes[p] : {}), type: 'file', ...props, mtime: Date.now() };
    delete nodes[p].content;
    commit({ body: { op: 'set', path: p, node: nodes[p] } });
  },

  mkdir(p) {
    p = normalize(p);
    if (node(p)) throw new Error(`Ya existe ${basename(p)}`);
    if (!this.isDir(dirname(p))) throw new Error(`No existe la carpeta ${dirname(p)}`);
    const n = { type: 'dir', mtime: Date.now() };
    if (within(p, SHARED_ROOT)) {
      const { share, base } = shareOp(p, n);
      mounts[p] = { ...mounts[dirname(p)], ...n, rel: relTo(p, base) };
      return commit({ share, body: { op: 'set', path: relTo(p, base), node: n } });
    }
    nodes[p] = n;
    commit({ body: { op: 'set', path: p, node: n } });
  },

  remove(p) {
    p = normalize(p);
    if (p === '/') throw new Error('No se puede borrar la raíz');
    if (within(p, SHARED_ROOT)) {
      const m = mounts[p];
      // Quitar algo de "Compartido conmigo" solo deja de compartirlo contigo.
      if (m && p === (m.shareBase || p)) {
        api(`shares/${m.share}`, { method: 'DELETE' }).then(refreshShares).catch((e) => errorListeners.forEach((fn) => fn(e.message)));
        return;
      }
      const { share, base } = shareOp(p);
      for (const k of Object.keys(mounts)) if (within(k, p)) delete mounts[k];
      return commit({ share, body: { op: 'delete', path: relTo(p, base) } });
    }
    for (const k of Object.keys(nodes)) if (within(k, p)) delete nodes[k];
    commit({ body: { op: 'delete', path: p } });
  },

  rename(from, to) {
    from = normalize(from); to = normalize(to);
    if (node(to)) throw new Error(`Ya existe ${basename(to)}`);
    if (within(from, SHARED_ROOT) || within(to, SHARED_ROOT)) {
      const { share, base } = shareOp(from);
      if (from === base) throw new Error('No puedes renombrar algo que te han compartido');
      if (!within(to, base)) throw new Error('Solo puedes mover dentro de la misma carpeta compartida');
      for (const k of Object.keys(mounts)) if (within(k, from)) { mounts[to + k.slice(from.length)] = mounts[k]; delete mounts[k]; }
      return commit({ share, body: { op: 'rename', from: relTo(from, base), to: relTo(to, base) } });
    }
    for (const k of Object.keys(nodes)) if (within(k, from)) { nodes[to + k.slice(from.length)] = nodes[k]; delete nodes[k]; }
    commit({ body: { op: 'rename', from, to } });
  },

  /** Vuelve a leer los archivos del servidor (tras guardar desde la oficina). */
  async reload() {
    if (mode !== 'cloud') return;
    await flushing;
    nodes = (await api('fs')).nodes;
    await refreshShares();
  },

  async reset() {
    if (mode === 'cloud') nodes = (await api('fs/reset', { method: 'POST' })).nodes;
    else { nodes = localSeed(); try { localStorage.setItem(LOCAL_KEY, JSON.stringify(nodes)); } catch { /* */ } }
    changed();
  },

  /** Todas las rutas propias cuyo nodo cumple la condición. */
  find(pred) { return Object.keys(nodes).filter((k) => pred(nodes[k])); },

  // ---------- Subir y bajar archivos del ordenador ----------
  /** Sube un archivo (File) del ordenador a la carpeta `dir`. onProgress(0..1). */
  upload(dir, file, onProgress = () => {}) {
    const p = normalize(dir + '/' + file.name.replace(/[\/]/g, '-'));
    if (within(p, SHARED_ROOT)) return Promise.reject(new Error('Sube los archivos a tus carpetas; luego puedes compartirlos'));
    if (mode !== 'cloud') return Promise.reject(new Error('Para subir archivos necesitas iniciar sesión en WonderfulOS'));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `api/upload?path=${encodeURIComponent(p)}`);
      xhr.setRequestHeader('x-nubeos', '1');
      if (file.type) xhr.setRequestHeader('content-type', file.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* sin JSON */ }
        if (xhr.status !== 200) return reject(new Error(data.error || `Error ${xhr.status}`));
        nodes[p] = data.node;
        changed();
        resolve(p);
      };
      xhr.onerror = () => reject(new Error('Se perdió la conexión durante la subida'));
      xhr.send(file);
    });
  },
  /** Dirección para ver (inline) o descargar un archivo subido. */
  blobUrl(p, { inline = false } = {}) {
    const n = node(normalize(p));
    if (!n?.blob) return null;
    const q = new URLSearchParams({ name: basename(p), ...(inline ? { inline: '1', type: n.mime || '' } : {}) });
    return `api/blobs/${n.blob}?${q}`;
  },
  /** Baja cualquier archivo al ordenador. */
  downloadToComputer(p) {
    const n = node(normalize(p));
    if (!n || n.type !== 'file') throw new Error('Solo se pueden descargar archivos');
    const a = document.createElement('a');
    if (n.blob) a.href = this.blobUrl(p);
    else a.href = URL.createObjectURL(new Blob([n.content || ''], { type: 'text/plain;charset=utf-8' }));
    a.download = basename(p);
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (!n.blob) setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  size(p) {
    const n = node(normalize(p));
    return !n || n.type !== 'file' ? 0 : n.blob ? n.size || 0 : new Blob([n.content || '']).size;
  },

  // ---------- Compartir ----------
  /** Con quién has compartido esta ruta. */
  sharesOf(p) { return outgoing.filter((s) => s.path === normalize(p)); },
  async share({ path, app, to, perm }) {
    await flushing; // que el servidor tenga la última versión antes de compartir
    const res = await api('shares', { method: 'POST', body: { path, app, to, perm } });
    await refreshShares();
    return res.share;
  },
  async unshare(id) { await api(`shares/${id}`, { method: 'DELETE' }); await refreshShares(); },
};
