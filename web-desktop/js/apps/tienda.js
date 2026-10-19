// Tienda: programas de Linux (Flathub) para instalar en tu ordenador de WonderfulOS.
// Se abren en una ventana de WonderfulOS (Xpra en tu ordenador).
import { api } from '../api.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { emptyState } from '../cloud.js';
import { esc } from '../util.js';

const SUGGESTED = ['org.gimp.GIMP', 'org.inkscape.Inkscape', 'org.kde.kdenlive', 'org.audacityteam.Audacity', 'org.videolan.VLC', 'org.blender.Blender', 'org.kde.krita', 'com.obsproject.Studio'];

export default {
  id: 'tienda',
  name: 'Tienda',
  description: 'Instala programas de Linux en tu ordenador',

  async launch(ctx, query = '') {
    const win = ctx.createWindow({ title: 'Tienda', width: 940, height: 620 });
    win.body.classList.add('app-cloud', 'app-tienda');
    if (window.nubeosDesktop) return localStore(ctx, win, query);
    const { mode, machine } = await api('machine').catch(() => ({}));
    if (mode !== 'remoto') {
      const preparing = machine && ['comprando', 'instalando'].includes(machine.state);
      win.body.innerHTML = emptyState(ICONS.tienda,
        preparing ? 'Estamos preparando tu ordenador' : 'Instala WonderfulOS en tu ordenador',
        preparing ? 'Tarda unos minutos. Cuando esté listo podrás instalar aquí los programas que quieras.'
          : 'La Tienda instala programas de verdad en tu ordenador. Descarga WonderfulOS para Mac, Windows o Linux y úsala desde ahí.');
      return;
    }

    win.body.innerHTML = `
      <section class="cl-main">
        <header class="cl-head"><h2 class="title">Tienda</h2><span class="grow"></span>
          <label class="cl-search store-search">${GLYPHS.search}<input placeholder="Buscar programas (GIMP, Blender, Spotify…)" value="${esc(query)}"></label></header>
        <div class="store-body"></div>
      </section>`;
    const $ = (s) => win.body.querySelector(s);
    let installed = [], jobs = {}, poll = null;

    async function refresh() {
      const r = await api('machine/apps').catch(() => ({ apps: [], jobs: {} }));
      installed = r.apps || []; jobs = r.jobs || {};
      const busy = Object.values(jobs).some((j) => j.state === 'trabajando');
      clearTimeout(poll);
      if (busy) poll = setTimeout(() => refresh().then(render), 3000);
    }
    const card = (h) => {
      const has = installed.some((a) => a.id === h.id);
      const job = jobs[h.id];
      const working = job?.state === 'trabajando';
      return `<div class="app-card" data-id="${esc(h.id)}">
        ${h.icon ? `<img src="${esc(h.icon)}" alt="" loading="lazy">` : `<span class="noicon">${ICONS.app}</span>`}
        <div class="info"><strong>${esc(h.name || h.id)}</strong><small>${esc(h.summary || h.id)}</small></div>
        <div class="acts">${working ? '<span class="busy">Instalando…</span>' : has
          ? '<button class="btn primary open">Abrir</button><button class="icon-btn rm" title="Quitar">' + GLYPHS.trash + '</button>'
          : '<button class="btn get">Instalar</button>'}${job?.state === 'error' ? '<small class="err">Falló</small>' : ''}</div></div>`;
    };
    let results = null;
    async function render() {
      const body = $('.store-body');
      const mine = installed.map((a) => ({ id: a.id, name: a.name }));
      const list = results ?? (await Promise.all(SUGGESTED.map((id) => api(`flathub/search?q=${encodeURIComponent(id)}`).then((r) => r.hits.find((h) => h.id === id)).catch(() => null)))).filter(Boolean);
      if (!results) results = null;
      body.innerHTML = `${mine.length ? `<h3>Instalados</h3><div class="app-grid">${mine.map(card).join('')}</div>` : ''}
        <h3>${results ? 'Resultados' : 'Recomendados'}</h3><div class="app-grid">${list.map(card).join('') || '<div class="cl-hint">Nada encontrado</div>'}</div>`;
      body.querySelectorAll('.app-card').forEach((el) => {
        const id = el.dataset.id;
        el.querySelector('.get')?.addEventListener('click', async () => { await api('machine/apps/install', { method: 'POST', body: { id } }); await refresh(); render(); });
        el.querySelector('.rm')?.addEventListener('click', async () => { await api('machine/apps/uninstall', { method: 'POST', body: { id } }); await refresh(); render(); });
        el.querySelector('.open')?.addEventListener('click', () => openApp(ctx, id, el.querySelector('strong').textContent));
      });
    }
    let t;
    $('.store-search input').oninput = (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      t = setTimeout(async () => { results = q ? (await api(`flathub/search?q=${encodeURIComponent(q)}`).catch(() => ({ hits: [] }))).hits : null; render(); }, 350);
    };
    win.onClose(() => { clearTimeout(poll); return true; });
    await refresh();
    if (query) $('.store-search input').dispatchEvent(new Event('input')); else render();
  },
};

/** Abre un programa instalado en una ventana de WonderfulOS. */
export async function openApp(ctx, id, name) {
  try {
    const { url } = await api('machine/apps/session', { method: 'POST', body: { id } });
    const win = ctx.createWindow({ title: name || id, width: 1100, height: 720 });
    win.body.innerHTML = `<iframe src="${esc(url)}" allow="clipboard-read; clipboard-write; fullscreen" style="flex:1;border:0;width:100%;background:#000"></iframe>`;
  } catch (e) { ctx.notify(e.message, 6000, { title: 'Tienda', icon: 'tienda' }); }
}

// WonderfulOS instalado en el ordenador: programas del propio sistema (Homebrew en Mac,
// winget en Windows, Flathub en Linux) y, en el Mac, apps de Linux con el motor Linux.
async function localStore(ctx, win, query) {
  const d = window.nubeosDesktop;
  const { platform } = await d.info();
  const linuxEngine = platform === 'darwin' && (await d.linux.status()).supported;
  const nativeName = { darwin: 'Programas de Mac', win32: 'Programas de Windows', linux: 'Apps de Linux' }[platform] || 'Programas';
  let source = 'native';
  win.body.innerHTML = `
    <section class="cl-main">
      <header class="cl-head"><h2 class="title">Tienda</h2>
        ${linuxEngine ? `<div class="seg"><button class="btn src on" data-s="native">${nativeName}</button><button class="btn src" data-s="linux">Apps de Linux</button></div>` : ''}
        <span class="grow"></span>
        <label class="cl-search store-search">${GLYPHS.search}<input placeholder="Buscar programas (GIMP, VLC, Spotify…)" value="${esc(query)}"></label></header>
      <div class="store-body"></div>
    </section>`;
  const body = win.body.querySelector('.store-body');
  const input = win.body.querySelector('.store-search input');
  let installed = [], results = [], busy = new Set(), engine = null;

  // Cada fuente: buscar, instalados, instalar, quitar, abrir.
  const api_ = () => source === 'linux' ? {
    search: async (q) => (await api(`flathub/search?q=${encodeURIComponent(q)}`)).hits,
    installed: () => d.linux.installed(),
    install: (id) => d.linux.install(id),
    uninstall: (id) => d.linux.uninstall(id),
    open: async (id, name) => { const r = await d.linux.open(id); ctx.openLinuxWindow(r.url, name); },
  } : { search: d.apps.search, installed: d.apps.installed, install: d.apps.install, uninstall: d.apps.uninstall, open: (id) => d.apps.open(id) };

  const draw = () => {
    if (source === 'linux' && engine && engine.state !== 'encendido') {
      body.innerHTML = `<div class="app-empty">${ICONS.tienda}<strong>Apps de Linux en tu Mac</strong>
        <span>${engine.state === 'preparando' ? 'Preparando el motor Linux… la primera vez descarga Linux (unos minutos).' : 'WonderfulOS lleva un Linux pequeño dentro para usar apps de Linux (también las de Intel) en ventanas de WonderfulOS.'}</span>
        ${engine.state === 'preparando' ? '' : `<button class="btn primary on-engine">${engine.state === 'apagado' ? 'Encender el motor Linux' : 'Activar el motor Linux'}</button>`}</div>`;
      body.querySelector('.on-engine')?.addEventListener('click', async () => {
        engine = { state: 'preparando' }; draw();
        try { engine = await d.linux.start(); } catch (e) { ctx.notify(e.message, 8000, { title: 'Motor Linux', icon: 'tienda' }); engine = await d.linux.status(); }
        installed = await api_().installed().catch(() => []); draw();
      });
      return;
    }
    const card = (h) => {
      const has = installed.some((a) => a.id === h.id);
      return `<div class="app-card" data-id="${esc(h.id)}">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : `<span class="noicon">${ICONS.app}</span>`}
        <div class="info"><strong>${esc(h.name || h.id)}</strong><small>${esc(h.summary || h.id)}</small></div>
        <div class="acts">${busy.has(h.id) ? '<span class="busy">Trabajando…</span>' : has
          ? `<button class="btn primary open">Abrir</button><button class="icon-btn rm" title="Quitar">${GLYPHS.trash}</button>` : '<button class="btn get">Instalar</button>'}</div></div>`;
    };
    body.innerHTML = `${installed.length ? `<h3>Instalados</h3><div class="app-grid">${installed.map(card).join('')}</div>` : ''}
      ${results.length ? `<h3>Resultados</h3><div class="app-grid">${results.map(card).join('')}</div>` : ''}` || '<div class="cl-hint">Busca un programa para instalarlo.</div>';
    body.querySelectorAll('.app-card').forEach((el) => {
      const id = el.dataset.id;
      const name = el.querySelector('strong').textContent;
      const act = (fn, msg) => async () => {
        busy.add(id); draw();
        try { await fn(id); if (msg) ctx.notify(msg, 4000, { title: 'Tienda', icon: 'tienda' }); }
        catch (e) { ctx.notify(e.message, 7000, { title: 'Tienda', icon: 'tienda' }); }
        busy.delete(id); installed = await api_().installed().catch(() => installed); draw();
      };
      el.querySelector('.get')?.addEventListener('click', act(api_().install, `${name} instalado.`));
      el.querySelector('.rm')?.addEventListener('click', act(api_().uninstall, `${name} quitado.`));
      el.querySelector('.open')?.addEventListener('click', () => api_().open(id, name).catch((e) => ctx.notify(e.message, 7000, { title: 'Tienda', icon: 'tienda' })));
    });
  };
  async function reload() {
    if (source === 'linux') engine = await d.linux.status();
    installed = await api_().installed().catch(() => []);
    results = input.value.trim() ? await api_().search(input.value).catch(() => []) : [];
    draw();
  }
  win.body.querySelectorAll('.src').forEach((b) => {
    b.onclick = () => { source = b.dataset.s; win.body.querySelectorAll('.src').forEach((x) => x.classList.toggle('on', x === b)); reload(); };
  });
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(async () => { results = input.value.trim() ? await api_().search(input.value).catch(() => []) : []; draw(); }, 400); };
  reload();
}
