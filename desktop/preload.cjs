// Puente entre el escritorio de WonderfulOS y el equipo (main.mjs / local.mjs).
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, ...args) => ipcRenderer.invoke(`nubeos:${ch}`, ...args);
const listeners = { notice: new Set(), openUrl: new Set() };
ipcRenderer.on('nubeos:notice', (e, msg) => listeners.notice.forEach((fn) => fn(msg)));
ipcRenderer.on('nubeos:open-url', (e, url) => listeners.openUrl.forEach((fn) => fn(url)));

contextBridge.exposeInMainWorld('nubeosDesktop', {
  info: () => call('info'),
  quit: () => call('quit'),
  setZoom: (z) => call('zoom', z),
  power: (what) => call('power', what),
  installSystem: () => call('install-system'),
  setOpenAtLogin: (on) => call('open-at-login', on),
  setFullscreen: (on) => call('fullscreen', on),
  office: {
    mode: () => call('office-mode'),
    start: () => call('office-start'),
    available: () => call('office-available'),
    install: () => call('office-install'),
    open: (path, theme) => call('office-open', path, theme),
  },
  apps: {
    search: (q) => call('apps-search', q),
    installed: () => call('apps-installed'),
    install: (id) => call('apps-install', id),
    uninstall: (id) => call('apps-uninstall', id),
    open: (id) => call('apps-open', id),
  },
  mail: { start: () => call('mail-start') },
  linux: {
    status: () => call('linux-status'),
    start: () => call('linux-start'),
    stop: () => call('linux-stop'),
    installed: () => call('linux-installed'),
    install: (id) => call('linux-install', id),
    uninstall: (id) => call('linux-uninstall', id),
    open: (id) => call('linux-open', id),
    openFile: (p) => call('linux-open-file', p),
  },
  showInSystem: (p) => call('show-in-system', p),
  openWithSystem: (p) => call('open-with-system', p),
  openExternal: (url) => call('open-external', url),
  onNotice: (fn) => { listeners.notice.add(fn); return () => listeners.notice.delete(fn); },
  onOpenUrl: (fn) => { listeners.openUrl.add(fn); return () => listeners.openUrl.delete(fn); },
});
