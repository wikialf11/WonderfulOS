// Proxy de navegación y búsqueda de WonderfulOS (ver docs/ARQUITECTURA.md §2.1.1).
// Descarga las páginas en nombre del usuario y quita las cabeceras que impiden
// mostrarlas dentro del escritorio. En producción corre en la máquina en la nube.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------- Acceso al proxy ----------
// Si NUBEOS_PROXY_SECRET está definido, cada petición al proxy debe llevar un
// token firmado (?t=) que el escritorio obtiene de /api/proxy-token. Así el proxy
// puede vivir en otro dominio y aun así solo lo usan usuarios con sesión.
const SECRET = process.env.NUBEOS_PROXY_SECRET;
const TOKEN_HOURS = 12;
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');

export function signProxyToken(user) {
  if (!SECRET) return '';
  const payload = b64(JSON.stringify({ u: user, e: Date.now() + TOKEN_HOURS * 3600e3 }));
  return `${payload}.${sign(payload)}`;
}
function validToken(t) {
  if (!SECRET) return true;
  const [payload, mac] = String(t || '').split('.');
  if (!payload || !mac) return false;
  const a = Buffer.from(sign(payload)), b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).e > Date.now(); } catch { return false; }
}
const tParam = (t) => (t ? `t=${encodeURIComponent(t)}&` : '');

export const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ---------- Proxy de navegación ----------
function isPrivate(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

// No dejamos que una página use el proxy para llegar a la red local del usuario.
export async function assertPublic(target) {
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw Object.assign(new Error('Dirección de red local no permitida'), { status: 403 });
}

// Script que se inyecta en cada página: mantiene la navegación dentro del proxy
// e informa al Navegador de la dirección real y el título.
function injected(realUrl, t = '') {
  return `<script>(function(){
  var P = location.origin + '/proxy?' + ${JSON.stringify(tParam(t))} + 'url=';
  var REAL = ${JSON.stringify(realUrl).replace(/</g, '\\u003c')};
  // Devuelve la dirección real: si la página construye URLs a partir de location
  // (que es la del proxy), las desenvolvemos.
  function abs(u){
    try {
      var a = new URL(u, document.baseURI);
      while (a.origin === location.origin && a.pathname === '/proxy' && a.searchParams.get('url')) a = new URL(a.searchParams.get('url'));
      return a.href;
    } catch(e) { return null; }
  }
  function wrap(u){ var a = abs(u); return a && /^https?:/.test(a) ? P + encodeURIComponent(a) : null; }
  function tell(type, url){ parent.postMessage({ type: type, url: url, title: document.title }, '*'); }
  tell('nubeos:nav', REAL);
  addEventListener('DOMContentLoaded', function(){ tell('nubeos:nav', REAL); });
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;
    var w = wrap(a.href); if (!w) return;
    e.preventDefault();
    // Una sola pestaña por ventana: target=_blank se abre aquí mismo; Ctrl/Cmd+clic abre otra ventana.
    if (e.ctrlKey || e.metaKey) tell('nubeos:open', abs(a.href)); else location.href = w;
  }, true);
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (f.hasAttribute('data-nubeos')) return; // formularios propios de WonderfulOS (búsqueda)
    var action = abs(f.getAttribute('action') || REAL);
    if ((f.method || 'get').toLowerCase() === 'get') {
      e.preventDefault();
      var u = new URL(action);
      new FormData(f).forEach(function(v, k){ if (typeof v === 'string') u.searchParams.append(k, v); });
      if (e.submitter && e.submitter.name) u.searchParams.append(e.submitter.name, e.submitter.value);
      location.href = wrap(u.href);
    } else { f.action = wrap(action); }
  }, true);
  window.open = function(u){ tell('nubeos:open', abs(u)); return null; };
  ['pushState','replaceState'].forEach(function(m){
    var orig = history[m];
    history[m] = function(s, t, u){ if (u != null) { var a = abs(u); tell('nubeos:nav', a); u = wrap(a) || u; } return orig.call(history, s, t, u); };
  });
  var realOrigin = new URL(REAL).origin;
  var sameSite = function(u){ var a = abs(u); return a && new URL(a).origin === realOrigin ? wrap(a) : null; };
  var ofetch = window.fetch;
  window.fetch = function(input, init){
    if (typeof input === 'string' || input instanceof URL) { var w = sameSite(String(input)); if (w) input = w; }
    return ofetch.call(this, input, init);
  };
  var oopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ var w = sameSite(u); arguments[1] = w || u; return oopen.apply(this, arguments); };
})();</script>`;
}

function rewriteHtml(html, realUrl, t) {
  const head = `<base href="${realUrl.replace(/"/g, '&quot;')}"><meta name="referrer" content="no-referrer">${injected(realUrl, t)}`;
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
}

// Enlaces de resultados de buscadores que redirigen con JavaScript: vamos directos al destino.
export function unwrapRedirect(target) {
  if (/(^|\.)bing\.com$/.test(target.hostname) && target.pathname === '/ck/a') {
    const u = target.searchParams.get('u');
    if (u?.startsWith('a1')) return Buffer.from(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
  if (/(^|\.)duckduckgo\.com$/.test(target.hostname) && target.pathname === '/l/') return target.searchParams.get('uddg');
  return null;
}

const RENDERABLE = /^(text\/|image\/|video\/|audio\/|font\/|application\/(json|javascript|xml|xhtml\+xml|pdf|wasm|manifest\+json|ld\+json|rss\+xml|atom\+xml)|$)/i;

function fileName(disposition, u) {
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  let name = star ? decodeURIComponent(star[1].replace(/"/g, '')) : plain ? plain[1] : decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  name = name.replace(/[\/\\]/g, '_').trim();
  return name || 'descarga';
}

const humanSize = (n) => !n ? 'tamaño desconocido' : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

function compatibility(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  if (['dmg', 'pkg', 'exe', 'msi', 'appimage', 'deb', 'rpm', 'apk'].includes(ext)) return 'Es un programa: se guarda en tu nube y desde Archivos puedes bajarlo a tu ordenador para instalarlo allí.';
  return '';
}

function downloadPage(fileUrl, name, size, type, t) {
  const note = compatibility(name);
  const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Descargar ${esc(name)}</title>${injected(fileUrl, t)}
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, Inter, system-ui, sans-serif; color: #111827;
      background: radial-gradient(60vw 60vw at 15% 15%, #c7d2fe, transparent 60%), radial-gradient(60vw 60vw at 85% 85%, #fbcfe8, transparent 60%), #f5f6fb; }
    .card { width: min(440px, 88vw); background: rgba(255,255,255,.75); backdrop-filter: blur(30px); border-radius: 22px; padding: 28px; text-align: center;
      box-shadow: 0 30px 70px -25px rgba(15,23,42,.35), 0 0 0 .5px rgba(15,23,42,.08); }
    .ic { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 18px; display: grid; place-items: center; color: #fff;
      background: linear-gradient(160deg, #7c8cff, #ec4899); box-shadow: 0 12px 24px -8px rgba(91,108,255,.6); }
    h1 { margin: 0 0 6px; font-size: 18px; word-break: break-all; }
    small { color: #6b7280; }
    .note { margin: 16px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(99,102,241,.1); color: #3730a3; font-size: 13px; }
    button { display: block; width: 100%; margin-top: 20px; padding: 12px 20px; border: 0; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer;
      color: #fff; background: linear-gradient(135deg, #5b6cff, #a855f7); }
  </style></head><body><div class="card">
    <div class="ic"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></div>
    <h1>${esc(name)}</h1>
    <small>${esc(humanSize(size))} · ${esc(new URL(fileUrl).hostname)}</small>
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <button id="save">Guardar en mi nube</button>
  </div>
  <script>
    document.getElementById('save').onclick = function(){
      parent.postMessage({ type: 'nubeos:download', url: ${js(fileUrl)}, name: ${js(name)}, size: ${size}, mime: ${js(type.split(';')[0])} }, '*');
      this.textContent = 'Guardando en Archivos › Descargas…'; this.disabled = true;
    };
  </script></body></html>`;
}

const DROP = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'content-encoding',
  'content-length', 'transfer-encoding', 'connection', 'set-cookie', 'strict-transport-security', 'cross-origin-opener-policy',
  'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'permissions-policy', 'alt-svc']);

function errorPage(res, status, message, target) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;color:#334">
    <h2>No se pudo abrir la página</h2><p>${message.replace(/</g, '&lt;')}</p>
    ${target ? `<p><small>${String(target).replace(/</g, '&lt;')}</small></p>` : ''}</body>`);
}

// ---------- Búsqueda ----------
// Las páginas de resultados de los buscadores dependen de mucho JavaScript que no
// funciona bien a través del proxy, así que extraemos los resultados y los
// mostramos en una página propia de WonderfulOS.
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;|&ensp;|&#0?32;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Cada buscador bloquea a veces según desde dónde se le pregunte (p. ej. IPs
// de servidores), así que se prueban varios hasta obtener resultados.
async function fetchHtml(u) {
  const res = await fetch(u, {
    headers: { 'user-agent': BROWSER_UA, 'accept': 'text/html', 'accept-language': 'es-ES,es;q=0.9' },
    signal: AbortSignal.timeout(12000),
  });
  return res.text();
}

export const ENGINES = [
  {
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=ES`,
    parse(html) {
      return (html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || []).map((block) => {
        const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
        const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
        return a && { href: decode(a[1]), title: decode(a[2]), snippet: p ? decode(p[1]) : '' };
      });
    },
  },
  {
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=es-es`,
    parse(html) {
      return html.split(/class="result results_links/).slice(1).map((block) => {
        const a = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
        const p = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
        if (!a) return null;
        const href = decode(a[1]);
        return { href: href.startsWith('//') ? 'https:' + href : href, title: decode(a[2]), snippet: p ? decode(p[1]) : '' };
      });
    },
  },
];

const SEARCH_SITES = [
  [/(^|\.)google\.[a-z.]+$/, /^\/(search|webhp)?$/, 'q'],
  [/(^|\.)bing\.com$/, /^\/(search)?$/, 'q'],
  [/(^|\.)duckduckgo\.com$/, /^\/(html\/?)?$/, 'q'],
  [/(^|\.)search\.yahoo\.com$|^(es\.|www\.)?yahoo\.com$/, /^\/(search)?$/, 'p'],
  [/(^|\.)ecosia\.org$/, /^\/(search)?$/, 'q'],
  [/(^|\.)startpage\.com$/, /^\/(do\/search|sp\/search)?$/, 'query'],
  [/^search\.brave\.com$/, /^\/(search)?$/, 'q'],
];
/** Si la dirección es la portada o una búsqueda de un buscador conocido, devuelve lo buscado ('' en la portada). */
export function searchQueryOf(u) {
  for (const [host, path, param] of SEARCH_SITES) {
    if (host.test(u.hostname) && path.test(u.pathname.replace(/\/$/, '') || '/')) return u.searchParams.get(param) || '';
  }
  return null;
}

async function searchPage(q, t) {
  if (!q.trim()) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Buscar</title>${injected('https://www.bing.com/', t)}
    <style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,Inter,system-ui,sans-serif;background:#f6f7fb;color:#111827}
    @media (prefers-color-scheme: dark){body{background:#14161f;color:#f3f4f6}}
    form{display:flex;gap:8px;width:min(560px,90vw)}input{flex:1;padding:14px 18px;border:0;border-radius:16px;font:inherit;font-size:16px;box-shadow:0 0 0 .5px rgba(127,127,127,.4),0 10px 30px -14px rgba(15,23,42,.3);outline:none}
    button{padding:0 22px;border:0;border-radius:16px;color:#fff;font:inherit;font-weight:600;background:linear-gradient(135deg,#5b6cff,#a855f7)}h1{text-align:center;font-weight:650;margin:0 0 18px}</style></head>
    <body><div><h1>Buscar en internet</h1><form action="/search" method="get" data-nubeos>${t ? `<input type="hidden" name="t" value="${esc(t)}">` : ''}<input name="q" autofocus placeholder="¿Qué quieres buscar?"><button>Buscar</button></form></div></body></html>`;
  }
  const bing = ENGINES[0].url(q);
  let results = [];
  let error = '';
  for (const engine of ENGINES) {
    try {
      results = engine.parse(await fetchHtml(engine.url(q))).filter(Boolean).flatMap((r) => {
        try { r.href = unwrapRedirect(new URL(r.href)) || r.href; } catch { return []; }
        return /^https?:\/\//.test(r.href) && !/duckduckgo\.com\/y\.js/.test(r.href) ? [r] : [];
      });
      if (results.length) { error = ''; break; }
    } catch (err) { error = err.message; }
  }

  const items = results.map((r) => `
    <article><a href="${esc(r.href)}"><small>${esc(new URL(r.href).hostname)}</small><h3>${esc(r.title)}</h3></a><p>${esc(r.snippet)}</p></article>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(q)} - Búsqueda</title>${injected(bing, t)}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; --text: #111827; --muted: #6b7280; --bg: #f6f7fb; --card: rgba(255,255,255,.8); --link: #4f46e5; }
    @media (prefers-color-scheme: dark) { :root { --text: #f3f4f6; --muted: #9ca3af; --bg: #14161f; --card: rgba(30,32,44,.8); --link: #a5b4fc; } }
    body { margin: 0; font-family: -apple-system, Inter, system-ui, sans-serif; color: var(--text); background: var(--bg); }
    form { position: sticky; top: 0; display: flex; gap: 8px; padding: 12px 24px; background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(20px); }
    input { flex: 1; max-width: 640px; padding: 10px 18px; border: 0; border-radius: 14px; font: inherit; color: inherit; background: var(--card); box-shadow: 0 0 0 .5px rgba(127,127,127,.3); outline: none; }
    input:focus { box-shadow: 0 0 0 3px rgba(99,102,241,.3); }
    button { padding: 10px 20px; border: 0; border-radius: 14px; color: #fff; font: inherit; font-weight: 600; cursor: pointer; background: linear-gradient(135deg, #5b6cff, #a855f7); }
    main { padding: 4px 24px 40px; max-width: 720px; }
    article { margin: 10px 0; padding: 14px 16px; border-radius: 16px; background: var(--card); box-shadow: 0 0 0 .5px rgba(127,127,127,.18); }
    article a { text-decoration: none; color: inherit; }
    article small { color: var(--muted); }
    article h3 { margin: 2px 0 4px; color: var(--link); font-size: 17px; font-weight: 600; }
    article a:hover h3 { text-decoration: underline; }
    article p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .empty { color: var(--muted); margin-top: 30px; }
  </style></head><body>
  <form action="/search" method="get" data-nubeos>${t ? `<input type="hidden" name="t" value="${esc(t)}">` : ''}<input name="q" value="${esc(q)}" autofocus><button>Buscar</button></form>
  <main>${items || `<p class="empty">${error ? 'No se pudo buscar: ' + esc(error) : 'Sin resultados.'}</p>`}</main>
  </body></html>`;
}

export async function proxyHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  const t = url.searchParams.get('t') || '';
  if (!validToken(t)) return errorPage(res, 401, 'Tu sesión de navegación ha caducado. Recarga el Navegador de WonderfulOS.');
  if (url.pathname === '/search') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(await searchPage((url.searchParams.get('q') || '').slice(0, 300), t));
  }
  if (url.pathname !== '/proxy') { res.writeHead(404); return res.end(); }
  let target;
  try {
    target = new URL(url.searchParams.get('url') || '');
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Solo se admiten direcciones http(s)');
    // Google, Bing, DuckDuckGo… no funcionan a través de un proxy (bloquean o dependen de
    // mucho JavaScript): su portada y sus búsquedas se muestran con el buscador de WonderfulOS.
    const q = searchQueryOf(target);
    if (q !== null) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await searchPage(q.slice(0, 300), t));
    }
    const unwrapped = unwrapRedirect(target);
    if (unwrapped && /^https?:\/\//.test(unwrapped)) {
      res.writeHead(302, { location: '/proxy?' + tParam(t) + 'url=' + encodeURIComponent(unwrapped) });
      return res.end();
    }
    await assertPublic(target);

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok, ko) => {
      const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', ko);
    });
    const upstream = await fetch(target, {
      method: req.method,
      body,
      redirect: 'follow',
      headers: {
        'user-agent': BROWSER_UA,
        'accept': req.headers.accept || '*/*',
        'accept-language': req.headers['accept-language'] || 'es-ES,es;q=0.9',
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (upstream.url) await assertPublic(new URL(upstream.url)); // la redirección tampoco puede ir a la red local

    const headers = {};
    upstream.headers.forEach((v, k) => { if (!DROP.has(k)) headers[k] = v; });
    headers['cache-control'] = 'no-store';
    const type = upstream.headers.get('content-type') || '';
    const finalUrl = upstream.url || target.href;
    // Una navegación que trae un archivo (no una página): en vez de pasarlo al
    // navegador del equipo, mostramos la descarga de WonderfulOS.
    const isNavigation = ['iframe', 'document', 'frame'].includes(req.headers['sec-fetch-dest']);
    const disposition = upstream.headers.get('content-disposition') || '';
    if (isNavigation && (/attachment/i.test(disposition) || !RENDERABLE.test(type))) {
      upstream.body?.cancel().catch(() => {});
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(downloadPage(finalUrl, fileName(disposition, finalUrl), Number(upstream.headers.get('content-length')) || 0, type, t));
    }
    if (type.includes('text/html')) {
      const html = rewriteHtml(await upstream.text(), upstream.url || target.href, t);
      res.writeHead(upstream.status, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'La página tardó demasiado en responder.' : err.message;
    errorPage(res, err.status || 502, msg, target?.href);
  }
}
