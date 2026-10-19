// Navegador de WonderfulOS: página de inicio propia, barra de direcciones y búsqueda.
// En el prototipo las webs pasan por el servidor de desarrollo (para poder
// mostrarlas dentro de la ventana); en el sistema instalado será un navegador real.
import { GLYPHS } from '../icons.js';
import { initProxy, proxify, searchUrl, getProxyOrigin } from '../../../web-desktop/js/proxy.js';

await initProxy();

const SEARCH = 'https://www.bing.com/search?q=';
const FAVORITES = [
  ['Wikipedia', 'https://es.wikipedia.org', '#0f172a'],
  ['YouTube', 'https://www.youtube.com', '#ef4444'],
  ['GitHub', 'https://github.com', '#24292f'],
  ['El País', 'https://elpais.com', '#1d4ed8'],
  ['Flathub', 'https://flathub.org', '#4a90d9'],
  ['OpenStreetMap', 'https://www.openstreetmap.org', '#16a34a'],
];
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function toUrl(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  return SEARCH + encodeURIComponent(s);
}

export default {
  id: 'navegador',
  name: 'Navegador',
  description: 'Navega por internet',

  launch(ctx, startUrl = null) {
    const win = ctx.createWindow({ title: 'Navegador', width: 1000, height: 640 });
    win.body.classList.add('app-browser');
    win.body.innerHTML = `
      <div class="browser-bar">
        <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
        <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
        <button class="icon-btn reload" title="Recargar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg></button>
        <label class="omnibox"><span class="lock">${GLYPHS.search}</span><input placeholder="Busca o escribe una dirección" spellcheck="false"></label>
        <button class="icon-btn home" title="Inicio">${GLYPHS.home}</button>
      </div>
      <div class="browser-page">
        <div class="start"></div>
        <iframe sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads" hidden></iframe>
      </div>`;
    const $ = (s) => win.body.querySelector(s);
    const frame = $('iframe');
    const start = $('.start');
    const input = $('.omnibox input');
    const history = [];
    let pos = -1;

    function showStart() {
      frame.hidden = true;
      frame.src = 'about:blank';
      start.hidden = false;
      input.value = '';
      win.setTitle('Nueva pestaña');
      start.innerHTML = `
        <div class="start-clock">${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
        <label class="start-search">${GLYPHS.search}<input placeholder="Buscar en internet"></label>
        <div class="favs">${FAVORITES.map(([n, u, c]) => `<button data-url="${u}"><span style="background:${c}">${esc(n[0])}</span>${esc(n)}</button>`).join('')}</div>
        ${getProxyOrigin() ? '' : '<p class="start-note">Para ver webs dentro de la ventana, abre el prototipo con <code>node web-desktop/server.mjs</code>.</p>'}`;
      const q = start.querySelector('input');
      q.onkeydown = (e) => { if (e.key === 'Enter' && q.value.trim()) go(toUrl(q.value)); };
      start.querySelectorAll('[data-url]').forEach((b) => { b.onclick = () => go(b.dataset.url); });
      setTimeout(() => q.focus(), 50);
    }
    function show(u) {
      start.hidden = true;
      frame.hidden = false;
      const q = u.startsWith(SEARCH) ? new URL(u).searchParams.get('q') : null;
      frame.src = q !== null && getProxyOrigin() ? searchUrl(q) : proxify(u);
      input.value = q ?? u;
      win.setTitle(q ? `${q} — Búsqueda` : hostOf(u));
      $('.back').disabled = pos < 0; // desde la primera página, Atrás vuelve al inicio
      $('.fwd').disabled = pos >= history.length - 1;
    }
    function go(u) {
      history.splice(pos + 1);
      history.push(u);
      pos = history.length - 1;
      show(u);
    }
    // Las páginas avisan de su dirección real y su título (ver proxy de desarrollo).
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== getProxyOrigin()) return;
      const { type, url, title } = e.data || {};
      if (type === 'nubeos:nav' && typeof url === 'string' && /^https?:/.test(url) && !url.startsWith(e.origin)) {
        if (url !== history[pos] && !url.startsWith('https://www.bing.com/search')) { history.splice(pos + 1); history.push(url); pos = history.length - 1; input.value = url; }
        if (title) win.setTitle(String(title).slice(0, 80));
      }
      if (type === 'nubeos:open' && typeof url === 'string') ctx.launch('navegador', url);
    };
    window.addEventListener('message', onMessage);
    win.onClose(() => { window.removeEventListener('message', onMessage); return true; });

    $('.back').onclick = () => { if (pos > 0) show(history[--pos]); else showStart(); };
    $('.fwd').onclick = () => pos < history.length - 1 && show(history[++pos]);
    $('.reload').onclick = () => pos >= 0 && show(history[pos]);
    $('.home').onclick = () => { pos = -1; history.length = 0; showStart(); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) go(toUrl(input.value)); };
    input.onfocus = () => input.select();

    if (startUrl) go(startUrl); else showStart();
  },
};
