// Pantalla de inicio de sesión / registro.
import { api } from './api.js';
import { ICONS } from './shell/icons.js';

export async function showLogin() {
  const box = document.getElementById('login');
  const form = box.querySelector('form');
  const error = form.querySelector('.error');
  const submit = form.querySelector('[type=submit]');
  const toggle = form.querySelector('.link');
  let registering = false;
  box.hidden = false;
  const invite = form.invite;
  box.querySelector('.logo').innerHTML = ICONS.logo;
  const cfg = await fetch('nubeos-config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
  const needsInvite = !!cfg.inviteRequired;

  toggle.onclick = () => {
    registering = !registering;
    submit.textContent = registering ? 'Crear cuenta' : 'Entrar';
    toggle.textContent = registering ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear una';
    form.password.autocomplete = registering ? 'new-password' : 'current-password';
    form.password.placeholder = registering ? 'Contraseña (mínimo 8 caracteres)' : 'Contraseña';
    invite.hidden = !(registering && needsInvite);
    invite.required = registering && needsInvite;
    error.hidden = true;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      await api(registering ? 'auth/register' : 'auth/login', {
        method: 'POST', body: { username: form.username.value, password: form.password.value, invite: invite.value.trim() },
      });
      location.reload();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  };
  form.username.focus();
}

export async function logout() {
  await api('auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

export const currentUser = () => api('auth/me').then((r) => r.user).catch(() => null);
