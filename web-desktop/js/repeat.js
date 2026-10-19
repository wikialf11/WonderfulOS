// Repeticiones compartidas por Listas y Recordatorios: { unit: day|week|month|year, n }.
export const REPEATS = [['', 'No se repite'], ['1d', 'Cada día'], ['1w', 'Cada semana'], ['2w', 'Cada 2 semanas'], ['1m', 'Cada mes'], ['1y', 'Cada año'], ['n', 'Cada N días…']];
const UNITS = { d: 'day', w: 'week', m: 'month', y: 'year' };

/** Valor del selector → repetición (para «Cada N días» hace falta preguntar N). */
export async function parseRepeat(value, askN) {
  if (!value) return null;
  if (value === 'n') {
    const n = parseInt(await askN(), 10);
    return n > 0 ? { unit: 'day', n } : null;
  }
  return { unit: UNITS[value.slice(-1)], n: parseInt(value, 10) };
}

function step(d, r) {
  const n = r.n || 1;
  if (r.unit === 'day') d.setDate(d.getDate() + n);
  else if (r.unit === 'week') d.setDate(d.getDate() + 7 * n);
  else if (r.unit === 'month') d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
}
/** Siguiente fecha (siempre en el futuro). Sin fecha previa, cuenta desde ahora. */
export function nextDate(iso, r) {
  const d = new Date(iso || Date.now());
  step(d, r);
  while (d < Date.now()) step(d, r);
  return d.toISOString();
}

export function repeatText(r) {
  if (!r) return '';
  const n = r.n || 1;
  const [one, many] = { day: ['Cada día', 'días'], week: ['Cada semana', 'semanas'], month: ['Cada mes', 'meses'], year: ['Cada año', 'años'] }[r.unit] || ['', ''];
  return n === 1 ? one : `Cada ${n} ${many}`;
}

/** Selector compacto «Fecha» + «Repetir» para formularios de añadir. */
export function whenControls(GLYPHS) {
  return `<label class="chip-field" title="Fecha (opcional)">${GLYPHS.clock}<input type="datetime-local" class="due"><button type="button" class="clear" title="Sin fecha">×</button></label>
    <label class="chip-field" title="Repetir">${GLYPHS.repeat}<select class="repeat">${REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`;
}
export function wireWhen(form) {
  const due = form.querySelector('.due');
  const sync = () => form.querySelectorAll('.chip-field').forEach((f) => f.classList.toggle('set', !!f.querySelector('input, select').value));
  form.querySelector('.clear').onclick = (e) => { e.preventDefault(); e.stopPropagation(); due.value = ''; sync(); };
  // Sin fecha, el campo es solo un icono: al tocarlo se abre el selector.
  due.closest('.chip-field').addEventListener('click', (e) => { if (!e.target.closest('.clear')) try { due.showPicker(); } catch { due.focus(); } });
  form.querySelectorAll('.due, .repeat').forEach((el) => { el.onchange = sync; });
  sync();
  return sync;
}
