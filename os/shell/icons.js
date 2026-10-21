// Iconos de WonderfulOS. Estilo plano y minimalista: fondo de un único color sólido
// muy saturado, formas blancas y sombra propia.

const SQ = 'M50 3C86 3 97 14 97 50S86 97 50 97 3 86 3 50 14 3 50 3Z'; // "squircle"

let uid = 0;
function base(bg, body) {
  const id = `i${++uid}`;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".82"/></linearGradient>
    <filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#0b1020" flood-opacity=".22"/></filter>
  </defs>
  <path d="${SQ}" fill="${bg}"/>
  <g filter="url(#${id}s)">${body.replaceAll('W', `url(#${id}w)`)}</g>
</svg>`;
}

// Engranaje: polígono con dientes redondeados calculado.
function gear(cx, cy, r1, r2, teeth) {
  const pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 < 2 ? r2 : r1;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export const ICONS = {
  archivos: base('#1D6BFF', `
    <path d="M22 32a6 6 0 0 1 6-6h14l7 7h23a6 6 0 0 1 6 6v6H22Z" fill="#fff" fill-opacity=".55"/>
    <rect x="22" y="38" width="56" height="38" rx="7" fill="W"/>
    <rect x="22" y="38" width="56" height="9" rx="4" fill="#2f6bff" fill-opacity=".12"/>`),

  navegador: base('#06B6D4', `
    <circle cx="50" cy="50" r="28" fill="#fff" fill-opacity=".22"/>
    <circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3"/>
    <ellipse cx="50" cy="50" rx="12" ry="28" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5"/>
    <path d="M23 50h54M27 37h46M27 63h46" stroke="#fff" stroke-opacity=".45" stroke-width="2.5"/>
    <path d="M62 36 54 54 38 64 46 46Z" fill="W"/>
    <path d="M62 36 46 46 54 54Z" fill="#ff5a7a"/>`),

  ajustes: base('#6366F1', `
    <polygon points="${gear(50, 50, 22, 29, 10)}" fill="W" stroke="#fff" stroke-linejoin="round" stroke-width="3"/>
    <circle cx="50" cy="50" r="13" fill="#4a5164"/>
    <circle cx="50" cy="50" r="7" fill="#fff" fill-opacity=".9"/>`),

  launchpad: base('#C026D3', `
    <rect x="25" y="25" width="22" height="22" rx="7" fill="W"/>
    <rect x="53" y="25" width="22" height="22" rx="7" fill="#fff" fill-opacity=".7"/>
    <rect x="25" y="53" width="22" height="22" rx="7" fill="#fff" fill-opacity=".7"/>
    <rect x="53" y="53" width="22" height="22" rx="7" fill="#fff" fill-opacity=".45"/>`),

  buscar: base('#7C3AED', `
    <circle cx="45" cy="45" r="17" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="6"/>
    <path d="M58 58l14 14" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`),

  papelera: base('#EF4444', `
    <path d="M31 38h38l-3.5 35a6 6 0 0 1-6 5.5h-19a6 6 0 0 1-6-5.5Z" fill="#fff" stroke="#8a94a8" stroke-width="2.5"/>
    <rect x="27" y="30" width="46" height="8" rx="4" fill="#8a94a8"/>
    <rect x="42" y="24" width="16" height="7" rx="3.5" fill="#8a94a8"/>
    <path d="M44 46v24M56 46v24" stroke="#c9d0dd" stroke-width="3" stroke-linecap="round"/>`),

  tienda: base('#FF7A00', `
    <path d="M28 40h44l-4 34a6 6 0 0 1-6 5H38a6 6 0 0 1-6-5Z" fill="W"/>
    <path d="M40 40v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <circle cx="42" cy="52" r="3" fill="#ff5f6d"/><circle cx="58" cy="52" r="3" fill="#ff5f6d"/>`),

  logo: base('#5B21B6', `
    <path d="M33 66a12 12 0 0 1-1.4-23.9A15.5 15.5 0 0 1 61.5 37 11 11 0 0 1 68 66Z" fill="W"/>`),

  app: base('#0EA5E9', '<rect x="30" y="30" width="40" height="40" rx="12" fill="W"/>'),
};

// ---------- Iconos de archivos (planos, sin fondo) ----------
function page(color, mark) {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M16 6h22l14 14v34a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5Z" fill="#fff" stroke="rgba(15,23,42,.12)"/>
    <path d="M38 6v10a4 4 0 0 0 4 4h10Z" fill="${color}" fill-opacity=".35"/>
    ${mark}
  </svg>`;
}
const folderSvg = (c1, c2) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><linearGradient id="f${++uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <path d="M6 16a5 5 0 0 1 5-5h14l6 6h22a5 5 0 0 1 5 5v4H6Z" fill="${c2}" fill-opacity=".75"/>
  <rect x="6" y="22" width="52" height="33" rx="6" fill="url(#f${uid})"/>
  <rect x="6" y="22" width="52" height="6" rx="3" fill="#fff" fill-opacity=".35"/>
</svg>`;

export const FILE_ICONS = {
  folder: folderSvg('#7cc0ff', '#3b82f6'),
  text: page('#f59e0b', '<path d="M20 30h24M20 37h24M20 44h16" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>'),
  sheet: page('#16a34a', '<rect x="19" y="28" width="26" height="20" rx="3" fill="none" stroke="#16a34a" stroke-width="2.5"/><path d="M19 35h26M19 41h26M28 28v20" stroke="#16a34a" stroke-width="2"/>'),
  slides: page('#e11d48', '<rect x="18" y="29" width="28" height="18" rx="3" fill="#e11d48" fill-opacity=".85"/>'),
  image: page('#0ea5e9', '<path d="M18 46l9-10 7 7 5-5 7 8Z" fill="#0ea5e9"/><circle cx="40" cy="31" r="3.5" fill="#f59e0b"/>'),
  archive: page('#8b5cf6', '<path d="M30 24h4v4h-4zM30 30h4v4h-4zM30 36h4v4h-4z" fill="#8b5cf6"/><rect x="28" y="42" width="8" height="8" rx="2" fill="#8b5cf6"/>'),
  app: page('#64748b', '<rect x="22" y="30" width="20" height="16" rx="4" fill="#64748b"/>'),
  file: page('#94a3b8', ''),
};
export function fileIcon(name, isDir) {
  if (isDir) return FILE_ICONS.folder;
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'odt'].includes(ext)) return FILE_ICONS.text;
  if (['csv', 'xlsx', 'ods', 'nsheet'].includes(ext)) return FILE_ICONS.sheet;
  if (['pptx', 'odp', 'nslides'].includes(ext)) return FILE_ICONS.slides;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return FILE_ICONS.image;
  if (['zip', 'tar', 'gz', 'xz', '7z', 'rar'].includes(ext)) return FILE_ICONS.archive;
  if (['appimage', 'deb', 'flatpakref', 'sh'].includes(ext)) return FILE_ICONS.app;
  return FILE_ICONS.file;
}

// ---------- Pictogramas de línea (barra superior, Centro de control, apps) ----------
const line = (d, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const GLYPHS = {
  logo: `<svg viewBox="0 0 24 24" width="17" height="17"><path d="M7 18a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 19 9.5a4.25 4.25 0 0 1-.5 8.5Z" fill="currentColor"/></svg>`,
  search: line('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  sliders: line('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  moon: line('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  sun: line('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  bell: line('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  flame: line('<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 4-3 8a6 6 0 0 0 6 6Z"/>'),
  grid: line('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  min: line('<path d="M6 12h12"/>', 12),
  max: line('<rect x="6" y="6" width="12" height="12" rx="2"/>', 12),
  close: line('<path d="M7 7l10 10M17 7 7 17"/>', 12),
  back: line('<path d="M15 6l-6 6 6 6"/>'),
  fwd: line('<path d="M9 6l6 6-6 6"/>'),
  home: line('<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z"/>'),
  doc: line('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/>'),
  download: line('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  image: line('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>'),
  plusFolder: line('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  trash: line('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  rename: line('<path d="M4 20h4L19 9l-4-4L4 16Z"/>'),
  gridView: line('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  palette: line('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-1 .3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  dock: line('<rect x="3" y="14" width="18" height="6" rx="2.5"/><path d="M7 17h.01M12 17h.01M17 17h.01"/>'),
  user: line('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  info: line('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  listView: line('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
};
