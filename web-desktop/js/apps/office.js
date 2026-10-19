// Texto, Cálculo y Presentaciones: LibreOffice (vía Collabora Online) dentro de
// una ventana de WonderfulOS, con los colores, la forma y el tema del sistema.
// El servidor de WonderfulOS entrega y guarda los archivos (server/office.mjs).
import { api } from '../api.js';
import { basename, isCloud } from '../fs.js';
import { settings } from '../shell/settings.js';

const EXTS = {
  texto: ['docx', 'doc', 'odt', 'rtf', 'txt', 'fodt', 'dotx', 'ott', 'pdf'],
  calculo: ['xlsx', 'xls', 'ods', 'csv', 'fods', 'xltx', 'ots'],
  diapositivas: ['pptx', 'ppt', 'odp', 'fodp', 'potx', 'otp'],
};

// Aspecto de WonderfulOS para LibreOffice: acento, esquinas redondeadas y superficies.
function cssVariables() {
  const s = settings.get();
  const dark = settings.isDark(s);
  const vars = {
    '--co-primary-element': s.accent,
    '--co-primary-color': s.accent,
    '--co-text-accent': s.accent,
    '--co-primary-element-light': `color-mix(in srgb, ${s.accent} 16%, transparent)`,
    '--co-border-radius': '10px',
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

function makeApp(id, name, description, kind) {
  return {
    id, name, description,
    extensions: EXTS[id],
    async launch(ctx, path) {
      if (!isCloud()) return ctx.notify('La oficina funciona con tu cuenta de WonderfulOS: inicia sesión.', 5000, { title: name, icon: id });
      // WonderfulOS instalado en el ordenador. En el Mac, la misma oficina que la versión online
      // (dentro del motor Linux); en los demás, LibreOffice de escritorio del propio equipo.
      // En el escritorio de un equipo, la oficina es la del servidor del equipo (como en la versión web).
      const d = window.nubeosDesktop?.remote ? null : window.nubeosDesktop;
      const engine = d && (await d.office.mode?.().catch(() => '')) === 'motor';
      if (d && !engine) return openLocal(ctx, { id, name }, kind, path);
      const { enabled } = engine ? { enabled: true } : await officeInfo();
      if (!enabled) return ctx.notify(`${name} necesita la oficina de WonderfulOS en este ordenador.`, 6000, { title: name, icon: id });
      // Sin archivo: documento nuevo en Documentos.
      if (!path) {
        try {
          const created = await api('office/new', { method: 'POST', body: { dir: '/Documentos', kind } });
          await ctx.fs.reload();
          path = created.path;
        } catch (e) { return ctx.notify(e.message, 6000, { title: name, icon: id }); }
      }
      openEditor(ctx, { id, name }, path, engine ? () => d.office.start() : null);
    },
  };
}

async function openLocal(ctx, app, kind, path) {
  const d = window.nubeosDesktop;
  if (!(await d.office.available())) {
    return ctx.notify('Para abrir documentos hace falta LibreOffice en este ordenador. WonderfulOS puede instalarlo por ti.', 15000, {
      title: app.name, icon: app.id,
      action: { label: 'Instalar LibreOffice', run: async () => {
        ctx.notify('Instalando LibreOffice… tarda unos minutos.', 8000, { title: app.name, icon: app.id });
        const r = await d.office.install();
        ctx.notify(r.ok ? 'LibreOffice instalado. Ya puedes abrir tus documentos.' : 'Te he abierto la página de LibreOffice para que lo descargues.', 8000, { title: app.name, icon: app.id });
      } },
    });
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
  } catch (e) { ctx.notify(e.message, 6000, { title: app.name, icon: app.id }); }
}

/** App de la oficina que abre un archivo (por su extensión). */
export function officeAppFor(name) {
  const ext = (String(name).match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const id = Object.keys(EXTS).find((k) => EXTS[k].includes(ext) && ext !== 'pdf' && ext !== 'txt');
  return id ? { id, name: { texto: 'Texto', calculo: 'Cálculo', diapositivas: 'Presentaciones' }[id] } : null;
}

/** opener (compartido P2P): devuelve { url, token, ttl } de la oficina de otro ordenador. */
export function openEditor(ctx, app, path, prepare = null, opener = null) {
  const node = opener ? {} : ctx.fs.stat(path);
  if (!node) return ctx.notify(`No existe ${basename(path)}`);
  const win = ctx.createWindow({ title: basename(path), width: Math.min(1280, innerWidth - 80), height: Math.min(820, innerHeight - 170) });
  win.body.classList.add('app-office');
  win.toggleMaximize(); // los documentos se abren a pantalla completa
  const frameName = `office-${win.id}`;
  win.body.innerHTML = `
    <div class="office-loading"><div class="spinner"></div><span>Abriendo ${basename(path).replace(/[<>&"]/g, '')}…</span></div>
    <iframe name="${frameName}" title="${app.name}" allow="clipboard-read *; clipboard-write *; fullscreen"></iframe>`;
  const iframe = win.body.querySelector('iframe');
  const loading = win.body.querySelector('.office-loading');

  const target = node.share ? { share: node.share, rel: node.rel || '/' } : { path };
  let origin = '';
  let tries = 0, retryTimer = null;
  // En el Mac la oficina vive en el motor Linux: se enciende (y la primera vez se instala) antes.
  let prepared = null;
  if (prepare) loading.querySelector('span').textContent = 'Preparando la oficina… la primera vez tarda unos minutos.';
  const ready = () => (prepared ||= prepare ? prepare().catch((e) => { prepared = null; throw Object.assign(e, { status: 0 }); }) : Promise.resolve());
  const start = () => ready().then(() => (opener ? opener() : api('office/open', { method: 'POST', body: target }))).then(({ url, token, ttl }) => {
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
  }).catch((e) => {
    // Si LibreOffice está arrancando o se ha reiniciado, se reintenta solo durante un minuto.
    const auto = e.status === 503 && ++tries < 12;
    loading.innerHTML = `${auto ? '<div class="spinner"></div>' : ''}<strong>${auto ? 'Conectando con LibreOffice…' : 'No se pudo abrir el documento'}</strong>
      <span>${String(e.message).replace(/[<>&"]/g, '')}</span><button class="btn primary retry">Reintentar</button>`;
    loading.querySelector('.retry').onclick = () => { clearTimeout(retryTimer); tries = 0; loading.innerHTML = '<div class="spinner"></div><span>Abriendo…</span>'; start(); };
    if (auto) retryTimer = setTimeout(start, 5000);
  });
  start();

  // Mensajes de LibreOffice: listo, cambios sin guardar y cerrar.
  const send = (MessageId, Values = {}) => iframe.contentWindow?.postMessage(JSON.stringify({ MessageId, SendTime: Date.now(), Values }), origin);
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    let msg;
    try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const v = msg.Values || {};
    if (msg.MessageId === 'App_LoadingStatus' && v.Status === 'Frame_Ready') send('Host_PostmessageReady');
    if (msg.MessageId === 'App_LoadingStatus' && v.Status === 'Document_Loaded') loading.remove();
    if (msg.MessageId === 'Doc_ModifiedStatus') win.setTitle(`${v.Modified ? '● ' : ''}${basename(path)}`);
    if (msg.MessageId === 'UI_Close') win.close();
  };
  addEventListener('message', onMessage);
  win.onClose(() => {
    clearTimeout(retryTimer);
    removeEventListener('message', onMessage);
    // LibreOffice guarda al cerrar; luego refrescamos tamaños y fechas.
    if (!opener) setTimeout(() => ctx.fs.reload().catch(() => {}), 3000);
    return true;
  });
}

export const texto = makeApp('texto', 'Texto', 'Documentos de Word y LibreOffice', 'texto');
export const calculo = makeApp('calculo', 'Cálculo', 'Hojas de cálculo de Excel y LibreOffice', 'calculo');
export const diapositivas = makeApp('diapositivas', 'Presentaciones', 'Presentaciones de PowerPoint y LibreOffice', 'diapositivas');
