// En cada web: rellenar usuario y contraseña (cuando WonderfulOS lo pide) y avisar al iniciar sesión.
function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
function setValue(el, v) {
  if (!el || v == null) return;
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function userFieldFor(pass) {
  const scope = pass?.form || document;
  const fields = [...scope.querySelectorAll('input[type=email], input[type=text], input[type=tel], input:not([type])')].filter(visible);
  return fields.filter((f) => !pass || (f.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING)).pop() || fields[0] || null;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'fill') return;
  const pass = [...document.querySelectorAll('input[type=password]')].find(visible) || null;
  // Muchos inicios de sesión piden primero el usuario y luego, en otra pantalla, la contraseña.
  setValue(userFieldFor(pass), msg.user);
  setValue(pass, msg.pass);
});
// Al enviar un formulario con contraseña, WonderfulOS ofrece guardarla en el Llavero.
let lastUser = '';
document.addEventListener('input', (e) => { if (e.target.matches?.('input[type=email], input[type=text], input:not([type])')) lastUser = e.target.value; }, true);
function report(pass) {
  if (!pass?.value) return;
  chrome.runtime.sendMessage({ type: 'login', url: location.href, user: userFieldFor(pass)?.value || lastUser, pass: pass.value }).catch(() => {});
}
document.addEventListener('submit', (e) => report(e.target.querySelector?.('input[type=password]')), true);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('input[type=password]')) report(e.target); }, true);
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('button, input[type=submit], [role=button]');
  const pass = btn && [...document.querySelectorAll('input[type=password]')].find((p) => p.value && visible(p));
  if (pass) report(pass);
}, true);
