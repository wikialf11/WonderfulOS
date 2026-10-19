// Motor de fórmulas de Cálculo. Analizador descendente recursivo (sin eval).
// Soporta + - * / ^, comparaciones, referencias (A1), rangos (A1:B3) y funciones.

export class FormulaError extends Error {}
const ERRORS = new Set(['#ERROR!', '#VALOR!', '#DIV/0!', '#CICLO!', '#NOMBRE?']);
const err = (code) => { throw new FormulaError(code); };

export const colName = (i) => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = (name) => [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export const parseRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m && { col: colIndex(m[1]), row: Number(m[2]) - 1 }; };

const nums = (vals) => vals.flat().filter((v) => typeof v === 'number');
const FUNCTIONS = {
  SUMA: (...a) => nums(a).reduce((s, v) => s + v, 0),
  PROMEDIO: (...a) => { const n = nums(a); return n.length ? n.reduce((s, v) => s + v, 0) / n.length : err('#DIV/0!'); },
  MIN: (...a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
  MAX: (...a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
  CONTAR: (...a) => nums(a).length,
  REDONDEAR: (v, d = 0) => { const f = 10 ** toNum(d); return Math.round(toNum(v) * f) / f; },
  ABS: (v) => Math.abs(toNum(v)),
  SI: (c, a = true, b = false) => (truthy(c) ? a : b),
  CONCATENAR: (...a) => a.flat().map((v) => (v === null ? '' : String(v))).join(''),
};
// Alias en inglés para quien venga de otras hojas de cálculo.
Object.assign(FUNCTIONS, { SUM: FUNCTIONS.SUMA, AVERAGE: FUNCTIONS.PROMEDIO, COUNT: FUNCTIONS.CONTAR, ROUND: FUNCTIONS.REDONDEAR, IF: FUNCTIONS.SI, CONCAT: FUNCTIONS.CONCATENAR });

function toNum(v) {
  if (Array.isArray(v)) err('#VALOR!');
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (ERRORS.has(v)) err(v); // un error en una celda se propaga a quien la usa
  const n = Number(v);
  return Number.isNaN(n) ? err('#VALOR!') : n;
}
const truthy = (v) => (typeof v === 'string' ? v !== '' : toNum(v) !== 0);

function tokenize(src) {
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Z]+\d+:[A-Z]+\d+)|([A-Z]+\d+)|([A-ZÁÉÍÓÚÑ]+)(?=\()|("(?:[^"]|"")*")|(<=|>=|<>|[-+*/^(),;=<>&]))/giy;
  const tokens = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    if (!(m = re.exec(src))) { if (/^\s*$/.test(src.slice(start))) break; err('#ERROR!'); }
    if (m[1]) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) tokens.push({ t: 'range', v: m[2].toUpperCase() });
    else if (m[3]) tokens.push({ t: 'ref', v: m[3].toUpperCase() });
    else if (m[4]) tokens.push({ t: 'fn', v: m[4].toUpperCase() });
    else if (m[5]) tokens.push({ t: 'str', v: m[5].slice(1, -1).replace(/""/g, '"') });
    else if (m[6]) tokens.push({ t: 'op', v: m[6] });
  }
  return tokens;
}

/**
 * Crea un evaluador para un mapa de celdas { A1: 'texto o =fórmula' }.
 * value(ref) devuelve número, texto, booleano o un código de error ('#CICLO!').
 */
export function createEvaluator(cells) {
  const cache = new Map();
  const visiting = new Set();

  function value(ref) {
    if (cache.has(ref)) return cache.get(ref);
    if (visiting.has(ref)) err('#CICLO!');
    const raw = cells[ref];
    let v;
    if (raw === undefined || raw === '') v = null;
    else if (typeof raw === 'string' && raw.startsWith('=')) {
      visiting.add(ref);
      try { v = evaluate(raw.slice(1)); } finally { visiting.delete(ref); }
    } else if (!Number.isNaN(Number(raw)) && raw.trim() !== '') v = Number(raw);
    else v = raw;
    cache.set(ref, v);
    return v;
  }

  function range(a) {
    const [from, to] = a.split(':').map(parseRef);
    const out = [];
    for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++)
      for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++)
        out.push(value(colName(c) + (r + 1)));
    return out;
  }

  function evaluate(src) {
    const tk = tokenize(src);
    let i = 0;
    const peek = () => tk[i];
    const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
    const expect = (v) => (isOp(v) ? i++ : err('#ERROR!'));

    const comparison = () => {
      let l = concat();
      while (isOp('=', '<>', '<', '>', '<=', '>=')) {
        const op = tk[i++].v, r = concat();
        const a = typeof l === 'string' || typeof r === 'string' ? [String(l ?? ''), String(r ?? '')] : [toNum(l), toNum(r)];
        l = { '=': a[0] === a[1], '<>': a[0] !== a[1], '<': a[0] < a[1], '>': a[0] > a[1], '<=': a[0] <= a[1], '>=': a[0] >= a[1] }[op];
      }
      return l;
    };
    const concat = () => { let l = additive(); while (isOp('&')) { i++; l = String(l ?? '') + String(additive() ?? ''); } return l; };
    const additive = () => {
      let l = term();
      while (isOp('+', '-')) { const op = tk[i++].v; const r = term(); l = op === '+' ? toNum(l) + toNum(r) : toNum(l) - toNum(r); }
      return l;
    };
    const term = () => {
      let l = unary();
      while (isOp('*', '/')) {
        const op = tk[i++].v; const r = toNum(unary());
        if (op === '/' && r === 0) err('#DIV/0!');
        l = op === '*' ? toNum(l) * r : toNum(l) / r;
      }
      return l;
    };
    const unary = () => {
      if (isOp('-')) { i++; return -toNum(unary()); }
      if (isOp('+')) { i++; return toNum(unary()); }
      return power();
    };
    const power = () => { const b = primary(); if (isOp('^')) { i++; return toNum(b) ** toNum(unary()); } return b; };
    const primary = () => {
      const tok = tk[i++];
      if (!tok) err('#ERROR!');
      if (tok.t === 'num' || tok.t === 'str') return tok.v;
      if (tok.t === 'ref') return value(tok.v);
      if (tok.t === 'range') return range(tok.v);
      if (tok.t === 'fn') {
        const fn = FUNCTIONS[tok.v] || err('#NOMBRE?');
        expect('(');
        const args = [];
        if (!isOp(')')) { do { args.push(comparison()); } while (isOp(',', ';') && ++i); }
        expect(')');
        return fn(...args);
      }
      if (tok.t === 'op' && tok.v === '(') { const v = comparison(); expect(')'); return v; }
      return err('#ERROR!');
    };

    const result = comparison();
    if (i < tk.length) err('#ERROR!');
    if (Array.isArray(result)) err('#VALOR!');
    return result;
  }

  return {
    value(ref) {
      try { return value(ref); } catch (e) {
        if (e instanceof FormulaError) { cache.set(ref, e.message); return e.message; }
        throw e;
      }
    },
  };
}

export function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return String(v);
}
