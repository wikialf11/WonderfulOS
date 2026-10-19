// Navegador de WonderfulOS instalado en el ordenador: Chromium de verdad (el de la app),
// con pestañas, y descargas que van a Archivos › Descargas.
import { GLYPHS } from '../shell/icons.js';
import { esc } from '../util.js';

const HOME = 'https://www.google.com/';
const toUrl = (s) => {
  s = s.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
};
const RELOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>';

export default {
  id: 'navegador',
  name: 'Navegador',
  description: 'Navega por internet',

  launch(ctx, startUrl) {
    const open = ctx.windows?.().find((w) => w.appId === 'navegador');
    if (open) { open.focus(); if (startUrl) open.newTab?.(startUrl); return; }
    const win = ctx.createWindow({ title: 'Navegador', width: Math.min(1280, innerWidth - 60), height: Math.min(820, innerHeight - 120) });
    if (!document.body.classList.contains('mobile')) win.toggleMaximize();
    win.body.classList.add('app-browser', 'app-browser-local');
    win.body.innerHTML = `
      <div class="tabs-bar"><div class="tabs"></div><button class="icon-btn new-tab" title="Pestaña nueva">${GLYPHS.plus}</button></div>
      <div class="browser-bar">
        <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
        <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
        <button class="icon-btn reload" title="Recargar">${RELOAD}</button>
        <label class="omnibox"><span class="lock">${GLYPHS.search}</span><input placeholder="Busca en Google o escribe una dirección" spellcheck="false" autocapitalize="none"></label>
        <button class="icon-btn downloads" title="Descargas">${GLYPHS.download}</button>
      </div>
      <div class="browser-progress"></div>
      <div class="browser-page"></div>`;
    const $ = (s) => win.body.querySelector(s);
    const page = $('.browser-page');
    const input = $('.omnibox input');
    const tabs = [];
    let active = null;

    function renderTabs() {
      const box = $('.tabs');
      box.innerHTML = '';
      for (const t of tabs) {
        const el = document.createElement('div');
        el.className = `tab${t === active ? ' on' : ''}`;
        el.innerHTML = `${t.favicon ? `<img src="${esc(t.favicon)}" alt="">` : `<span class="dot">${GLYPHS.cloud}</span>`}<span class="t">${esc(t.title || 'Pestaña nueva')}</span><button class="x" title="Cerrar pestaña">×</button>`;
        el.onclick = () => select(t);
        el.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(t); };
        box.appendChild(el);
      }
    }
    function update() {
      if (!active) return;
      const v = active.view;
      input.value = active.url === HOME ? '' : active.url;
      $('.back').disabled = !active.ready || !v.canGoBack();
      $('.fwd').disabled = !active.ready || !v.canGoForward();
      $('.browser-progress').classList.toggle('on', !!active.loading);
      win.setTitle(active.title || 'Navegador');
      renderTabs();
    }
    function newTab(url = HOME) {
      const view = document.createElement('webview');
      view.setAttribute('src', url);
      view.setAttribute('allowpopups', '');
      view.setAttribute('partition', 'persist:navegador');
      const t = { view, url, title: '', favicon: '', loading: true, ready: false };
      view.addEventListener('dom-ready', () => { t.ready = true; update(); });
      view.addEventListener('did-start-loading', () => { t.loading = true; update(); });
      view.addEventListener('did-stop-loading', () => { t.loading = false; update(); });
      view.addEventListener('did-navigate', (e) => { t.url = e.url; update(); });
      view.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { t.url = e.url; update(); } });
      view.addEventListener('page-title-updated', (e) => { t.title = e.title; update(); });
      view.addEventListener('page-favicon-updated', (e) => { t.favicon = e.favicons?.[0] || ''; renderTabs(); });
      tabs.push(t);
      page.appendChild(view);
      select(t);
      return t;
    }
    function select(t) {
      active = t;
      for (const x of tabs) x.view.classList.toggle('hidden', x !== t);
      update();
    }
    function closeTab(t) {
      const i = tabs.indexOf(t);
      tabs.splice(i, 1);
      t.view.remove();
      if (!tabs.length) return win.close();
      if (active === t) select(tabs[Math.max(0, i - 1)]); else renderTabs();
    }
    win.newTab = newTab;

    $('.new-tab').onclick = () => { newTab(); input.focus(); };
    $('.back').onclick = () => active?.view.goBack();
    $('.fwd').onclick = () => active?.view.goForward();
    $('.reload').onclick = () => active?.view.reload();
    $('.downloads').onclick = () => ctx.launch('archivos', '/Descargas');
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { active.view.loadURL(toUrl(input.value)); input.blur(); } };
    input.onfocus = () => input.select();
    // Atajos habituales de un navegador.
    win.el.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); newTab(); input.focus(); }
      if (k === 'w') { e.preventDefault(); if (active) closeTab(active); }
      if (k === 'l') { e.preventDefault(); input.focus(); }
      if (k === 'r') { e.preventDefault(); active?.view.reload(); }
    });
    newTab(startUrl || HOME);
  },
};
