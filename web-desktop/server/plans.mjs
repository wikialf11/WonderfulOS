// Planes de WonderfulOS: solo cambian el espacio en la nube para tus archivos.
// WonderfulOS se instala en el ordenador del usuario y usa su potencia; los planes añaden
// espacio para guardar y sincronizar archivos (y usarlos desde cualquier dispositivo).
// price en céntimos de euro al mes.

const GB = 1024 ** 3;

export const PLANS = {
  gratis: { name: 'Gratis', quota: 5 * GB, price: 0 },
  personal: { name: 'Personal', quota: 100 * GB, price: 199 },
  plus: { name: 'Plus', quota: 500 * GB, price: 499, popular: true },
  pro: { name: 'Pro', quota: 2048 * GB, price: 999 },
};
export const DEFAULT_PLAN = 'gratis';
export const planOf = (id) => PLANS[id] || PLANS[DEFAULT_PLAN];
