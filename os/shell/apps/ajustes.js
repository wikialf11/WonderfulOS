// Ajustes del sistema: apariencia, dock, pantalla y usuario.
import { settings, ACCENTS, WALLPAPERS } from '../settings.js';
import { GLYPHS } from '../icons.js';

const SECTIONS = [
  ['apariencia', 'palette', 'Apariencia'],
  ['fondo', 'image', 'Fondo de pantalla'],
  ['dock', 'dock', 'Dock'],
  ['pantalla', 'sun', 'Pantalla'],
  ['usuario', 'user', 'Usuario'],
  ['acerca', 'info', 'Acerca de WonderfulOS'],
];

export default {
  id: 'ajustes',
  name: 'Ajustes',
  description: 'Personaliza tu sistema',

  launch(ctx, section = 'apariencia') {
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

    function render() {
      const s = settings.get();
      side.innerHTML = '';
      for (const [id, ic, label] of SECTIONS) {
        const b = document.createElement('button');
        b.innerHTML = `<span style="width:22px;display:grid;place-items:center">${GLYPHS[ic]}</span> ${label}`;
        b.style.cssText = `display:flex;gap:8px;align-items:center;border:0;padding:8px 10px;border-radius:10px;text-align:left;font-size:13px;background:${id === current ? 'var(--accent)' : 'none'};color:${id === current ? '#fff' : 'inherit'}`;
        b.onclick = () => { current = id; render(); };
        side.appendChild(b);
      }
      const title = SECTIONS.find((x) => x[0] === current)[2];
      let html = `<h2 style="margin:0 0 18px;font-size:22px;font-weight:650">${title}</h2>`;

      if (current === 'apariencia') {
        html += row('Tema', segmented('theme', [['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Automático']], s.theme), 'Automático sigue la hora del sistema');
        html += row('Color de acento', `<div style="display:flex;gap:8px">${ACCENTS.map((c) => `<button data-accent="${c}" title="${c}" style="width:26px;height:26px;border-radius:50%;border:${c === s.accent ? '3px solid var(--text)' : '0'};background:${c}"></button>`).join('')}</div>`);
      }
      if (current === 'fondo') {
        html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px">${Object.entries(WALLPAPERS).map(([id, w]) => {
          const bg = settings.isDark(s) ? w.dark : w.light;
          return `<button data-wallpaper="${id}" style="border:0;padding:0;background:none;text-align:left">
            <div style="height:100px;border-radius:14px;background:${bg};outline:${id === s.wallpaper ? '3px solid var(--accent)' : '0'};outline-offset:2px"></div>
            <div style="margin-top:6px;font-size:13px">${w.name}</div></button>`;
        }).join('')}</div>`;
      }
      if (current === 'dock') {
        html += row('Tamaño de los iconos', `<input type="range" min="40" max="80" value="${s.dockSize}" data-range="dockSize" style="width:180px;accent-color:var(--accent)">`);
        html += row('Efecto lupa', `<input type="checkbox" ${s.magnify ? 'checked' : ''} data-check="magnify" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Los iconos crecen al pasar el ratón');
      }
      if (current === 'pantalla') {
        html += row('Brillo', `<input type="range" min="0" max="60" value="${Math.round((0.6 - s.dim) * 100)}" data-range="brightness" style="width:180px;accent-color:var(--accent)">`);
        html += row('Luz nocturna', `<input type="checkbox" ${s.night ? 'checked' : ''} data-check="night" style="width:20px;height:20px;accent-color:var(--accent)">`, 'Colores más cálidos para descansar la vista');
      }
      if (current === 'usuario') {
        html += row('Nombre', `<input data-text="userName" value="${s.userName.replace(/"/g, '&quot;')}" style="border:0;border-radius:9px;padding:7px 10px;background:color-mix(in srgb, var(--text) 7%, transparent);outline:none">`, 'Aparece en la pantalla de bloqueo');
      }
      if (current === 'acerca') {
        html += `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px;text-align:center">
          <div style="width:96px;height:96px;border-radius:28px;display:grid;place-items:center;color:#fff;background:linear-gradient(160deg,#7c8cff,#ec4899);box-shadow:0 14px 30px rgba(91,108,255,.35)"><span style="transform:scale(3)">${GLYPHS.logo}</span></div><div style="font-size:26px;font-weight:650">WonderfulOS</div>
          <div style="color:var(--muted)">Versión 0.1 · prototipo del escritorio</div>
          <p style="max-width:420px;color:var(--muted)">Un sistema operativo basado en Linux (Debian + KDE Plasma), diseñado para ser bonito, claro y fácil de usar.</p></div>`;
      }
      content.innerHTML = html;

      content.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { settings.set({ theme: b.dataset.theme }); render(); }; });
      content.querySelectorAll('[data-accent]').forEach((b) => { b.onclick = () => { settings.set({ accent: b.dataset.accent }); render(); }; });
      content.querySelectorAll('[data-wallpaper]').forEach((b) => { b.onclick = () => { settings.set({ wallpaper: b.dataset.wallpaper }); render(); }; });
      content.querySelectorAll('[data-range]').forEach((r) => {
        r.oninput = () => settings.set(r.dataset.range === 'brightness' ? { dim: +(0.6 - r.value / 100).toFixed(2) } : { [r.dataset.range]: +r.value });
      });
      content.querySelectorAll('[data-check]').forEach((c) => { c.onchange = () => settings.set({ [c.dataset.check]: c.checked }); });
      content.querySelectorAll('[data-text]').forEach((i) => { i.onchange = () => settings.set({ [i.dataset.text]: i.value.trim() || 'Usuario' }); });
    }
    render();
  },
};
