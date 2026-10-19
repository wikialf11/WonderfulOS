// Un ordenador por usuario: cuando alguien paga un plan, se compra un VPS solo para
// él en Hostinger y se prepara con el agente de WonderfulOS (LibreOffice, el Navegador y
// las apps de Linux que instale). Cuando se da de baja, el VPS deja de renovarse.
// Si nadie paga, no hay ningún VPS ni ningún coste.
//
// Seguridad del dinero:
//  - NUBEOS_PROVISION=live compra de verdad. Cualquier otro valor simula: registra lo
//    que compraría y usa los servicios de este mismo servidor (para probar en local).
//  - NUBEOS_MAX_VPS limita cuántos VPS puede haber comprados a la vez (5).
//  - Solo se compra después de que Stripe confirme el pago (billing.mjs).
//
// Variables: HOSTINGER_API_TOKEN, NUBEOS_PROVISION, NUBEOS_MAX_VPS,
// NUBEOS_VPS_TEMPLATE_ID, NUBEOS_VPS_DATACENTER_ID, NUBEOS_VPS_SCRIPT_ID, NUBEOS_PUBLIC_ORIGIN.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { DATA } from './store.mjs';
import { PLANS } from './plans.mjs';

const API = 'https://developers.hostinger.com';
const TOKEN = process.env.HOSTINGER_API_TOKEN;
const LIVE = process.env.NUBEOS_PROVISION === 'live';
const MAX_VPS = Number(process.env.NUBEOS_MAX_VPS || 5);
export const PUBLIC_ORIGIN = process.env.NUBEOS_PUBLIC_ORIGIN || 'https://nubeos.criaturasdelcolor.com';

const VPS = (() => { try { return JSON.parse(readFileSync(new URL('./vps-config.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const TEMPLATE_ID = Number(process.env.NUBEOS_VPS_TEMPLATE_ID || VPS.templateId);
const DATACENTER_ID = Number(process.env.NUBEOS_VPS_DATACENTER_ID || VPS.dataCenterId);
const SCRIPT_ID = Number(process.env.NUBEOS_VPS_SCRIPT_ID || VPS.postInstallScriptId) || undefined;

const FILE = path.join(DATA, 'machines.json');
const machines = (() => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } })();
const meta = machines.__meta || (machines.__meta = {});
function save() { writeFileSync(`${FILE}.tmp`, JSON.stringify(machines, null, 1)); renameSync(`${FILE}.tmp`, FILE); }
const log = (user, msg) => console.log(`[ordenadores] ${user}: ${msg}`);
const users = () => Object.keys(machines).filter((u) => u !== '__meta');
const ACTIVE = ['comprando', 'instalando', 'lista'];

export const provisioningMode = () => (LIVE ? 'live' : 'simulado');

/** Lo que el usuario puede ver de su ordenador (sin secretos). */
export function machineOf(user) {
  const m = machines[user];
  if (!m || user === '__meta') return null;
  const { agentSecret, bootstrapCode, ...visible } = m;
  return { ...visible, planName: PLANS[m.plan]?.name, specs: PLANS[m.plan]?.specs, simulated: !!m.simulated };
}
/** Ordenador listo del usuario (o null). */
export const readyMachine = (user) => (machines[user]?.state === 'lista' ? machines[user] : null);
/** Dónde corren la oficina y el navegador de este usuario: 'remoto' (su VPS), 'local'
 *  (este mismo servidor: simulación o pruebas con NUBEOS_DEV_ALL_MACHINES=1) o null (plan Gratis). */
export function machineMode(user) {
  const m = readyMachine(user);
  if (m && !m.simulated && m.host) return 'remoto';
  if (m?.simulated || process.env.NUBEOS_DEV_ALL_MACHINES === '1') return 'local';
  return null;
}
export const machineHost = (user) => readyMachine(user)?.host || null;

async function hostinger(method, p, body) {
  if (!TOKEN) throw new Error('Falta HOSTINGER_API_TOKEN');
  const res = await fetch(API + p, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Hostinger ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stripe confirmó el pago de un plan con ordenador: se compra y se prepara. */
export async function provision(user, plan, stripe = {}) {
  const def = PLANS[plan];
  if (!def?.vps) throw new Error(`El plan ${plan} no lleva ordenador`);
  const current = machines[user];
  if (current && ACTIVE.includes(current.state)) {
    // Cambio de plan: se apunta, pero no se compra un segundo ordenador.
    Object.assign(current, { plan, ...stripe });
    log(user, `ya tiene ordenador (${current.state}); plan cambiado a ${plan}`);
    return save();
  }
  const active = users().filter((u) => ACTIVE.includes(machines[u].state) && !machines[u].simulated).length;
  machines[user] = { plan, state: 'comprando', created: Date.now(), ...stripe };
  save();

  if (!LIVE) {
    // Simulación: el «ordenador» son los servicios de este mismo servidor (LibreOffice
    // y el Navegador locales). Sirve para probar todo sin comprar nada.
    log(user, `SIMULADO: compraría ${def.vps} para el plan ${def.name}`);
    Object.assign(machines[user], { state: 'lista', simulated: true, ready: Date.now() });
    return save();
  }
  if (active >= MAX_VPS) {
    Object.assign(machines[user], { state: 'en espera', error: `Límite de ${MAX_VPS} ordenadores alcanzado (NUBEOS_MAX_VPS)` });
    return save();
  }
  try {
    // 1) Comprar el VPS con el método de pago de la cuenta de Hostinger.
    const before = new Set((await hostinger('GET', '/api/vps/v1/virtual-machines')).map((v) => v.id));
    const order = await hostinger('POST', '/api/billing/v1/orders', { items: [{ item_id: def.vps, quantity: 1 }] });
    Object.assign(machines[user], { order: order.id ?? order.order_id ?? null, subscriptionId: order.subscription_id ?? null });
    save();
    // 2) Esperar a que aparezca la máquina nueva.
    let vm;
    for (let i = 0; i < 60 && !vm; i++) {
      await sleep(10000);
      vm = (await hostinger('GET', '/api/vps/v1/virtual-machines')).find((v) => !before.has(v.id) && v.state === 'initial');
    }
    if (!vm) throw new Error('El VPS comprado no apareció a tiempo');
    // 3) Instalar Ubuntu + el agente. El nombre lleva un código de un solo uso (agent/install.sh).
    const code = randomBytes(12).toString('hex');
    Object.assign(machines[user], { state: 'instalando', vmId: vm.id, subscriptionId: vm.subscription_id ?? machines[user].subscriptionId, bootstrapCode: code });
    save();
    await hostinger('POST', `/api/vps/v1/virtual-machines/${vm.id}/setup`, {
      template_id: TEMPLATE_ID, data_center_id: DATACENTER_ID, post_install_script_id: await installScriptId(),
      hostname: `nubeos-${code}`, enable_backups: false,
    });
    // 4) Esperar a que arranque. Queda «lista» cuando el agente avisa.
    for (let i = 0; i < 90; i++) {
      await sleep(10000);
      const info = await hostinger('GET', `/api/vps/v1/virtual-machines/${vm.id}`);
      if (info.state === 'running') { machines[user].ip = info.ipv4?.[0]?.address || null; log(user, `VPS en marcha (${machines[user].ip})`); return save(); }
    }
    throw new Error('El VPS no terminó de arrancar');
  } catch (err) {
    log(user, `error: ${err.message}`);
    Object.assign(machines[user], { state: 'error', error: err.message });
    save();
  }
}

/** Fin de la suscripción: el VPS deja de renovarse y se apaga al acabar el mes pagado. */
export async function deprovision(user) {
  const m = machines[user];
  if (!m) return;
  if (LIVE && m.subscriptionId) {
    try { await hostinger('PATCH', `/api/billing/v1/subscriptions/${m.subscriptionId}/auto-renewal/disable`); }
    catch (err) { log(user, `no se pudo desactivar la renovación: ${err.message}`); Object.assign(m, { state: 'baja pendiente', error: err.message }); return save(); }
  }
  log(user, `${LIVE && !m.simulated ? '' : 'SIMULADO: '}ordenador sin renovación`);
  Object.assign(m, { state: 'cancelada', cancelled: Date.now() });
  save();
}

// Script post-instalación de Hostinger: descarga y ejecuta agent/install.sh.
async function installScriptId() {
  if (SCRIPT_ID) return SCRIPT_ID;
  if (meta.scriptId) return meta.scriptId;
  const created = await hostinger('POST', '/api/vps/v1/post-install-scripts', {
    name: 'nubeos-ordenador', content: `#!/bin/bash\ncurl -fsSL ${PUBLIC_ORIGIN}/agent/install.sh | bash\n`,
  });
  meta.scriptId = created.id;
  save();
  return created.id;
}

// ---------- Agente del ordenador ----------
/** El agente de un ordenador nuevo se registra con su código de un solo uso. */
export function registerAgent(code, ip) {
  const user = users().find((u) => machines[u].bootstrapCode && machines[u].bootstrapCode === code);
  const m = user && machines[user];
  if (!m || m.agentSecret) return null;
  m.agentSecret = randomBytes(32).toString('hex');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip || '')) m.ip = m.ip || ip;
  m.host = `${(m.ip || ip).replace(/\./g, '-')}.sslip.io`;
  save();
  log(user, `agente registrado en ${m.host}`);
  return { secret: m.agentSecret, user, plan: m.plan, origin: PUBLIC_ORIGIN, host: m.host, ip: m.ip };
}
export function agentReady(code) {
  const user = users().find((u) => machines[u].bootstrapCode === code);
  if (!user || !machines[user].agentSecret) return false;
  Object.assign(machines[user], { state: 'lista', bootstrapCode: null, ready: Date.now() });
  save();
  log(user, 'ordenador listo');
  return true;
}
/** Llamada del servidor central al agente del usuario (firmada con el secreto del ordenador). */
export async function agentCall(user, p, body) {
  const m = readyMachine(user);
  if (!m?.host || !m.agentSecret) throw Object.assign(new Error('Tu ordenador todavía no está listo'), { status: 409 });
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + 60e3 })).toString('base64url');
  const token = `${payload}.${createHmac('sha256', m.agentSecret).update(payload).digest('base64url')}`;
  const res = await fetch(`https://${m.host}/agent${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Tu ordenador respondió ${res.status}`), { status: 502 });
  return data;
}
/** El agente firma lo que manda al servidor central (p. ej. subir una descarga). */
export function verifyAgent(user, signature, payload) {
  const m = machines[user];
  if (!m?.agentSecret) return false;
  const good = Buffer.from(createHmac('sha256', m.agentSecret).update(payload).digest('hex'));
  const got = Buffer.from(String(signature || ''));
  return good.length === got.length && timingSafeEqual(good, got);
}

export const userBySubscription = (sub) => users().find((u) => sub && machines[u].stripeSubscription === sub) || null;

// Comprobación al arrancar (solo lectura): ¿el token de Hostinger funciona?
let providerStatus = TOKEN ? 'comprobando' : 'sin token';
if (TOKEN) hostinger('GET', '/api/vps/v1/virtual-machines').then((l) => { providerStatus = `ok (${l.length} VPS)`; }).catch((e) => { providerStatus = `error: ${e.message}`; });
export const providerState = () => providerStatus;
