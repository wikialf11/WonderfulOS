// Correo de WonderfulOS (inspirado en FairEmail): los mensajes se guardan en local
// como documentos de la app "correo" (server/appdata.mjs), así la ventana de Correo
// se actualiza al momento cuando Agentic crea, envía o borra algo.
//
// Cada mensaje: { folder, from, to, cc, subject, body, date, read, starred, msgId, prevFolder, error }
// Carpetas: inbox, drafts, outbox, sent, archive, trash.
//
// Cuenta: se guarda en DATA/mail-config.json (o variables MAIL_EMAIL, MAIL_PASS,
// IMAP_HOST, IMAP_PORT, SMTP_HOST, SMTP_PORT). Los servidores se detectan solos por el
// dominio del correo. Sin cuenta, todo funciona en local y lo enviado espera en la Bandeja de salida.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as store from './store.mjs';
import * as appdata from './appdata.mjs';

const { USER, HttpError } = store;
const APP = 'correo';
const CONFIG_FILE = path.join(store.DATA, 'mail-config.json');
const CA_FILE = process.env.NUBEOS_MAIL_CA || path.join(store.DATA, 'mail-ca.pem');
const MAX_BODY = 200 * 1024;

// Los antivirus con escaneo SSL (Norton, Kaspersky, ESET…) sustituyen el
// certificado de Gmail por el suyo. Node no usa el almacén de Windows, así que
// se puede añadir aquí su certificado raíz sin desactivar la verificación TLS.
function tlsOptions() {
  try {
    if (!existsSync(CA_FILE)) return {};
    return { ca: [...rootCertificates, readFileSync(CA_FILE, 'utf8')] };
  } catch { return {}; }
}

// Gmail muestra las contraseñas de aplicación como «abcd efgh ijkl mnop»;
// el servidor espera los 16 caracteres sin espacios.
const APP_PASSWORD = /^(?:[A-Za-z0-9]{4}\s+){3}[A-Za-z0-9]{4}$/;
const normalizePass = (pass) => {
  const s = String(pass ?? '');
  return APP_PASSWORD.test(s.trim()) ? s.replace(/\s+/g, '') : s;
};

/** Traduce los errores más habituales de IMAP/SMTP a algo accionable. */
function explain(err, acc = {}) {
  const msg = String(err?.responseText || err?.response || err?.message || err);
  if (/certificate|self.signed|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(msg)) {
    return `El certificado del servidor no es de confianza. Si un antivirus analiza el correo (Norton, Kaspersky, ESET…), guarda su certificado raíz en ${CA_FILE} o indica otro con NUBEOS_MAIL_CA.`;
  }
  if (/535|Invalid login|Username and Password not accepted|AUTHENTICATIONFAILED|authentication failed/i.test(msg)) {
    return /gmail/i.test(acc.imapHost || '')
      ? 'Gmail rechazó el correo o la contraseña. Usa una contraseña de aplicación de 16 caracteres (sin espacios) y activa IMAP en Gmail › Configuración › Reenvío y correo POP/IMAP.'
      : 'El servidor rechazó el correo o la contraseña. En Gmail, Outlook, Yahoo o iCloud usa una contraseña de aplicación.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return 'No se pudo conectar con el servidor de correo. Revisa la conexión y los datos IMAP/SMTP.';
  }
  return msg;
}
export const FOLDERS = ['inbox', 'drafts', 'outbox', 'sent', 'archive', 'trash'];
export const FOLDER_NAMES = { inbox: 'Recibidos', drafts: 'Borradores', outbox: 'Bandeja de salida', sent: 'Enviados', archive: 'Archivo', trash: 'Papelera' };

// ---------- Cuenta ----------
const PRESETS = [
  [/^(gmail|googlemail)\.com$/, { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 }],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587 }],
  [/^yahoo\.[a-z.]+$/, { imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465 }],
  [/^(icloud|me|mac)\.com$/, { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 }],
  [/^gmx\.[a-z.]+$/, { imapHost: 'imap.gmx.com', imapPort: 993, smtpHost: 'mail.gmx.com', smtpPort: 587 }],
  [/^zoho\.[a-z.]+$/, { imapHost: 'imap.zoho.eu', imapPort: 993, smtpHost: 'smtp.zoho.eu', smtpPort: 465 }],
];

/** Servidores IMAP/SMTP probables para una dirección. */
export function detectServers(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  for (const [re, cfg] of PRESETS) if (re.test(domain)) return { ...cfg };
  return domain ? { imapHost: `imap.${domain}`, imapPort: 993, smtpHost: `smtp.${domain}`, smtpPort: 465 } : {};
}

function readConfig() {
  let cfg = {};
  if (existsSync(CONFIG_FILE)) { try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { /* dañado */ } }
  const env = process.env;
  if (env.MAIL_EMAIL) cfg.email = env.MAIL_EMAIL;
  if (env.MAIL_PASS) cfg.pass = env.MAIL_PASS;
  if (env.IMAP_HOST) cfg.imapHost = env.IMAP_HOST;
  if (env.IMAP_PORT) cfg.imapPort = Number(env.IMAP_PORT);
  if (env.SMTP_HOST) cfg.smtpHost = env.SMTP_HOST;
  if (env.SMTP_PORT) cfg.smtpPort = Number(env.SMTP_PORT);
  if (cfg.email) cfg = { ...detectServers(cfg.email), ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== '' && v != null)) };
  if (cfg.pass) cfg.pass = normalizePass(cfg.pass);
  return cfg;
}

export const isConfigured = () => { const c = readConfig(); return Boolean(c.email && c.pass && c.imapHost && c.smtpHost); };

/** Cuenta sin la contraseña (para la interfaz). */
export function getAccount() {
  const { pass, ...rest } = readConfig();
  return { ...rest, hasPassword: Boolean(pass), configured: isConfigured() };
}

export function saveAccount(input = {}) {
  const prev = existsSync(CONFIG_FILE) ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })() : {};
  const next = { ...prev };
  for (const k of ['email', 'name', 'imapHost', 'smtpHost', 'signature']) if (input[k] !== undefined) next[k] = String(input[k]).trim();
  for (const k of ['imapPort', 'smtpPort']) if (input[k]) next[k] = Number(input[k]);
  if (input.pass) next.pass = normalizePass(input.pass);
  if (input.email && (!next.imapHost || input.autodetect)) Object.assign(next, detectServers(input.email));
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  restartAutoSync();
  return getAccount();
}

export function removeAccount() {
  writeFileSync(CONFIG_FILE, '{}', 'utf8');
  restartAutoSync();
  return getAccount();
}

const imapClient = (c) => new ImapFlow({
  host: c.imapHost, port: c.imapPort || 993, secure: (c.imapPort || 993) === 993,
  auth: { user: c.email, pass: c.pass }, logger: false, socketTimeout: 30000,
  ...(Object.keys(tlsOptions()).length ? { tls: tlsOptions() } : {}),
});
const smtpTransport = (c) => nodemailer.createTransport({
  host: c.smtpHost, port: c.smtpPort || 465, secure: (c.smtpPort || 465) === 465,
  auth: { user: c.email, pass: c.pass },
  ...(Object.keys(tlsOptions()).length ? { tls: tlsOptions() } : {}),
});

/** Comprueba que la cuenta entra por IMAP y SMTP. */
export async function testAccount() {
  const c = readConfig();
  if (!isConfigured()) throw new HttpError(400, 'Falta el correo o la contraseña');
  const client = imapClient(c);
  try {
    await client.connect();
    await client.logout();
    await smtpTransport(c).verify();
    return { ok: true };
  } catch (err) {
    try { await client.logout(); } catch { /* ya cerrado */ }
    throw new HttpError(502, explain(err, c));
  }
}

// ---------- Mensajes ----------
const all = () => appdata.list(USER, APP);
const summary = (d, withBody = false) => ({
  id: d.id.slice(0, 8),
  carpeta: d.data.folder,
  de: d.data.from || '',
  para: d.data.to || '',
  asunto: d.data.subject || '(sin asunto)',
  fecha: new Date(d.data.date || d.updated).toISOString().slice(0, 16).replace('T', ' '),
  leido: Boolean(d.data.read),
  destacado: Boolean(d.data.starred),
  ...(withBody ? { cuerpo: d.data.body || '' } : { extracto: String(d.data.body || '').replace(/\s+/g, ' ').slice(0, 120) }),
});
export { summary };

/** Encuentra un mensaje por id completo o por sus primeros caracteres. */
export function find(id) {
  const key = String(id || '').trim().toLowerCase();
  if (!key) throw new HttpError(400, 'Falta el id del correo');
  const d = all().find((m) => m.id === key) || all().find((m) => m.id.startsWith(key));
  if (!d) throw new HttpError(404, `No existe el correo ${id}`);
  return d;
}

export function list({ folder, query, unread, starred, limit = 50 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  return all()
    .filter((d) => (!folder || folder === 'all' ? d.data.folder !== 'trash' : d.data.folder === folder))
    .filter((d) => !unread || !d.data.read)
    .filter((d) => !starred || d.data.starred)
    .filter((d) => !q || `${d.data.from} ${d.data.to} ${d.data.cc} ${d.data.subject} ${d.data.body}`.toLowerCase().includes(q))
    .sort((a, b) => (b.data.date || b.updated) - (a.data.date || a.updated))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
}

export function counts() {
  const c = Object.fromEntries(FOLDERS.map((f) => [f, { total: 0, unread: 0 }]));
  for (const d of all()) {
    const f = c[d.data.folder];
    if (!f) continue;
    f.total++;
    if (!d.data.read) f.unread++;
  }
  return c;
}

const set = (d, fields) => appdata.patch(USER, APP, d.id, Object.entries(fields).map(([k, v]) => (v === undefined ? { op: 'del', path: [k] } : { op: 'set', path: [k], value: v })));

export function createDraft({ to = '', cc = '', subject = '', body = '' } = {}) {
  const acc = readConfig();
  const sig = acc.signature ? `\n\n-- \n${acc.signature}` : '';
  return appdata.create(USER, APP, {
    folder: 'drafts', from: acc.email || 'yo@wonderfulos.local', to: String(to), cc: String(cc),
    subject: String(subject), body: String(body) + (acc.signature && !String(body).includes(acc.signature) ? sig : ''),
    date: Date.now(), read: true, starred: false,
  });
}

export function updateDraft(id, fields = {}) {
  const d = find(id);
  const allowed = {};
  for (const k of ['to', 'cc', 'subject', 'body']) if (fields[k] !== undefined) allowed[k] = String(fields[k]);
  allowed.date = Date.now();
  return set(d, allowed);
}

const validAddresses = (s) => String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);

/** Envía un borrador (id) o un correo nuevo ({to, subject, body}). */
export async function send({ id, to, cc, subject, body } = {}) {
  let d = id ? find(id) : createDraft({ to, cc, subject, body });
  if (id && (to !== undefined || subject !== undefined || body !== undefined || cc !== undefined)) d = updateDraft(d.id, { to, cc, subject, body });
  const recipients = validAddresses(d.data.to);
  if (!recipients.length) throw new HttpError(400, 'El correo no tiene destinatario');
  if (recipients.some((r) => !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(r.replace(/^.*<|>$/g, '')))) throw new HttpError(400, `Dirección no válida: ${d.data.to}`);
  if (!isConfigured()) {
    set(d, { folder: 'outbox', date: Date.now(), error: 'Sin cuenta configurada: se enviará al configurar la cuenta en Correo › Ajustes.' });
    return { ok: true, pendiente: true, id: d.id.slice(0, 8), aviso: 'No hay cuenta de correo configurada: el mensaje queda en la Bandeja de salida.' };
  }
  const acc = readConfig();
  try {
    const info = await smtpTransport(acc).sendMail({
      from: acc.name ? `"${acc.name}" <${acc.email}>` : acc.email,
      to: d.data.to, cc: d.data.cc || undefined, subject: d.data.subject, text: d.data.body,
    });
    set(d, { folder: 'sent', from: acc.email, date: Date.now(), read: true, msgId: info.messageId, error: undefined });
    return { ok: true, enviado: true, id: d.id.slice(0, 8), para: d.data.to };
  } catch (err) {
    const msg = explain(err, acc);
    set(d, { folder: 'outbox', error: msg });
    throw new HttpError(502, `No se pudo enviar: ${msg}`);
  }
}

export function move(id, folder) {
  if (!FOLDERS.includes(folder)) throw new HttpError(400, `Carpeta no válida (usa: ${FOLDERS.join(', ')})`);
  const d = find(id);
  return set(d, { folder, prevFolder: d.data.folder });
}

/** Mueve a la Papelera; si ya estaba en la Papelera (o forever), lo borra del todo. */
export function trash(id, forever = false) {
  const d = find(id);
  if (forever || d.data.folder === 'trash') { appdata.remove(USER, APP, d.id); return { ok: true, borrado: 'definitivo', id: d.id.slice(0, 8) }; }
  set(d, { folder: 'trash', prevFolder: d.data.folder });
  return { ok: true, borrado: 'papelera', id: d.id.slice(0, 8) };
}

export function restore(id) {
  const d = find(id);
  return set(d, { folder: d.data.prevFolder && d.data.prevFolder !== 'trash' ? d.data.prevFolder : 'inbox' });
}

export function emptyFolder(folder = 'trash') {
  if (!FOLDERS.includes(folder)) throw new HttpError(400, 'Carpeta no válida');
  const items = all().filter((d) => d.data.folder === folder);
  for (const d of items) appdata.remove(USER, APP, d.id);
  return { ok: true, carpeta: folder, borrados: items.length };
}

export const mark = (id, fields) => set(find(id), Object.fromEntries(Object.entries({ read: fields.read, starred: fields.starred }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Boolean(v)])));

// ---------- Sincronización IMAP ----------
let syncing = null;
let lastSync = null;
let lastError = null;
export const syncState = () => ({ syncing: Boolean(syncing), lastSync, lastError, configured: isConfigured() });

/** Descarga los últimos mensajes de Recibidos y reintenta la Bandeja de salida. */
export function sync({ limit = 60 } = {}) {
  if (!isConfigured()) return Promise.resolve({ ok: false, error: 'No hay cuenta de correo configurada', nuevos: 0 });
  if (syncing) return syncing;
  syncing = (async () => {
    const acc = readConfig();
    const known = new Set(all().map((d) => d.data.msgId).filter(Boolean));
    const client = imapClient(acc);
    let nuevos = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const total = client.mailbox.exists || 0;
        if (total > 0) {
          const from = Math.max(1, total - limit + 1);
          for await (const msg of client.fetch(`${from}:*`, { source: true, flags: true, envelope: true })) {
            const msgId = msg.envelope?.messageId || `uid-${msg.uid}`;
            if (known.has(msgId)) continue;
            const parsed = await simpleParser(msg.source);
            const body = (parsed.text || String(parsed.html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).slice(0, MAX_BODY);
            appdata.create(USER, APP, {
              folder: 'inbox', from: parsed.from?.text || '', to: parsed.to?.text || '', cc: parsed.cc?.text || '',
              subject: parsed.subject || '', body, date: (parsed.date || new Date()).getTime(),
              read: msg.flags?.has('\\Seen') || false, starred: msg.flags?.has('\\Flagged') || false, msgId,
              attachments: (parsed.attachments || []).map((a) => a.filename).filter(Boolean),
            });
            known.add(msgId);
            nuevos++;
          }
        }
      } finally { lock.release(); }
      await client.logout();
      for (const d of all().filter((m) => m.data.folder === 'outbox')) { try { await send({ id: d.id }); } catch { /* sigue en salida */ } }
      lastSync = Date.now(); lastError = null;
      return { ok: true, nuevos };
    } catch (err) {
      lastError = explain(err, acc);
      try { await client.logout(); } catch { /* ya cerrado */ }
      return { ok: false, error: lastError, nuevos };
    } finally { syncing = null; }
  })();
  return syncing;
}

// Sincroniza sola cada 5 minutos si hay cuenta.
let timer = null;
function restartAutoSync() {
  clearInterval(timer);
  if (!isConfigured()) return;
  timer = setInterval(() => sync().catch(() => {}), 5 * 60 * 1000);
  timer.unref?.();
  setTimeout(() => sync().catch(() => {}), 3000).unref?.();
}
restartAutoSync();

// Primer arranque: un mensaje de bienvenida para que Recibidos no esté vacío.
if (!all().length) {
  appdata.create(USER, APP, {
    folder: 'inbox', from: 'WonderfulOS <hola@wonderfulos.local>', to: 'yo@wonderfulos.local', cc: '',
    subject: 'Bienvenido a Correo',
    body: 'Hola:\n\nEste es Correo, el cliente de WonderfulOS basado en FairEmail.\n\n· Configura tu cuenta en el engranaje (los servidores se detectan solos).\n· Los borradores se guardan automáticamente mientras escribes.\n· Pídele a Agentic que busque, liste, escriba, envíe o borre correos, o que vacíe la Papelera.\n\nUn saludo.',
    date: Date.now(), read: false, starred: false, msgId: 'welcome@wonderfulos',
  });
}
