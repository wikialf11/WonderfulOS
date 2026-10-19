// Cobro de los planes de almacenamiento con Stripe (suscripción mensual).
//
// Dos formas de cobrar, según lo que esté configurado:
//  - Enlaces de pago (server/stripe-links.json o NUBEOS_STRIPE_LINKS): los crea el
//    propietario en el panel de Stripe; WonderfulOS solo necesita el secreto del webhook.
//  - Stripe Checkout (STRIPE_SECRET_KEY): WonderfulOS crea cada sesión de pago por API.
//
// webhook(): Stripe avisa cuando el pago se confirma (→ se amplía el espacio del
// usuario) y cuando la suscripción termina (→ vuelve al plan Gratis; sus archivos
// se conservan, pero no podrá subir más hasta liberar espacio).
//
// Variables: STRIPE_WEBHOOK_SECRET (whsec_…) y además enlaces o STRIPE_SECRET_KEY.
// Opcional: NUBEOS_STRIPE_PORTAL = enlace del portal de clientes (para darse de baja).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PLANS, DEFAULT_PLAN } from './plans.mjs';
import * as store from './store.mjs';
import { provision, deprovision, provisioningMode } from './provision.mjs';

const KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PORTAL = process.env.NUBEOS_STRIPE_PORTAL;
const LINKS = (() => {
  try { if (process.env.NUBEOS_STRIPE_LINKS) return JSON.parse(process.env.NUBEOS_STRIPE_LINKS); } catch { /* sigue */ }
  try { return JSON.parse(readFileSync(new URL('./stripe-links.json', import.meta.url), 'utf8')); } catch { return {}; }
})();

const err = (status, message) => Object.assign(new Error(message), { status });
const paid = (id) => PLANS[id] && PLANS[id].price > 0;
// Nunca se cobra dinero real por un ordenador si después no se va a comprar de verdad.
const canSell = (id) => paid(id) && !!WEBHOOK_SECRET && (!!KEY || !!LINKS[id]) && !(PLANS[id].vps && paymentsLive() && provisioningMode() !== 'live');

export const paymentsLive = () => (KEY ? KEY.startsWith('sk_live_') : Object.values(LINKS).some((u) => !/\/test_/.test(u)));
export const sellingEnabled = () => Object.keys(PLANS).some(canSell);

export function plans() {
  return Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, quota: p.quota, price: p.price, specs: p.specs || '', machine: !!p.vps, popular: !!p.popular, available: id === DEFAULT_PLAN || canSell(id) }));
}

async function stripe(method, path, params) {
  if (!KEY) throw err(503, 'Los pagos aún no están activados');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw err(502, data.error?.message || 'Error de Stripe');
  return data;
}

// Referencia que viaja en el pago: plan + usuario (en hexadecimal, porque Stripe
// solo admite letras, números, guiones y guiones bajos).
const reference = (plan, user) => `${plan}-${Buffer.from(user).toString('hex')}`;
function parseReference(ref) {
  const m = /^([a-z]+)-([0-9a-f]+)$/.exec(ref || '');
  return m ? { plan: m[1], user: Buffer.from(m[2], 'hex').toString() } : null;
}

export async function checkout(user, plan, origin) {
  if (!paid(plan)) throw err(400, 'Plan no válido');
  if (!canSell(plan)) throw err(503, 'Este plan estará disponible muy pronto');
  if (store.subscriptionOf(user)) throw err(409, 'Ya tienes un plan de pago. Para cambiarlo, date de baja primero desde Ajustes.');
  if (!KEY) return `${LINKS[plan]}?client_reference_id=${reference(plan, user)}`;
  const def = PLANS[plan];
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(def.price),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': `WonderfulOS ${def.name}${def.specs ? ` (ordenador propio: ${def.specs})` : ''}`,
    client_reference_id: reference(plan, user),
    success_url: `${origin}/?pago=ok`,
    cancel_url: `${origin}/?pago=cancelado`,
  });
  return session.url;
}

export async function cancel(user) {
  const sub = store.subscriptionOf(user);
  if (!sub) throw err(404, 'No tienes ninguna suscripción activa');
  if (!KEY) {
    if (PORTAL) return PORTAL;
    throw err(503, 'Para darte de baja, escríbenos y lo hacemos al momento');
  }
  // Se mantiene hasta el final del mes pagado; entonces Stripe avisa y vuelve a Gratis.
  await stripe('POST', `subscriptions/${sub}`, { cancel_at_period_end: 'true' });
  return null;
}

// Firma de Stripe: cabecera "t=…,v1=…" con HMAC-SHA256 de "t.cuerpo".
function verify(raw, header) {
  if (!WEBHOOK_SECRET) return false;
  const items = String(header || '').split(',').map((kv) => kv.split('='));
  const t = items.find(([k]) => k === 't')?.[1];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex'));
  return items.filter(([k]) => k === 'v1').some(([, v]) => {
    const got = Buffer.from(v || '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export async function webhook(raw, signature) {
  if (!verify(raw, signature)) throw err(400, 'Firma no válida');
  const event = JSON.parse(raw);
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.payment_status === 'paid') {
    const ref = parseReference(obj.client_reference_id);
    const def = ref && PLANS[ref.plan];
    // El importe pagado tiene que ser el del plan: así nadie paga uno barato y pide uno caro.
    if (!def || !paid(ref.plan) || obj.currency !== 'eur' || obj.amount_total < def.price) {
      console.error('[pagos] pago sin plan válido o con importe incorrecto:', obj.id, obj.client_reference_id, obj.amount_total);
      return;
    }
    if (store.setPlan(ref.user, ref.plan, { stripeSubscription: obj.subscription, stripeCustomer: obj.customer })) {
      console.log(`[pagos] ${ref.user} ahora tiene el plan ${def.name}`);
      // Plan con ordenador propio: se compra y se prepara (tarda unos minutos; Stripe no espera).
      if (def.vps) provision(ref.user, ref.plan, { stripeSubscription: obj.subscription, stripeCustomer: obj.customer }).catch((e) => console.error('[ordenadores]', e));
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    const user = store.userBySubscription(obj.id);
    if (user) { store.setPlan(user, DEFAULT_PLAN); deprovision(user).catch((e) => console.error('[ordenadores]', e)); console.log(`[pagos] ${user} vuelve al plan Gratis`); }
  }
}
