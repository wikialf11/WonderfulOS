// Preferencias del escritorio (tema, acento, fondo, dock, pantalla).
const KEY = 'nubeos.shell.v1';

export const ACCENTS = ['#5b6cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

// Los fondos sólidos van primero: son los que vienen por defecto.
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
  aurora: { name: 'Aurora', kind: 'gradient',
    light: 'radial-gradient(60vw 60vw at 12% 18%, #7dd3fc 0%, transparent 60%), radial-gradient(55vw 55vw at 88% 22%, #c4b5fd 0%, transparent 60%), radial-gradient(70vw 70vw at 70% 95%, #f9a8d4 0%, transparent 55%), radial-gradient(60vw 60vw at 15% 90%, #a5b4fc 0%, transparent 60%), linear-gradient(160deg, #eef2ff, #fdf2f8)',
    dark: 'radial-gradient(60vw 60vw at 15% 15%, #1e3a8a 0%, transparent 60%), radial-gradient(55vw 55vw at 85% 20%, #5b21b6 0%, transparent 60%), radial-gradient(70vw 70vw at 70% 100%, #9d174d 0%, transparent 55%), linear-gradient(160deg, #0b1020, #140c1f)' },
  atardecer: { name: 'Atardecer', kind: 'gradient',
    light: 'radial-gradient(70vw 70vw at 20% 10%, #fde68a 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 30%, #fb7185 0%, transparent 55%), radial-gradient(80vw 80vw at 50% 110%, #a78bfa 0%, transparent 60%), linear-gradient(160deg, #fff7ed, #fdf2f8)',
    dark: 'radial-gradient(70vw 70vw at 20% 10%, #9a3412 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 30%, #9f1239 0%, transparent 55%), radial-gradient(80vw 80vw at 50% 110%, #4c1d95 0%, transparent 60%), linear-gradient(160deg, #1c0f0a, #1a0b16)' },
  oceano: { name: 'Océano', kind: 'gradient',
    light: 'radial-gradient(70vw 70vw at 10% 20%, #67e8f9 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 80%, #3b82f6 0%, transparent 55%), linear-gradient(160deg, #ecfeff, #dbeafe)',
    dark: 'radial-gradient(70vw 70vw at 10% 20%, #155e75 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 80%, #1e3a8a 0%, transparent 55%), linear-gradient(160deg, #04131a, #0a1230)' },
  bosque: { name: 'Bosque', kind: 'gradient',
    light: 'radial-gradient(70vw 70vw at 15% 15%, #bbf7d0 0%, transparent 55%), radial-gradient(70vw 70vw at 85% 85%, #34d399 0%, transparent 55%), linear-gradient(160deg, #f0fdf4, #ecfccb)',
    dark: 'radial-gradient(70vw 70vw at 15% 15%, #14532d 0%, transparent 55%), radial-gradient(70vw 70vw at 85% 85%, #065f46 0%, transparent 55%), linear-gradient(160deg, #04140b, #0a1a10)' },
  grafito: { name: 'Grafito', kind: 'gradient',
    light: 'radial-gradient(80vw 80vw at 30% 20%, #e5e7eb 0%, transparent 60%), linear-gradient(160deg, #f9fafb, #d1d5db)',
    dark: 'radial-gradient(80vw 80vw at 30% 20%, #374151 0%, transparent 60%), linear-gradient(160deg, #0b0c0f, #1f2937)' },
};

const DEFAULTS = { theme: 'auto', accent: '#8b5cf6', wallpaper: 'indigo', wallpaperColor: '#4f46e5', dockSize: 58, magnify: true, dim: 0, night: false, focus: false, userName: 'Usuario', textScale: 1, contrast: false, reduceMotion: false, light: true };
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
    const wp = s.wallpaper === 'custom' ? custom : WALLPAPERS[s.wallpaper]?.[dark ? 'dark' : 'light'];
    if (wp) root.style.setProperty('--wallpaper', wp); else root.style.removeProperty('--wallpaper');
    // Accesibilidad: alto contraste, menos movimiento y tamaño del texto (zoom de todo el sistema).
    root.toggleAttribute('data-contrast', !!s.contrast);
    root.toggleAttribute('data-reduce-motion', !!s.reduceMotion);
    // Modo ligero (activado por defecto): sin desenfoques ni sombras costosas. Se puede
    // desactivar en Ajustes para recuperar el efecto de vidrio.
    root.toggleAttribute('data-light', s.light !== false);
    const z = Number(s.textScale) || 1;
    if (window.nubeosDesktop?.setZoom) window.nubeosDesktop.setZoom(z);
    else root.style.zoom = z === 1 ? '' : String(z);
  },
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.apply());
