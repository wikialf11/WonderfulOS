// Importador de datos abiertos del Multilingual Central Repository (MCR).
//
// Fuente: https://github.com/omwn/omw-data/blob/main/wns/mcr/wn-data-spa.tab
// Licencia: CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)
//
// El fichero original contiene una línea por lema, definición o ejemplo. Aquí se
// agrupa por synset para que el motor lógico pueda consultar el diccionario sin
// depender de un servicio externo. No se usa ningún modelo de lenguaje.
//
// Uso:
//   node scripts/importar-mcr.mjs
//   node scripts/importar-mcr.mjs --limite 5000
//
// El resultado se guarda en data/conocimiento/mcr-es.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_MCR = 'https://raw.githubusercontent.com/omwn/omw-data/main/wns/mcr/wn-data-spa.tab';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DESTINO = path.resolve(AQUI, '..', 'data', 'conocimiento', 'mcr-es.json');

const limiteArg = process.argv.indexOf('--limite');
const LIMITE = limiteArg > -1 ? Math.max(1, Number(process.argv[limiteArg + 1]) || 0) : 0;

function limpiar(texto) {
  return String(texto || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function posDe(id) {
  const sufijo = id.split('-').pop();
  return { n: 'sustantivo', v: 'verbo', a: 'adjetivo', r: 'adverbio', s: 'adjetivo' }[sufijo] || 'sustantivo';
}

console.log('Descargando MCR español...');
const res = await fetch(URL_MCR, { headers: { 'user-agent': 'WonderfulOS/1.0 (+https://github.com/wikialf11/WonderfulOS)' } });
if (!res.ok) throw new Error(`No se pudo descargar el MCR: HTTP ${res.status}`);
const texto = await res.text();
console.log(`Descargados ${texto.length.toLocaleString('es-ES')} caracteres.`);

const synsets = new Map();
for (const linea of texto.split(/\r?\n/)) {
  if (!linea || linea.startsWith('#')) continue;
  const partes = linea.split('\t');
  if (partes.length < 3) continue;
  const [id, tipo] = partes;
  if (!synsets.has(id)) {
    synsets.set(id, { id, pos: posDe(id), lemas: [], definicion: '', ejemplos: [] });
  }
  const s = synsets.get(id);
  if (tipo === 'spa:lemma') {
    const lema = limpiar(partes[2]);
    if (lema && lema.length <= 80 && s.lemas.length < 12 && !s.lemas.includes(lema)) s.lemas.push(lema);
  } else if (tipo === 'spa:def') {
    const def = limpiar(partes[3] || partes[2]);
    if (def && !s.definicion) s.definicion = def.slice(0, 600);
  } else if (tipo === 'spa:exe') {
    const ejemplo = limpiar(partes[3] || partes[2]);
    if (ejemplo && s.ejemplos.length < 2) s.ejemplos.push(ejemplo.slice(0, 600));
  }
}

let datos = [...synsets.values()]
  .filter((s) => s.lemas.length > 0 && s.definicion)
  .sort((a, b) => a.id.localeCompare(b.id));

if (LIMITE) datos = datos.slice(0, LIMITE);

const salida = {
  version: 1,
  fuente: 'Multilingual Central Repository (MCR) 2.0, WordNet en español',
  url: 'https://github.com/omwn/omw-data/blob/main/wns/mcr/wn-data-spa.tab',
  licencia: 'CC BY 3.0',
  atribucion: 'Datos derivados de MCR/OMW. Se han agrupado las líneas por synset y se han recortado definiciones y ejemplos largos.',
  generado: new Date().toISOString(),
  synsets: datos,
};

mkdirSync(path.dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, JSON.stringify(salida));
const bytes = Buffer.byteLength(JSON.stringify(salida));
console.log(`Escritos ${datos.length.toLocaleString('es-ES')} synsets con definición (${(bytes / 1024 / 1024).toFixed(2)} MB).`);
console.log(`Destino: ${DESTINO}`);
