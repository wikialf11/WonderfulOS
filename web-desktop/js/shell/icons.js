// Iconos de WonderfulOS. Estilo plano en capas: fondo con degradado suave, formas
// blancas semitransparentes superpuestas, un brillo superior y sombra propia.

const SQ = 'M3 3H97V97H3Z'; // cuadrado con esquinas en pico

let uid = 0;
function base(bg, body, { glass = false } = {}) {
  const id = `i${++uid}`;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${glass ? 0.7 : 0.32}"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".82"/></linearGradient>
    <filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#0b1020" flood-opacity=".22"/></filter>
  </defs>
  <path d="${SQ}" fill="url(#${id}b)"/>
  <path d="${SQ}" fill="url(#${id}h)"/>
  <path d="${SQ}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
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
  archivos: base(['#5ab2ff', '#2f6bff'], `
    <path d="M22 32a6 6 0 0 1 6-6h14l7 7h23a6 6 0 0 1 6 6v6H22Z" fill="#fff" fill-opacity=".55"/>
    <rect x="22" y="38" width="56" height="38" rx="7" fill="W"/>
    <rect x="22" y="38" width="56" height="9" rx="4" fill="#2f6bff" fill-opacity=".12"/>`),

  // Navegador: planeta con anillo, sobre degradado cian–índigo.
  navegador: base(['#22d3ee', '#4f46e5'], `
    <circle cx="50" cy="50" r="22" fill="W"/>
    <path d="M28 50h44M50 28c-7 7-7 37 0 44M50 28c7 7 7 37 0 44" stroke="#4f46e5" stroke-opacity=".35" stroke-width="2.5" fill="none"/>
    <ellipse cx="50" cy="50" rx="36" ry="11" transform="rotate(-24 50 50)" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="3.5"/>
    <circle cx="80" cy="37" r="4.5" fill="#fde047"/>`),

  ajustes: base(['#8b93a7', '#3d4456'], `
    <polygon points="${gear(50, 50, 22, 29, 10)}" fill="W" stroke="#fff" stroke-linejoin="round" stroke-width="3"/>
    <circle cx="50" cy="50" r="13" fill="#4a5164"/>
    <circle cx="50" cy="50" r="7" fill="#fff" fill-opacity=".9"/>`),

  launchpad: base(['#a78bfa', '#f472b6'], `
    <rect x="25" y="25" width="22" height="22" rx="7" fill="W"/>
    <rect x="53" y="25" width="22" height="22" rx="7" fill="#fff" fill-opacity=".7"/>
    <rect x="25" y="53" width="22" height="22" rx="7" fill="#fff" fill-opacity=".7"/>
    <rect x="53" y="53" width="22" height="22" rx="7" fill="#fff" fill-opacity=".45"/>`),

  buscar: base(['#7c8cff', '#5246e5'], `
    <circle cx="45" cy="45" r="17" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="6"/>
    <path d="M58 58l14 14" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`),

  papelera: base(['#f3f5fa', '#c9d0dd'], `
    <path d="M31 38h38l-3.5 35a6 6 0 0 1-6 5.5h-19a6 6 0 0 1-6-5.5Z" fill="#fff" stroke="#8a94a8" stroke-width="2.5"/>
    <rect x="27" y="30" width="46" height="8" rx="4" fill="#8a94a8"/>
    <rect x="42" y="24" width="16" height="7" rx="3.5" fill="#8a94a8"/>
    <path d="M44 46v24M56 46v24" stroke="#c9d0dd" stroke-width="3" stroke-linecap="round"/>`, { glass: true }),

  tienda: base(['#ffb347', '#ff5f6d'], `
    <path d="M28 40h44l-4 34a6 6 0 0 1-6 5H38a6 6 0 0 1-6-5Z" fill="W"/>
    <path d="M40 40v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <circle cx="42" cy="52" r="3" fill="#ff5f6d"/><circle cx="58" cy="52" r="3" fill="#ff5f6d"/>`),

  // WonderfulOS: tres círculos de color que se mezclan.
  logo: base(['#2b2f45', '#14161f'], `
    <circle cx="50" cy="39" r="17" fill="#ff5f6d" fill-opacity=".9"/>
    <circle cx="39" cy="58" r="17" fill="#3ec7ff" fill-opacity=".85" style="mix-blend-mode:screen"/>
    <circle cx="61" cy="58" r="17" fill="#ffc94d" fill-opacity=".85" style="mix-blend-mode:screen"/>`),

  app: base(['#60a5fa', '#7c3aed'], '<rect x="30" y="30" width="40" height="40" rx="12" fill="W"/>'),

  texto: base(['#ffc04d', '#ff8a1f'], `
    <rect x="27" y="20" width="46" height="60" rx="8" fill="W"/>
    <path d="M36 36h28M36 46h28M36 56h18" stroke="#ff8a1f" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>
    <path d="M58 70 74 54l6 6-16 16h-6Z" fill="#fff" fill-opacity=".6"/>`),

  calculo: base(['#3ee08f', '#0f9d58'], `
    <rect x="22" y="24" width="56" height="52" rx="9" fill="W"/>
    <rect x="22" y="24" width="56" height="13" rx="6" fill="#0f9d58" fill-opacity=".25"/>
    <path d="M22 50h56M22 63h56M41 24v52M60 24v52" stroke="#0f9d58" stroke-opacity=".4" stroke-width="2.5"/>
    <rect x="62" y="52" width="14" height="9" rx="2" fill="#0f9d58" fill-opacity=".7"/>`),

  diapositivas: base(['#ff7a9a', '#e11d48'], `
    <rect x="20" y="26" width="60" height="40" rx="8" fill="W"/>
    <rect x="30" y="36" width="26" height="6" rx="3" fill="#e11d48" fill-opacity=".7"/>
    <rect x="30" y="47" width="40" height="4" rx="2" fill="#e11d48" fill-opacity=".35"/>
    <path d="M50 66v10M40 80l10-6 10 6" stroke="#fff" stroke-opacity=".85" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`),
  listas: base(['#3a3f52', '#111318'], `
    <rect x="24" y="22" width="52" height="58" rx="9" fill="W"/>
    <rect x="31" y="32" width="9" height="9" rx="2.5" fill="#22c55e"/>
    <path d="M33 36.5l2 2 4-4.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="45" y="34" width="24" height="5" rx="2.5" fill="#111318" fill-opacity=".75"/>
    <rect x="31" y="48" width="9" height="9" rx="2.5" fill="none" stroke="#111318" stroke-opacity=".55" stroke-width="2"/>
    <rect x="45" y="50" width="20" height="5" rx="2.5" fill="#111318" fill-opacity=".45"/>
    <rect x="31" y="64" width="9" height="9" rx="2.5" fill="none" stroke="#111318" stroke-opacity=".55" stroke-width="2"/>
    <rect x="45" y="66" width="16" height="5" rx="2.5" fill="#111318" fill-opacity=".45"/>
    <circle cx="72" cy="72" r="9" fill="#f97316"/><circle cx="64" cy="76" r="6" fill="#3b82f6" stroke="#fff" stroke-width="1.5"/>`),

  // Notas: hoja doblada sobre degradado turquesa.
  notas: base(['#5eead4', '#0e7490'], `
    <path d="M28 22h34l12 12v38a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z" fill="W"/>
    <path d="M62 22v8a4 4 0 0 0 4 4h8Z" fill="#0e7490" fill-opacity=".35"/>
    <path d="M31 46h30M31 55h30M31 64h18" stroke="#0e7490" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>`),

  // Fotos: paisaje (sol y montañas) sobre un atardecer.
  fotos: base(['#fbbf24', '#e11d48'], `
    <rect x="20" y="24" width="60" height="52" rx="10" fill="#fff" fill-opacity=".28"/>
    <circle cx="62" cy="40" r="7" fill="W"/>
    <path d="M20 70l18-22 12 14 8-9 22 23v0a10 10 0 0 1-10 10H30a10 10 0 0 1-10-10Z" fill="W"/>`),

  // Calendario: tarjeta con una semana de puntos y el día marcado.
  calendario: base(['#f9a8d4', '#be185d'], `
    <rect x="20" y="24" width="60" height="54" rx="11" fill="W"/>
    <rect x="20" y="24" width="60" height="14" rx="7" fill="#be185d" fill-opacity=".22"/>
    <path d="M34 19v10M66 19v10" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    ${[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => `<circle cx="${33 + c * 11.3}" cy="${48 + r * 10}" r="3" fill="#be185d" fill-opacity=".3"/>`).join('')).join('')}
    <circle cx="55.6" cy="58" r="6" fill="#be185d"/>`),

  // Recordatorios: campana con un destello.
  recordatorios: base(['#7dd3fc', '#2563eb'], `
    <path d="M50 22a18 18 0 0 0-18 18v12l-7 10h50l-7-10V40a18 18 0 0 0-18-18Z" fill="W"/>
    <path d="M42 68a8 8 0 0 0 16 0Z" fill="W"/>
    <circle cx="68" cy="28" r="7" fill="#fde047"/>`),

  // Llavero: llave sobre degradado dorado–coral.
  llavero: base(['#fcd34d', '#ea580c'], `
    <circle cx="38" cy="44" r="15" fill="W"/>
    <circle cx="38" cy="44" r="6" fill="#ea580c" fill-opacity=".55"/>
    <path d="M50 52l22 22M62 64l6-6M68 70l5-5" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`),

  // Mensajes: dos burbujas superpuestas, violeta.
  mensajes: base(['#a78bfa', '#6d28d9'], `
    <rect x="18" y="24" width="44" height="32" rx="12" fill="#fff" fill-opacity=".45"/>
    <path d="M44 38h26a12 12 0 0 1 12 12v8a12 12 0 0 1-12 12h-4l2 9-11-9H44a12 12 0 0 1-12-12v-8a12 12 0 0 1 12-12Z" fill="W"/>
    <circle cx="48" cy="54" r="3" fill="#6d28d9"/><circle cx="57" cy="54" r="3" fill="#6d28d9"/><circle cx="66" cy="54" r="3" fill="#6d28d9"/>`),

  correo: base(['#3ec7ff', '#5b6cff'], `
    <rect x="18" y="28" width="64" height="46" rx="9" fill="W"/>
    <path d="M22 33l28 21 28-21" fill="none" stroke="#5b6cff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
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
  sharedFolder: folderSvg('#c4b5fd', '#8b5cf6'),
  text: page('#f59e0b', '<path d="M20 30h24M20 37h24M20 44h16" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>'),
  sheet: page('#16a34a', '<rect x="19" y="28" width="26" height="20" rx="3" fill="none" stroke="#16a34a" stroke-width="2.5"/><path d="M19 35h26M19 41h26M28 28v20" stroke="#16a34a" stroke-width="2"/>'),
  slides: page('#e11d48', '<rect x="18" y="29" width="28" height="18" rx="3" fill="#e11d48" fill-opacity=".85"/>'),
  image: page('#0ea5e9', '<path d="M18 46l9-10 7 7 5-5 7 8Z" fill="#0ea5e9"/><circle cx="40" cy="31" r="3.5" fill="#f59e0b"/>'),
  archive: page('#8b5cf6', '<path d="M30 24h4v4h-4zM30 30h4v4h-4zM30 36h4v4h-4z" fill="#8b5cf6"/><rect x="28" y="42" width="8" height="8" rx="2" fill="#8b5cf6"/>'),
  app: page('#64748b', '<rect x="22" y="30" width="20" height="16" rx="4" fill="#64748b"/>'),
  file: page('#94a3b8', ''),
  pdf: page('#dc2626', '<rect x="17" y="32" width="30" height="13" rx="3" fill="#dc2626"/><text x="32" y="42" font-size="9" font-weight="700" fill="#fff" text-anchor="middle" font-family="sans-serif">PDF</text>'),
  media: page('#7c3aed', '<path d="M27 30v16l13-8Z" fill="#7c3aed"/>'),
};
export function fileIcon(name, isDir) {
  if (isDir) return FILE_ICONS.folder;
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  if (['txt', 'md', 'doc', 'docx', 'odt'].includes(ext)) return FILE_ICONS.text;
  if (['csv', 'xlsx', 'ods', 'nsheet'].includes(ext)) return FILE_ICONS.sheet;
  if (['pptx', 'odp', 'nslides'].includes(ext)) return FILE_ICONS.slides;
  if (ext === 'pdf') return FILE_ICONS.pdf;
  if (['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return FILE_ICONS.media;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return FILE_ICONS.image;
  if (['zip', 'tar', 'gz', 'xz', '7z', 'rar'].includes(ext)) return FILE_ICONS.archive;
  if (['appimage', 'deb', 'flatpakref', 'sh'].includes(ext)) return FILE_ICONS.app;
  return FILE_ICONS.file;
}

// ---------- Pictogramas de línea (barra superior, Centro de control, apps) ----------
const line = (d, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const GLYPHS = {
  logo: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8.6" r="4.6"/><circle cx="8.6" cy="14.6" r="4.6"/><circle cx="15.4" cy="14.6" r="4.6"/></svg>`,
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
  share: line('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 6"/>'),
  upload: line('<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>'),
  cloud: line('<path d="M7 18a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 19 9.5a4.25 4.25 0 0 1-.5 8.5Z"/>'),
  plusDoc: line('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M12 11v6M9 14h6"/>'),
  logout: line('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>'),
  check: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  repeat: line('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>', 14),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 14),
  send: line('<path d="M4 12l16-8-6 16-2.5-6.5Z"/>'),
  pin: line('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3ZM12 14v6"/>', 14),
  calSmall: line('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>', 14),
  key: line('<circle cx="8" cy="14" r="4.5"/><path d="M11.5 11 20 2.5M16 7l3 3M14 9l2 2"/>'),
  more: line('<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>'),
  listView: line('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
};
