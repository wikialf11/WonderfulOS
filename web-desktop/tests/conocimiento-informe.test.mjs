import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Este fichero se ejecuta en su propio proceso y usa un perfil temporal.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubeos-informe-'));
process.env.NUBEOS_DATA = dataDir;

const { consultar, consultarConHerramientas, ensenar } = await import('../server/conocimiento.mjs');
const store = await import('../server/store.mjs');

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function respuestaHtml(texto) {
  return { ok: true, text: async () => texto };
}

const htmlBusqueda = `
<div class="result results_links"><a class="result__a" href="https://fuente-a.example/articulo">Fuente A: fotosíntesis</a><div class="snippet">La fotosíntesis es un proceso bioquímico fundamental para la vida.</div></div></div>
<div class="result results_links"><a class="result__a" href="https://fuente-b.example/articulo">Fuente B: fotosíntesis</a><div class="snippet">Las plantas utilizan la luz solar para producir energía química.</div></div></div>
<div class="result results_links"><a class="result__a" href="https://fuente-c.example/articulo">Fuente C: fotosíntesis</a><div class="snippet">La fotosíntesis produce oxígeno y materia orgánica.</div></div></div>
`;

const paginas = {
  'https://fuente-a.example/articulo': `<html><head><title>Fuente A</title></head><body>
    <p>La fotos&iacute;ntesis es un proceso bioqu&iacute;mico mediante el cual las plantas convierten la energ&iacute;a luminosa en energ&iacute;a qu&iacute;mica. Es importante señalar que este proceso produce oxígeno y permite la vida en la Tierra.</p>
    <p>Además, la fotosíntesis utiliza agua, dióxido de carbono y luz solar. La clorofila es el pigmento que capta la energía luminosa.</p>
    <p>Fotosíntesis: qué es, fases e importancia - Con esquema</p>
    <p>AGUANTE LA FOTOSINTESIS, la verdad es que sumamente buen texto.</p>
  </body></html>`,
  'https://fuente-b.example/articulo': `<html><head><title>Fuente B</title></head><body>
    <p>Las plantas utilizan la luz solar para producir energía química mediante la fotosíntesis. Este proceso se realiza en los cloroplastos de las células vegetales.</p>
    <p>La fotosíntesis también libera oxígeno, un gas esencial para la respiración de muchos seres vivos. Por lo tanto, su importancia ecológica es considerable.</p>
  </body></html>`,
  'https://fuente-c.example/articulo': `<html><head><title>Fuente C</title></head><body>
    <p>La fotosíntesis produce oxígeno y materia orgánica a partir de la luz solar, el agua y el dióxido de carbono. Este proceso es fundamental para los ecosistemas.</p>
    <p>Además, la fotosíntesis regula el clima y sostiene la cadena alimentaria. Su estudio permite comprender mejor el funcionamiento de la biosfera.</p>
  </body></html>`,
};

test('conocimiento: distingue una orden de informe de una pregunta sobre informes', () => {
  assert.equal(consultar('Redáctame un informe de x').tipo, 'herramienta');
  assert.notEqual(consultar('¿Cómo redacta un informe la IA?').tipo, 'herramienta');
});

test('conocimiento: redacta un informe con varias fuentes y parafraseo controlado', async () => {
  ensenar({
    tipo: 'texto',
    titulo: 'Notas del usuario sobre fotosíntesis',
    fuente: 'Documento del usuario',
    texto: 'En mis apuntes, la fotosíntesis es el proceso que permite a las plantas fabricar materia orgánica a partir de la luz solar. La clorofila es el pigmento que capta la energía luminosa.',
  });

  globalThis.fetch = async (url) => {
    const destino = String(url);
    if (destino.includes('html.duckduckgo.com')) return respuestaHtml(htmlBusqueda);
    if (paginas[destino]) return respuestaHtml(paginas[destino]);
    throw new Error(`URL no simulada: ${destino}`);
  };

  const r = await consultarConHerramientas('Redacta un informe sobre la fotosíntesis');
  assert.equal(r.tipo, 'informe_web');
  assert.equal(r.modelo, false);
  assert.ok(r.fuentes.length >= 4);
  assert.match(r.respuesta, /\*\*Introducción\*\*/);
  assert.match(r.respuesta, /\*\*Desarrollo\*\*/);
  assert.match(r.respuesta, /\*\*Conclusión\*\*/);
  assert.match(r.respuesta, /\*\*Fuentes\*\*/);
  assert.match(r.respuesta, /\[1\]/);
  assert.match(r.respuesta, /\[2\]/);
  assert.match(r.respuesta, /\[3\]/);
  assert.match(r.respuesta, /\[4\]/);
  assert.match(r.respuesta, /En mis apuntes/);
  assert.match(r.respuesta, /(?:emplea|posibilita|resulta relevante|se compone)/);
  assert.match(r.respuesta, /https:\/\/fuente-a\.example\/articulo/);
  assert.doesNotMatch(r.respuesta, /Por su parte,\s+no obstante/i);
  assert.doesNotMatch(r.respuesta, /a partir de 1 fuentes/i);
  assert.doesNotMatch(r.respuesta, /&[a-z]+;/i);
  assert.doesNotMatch(r.respuesta, /AGUANTE|Con esquema|sumamente buen|la verdad es que/i);
});

test('conocimiento: usa datos del usuario sin internet y guarda el informe', async () => {
  globalThis.fetch = async (url) => {
    throw new Error(`No debía buscar en internet: ${url}`);
  };

  const r = await consultarConHerramientas(
    'Redacta un informe sobre la respiración celular con estos datos: '
    + 'La respiración celular es el conjunto de reacciones que obtienen energía a partir de la glucosa. '
    + 'Este proceso ocurre en las mitocondrias de las células. Sin internet y guárdalo en Documentos.',
  );
  assert.equal(r.tipo, 'informe_web');
  assert.equal(r.fuentes.length, 1);
  assert.match(r.respuesta, /Datos aportados por el usuario/);
  assert.match(r.respuesta, /datos aportados en el mensaje/);
  assert.doesNotMatch(r.respuesta, /documento del usuario/);
  assert.doesNotMatch(r.respuesta, /sin internet|guárdalo|guardar en documentos/i);
  assert.match(r.respuesta, /respiración celular/);
  assert.equal(r.acciones[0].ok, true);
  assert.equal(r.acciones[0].accion, 'crear_documento');
  assert.match(r.acciones[0].ruta, /^\/Documentos\/Informe-/);
  assert.match(store.tree(store.USER)[r.acciones[0].ruta].content, /respiración celular/);
});

test('conocimiento: no inventa un informe cuando no hay fuentes', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('html.duckduckgo.com')) return respuestaHtml('<html></html>');
    throw new Error(`URL no simulada: ${url}`);
  };

  const r = await consultarConHerramientas('Redacta un informe sobre un tema sin fuentes');
  assert.equal(r.tipo, 'informe_web');
  assert.equal(r.fuentes.length, 0);
  assert.match(r.respuesta, /No he podido reunir fuentes/);
  assert.match(r.respuesta, /No voy a inventar/);
});
