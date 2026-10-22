// Ajustes: cuenta y espacio (planes), apariencia, fondo, dock y pantalla.
import { settings, ACCENTS, WALLPAPERS } from '../shell/settings.js';
import { GLYPHS, ICONS } from '../shell/icons.js';
import { api } from '../api.js';
import { isCloud } from '../fs.js';
import { humanSize, esc } from '../util.js';

// Se calcula al abrir: la sesión en la nube se conoce después de cargar el módulo.
const sections = () => [
  ...(isCloud() ? [['cuenta', 'cloud', window.nubeosDesktop ? 'Almacenamiento' : 'Cuenta y almacenamiento']] : []),
  ['apariencia', 'palette', 'Apariencia'],
  ['fondo', 'image', 'Fondo de pantalla'],
  ['dock', 'dock', 'Dock'],
  ['pantalla', 'sun', 'Pantalla'],
  ['accesibilidad', 'info', 'Accesibilidad'],
  ...(window.nubeosDesktop ? [['equipo', 'dock', 'Este ordenador']] : []),
  ['acerca', 'info', 'Acerca de WonderfulOS'],
];

export default {
  id: 'ajustes',
  name: 'Ajustes',
  description: 'Personaliza tu sistema',

  launch(ctx, section = isCloud() ? 'cuenta' : 'apariencia') {
    const win = ctx.createWindow({ title: 'Ajustes', width: 820, height: 560 });
    win.body.style.flexDirection = 'row';
    win.body.innerHTML = `
      <nav class="side" style="width:210px;padding:12px;display:flex;flex-direction:column;gap:2px;border-right:0.5px solid var(--border)"></nav>
      <main class="content" style="flex:1;overflow:auto;padding:24px 30px"></main>`;
    const side = win.body.querySelector('.side');
    const content = win.body.querySelector('.content');
    let current = section;

    const row = (label, control, hint = '') => `
      <div style="display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:14px;background:color-mix(in srgb, var(--text) 4%, transparent);margin-bottom:10px">
        <div style="flex:1"><div style="font-weight:500">${label}</div>${hint ? `<small style="color:var(--muted)">${hint}</small>` : ''}</div>${control}</div>`;
    const segmented = (name, options, value) => `<div style="display:flex;gap:4px;padding:3px;border-radius:10px;background:color-mix(in srgb, var(--text) 7%, transparent)">
      ${options.map(([v, l]) => `<button data-${name}="${v}" style="border:0;padding:6px 14px;border-radius:8px;background:${v === value ? 'var(--panel-solid)' : 'transparent'};box-shadow:${v === value ? '0 1px 3px rgba(0,0,0,.15)' : 'none'}">${l}</button>`).join('')}</div>`;

    const gb = (b) => (b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(1)} TB` : `${Math.round(b / 1024 ** 3)} GB`);

    function render() {
      const s = settings.get();
      side.innerHTML = '';
      for (const [id, ic, label] of sections()) {
        const b = document.createElement('button');
        b.innerHTML = `<span style="width:22px;display:grid;place-items:center">${GLYPHS[ic]}</span> ${label}`;
        b.style.cssText = `display:flex;gap:8px;align-items:center;border:0;padding:8px 10px;border-radius:10px;text-align:left;font-size:13px;background:${id === current ? 'var(--accent)' : 'none'};color:${id === current ? '#fff' : 'inherit'}`;
        b.onclick = () => { current = id; render(); };
        side.appendChild(b);
      }
      const title = (sections().find((x) => x[0] === current) || sections()[0])[2];
      let html = `<h2 style="margin:0 0 18px;font-size:22px;font-weight:650">${title}</h2>`;

      if (current === 'cuenta') {
        const a = ctx.account?.info;
        if (!a) html += '<p style="color:var(--muted)">Cargando tu cuenta…</p>';
        else {
          const pct = Math.min(100, (a.used / a.quota) * 100);
          html += a.local ? `<div style="padding:20px;border-radius:18px;background:color-mix(in srgb, var(--text) 4%, transparent);margin-bottom:14px">
              <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px"><span style="font-size:26px;font-weight:700">${humanSize(a.quota - a.used)}</span><span style="color:var(--muted)">libres de ${gb(a.quota)}</span></div>
              <div class="storage" style="padding:0"><div class="bar${pct > 90 ? ' full' : ''}"><span style="width:${Math.max(pct, 1)}%"></span></div></div>
              <small style="color:var(--muted);display:block;margin-top:10px">Disco de este ordenador: ${humanSize(a.used)} ocupados. Tus archivos de WonderfulOS ocupan ${humanSize(a.mine || 0)}.</small></div>`
            : `<div style="display:flex;align-items:center;gap:16px;padding:18px;border-radius:18px;background:color-mix(in srgb, var(--text) 4%, transparent);margin-bottom:18px">
            <div style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:22px;font-weight:600;background:linear-gradient(135deg,#818cf8,#ec4899)">${esc(a.user[0].toUpperCase())}</div>
            <div style="flex:1"><div style="font-size:17px;font-weight:650">${esc(a.user)}</div>
              <div class="storage" style="padding:6px 0 0"><div class="bar${pct > 90 ? ' full' : ''}"><span style="width:${Math.max(pct, 1)}%"></span></div>${humanSize(a.used)} usados de ${gb(a.quota)}</div></div>
            <button class="btn" data-logout>Cerrar sesión</button></div>`;
        }
      }
      if (current === 'equipo') {
        html += row('Abrir WonderfulOS al encender el ordenador', `<input type="checkbox" data-login style="width:20px;height:20px;accent-color:var(--accent)">`, 'WonderfulOS se convierte en lo primero que ves');
        html += row('Pantalla completa', `<input type="checkbox" data-full checked style="width:20px;height:20px;accent-color:var(--accent)">`, 'Usa toda la pantalla, como un sistema operativo');
        html += `<div data-linux-row></div>`;
        html += row('Salir de WonderfulOS', '<button class="btn" data-quit>Salir</button>', 'Vuelves al sistema de tu ordenador');
      }
      if (current === 'apariencia') {
        html += row('Tema', segmented('theme', [['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Automático']], s.theme), 'Automático sigue la hora del sistema');
        html += row('Color de acento', `<div style="display:flex;gap:8px">${ACCENTS.map((c) => `<button data-accent="${c}" title="${c}" style="width:26px;height:26px;border-radius:50%;border:${c === s.accent ? '3px solid var(--text)' : '0'};background:${c}"></button>`).join('')}</div>`);
      }
      if (current === 'fondo') {
        const dark = settings.isDark(s);
        const customColor = /^#[0-9a-f]{6}$/i.test(s.wallpaperColor || '') ? s.wallpaperColor : '#2563eb';
        const tile = (id, name, bg) => `<button data-wallpaper="${id}" style="border:0;padding:0;background:none;text-align:left">
          <div style="height:100px;border-radius:14px;background:${bg};box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);outline:${id === s.wallpaper ? '3px solid var(--accent)' : '0'};outline-offset:2px"></div>
          <div style="margin-top:6px;font-size:13px">${name}</div></button>`;
        const grid = (items) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px">${items.join('')}</div>`;
        const solids = Object.entries(WALLPAPERS).filter(([, w]) => w.kind === 'solid');
        const gradients = Object.entries(WALLPAPERS).filter(([, w]) => w.kind !== 'solid');
        html += `<h3 style="margin:0 0 10px;font-size:15px">Colores planos</h3>`;
        html += grid([...solids.map(([id, w]) => tile(id, w.name, dark ? w.dark : w.light)), tile('custom', 'Personalizado', customColor)]);
        html += `<div style="display:flex;align-items:center;gap:10px;margin:14px 0 24px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">Color personalizado
            <input type="color" data-wallpaper-color value="${customColor}" style="width:38px;height:30px;padding:2px;border:0;border-radius:8px;background:none;cursor:pointer">
          </label><code data-wallpaper-hex style="font-size:12px;color:var(--muted)">${customColor}</code>
        </div>`;
        html += `<h3 style="margin:0 0 10px;font-size:15px">Degradados</h3>`;
        html += grid(gradients.map(([id, w]) => tile(id, w.name, dark ? w.dark : w.light)));
      }
      if (current === 'dock') {
        html += row('Tamaño de los iconos', `<input type="range" min="40" max="80" value="${s.dockSize}" data-range="dockSize" style="width:180px;accent-color:var(--accent)">`);
        html += row('Efecto lupa', `<input type="checkbox" ${s.magnify ? 'checked' : ''} data-check="magnify" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Los iconos crecen al pasar el ratón');
      }
      if (current === 'pantalla') {
        html += row('Brillo', `<input type="range" min="0" max="60" value="${Math.round((0.6 - s.dim) * 100)}" data-range="brightness" style="width:180px;accent-color:var(--accent)">`);
        html += row('Luz nocturna', `<input type="checkbox" ${s.night ? 'checked' : ''} data-check="night" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Colores más cálidos para descansar la vista');
      }
      if (current === 'accesibilidad') {
        html += row('Tamaño del texto', segmented('scale', [['1', 'Normal'], ['1.15', 'Grande'], ['1.3', 'Muy grande']], String(s.textScale || 1)), 'Agranda todo el sistema: textos, iconos y ventanas');
        html += row('Alto contraste', `<input type="checkbox" ${s.contrast ? 'checked' : ''} data-check="contrast" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Texto más oscuro, bordes marcados y sin transparencias');
        html += row('Reducir el movimiento', `<input type="checkbox" ${s.reduceMotion ? 'checked' : ''} data-check="reduceMotion" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Sin animaciones ni efecto lupa en el dock');
        html += `<small style="color:var(--muted)">Todo se puede usar con el teclado: Tab para moverte, Intro para abrir y Esc para cerrar.</small>`;
      }
      if (current === 'acerca') {
        html += `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px;text-align:center">
          <div style="width:96px;height:96px;box-shadow:0 14px 30px rgba(20,22,31,.35)">${ICONS.logo}</div><div style="font-size:26px;font-weight:650">WonderfulOS</div>
          <div style="color:var(--muted)">Versión 0.16.6 · basado en Linux</div>
          <p style="max-width:420px;color:var(--muted)">Un sistema operativo basado en Linux, sencillo y bonito: oficina, correo, navegador y todas las apps de Linux, con la potencia de tu ordenador. Es <b>software libre</b> (licencia GPL-3.0): puedes usarlo, estudiarlo, compartirlo y mejorarlo.</p></div>`;
      }
      content.innerHTML = html;

      content.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { settings.set({ theme: b.dataset.theme }); render(); }; });
      content.querySelectorAll('[data-scale]').forEach((b) => { b.onclick = () => { settings.set({ textScale: Number(b.dataset.scale) }); render(); }; });
      content.querySelectorAll('[data-accent]').forEach((b) => { b.onclick = () => { settings.set({ accent: b.dataset.accent }); render(); }; });
      content.querySelectorAll('[data-wallpaper]').forEach((b) => { b.onclick = () => { settings.set({ wallpaper: b.dataset.wallpaper }); render(); }; });
      const color = content.querySelector('[data-wallpaper-color]');
      if (color) color.oninput = () => {
        settings.set({ wallpaper: 'custom', wallpaperColor: color.value });
        const customTile = content.querySelector('[data-wallpaper="custom"] > div');
        if (customTile) customTile.style.background = color.value;
        const hex = content.querySelector('[data-wallpaper-hex]');
        if (hex) hex.textContent = color.value;
        content.querySelectorAll('[data-wallpaper]').forEach((b) => {
          const preview = b.firstElementChild;
          if (preview) preview.style.outline = b.dataset.wallpaper === 'custom' ? '3px solid var(--accent)' : '0';
        });
      };
      content.querySelectorAll('[data-range]').forEach((r) => {
        r.oninput = () => settings.set(r.dataset.range === 'brightness' ? { dim: +(0.6 - r.value / 100).toFixed(2) } : { [r.dataset.range]: +r.value });
      });
      content.querySelectorAll('[data-check]').forEach((c) => { c.onchange = () => settings.set({ [c.dataset.check]: c.checked }); });
      if (current === 'equipo') {
        const d = window.nubeosDesktop;
        d.info().then((i) => { const c = content.querySelector('[data-login]'); if (c) c.checked = i.openAtLogin; });
        content.querySelector('[data-login]').onchange = (e) => d.setOpenAtLogin(e.target.checked);
        content.querySelector('[data-full]').onchange = (e) => d.setFullscreen(e.target.checked);
        content.querySelector('[data-quit]').onclick = () => d.quit();
        // Motor Linux (Mac): un Linux pequeño dentro de WonderfulOS para usar apps de Linux.
        const slot = content.querySelector('[data-linux-row]');
        const LABEL = { 'sin instalar': 'Sin activar', apagado: 'Apagado', encendido: 'Encendido', preparando: 'Preparando…' };
        const drawLinux = async () => {
          const st = await d.linux.status().catch(() => ({ supported: false }));
          if (!st.supported || current !== 'equipo' || !slot.isConnected) { slot.innerHTML = ''; return; }
          const btn = st.state === 'preparando' ? '' : st.state === 'encendido' ? '<button class="btn" data-linux="stop">Apagar</button>'
            : `<button class="btn primary" data-linux="start">${st.state === 'apagado' ? 'Encender' : 'Activar'}</button>`;
          slot.innerHTML = row(`Motor Linux · ${LABEL[st.state] || st.state}`, btn,
            'Usa apps de Linux (también las de Intel) en ventanas de WonderfulOS. Se instalan desde la Tienda › Apps de Linux o abriendo un .AppImage, .deb o .flatpakref. Ocupa unos 4 GB de memoria mientras está encendido.');
          slot.querySelector('[data-linux]')?.addEventListener('click', async (e) => {
            const act = e.target.dataset.linux;
            const p = act === 'start' ? d.linux.start() : d.linux.stop();
            setTimeout(drawLinux, 300);
            try { await p; } catch (err) { ctx.notify(err.message, 8000, { title: 'Motor Linux', icon: 'ajustes' }); }
            drawLinux();
          });
        };
        drawLinux();
      }
      content.querySelector('[data-logout]')?.addEventListener('click', () => ctx.logout());
      content.querySelectorAll('[data-text]').forEach((i) => { i.onchange = () => settings.set({ [i.dataset.text]: i.value.trim() || 'Usuario' }); });
    }
    const onAccount = () => current === 'cuenta' && render();
    ctx.account?.listeners.add(onAccount);
    win.onClose(() => { ctx.account?.listeners.delete(onAccount); return true; });
    ctx.refreshAccount?.();
    render();
  },
};
