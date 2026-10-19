// Navegación a través del proxy (server.mjs, o la máquina en la nube en producción).
// Si el escritorio se sirve sin proxy (p. ej. con python -m http.server), las
// páginas se cargan directamente y algunos sitios no se podrán mostrar.

let proxyOrigin = null;
let config = {};
export const serverConfig = () => config;

export async function initProxy() {
  try {
    const res = await fetch('nubeos-config.json', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    config = cfg;
    if (cfg.proxyOrigin) proxyOrigin = cfg.proxyOrigin;
    else if (cfg.proxyPort) proxyOrigin = `${location.protocol}//${location.hostname}:${cfg.proxyPort}`;
  } catch { /* sin proxy */ }
}

export const getProxyOrigin = () => proxyOrigin;

// Token firmado que el proxy exige en producción (ver server/proxy.mjs).
let token = '';
export async function refreshProxyToken() {
  try {
    const res = await fetch('api/proxy-token', { headers: { 'x-nubeos': '1' } });
    if (res.ok) token = (await res.json()).token || '';
  } catch { /* sin servidor */ }
}

// Direcciones locales (p. ej. una app que corre en tu propio equipo) se cargan tal cual.
export function isLocalAddress(u) {
  const h = new URL(u).hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

export function proxify(u) {
  const url = new URL(u, location.href);
  if (!proxyOrigin || url.origin === location.origin || !/^https?:$/.test(url.protocol) || isLocalAddress(url.href)) return url.href;
  return `${proxyOrigin}/proxy?${token ? `t=${encodeURIComponent(token)}&` : ''}url=${encodeURIComponent(url.href)}`;
}

/** Dirección de la búsqueda del proxy. */
export function searchUrl(q) {
  return `${proxyOrigin}/search?${token ? `t=${encodeURIComponent(token)}&` : ''}q=${encodeURIComponent(q)}`;
}
