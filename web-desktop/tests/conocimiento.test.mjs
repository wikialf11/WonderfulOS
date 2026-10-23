import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../server/conocimiento.mjs';

function motorDePrueba({ mcr = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubeos-conocimiento-'));
  const engine = createEngine({ dataDir: dir, usarMcr: mcr });
  return { dir, engine };
}

function limpiar(t, dir) {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('conocimiento: define el verde con su género y sus relaciones', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('¿Qué es el verde?');
  assert.equal(r.tipo, 'definir');
  assert.equal(r.modelo, false);
  assert.match(r.respuesta, /color de la vegetación/);
  assert.match(r.respuesta, /Es un color/);
  assert.match(r.respuesta, /Se asocia con: vegetación/);
  assert.match(r.respuesta, /Por inferencia: es una cualidad/);
});

test('conocimiento: deduce transitividad de es_un y explica la regla', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('¿El verde es una cualidad?');
  assert.equal(r.tipo, 'es_un');
  assert.match(r.respuesta, /Sí/);
  assert.match(r.respuesta, /transitividad_es_un/);
  assert.match(r.respuesta, /es_un\(color, cualidad\)/);
});

test('conocimiento: encuentra un camino entre conceptos', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('¿Qué relación hay entre verde y vegetación?');
  assert.equal(r.tipo, 'camino');
  assert.match(r.respuesta, /verde —asociado_con→ vegetación/);

  const r2 = engine.consultar('Relación entre hoja y vegetación');
  assert.equal(r2.tipo, 'camino');
  assert.match(r2.respuesta, /hoja —parte_de→ vegetación/);
});

test('conocimiento: genera un correo formal con plantilla y placeholders', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar(
    'Redacta un correo formal al Ayuntamiento de La Laguna para solicitar un certificado de residencia. '
    + 'Usa placeholders para mis datos y un tono cordial y administrativo.',
  );
  assert.equal(r.tipo, 'correo');
  assert.match(r.respuesta, /Asunto: Solicitud de certificado de residencia/);
  assert.match(r.respuesta, /A la atención del Ayuntamiento de La Laguna:/);
  assert.match(r.respuesta, /solicitar un certificado de residencia/);
  assert.match(r.respuesta, /\[Nombre y apellidos\]/);
  assert.match(r.respuesta, /\[DNI\]/);
  assert.ok(r.avisos.some((a) => /modelo de IA/.test(a)));
});

test('conocimiento: conserva el artículo de una petición en el correo', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar(
    'Redacta un correo a la Universidad de La Laguna para solicitar una beca.',
  );
  assert.equal(r.tipo, 'correo');
  assert.match(r.respuesta, /Asunto: Solicitud de beca/);
  assert.match(r.respuesta, /A la atención de la Universidad de La Laguna:/);
  assert.match(r.respuesta, /solicitar una beca/);
});

test('conocimiento: genera un plan semanal con descanso y cuidado', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar(
    'Hazme un plan semanal realista para una persona autónoma que trabaja desde casa y cuida de un familiar mayor. '
    + 'Incluye trabajo profundo, administración, comidas, pausas y tiempo de cuidado.',
  );
  assert.equal(r.tipo, 'plan');
  assert.match(r.respuesta, /\*\*Lunes\*\*/);
  assert.match(r.respuesta, /Trabajo profundo/);
  assert.match(r.respuesta, /Cuidado del familiar/);
  assert.match(r.respuesta, /Comida/);
  assert.match(r.respuesta, /Descanso/);
});

test('conocimiento: distingue un plan de fin de semana', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('Hazme un plan para el fin de semana.');
  assert.equal(r.tipo, 'plan');
  assert.match(r.respuesta, /\*\*Plan de fin de semana\*\*/);
  assert.match(r.respuesta, /\*\*Sábado\*\*/);
  assert.match(r.respuesta, /\*\*Domingo\*\*/);
  assert.doesNotMatch(r.respuesta, /\*\*Lunes\*\*/);
});

test('conocimiento: redacta un texto expositivo con fuentes', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('Explica la vegetación.');
  assert.equal(r.tipo, 'texto');
  assert.match(r.respuesta, /\*\*Introducción\*\*/);
  assert.match(r.respuesta, /\*\*Desarrollo\*\*/);
  assert.match(r.respuesta, /\*\*Conclusión\*\*/);
  assert.match(r.respuesta, /El concepto de \*\*vegetación\*\*/);
  assert.match(r.respuesta, /Texto de ejemplo de WonderfulOS/);
  assert.match(r.respuesta, /\*\*Fuentes\*\*/);
  assert.ok(r.fuentes.includes('Texto de ejemplo de WonderfulOS'));
});

test('conocimiento: busca fragmentos del diccionario y de los textos', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const r = engine.consultar('Busca información sobre fotosíntesis');
  assert.equal(r.tipo, 'buscar');
  assert.match(r.respuesta, /fotosíntesis/i);
  assert.ok(r.fuentes.some((f) => /Texto de ejemplo/.test(f)));
  assert.ok(r.avisos.some((a) => /no se ha consultado internet/.test(a)));
});

test('conocimiento: enseña un concepto, lo persiste y lo consulta', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  const alta = engine.ensenar({
    tipo: 'concepto',
    lema: 'fotosíntesis artificial',
    definicion: 'proceso técnico que imita la fotosíntesis natural',
    genero: 'proceso',
    diferencia: 'que se realiza con materiales artificiales',
    fuente: 'Prueba',
  });
  assert.equal(alta.ok, true);
  assert.equal(alta.concepto.origen, 'usuario');

  const r = engine.consultar('¿Qué es la fotosíntesis artificial?');
  assert.match(r.respuesta, /proceso técnico que imita la fotosíntesis natural/);

  const otro = createEngine({ dataDir: dir, usarMcr: false });
  const r2 = otro.consultar('¿Qué es la fotosíntesis artificial?');
  assert.match(r2.respuesta, /proceso técnico que imita/);
});

test('conocimiento: detecta una contradicción enseñada', (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);

  engine.ensenar({
    tipo: 'concepto',
    lema: 'triángulo',
    definicion: 'figura plana de tres lados',
    genero: 'figura',
  });
  engine.ensenar({
    tipo: 'relacion',
    origen: 'triángulo',
    predicado: 'no_es_un',
    destino: 'figura',
  });

  assert.ok(engine.estadisticas().contradicciones >= 1);
});

test('conocimiento: consulta noticias web y cita fuentes sin modelo', async (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);
  const fetchOriginal = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url) => {
    llamadas.push(String(url));
    if (String(url).includes('news.google.com/rss')) {
      return {
        ok: true,
        text: async () => `<rss><channel><item>
          <title>Noticia de prueba</title>
          <link>https://example.com/noticia</link>
          <pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<a href="https://example.com/noticia">Resumen de la noticia</a>]]></description>
          <source>Medio de prueba</source>
        </item></channel></rss>`,
      };
    }
    return {
      ok: true,
      text: async () => '<html><head><title>Página de prueba</title></head><body><p>La inteligencia artificial es el tema de esta noticia de prueba.</p></body></html>',
    };
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });

  const r = await engine.consultarConHerramientas('Busca en internet las noticias de hoy sobre inteligencia artificial');
  assert.equal(r.tipo, 'noticias');
  assert.equal(r.modelo, false);
  assert.ok(llamadas.some((u) => u.includes('news.google.com/rss')));
  assert.match(r.respuesta, /Noticia de prueba/);
  assert.ok(r.fuentes.some((f) => f.includes('https://example.com/noticia')));
});

test('conocimiento: lee una URL y no consulta internet para preguntas locales', async (t) => {
  const { dir, engine } = motorDePrueba();
  limpiar(t, dir);
  const fetchOriginal = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas += 1;
    return {
      ok: true,
      text: async () => '<html><head><title>Documento web</title></head><body><p>Contenido de prueba suficientemente largo para el resumen extractivo.</p></body></html>',
    };
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });

  const local = await engine.consultarConHerramientas('¿Qué es el verde?');
  assert.equal(local.tipo, 'definir');
  assert.equal(llamadas, 0);

  const web = await engine.consultarConHerramientas('Lee https://example.com/documento');
  assert.equal(web.tipo, 'leer_url');
  assert.match(web.respuesta, /Documento web/);
  assert.equal(web.modelo, false);
});

test('conocimiento: carga el diccionario abierto MCR', (t) => {
  const { dir, engine } = motorDePrueba({ mcr: true });
  limpiar(t, dir);

  const stats = engine.estadisticas();
  assert.ok(stats.mcr > 18000);
  assert.equal(stats.mcrCargado, true);

  const r = engine.consultar('¿Qué es la flora?');
  assert.match(r.respuesta, /MCR 2\.0/);
  assert.match(r.respuesta, /vegetación/i);
});
