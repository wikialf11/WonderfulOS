// Preferencias del escritorio (tema, acento, fondo, dock, pantalla).
const KEY = 'nubeos.shell.v1';

export const ACCENTS = ['#5b6cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

export const WALLPAPERS = {
  aurora: { name: 'Aurora',
    light: 'radial-gradient(60vw 60vw at 12% 18%, #7dd3fc 0%, transparent 60%), radial-gradient(55vw 55vw at 88% 22%, #c4b5fd 0%, transparent 60%), radial-gradient(70vw 70vw at 70% 95%, #f9a8d4 0%, transparent 55%), radial-gradient(60vw 60vw at 15% 90%, #a5b4fc 0%, transparent 60%), linear-gradient(160deg, #eef2ff, #fdf2f8)',
    dark: 'radial-gradient(60vw 60vw at 15% 15%, #1e3a8a 0%, transparent 60%), radial-gradient(55vw 55vw at 85% 20%, #5b21b6 0%, transparent 60%), radial-gradient(70vw 70vw at 70% 100%, #9d174d 0%, transparent 55%), linear-gradient(160deg, #0b1020, #140c1f)' },
  atardecer: { name: 'Atardecer',
    light: 'radial-gradient(70vw 70vw at 20% 10%, #fde68a 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 30%, #fb7185 0%, transparent 55%), radial-gradient(80vw 80vw at 50% 110%, #a78bfa 0%, transparent 60%), linear-gradient(160deg, #fff7ed, #fdf2f8)',
    dark: 'radial-gradient(70vw 70vw at 20% 10%, #9a3412 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 30%, #9f1239 0%, transparent 55%), radial-gradient(80vw 80vw at 50% 110%, #4c1d95 0%, transparent 60%), linear-gradient(160deg, #1c0f0a, #1a0b16)' },
  oceano: { name: 'Océano',
    light: 'radial-gradient(70vw 70vw at 10% 20%, #67e8f9 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 80%, #3b82f6 0%, transparent 55%), linear-gradient(160deg, #ecfeff, #dbeafe)',
    dark: 'radial-gradient(70vw 70vw at 10% 20%, #155e75 0%, transparent 55%), radial-gradient(70vw 70vw at 90% 80%, #1e3a8a 0%, transparent 55%), linear-gradient(160deg, #04131a, #0a1230)' },
  bosque: { name: 'Bosque',
    light: 'radial-gradient(70vw 70vw at 15% 15%, #bbf7d0 0%, transparent 55%), radial-gradient(70vw 70vw at 85% 85%, #34d399 0%, transparent 55%), linear-gradient(160deg, #f0fdf4, #ecfccb)',
    dark: 'radial-gradient(70vw 70vw at 15% 15%, #14532d 0%, transparent 55%), radial-gradient(70vw 70vw at 85% 85%, #065f46 0%, transparent 55%), linear-gradient(160deg, #04140b, #0a1a10)' },
  grafito: { name: 'Grafito',
    light: 'radial-gradient(80vw 80vw at 30% 20%, #e5e7eb 0%, transparent 60%), linear-gradient(160deg, #f9fafb, #d1d5db)',
    dark: 'radial-gradient(80vw 80vw at 30% 20%, #374151 0%, transparent 60%), linear-gradient(160deg, #0b0c0f, #1f2937)' },
};

const DEFAULTS = { theme: 'auto', accent: ACCENTS[0], wallpaper: 'aurora', dockSize: 58, magnify: true, dim: 0, night: false, focus: false, userName: 'Usuario', textScale: 1, contrast: false, reduceMotion: false };
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
    const wp = WALLPAPERS[s.wallpaper]?.[dark ? 'dark' : 'light'];
    if (wp) root.style.setProperty('--wallpaper', wp); else root.style.removeProperty('--wallpaper');
    // Accesibilidad: alto contraste, menos movimiento y tamaño del texto (zoom de todo el sistema).
    root.toggleAttribute('data-contrast', !!s.contrast);
    root.toggleAttribute('data-reduce-motion', !!s.reduceMotion);
    const z = Number(s.textScale) || 1;
    if (window.nubeosDesktop?.setZoom) window.nubeosDesktop.setZoom(z);
    else root.style.zoom = z === 1 ? '' : String(z);
  },
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.apply());
