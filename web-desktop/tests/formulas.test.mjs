import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluator, colName, colIndex } from '../js/apps/formulas.js';

const ev = (cells) => createEvaluator(cells);

test('columnas', () => {
  assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(26), 'AA');
  assert.equal(colIndex('AA'), 26);
});
test('aritmética y precedencia', () => {
  assert.equal(ev({ A1: '=1+2*3^2' }).value('A1'), 19);
  assert.equal(ev({ A1: '=(1+2)*-3' }).value('A1'), -9);
});
test('referencias y funciones', () => {
  const e = ev({ A1: '2', A2: '3', A3: 'texto', A4: '=SUMA(A1:A3)', A5: '=promedio(A1;A2)', A6: '=SI(A4>4;"alto";"bajo")', A7: '=MAX(A1:A2)*2' });
  assert.equal(e.value('A4'), 5);
  assert.equal(e.value('A5'), 2.5);
  assert.equal(e.value('A6'), 'alto');
  assert.equal(e.value('A7'), 6);
});
test('errores', () => {
  assert.equal(ev({ A1: '=1/0' }).value('A1'), '#DIV/0!');
  const c = ev({ A1: '=B1', B1: '=A1' });
  assert.equal(c.value('A1'), '#CICLO!');
  assert.equal(ev({ A1: '=NOEXISTE(1)' }).value('A1'), '#NOMBRE?');
  assert.equal(ev({ A1: '=1+', }).value('A1'), '#ERROR!');
  assert.equal(ev({ A1: '=1/0', A2: '=A1+1' }).value('A2'), '#DIV/0!');
});
