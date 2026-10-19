// Puente entre este Chromium y WonderfulOS (server/browser.mjs): cuenta en qué web estás,
// rellena usuario y contraseña cuando lo pides desde el Llavero y avisa de inicios de sesión.
let cfg = null;
const config = async () => (cfg ??= await (await fetch(chrome.runtime.getURL('config.json'))).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(event) {
  const c = await config();
  try {
    await fetch(`${c.server}/api/browser/ext/event?t=${encodeURIComponent(c.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
    });
  } catch { /* WonderfulOS no responde: se reintenta con el siguiente evento */ }
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
async function reportPage() {
  const t = await activeTab();
  if (t?.url) send({ type: 'url', url: t.url, title: t.title || '' });
}
chrome.tabs.onActivated.addListener(reportPage);
chrome.tabs.onUpdated.addListener((id, change, tab) => { if (tab.active && (change.url || change.status === 'complete')) reportPage(); });
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'login' && msg.pass) send({ type: 'login', url: sender.tab?.url || msg.url, user: msg.user || '', pass: msg.pass });
});

// Órdenes de WonderfulOS (esperas largas): «rellena este usuario y contraseña».
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  const c = await config();
  for (;;) {
    try {
      const res = await fetch(`${c.server}/api/browser/ext/poll?t=${encodeURIComponent(c.token)}`);
      if (!res.ok) { await sleep(3000); continue; }
      for (const cmd of await res.json()) {
        const t = await activeTab();
        if (cmd.type === 'fill' && t?.id) chrome.tabs.sendMessage(t.id, cmd).catch(() => {});
      }
    } catch { await sleep(3000); }
  }
}
chrome.alarms.create('nubeos', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { poll(); reportPage(); });
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
poll();
