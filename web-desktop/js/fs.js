// Sistema de archivos del escritorio.
//
// Con el servicio local de WonderfulOS: los archivos viven en el disco de este
// ordenador. Se cargan al iniciar y cada cambio se aplica al momento en memoria
// y se envía al servicio local en segundo plano, así las apps usan una API
// síncrona. Sin servicio: todo en localStorage.
//
// No hay cuentas remotas ni carpetas compartidas: cada archivo es tuyo y se queda aquí.

import { api } from './api.js';

const LOCAL_KEY = 'nubeos.fs.v1';

let mode = 'local';
let nodes = {};
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

/** Tamaño en bytes UTF-8 sin crear un Blob ni una copia del texto. */
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

function localSeed() {
  const now = Date.now();
  return {
    '/': { type: 'dir', mtime: now },
    '/Documentos': { type: 'dir', mtime: now },
    '/Descargas': { type: 'dir', mtime: now },
    '/Imágenes': { type: 'dir', mtime: now },
    '/Documentos/Bienvenida.txt': {
      type: 'file', mtime: now,
      content: 'Bienvenido a WonderfulOS.\n\nEstás en modo local: tus archivos se guardan solo en este navegador.\nArranca WonderfulOS con su servicio local para guardarlos en este equipo.\n',
    },
  };
}

// ---------- Arranque ----------
/** Devuelve 'servicio' (archivos en el disco) o 'local' (sin servicio). */
export async function initFs() {
  try {
    const { nodes: remote } = await api('fs');
    mode = 'service';
    nodes = remote;
    return 'service';
  } catch {
    mode = 'local';
    try { nodes = JSON.parse(localStorage.getItem(LOCAL_KEY)) || localSeed(); } catch { nodes = localSeed(); }
    for (const d of ['/Documentos', '/Descargas', '/Imágenes']) nodes[d] ??= { type: 'dir', mtime: Date.now() };
    return 'local';
  }
}

export const isLocalService = () => mode === 'service';

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
    try {
      await api('fs', { method: 'POST', body: { ops: batch.map((op) => op.body) } });
    } catch (err) {
      errorListeners.forEach((fn) => fn(`No se pudo guardar: ${err.message}`));
    }
  }
  flushing = null;
}

const node = (p) => nodes[p];

// ---------- API pública ----------
export const fs = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },

  exists(p) { return !!node(normalize(p)); },
  isDir(p) { return node(normalize(p))?.type === 'dir'; },
  stat(p) { return node(normalize(p)) || null; },

  list(dir) {
    dir = normalize(dir);
    const prefix = dir === '/' ? '/' : dir + '/';
    return Object.keys(nodes)
      .filter((k) => nodes[k] && k !== dir && k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && !basename(k).startsWith('.'))
      .map((k) => ({ path: k, name: basename(k), ...nodes[k] }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  },

  read(p) {
    const n = node(normalize(p));
    if (!n || n.type !== 'file') throw new Error(`No existe el archivo ${p}`);
    if (n.blob) throw new Error(`${basename(p)} está en el disco de WonderfulOS y no se puede abrir como texto`);
    return n.content;
  },

  write(p, content) {
    p = normalize(p);
    const parent = node(dirname(p));
    if (parent?.type !== 'dir') throw new Error(`No existe la carpeta ${dirname(p)}`);
    if (node(p)?.type === 'dir') throw new Error(`${p} es una carpeta`);
    const n = { type: 'file', content: String(content), mtime: Date.now() };
    nodes[p] = n;
    commit({ body: { op: 'set', path: p, node: n } });
  },

  /** Archivo grande guardado en el disco de WonderfulOS (descargas). props: { blob, size, mime, progress?, error? } */
  setBlob(p, props) {
    p = normalize(p);
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
    nodes[p] = n;
    commit({ body: { op: 'set', path: p, node: n } });
  },

  remove(p) {
    p = normalize(p);
    if (p === '/') throw new Error('No se puede borrar la raíz');
    for (const k of Object.keys(nodes)) if (within(k, p)) delete nodes[k];
    commit({ body: { op: 'delete', path: p } });
  },

  rename(from, to) {
    from = normalize(from); to = normalize(to);
    if (node(to)) throw new Error(`Ya existe ${basename(to)}`);
    for (const k of Object.keys(nodes)) if (within(k, from)) { nodes[to + k.slice(from.length)] = nodes[k]; delete nodes[k]; }
    commit({ body: { op: 'rename', from, to } });
  },

  /** Vuelve a leer los archivos del servicio local (tras guardar desde la oficina). */
  async reload() {
    if (mode !== 'service') return;
    await flushing;
    nodes = (await api('fs')).nodes;
  },

  async reset() {
    if (mode === 'service') nodes = (await api('fs/reset', { method: 'POST' })).nodes;
    else { nodes = localSeed(); try { localStorage.setItem(LOCAL_KEY, JSON.stringify(nodes)); } catch { /* */ } }
    changed();
  },

  /** Todas las rutas propias cuyo nodo cumple la condición. */
  find(pred) { return Object.keys(nodes).filter((k) => pred(nodes[k])); },

  // ---------- Subir y bajar archivos del ordenador ----------
  /** Sube un archivo (File) del ordenador a la carpeta `dir`. onProgress(0..1). */
  upload(dir, file, onProgress = () => {}) {
    const p = normalize(dir + '/' + file.name.replace(/[\/]/g, '-'));
    if (mode !== 'service') return Promise.reject(new Error('Para subir archivos necesitas el servicio local de WonderfulOS'));
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
      xhr.onerror = () => reject(new Error('Se interrumpió la subida'));
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
    return !n || n.type !== 'file' ? 0 : n.blob ? n.size || 0 : utf8Length(String(n.content || ''));
  },
};
