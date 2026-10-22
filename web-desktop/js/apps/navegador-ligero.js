// Navegador: busca y visita webs dentro de WonderfulOS. Las páginas pasan por el proxy
// de WonderfulOS (server/proxy.mjs, en otro origen) para poder mostrarse en la ventana;
// lo que descargas se guarda en Archivos › Descargas, en este equipo.
import { GLYPHS } from '../shell/icons.js';
import { initProxy, proxify, searchUrl, getProxyOrigin, isLocalAddress } from '../proxy.js';
import { normalize } from '../fs.js';
import { esc } from '../util.js';

const ready = initProxy();
const FAVORITES = [
  ['Wikipedia', 'https://es.wikipedia.org', '#0f172a'],
  ['YouTube', 'https://www.youtube.com', '#ef4444'],
  ['GitHub', 'https://github.com', '#24292f'],
  ['El País', 'https://elpais.com', '#1d4ed8'],
  ['OpenStreetMap', 'https://www.openstreetmap.org', '#16a34a'],
  ['Unsplash', 'https://unsplash.com', '#111827'],
];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const SEARCH = 'nubeos:buscar?';

function toUrl(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) || /^localhost\b/.test(s)) return `${isLocalAddress(`http://${s}`) ? 'http' : 'https'}://${s}`;
  return SEARCH + encodeURIComponent(s);
}

export default {
  id: 'navegador-ligero',
  name: 'Navegador',
  description: 'Busca en internet y descarga a Archivos',

  async launch(ctx, startUrl = null) {
    const win = ctx.createWindow({ title: 'Navegador', width: 1080, height: 680 });
    win.body.classList.add('app-browser');
    win.body.innerHTML = `
      <div class="browser-bar">
        <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
        <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
        <button class="icon-btn reload" title="Recargar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg></button>
        <label class="omnibox"><span class="lock">${GLYPHS.search}</span><input placeholder="Busca o escribe una dirección" spellcheck="false" autocapitalize="none"></label>
        <button class="icon-btn downloads" title="Descargas">${GLYPHS.download}</button>
        <button class="icon-btn external" title="Abrir fuera de WonderfulOS"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button>
      </div>
      <div class="browser-progress"></div>
      <div class="browser-page">
        <div class="start"></div>
        <iframe sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads" referrerpolicy="no-referrer" hidden></iframe>
      </div>`;
    const $ = (s) => win.body.querySelector(s);
    const frame = $('iframe');
    const start = $('.start');
    const input = $('.omnibox input');
    const bar = $('.browser-progress');
    const history = [];
    let pos = -1;
    await ready;

    const loading = (on) => bar.classList.toggle('on', on);
    frame.addEventListener('load', () => loading(false));

    function showStart() {
      frame.hidden = true;
      frame.src = 'about:blank';
      start.hidden = false;
      input.value = '';
      loading(false);
      win.setTitle('Nueva pestaña');
      start.innerHTML = `
        <div class="start-logo"><span>${GLYPHS.logo}</span>Buscar en internet</div>
        <label class="start-search">${GLYPHS.search}<input placeholder="¿Qué quieres buscar?" spellcheck="false"></label>
        <div class="favs">${FAVORITES.map(([n, u, c]) => `<button data-url="${u}"><span style="background:${c}">${esc(n[0])}</span>${esc(n)}</button>`).join('')}</div>
        ${getProxyOrigin() ? '' : '<p class="start-note">El navegador necesita el servidor de WonderfulOS para mostrar webs.</p>'}`;
      const q = start.querySelector('input');
      q.onkeydown = (e) => { if (e.key === 'Enter' && q.value.trim()) go(toUrl(q.value)); };
      start.querySelectorAll('[data-url]').forEach((b) => { b.onclick = () => go(b.dataset.url); });
      $('.back').disabled = true;
      $('.fwd').disabled = history.length === 0;
      if (!document.body.classList.contains('mobile')) setTimeout(() => q.focus(), 50);
    }
    function show(u) {
      start.hidden = true;
      frame.hidden = false;
      loading(true);
      const q = u.startsWith(SEARCH) ? decodeURIComponent(u.slice(SEARCH.length)) : null;
      frame.src = q !== null ? searchUrl(q) : proxify(u);
      input.value = q ?? u;
      win.setTitle(q ? `${q} — Búsqueda` : hostOf(u));
      $('.back').disabled = false; // desde la primera página, Atrás vuelve al inicio
      $('.fwd').disabled = pos >= history.length - 1;
    }
    function go(u) {
      history.splice(pos + 1);
      history.push(u);
      pos = history.length - 1;
      show(u);
    }

    // Descargas: se guardan en tu nube, en Descargas, con un nombre libre.
    async function save({ url, name, size, mime }) {
      let file = String(name || 'descarga').replace(/[\\/]/g, '-').slice(0, 200) || 'descarga';
      const [, stem, ext] = file.match(/^(.*?)(\.[^.]*)?$/);
      for (let i = 2; ctx.fs.exists(`/Descargas/${file}`); i++) file = `${stem} (${i})${ext || ''}`;
      try { await ctx.download({ url, path: normalize(`/Descargas/${file}`), size: Number(size) || 0, mime: String(mime || '') }); }
      catch (e) { ctx.notify(e.message, 6000, { title: 'No se pudo descargar', icon: 'navegador' }); }
    }

    // Lo que nos cuentan las páginas (a través del proxy): dónde están, nuevas ventanas y descargas.
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== getProxyOrigin()) return;
      const { type, url, title } = e.data || {};
      if (typeof url !== 'string' || !/^https?:/.test(url) || url.startsWith(e.origin)) return;
      if (type === 'nubeos:nav') {
        loading(false);
        if (/^https:\/\/(www\.bing\.com|html\.duckduckgo\.com|duckduckgo\.com)\//.test(url)) return; // nuestra página de resultados
        if (url !== history[pos]) { history.splice(pos + 1); history.push(url); pos = history.length - 1; }
        input.value = url;
        if (title) win.setTitle(String(title).slice(0, 80));
      }
      if (type === 'nubeos:open') ctx.launch('navegador', url);
      if (type === 'nubeos:download') save(e.data);
    };
    window.addEventListener('message', onMessage);
    win.onClose(() => { window.removeEventListener('message', onMessage); return true; });

    $('.back').onclick = () => { if (pos > 0) show(history[--pos]); else { pos = -1; showStart(); } };
    $('.fwd').onclick = () => pos < history.length - 1 && show(history[++pos]);
    $('.reload').onclick = () => (pos >= 0 ? show(history[pos]) : showStart());
    $('.downloads').onclick = () => ctx.launch('archivos', '/Descargas');
    $('.external').onclick = () => {
      const u = history[pos];
      if (u && !u.startsWith(SEARCH)) window.open(u, '_blank', 'noopener');
    };
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { go(toUrl(input.value)); input.blur(); } };
    input.onfocus = () => input.select();

    if (startUrl) go(startUrl); else showStart();
  },
};
