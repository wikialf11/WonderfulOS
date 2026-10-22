// Descargas del Navegador: el archivo lo baja el servicio local directamente a
// Archivos › Descargas; el escritorio solo guarda la referencia y muestra el progreso.
import { fs, basename, isCloud } from './fs.js';
import { api } from './api.js';

export const humanSize = (n) => !n ? '' : n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

export async function startDownload(ctx, { url, path, size = 0, mime = '' }) {
  if (!isCloud()) throw new Error('Para descargar necesitas el servicio local de WonderfulOS');
  const { id } = await api('downloads', { method: 'POST', body: { url } });
  fs.setBlob(path, { blob: id, size, mime, progress: 0, source: url });
  ctx.notify(`Guardando ${basename(path)} en Descargas…`, 3000, { title: 'Descarga', icon: 'navegador' });
  watch(ctx, path, id);
}

function watch(ctx, path, id) {
  const tick = async () => {
    const node = fs.stat(path);
    if (!node || node.blob !== id) return; // borrado o reemplazado
    let st;
    try { st = await api(`downloads/${id}`); } catch {
      fs.setBlob(path, { blob: id, error: 'La descarga se interrumpió' });
      return ctx.notify(`No se pudo terminar la descarga de ${basename(path)}`, 6000, { title: 'Descarga', icon: 'navegador' });
    }
    if (st.error) {
      fs.setBlob(path, { blob: id, error: st.error });
      return ctx.notify(`${basename(path)}: ${st.error}`, 7000, { title: 'No se pudo descargar', icon: 'navegador' });
    }
    if (st.done) {
      fs.setBlob(path, { blob: id, size: st.received, received: st.received, progress: 1 });
      ctx.refreshAccount?.();
      return ctx.notify(basename(path), 6000, { title: 'Descarga terminada', icon: 'navegador', action: { label: 'Abrir', run: () => ctx.openFile(path) } });
    }
    fs.setBlob(path, { blob: id, size: st.total || node.size, progress: st.total ? st.received / st.total : 0, received: st.received });
    setTimeout(tick, 700);
  };
  tick();
}

// Al recargar el escritorio, seguimos las descargas que estaban en curso.
export function resumeDownloads(ctx) {
  for (const p of fs.find((n) => n.blob && n.progress < 1 && !n.error)) watch(ctx, p, fs.stat(p).blob);
}
