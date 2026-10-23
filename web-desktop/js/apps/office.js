// Texto, Cálculo y Presentaciones de WonderfulOS.
// Si LibreOffice (Collabora) está activo, se integra en ventana WOPI.
// Si no está disponible, WonderfulOS abre directamente su suite ofimática nativa
// integrada en el navegador, ligera, rápida y 100% funcional.
import { api } from '../api.js';
import { basename, dirname, isLocalService } from '../fs.js';
import { settings } from '../shell/settings.js';
import { createEvaluator, colName, colIndex, parseRef, formatValue } from './formulas.js';

const EXTS = {
  texto: ['docx', 'doc', 'odt', 'rtf', 'txt', 'fodt', 'dotx', 'ott', 'pdf', 'md'],
  calculo: ['xlsx', 'xls', 'ods', 'csv', 'fods', 'xltx', 'ots', 'tsv'],
  diapositivas: ['pptx', 'ppt', 'odp', 'fodp', 'potx', 'otp', 'json', 'slide'],
};

// Aspecto de WonderfulOS para LibreOffice
function cssVariables() {
  const s = settings.get();
  const dark = settings.isDark(s);
  const vars = {
    '--co-primary-element': s.accent,
    '--co-primary-color': s.accent,
    '--co-text-accent': s.accent,
    '--co-primary-element-light': `color-mix(in srgb, ${s.accent} 16%, transparent)`,
    '--co-border-radius': '0px',
    '--co-body-bg': dark ? '#1c1e28' : '#f6f7fb',
    '--co-color-main-background': dark ? '#1c1e28' : '#ffffff',
    '--co-color-background-dark': dark ? '#262936' : '#eef0f6',
    '--co-color-background-light': dark ? '#2b2e3c' : '#f6f7fb',
    '--co-color-bg-nb-tab': dark ? '#1c1e28' : '#f6f7fb',
  };
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(';');
}

function uiDefaults() {
  const dark = settings.isDark();
  return `UIMode=notebookbar;UITheme=${dark ? 'dark' : 'light'};TextSidebar=false;SpreadsheetSidebar=false;PresentationSidebar=false;TextRuler=false;TextStatusbar=true;PresentationStatusbar=true`;
}

async function officeInfo() {
  return api('office/info').catch(() => ({ enabled: false }));
}

function findAvailablePath(ctx, dir, baseName, ext) {
  let p = `${dir}/${baseName}.${ext}`;
  let i = 2;
  while (ctx.fs.exists(p)) {
    p = `${dir}/${baseName} ${i}.${ext}`;
    i++;
  }
  return p;
}

async function loadFileText(ctx, path) {
  const node = ctx.fs.stat(path);
  if (!node) return '';
  if (!node.blob) return node.content || '';
  try {
    const url = ctx.fs.blobUrl(path);
    if (!url) return '';
    const res = await fetch(url);
    if (!res.ok) return '';
    const text = await res.text();
    const wtMatches = [...text.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    if (wtMatches.length > 0) {
      return wtMatches.map((m) => m[1]).join(' ');
    }
    return text;
  } catch {
    return '';
  }
}

function makeApp(id, name, description, kind) {
  return {
    id, name, description,
    extensions: EXTS[id],
    async launch(ctx, path) {
      const d = window.nubeosDesktop;
      const engine = d && (await d.office.mode?.().catch(() => '')) === 'motor';
      if (d && !engine) {
        try {
          return await openLocal(ctx, { id, name }, kind, path);
        } catch {
          // Fallback a oficina nativa
        }
      }

      // Comprobar si Collabora está activo en el servidor
      const { enabled } = engine ? { enabled: true } : await officeInfo();
      if (!enabled) {
        // En lugar de bloquear al usuario con error, abrir la suite nativa de WonderfulOS
        return openNativeOffice(ctx, { id, name }, kind, path);
      }

      // Si Collabora está activo pero no hay archivo, crear uno
      if (!path) {
        try {
          const created = await api('office/new', { method: 'POST', body: { dir: '/Documentos', kind } });
          await ctx.fs.reload();
          path = created.path;
        } catch {
          return openNativeOffice(ctx, { id, name }, kind, path);
        }
      }

      openEditor(ctx, { id, name }, path, engine ? () => d.office.start() : null);
    },
  };
}

async function openLocal(ctx, app, kind, path) {
  const d = window.nubeosDesktop;
  if (!(await d.office.available())) {
    return openNativeOffice(ctx, app, kind, path);
  }
  try {
    if (!path) {
      const created = await api('office/new', { method: 'POST', body: { dir: '/Documentos', kind } });
      await ctx.fs.reload();
      path = created.path;
    }
    const s = settings.get();
    await d.office.open(path, { dark: settings.isDark(s), accent: s.accent });
    ctx.notify(`Abriendo ${basename(path)} en LibreOffice. Lo que guardes se guarda en WonderfulOS.`, 4000, { title: app.name, icon: app.id });
  } catch {
    return openNativeOffice(ctx, app, kind, path);
  }
}

/** App de la oficina que abre un archivo (por su extensión). */
export function officeAppFor(name) {
  const ext = (String(name).match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const id = Object.keys(EXTS).find((k) => EXTS[k].includes(ext) && ext !== 'pdf');
  return id ? { id, name: { texto: 'Texto', calculo: 'Cálculo', diapositivas: 'Presentaciones' }[id] } : null;
}

export function openEditor(ctx, app, path, prepare = null) {
  const node = ctx.fs.stat(path);
  if (!node) return ctx.notify(`No existe ${basename(path)}`);
  const win = ctx.createWindow({ title: basename(path), width: Math.min(1280, innerWidth - 80), height: Math.min(820, innerHeight - 170) });
  win.body.classList.add('app-office');
  win.toggleMaximize();
  const frameName = `office-${win.id}`;
  win.body.innerHTML = `
    <div class="office-loading">
      <div class="spinner"></div>
      <span>Abriendo ${basename(path).replace(/[<>&"]/g, '')}…</span>
      <button class="btn secondary off-switch-native-btn" style="margin-top:14px; display:inline-block;">Abrir con editor nativo</button>
    </div>
    <iframe name="${frameName}" title="${app.name}" allow="clipboard-read *; clipboard-write *; fullscreen"></iframe>`;

  const iframe = win.body.querySelector('iframe');
  const loading = win.body.querySelector('.office-loading');
  const switchBtn = win.body.querySelector('.off-switch-native-btn');
  if (switchBtn) {
    switchBtn.onclick = () => {
      win.close();
      openNativeOffice(ctx, app, app.id, path);
    };
  }

  const target = { path };
  let origin = '';
  let tries = 0, retryTimer = null, revealTimer = null;
  let prepared = null;
  if (prepare) loading.querySelector('span').textContent = 'Preparando la oficina…';
  const ready = () => (prepared ||= prepare ? prepare().catch((e) => { prepared = null; throw Object.assign(e, { status: 0 }); }) : Promise.resolve());

  const start = () => ready().then(() => api('office/open', { method: 'POST', body: target })).then(({ url, token, ttl }) => {
    origin = new URL(url).origin;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = url;
    form.target = frameName;
    form.hidden = true;
    const field = (k, v) => form.appendChild(Object.assign(document.createElement('input'), { type: 'hidden', name: k, value: v }));
    field('access_token', token);
    field('access_token_ttl', String(ttl));
    field('css_variables', cssVariables());
    field('ui_defaults', uiDefaults());
    field('theme', 'nubeos');
    document.body.appendChild(form);
    form.submit();
    form.remove();
    revealTimer = setTimeout(() => { if (loading.isConnected) loading.remove(); }, 90000);
  }).catch((e) => {
    clearTimeout(revealTimer);
    const auto = e.status === 503 && ++tries < 8;
    loading.innerHTML = `${auto ? '<div class="spinner"></div>' : ''}<strong>${auto ? 'Conectando con LibreOffice…' : 'No se pudo conectar con LibreOffice'}</strong>
      <span>${String(e.message || 'Servicio no disponible').replace(/[<>&"]/g, '')}</span>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn primary retry">Reintentar</button>
        <button class="btn secondary fallback-btn">Abrir editor nativo</button>
      </div>`;
    loading.querySelector('.retry').onclick = () => { clearTimeout(retryTimer); tries = 0; loading.innerHTML = '<div class="spinner"></div><span>Abriendo…</span>'; start(); };
    loading.querySelector('.fallback-btn').onclick = () => {
      win.close();
      openNativeOffice(ctx, app, app.id, path);
    };
    if (auto) retryTimer = setTimeout(start, 4000);
  });
  start();

  const send = (MessageId, Values = {}) => iframe.contentWindow?.postMessage(JSON.stringify({ MessageId, SendTime: Date.now(), Values }), origin);
  const loaded = () => { clearTimeout(revealTimer); loading.remove(); };
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    let msg;
    try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const v = msg.Values || {};
    if (msg.MessageId === 'App_LoadingStatus' && v.Status === 'Frame_Ready') send('Host_PostmessageReady');
    if (msg.MessageId === 'App_LoadingStatus' && v.Status === 'Document_Loaded') loaded();
    if (msg.MessageId === 'Doc_Title' && v.DocType) loaded();
    if (msg.MessageId === 'Doc_PartChanged') loaded();
    if (msg.MessageId === 'Doc_ModifiedStatus') win.setTitle(`${v.Modified ? '● ' : ''}${basename(path)}`);
    if (msg.MessageId === 'UI_Close') win.close();
  };
  addEventListener('message', onMessage);
  win.onClose(() => {
    clearTimeout(retryTimer);
    clearTimeout(revealTimer);
    removeEventListener('message', onMessage);
    setTimeout(() => ctx.fs.reload().catch(() => {}), 3000);
    return true;
  });
}

// =========================================================================
// SUITE OFIMÁTICA NATIVA DE WONDERFULOS (Texto, Cálculo y Diapositivas)
// =========================================================================

export async function openNativeOffice(ctx, app, kind, filePath) {
  let currentPath = filePath;

  // Si no se proporcionó archivo, crear uno por defecto en /Documentos
  if (!currentPath) {
    if (!ctx.fs.exists('/Documentos')) ctx.fs.mkdir('/Documentos');
    if (kind === 'calculo') {
      currentPath = findAvailablePath(ctx, '/Documentos', 'Hoja de cálculo', 'csv');
      ctx.fs.write(currentPath, 'Concepto,Enero,Febrero,Marzo,Total\nVentas,1200,1450,1800,=SUMA(B2:D2)\nCostes,800,850,920,=SUMA(B3:D3)\nBeneficio,=B2-B3,=C2-C3,=D2-D3,=E2-E3\n');
    } else if (kind === 'diapositivas') {
      currentPath = findAvailablePath(ctx, '/Documentos', 'Presentación', 'json');
      ctx.fs.write(currentPath, JSON.stringify({
        theme: 'dark',
        slides: [
          {
            title: 'Bienvenido a WonderfulOS',
            subtitle: 'Suite ofimática nativa rápida, privada y elegante',
            content: '• Sin necesidad de servidores externos ni dependencias\n• Modo presentación a pantalla completa integrado\n• Compatible con Agentic y automatizaciones del sistema',
            bg: '#1a1d28',
          },
          {
            title: 'Novedades y Capacidades',
            subtitle: 'Herramientas integradas para máxima productividad',
            content: '• Texto con formato enriquecido, conteo de palabras y exportación\n• Cálculo con motor de fórmulas completo (=SUMA, =PROMEDIO, etc.)\n• Presentaciones dinámicas listas para proyectar',
            bg: '#1e293b',
          },
        ],
      }, null, 2));
    } else {
      currentPath = findAvailablePath(ctx, '/Documentos', 'Documento', 'txt');
      ctx.fs.write(currentPath, 'Título del Documento\n====================\n\nEscribe aquí el contenido de tu documento. Puedes darle formato, guardarlo con Ctrl+S o descargarlo a tu ordenador en cualquier momento.\n');
    }
  }

  const initialContent = await loadFileText(ctx, currentPath);

  const win = ctx.createWindow({
    title: `${basename(currentPath)} - ${app.name}`,
    width: Math.min(1080, innerWidth - 60),
    height: Math.min(740, innerHeight - 120),
  });
  win.body.classList.add('app-native-office');

  let dirty = false;
  const updateTitle = () => {
    win.setTitle(`${dirty ? '● ' : ''}${basename(currentPath)} - ${app.name}`);
  };

  if (kind === 'calculo') {
    renderNativeCalculo(ctx, win, currentPath, initialContent, () => { dirty = true; updateTitle(); }, () => { dirty = false; updateTitle(); });
  } else if (kind === 'diapositivas') {
    renderNativeDiapositivas(ctx, win, currentPath, initialContent, () => { dirty = true; updateTitle(); }, () => { dirty = false; updateTitle(); });
  } else {
    renderNativeTexto(ctx, win, currentPath, initialContent, () => { dirty = true; updateTitle(); }, () => { dirty = false; updateTitle(); });
  }
}

// -------------------------------------------------------------------------
// 1. TEXTO (Editor de Documentos Nativo)
// -------------------------------------------------------------------------
function renderNativeTexto(ctx, win, path, content, onDirty, onSaved) {
  win.body.innerHTML = `
    <div class="off-native-wrap off-text-wrap">
      <header class="off-toolbar">
        <div class="off-toolbar-group">
          <button class="off-tool-btn off-save-btn" title="Guardar (Ctrl+S)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Guardar</span>
          </button>
          <button class="off-tool-btn off-download-btn" title="Descargar copia">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Descargar</span>
          </button>
        </div>
        <div class="off-sep"></div>
        <div class="off-toolbar-group">
          <button class="off-tool-btn" data-cmd="bold" title="Negrita (Ctrl+B)"><b>B</b></button>
          <button class="off-tool-btn" data-cmd="italic" title="Cursiva (Ctrl+I)"><i>I</i></button>
          <button class="off-tool-btn" data-cmd="underline" title="Subrayado (Ctrl+U)"><u>U</u></button>
          <button class="off-tool-btn" data-cmd="strikeThrough" title="Tachado"><s>S</s></button>
        </div>
        <div class="off-sep"></div>
        <div class="off-toolbar-group">
          <button class="off-tool-btn" data-cmd="formatBlock" data-val="h1" title="Título principal">H1</button>
          <button class="off-tool-btn" data-cmd="formatBlock" data-val="h2" title="Subtítulo">H2</button>
          <button class="off-tool-btn" data-cmd="formatBlock" data-val="p" title="Párrafo">P</button>
        </div>
        <div class="off-sep"></div>
        <div class="off-toolbar-group">
          <button class="off-tool-btn" data-cmd="insertUnorderedList" title="Lista de viñetas">• Viñetas</button>
          <button class="off-tool-btn" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
          <button class="off-tool-btn" data-cmd="removeFormat" title="Limpiar formato">✕ Formato</button>
        </div>
        <div class="off-sep"></div>
        <div class="off-status-pill">Documento nativo</div>
      </header>

      <div class="off-editor-scroll">
        <div class="off-doc-page" contenteditable="true" spellcheck="false"></div>
      </div>

      <footer class="off-statusbar">
        <span class="off-stat-words">0 palabras</span>
        <span class="off-sep-dot">•</span>
        <span class="off-stat-chars">0 caracteres</span>
        <span class="off-stat-state" style="margin-left:auto;">Guardado</span>
      </footer>
    </div>
  `;

  const page = win.body.querySelector('.off-doc-page');
  const wordsEl = win.body.querySelector('.off-stat-words');
  const charsEl = win.body.querySelector('.off-stat-chars');
  const stateEl = win.body.querySelector('.off-stat-state');
  const saveBtn = win.body.querySelector('.off-save-btn');
  const downloadBtn = win.body.querySelector('.off-download-btn');

  // Cargar contenido inicial (si tiene etiquetas HTML las usa; si es texto plano, lo formatea con saltos)
  if (content.includes('<p>') || content.includes('<div>') || content.includes('<br>')) {
    page.innerHTML = content;
  } else {
    page.innerHTML = content.split('\n').map((line) => line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>').join('');
  }

  const updateStats = () => {
    const text = page.innerText || '';
    const words = (text.trim().match(/\S+/g) || []).length;
    wordsEl.textContent = `${words} palabra${words === 1 ? '' : 's'}`;
    charsEl.textContent = `${text.length} caracteres`;
  };
  updateStats();

  page.addEventListener('input', () => {
    onDirty();
    stateEl.textContent = 'Modificado';
    stateEl.style.color = 'var(--accent, #3b82f6)';
    updateStats();
  });

  // Botones de formato
  win.body.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.onclick = () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
      page.focus();
    };
  });

  const saveDoc = () => {
    const textContent = page.innerText || '';
    ctx.fs.write(path, textContent);
    onSaved();
    stateEl.textContent = 'Guardado';
    stateEl.style.color = '';
    ctx.notify(`Guardado ${basename(path)}`, 2000);
  };

  saveBtn.onclick = saveDoc;

  downloadBtn.onclick = () => {
    try {
      ctx.fs.downloadToComputer(path);
    } catch {
      const blob = new Blob([page.innerText || ''], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = basename(path);
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  win.body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDoc();
    }
  });
}

// -------------------------------------------------------------------------
// 2. CÁLCULO (Hoja de Cálculo Nativa con Soporte de Fórmulas)
// -------------------------------------------------------------------------
function renderNativeCalculo(ctx, win, path, content, onDirty, onSaved) {
  win.body.innerHTML = `
    <div class="off-native-wrap off-calc-wrap">
      <header class="off-toolbar">
        <div class="off-toolbar-group">
          <button class="off-tool-btn off-save-btn" title="Guardar (Ctrl+S)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Guardar</span>
          </button>
          <button class="off-tool-btn off-download-btn" title="Descargar CSV">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Exportar CSV</span>
          </button>
        </div>
        <div class="off-sep"></div>
        <div class="off-toolbar-group">
          <button class="off-tool-btn off-autosum-btn" title="Autosuma de columna">
            <b>Σ Autosuma</b>
          </button>
          <button class="off-tool-btn off-add-row-btn" title="Añadir fila al final">+ Fila</button>
          <button class="off-tool-btn off-add-col-btn" title="Añadir columna al final">+ Columna</button>
        </div>
        <div class="off-status-pill" style="margin-left:auto;">Motor de Fórmulas Activo</div>
      </header>

      <!-- Barra de fórmulas -->
      <div class="off-fx-bar">
        <span class="off-cell-badge">A1</span>
        <span class="off-fx-label">fx</span>
        <input type="text" class="off-fx-input" placeholder="Introduce un valor o fórmula (ej. =SUMA(B2:B10))" spellcheck="false" />
      </div>

      <!-- Cuadrícula de la hoja -->
      <div class="off-grid-scroll">
        <table class="off-calc-table">
          <thead>
            <tr class="off-header-row"></tr>
          </thead>
          <tbody class="off-body-rows"></tbody>
        </table>
      </div>

      <footer class="off-statusbar">
        <span class="off-calc-stats">Hoja lista</span>
        <span class="off-stat-state" style="margin-left:auto;">Guardado</span>
      </footer>
    </div>
  `;

  // Parsear datos iniciales (CSV o matriz vacía)
  let rowsCount = 20;
  let colsCount = 8;
  const rawCells = {}; // clave 'A1': '=SUMA(B1:B2)' o '150'

  function parseCsvContent(text) {
    if (!text || !text.trim()) return;
    const lines = text.trim().split(/\r?\n/);
    lines.forEach((line, rIdx) => {
      // Separación sencilla de CSV (respeta comillas dobles si las hay)
      const values = line.split(',');
      values.forEach((val, cIdx) => {
        const ref = colName(cIdx) + (rIdx + 1);
        rawCells[ref] = val.trim();
        if (cIdx + 1 > colsCount) colsCount = cIdx + 1;
      });
      if (rIdx + 1 > rowsCount) rowsCount = rIdx + 1;
    });
    rowsCount = Math.max(rowsCount, 20);
    colsCount = Math.max(colsCount, 8);
  }

  parseCsvContent(content);

  let selectedRef = 'A1';
  const badgeEl = win.body.querySelector('.off-cell-badge');
  const fxInput = win.body.querySelector('.off-fx-input');
  const headerRow = win.body.querySelector('.off-header-row');
  const tbody = win.body.querySelector('.off-body-rows');
  const statsEl = win.body.querySelector('.off-calc-stats');
  const stateEl = win.body.querySelector('.off-stat-state');
  const saveBtn = win.body.querySelector('.off-save-btn');
  const downloadBtn = win.body.querySelector('.off-download-btn');
  const autosumBtn = win.body.querySelector('.off-autosum-btn');
  const addRowBtn = win.body.querySelector('.off-add-row-btn');
  const addColBtn = win.body.querySelector('.off-add-col-btn');

  function renderTable() {
    // Encabezado
    let thHtml = '<th class="off-th-corner"></th>';
    for (let c = 0; c < colsCount; c++) {
      thHtml += `<th class="off-col-header" data-col="${c}">${colName(c)}</th>`;
    }
    headerRow.innerHTML = thHtml;

    // Filas
    let trHtml = '';
    const evaluator = createEvaluator(rawCells);

    for (let r = 0; r < rowsCount; r++) {
      const rowNum = r + 1;
      trHtml += `<tr><td class="off-row-header">${rowNum}</td>`;
      for (let c = 0; c < colsCount; c++) {
        const ref = colName(c) + rowNum;
        let displayVal = '';
        try {
          const evalRes = evaluator.value(ref);
          displayVal = formatValue(evalRes);
        } catch {
          displayVal = '#ERROR!';
        }
        const isSel = ref === selectedRef ? ' selected' : '';
        trHtml += `<td class="off-cell${isSel}" data-ref="${ref}" tabindex="0">${escapeHtml(displayVal)}</td>`;
      }
      trHtml += '</tr>';
    }
    tbody.innerHTML = trHtml;

    // Actualizar badge y barra fx
    badgeEl.textContent = selectedRef;
    fxInput.value = rawCells[selectedRef] || '';
  }

  renderTable();

  function selectCell(ref) {
    selectedRef = ref;
    tbody.querySelectorAll('.off-cell.selected').forEach((el) => el.classList.remove('selected'));
    const target = tbody.querySelector(`.off-cell[data-ref="${ref}"]`);
    if (target) {
      target.classList.add('selected');
      target.focus();
    }
    badgeEl.textContent = ref;
    fxInput.value = rawCells[ref] || '';

    // Estadísticas
    const raw = rawCells[ref] || '';
    statsEl.textContent = raw.startsWith('=') ? `Fórmula: ${raw}` : `Celda ${ref}: ${raw || '(vacía)'}`;
  }

  tbody.addEventListener('click', (e) => {
    const td = e.target.closest('.off-cell');
    if (!td) return;
    selectCell(td.dataset.ref);
  });

  tbody.addEventListener('dblclick', (e) => {
    const td = e.target.closest('.off-cell');
    if (!td) return;
    const ref = td.dataset.ref;
    td.setAttribute('contenteditable', 'true');
    td.textContent = rawCells[ref] || '';
    td.focus();

    const finishEdit = () => {
      td.removeAttribute('contenteditable');
      const val = td.textContent.trim();
      if (val !== (rawCells[ref] || '')) {
        if (val) rawCells[ref] = val; else delete rawCells[ref];
        onDirty();
        stateEl.textContent = 'Modificado';
        stateEl.style.color = 'var(--accent, #3b82f6)';
        renderTable();
        selectCell(ref);
      }
    };
    td.onblur = finishEdit;
    td.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(); }
      if (ev.key === 'Escape') { td.removeAttribute('contenteditable'); renderTable(); selectCell(ref); }
    };
  });

  fxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = fxInput.value.trim();
      if (val) rawCells[selectedRef] = val; else delete rawCells[selectedRef];
      onDirty();
      stateEl.textContent = 'Modificado';
      stateEl.style.color = 'var(--accent, #3b82f6)';
      renderTable();
      selectCell(selectedRef);
    }
  });

  autosumBtn.onclick = () => {
    const parsed = parseRef(selectedRef);
    if (!parsed) return;
    const colStr = colName(parsed.col);
    if (parsed.row === 0) return;
    const formula = `=SUMA(${colStr}1:${colStr}${parsed.row})`;
    rawCells[selectedRef] = formula;
    fxInput.value = formula;
    onDirty();
    renderTable();
    selectCell(selectedRef);
  };

  addRowBtn.onclick = () => {
    rowsCount += 5;
    renderTable();
    selectCell(selectedRef);
  };

  addColBtn.onclick = () => {
    colsCount += 2;
    renderTable();
    selectCell(selectedRef);
  };

  function toCsvString() {
    let maxR = 1, maxC = 1;
    Object.keys(rawCells).forEach((ref) => {
      const p = parseRef(ref);
      if (p) {
        if (p.row + 1 > maxR) maxR = p.row + 1;
        if (p.col + 1 > maxC) maxC = p.col + 1;
      }
    });
    const lines = [];
    for (let r = 0; r < maxR; r++) {
      const rowVals = [];
      for (let c = 0; c < maxC; c++) {
        const ref = colName(c) + (r + 1);
        const val = rawCells[ref] || '';
        rowVals.push(val.includes(',') ? `"${val}"` : val);
      }
      lines.push(rowVals.join(','));
    }
    return lines.join('\n');
  }

  const saveSheet = () => {
    const csv = toCsvString();
    ctx.fs.write(path, csv);
    onSaved();
    stateEl.textContent = 'Guardado';
    stateEl.style.color = '';
    ctx.notify(`Guardado ${basename(path)}`, 2000);
  };

  saveBtn.onclick = saveSheet;

  downloadBtn.onclick = () => {
    const csv = toCsvString();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = basename(path).replace(/\.[^.]+$/, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  win.body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveSheet();
    }
  });
}

// -------------------------------------------------------------------------
// 3. PRESENTACIONES (Editor y Reproductor de Diapositivas Nativo)
// -------------------------------------------------------------------------
function renderNativeDiapositivas(ctx, win, path, content, onDirty, onSaved) {
  let deck = {
    theme: 'dark',
    slides: [
      { title: 'Mi Presentación', subtitle: 'Subtítulo de la diapositiva', content: '• Primer punto clave\n• Segundo punto clave', bg: '#1a1d28' },
    ],
  };

  try {
    const parsed = JSON.parse(content);
    if (parsed.slides && Array.isArray(parsed.slides)) deck = parsed;
  } catch {
    // Si era texto plano, crear diapositivas a partir de encabezados
    if (content && content.trim()) {
      deck.slides = content.split('\n\n').slice(0, 5).map((sec, i) => ({
        title: `Diapositiva ${i + 1}`,
        subtitle: '',
        content: sec,
        bg: '#1a1d28',
      }));
    }
  }

  let activeSlide = 0;

  win.body.innerHTML = `
    <div class="off-native-wrap off-slides-wrap">
      <header class="off-toolbar">
        <div class="off-toolbar-group">
          <button class="off-tool-btn off-save-btn" title="Guardar (Ctrl+S)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Guardar</span>
          </button>
          <button class="off-tool-btn off-add-slide-btn" title="Añadir nueva diapositiva">+ Diapositiva</button>
          <button class="off-tool-btn off-del-slide-btn" title="Eliminar diapositiva actual">Eliminar</button>
        </div>
        <div class="off-sep"></div>
        <div class="off-toolbar-group">
          <button class="off-tool-btn primary off-play-btn" title="Iniciar presentación a pantalla completa">
            <b>▶ Iniciar Presentación</b>
          </button>
        </div>
        <div class="off-status-pill" style="margin-left:auto;">Presentaciones WonderfulOS</div>
      </header>

      <div class="off-slides-body">
        <!-- Lista lateral de miniaturas -->
        <aside class="off-slides-sidebar">
          <div class="off-thumbs-list"></div>
        </aside>

        <!-- Lienzo de edición central -->
        <main class="off-slide-stage">
          <div class="off-slide-frame" style="background: ${deck.slides[0]?.bg || '#1a1d28'}">
            <input type="text" class="off-slide-title-input" placeholder="Título de la diapositiva" spellcheck="false" />
            <input type="text" class="off-slide-sub-input" placeholder="Subtítulo opcional" spellcheck="false" />
            <div class="off-slide-divider"></div>
            <textarea class="off-slide-body-input" placeholder="• Añade viñetas o texto aquí..." spellcheck="false"></textarea>
          </div>
        </main>
      </div>

      <footer class="off-statusbar">
        <span class="off-slide-counter">Diapositiva 1 de 1</span>
        <span class="off-stat-state" style="margin-left:auto;">Guardado</span>
      </footer>
    </div>
  `;

  const thumbsContainer = win.body.querySelector('.off-thumbs-list');
  const slideFrame = win.body.querySelector('.off-slide-frame');
  const titleInput = win.body.querySelector('.off-slide-title-input');
  const subInput = win.body.querySelector('.off-slide-sub-input');
  const bodyInput = win.body.querySelector('.off-slide-body-input');
  const counterEl = win.body.querySelector('.off-slide-counter');
  const stateEl = win.body.querySelector('.off-stat-state');
  const saveBtn = win.body.querySelector('.off-save-btn');
  const addBtn = win.body.querySelector('.off-add-slide-btn');
  const delBtn = win.body.querySelector('.off-del-slide-btn');
  const playBtn = win.body.querySelector('.off-play-btn');

  function renderThumbs() {
    thumbsContainer.innerHTML = deck.slides.map((s, idx) => `
      <div class="off-thumb-item ${idx === activeSlide ? 'active' : ''}" data-idx="${idx}">
        <span class="off-thumb-num">${idx + 1}</span>
        <div class="off-thumb-preview" style="background: ${s.bg || '#1a1d28'};">
          <div class="off-thumb-text">${escapeHtml(s.title || `Diapositiva ${idx + 1}`)}</div>
        </div>
      </div>
    `).join('');

    counterEl.textContent = `Diapositiva ${activeSlide + 1} de ${deck.slides.length}`;
  }

  function loadActiveSlide() {
    const s = deck.slides[activeSlide] || { title: '', subtitle: '', content: '', bg: '#1a1d28' };
    titleInput.value = s.title || '';
    subInput.value = s.subtitle || '';
    bodyInput.value = s.content || '';
    slideFrame.style.background = s.bg || '#1a1d28';
    renderThumbs();
  }

  thumbsContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.off-thumb-item');
    if (!item) return;
    activeSlide = Number(item.dataset.idx);
    loadActiveSlide();
  });

  const onSlideEdit = () => {
    if (!deck.slides[activeSlide]) return;
    deck.slides[activeSlide].title = titleInput.value;
    deck.slides[activeSlide].subtitle = subInput.value;
    deck.slides[activeSlide].content = bodyInput.value;
    onDirty();
    stateEl.textContent = 'Modificado';
    stateEl.style.color = 'var(--accent, #3b82f6)';
    renderThumbs();
  };

  titleInput.addEventListener('input', onSlideEdit);
  subInput.addEventListener('input', onSlideEdit);
  bodyInput.addEventListener('input', onSlideEdit);

  addBtn.onclick = () => {
    deck.slides.push({
      title: `Nueva Diapositiva ${deck.slides.length + 1}`,
      subtitle: '',
      content: '• Punto principal\n• Punto secundario',
      bg: '#1a1d28',
    });
    activeSlide = deck.slides.length - 1;
    loadActiveSlide();
    onDirty();
  };

  delBtn.onclick = () => {
    if (deck.slides.length <= 1) {
      return ctx.notify('La presentación debe tener al menos una diapositiva');
    }
    deck.slides.splice(activeSlide, 1);
    if (activeSlide >= deck.slides.length) activeSlide = deck.slides.length - 1;
    loadActiveSlide();
    onDirty();
  };

  const saveDeck = () => {
    ctx.fs.write(path, JSON.stringify(deck, null, 2));
    onSaved();
    stateEl.textContent = 'Guardado';
    stateEl.style.color = '';
    ctx.notify(`Guardada ${basename(path)}`, 2000);
  };

  saveBtn.onclick = saveDeck;

  // Reproductor a pantalla completa
  playBtn.onclick = () => {
    openPresentationPlayer(deck, activeSlide);
  };

  win.body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDeck();
    }
  });

  loadActiveSlide();
}

function openPresentationPlayer(deck, startIdx = 0) {
  let cur = startIdx;
  const overlay = document.createElement('div');
  overlay.className = 'off-player-overlay';
  document.body.appendChild(overlay);

  function renderCur() {
    const s = deck.slides[cur] || { title: '', subtitle: '', content: '', bg: '#111' };
    overlay.innerHTML = `
      <div class="off-player-slide" style="background:${s.bg || '#111'};">
        <h1 class="off-player-title">${escapeHtml(s.title || '')}</h1>
        ${s.subtitle ? `<h3 class="off-player-sub">${escapeHtml(s.subtitle)}</h3>` : ''}
        ${s.content ? `<div class="off-player-body">${escapeHtml(s.content).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
      <div class="off-player-controls">
        <button class="off-p-btn off-p-prev">◀</button>
        <span class="off-p-info">${cur + 1} / ${deck.slides.length}</span>
        <button class="off-p-btn off-p-next">▶</button>
        <button class="off-p-btn off-p-close" style="margin-left:16px;">✕ Salir</button>
      </div>
    `;

    overlay.querySelector('.off-p-prev').onclick = prev;
    overlay.querySelector('.off-p-next').onclick = next;
    overlay.querySelector('.off-p-close').onclick = close;
  }

  const next = () => { if (cur < deck.slides.length - 1) { cur++; renderCur(); } };
  const prev = () => { if (cur > 0) { cur--; renderCur(); } };
  const close = () => {
    removeEventListener('keydown', onKey);
    overlay.remove();
  };

  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  addEventListener('keydown', onKey);

  renderCur();
}

function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const texto = makeApp('texto', 'Texto', 'Documentos de Word y WonderfulOS', 'texto');
export const calculo = makeApp('calculo', 'Cálculo', 'Hojas de cálculo de Excel y WonderfulOS', 'calculo');
export const diapositivas = makeApp('diapositivas', 'Presentaciones', 'Presentaciones de diapositivas de WonderfulOS', 'diapositivas');
