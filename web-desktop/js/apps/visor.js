// Visor: imágenes, PDF, audio y vídeo subidos a WonderfulOS, sin salir del escritorio.
import { basename, extname } from '../fs.js';

const KIND = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  pdf: ['pdf'],
  audio: ['mp3', 'wav', 'ogg', 'm4a'],
  video: ['mp4', 'webm', 'mov'],
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4' };
const kindOf = (p) => Object.keys(KIND).find((k) => KIND[k].includes(extname(p)));

export default {
  id: 'visor',
  name: 'Visor',
  description: 'Ver imágenes, PDF, audio y vídeo',
  hidden: true,
  canShow: (p, node) => !!node?.blob && !!kindOf(p),

  launch(ctx, path) {
    const kind = kindOf(path);
    const node = ctx.fs.stat(path);
    const win = ctx.createWindow({ title: basename(path), width: kind === 'audio' ? 460 : 860, height: kind === 'audio' ? 220 : 600 });
    // El tipo se decide por la extensión (el servicio local solo muestra tipos que no ejecutan código).
    const url = `api/blobs/${node.blob}?${new URLSearchParams({ name: basename(path), inline: '1', type: MIME[extname(path)] })}`;
    win.body.style.cssText += ';align-items:center;justify-content:center;background:color-mix(in srgb, var(--panel-solid) 40%, #000 10%)';
    const el = {
      image: () => Object.assign(document.createElement('img'), { src: url, alt: basename(path), style: 'max-width:100%;max-height:100%;object-fit:contain' }),
      pdf: () => Object.assign(document.createElement('iframe'), { src: url, style: 'width:100%;height:100%;border:0;background:#fff' }),
      audio: () => Object.assign(document.createElement('audio'), { src: url, controls: true, style: 'width:90%' }),
      video: () => Object.assign(document.createElement('video'), { src: url, controls: true, style: 'max-width:100%;max-height:100%' }),
    }[kind]();
    win.body.appendChild(el);
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    bar.style.cssText = 'position:absolute;bottom:14px;right:14px;border:0;padding:0';
    bar.innerHTML = '<button>Descargar</button>';
    bar.firstChild.onclick = () => ctx.fs.downloadToComputer(path);
    win.body.appendChild(bar);
  },
};
