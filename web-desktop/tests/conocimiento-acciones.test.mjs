import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Este fichero se ejecuta en su propio proceso: usamos un perfil temporal para
// probar las acciones sin tocar los datos reales del usuario.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubeos-acciones-'));
process.env.NUBEOS_DATA = dataDir;

const { consultarConHerramientas } = await import('../server/conocimiento.mjs');
const store = await import('../server/store.mjs');

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('conocimiento: crea una nota local', async () => {
  const r = await consultarConHerramientas('Crea una nota con comprar pan y revisar el correo');
  assert.equal(r.tipo, 'accion');
  assert.equal(r.modelo, false);
  assert.equal(r.acciones[0].ok, true);
  assert.equal(r.acciones[0].accion, 'crear_nota');
  assert.match(r.respuesta, /Nota creada/);
});

test('conocimiento: crea una lista de tareas con varios elementos', async () => {
  const r = await consultarConHerramientas('Crea una lista de tareas para el proyecto con revisar el correo, preparar el informe y llamar a Ana');
  assert.equal(r.tipo, 'accion');
  assert.equal(r.acciones[0].ok, true);
  assert.equal(r.acciones[0].accion, 'crear_lista_tareas');
  assert.equal(r.acciones[0].numTareas, 3);
});

test('conocimiento: crea un documento con título y contenido', async () => {
  const r = await consultarConHerramientas('Crea un documento de bienvenida con las características de WonderfulOS');
  assert.equal(r.tipo, 'accion');
  assert.equal(r.acciones[0].ok, true);
  assert.equal(r.acciones[0].ruta, '/Documentos/bienvenida.md');

  const arbol = store.tree(store.USER);
  assert.ok(arbol['/Documentos/bienvenida.md']);
  assert.match(arbol['/Documentos/bienvenida.md'].content, /^# Bienvenida/m);
  assert.match(arbol['/Documentos/bienvenida.md'].content, /características de WonderfulOS/);
});
