// Diálogos modales dentro de una ventana: abrir/guardar archivo, pedir texto, confirmar.
import { fs, normalize, dirname, basename, extname } from './fs.js';
import { fileIcon } from './shell/icons.js';

function modal(win, html) {
  const back = document.createElement('div');
  back.className = 'dialog-backdrop';
  back.innerHTML = `<div class="dialog">${html}</div>`;
  win.body.appendChild(back);
  return back;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Elige un archivo. mode: 'open' | 'save'. Devuelve la ruta o null.
 * extensions: lista de extensiones permitidas (sin punto) para filtrar.
 */
export function pickFile(win, { mode = 'open', extensions = [], defaultName = '', startDir = '/Documentos' } = {}) {
  return new Promise((resolve) => {
    let dir = fs.isDir(startDir) ? startDir : '/';
    const back = modal(win, `
      <h3>${mode === 'open' ? 'Abrir archivo' : 'Guardar como'}</h3>
      <small class="dir"></small>
      <div class="file-list"></div>
      ${mode === 'save' ? `<input class="name" value="${esc(defaultName)}" placeholder="Nombre del archivo">` : ''}
      <div class="actions">
        <button class="btn cancel">Cancelar</button>
        <button class="btn primary ok">${mode === 'open' ? 'Abrir' : 'Guardar'}</button>
      </div>`);
    const list = back.querySelector('.file-list');
    const nameInput = back.querySelector('.name');
    let selected = null;

    const done = (val) => { back.remove(); resolve(val); };
    const render = () => {
      back.querySelector('.dir').textContent = dir;
      list.innerHTML = '';
      const entries = fs.list(dir).filter((e) => e.type === 'dir' || !extensions.length || extensions.includes(extname(e.name)));
      if (dir !== '/') entries.unshift({ path: dirname(dir), name: '..', type: 'dir' });
      for (const e of entries) {
        const row = document.createElement('div');
        row.innerHTML = fileIcon(e.name, e.type === 'dir');
        row.append(e.name);
        row.onclick = () => {
          if (e.type === 'dir') { dir = e.path; selected = null; render(); return; }
          selected = e.path;
          list.querySelectorAll('.sel').forEach((r) => r.classList.remove('sel'));
          row.classList.add('sel');
          if (nameInput) nameInput.value = e.name;
        };
        row.ondblclick = () => { if (e.type === 'file') ok(); };
        list.appendChild(row);
      }
    };
    const ok = () => {
      if (mode === 'open') return selected && done(selected);
      let name = nameInput.value.trim();
      if (!name) return;
      if (extensions.length && !extensions.includes(extname(name))) name += '.' + extensions[0];
      done(normalize(dir + '/' + name));
    };
    back.querySelector('.cancel').onclick = () => done(null);
    back.querySelector('.ok').onclick = ok;
    nameInput?.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
    render();
    (nameInput || list).focus?.();
  });
}

export function prompt(win, title, value = '') {
  return new Promise((resolve) => {
    const back = modal(win, `
      <h3>${esc(title)}</h3>
      <input class="val" value="${esc(value)}">
      <div class="actions"><button class="btn cancel">Cancelar</button><button class="btn primary ok">Aceptar</button></div>`);
    const input = back.querySelector('.val');
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector('.cancel').onclick = () => done(null);
    back.querySelector('.ok').onclick = () => done(input.value.trim() || null);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && done(input.value.trim() || null));
    input.focus(); input.select();
  });
}

export function confirm(win, message) {
  return new Promise((resolve) => {
    const back = modal(win, `
      <p>${esc(message)}</p>
      <div class="actions"><button class="btn cancel">Cancelar</button><button class="btn primary ok">Aceptar</button></div>`);
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector('.cancel').onclick = () => done(false);
    back.querySelector('.ok').onclick = () => done(true);
  });
}

export { basename };
