// API del servicio local de WonderfulOS: archivos, subidas, descargas, oficina
// y datos de las apps. No hay cuentas ni sesiones: todo pertenece al perfil local.
// Todas las peticiones llevan la cabecera x-nubeos (el navegador no deja que otra
// web la envíe sin permiso) y, si traen Origin, debe ser el del propio escritorio.

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as store from './store.mjs';
import * as office from './office.mjs';
import * as appdata from './appdata.mjs';
import * as agentic from './agentic.mjs';
import * as conocimiento from './conocimiento.mjs';
import * as mail from './mail.mjs';
import * as ext from './mcp.mjs';
import { assertPublic, unwrapRedirect, BROWSER_UA, signProxyToken } from './proxy.mjs';

const MAX_UPLOAD = Number(process.env.NUBEOS_MAX_UPLOAD_MB || 2048) * 1024 * 1024;
const { HttpError } = store;
const USER = store.USER;

const fail = (status, message) => { throw new HttpError(status, message); };

async function readJson(req, limit = 6 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(413, 'Petición demasiado grande');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail(400, 'JSON no válido'); }
}

// ---------- Descargas del Navegador: las baja el servicio local a Descargas ----------
const downloads = new Map(); // id -> { received, total, done, error }
async function startDownload(rawUrl) {
  let target = new URL(rawUrl);
  if (!['http:', 'https:'].includes(target.protocol)) throw new HttpError(400, 'Solo se admiten direcciones http(s)');
  const unwrapped = unwrapRedirect(target);
  if (unwrapped) target = new URL(unwrapped);
  await assertPublic(target);
  const { used, quota } = store.account(USER);
  const free = quota - used;
  if (free <= 0) throw new HttpError(507, 'No queda espacio libre en el disco');
  const id = store.newBlob(USER);
  const state = { received: 0, total: 0, done: false, error: null };
  downloads.set(id, state);
  (async () => {
    try {
      const res = await fetch(target, { headers: { 'user-agent': BROWSER_UA } });
      if (res.url) await assertPublic(new URL(res.url));
      if (!res.ok) throw new Error(`La web respondió ${res.status}`);
      state.total = Number(res.headers.get('content-length')) || 0;
      if (state.total > free) throw new Error('No cabe: ocupa más que el espacio libre');
      if (state.total > MAX_UPLOAD) throw new Error('El archivo es demasiado grande');
      const count = new Transform({ transform(chunk, _, cb) {
        state.received += chunk.length;
        cb(state.received > free || state.received > MAX_UPLOAD ? new Error('No cabe en el espacio libre') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(store.blobPath(id)));
      state.done = true;
    } catch (err) {
      state.error = err.message;
      store.removeBlob(id);
    }
    setTimeout(() => downloads.delete(id), 3600e3);
  })();
  return id;
}

// Sube un archivo del ordenador: el cuerpo es el archivo tal cual.
async function upload(req, url) {
  const size = Number(req.headers['content-length']);
  if (!Number.isFinite(size)) throw new HttpError(411, 'Falta el tamaño del archivo');
  if (size > MAX_UPLOAD) throw new HttpError(413, `El archivo es demasiado grande (máximo ${Math.round(MAX_UPLOAD / 1024 ** 2)} MB)`);
  const { path, id } = store.prepareUpload(USER, String(url.searchParams.get('path') || ''), size);
  let received = 0;
  const count = new Transform({ transform(chunk, _, cb) { received += chunk.length; cb(received > size ? new Error('El archivo es más grande de lo anunciado') : null, chunk); } });
  try {
    await pipeline(req, count, createWriteStream(store.blobPath(id)));
    if (received !== size) throw new Error('La subida se cortó');
  } catch (e) {
    store.removeBlob(id);
    throw new HttpError(400, e.message);
  }
  return store.finishUpload(USER, path, id, size, req.headers['content-type']);
}

export async function apiHandler(req, res, url) {
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    // --- Archivos subidos: verlos o bajarlos al ordenador ---
    // Va antes de la comprobación de cabecera: lo piden <img>, <iframe> y enlaces de descarga.
    if (req.method === 'GET' && url.pathname.startsWith('/api/blobs/')) {
      const id = url.pathname.split('/')[3];
      if (!store.canReadBlob(USER, id)) fail(404, 'No encontrado');
      const info = await stat(store.blobPath(id)).catch(() => fail(404, 'No encontrado'));
      const name = String(url.searchParams.get('name') || 'archivo').replace(/[\r\n"]/g, '');
      const inline = url.searchParams.get('inline') === '1';
      // Se ve dentro de WonderfulOS solo lo que no puede ejecutar código (imágenes, PDF, audio, vídeo).
      const mime = String(url.searchParams.get('type') || '');
      const safe = /^(image\/(png|jpeg|gif|webp)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/.test(mime);
      res.writeHead(200, {
        'content-type': inline && safe ? mime : 'application/octet-stream',
        'content-length': info.size,
        'content-disposition': `${inline && safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        // El visor de PDF del navegador no funciona dentro de un documento aislado (sandbox).
        'content-security-policy': inline && mime === 'application/pdf' ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=300',
      });
      return createReadStream(store.blobPath(id)).pipe(res);
    }

    // Avisos en tiempo real: EventSource no puede mandar cabeceras.
    if (req.method === 'GET' && url.pathname === '/api/events') return appdata.events(USER, req, res);
    if (req.headers['x-nubeos'] !== '1') fail(403, 'Prohibido');
    const origin = req.headers.origin;
    // Detrás de un proxy local el esquema puede no llegar bien: comparamos el host.
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { fail(403, 'Origen no permitido'); }
      if (host !== req.headers.host) fail(403, 'Origen no permitido');
    }

    const parts = url.pathname.split('/').slice(2); // tras /api/
    const route = `${req.method} /${parts[0] || ''}${parts[1] ? '/' + parts[1] : ''}`;

    if (route === 'GET /proxy-token') return send(200, { token: signProxyToken(USER) });

    // --- Archivos ---
    if (route === 'GET /fs') return send(200, { nodes: store.tree(USER) });
    if (route === 'POST /fs') { store.applyOps(USER, (await readJson(req)).ops); return send(200, { ok: true }); }
    if (route === 'POST /fs/reset') { store.resetTree(USER); return send(200, { nodes: store.tree(USER) }); }

    // --- Espacio en el disco ---
    if (route === 'GET /storage') return send(200, store.account(USER));

    // --- Oficina (LibreOffice en el navegador, ver office.mjs) ---
    if (route === 'GET /office/info') return send(200, { enabled: office.officeAvailable() });
    if (route === 'POST /office/open') {
      const origin = `${req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
      return send(200, await office.open(await readJson(req, 4000), origin));
    }
    if (route === 'POST /office/new') {
      const { dir, kind, name } = await readJson(req, 4000);
      return send(200, office.create(dir, kind, name));
    }

    // --- Descargas desde el Navegador ---
    if (route === 'POST /downloads') return send(200, { id: await startDownload((await readJson(req, 10000)).url) });
    if (route.startsWith('GET /downloads/')) {
      const d = downloads.get(parts[1]);
      if (!d) fail(404, 'No encontrado');
      return send(200, d);
    }

    // --- Subir archivos del ordenador ---
    if (route === 'POST /upload') return send(200, { node: await upload(req, url) });

    // --- Datos de las apps (Listas, Notas, Calendario y Llavero) ---
    if (parts[0] === 'apps' && parts[1]) {
      const [, app, id, sub] = parts;
      if (req.method === 'GET' && !id) return send(200, { docs: appdata.list(USER, app) });
      if (req.method === 'POST' && !id) return send(200, { doc: appdata.create(USER, app, (await readJson(req)).data) });
      if (req.method === 'POST' && sub === 'ops') return send(200, { doc: appdata.patch(USER, app, id, (await readJson(req)).ops) });
      if (req.method === 'DELETE' && id && !sub) return send(200, appdata.remove(USER, app, id));
    }


    // --- Correo (server/mail.mjs). Los mensajes se leen y editan como datos de la app "correo". ---
    if (parts[0] === 'email') {
      const sub = parts[1] || '';
      if (req.method === 'GET' && sub === 'account') return send(200, { ...mail.getAccount(), sync: mail.syncState() });
      if (req.method === 'POST' && sub === 'account') return send(200, mail.saveAccount(await readJson(req, 20000)));
      if (req.method === 'DELETE' && sub === 'account') return send(200, mail.removeAccount());
      if (req.method === 'GET' && sub === 'detect') return send(200, mail.detectServers(url.searchParams.get('email')));
      if (req.method === 'POST' && sub === 'test') return send(200, await mail.testAccount());
      if (req.method === 'POST' && sub === 'sync') return send(200, await mail.sync());
      if (req.method === 'GET' && sub === 'list') {
        const q = url.searchParams;
        return send(200, { mails: mail.list({ folder: q.get('folder'), query: q.get('q'), unread: q.get('unread') === '1' }).map((d) => mail.summary(d)), counts: mail.counts() });
      }
      if (req.method === 'POST' && sub === 'draft') return send(200, { doc: mail.createDraft(await readJson(req, 1024 * 1024)) });
      if (req.method === 'POST' && sub === 'send') return send(200, await mail.send(await readJson(req, 1024 * 1024)));
      if (req.method === 'POST' && sub === 'move') { const { id, folder } = await readJson(req, 4000); return send(200, { doc: mail.move(id, folder) }); }
      if (req.method === 'POST' && sub === 'trash') { const { id, forever } = await readJson(req, 4000); return send(200, mail.trash(id, forever)); }
      if (req.method === 'POST' && sub === 'restore') { const { id } = await readJson(req, 4000); return send(200, { doc: mail.restore(id) }); }
      if (req.method === 'POST' && sub === 'empty') { const { folder } = await readJson(req, 4000); return send(200, mail.emptyFolder(folder || 'trash')); }
    }

    // --- Agentic (asistente inteligente y automatización del sistema) ---
    // --- Motor de conocimiento simbólico (sin modelo neuronal) ---
    if (parts[0] === 'conocimiento') {
      const sub = parts[1] || '';
      try {
        if (req.method === 'GET' && sub === 'status') return send(200, conocimiento.estadisticas());
        if (req.method === 'POST' && sub === 'consultar') {
          const { texto } = await readJson(req, 200000);
          return send(200, await conocimiento.consultarConHerramientas(texto));
        }
        if (req.method === 'POST' && sub === 'ensenar') {
          return send(200, conocimiento.ensenar(await readJson(req, 1024 * 1024)));
        }
        if (req.method === 'GET' && sub === 'buscar') {
          return send(200, { resultados: conocimiento.buscar(url.searchParams.get('q') || '', 8) });
        }
        if (req.method === 'GET' && sub === 'concepto') {
          return send(200, conocimiento.definir(url.searchParams.get('lema') || ''));
        }
      } catch (err) {
        fail(400, err.message || 'No se pudo procesar la consulta');
      }
    }

    if (parts[0] === 'agentic') {
      const sub = parts[1] || '';
      if (req.method === 'GET' && sub === 'status') return send(200, await agentic.checkOllama());
      if (req.method === 'GET' && sub === 'config') return send(200, agentic.getConfig());
      if (req.method === 'POST' && sub === 'config') return send(200, agentic.saveConfig(await readJson(req, 10000)));
      if (req.method === 'GET' && sub === 'models') {
        const st = await agentic.checkOllama();
        return send(200, { models: st.models || [] });
      }
      if (req.method === 'POST' && sub === 'pull') {
        const { model } = await readJson(req, 10000);
        return agentic.pullModelStream(model || agentic.getConfig().model, res);
      }
      if (req.method === 'POST' && sub === 'run-code') {
        const { language, code: codeSnippet } = await readJson(req, 1024 * 1024);
        return send(200, await agentic.runCode(language, codeSnippet));
      }
      if (req.method === 'POST' && sub === 'chat') {
        const { messages, mode } = await readJson(req, 1024 * 1024);
        return agentic.chatStream(messages || [], res, req, { mode });
      }
      if (req.method === 'GET' && sub === 'extensions') return send(200, ext.listPublicExtensions());
      if (req.method === 'POST' && sub === 'extensions') {
        const body = await readJson(req, 1024 * 1024);
        const kind = body.kind || body.type;
        if (kind === 'mcp') return send(200, { mcp: ext.addMcp(body) });
        if (kind === 'skill') {
          if (body.path) return send(200, { skill: ext.addSkillFromPath(body.path) });
          if (body.text && !body.body) return send(200, { skill: ext.addSkillFromText(body.text, body.source || 'manual') });
          return send(200, { skill: ext.addSkill(body) });
        }
        if (kind === 'import-mcp') return send(200, { mcps: ext.importMcps(body.json || body.text || body) });
        fail(400, 'Indica kind: mcp, skill o import-mcp');
      }
      if (req.method === 'POST' && sub === 'mcp' && parts[2] === 'test') {
        const { id } = await readJson(req, 4000);
        return send(200, await ext.testMcp(id));
      }
      if (req.method === 'POST' && sub === 'mcp' && parts[2]) {
        return send(200, { mcp: ext.updateMcp(parts[2], await readJson(req, 10000)) });
      }
      if (req.method === 'DELETE' && sub === 'mcp' && parts[2]) return send(200, ext.removeMcp(parts[2]));
      if (req.method === 'POST' && sub === 'skill' && parts[2]) {
        return send(200, { skill: ext.updateSkill(parts[2], await readJson(req, 1024 * 1024)) });
      }
      if (req.method === 'DELETE' && sub === 'skill' && parts[2]) return send(200, ext.removeSkill(parts[2]));
    }

    fail(404, 'No encontrado');
  } catch (err) {
    if (err instanceof HttpError || (err.status >= 400 && err.status < 600)) return send(err.status, { error: err.message });
    console.error(err);
    return send(500, { error: 'Error interno' });
  }
}
