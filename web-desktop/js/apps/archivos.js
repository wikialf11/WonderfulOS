// Archivos: tu disco en la nube, como un Google Drive. Sube archivos del
// ordenador (botón o arrastrando), descárgalos, y comparte archivos y carpetas
// con otros usuarios de WonderfulOS («Solo ver» o «Puede editar»).
import { fileIcon, GLYPHS, FILE_ICONS } from '../shell/icons.js';
import { prompt, confirm } from '../dialogs.js';
import { normalize, dirname, basename, isCloud, SHARED_ROOT } from '../fs.js';
import { api } from '../api.js';
import { humanSize, esc } from '../util.js';
import { P2P_ROOT, renderP2P, shareDialog as shareP2P } from './p2p.js';

const PLACES = [
  ['/', 'home', 'Inicio'],
  ['/Documentos', 'doc', 'Documentos'],
  ['/Descargas', 'download', 'Descargas'],
  ['/Imágenes', 'image', 'Imágenes'],
];
const NEW_DOCS = [
  ['Documento', 'Documento', 'texto'],
  ['Hoja de cálculo', 'Hoja de cálculo', 'calculo'],
  ['Presentación', 'Presentación', 'diapositivas'],
];

export default {
  id: 'archivos',
  name: 'Archivos',
  description: 'Tus archivos, para guardar y compartir',

  launch(ctx, arg = '/Documentos') {
    const start = typeof arg === 'string' ? arg : arg.dir;
    const win = ctx.createWindow({ title: 'Archivos', width: 940, height: 580 });
    win.body.classList.add('app-files');
    win.body.innerHTML = `
      <aside class="files-side">
        <div class="files-side-title">Favoritos</div>
        <nav class="places"></nav>
        <div class="grow"></div>
        <div class="storage" hidden></div>
      </aside>
      <section class="files-main">
        <div class="files-bar">
          <button class="icon-btn back" title="Atrás">${GLYPHS.back}</button>
          <button class="icon-btn fwd" title="Adelante">${GLYPHS.fwd}</button>
          <div class="crumbs"></div>
          <button class="pill upload" title="Subir archivos de tu ordenador">${GLYPHS.upload}<span>Subir</span></button>
          <button class="pill soft new" title="Crear">${GLYPHS.plusDoc}<span>Nuevo</span></button>
          <button class="pill soft share" title="Compartir con otros usuarios">${GLYPHS.share}<span>Compartir</span></button>
          <div class="seg"><button class="icon-btn grid on" title="Iconos">${GLYPHS.gridView}</button><button class="icon-btn list" title="Lista">${GLYPHS.listView}</button></div>
          <label class="files-search">${GLYPHS.search}<input placeholder="Buscar"></label>
        </div>
        <div class="files-items"></div>
        <footer class="files-status"></footer>
      </section>
      <input type="file" multiple hidden>`;
    const $ = (s) => win.body.querySelector(s);
    const items = $('.files-items');
    const picker = $('input[type=file]');
    let dir = '/';
    let p2pView = null;
    let history = [], pos = -1, view = 'grid', query = '';
    let sel = new Set(); // rutas seleccionadas (clic, Cmd/Ctrl+clic o rectángulo)
    const single = () => (sel.size === 1 ? [...sel][0] : null);
    const uploads = new Map(); // nombre -> progreso (0..1)

    const tryDo = (fn) => { try { fn(); } catch (e) { ctx.notify(e.message, 5000, { title: 'Archivos', icon: 'archivos' }); } };
    const inShared = () => dir === SHARED_ROOT || dir.startsWith(SHARED_ROOT + '/');
    const editable = () => !inShared() || (dir !== SHARED_ROOT && ctx.fs.stat(dir)?.perm === 'edit');
    const isOwn = (p) => !p.startsWith(SHARED_ROOT);

    function go(p, push = true) {
      if (p !== P2P_ROOT) p = normalize(p);
      if (p !== SHARED_ROOT && p !== P2P_ROOT && !ctx.fs.isDir(p)) return;
      dir = p;
      p2pView = null; // al entrar en «Compartido P2P» se empieza por la lista
      if (push) { history = history.slice(0, pos + 1); history.push(dir); pos = history.length - 1; }
      sel = new Set(); query = ''; $('.files-search input').value = '';
      render();
    }
    const open = (e) => (e.type === 'dir' ? go(e.path) : ctx.openFile(e.path));

    function renderSide() {
      const places = $('.places');
      places.innerHTML = '';
      const list = [...PLACES, ...(isCloud() ? [[SHARED_ROOT, 'share', 'Compartido conmigo']] : []), ...(window.nubeosDesktop?.p2p ? [[P2P_ROOT, 'share', 'Compartido P2P']] : [])];
      for (const [p, g, label] of list) {
        const b = document.createElement('button');
        const on = p === SHARED_ROOT ? inShared() : dir === p;
        if (p === P2P_ROOT) b.title = 'Compartir directamente entre ordenadores';
        b.className = `place${on ? ' on' : ''}`;
        b.innerHTML = `${GLYPHS[g]}<span>${label}</span>`;
        b.onclick = () => go(p);
        places.appendChild(b);
      }
      const a = ctx.account?.info;
      const box = $('.storage');
      box.hidden = !a;
      if (a) {
        const pct = Math.min(100, (a.used / a.quota) * 100);
        box.innerHTML = `<div style="display:flex;align-items:center;gap:6px;color:var(--text);font-weight:600">${GLYPHS.cloud} Espacio</div>
          <div class="bar${pct > 90 ? ' full' : ''}"><span style="width:${Math.max(pct, 1)}%"></span></div>
          <div>${humanSize(a.used)} de ${humanSize(a.quota)}</div>
          ${a.local ? '' : '<button class="more" style="margin-top:6px">Conseguir más espacio</button>'}`;
        box.querySelector('.more')?.addEventListener('click', () => ctx.launch('ajustes', 'cuenta'));
      }
    }

    function render() {
      win.setTitle(dir === '/' ? 'Inicio' : dir === P2P_ROOT ? 'Compartido P2P' : basename(dir));
      renderSide();
      if (dir === P2P_ROOT) {
        // Panel P2P: tiene sus propias migas y elementos.
        for (const b of ['.upload', '.new', '.share']) $(b).hidden = true;
        $('.back').disabled = pos <= 0; $('.fwd').disabled = pos >= history.length - 1;
        $('.files-status').textContent = '';
        if (p2pView) return; // ya está en pantalla: no se rehace al refrescar la ventana
        p2pView = renderP2P(items, ctx, win, (crumbs) => {
          const c = $('.crumbs');
          c.innerHTML = '';
          crumbs.forEach(([label, fn], i) => {
            const b = document.createElement('button');
            b.textContent = label; b.className = i === crumbs.length - 1 ? 'here' : ''; b.onclick = fn;
            c.appendChild(b);
            if (i < crumbs.length - 1) c.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
          });
        });
        return;
      }
      // Migas de pan
      const crumbs = $('.crumbs');
      crumbs.innerHTML = '';
      const parts = dir.split('/').filter(Boolean);
      [['Inicio', '/'], ...parts.map((x, i) => [x, '/' + parts.slice(0, i + 1).join('/')])].forEach(([label, p], i, arr) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = i === arr.length - 1 ? 'here' : '';
        b.onclick = () => go(p);
        crumbs.appendChild(b);
        if (i < arr.length - 1) crumbs.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
      });
      $('.back').disabled = pos <= 0;
      $('.fwd').disabled = pos >= history.length - 1;
      $('.upload').hidden = !isCloud() || inShared();
      $('.new').hidden = !editable();
      $('.share').hidden = !isCloud();
      $('.share').disabled = !single() || !isOwn(single());
      $('.share').style.opacity = $('.share').disabled ? '.45' : '';

      // Elementos
      const all = ctx.fs.exists(dir) ? ctx.fs.list(dir) : [];
      const list = all.filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()));
      items.className = `files-items ${view}`;
      items.innerHTML = '';
      if (!list.length) {
        const msg = query ? 'Nada coincide con la búsqueda'
          : dir === SHARED_ROOT ? 'Nadie ha compartido nada contigo todavía. Cuando alguien lo haga, aparecerá aquí.'
          : editable() && isCloud() ? 'Esta carpeta está vacía. Arrastra archivos aquí o pulsa «Subir».' : 'Esta carpeta está vacía';
        items.innerHTML = `<div class="empty">${esc(msg)}</div>`;
      }
      for (const e of list) {
        const el = document.createElement('div');
        el.className = `file${sel.has(e.path) ? ' sel' : ''}`;
        el.dataset.path = e.path;
        el.tabIndex = 0;
        const out = isOwn(e.path) ? ctx.fs.sharesOf(e.path) : [];
        const isShareRoot = e.share && e.path === (e.shareBase || e.path);
        const icon = e.path === SHARED_ROOT || (isShareRoot && e.type === 'dir') ? FILE_ICONS.sharedFolder : fileIcon(e.name, e.type === 'dir');
        const meta = isShareRoot ? `de ${e.owner} · ${e.perm === 'edit' ? 'puede editar' : 'solo ver'}`
          : e.type === 'dir' ? 'Carpeta' : `${humanSize(ctx.fs.size(e.path))} · ${new Date(e.mtime).toLocaleDateString('es-ES')}`;
        el.innerHTML = `<div class="fi">${icon}</div><div class="fn">${esc(e.name)}</div>
          ${view === 'list' ? `<div class="fm">${esc(meta)}</div>` : isShareRoot ? `<div class="owner">de ${esc(e.owner)}</div>` : ''}
          ${out.length ? `<span class="badge" title="Compartido con ${esc(out.map((s) => s.to).join(', '))}">${GLYPHS.share.replace('width="16" height="16"', 'width="12" height="12"')}</span>` : ''}`;
        el.onclick = (ev) => {
          ev.stopPropagation();
          if (ev.metaKey || ev.ctrlKey) { sel.has(e.path) ? sel.delete(e.path) : sel.add(e.path); } else sel = new Set([e.path]);
          render();
        };
        el.ondblclick = () => open(e);
        el.onkeydown = (ev) => { if (ev.key === 'Enter') open(e); if (ev.key === 'Delete') removeMany(sel.size ? [...sel] : [e.path]); };
        el.oncontextmenu = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (!sel.has(e.path)) { sel = new Set([e.path]); render(); }
          if (sel.size > 1) {
            const paths = [...sel];
            const files = paths.filter((p) => !ctx.fs.isDir(p));
            return ctx.menu([
              ...(files.length ? [{ label: `Descargar ${files.length} archivo${files.length === 1 ? '' : 's'}`, run: () => files.forEach((p) => tryDo(() => ctx.fs.downloadToComputer(p))) }] : []),
              { label: `Eliminar ${paths.length} elementos`, disabled: !paths.every(isOwn), run: () => removeMany(paths) },
            ], ev.clientX, ev.clientY);
          }
          const own = isOwn(e.path);
          const canEdit = own || (e.perm === 'edit' && !isShareRoot);
          ctx.menu([
            { label: 'Abrir', run: () => open(e) },
            ...(e.type === 'file' && window.nubeosDesktop?.openWithSystem ? [
              { label: 'Abrir con el sistema', run: () => window.nubeosDesktop.openWithSystem(e.path).catch((er) => ctx.notify(er.message)) },
              { label: 'Mostrar en la carpeta', run: () => window.nubeosDesktop.showInSystem(e.path) },
            ] : e.type === 'file' ? [{ label: 'Descargar a mi ordenador', run: () => tryDo(() => ctx.fs.downloadToComputer(e.path)) }] : []),
            ...(isCloud() && own ? [{ label: 'Compartir…', run: () => shareDialog(e.path) }] : []),
            ...(window.nubeosDesktop?.p2p && own ? [{ label: 'Compartir por P2P…', run: () => shareP2P(win, ctx, e.path) }] : []),
            '-',
            { label: 'Cambiar nombre…', disabled: !canEdit, run: () => rename(e.path) },
            { label: isShareRoot ? 'Quitar de Compartido conmigo' : 'Eliminar', disabled: !canEdit && !isShareRoot, run: () => remove(e.path) },
          ], ev.clientX, ev.clientY);
        };
        items.appendChild(el);
      }
      // Subidas en curso
      for (const [name, p] of uploads) {
        const row = document.createElement('div');
        row.className = 'file';
        row.style.opacity = '.8';
        row.innerHTML = `<div class="fi">${fileIcon(name, false)}</div><div class="fn">${esc(name)}</div><div class="progress-row" style="width:100%"><div class="bar"><span style="width:${Math.round(p * 100)}%"></span></div></div>`;
        items.appendChild(row);
      }
      const owner = inShared() && dir !== SHARED_ROOT ? ctx.fs.stat(dir) : null;
      $('.files-status').textContent = `${list.length} elemento${list.length === 1 ? '' : 's'}${owner?.owner ? ` · carpeta de ${owner.owner} (${owner.perm === 'edit' ? 'puedes editar' : 'solo ver'})` : ''}${sel.size > 1 ? ` · ${sel.size} seleccionados` : ''}${uploads.size ? ` · subiendo ${uploads.size}…` : ''}`;
    }

    async function rename(p) {
      const name = await prompt(win, 'Nuevo nombre', basename(p));
      if (name) tryDo(() => ctx.fs.rename(p, normalize(dirname(p) + '/' + name)));
    }
    async function removeMany(paths) {
      if (paths.length === 1) return remove(paths[0]);
      if (!paths.every(isOwn)) return ctx.notify('Solo puedes eliminar a la vez elementos tuyos.');
      if (await confirm(win, `¿Eliminar ${paths.length} elementos? No se puede deshacer.`)) {
        tryDo(() => paths.forEach((p) => ctx.fs.exists(p) && ctx.fs.remove(p)));
        sel = new Set();
      }
    }
    async function remove(p) {
      const shareRoot = p.startsWith(SHARED_ROOT) && ctx.fs.stat(p)?.share && p === (ctx.fs.stat(p).shareBase || p);
      const msg = shareRoot ? `¿Quitar «${basename(p)}» de Compartido conmigo? El original no se borra.` : `¿Eliminar «${basename(p)}»? No se puede deshacer.`;
      if (await confirm(win, msg)) tryDo(() => ctx.fs.remove(p));
    }

    async function uploadFiles(files, target = dir) {
      if (!isCloud()) return ctx.notify('Para subir archivos necesitas iniciar sesión en WonderfulOS.');
      if (target.startsWith(SHARED_ROOT)) target = '/Documentos';
      for (const file of files) {
        uploads.set(file.name, 0);
        render();
        try {
          await ctx.fs.upload(target, file, (p) => { uploads.set(file.name, p); render(); });
        } catch (e) {
          ctx.notify(`${file.name}: ${e.message}`, 7000, { title: 'No se pudo subir', icon: 'archivos' });
        }
        uploads.delete(file.name);
        render();
      }
      ctx.refreshAccount?.();
    }

    // ---- Diálogo de compartir ----
    function shareDialog(target) {
      const kind = ctx.fs.isDir(target) ? 'carpeta' : 'archivo';
      const back = document.createElement('div');
      back.className = 'dialog-backdrop';
      back.innerHTML = `
        <div class="dialog share-dialog">
          <div class="head">${fileIcon(target, ctx.fs.isDir(target))}<h3>Compartir «${esc(basename(target))}»<small>Las personas que añadas lo verán en su «Compartido conmigo».</small></h3></div>
          <div class="row">
            <input class="to" placeholder="Nombre de usuario de WonderfulOS" autocomplete="off" autocapitalize="none" spellcheck="false">
            <select class="perm"><option value="edit">Puede editar</option><option value="read">Solo ver</option></select>
          </div>
          <div class="suggest"></div>
          <div class="people"></div>
          <div class="actions"><button class="btn cancel">Listo</button><button class="btn primary ok">Compartir</button></div>
        </div>`;
      win.body.appendChild(back);
      const to = back.querySelector('.to');
      const suggest = back.querySelector('.suggest');
      const people = back.querySelector('.people');

      const renderPeople = () => {
        const list = ctx.fs.sharesOf(target);
        people.innerHTML = list.length ? `<small style="color:var(--muted)">Con acceso a esta ${kind}:</small>` : '';
        for (const s of list) {
          const row = document.createElement('div');
          row.className = 'person';
          row.innerHTML = `<div class="avatar">${esc(s.to[0].toUpperCase())}</div><span>${esc(s.to)}</span><small>${s.perm === 'edit' ? 'Puede editar' : 'Solo ver'}</small><button class="btn">Quitar</button>`;
          row.querySelector('button').onclick = async () => {
            try { await ctx.fs.unshare(s.id); renderPeople(); render(); } catch (e) { ctx.notify(e.message); }
          };
          people.appendChild(row);
        }
      };
      renderPeople();

      let timer;
      to.oninput = () => {
        clearTimeout(timer);
        const q = to.value.trim().toLowerCase();
        if (!q) { suggest.innerHTML = ''; return; }
        timer = setTimeout(async () => {
          try {
            const { users } = await api(`users?q=${encodeURIComponent(q)}`);
            suggest.innerHTML = '';
            for (const u of users) {
              const b = document.createElement('button');
              b.textContent = u;
              b.onclick = () => { to.value = u; suggest.innerHTML = ''; to.focus(); };
              suggest.appendChild(b);
            }
          } catch { /* sin sugerencias */ }
        }, 200);
      };
      const submit = async () => {
        const user = to.value.trim().toLowerCase();
        if (!user) return to.focus();
        try {
          await ctx.fs.share({ path: target, to: user, perm: back.querySelector('.perm').value });
          ctx.notify(`«${basename(target)}» compartido con ${user}`, 4000, { title: 'Compartido', icon: 'archivos' });
          to.value = ''; suggest.innerHTML = '';
          renderPeople(); render();
        } catch (e) { ctx.notify(`No se pudo compartir: ${e.message}`, 6000, { title: 'Compartir', icon: 'archivos' }); }
      };
      back.querySelector('.ok').onclick = submit;
      to.onkeydown = (e) => e.key === 'Enter' && submit();
      back.querySelector('.cancel').onclick = () => back.remove();
      back.onclick = (e) => { if (e.target === back) back.remove(); };
      to.focus();
    }

    // ---- Barra y eventos ----
    $('.back').onclick = () => pos > 0 && go(history[--pos], false);
    $('.fwd').onclick = () => pos < history.length - 1 && go(history[++pos], false);
    $('.grid').onclick = () => { view = 'grid'; $('.grid').classList.add('on'); $('.list').classList.remove('on'); render(); };
    $('.list').onclick = () => { view = 'list'; $('.list').classList.add('on'); $('.grid').classList.remove('on'); render(); };
    $('.upload').onclick = () => picker.click();
    picker.onchange = () => { uploadFiles([...picker.files]); picker.value = ''; };
    $('.share').onclick = () => single() && isOwn(single()) && shareDialog(single());
    $('.new').onclick = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const create = async (label, def, kind) => {
        const name = await prompt(win, `Nombre ${label === 'Carpeta' ? 'de la carpeta' : 'del archivo'}`, def);
        if (!name) return;
        if (label === 'Carpeta') return tryDo(() => ctx.fs.mkdir(normalize(dir + '/' + name)));
        try {
          const created = await api('office/new', { method: 'POST', body: { dir, kind, name } });
          await ctx.fs.reload();
          ctx.openFile(created.path);
        } catch (e) { ctx.notify(e.message, 6000, { title: 'Nuevo', icon: 'archivos' }); }
      };
      ctx.menu([
        { label: 'Carpeta', run: () => create('Carpeta', 'Carpeta nueva') },
        '-',
        ...(isCloud() && !inShared() ? NEW_DOCS.map(([label, def, kind]) => ({ label, run: () => create(label, def, kind) })) : []),
      ], r.left, r.bottom + 6);
    };
    $('.files-search input').oninput = (e) => { query = e.target.value; render(); };
    let dragged = false;
    items.onclick = () => { if (dragged) { dragged = false; return; } sel = new Set(); render(); };
    // Selección con rectángulo: arrastrar desde una zona vacía.
    items.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('.file')) return;
      const box = items.getBoundingClientRect();
      const x0 = ev.clientX - box.left + items.scrollLeft, y0 = ev.clientY - box.top + items.scrollTop;
      const base = ev.metaKey || ev.ctrlKey ? new Set(sel) : new Set();
      const band = document.createElement('div');
      band.className = 'rubber-band';
      let moved = false;
      const move = (m) => {
        const x1 = m.clientX - box.left + items.scrollLeft, y1 = m.clientY - box.top + items.scrollTop;
        if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
        if (!moved) { moved = true; items.appendChild(band); }
        const r = { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
        Object.assign(band.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
        sel = new Set(base);
        for (const f of items.querySelectorAll('.file[data-path]')) {
          const fr = f.getBoundingClientRect();
          const fx = fr.left - box.left + items.scrollLeft, fy = fr.top - box.top + items.scrollTop;
          const hit = fx < r.right && fx + fr.width > r.left && fy < r.bottom && fy + fr.height > r.top;
          f.classList.toggle('sel', hit || base.has(f.dataset.path));
          if (hit) sel.add(f.dataset.path);
        }
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        band.remove();
        if (moved) { dragged = true; render(); }
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    items.oncontextmenu = (ev) => {
      if (ev.target.closest('.file')) return;
      ev.preventDefault();
      ctx.menu([
        { label: 'Nueva carpeta…', disabled: !editable(), run: () => $('.new').click() },
        ...(isCloud() && !inShared() ? [{ label: 'Subir archivos…', run: () => picker.click() }] : []),
      ], ev.clientX, ev.clientY);
    };
    // Arrastrar archivos del ordenador a la ventana.
    items.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); e.stopPropagation();
      items.classList.add('drop');
    });
    items.addEventListener('dragleave', () => items.classList.remove('drop'));
    items.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); e.stopPropagation();
      items.classList.remove('drop');
      uploadFiles([...e.dataTransfer.files]);
    });

    const off = ctx.fs.onChange(() => dir !== P2P_ROOT && render());
    const onAccount = () => renderSide();
    ctx.account?.listeners.add(onAccount);
    win.onClose(() => { off(); ctx.account?.listeners.delete(onAccount); return true; });
    go(start === SHARED_ROOT || ctx.fs.isDir(start || '') ? start : '/Documentos');
    if (arg?.upload) uploadFiles(arg.upload, start);
  },
};
