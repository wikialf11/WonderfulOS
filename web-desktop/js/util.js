// Utilidades compartidas por el escritorio y las apps.
export function humanSize(n) {
  if (!n) return '0 KB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('es-ES', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${u[i]}`;
}
export const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
