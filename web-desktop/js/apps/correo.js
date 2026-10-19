// Correo: Roundcube (open source) con el aspecto de WonderfulOS, funcionando en el propio
// ordenador (ver desktop/office-engine.mjs). Gmail, Outlook, iCloud, Yahoo o cualquier IMAP.
import { ICONS } from '../shell/icons.js';
import { emptyState } from '../cloud.js';

export default {
  id: 'correo',
  name: 'Correo',
  description: 'Lee y envía tus correos',

  async launch(ctx) {
    const open = ctx.windows?.().find((w) => w.appId === 'correo');
    if (open) return open.focus();
    const win = ctx.createWindow({ title: 'Correo', width: Math.min(1240, innerWidth - 60), height: Math.min(800, innerHeight - 120) });
    win.body.classList.add('app-office'); // misma carga y marco que la oficina
    const d = window.nubeosDesktop;
    if (!d?.mail) {
      win.body.innerHTML = emptyState(ICONS.correo, 'Correo', 'El Correo funciona en WonderfulOS instalado en tu ordenador.');
      return;
    }
    win.body.innerHTML = '<div class="office-loading"><div class="spinner"></div><span>Abriendo el Correo…</span></div>';
    const show = async () => {
      try {
        const url = await d.mail.start();
        win.body.innerHTML = `<iframe src="${url}/" title="Correo" allow="clipboard-read *; clipboard-write *" style="flex:1;width:100%;border:0"></iframe>`;
      } catch (e) {
        win.body.innerHTML = `<div class="office-loading"><strong>No se pudo abrir el Correo</strong><span>${String(e.message).replace(/[<>&"]/g, '')}</span><button class="btn primary retry">Reintentar</button></div>`;
        win.body.querySelector('.retry').onclick = () => { win.body.innerHTML = '<div class="office-loading"><div class="spinner"></div><span>Abriendo el Correo…</span></div>'; show(); };
      }
    };
    show();
  },
};
