// Preferencias del escritorio (tema, acento, fondo, dock, pantalla).
const KEY = 'nubeos.shell.v1';

export const ACCENTS = ['#5b6cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

// Fondos de un solo color: el índigo es el de por defecto.
export const WALLPAPERS = {
  azul: { name: 'Azul', kind: 'solid', light: '#2563eb', dark: '#2563eb' },
  indigo: { name: 'Índigo', kind: 'solid', light: '#4f46e5', dark: '#4f46e5' },
  cian: { name: 'Cian', kind: 'solid', light: '#0891b2', dark: '#0891b2' },
  turquesa: { name: 'Turquesa', kind: 'solid', light: '#0d9488', dark: '#0d9488' },
  verde: { name: 'Verde', kind: 'solid', light: '#16a34a', dark: '#16a34a' },
  lima: { name: 'Lima', kind: 'solid', light: '#65a30d', dark: '#65a30d' },
  amarillo: { name: 'Amarillo', kind: 'solid', light: '#ca8a04', dark: '#ca8a04' },
  naranja: { name: 'Naranja', kind: 'solid', light: '#ea580c', dark: '#ea580c' },
  rojo: { name: 'Rojo', kind: 'solid', light: '#dc2626', dark: '#dc2626' },
  rosa: { name: 'Rosa', kind: 'solid', light: '#db2777', dark: '#db2777' },
  morado: { name: 'Morado', kind: 'solid', light: '#7c3aed', dark: '#7c3aed' },
  pizarra: { name: 'Pizarra', kind: 'solid', light: '#475569', dark: '#475569' },
  carbon: { name: 'Carbón', kind: 'solid', light: '#1f2937', dark: '#1f2937' },
};

const DEFAULTS = { theme: 'auto', accent: '#8b5cf6', wallpaper: 'indigo', wallpaperColor: '#4f46e5', dockSize: 58, magnify: true, dim: 0, night: false, focus: false, textScale: 1, contrast: false, reduceMotion: false };
const listeners = new Set();

export const settings = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin persistencia */ }
    this.apply(next);
    listeners.forEach((fn) => fn(next));
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  isDark(s = this.get()) { return s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); },
  apply(s = this.get()) {
    const root = document.documentElement;
    const dark = this.isDark(s);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--dock-size', `${s.dockSize}px`);
    root.style.setProperty('--dim', String(s.dim));
    root.style.setProperty('--night', s.night ? '0.22' : '0');
    root.toggleAttribute('data-night', !!s.night);
    root.toggleAttribute('data-dim', s.dim > 0);
    const custom = /^#[0-9a-f]{6}$/i.test(s.wallpaperColor || '') ? s.wallpaperColor : DEFAULTS.wallpaperColor;
    const id = s.wallpaper === 'custom' ? 'custom' : (WALLPAPERS[s.wallpaper] ? s.wallpaper : DEFAULTS.wallpaper);
    const wp = id === 'custom' ? custom : WALLPAPERS[id][dark ? 'dark' : 'light'];
    root.style.setProperty('--wallpaper', wp || WALLPAPERS[DEFAULTS.wallpaper].light);
    // Accesibilidad: alto contraste, menos movimiento y tamaño del texto (zoom de todo el sistema).
    root.toggleAttribute('data-contrast', !!s.contrast);
    root.toggleAttribute('data-reduce-motion', !!s.reduceMotion);
    const z = Number(s.textScale) || 1;
    if (window.nubeosDesktop?.setZoom) window.nubeosDesktop.setZoom(z);
    else root.style.zoom = z === 1 ? '' : String(z);
  },
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.apply());
