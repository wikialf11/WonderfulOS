// Navegador: un Chromium de verdad (código abierto) que corre en el servidor y se ve en
// esta ventana, con el color y el tema de WonderfulOS. Funciona todo: Google, YouTube,
// iniciar sesión, pestañas… Lo que descargas aparece en Archivos › Descargas.
// El botón de la llave rellena usuario y contraseña desde el Llavero.
// Si el servidor no tiene el navegador completo, se usa el ligero (por proxy).
import { api } from '../api.js';
import { settings } from '../shell/settings.js';
import { GLYPHS } from '../shell/icons.js';
import { keychain, hostOf } from '../keychain.js';
import { esc } from '../util.js';
import ligero from './navegador-ligero.js';
import local from './navegador-local.js';

let info = null;

/** Pide la contraseña maestra en un diálogo dentro de la ventana. */
export function unlockDialog(win) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dialog-backdrop';
    back.innerHTML = `<form class="dialog"><h3>Desbloquear el Llavero</h3>
      <input type="password" placeholder="Contraseña maestra" autocomplete="current-password" required>
      <small class="err" style="color:#ef4444" hidden></small>
      <div class="actions"><button type="button" class="btn cancel">Cancelar</button><button class="btn primary">Desbloquear</button></div></form>`;
    win.body.appendChild(back);
    const form = back.querySelector('form');
    const input = form.querySelector('input');
    input.focus();
    back.querySelector('.cancel').onclick = () => { back.remove(); resolve(false); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { await keychain.unlock(input.value); back.remove(); resolve(true); }
      catch (er) { const m = form.querySelector('.err'); m.textContent = er.message; m.hidden = false; input.select(); }
    };
  });
}

export default {
  id: 'navegador',
  name: 'Navegador',
  description: 'Navega por internet y descarga a Archivos',

  async launch(ctx, startUrl) {
    // WonderfulOS instalado en el ordenador: el Navegador es el Chromium de la propia app.
    if (window.nubeosDesktop) return local.launch(ctx, startUrl);
    info ??= await api('browser/info').catch(() => ({ enabled: false }));
    if (!info.enabled) return ligero.launch(ctx, startUrl);
    // Un solo navegador por persona (con sus pestañas dentro): si ya está abierto, se trae al frente.
    const open = ctx.windows?.().find((w) => w.appId === 'navegador');
    if (open) return open.focus();

    const win = ctx.createWindow({ title: 'Navegador', width: Math.min(1280, innerWidth - 60), height: Math.min(820, innerHeight - 120) });
    if (!document.body.classList.contains('mobile')) win.toggleMaximize();
    win.body.classList.add('app-browser-full');
    win.body.innerHTML = `
      <div class="nav-loading"><div class="globe">${GLYPHS.cloud}</div><strong>Preparando tu navegador…</strong><span>La primera vez tarda unos segundos.</span></div>
      <iframe allow="autoplay; fullscreen; clipboard-read; clipboard-write; microphone; camera" hidden></iframe>`;
    const frame = win.body.querySelector('iframe');
    const loading = win.body.querySelector('.nav-loading');
    let closed = false, alive = null, ro = null;
    win.onClose(() => {
      // Cerrar la ventana cierra el navegador de verdad (la próxima vez empieza limpio).
      closed = true;
      clearInterval(alive); ro?.disconnect();
      frame.src = 'about:blank';
      api('browser/stop', { method: 'POST' }).catch(() => {});
      return true;
    });

    // Botón del Llavero en la barra de la ventana.
    const keyBtn = document.createElement('button');
    keyBtn.className = 'key-btn';
    keyBtn.title = 'Rellenar con el Llavero';
    keyBtn.innerHTML = GLYPHS.key;
    win.el.querySelector('.titlebar .controls').prepend(keyBtn);
    keyBtn.onclick = async (e) => {
      e.stopPropagation();
      const r = keyBtn.getBoundingClientRect();
      await keychain.init().catch(() => {});
      if (!keychain.isSetUp()) return ctx.launch('llavero');
      if (!keychain.isUnlocked() && !(await unlockDialog(win))) return;
      const { page } = await api('browser/page').catch(() => ({ page: null }));
      const matches = page ? keychain.matching(page.url) : [];
      const others = keychain.entries().filter((x) => !matches.includes(x)).slice(0, 8);
      const fill = (x) => api('browser/fill', { method: 'POST', body: { user: x.user, pass: x.pass } })
        .then(() => ctx.notify(`Rellenado ${x.user || 'el formulario'} en ${hostOf(page?.url || x.site)}.`, 3000, { title: 'Llavero', icon: 'llavero' }))
        .catch((er) => ctx.notify(er.message, 5000, { title: 'Llavero', icon: 'llavero' }));
      ctx.menu([
        ...(matches.length ? matches.map((x) => ({ label: `Rellenar ${x.user || x.name || x.site}`, run: () => fill(x) }))
          : [{ label: page ? `No hay contraseñas para ${hostOf(page.url)}` : 'Abre una web para rellenar', disabled: true }]),
        ...(others.length ? ['-', ...others.map((x) => ({ label: `${x.name || x.site} · ${x.user}`, run: () => fill(x) }))] : []),
        '-',
        { label: 'Guardar una contraseña para esta web…', run: () => ctx.launch('llavero', { new: { site: page ? hostOf(page.url) : '' } }) },
        { label: 'Abrir el Llavero', run: () => ctx.launch('llavero') },
      ], r.right - 260, r.bottom + 6);
    };

    // Esperamos a que la ventana tenga su tamaño final para pedir la pantalla del mismo tamaño.
    await new Promise((r) => setTimeout(r, 350));
    const s = settings.get();
    try {
      const { url } = await api('browser/start', { method: 'POST', body: {
        width: win.body.clientWidth, height: win.body.clientHeight, dark: settings.isDark(s), accent: s.accent,
      } });
      if (closed) return;
      frame.src = url;
      frame.onload = () => setTimeout(() => { loading.remove(); frame.hidden = false; frame.focus(); }, 1200);
    } catch (e) {
      loading.innerHTML = `<strong>No se pudo abrir el navegador</strong><span>${esc(e.message)}</span>`;
    }
    // Al cambiar el tamaño de la ventana, la pantalla del navegador se ajusta.
    if (closed) return;
    let t;
    ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => api('browser/resize', { method: 'POST', body: { width: win.body.clientWidth, height: win.body.clientHeight } }).catch(() => {}), 400);
    });
    ro.observe(win.body);
    // Mientras la ventana esté abierta, el servidor no apaga el navegador.
    alive = setInterval(() => api('browser/keepalive', { method: 'POST' }).catch(() => {}), 60000);
  },
};
