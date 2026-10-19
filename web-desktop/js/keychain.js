// Llavero de WonderfulOS: contraseñas cifradas en tu navegador con tu contraseña maestra.
// El servidor solo guarda datos cifrados (AES-GCM con una clave derivada por PBKDF2):
// ni WonderfulOS ni nadie con acceso al servidor puede leerlas, y si olvidas la contraseña
// maestra no se pueden recuperar.
import { cloud, uid } from './cloud.js';

const APP = 'llavero';
const ITER = 310000;
const CHECK = 'nubeos-llavero';
const AUTO_LOCK = 15 * 60e3;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let key = null, lockTimer = null;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(k, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function open(k, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}
const vault = () => cloud.docs(APP).find((d) => d.role === 'owner') || null;
function touch() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => keychain.lock(), AUTO_LOCK);
}

let cache = new Map(); // id -> entrada descifrada
async function decryptAll() {
  const v = vault();
  const next = new Map();
  for (const [id, box] of Object.entries(v?.data.entries || {})) {
    try { next.set(id, { id, ...(await open(key, box)) }); } catch { /* entrada dañada */ }
  }
  cache = next;
  changed();
}

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || '').replace(/^www\./, ''); } };

export const keychain = {
  async init() { await cloud.load(APP); cloud.subscribe(APP, () => { if (key) decryptAll(); else changed(); }); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  isSetUp: () => !!vault(),
  isUnlocked: () => !!key,

  async setUp(password) {
    if (password.length < 8) throw new Error('La contraseña maestra debe tener al menos 8 caracteres');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(password, salt, ITER);
    await cloud.create(APP, { salt: b64(salt), iter: ITER, check: await seal(key, CHECK), entries: {} });
    touch(); await decryptAll();
  },
  async unlock(password) {
    const v = vault();
    if (!v) throw new Error('Aún no has creado tu llavero');
    const k = await deriveKey(password, unb64(v.data.salt), v.data.iter || ITER);
    try { if ((await open(k, v.data.check)) !== CHECK) throw 0; } catch { throw new Error('Contraseña maestra incorrecta'); }
    key = k; touch(); await decryptAll();
  },
  lock() { key = null; cache = new Map(); clearTimeout(lockTimer); changed(); },

  entries() { touch(); return [...cache.values()].sort((a, b) => (a.name || a.site).localeCompare(b.name || b.site)); },
  matching(url) {
    const h = hostOf(url);
    return this.entries().filter((e) => e.site && (h === e.site || h.endsWith(`.${e.site}`) || e.site.endsWith(`.${h}`)));
  },
  async save(entry) {
    if (!key) throw new Error('El llavero está bloqueado');
    const id = entry.id || uid();
    const value = { name: entry.name || '', site: hostOf(entry.site || ''), user: entry.user || '', pass: entry.pass || '', notes: entry.notes || '', updated: Date.now() };
    await cloud.ops(APP, vault().id, [{ op: 'set', path: ['entries', id], value: await seal(key, value) }]);
    touch();
    return id;
  },
  async remove(id) { await cloud.ops(APP, vault().id, [{ op: 'del', path: ['entries', id] }]); },
};

/** Contraseña fuerte y fácil de copiar (sin caracteres que se confunden). */
export function generatePassword(length = 20, symbols = true) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', symbols ? '!@#$%&*-_=+?' : ''].filter(Boolean);
  const all = sets.join('');
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const out = sets.map((s) => s[rnd(s.length)]); // al menos uno de cada tipo
  while (out.length < length) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** Fuerza aproximada: 0 (débil) a 4 (muy fuerte). */
export function strength(p) {
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/\d/.test(p)) pool += 10; if (/[^a-zA-Z\d]/.test(p)) pool += 20;
  const bits = p.length * Math.log2(pool || 1);
  return bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 100 ? 3 : 4;
}
