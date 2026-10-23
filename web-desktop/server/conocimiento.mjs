// Motor de conocimiento simbólico de WonderfulOS.
//
// No usa modelos neuronales, Ollama ni entrenamiento por gradientes. El
// conocimiento vive en:
//   - un léxico de conceptos y definiciones (semilla + MCR/WordNet abierto),
//   - un conjunto de reglas de inferencia,
//   - documentos de ejemplo o aportados por el usuario,
//   - correcciones y relaciones enseñadas por el usuario.
//
// El motor define conceptos, recorre relaciones, aplica reglas, recupera
// fragmentos con BM25 y redacta correos, planes y textos expositivos con
// plantillas deterministas. También puede consultar fuentes web y ejecutar
// acciones locales (notas, listas y documentos) cuando el usuario lo pide de
// forma explícita. Todas las respuestas declaran sus fuentes y avisos.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DATA } from './store.mjs';
// Herramientas web ya usadas por Agentic. Son funciones de red, no modelos.
import { searchWeb, fetchPageText, executeOsTool } from './agentic.mjs';
import { assertPublic } from './proxy.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(AQUI, '..', 'data', 'conocimiento');

const STOPWORDS = new Set(`
a al algo algunas algunos ante antes como con contra cual cuando de del desde
donde durante e el ella ellas ellos en entre era erais eran eras eres es esa
esas ese eso esos esta estaba estaban estado estas este esto estos fue fueron
ha habia habian han has hasta hay la las le les lo los me mi mis mucho muy nada
ni no nos nosotros o os otra otras otro otros para pero poco por porque que
quien se sea sean ser si sin sobre su sus te tiene tienen todo todos tu tus un
una unas uno unos y ya
`.split(/\s+/).filter(Boolean));

const RELACIONES_CAMINO = new Set([
  'es_un', 'parte_de', 'asociado_con', 'sinonimo', 'opuesto_a', 'compuesto_por',
  'compone', 'tiene', 'contiene', 'necesita', 'sirve_para', 'produce', 'emite',
  'necesaria_para', 'necesario_para', 'menciona',
]);

const ETIQUETAS_RELACION = {
  es_un: 'Es un/una',
  parte_de: 'Parte de',
  asociado_con: 'Se asocia con',
  opuesto_a: 'Opuesto a',
  sinonimo: 'Sinónimo de',
  compuesto_por: 'Compuesto por',
  compone: 'Compone',
  tiene: 'Tiene',
  contiene: 'Contiene',
  necesita: 'Necesita',
  sirve_para: 'Sirve para',
  produce: 'Produce',
  emite: 'Emite',
  necesaria_para: 'Es necesario para',
  necesario_para: 'Es necesario para',
  menciona: 'Menciona',
  no_es_un: 'No es un/una',
};

function leerJson(fichero, porDefecto) {
  try {
    return JSON.parse(readFileSync(fichero, 'utf8'));
  } catch {
    return porDefecto;
  }
}

function guardarJson(fichero, datos) {
  mkdirSync(path.dirname(fichero), { recursive: true });
  const temporal = `${fichero}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(datos));
  renameSync(temporal, fichero);
}

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(texto) {
  return normalizar(texto).match(/[a-z0-9]+/g) || [];
}

function raiz(token) {
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function slug(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'concepto';
}

function capitalizar(texto) {
  const s = String(texto || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function articuloIndefinido(texto) {
  const t = normalizar(texto);
  if (!t) return 'un';
  if (/^(dia|mapa|planeta|problema|sistema|tema|idioma|clima)$/.test(t)) return 'un';
  if (/^(parte|clase|frase|base|nave|llave|piel|mujer|flor|sal|miel|nariz|vez|voz|luz|paz|red|sed|sede)$/.test(t)) return 'una';
  if (/(a|dad|cion(es)?|sion(es)?|tad|tud|umbre|ie)$/.test(t)) return 'una';
  return 'un';
}

function articuloDefinido(texto) {
  return articuloIndefinido(texto) === 'una' ? 'la' : 'el';
}

function prioridad(concepto) {
  if (concepto.origen === 'semilla') return 0;
  if (concepto.origen === 'usuario') return 1;
  return 2;
}

function limpiarTermino(texto) {
  return String(texto || '')
    .replace(/^¿\s*/, '')
    .replace(/\s*\?+\s*$/, '')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    .replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarRelaciones(relaciones) {
  if (!Array.isArray(relaciones)) return [];
  const salida = [];
  for (const r of relaciones) {
    if (Array.isArray(r) && r.length >= 2) salida.push([String(r[0]), String(r[1])]);
    else if (r && typeof r === 'object' && r.tipo && r.destino) salida.push([String(r.tipo), String(r.destino)]);
  }
  return salida;
}

function normalizarConcepto(concepto, origen) {
  const lema = String(concepto.lema || '').trim();
  const id = String(concepto.id || slug(lema)).trim();
  const acepciones = Array.isArray(concepto.acepciones) && concepto.acepciones.length
    ? concepto.acepciones
    : (concepto.definicion ? [{
      definicion: concepto.definicion,
      genero: concepto.genero,
      diferencia: concepto.diferencia,
      ejemplo: concepto.ejemplo,
      relaciones: concepto.relaciones,
    }] : []);
  return {
    id,
    lema,
    categoria: String(concepto.categoria || 'sustantivo').trim(),
    sinonimos: Array.isArray(concepto.sinonimos)
      ? concepto.sinonimos.map((s) => String(s).trim()).filter(Boolean)
      : String(concepto.sinonimos || '').split(',').map((s) => s.trim()).filter(Boolean),
    acepciones: acepciones.map((a) => ({
      definicion: String(a.definicion || '').trim(),
      genero: a.genero ? String(a.genero).trim() : '',
      diferencia: a.diferencia ? String(a.diferencia).trim() : '',
      ejemplo: a.ejemplo ? String(a.ejemplo).trim() : '',
      relaciones: normalizarRelaciones(a.relaciones || concepto.relaciones),
    })).filter((a) => a.definicion),
    fuente: String(concepto.fuente || (origen === 'mcr' ? 'MCR 2.0 (CC BY 3.0)' : 'Semilla de WonderfulOS')).trim(),
    origen,
  };
}

function fromMcr(s) {
  return {
    id: `mcr:${s.id}`,
    lema: s.lemas[0],
    categoria: s.pos || 'sustantivo',
    sinonimos: s.lemas.slice(1),
    acepciones: [{
      definicion: s.definicion,
      ejemplo: s.ejemplos?.[0] || '',
      relaciones: [],
    }],
    fuente: 'MCR 2.0 (CC BY 3.0)',
    origen: 'mcr',
  };
}

function predKey(hecho) {
  return `${hecho[0]}/${hecho.length}`;
}

function unificar(patron, hecho, entorno) {
  if (patron.length !== hecho.length) return null;
  const nuevo = { ...entorno };
  for (let i = 0; i < patron.length; i += 1) {
    const p = patron[i];
    const h = hecho[i];
    if (typeof p === 'string' && p.startsWith('?')) {
      if (nuevo[p] !== undefined && String(nuevo[p]) !== String(h)) return null;
      nuevo[p] = h;
    } else if (String(p) !== String(h)) {
      return null;
    }
  }
  return nuevo;
}

function sustituir(patron, entorno) {
  return patron.map((x) => (typeof x === 'string' && x.startsWith('?') ? (entorno[x] ?? x) : x));
}

function resolverCondiciones(indice, condiciones, entorno, posicion, acumulador) {
  if (posicion >= condiciones.length) {
    acumulador.push(entorno);
    return acumulador;
  }
  if (acumulador.length > 4000) return acumulador;
  const condicion = condiciones[posicion];
  const lista = indice.get(predKey(condicion)) || [];
  for (const hecho of lista) {
    const siguiente = unificar(condicion, hecho, entorno);
    if (siguiente) {
      resolverCondiciones(indice, condiciones, siguiente, posicion + 1, acumulador);
      if (acumulador.length > 4000) break;
    }
  }
  return acumulador;
}

function aplicarReglas(hechosIniciales, reglas) {
  const hechos = [...hechosIniciales];
  const vistos = new Set(hechos.map((h) => JSON.stringify(h)));
  const indice = new Map();
  const derivaciones = [];
  const indexar = (hecho) => {
    const k = predKey(hecho);
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(hecho);
  };
  for (const h of hechos) indexar(h);

  let truncado = false;
  for (let iteracion = 0; iteracion < 30; iteracion += 1) {
    let cambios = false;
    for (const regla of reglas) {
      const entornos = resolverCondiciones(indice, regla.si || [], {}, 0, []);
      for (const entorno of entornos) {
        for (const consecuente of regla.entonces || []) {
          const hecho = sustituir(consecuente, entorno);
          if (hecho.some((x) => typeof x === 'string' && x.startsWith('?'))) continue;
          const clave = JSON.stringify(hecho);
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          hechos.push(hecho);
          indexar(hecho);
          if (derivaciones.length < 5000) {
            derivaciones.push({
              hecho,
              regla: regla.nombre || 'regla',
              premisas: (regla.si || []).map((p) => sustituir(p, entorno)),
            });
          }
          cambios = true;
          if (hechos.length > 30000) {
            truncado = true;
            break;
          }
        }
        if (truncado) break;
      }
      if (truncado) break;
    }
    if (!cambios || truncado) break;
  }
  return { hechos, derivaciones, truncado };
}

// ---------- Herramientas de actualidad (red, sin modelo neuronal) ----------

function limpiarTextoWeb(texto) {
  // Primero se decodifican las entidades y después se quitan las etiquetas:
  // los resúmenes RSS suelen traer enlaces escapados como &lt;a href=...&gt;.
  return String(texto ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/gi, '…')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esPeticionNoticias(texto) {
  const t = normalizar(texto);
  return /(noticias|actualidad|ultima hora|ultimas noticias|que pasa hoy|que ha pasado hoy|que pasa ahora|que ha pasado ahora|ultimamente)/.test(t);
}

function esPeticionActual(texto) {
  const t = normalizar(texto);
  return /(que tiempo|el tiempo|clima|temperatura|cotizacion|precio|resultado|marcador|cuanto cuesta|cuanto vale)/.test(t)
    && /(hoy|ahora|actual|actualidad|ultimo|ultima|en vivo|estos dias)/.test(t);
}

function limpiarConsultaWeb(texto) {
  let q = String(texto ?? '').trim();
  q = q.replace(/^¿\s*/, '').replace(/\s*\?+\s*$/, '').trim();
  q = q.replace(/^(?:busca|buscar|búscame|buscame|consulta|consultar|averigua|averiguar|dime|encuentra)\s+(?:en\s+)?(?:internet|la\s+web|la\s+red|online|google)\s*(?:sobre|acerca\s+de|de)?\s*/i, '');
  q = q.replace(/^(?:dime|cuéntame|cuentame|muéstrame|muestrame)\s+/i, '');
  q = q.replace(/^(?:cuáles|cuales)\s+son\s+(?:las\s+)?/i, '');
  q = q.replace(/^(?:las\s+)?(?:noticias|últimas\s+noticias|ultimas\s+noticias|actualidad|última\s+hora|ultima\s+hora)\s*(?:sobre|de|del)?\s*/i, '');
  q = q.replace(/^(?:hoy|ahora|última\s+hora|ultima\s+hora|últimamente|ultimamente)\s*(?:sobre|de|del)?\s*/i, '');
  q = q.replace(/^(?:qué\s+pasa|que\s+pasa|qué\s+ha\s+pasado|que\s+ha\s+pasado)\s+(?:hoy|ahora|últimamente|ultimamente|en\s+el\s+mundo)\s*(?:con|sobre|de)?\s*/i, '');
  q = q.replace(/^(?:información|informacion|datos|detalles)\s+(?:sobre|acerca\s+de|de)\s+/i, '');
  q = q.replace(/\s+(?:y\s+)?(?:crea|crear|genera|generar|guarda|guardar|redacta|redactar)\s+(?:un\s+)?(?:documento|informe|archivo|nota)\b[\s\S]*$/i, '');
  q = q.replace(/\s+(?:y\s+)?(?:guárdalo|guardalo|guárdala|guardala)\s+en\s+documentos?\b[\s\S]*$/i, '');
  return q.trim();
}

function pideInformeWeb(texto) {
  const t = normalizar(texto);
  if (/\b(como)\s+(crear|hacer|generar|redactar)\b/.test(t)) return false;
  return /\b(crea|crear|genera|generar|guarda|guardar|redacta|redactar)\b/.test(t)
    && /\b(documento|informe|archivo)\b/.test(t)
    && (/\bdocumentos?\b/.test(t) || /\binforme\b/.test(t));
}

function formatearFechaWeb(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return String(fecha);
  return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

async function searchNews(consulta) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(consulta)}&hl=es&gl=ES&ceid=ES:es`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WonderfulOS/1.0 (motor simbólico; consulta de actualidad)',
        'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const resultados = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && resultados.length < 8) {
      const item = match[1];
      const leer = (tag) => {
        const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(item);
        return m ? limpiarTextoWeb(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')) : '';
      };
      const titulo = leer('title');
      const enlace = leer('link');
      if (!titulo || !enlace) continue;
      resultados.push({
        titulo,
        enlace,
        descripcion: leer('description'),
        fecha: leer('pubDate'),
        fuente: leer('source') || 'Google News',
      });
    }
    return resultados;
  } catch {
    return [];
  }
}

function esFraseBoilerplate(frase) {
  const f = normalizar(frase);
  if (!f) return true;
  if (/^(ir al contenido|menu|buscar|donar|crear cuenta|acceder|iniciar sesion|inicio|saltar|navegacion|wikimedia|articulo|discusion|leer|editar|ver historial|herramientas|idiomas|descargar|imprimir)\b/.test(f)) return true;
  if (/^(representacion|diagrama|ecuacion|comparacion|imagen que muestra|fotografia|mapa|grafico|ilustracion|esquema|figura)\b/.test(f)) return true;
  if (/^para la (pelicula|serie|novela|obra|cancion|revista)\b/.test(f)) return true;
  if (/wikipedia la enciclopedia libre$/.test(f)) return true;
  return false;
}

function resumenExtractivo(texto, consulta, max = 900) {
  const limpio = String(texto ?? '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (!limpio) return '';
  const terminos = new Set(tokens(consulta).filter((t) => !STOPWORDS.has(t)).map(raiz));
  const oraciones = [];
  for (const bloque of limpio.split(/\n+/)) {
    const partes = bloque.length > 800 ? bloque.split(/(?<=[.!?])\s+/) : [bloque];
    for (const parte of partes) {
      const oracion = parte.trim();
      if (oracion.length >= 60 && oracion.length <= 900 && !esFraseBoilerplate(oracion)) {
        oraciones.push(oracion);
      }
    }
  }
  if (!oraciones.length) return limpio.slice(0, max);
  const puntuadas = oraciones.map((oracion, i) => {
    const presentes = new Set(tokens(oracion).map(raiz));
    const score = [...terminos].filter((t) => presentes.has(t)).length;
    return { oracion, i, score };
  });
  const relevantes = puntuadas
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 5);
  const elegidas = (relevantes.length ? relevantes : puntuadas.slice(0, 4))
    .sort((a, b) => a.i - b.i);
  let salida = elegidas.map((o) => o.oracion).join(' ');
  if (salida.length > max) salida = `${salida.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return salida;
}

// ---------- Redacción de informes con varias fuentes ----------

function esPeticionInforme(texto) {
  const t = normalizar(texto);
  const empiezaComoPregunta = /^(?:como|explicame|explica|dime|cuentame|quiero saber|necesito saber|me gustaria saber)\b/.test(t);
  if (empiezaComoPregunta && /\bcomo\b/.test(t) && /\b(?:crear|crea|hacer|hace|redactar|redacta|elaborar|elabora|preparar|prepara|generar|genera|realizar|realiza|desarrollar|desarrolla|escribir|escribe)\b/.test(t)) return false;
  if (/\b(redacta(?:me)?|redactes|elabora(?:me)?|elabores|prepara(?:me)?|prepares|haz(?:me)?|hagas|crea(?:me)?|crees|escribe(?:me)?|escribas|genera(?:me)?|generes|realiza(?:me)?|realices|desarrolla(?:me)?|desarrolles)\s+(?:un|una|el|la)?\s*(?:informe|monografia|articulo)\b/.test(t)) return true;
  if (/\b(?:necesito|quiero|deseo)\s+(?:que\s+)?(?:redactes|elabores|prepares|hagas|crees|escribas|generes|realices|desarrolles)\s+(?:un|una|el|la)?\s*(?:informe|monografia|articulo)\b/.test(t)) return true;
  return /\b(?:necesito|quiero|deseo)\s+(?:un|una)\s*(?:informe|monografia|articulo)\b/.test(t);
}

function separarDatosInforme(texto) {
  const original = String(texto ?? '');
  const coincidencia = original.match(/\b(?:con|usando|a partir de)\s+(?:estos|los|mis|la siguiente)?\s*(?:datos|informaci[oó]n|notas)\s*[:\-]\s*([\s\S]+)$/i)
    || original.match(/\b(?:datos|notas)\s*[:\-]\s*([\s\S]+)$/i);
  if (!coincidencia) return { instruccion: original, datos: '' };
  const datos = coincidencia[1]
    .replace(/\s+(?:y\s+)?(?:sin\s+(?:internet|conexi[oó]n)|solo\s+con\s+(?:estos|mis|los)?\s*(?:datos|documentos|informaci[oó]n)|no\s+busques(?:\s+en\s+internet)?|gu[aá]rda(?:lo|la)?\s+en\s+documentos?|guardar\s+en\s+documentos?)\b[\s\S]*$/i, '')
    .trim();
  return {
    instruccion: original.slice(0, coincidencia.index).trim(),
    datos,
  };
}

function limpiarTemaInforme(texto) {
  let tema = String(texto ?? '').trim();
  tema = tema.replace(/^.*?\b(?:red[aá]cta(?:me)?|red[aá]ctes|elabora(?:me)?|elabores|prepara(?:me)?|prepares|haz(?:me)?|hagas|crea(?:me)?|crees|escribe(?:me)?|escribas|genera(?:me)?|generes|realiza(?:me)?|realices|desarrolla(?:me)?|desarrolles)\s+(?:un|una|el|la)?\s*(?:informe|monograf[ií]a|art[ií]culo)\s*/i, '');
  tema = tema.replace(/^.*?\b(?:necesito|quiero|deseo)\s+(?:un|una)\s*(?:informe|monograf[ií]a|art[ií]culo)\s*/i, '');
  tema = tema.replace(/^(?:sobre|acerca\s+de|en\s+torno\s+a|de|del)\s+/i, '');
  tema = tema.replace(/\s+(?:y\s+)?(?:gu[aá]rda(?:lo|la)?|guardar)\s+en\s+documentos?\b[\s\S]*$/i, '');
  tema = tema.replace(/\s+(?:sin\s+(?:internet|conexi[oó]n)|solo\s+con\s+(?:estos|mis|los)?\s*(?:datos|documentos|informaci[oó]n)|no\s+busques(?:\s+en\s+internet)?)\b[\s\S]*$/i, '');
  tema = tema.replace(/\s+(?:con|usando|a partir de)\s+(?:estos|los|mis|la siguiente)?\s*(?:datos|notas|informaci[oó]n)\b[\s\S]*$/i, '');
  tema = tema.replace(/\s+en\s+documentos?\s*$/i, '');
  tema = tema.replace(/^["'«»]+|["'«»]+$/g, '').replace(/[.,;:]+$/g, '').trim();
  return tema;
}

function esOracionUtil(oracion) {
  const o = String(oracion ?? '').replace(/\s+/g, ' ').trim();
  if (o.length < 55 || o.length > 520) return false;
  if (esFraseBoilerplate(o)) return false;
  if (/[?¿]/.test(o)) return false;
  if (/https?:\/\//i.test(o)) return false;
  if (/^(?:ver|leer|compartir|imprimir|descargar|siguiente|anterior|volver|inicio|menú|menu|te explicamos|te contamos|descubre|aprende|si deseas leer|te recomendamos|sigue leyendo|cuando hablamos de|en este artículo|a continuación|diferencia entre|qué es|que es|cómo|como se|cuándo|dónde|por qué|para qué|características|importancia|tipos|ejemplos|ventajas|desventajas|resumen|introducción|conclusión|índice|bibliografía|referencias|perdonen|perdón|disculpen|me gust|excelente|muy bueno|buen artículo|interesante artículo|opino|creo que|considero que|aguante|viva|jaja|jajaja|xd|en mi opinión|para mí|yo creo|yo opino)\b/i.test(o)) return false;
  if (/(cookies?|pol[ií]tica de privacidad|suscr[ií]bete|iniciar sesi[oó]n|todos los derechos|publicidad|newsletter|aceptar cookies|artículos parecidos|entra en nuestra categoría|no podemos evitar pensar|si deseas leer más|les doy|sumamente completo|este comentario|otro comentario|la verdad es que|sumamente buen|buen texto|gran artículo|me encanta|me gustó|me gusta|increíble|increible|jajaja?|xd|del la|es algo que todos hemos oído|hemos oído mencionar|si quieres aprender|acompáñanos|acompananos|continúa leyendo|continua leyendo|no te lo pierdas|te invitamos a leer)/i.test(o)) return false;
  if (/\b[A-ZÁÉÍÓÚÑ]{6,}\b/.test(o)) return false;
  if (/^[^.]{1,90}:\s*(?:qué|que|cómo|como|cuándo|cuando|dónde|donde|por qué|para qué|fases|características|importancia|tipos|ejemplos)\b/i.test(o)) return false;
  if (/[–-]\s*(?:con|sin)\s+(?:esquema|ejemplos|resumen|vídeo|video|imágenes|imagenes)\b/i.test(o)) return false;
  if ((o.match(/[A-ZÁÉÍÓÚÑ]{5,}/g) || []).length > 4) return false;
  if (/[|]{2,}/.test(o)) return false;
  return true;
}

function oracionBreve(texto) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio) return '';
  const base = limpio.length > 420 ? `${limpio.slice(0, 420).replace(/\s+\S*$/, '')}…` : limpio;
  return capitalizar(/[.!?]$/.test(base) ? base : `${base}.`);
}

function extraerOracionesFuente(texto, terminos, max = 4) {
  const bloques = String(texto ?? '').replace(/\r/g, '').split(/\n+/);
  const oraciones = [];
  let orden = 0;
  for (const bloque of bloques) {
    const limpioBloque = bloque.replace(/[ \t]+/g, ' ').trim();
    if (!limpioBloque) continue;
    const partes = limpioBloque.split(/(?<=[.!?])\s+/);
    for (let parte of partes) {
      parte = parte.replace(/^[\s•·*\-–—]+/, '').replace(/\s+/g, ' ').trim();
      if (!esOracionUtil(parte)) continue;
      parte = parte.replace(/\s*\[\d+\]/g, '').replace(/\s*\(\d+\)/g, '');
      if (!/[.!?]$/.test(parte)) parte += '.';
      parte = capitalizar(parte);
      const presentes = new Set(tokens(parte).filter((t) => !STOPWORDS.has(t)).map(raiz));
      const score = [...terminos].filter((t) => presentes.has(t)).length;
      oraciones.push({ texto: parte, score, orden: orden++ });
    }
  }

  const vistos = new Set();
  const unicas = [];
  for (const oracion of oraciones) {
    const firma = firmaOracion(oracion.texto);
    if (!firma || vistos.has(firma)) continue;
    vistos.add(firma);
    unicas.push(oracion);
  }
  const relevantes = unicas
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score || a.orden - b.orden);
  const seleccion = relevantes.slice(0, max);
  if (seleccion.length < max) {
    for (const oracion of unicas) {
      if (seleccion.length >= max) break;
      if (!seleccion.includes(oracion)) seleccion.push(oracion);
    }
  }
  return seleccion.slice(0, max).sort((a, b) => a.orden - b.orden);
}

function firmaOracion(texto) {
  return [...new Set(tokens(texto).filter((t) => !STOPWORDS.has(t)).map(raiz))]
    .sort()
    .join(' ');
}

function esOracionDuplicada(texto, seleccionadas) {
  const firma = new Set(firmaOracion(texto).split(' ').filter(Boolean));
  if (!firma.size) return true;
  return seleccionadas.some((s) => {
    if (!s.firma?.size) return false;
    let comunes = 0;
    for (const t of firma) if (s.firma.has(t)) comunes += 1;
    const union = firma.size + s.firma.size - comunes;
    return union > 0 && comunes / union >= 0.7;
  });
}

const PARAFRASIS_CONECTORES = [
  [/^Además,\s*/i, 'Asimismo, '],
  [/^Sin embargo,\s*/i, 'No obstante, '],
  [/^No obstante,\s*/i, 'Sin embargo, '],
  [/^Por otro lado,\s*/i, 'En otro orden, '],
  [/^Por ejemplo,\s*/i, 'A modo de ejemplo, '],
  [/^Finalmente,\s*/i, 'Para terminar, '],
  [/^En conclusión,\s*/i, 'En suma, '],
  [/^También,\s*/i, 'Igualmente, '],
];

const PARAFRASIS_FRASES = [
  [/\bdebido a que\b/gi, 'puesto que'],
  [/\bdebido a\b/gi, 'a causa de'],
  [/\ba pesar de\b/gi, 'pese a'],
  [/\ba través de\b/gi, 'mediante'],
  [/\bpor medio de\b/gi, 'mediante'],
  [/\bde acuerdo con\b/gi, 'según'],
  [/\bcon respecto a\b/gi, 'en relación con'],
  [/\bal mismo tiempo\b/gi, 'a la vez'],
  [/\ben su mayoría\b/gi, 'mayoritariamente'],
  [/\bcon el fin de\b/gi, 'con el objetivo de'],
  [/\ba fin de\b/gi, 'con el objetivo de'],
  [/\bse lleva a cabo\b/gi, 'se realiza'],
  [/\blleva a cabo\b/gi, 'realiza'],
  [/\btiene lugar\b/gi, 'ocurre'],
  [/\bestá formado por\b/gi, 'se compone de'],
  [/\bestá formada por\b/gi, 'se compone de'],
  [/\bestá compuesto por\b/gi, 'se compone de'],
  [/\bestá compuesta por\b/gi, 'se compone de'],
  [/\bse basa en\b/gi, 'se fundamenta en'],
  [/\bhace referencia a\b/gi, 'se refiere a'],
  [/\bse caracteriza por\b/gi, 'se distingue por'],
  [/\bjuega un papel\b/gi, 'desempeña una función'],
  [/\bse producen\b/gi, 'se generan'],
  [/\bse produce\b/gi, 'se genera'],
  [/\bprovoca\b/gi, 'causa'],
  [/\ben la actualidad\b/gi, 'hoy en día'],
  [/\bcada vez más\b/gi, 'de forma creciente'],
  [/\bes importante\b/gi, 'resulta relevante'],
  [/\bes fundamental\b/gi, 'resulta esencial'],
  [/\bse puede\b/gi, 'es posible'],
  [/\bpor lo tanto\b/gi, 'en consecuencia'],
  [/\bpor ejemplo\b/gi, 'a modo de ejemplo'],
  [/\bes decir\b/gi, 'esto es'],
  [/\bporque\b/gi, 'ya que'],
  [/\bseñala\b/gi, 'indica'],
  [/\bexplica\b/gi, 'detalla'],
  [/\bdestaca\b/gi, 'subraya'],
  [/\bpermite\b/gi, 'posibilita'],
  [/\bproporciona\b/gi, 'aporta'],
  [/\bcontiene\b/gi, 'incluye'],
  [/\bcomienza\b/gi, 'inicia'],
  [/\btermina\b/gi, 'finaliza'],
  [/\bse utilizan\b/gi, 'se emplean'],
  [/\bse utiliza\b/gi, 'se emplea'],
  [/\bson utilizados\b/gi, 'se emplean'],
  [/\bson utilizadas\b/gi, 'se emplean'],
  [/\bes utilizado\b/gi, 'se emplea'],
  [/\bes utilizada\b/gi, 'se emplea'],
  [/\bson usados\b/gi, 'se emplean'],
  [/\bson usadas\b/gi, 'se emplean'],
  [/\bes usado\b/gi, 'se emplea'],
  [/\bes usada\b/gi, 'se emplea'],
  [/\butiliza\b/gi, 'emplea'],
  [/\butilizan\b/gi, 'emplean'],
  [/\bproduce\b/gi, 'genera'],
  [/\bmuy\b/gi, 'sumamente'],
  [/\bactualmente\b/gi, 'en la actualidad'],
  [/\bprincipalmente\b/gi, 'sobre todo'],
  [/\bgeneralmente\b/gi, 'por lo general'],
  [/\brápidamente\b/gi, 'con rapidez'],
  [/\bclaramente\b/gi, 'de forma clara'],
  [/\bde forma clara\b/gi, 'de manera clara'],
  [/\buso\b/gi, 'empleo'],
  [/\bmétodos\b/gi, 'procedimientos'],
  [/\bmétodo\b/gi, 'procedimiento'],
  [/\bimportantes\b/gi, 'relevantes'],
  [/\bimportante\b/gi, 'relevante'],
];

function aplicarFueraDeProtegido(texto, fn) {
  const partes = String(texto).split(/(https?:\/\/\S+|«[^»]*»|"[^"]*")/g);
  return partes.map((parte, i) => (i % 2 === 1 ? parte : fn(parte))).join('');
}

function parafrasearOracion(texto) {
  let salida = String(texto ?? '').trim();
  if (!salida) return '';
  for (const [regex, reemplazo] of PARAFRASIS_CONECTORES) {
    if (regex.test(salida)) {
      salida = salida.replace(regex, reemplazo);
      break;
    }
  }
  salida = aplicarFueraDeProtegido(salida, (parte) => {
    let limpio = parte;
    for (const [regex, reemplazo] of PARAFRASIS_FRASES) {
      limpio = limpio.replace(regex, (encontrado) => (
        encontrado[0] === encontrado[0].toUpperCase()
          ? reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1)
          : reemplazo
      ));
    }
    return limpio;
  });
  salida = salida.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  if (salida) salida = capitalizar(salida);
  if (salida && !/[.!?]$/.test(salida)) salida += '.';
  return salida;
}

function conCita(texto, numero) {
  const limpio = String(texto ?? '').replace(/\s*[.!?]\s*$/, '').trim();
  return `${limpio} [${numero}].`;
}

const INICIOS_MINUSCULA = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'este', 'esta',
  'estos', 'estas', 'aquel', 'aquella', 'su', 'sus', 'es', 'son', 'se',
  'en', 'de', 'por', 'para', 'con', 'sin', 'cuando', 'como', 'aunque',
  'mientras', 'no', 'también', 'además', 'esto', 'ello', 'ellos', 'ellas',
]);

const RE_CONECTOR_INICIAL = /^(Además|Asimismo|Igualmente|También|Finalmente|Por su parte|En la misma línea|No obstante|Sin embargo|En cambio|Por el contrario|En primer lugar|En segundo lugar|A modo de ejemplo|En suma|Para terminar|En otro orden|Por ejemplo|En consecuencia|Esto es),\s*/i;

function conectorInicial(texto) {
  const t = normalizar(texto);
  const coincidencia = t.match(/^(ademas|asimismo|igualmente|tambien|finalmente|por su parte|en la misma linea|no obstante|sin embargo|en cambio|por el contrario|en primer lugar|en segundo lugar|a modo de ejemplo|en suma|para terminar|en otro orden|por ejemplo|en consecuencia|esto es)\b/);
  return coincidencia ? coincidencia[1] : '';
}

function conTransicion(oracion, transicion) {
  const inicial = oracion.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/);
  if (!inicial) return oracion;
  const primera = normalizar(inicial[1]);
  const arranque = normalizar(oracion).split(' ').slice(0, 9).join(' ');
  if (conectorInicial(oracion)) return oracion;
  if (/\b(tambien|igualmente|ademas|asimismo|no obstante|sin embargo)\b/.test(arranque)) {
    return oracion;
  }
  if (!INICIOS_MINUSCULA.has(primera)) return oracion;
  return `${transicion} ${oracion.charAt(0).toLowerCase()}${oracion.slice(1)}`;
}

function unirOraciones(items) {
  let ultimoConector = '';
  return items.map((item, i) => {
    if (i === 0) {
      ultimoConector = conectorInicial(item.texto);
      return item.texto;
    }
    const cambioFuente = items[i - 1].fuente.n !== item.fuente.n;
    const transiciones = cambioFuente
      ? ['Por su parte,', 'En la misma línea,', 'Asimismo,']
      : ['Asimismo,', 'Además,', 'Igualmente,'];
    let texto = item.texto;
    const inicial = conectorInicial(texto);
    if (inicial && inicial === ultimoConector) {
      const alternativas = ['no obstante', 'sin embargo', 'en cambio', 'por el contrario'].includes(inicial)
        ? ['No obstante,', 'Sin embargo,', 'En cambio,', 'Por el contrario,']
        : ['por su parte', 'en la misma linea'].includes(inicial)
          ? ['Por su parte,', 'En la misma línea,']
          : ['Asimismo,', 'Igualmente,', 'Además,', 'En la misma línea,'];
      const alternativa = alternativas.find((candidato) => normalizar(candidato) !== inicial);
      if (alternativa) texto = texto.replace(RE_CONECTOR_INICIAL, `${alternativa} `);
    }
    let transicion = transiciones[(i - 1) % transiciones.length];
    for (let salto = 0; salto < transiciones.length; salto += 1) {
      const candidata = transiciones[(i - 1 + salto) % transiciones.length];
      if (normalizar(candidata) !== ultimoConector) {
        transicion = candidata;
        break;
      }
    }
    const unida = conTransicion(texto, transicion);
    ultimoConector = unida === texto ? conectorInicial(texto) : normalizar(transicion);
    return unida;
  }).join(' ');
}

export function createEngine(opciones = {}) {
  const dataDir = opciones.dataDir || path.join(DATA, 'conocimiento');
  const seedDir = opciones.seedDir || SEED_DIR;
  const usarMcr = opciones.usarMcr !== false;

  const ficheros = {
    lexicoUsuario: path.join(dataDir, 'lexico-usuario.json'),
    relacionesUsuario: path.join(dataDir, 'relaciones-usuario.json'),
    documentosUsuario: path.join(dataDir, 'documentos-usuario.json'),
    reglasUsuario: path.join(dataDir, 'reglas-usuario.json'),
    mcr: path.join(seedDir, 'mcr-es.json'),
  };

  const state = {
    conceptos: [],
    byId: new Map(),
    byLemma: new Map(),
    documentos: [],
    reglas: [],
    usuario: { conceptos: [], relaciones: [], documentos: [], reglas: [] },
    hechos: [],
    hechoSet: new Set(),
    hechosPorPredicado: new Map(),
    derivaciones: [],
    contradicciones: [],
    indice: null,
    mcrCargado: false,
    truncado: false,
  };

  function indexarConcepto(c) {
    state.byId.set(c.id, c);
    const claves = new Set([normalizar(c.lema)]);
    for (const s of c.sinonimos) claves.add(normalizar(s));
    for (const clave of claves) {
      if (!clave) continue;
      if (!state.byLemma.has(clave)) state.byLemma.set(clave, []);
      const lista = state.byLemma.get(clave);
      if (!lista.some((x) => x.id === c.id)) lista.push(c);
    }
  }

  function resolverId(valor) {
    const limpio = limpiarTermino(valor);
    if (!limpio) return 'desconocido';
    const directo = state.byId.get(limpio);
    if (directo) return directo.id;
    const lista = state.byLemma.get(normalizar(limpio)) || [];
    if (lista.length) {
      return [...lista].sort((a, b) => prioridad(a) - prioridad(b))[0].id;
    }
    return slug(limpio);
  }

  function lemaDe(id) {
    return state.byId.get(id)?.lema || String(id || '').replace(/-/g, ' ');
  }

  function cargar() {
    const semilla = leerJson(path.join(seedDir, 'seed-lexico.json'), { conceptos: [] });
    const reglasSemilla = leerJson(path.join(seedDir, 'reglas.json'), { reglas: [] });
    const docsSemilla = leerJson(path.join(seedDir, 'documentos-ejemplo.json'), { documentos: [] });
    const lexicoUsuario = leerJson(ficheros.lexicoUsuario, { conceptos: [] });
    const relacionesUsuario = leerJson(ficheros.relacionesUsuario, { relaciones: [] });
    const docsUsuario = leerJson(ficheros.documentosUsuario, { documentos: [] });
    const reglasUsuario = leerJson(ficheros.reglasUsuario, { reglas: [] });

    state.byId = new Map();
    state.byLemma = new Map();
    state.indice = null;
    state.mcrCargado = false;

    const mapa = new Map();
    for (const c of semilla.conceptos || []) {
      const n = normalizarConcepto(c, 'semilla');
      mapa.set(n.id, n);
    }

    if (usarMcr && existsSync(ficheros.mcr)) {
      const mcr = leerJson(ficheros.mcr, { synsets: [] });
      for (const s of mcr.synsets || []) {
        if (!s.lemas?.length || !s.definicion) continue;
        const c = normalizarConcepto(fromMcr(s), 'mcr');
        mapa.set(c.id, c);
      }
      state.mcrCargado = true;
    }

    for (const c of lexicoUsuario.conceptos || []) {
      const n = normalizarConcepto(c, 'usuario');
      mapa.set(n.id, n);
    }

    state.conceptos = [...mapa.values()];
    for (const c of state.conceptos) indexarConcepto(c);

    state.usuario = {
      conceptos: lexicoUsuario.conceptos || [],
      relaciones: relacionesUsuario.relaciones || [],
      documentos: docsUsuario.documentos || [],
      reglas: reglasUsuario.reglas || [],
    };
    state.documentos = [
      ...(docsSemilla.documentos || []).map((d) => ({ ...d, origen: 'semilla' })),
      ...(docsUsuario.documentos || []).map((d) => ({ ...d, origen: 'usuario' })),
    ];
    state.reglas = [...(reglasSemilla.reglas || []), ...(reglasUsuario.reglas || [])];

    construirHechos();
  }

  function anadirHecho(hechos, vistos, indice, hecho) {
    const clave = JSON.stringify(hecho);
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    hechos.push(hecho);
    const k = predKey(hecho);
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(hecho);
    return true;
  }

  function construirHechos() {
    const hechos = [];
    const vistos = new Set();
    const indice = new Map();
    const add = (h) => anadirHecho(hechos, vistos, indice, h);

    for (const c of state.conceptos) {
      if (c.origen === 'mcr') continue;
      add(['concepto', c.id, c.lema]);
      add(['categoria', c.id, c.categoria]);
      for (const a of c.acepciones) {
        if (a.definicion) add(['definicion', c.id, a.definicion]);
        if (a.genero) {
          const genero = resolverId(a.genero);
          add(['genero', c.id, genero]);
          add(['es_un', c.id, genero]);
        }
        if (a.diferencia) add(['diferencia', c.id, a.diferencia]);
        for (const [tipo, destino] of a.relaciones) {
          add([tipo, c.id, resolverId(destino)]);
        }
      }
      for (const s of c.sinonimos) {
        add(['sinonimo', c.id, resolverId(s)]);
      }
    }

    for (const r of state.usuario.relaciones) {
      if (!r?.tipo || !r?.origen || !r?.destino) continue;
      add([String(r.tipo), resolverId(r.origen), resolverId(r.destino)]);
    }

    const resultado = aplicarReglas(hechos, state.reglas);
    state.hechos = resultado.hechos;
    state.derivaciones = resultado.derivaciones;
    state.truncado = resultado.truncado;
    state.hechoSet = new Set(state.hechos.map((h) => JSON.stringify(h)));
    state.hechosPorPredicado = new Map();
    for (const h of state.hechos) {
      const k = predKey(h);
      if (!state.hechosPorPredicado.has(k)) state.hechosPorPredicado.set(k, []);
      state.hechosPorPredicado.get(k).push(h);
    }
    state.contradicciones = detectarContradicciones();
  }

  function detectarContradicciones() {
    const salida = [];
    for (const h of state.hechos) {
      if (h[0] !== 'es_un') continue;
      const negado = ['no_es_un', h[1], h[2]];
      if (state.hechoSet.has(JSON.stringify(negado))) salida.push({ tipo: 'contradiccion', hechos: [h, negado] });
    }
    return salida;
  }

  function buscarConceptos(termino, limite = 6) {
    const limpio = limpiarTermino(termino);
    if (!limpio) return [];
    const clave = normalizar(limpio);
    const salida = [];
    const vistos = new Set();
    const add = (c) => {
      if (!c || vistos.has(c.id)) return;
      vistos.add(c.id);
      salida.push(c);
    };

    for (const c of state.byLemma.get(clave) || []) add(c);

    if (salida.length < limite) {
      const variantes = new Set();
      if (clave.endsWith('es') && clave.length > 4) variantes.add(clave.slice(0, -2));
      else if (clave.endsWith('s') && clave.length > 3) variantes.add(clave.slice(0, -1));
      else variantes.add(`${clave}s`);
      for (const v of variantes) for (const c of state.byLemma.get(v) || []) add(c);
    }

    if (salida.length < limite) {
      const ts = tokens(limpio).filter((t) => !STOPWORDS.has(t));
      if (ts.length) {
        const puntos = new Map();
        for (const t of ts) {
          for (const c of state.byLemma.get(t) || []) {
            puntos.set(c, (puntos.get(c) || 0) + 1);
          }
        }
        [...puntos.entries()]
          .sort((a, b) => b[1] - a[1] || prioridad(a[0]) - prioridad(b[0]))
          .forEach(([c]) => add(c));
      }
    }

    if (!salida.length) {
      for (const d of buscarBM25(limpio, 20)) {
        if (d.tipo !== 'concepto') continue;
        const c = state.byId.get(d.ref);
        if (c) add(c);
      }
    }

    return salida
      .sort((a, b) => {
        const exactoA = normalizar(a.lema) === clave ? 0 : 1;
        const exactoB = normalizar(b.lema) === clave ? 0 : 1;
        return exactoA - exactoB || prioridad(a) - prioridad(b);
      })
      .slice(0, limite);
  }

  function relacionesDe(concepto, acepcion = null) {
    const salida = [];
    const vistos = new Set();
    const add = (tipo, destino) => {
      if (!tipo || !destino) return;
      const id = resolverId(destino);
      const clave = `${tipo}:${id}`;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      salida.push([String(tipo), id]);
    };
    const acepciones = acepcion ? [acepcion] : concepto.acepciones;
    for (const a of acepciones) {
      for (const [tipo, destino] of a.relaciones || []) add(tipo, destino);
    }
    for (const r of state.usuario.relaciones) {
      if (resolverId(r.origen) === concepto.id) add(r.tipo, r.destino);
    }
    return salida;
  }

  function etiquetaRelacion(tipo) {
    return ETIQUETAS_RELACION[tipo] || capitalizar(String(tipo).replace(/_/g, ' '));
  }

  function renderConcepto(c) {
    const lineas = [`**${c.lema}**${c.categoria ? ` (${c.categoria})` : ''}`];
    const acepciones = c.acepciones.slice(0, 3);
    acepciones.forEach((a, i) => {
      if (acepciones.length > 1) lineas.push(`**Acepción ${i + 1}**`);
      lineas.push(`- Definición: ${a.definicion}`);
      if (a.genero) lineas.push(`- Es ${articuloIndefinido(lemaDe(a.genero))} ${lemaDe(a.genero)}`);
      if (a.diferencia) lineas.push(`- Diferencia: ${a.diferencia}`);
      if (a.ejemplo) lineas.push(`- Ejemplo: ${a.ejemplo}`);
      for (const [tipo, destino] of relacionesDe(c, a).slice(0, 7)) {
        if (tipo === 'es_un' && a.genero && resolverId(destino) === resolverId(a.genero)) continue;
        lineas.push(`- ${etiquetaRelacion(tipo)}: ${lemaDe(destino)}`);
      }
    });
    if (c.sinonimos.length) lineas.push(`- Sinónimos: ${c.sinonimos.slice(0, 6).join(', ')}`);
    if (c.fuente) lineas.push(`- Fuente: ${c.fuente}`);

    const derivadas = state.derivaciones
      .filter((d) => d.hecho[0] === 'es_un' && d.hecho[1] === c.id)
      .slice(0, 3);
    for (const d of derivadas) {
      const destino = lemaDe(d.hecho[2]);
      if (!lineas.some((l) => normalizar(l).includes(normalizar(destino)))) {
        lineas.push(`- Por inferencia: es ${articuloIndefinido(destino)} ${destino}`);
      }
    }
    return lineas.join('\n');
  }

  function respuestaDefinir(texto) {
    const termino = limpiarTermino(
      String(texto || '')
        .replace(/^¿\s*/, '')
        .replace(/\s*\?+\s*$/, '')
        .replace(/^(?:qué es|qué significa|qué se entiende por|dime qué es|define|definición de)\s+/i, ''),
    );
    if (!termino) {
      return {
        tipo: 'definir',
        respuesta: 'Dime qué concepto quieres que defina. Por ejemplo: «¿Qué es el verde?».',
        conceptos: [],
        fuentes: [],
        avisos: [],
      };
    }

    let conceptos = buscarConceptos(termino, 4);
    if (conceptos.some((c) => c.origen === 'semilla')) {
      const exactos = conceptos.filter((c) => c.origen === 'semilla' || normalizar(c.lema) === normalizar(termino));
      if (exactos.length) conceptos = exactos.slice(0, 3);
    }
    if (!conceptos.length) {
      const docs = buscarBM25(termino, 3);
      if (docs.length) {
        return {
          tipo: 'definir',
          respuesta: [
            `No tengo una entrada de diccionario para «${termino}», pero encontré estos fragmentos:`,
            '',
            ...docs.map((d, i) => `${i + 1}. **${d.titulo}** (${d.fuente})\n   «${d.fragmento}»`),
          ].join('\n'),
          conceptos: [],
          fuentes: [...new Set(docs.map((d) => d.fuente))],
          avisos: ['La respuesta procede de los textos cargados, no de una definición del diccionario.'],
        };
      }
      return {
        tipo: 'definir',
        respuesta: [
          `No tengo el concepto «${termino}» en la base de conocimiento.`,
          '',
          'Puedes enseñármelo con la API de conocimiento:',
          '`POST /api/conocimiento/ensenar`',
          `\`{"tipo":"concepto","lema":"${termino}","definicion":"..."}\``,
        ].join('\n'),
        conceptos: [],
        fuentes: [],
        avisos: ['No se ha inventado una definición.'],
      };
    }

    const exacto = state.byLemma.has(normalizar(termino));
    const partes = conceptos.map((c) => renderConcepto(c));
    const avisos = [];
    if (!exacto) avisos.push(`No hay una entrada exacta para «${termino}»; muestro conceptos relacionados.`);
    if (conceptos.length > 1) avisos.push(`Hay varias acepciones; muestro ${conceptos.length}.`);

    return {
      tipo: 'definir',
      respuesta: partes.join('\n\n---\n\n'),
      conceptos: conceptos.map((c) => c.id),
      fuentes: [...new Set(conceptos.map((c) => c.fuente).filter(Boolean))],
      avisos,
    };
  }

  function respuestaEsUn(texto) {
    const m = String(texto).match(/^(?:¿\s*)?(.+?)\s+(es|son)\s+(?:un|una|unos|unas)\s+(.+?)\s*\??$/i);
    if (!m) {
      return {
        tipo: 'es_un',
        respuesta: 'No he entendido la pregunta. Prueba con «¿El verde es un color?».',
        conceptos: [],
        fuentes: [],
        avisos: [],
      };
    }
    const x = buscarConceptos(m[1], 1)[0];
    const y = buscarConceptos(m[3], 1)[0];
    if (!x || !y) {
      return {
        tipo: 'es_un',
        respuesta: 'No tengo definidos los dos conceptos, así que no puedo comprobar la relación.',
        conceptos: [x?.id, y?.id].filter(Boolean),
        fuentes: [],
        avisos: ['Falta al menos uno de los conceptos en la base.'],
      };
    }
    const hecho = ['es_un', x.id, y.id];
    const directo = state.hechoSet.has(JSON.stringify(hecho));
    const deducido = state.derivaciones.find((d) => d.hecho[0] === 'es_un' && d.hecho[1] === x.id && d.hecho[2] === y.id);
    if (directo || deducido) {
      let respuesta = `Sí. **${x.lema}** es ${articuloIndefinido(y.lema)} **${y.lema}**.`;
      if (deducido) {
        const premisas = deducido.premisas
          .map((p) => `${p[0]}(${lemaDe(p[1])}, ${lemaDe(p[2])})`)
          .join('; ');
        respuesta += `\n\nSe deduce con la regla \`${deducido.regla}\` a partir de: ${premisas}.`;
      }
      return {
        tipo: 'es_un',
        respuesta,
        conceptos: [x.id, y.id],
        fuentes: [...new Set([x.fuente, y.fuente].filter(Boolean))],
        derivaciones: deducido ? [deducido] : [],
        avisos: [],
      };
    }
    const negado = ['no_es_un', x.id, y.id];
    if (state.hechoSet.has(JSON.stringify(negado))) {
      return {
        tipo: 'es_un',
        respuesta: `No. La base de conocimiento indica que **${x.lema}** no es un/una **${y.lema}**.`,
        conceptos: [x.id, y.id],
        fuentes: [],
        avisos: [],
      };
    }
    return {
      tipo: 'es_un',
      respuesta: `No consta que **${x.lema}** sea un/una **${y.lema}**. No puedo afirmarlo ni negarlo con las reglas actuales.`,
      conceptos: [x.id, y.id],
      fuentes: [],
      avisos: ['La lógica comprueba lo que está en la base; no completa huecos por su cuenta.'],
    };
  }

  function caminoEntre(aId, bId, maxProfundidad = 4) {
    const adyacencia = new Map();
    const add = (desde, hasta, tipo, inverso = false) => {
      if (!adyacencia.has(desde)) adyacencia.set(desde, []);
      adyacencia.get(desde).push({ hasta, tipo, inverso });
    };
    for (const h of state.hechos) {
      if (!RELACIONES_CAMINO.has(h[0])) continue;
      add(h[1], h[2], h[0], false);
      add(h[2], h[1], h[0], true);
    }
    const cola = [{ id: aId, camino: [] }];
    const vistos = new Set([aId]);
    while (cola.length) {
      const actual = cola.shift();
      if (actual.id === bId) return actual.camino;
      if (actual.camino.length >= maxProfundidad) continue;
      for (const arista of adyacencia.get(actual.id) || []) {
        if (vistos.has(arista.hasta)) continue;
        vistos.add(arista.hasta);
        cola.push({
          id: arista.hasta,
          camino: [...actual.camino, {
            desde: actual.id,
            hasta: arista.hasta,
            tipo: arista.tipo,
            inverso: arista.inverso,
          }],
        });
      }
    }
    return null;
  }

  function respuestaCamino(texto) {
    const m = String(texto).match(/(?:relación|relacion)\s+(?:(?:hay|existe)\s+)?entre\s+(.+?)\s+y\s+(.+?)\s*\??$/i);
    if (!m) {
      return {
        tipo: 'camino',
        respuesta: 'Dime dos conceptos. Por ejemplo: «¿Qué relación hay entre verde y vegetación?».',
        conceptos: [],
        fuentes: [],
        avisos: [],
      };
    }
    const a = buscarConceptos(m[1], 1)[0];
    const b = buscarConceptos(m[2], 1)[0];
    if (!a || !b) {
      return {
        tipo: 'camino',
        respuesta: 'No tengo definidos los dos conceptos para buscar un camino entre ellos.',
        conceptos: [a?.id, b?.id].filter(Boolean),
        fuentes: [],
        avisos: ['Falta al menos uno de los conceptos.'],
      };
    }
    const camino = caminoEntre(a.id, b.id);
    if (!camino) {
      const relacionados = relacionesDe(a).slice(0, 6)
        .map(([tipo, destino]) => `- ${etiquetaRelacion(tipo)}: ${lemaDe(destino)}`);
      return {
        tipo: 'camino',
        respuesta: [
          `No encontré un camino de hasta 4 pasos entre **${a.lema}** y **${b.lema}**.`,
          relacionados.length ? `\nRelaciones directas de **${a.lema}**:\n${relacionados.join('\n')}` : '',
        ].join('\n').trim(),
        conceptos: [a.id, b.id],
        fuentes: [],
        avisos: ['El grafo solo contiene las relaciones que se han enseñado o importado.'],
      };
    }
    const pasos = camino.map((p) => (p.inverso
      ? `${lemaDe(p.desde)} ←${p.tipo}— ${lemaDe(p.hasta)}`
      : `${lemaDe(p.desde)} —${p.tipo}→ ${lemaDe(p.hasta)}`));
    return {
      tipo: 'camino',
      respuesta: [
        `Camino entre **${a.lema}** y **${b.lema}**:`,
        '',
        ...pasos.map((p) => `- ${p}`),
      ].join('\n'),
      conceptos: [a.id, ...camino.map((p) => p.hasta)],
      fuentes: [],
      avisos: [],
    };
  }

  function generarCorreo(texto) {
    const original = String(texto || '');
    const lower = normalizar(original);
    let destinatario = '';
    const coincide = original.match(/\b(?:al|a la|para el|para la)\s+([^.,;]+?)(?=\s+(?:para|sobre|solicitando|pidiendo|reclamando|con el fin)\b|[,.]|$)/i);
    if (coincide) destinatario = coincide[1].trim();
    if (!destinatario) {
      const etiqueta = original.match(/(?:destinatario|para)\s*:\s*([^\n.,;]+)/i);
      if (etiqueta) destinatario = etiqueta[1].trim();
    }
    destinatario = destinatario.replace(/^(?:el|la)\s+/i, '').trim();

    let asunto = '';
    const peticion = original.match(/\b(?:solicitar|solicito|pedir|pido|reclamar|reclamo)\s+(?:una|un|unos|unas|el|la|los|las)?\s*([^.,;]+)/i);
    if (peticion) asunto = peticion[1].trim();
    if (!asunto) {
      if (/certificado de residencia/i.test(original)) asunto = 'certificado de residencia';
      else if (/certificado/i.test(original)) asunto = 'certificado';
      else if (/residencia/i.test(original)) asunto = 'certificado de residencia';
      else if (/beca/i.test(original)) asunto = 'beca';
      else asunto = '[Asunto]';
    }
    asunto = asunto.replace(/\s+$/, '');

    const reclamacion = /reclam/i.test(original);
    const verbo = reclamacion ? 'presentar una reclamación sobre' : 'solicitar';
    const encabezado = reclamacion ? `Reclamación sobre ${asunto}` : `Solicitud de ${asunto}`;
    const placeholders = [...new Set(original.match(/\[[^\]]+\]/g) || [])];
    const datos = placeholders.length
      ? placeholders.join(', ')
      : '[Nombre y apellidos], [DNI] y [Dirección]';

    let saludo;
    if (destinatario) {
      const femenino = /consejería|universidad|diputación|delegación|dirección|secretaría|biblioteca|escuela|facultad/i.test(destinatario);
      saludo = `A la atención ${femenino ? 'de la' : 'del'} ${destinatario}:`;
    } else {
      saludo = 'A la atención de [Organismo]:';
    }

    const objeto = asunto.startsWith('[')
      ? asunto
      : `${articuloIndefinido(asunto.split(/\s+/)[0])} ${asunto}`;
    const cuerpo = reclamacion
      ? `Me dirijo a usted para presentar una reclamación sobre ${asunto}. Los hechos son los siguientes: [Hechos].\n\nPor todo lo anterior, solicito: [Petición].`
      : `Me dirijo a usted para ${verbo} ${objeto}. Mis datos son: ${datos}.`;

    const respuesta = [
      `Asunto: ${encabezado}`,
      '',
      saludo,
      '',
      cuerpo,
      '',
      'Agradezco de antemano su atención y quedo a la espera de su respuesta.',
      '',
      'Atentamente,',
      '[Nombre y apellidos]',
      '[Datos de contacto]',
    ].join('\n');

    const avisos = [
      'Borrador generado con una plantilla simbólica; no se ha usado ningún modelo de IA.',
      'Sustituye los placeholders entre corchetes antes de enviar.',
    ];
    if (!destinatario) avisos.push('No he identificado el destinatario; indica «al [organismo]».');
    if (asunto === '[Asunto]') avisos.push('No he identificado el asunto; concreta qué solicitas.');
    if (lower.includes('cordial')) avisos.push('El tono se ha mantenido cordial y administrativo.');

    return {
      tipo: 'correo',
      respuesta,
      conceptos: detectarConceptosEnTexto(respuesta),
      fuentes: [],
      avisos,
    };
  }

  function generarPlan(texto) {
    const lower = normalizar(texto);
    let dias = [];
    const nombres = [
      ['lunes', 'Lunes'], ['martes', 'Martes'], ['miércoles', 'Miércoles'],
      ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sábado', 'Sábado'], ['domingo', 'Domingo'],
    ];
    for (const [clave, nombre] of nombres) {
      if (lower.includes(clave)) dias.push(nombre);
    }
    let titulo = 'Plan semanal';
    if (!dias.length && /fin de semana/.test(lower)) {
      dias = ['Sábado', 'Domingo'];
      titulo = 'Plan de fin de semana';
    } else if (!dias.length) {
      dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
    } else if (dias.every((d) => d === 'Sábado' || d === 'Domingo')) {
      titulo = 'Plan de fin de semana';
    }

    let trabajo = 'Trabajo profundo';
    if (/oposici/.test(lower)) trabajo = 'Estudio de oposiciones';
    else if (/universi|clase|estudi/.test(lower)) trabajo = 'Estudio y clases';
    else if (/autonom|autónom|emprend|proyecto/.test(lower)) trabajo = 'Trabajo profundo';
    const cuidado = /familiar|mayor|cuidado|hijo|hija/.test(lower) ? 'Cuidado del familiar' : 'Tiempo personal';

    const lineas = [`**${titulo}**`, ''];
    for (const dia of dias) {
      lineas.push(`**${dia}**`);
      if (dia === 'Sábado' || dia === 'Domingo') {
        lineas.push(
          '- 09:00–10:30: Actividad principal.',
          '- 10:30–11:00: Pausa.',
          '- 11:00–12:30: Tarea personal.',
          '- 12:30–13:30: Comida.',
          '- 13:30–15:00: Descanso.',
        );
      } else {
        lineas.push(
          '- 08:00–08:30: Planificación y revisión.',
          `- 08:30–10:30: ${trabajo}.`,
          '- 10:30–10:50: Pausa.',
          '- 10:50–12:00: Administración y correo.',
          '- 12:00–13:00: Comida.',
          `- 13:00–14:30: ${cuidado}.`,
          '- 14:30–15:00: Descanso.',
          `- 15:00–16:30: ${trabajo}.`,
          '- 16:30–17:00: Revisión y cierre.',
        );
      }
      lineas.push('');
    }
    lineas.push('**Criterios**');
    lineas.push('- Protege los bloques de trabajo profundo sin interrupciones.');
    lineas.push('- Agrupa la administración y el correo en un solo tramo.');
    lineas.push('- Deja margen para imprevistos y para el descanso.');

    return {
      tipo: 'plan',
      respuesta: lineas.join('\n'),
      conceptos: detectarConceptosEnTexto(lineas.join(' ')),
      fuentes: [],
      avisos: [
        'Plan genérico generado con reglas y plantillas; ajusta los horarios a tu situación.',
        'No se ha usado ningún modelo de IA.',
      ],
    };
  }

  function generarTexto(texto) {
    let tema = String(texto || '').trim();
    const sobre = tema.match(/\b(?:sobre|acerca de|en torno a)\s+(.+)$/i);
    if (sobre) tema = sobre[1];
    else {
      tema = tema.replace(/^(?:explica|explícame|redacta|escribe|haz|prepara|desarrolla|un|una|unos|unas|el|la|los|las|texto|ensayo|artículo|articulo|expositivo|universitario)\s+/i, '');
      tema = tema.replace(/^(?:un|una|el|la|los|las|texto|ensayo|artículo|articulo|expositivo|universitario)\s+/i, '');
    }
    tema = tema.replace(/^["'«»]+|["'«»]+$/g, '').replace(/[.,;:]+$/g, '').trim();
    if (!tema) tema = 'el tema solicitado';

    const conceptos = buscarConceptos(tema, 3);
    const principal = conceptos[0];
    const relacionados = [];
    if (principal) {
      for (const [tipo, destino] of relacionesDe(principal)) {
        const c = state.byId.get(destino);
        if (!c || c.id === principal.id) continue;
        if (!relacionados.some((r) => r.id === c.id)) relacionados.push(c);
        if (relacionados.length >= 4) break;
      }
    }

    const docs = buscarBM25(tema, 4).filter((d) => d.tipo === 'documento');
    const fuentes = [...new Set([...conceptos.map((c) => c.fuente), ...docs.map((d) => d.fuente)].filter(Boolean))];
    const lineas = ['**Introducción**'];
    if (principal) {
      const def = principal.acepciones[0]?.definicion || 'sin definición disponible';
      lineas.push(`El concepto de **${principal.lema}** se define como ${def}.`);
      const genero = principal.acepciones[0]?.genero;
      if (genero) lineas.push(`Dentro del conocimiento disponible, se clasifica como ${lemaDe(genero)}.`);
    } else {
      lineas.push(`No tengo una definición directa de «${tema}». El texto se apoya en los fragmentos recuperados.`);
    }

    lineas.push('', '**Desarrollo**');
    if (relacionados.length) {
      for (const c of relacionados) {
        const def = c.acepciones[0]?.definicion;
        if (def) lineas.push(`- **${c.lema}**: ${def}.`);
      }
    }
    if (docs.length) {
      for (const d of docs) lineas.push(`- Según **${d.fuente}**, «${d.fragmento}».`);
    }
    if (!relacionados.length && !docs.length) {
      lineas.push('No hay relaciones ni fragmentos suficientes para desarrollar el tema con fuentes.');
    }

    lineas.push('', '**Conclusión**');
    if (principal) {
      const nombres = relacionados.slice(0, 3).map((c) => c.lema);
      const sujeto = `${articuloDefinido(principal.lema)} ${principal.lema}`;
      const definido = articuloDefinido(principal.lema) === 'la' ? 'definida' : 'definido';
      lineas.push(nombres.length
        ? `En conjunto, ${sujeto} se entiende a partir de ${nombres.join(', ')} y de las relaciones registradas.`
        : `En conjunto, ${sujeto} queda ${definido} por la información disponible, sin añadir datos no comprobados.`);
    } else {
      lineas.push('El tema requiere más fuentes o definiciones antes de poder desarrollarse con seguridad.');
    }

    if (fuentes.length) {
      lineas.push('', '**Fuentes**');
      for (const f of fuentes) lineas.push(`- ${f}`);
    }

    return {
      tipo: 'texto',
      respuesta: lineas.join('\n'),
      conceptos: conceptos.map((c) => c.id),
      fuentes,
      avisos: [
        'Texto construido con definiciones y fragmentos recuperados; no se ha usado ningún modelo de IA.',
        docs.length
          ? 'Las citas son fragmentos literales de las fuentes cargadas.'
          : 'No hay textos externos sobre el tema; el texto se basa solo en definiciones.',
      ],
    };
  }

  function detectarConceptosEnTexto(texto) {
    const normalizado = ` ${normalizar(texto)} `;
    const salida = [];
    for (const c of state.conceptos) {
      if (c.origen === 'mcr') continue;
      const lema = normalizar(c.lema);
      if (lema.length < 3) continue;
      if (normalizado.includes(` ${lema} `)) salida.push(c.id);
    }
    return [...new Set(salida)].slice(0, 12);
  }

  function construirIndice() {
    if (state.indice) return state.indice;
    const docs = [];
    for (const c of state.conceptos) {
      const definiciones = c.acepciones.map((a) => a.definicion).filter(Boolean);
      if (!definiciones.length) continue;
      const ejemplos = c.acepciones.map((a) => a.ejemplo).filter(Boolean);
      const texto = [...definiciones, ...ejemplos]
        .map((s) => String(s).replace(/[.\s]+$/, ''))
        .join('. ')
        .trim();
      docs.push({
        id: `def:${c.id}`,
        titulo: c.lema,
        fuente: c.fuente || 'Diccionario',
        texto,
        tipo: 'concepto',
        ref: c.id,
      });
    }
    for (const d of state.documentos) {
      docs.push({
        id: d.id || `doc:${randomUUID()}`,
        titulo: d.titulo || 'Documento',
        fuente: d.fuente || 'Documento del usuario',
        texto: d.texto || '',
        tipo: 'documento',
        ref: d.id || '',
      });
    }

    const postings = new Map();
    const df = new Map();
    const longitudes = [];
    docs.forEach((d, i) => {
      const ts = tokens(`${d.titulo} ${d.texto}`);
      longitudes[i] = ts.length;
      const tf = new Map();
      for (const t of ts) {
        const r = raiz(t);
        tf.set(r, (tf.get(r) || 0) + 1);
      }
      d._tf = tf;
      for (const [t, n] of tf) {
        if (!postings.has(t)) postings.set(t, new Map());
        postings.get(t).set(i, n);
        df.set(t, (df.get(t) || 0) + 1);
      }
    });

    state.indice = {
      docs,
      postings,
      df,
      longitudes,
      media: longitudes.reduce((a, b) => a + b, 0) / Math.max(1, longitudes.length),
    };
    return state.indice;
  }

  function expandirTerminos(terminos) {
    const salida = new Set(terminos);
    for (const t of terminos) {
      const conceptos = state.byLemma.get(t) || [];
      for (const c of conceptos.slice(0, 2)) {
        salida.add(normalizar(c.lema));
        for (const s of c.sinonimos.slice(0, 3)) salida.add(normalizar(s));
      }
      if (salida.size > 24) break;
    }
    return [...salida].filter(Boolean).slice(0, 24);
  }

  function fragmento(texto, terminos, max = 300) {
    const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpio) return '';
    const oraciones = limpio.split(/(?<=[.!?])\s+/);
    const buscados = terminos.map((t) => normalizar(t));
    let mejor = oraciones.find((o) => buscados.some((t) => normalizar(o).includes(t))) || oraciones[0] || limpio;
    if (mejor.length > max) mejor = `${mejor.slice(0, max).replace(/\s+\S*$/, '')}…`;
    return mejor;
  }

  function buscarBM25(texto, limite = 5) {
    const indice = construirIndice();
    const consulta = tokens(texto).filter((t) => !STOPWORDS.has(t)).map(raiz);
    if (!consulta.length) return [];
    const terminos = expandirTerminos([...new Set(consulta)]);
    const puntuaciones = new Map();
    const k1 = 1.5;
    const b = 0.75;
    for (const t of terminos) {
      const lista = indice.postings.get(t);
      if (!lista) continue;
      const idf = Math.log(1 + (indice.docs.length - (indice.df.get(t) || 0) + 0.5) / ((indice.df.get(t) || 0) + 0.5));
      for (const [i, tf] of lista) {
        const long = indice.longitudes[i] || 0;
        const denom = tf + k1 * (1 - b + b * (long / Math.max(1, indice.media)));
        const score = idf * ((tf * (k1 + 1)) / Math.max(0.0001, denom));
        puntuaciones.set(i, (puntuaciones.get(i) || 0) + score);
      }
    }
    return [...puntuaciones.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, limite)
      .map(([i, score]) => {
        const { _tf, ...doc } = indice.docs[i];
        return {
          ...doc,
          puntuacion: Number(score.toFixed(4)),
          fragmento: fragmento(indice.docs[i].texto, terminos),
        };
      });
  }

  function respuestaBuscar(texto) {
    let consulta = String(texto || '').trim();
    consulta = consulta.replace(/^(?:busca|buscar|búscame|buscame|encuentra)\s+/i, '');
    consulta = consulta.replace(/^(?:información|informacion|datos|detalles)\s+(?:sobre|acerca de|de)\s+/i, '');
    consulta = consulta.replace(/^(?:sobre|acerca de)\s+/i, '');
    consulta = limpiarTermino(consulta) || String(texto || '').trim();
    const docs = buscarBM25(consulta, 5);
    const conceptos = buscarConceptos(consulta, 3);
    const lineas = [`**Resultados locales para «${consulta || texto}»**`, ''];
    if (docs.length) {
      docs.forEach((d, i) => {
        lineas.push(`${i + 1}. **${d.titulo}** — ${d.fuente}`);
        lineas.push(`   «${d.fragmento}»`);
      });
    } else {
      lineas.push('No he encontrado fragmentos en el diccionario ni en los textos cargados.');
    }
    if (conceptos.length) {
      lineas.push('', '**Conceptos relacionados**');
      for (const c of conceptos) {
        const def = c.acepciones[0]?.definicion;
        if (def) lineas.push(`- **${c.lema}**: ${def}`);
      }
    }
    return {
      tipo: 'buscar',
      respuesta: lineas.join('\n'),
      conceptos: conceptos.map((c) => c.id),
      fuentes: [...new Set(docs.map((d) => d.fuente))],
      avisos: ['Búsqueda local sobre el diccionario y los textos cargados; no se ha consultado internet.'],
    };
  }

  async function respuestaInformeWeb(texto) {
    const { instruccion, datos } = separarDatosInforme(texto);
    const tema = limpiarTemaInforme(instruccion);
    const avisos = [];
    if (!tema) {
      return {
        tipo: 'informe_web',
        respuesta: 'Indica el tema del informe. Por ejemplo: «Redacta un informe sobre la fotosíntesis».',
        conceptos: [],
        fuentes: [],
        acciones: [],
        avisos: ['No se ha generado ningún texto porque falta el tema.'],
      };
    }

    const guardar = /en\s+documentos?\b|\bgu[aá]rda(?:lo|la)?\b|\bguardar\b/i.test(texto)
      && !/\b(?:no|sin)\s+(?:quiero\s+)?guard/i.test(texto);
    const sinInternet = /\b(?:sin\s+(?:internet|conexi[oó]n)|solo\s+con\s+(?:estos|mis|los)?\s*(?:datos|documentos|informaci[oó]n)|no\s+busques)\b/i.test(texto);
    const quiereDocumentos = /\b(?:mis\s+documentos|documentos\s+del\s+usuario|mis\s+notas)\b/i.test(texto);
    const terminosBase = [...new Set(tokens(tema).filter((t) => !STOPWORDS.has(t)))];
    const terminos = new Set([...terminosBase, ...expandirTerminos(terminosBase)].map(raiz));
    const fuentes = [];

    const locales = state.documentos
      .filter((d) => d.origen === 'usuario' && d.texto)
      .map((d) => {
        const presentes = new Set(tokens(`${d.titulo} ${d.texto}`).filter((t) => !STOPWORDS.has(t)).map(raiz));
        const score = [...terminos].filter((t) => presentes.has(t)).length;
        return { ...d, score };
      })
      .filter((d) => d.score > 0 || quiereDocumentos)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const documento of locales) {
      const oraciones = extraerOracionesFuente(documento.texto, terminos, 4);
      if (oraciones.length) {
        fuentes.push({
          titulo: documento.titulo || 'Documento del usuario',
          url: '',
          tipo: 'usuario',
          oraciones,
        });
      }
    }

    if (datos) {
      let oraciones = extraerOracionesFuente(datos, terminos, 4);
      if (!oraciones.length) {
        const breve = oracionBreve(datos);
        if (breve) oraciones = [{ texto: breve, score: 1, orden: 0 }];
      }
      if (oraciones.length) {
        fuentes.push({
          titulo: 'Datos aportados por el usuario',
          url: '',
          tipo: 'datos',
          oraciones,
        });
      }
    }

    if (!sinInternet) {
      const busqueda = await searchWeb(tema);
      if (!busqueda.ok) {
        avisos.push(`No se pudo consultar internet: ${busqueda.error || 'sin conexión'}.`);
      } else {
        const candidatos = [];
        const dominios = new Set();
        for (const resultado of busqueda.resultados || []) {
          if (!/^https?:\/\//i.test(String(resultado.enlace || ''))) continue;
          let host = '';
          try {
            host = new URL(resultado.enlace).hostname.replace(/^www\./i, '');
          } catch {
            continue;
          }
          if (!host || dominios.has(host)) continue;
          dominios.add(host);
          candidatos.push(resultado);
          if (candidatos.length >= 4) break;
        }
        const paginas = await Promise.all(candidatos.map(async (resultado) => {
          const pagina = await fetchPageText(resultado.enlace, 12000);
          return pagina.ok
            ? {
              ...resultado,
              texto: pagina.texto,
              titulo: pagina.titulo || resultado.titulo,
              url: pagina.url || resultado.enlace,
              leida: true,
            }
            : {
              ...resultado,
              texto: resultado.descripcion || '',
              titulo: resultado.titulo,
              url: resultado.enlace,
              leida: false,
            };
        }));
        let leidas = 0;
        for (const pagina of paginas) {
          let oraciones = extraerOracionesFuente(pagina.texto, terminos, 4);
          if (!oraciones.length && !pagina.leida) {
            const breve = oracionBreve(pagina.descripcion || pagina.texto);
            if (breve) oraciones = [{ texto: breve, score: 1, orden: 0 }];
          }
          if (!oraciones.length) continue;
          if (pagina.leida) leidas += 1;
          fuentes.push({
            titulo: pagina.titulo || pagina.url,
            url: pagina.url,
            tipo: 'web',
            oraciones,
          });
        }
        if (paginas.length && leidas < paginas.length) {
          avisos.push(`Se leyeron ${leidas} de ${paginas.length} páginas; en las demás se usó el resumen del buscador.`);
        }
      }
    } else {
      avisos.push('No se consultó internet por indicación de la petición; el informe se basa en los datos locales disponibles.');
    }

    // Si hay varias páginas con contenido desarrollado, descartamos las que
    // solo aportan un titular o un fragmento suelto. El umbral sube cuando hay
    // suficientes fuentes con tres o más pasajes.
    const webConTres = fuentes.filter((fuente) => fuente.tipo === 'web' && fuente.oraciones.length >= 3);
    const minimoPasajes = webConTres.length >= 3 ? 3 : 2;
    const fuentesWebFuertes = fuentes.filter((fuente) => fuente.tipo === 'web' && fuente.oraciones.length >= minimoPasajes);
    if (fuentesWebFuertes.length >= 2) {
      for (let i = fuentes.length - 1; i >= 0; i -= 1) {
        if (fuentes[i].tipo === 'web' && fuentes[i].oraciones.length < minimoPasajes) fuentes.splice(i, 1);
      }
    }

    if (!fuentes.length) {
      return {
        tipo: 'informe_web',
        respuesta: `No he podido reunir fuentes suficientes para redactar un informe sobre «${tema}». No voy a inventar el contenido.`,
        conceptos: [],
        fuentes: [],
        acciones: [],
        avisos: ['La búsqueda no devolvió páginas legibles; prueba con otras palabras o revisa la conexión.', ...avisos],
      };
    }
    if (fuentes.length === 1) {
      avisos.push('Solo se ha podido reunir una fuente; el informe es necesariamente parcial.');
    }
    fuentes.forEach((fuente, i) => { fuente.n = i + 1; });

    const listas = fuentes.map((fuente) => fuente.oraciones.slice(0, 3));
    const seleccionadas = [];
    for (let ronda = 0; ronda < 3; ronda += 1) {
      for (let i = 0; i < listas.length; i += 1) {
        const oracion = listas[i][ronda];
        if (!oracion || esOracionDuplicada(oracion.texto, seleccionadas)) continue;
        seleccionadas.push({
          ...oracion,
          fuente: fuentes[i],
          firma: new Set(firmaOracion(oracion.texto).split(' ').filter(Boolean)),
        });
        if (seleccionadas.length >= 12) break;
      }
      if (seleccionadas.length >= 12) break;
    }

    if (!seleccionadas.length) {
      return {
        tipo: 'informe_web',
        respuesta: `He encontrado fuentes sobre «${tema}», pero no pasajes suficientemente claros para construir un informe. No voy a rellenar el texto con datos inventados.`,
        conceptos: [],
        fuentes: fuentes.map((f) => `${f.titulo}${f.url ? ` — ${f.url}` : ''}`),
        acciones: [],
        avisos: ['No se generó texto porque las fuentes no contenían fragmentos utilizables.', ...avisos],
      };
    }

    const redactadas = seleccionadas.map((seleccion) => ({
      ...seleccion,
      texto: conCita(parafrasearOracion(seleccion.texto), seleccion.fuente.n),
    }));
    const introCount = redactadas.length >= 4 ? 2 : 1;
    const introduccion = redactadas.slice(0, introCount);
    const desarrollo = redactadas.slice(introCount, 9);
    const cierre = redactadas.slice(9, 11);
    const recuentoFuentes = fuentes.length === 1 ? '1 fuente consultada' : `${fuentes.length} fuentes consultadas`;
    const lineas = [
      `**Informe: ${capitalizar(tema)}**`,
      '',
      '**Introducción**',
      '',
      `El presente informe ofrece una síntesis sobre ${tema} a partir de ${recuentoFuentes}. Los pasajes se han seleccionado por su relación con el tema, se han reorganizado y se han reformulado con un criterio de estilo uniforme. Las citas entre corchetes remiten a la lista final de fuentes.`,
    ];
    if (introduccion.length) lineas.push('', unirOraciones(introduccion));
    lineas.push('', '**Desarrollo**', '');
    if (desarrollo.length) {
      for (let i = 0; i < desarrollo.length; i += 4) {
        lineas.push(unirOraciones(desarrollo.slice(i, i + 4)));
        lineas.push('');
      }
    } else {
      lineas.push('Las fuentes consultadas no aportan suficientes pasajes para desarrollar el tema en varios párrafos.');
      lineas.push('');
    }
    lineas.push('**Conclusión**', '');
    if (cierre.length) lineas.push(unirOraciones(cierre));
    const sintesisFinal = fuentes.length === 1
      ? `En conjunto, este informe reúne los aspectos principales sobre ${tema} presentes en la fuente consultada.`
      : `En conjunto, este informe reúne los aspectos principales sobre ${tema} presentes en las fuentes consultadas.`;
    lineas.push(`${sintesisFinal} Para ampliar o verificar cualquier dato, conviene consultar los documentos originales citados.`);
    lineas.push('', '**Fuentes**', '');
    for (const fuente of fuentes) {
      const origen = fuente.url
        ? ` — ${fuente.url}`
        : fuente.tipo === 'datos'
          ? ' (datos aportados en el mensaje)'
          : ' (documento del usuario)';
      lineas.push(`${fuente.n}. ${fuente.titulo}${origen}`);
    }

    let accion = null;
    if (guardar) {
      const contenido = lineas.join('\n');
      try {
        accion = await executeOsTool('crear_documento', {
          nombre: `Informe-${slug(tema)}.md`,
          contenido,
        });
        lineas.push('', '**Acción del sistema**', `- Informe guardado en \`${accion.ruta}\``);
      } catch (err) {
        accion = { ok: false, error: err.message };
        lineas.push('', '**Acción del sistema**', '- No se pudo guardar el informe en Documentos.');
      }
    }

    return {
      tipo: 'informe_web',
      respuesta: lineas.join('\n'),
      conceptos: buscarConceptos(tema, 3).map((c) => c.id),
      fuentes: fuentes.map((f) => `${f.titulo}${f.url ? ` — ${f.url}` : ' (documento del usuario)'}`),
      acciones: accion ? [accion] : [],
      avisos: [
        'Informe elaborado mediante búsqueda, selección y parafraseo controlado de las fuentes; no se ha usado ningún modelo neuronal.',
        'Las citas [n] indican la fuente de cada idea; el orden y los conectores son una síntesis editorial.',
        ...avisos,
      ],
    };
  }

  async function respuestaAccion(texto) {
    const original = String(texto || '').trim();
    // El tipo de acción se decide por la cabeza de la orden, no por palabras
    // que aparezcan después en el contenido (p. ej. "preparar el informe").
    const mando = original.match(/^(?:crea|crear|añade|anade|guarda|guardar)\s+(?:una?\s+)?(nota|lista(?:\s+de\s+tareas)?|documento|informe|archivo)\b/i);
    const tipoAccion = mando ? normalizar(mando[1]) : '';
    try {
      if (tipoAccion.includes('nota')) {
        let cuerpo = original
          .replace(/^(?:crea|crear|añade|anade|guarda|guardar)\s+(?:una?\s+)?nota(?:\s+rápida)?\s*/i, '')
          .trim();
        cuerpo = cuerpo.replace(/^(?:que\s+diga|con|sobre|titulada|titulado)\s*[:\-]?\s*/i, '').trim();
        if (!cuerpo) throw new Error('Indica el contenido de la nota.');
        const titulo = (cuerpo.split(/[.\n]/)[0] || 'Nota').slice(0, 60).trim();
        const accion = await executeOsTool('crear_nota', { titulo, texto: cuerpo });
        return {
          tipo: 'accion',
          respuesta: `**Acción realizada**\n\n- Nota creada: **${titulo}**\n- Puedes verla en la aplicación Notas.`,
          conceptos: [],
          fuentes: ['Aplicación Notas'],
          acciones: [accion],
          avisos: ['Acción ejecutada en el perfil local de WonderfulOS.'],
        };
      }

      if (tipoAccion.includes('lista')) {
        let resto = original
          .replace(/^(?:crea|crear|añade|anade|guarda|guardar)\s+(?:una?\s+)?lista(?:\s+de\s+tareas)?\s*/i, '')
          .trim();
        resto = resto.replace(/^(?:para|del|de)\s+/i, '');
        const partes = resto.split(/\s+con\s+/i);
        const tituloParte = partes.length > 1 ? partes.shift() : resto;
        const tareasTexto = partes.join(' con ').trim();
        const titulo = capitalizar(limpiarTermino(tituloParte) || 'Lista de tareas');
        const tareas = tareasTexto
          .split(/\s*(?:,|;|\by\b)\s*/i)
          .map((t) => t.trim())
          .filter(Boolean);
        const accion = await executeOsTool('crear_lista_tareas', {
          titulo,
          tareas: (tareas.length ? tareas : ['Primera tarea']).map((t) => ({ texto: t })),
        });
        return {
          tipo: 'accion',
          respuesta: `**Acción realizada**\n\n- Lista creada: **${accion.titulo}**\n- Tareas iniciales: ${accion.numTareas}`,
          conceptos: [],
          fuentes: ['Aplicación Listas'],
          acciones: [accion],
          avisos: ['Acción ejecutada en el perfil local de WonderfulOS.'],
        };
      }

      let resto = original
        .replace(/^(?:crea|crear|añade|anade|guarda|guardar)\s+(?:un\s+)?(?:documento|informe|archivo)\s*/i, '')
        .trim();
      let titulo = 'Documento';
      let contenido = resto;
      const coincide = resto.match(/^(?:de|sobre|titulado|titulada)\s+(.+?)(?:\s+con\s+|$)/i);
      if (coincide) {
        titulo = capitalizar(limpiarTermino(coincide[1])) || 'Documento';
        contenido = resto.slice(coincide[0].length).replace(/^con\s+/i, '').trim()
          || `# ${titulo}\n\nDocumento creado desde Lógica.`;
      }
      if (!contenido) contenido = 'Documento creado desde Lógica.';
      if (!/^\s*#/.test(contenido)) contenido = `# ${titulo}\n\n${contenido}`;
      const accion = await executeOsTool('crear_documento', {
        nombre: `${slug(titulo)}.md`,
        contenido,
      });
      return {
        tipo: 'accion',
        respuesta: `**Acción realizada**\n\n- Documento creado: \`${accion.ruta}\``,
        conceptos: [],
        fuentes: ['Documentos'],
        acciones: [accion],
        avisos: ['Acción ejecutada en el perfil local de WonderfulOS.'],
      };
    } catch (err) {
      return {
        tipo: 'accion',
        respuesta: `No he podido completar la acción: ${err.message || 'error desconocido'}.`,
        conceptos: [],
        fuentes: [],
        acciones: [],
        avisos: ['No se ha modificado ningún archivo ni aplicación.'],
      };
    }
  }

  async function respuestaInternet(texto) {
    const noticias = esPeticionNoticias(texto);
    const consulta = limpiarConsultaWeb(texto) || 'actualidad';
    let resultados = [];
    let origen = '';

    if (noticias) {
      resultados = await searchNews(consulta);
      if (resultados.length) origen = 'Google News';
    }
    if (!resultados.length) {
      const busqueda = await searchWeb(consulta);
      if (busqueda.ok) {
        resultados = busqueda.resultados || [];
        origen = 'DuckDuckGo';
      } else if (!noticias) {
        return {
          tipo: 'internet',
          respuesta: `No he podido consultar internet para «${consulta}»: ${busqueda.error || 'sin conexión'}. No voy a inventar una respuesta.`,
          conceptos: [],
          fuentes: [],
          avisos: ['La consulta web ha fallado; no se ha usado conocimiento local para simular una respuesta.'],
        };
      }
    }

    if (!resultados.length) {
      return {
        tipo: noticias ? 'noticias' : 'internet',
        respuesta: `No he encontrado resultados web para «${consulta}». No voy a inventar una respuesta.`,
        conceptos: [],
        fuentes: [],
        avisos: ['Consulta web realizada sin resultados; prueba con otras palabras o revisa la conexión.'],
      };
    }

    let extracto = '';
    const principal = resultados.find((r) => /^https?:\/\//i.test(String(r.enlace || '')));
    if (principal) {
      const pagina = await fetchPageText(principal.enlace, 12000);
      if (pagina.ok) extracto = resumenExtractivo(pagina.texto, consulta, 800);
    }

    const lineas = [
      noticias ? `**Actualidad para «${consulta}»**` : `**Resultados web para «${consulta}»**`,
      '',
      `_Consulta realizada ahora${origen ? ` · ${origen}` : ''}._`,
      '',
    ];
    resultados.slice(0, 6).forEach((r, i) => {
      const fecha = formatearFechaWeb(r.fecha);
      lineas.push(`${i + 1}. **${r.titulo || 'Sin título'}**${fecha ? ` — ${fecha}` : ''}`);
      if (r.descripcion) lineas.push(`   ${String(r.descripcion).slice(0, 320)}`);
      if (r.enlace) lineas.push(`   ${r.enlace}`);
    });
    if (extracto) {
      lineas.push('', '**Fragmento de la fuente principal**', extracto);
    }

    const fuentes = [...new Set(resultados
      .slice(0, 6)
      .map((r) => (r.titulo ? `${r.titulo} — ${r.enlace}` : r.enlace))
      .filter(Boolean))];

    let accion = null;
    if (pideInformeWeb(texto)) {
      const informe = [
        `# Informe: ${consulta}`,
        '',
        `Generado por Lógica el ${new Date().toLocaleString('es-ES')} a partir de fuentes web.`,
        '',
        ...lineas,
        '',
        '## Fuentes',
        ...fuentes.map((f) => `- ${f}`),
      ].join('\n');
      try {
        accion = await executeOsTool('crear_documento', {
          nombre: `Informe-${slug(consulta)}.md`,
          contenido: informe,
        });
      } catch (err) {
        accion = { ok: false, error: err.message };
      }
      if (accion.ok) {
        lineas.push('', '**Acción del sistema**', `- Informe guardado en \`${accion.ruta}\``);
      } else {
        lineas.push('', '**Acción del sistema**', '- No se pudo guardar el informe en Documentos.');
      }
    }

    return {
      tipo: noticias ? 'noticias' : 'internet',
      respuesta: lineas.join('\n'),
      conceptos: [],
      fuentes,
      acciones: accion ? [accion] : [],
      avisos: [
        'Información obtenida de internet en el momento de la consulta; puede cambiar.',
        'Se muestran fuentes y fragmentos; no se ha generado una opinión ni se han inventado datos.',
      ],
    };
  }

  async function respuestaLeerUrl(texto) {
    const coincidencia = String(texto || '').match(/https?:\/\/[^\s<>"']+/i);
    const url = coincidencia ? coincidencia[0].replace(/[).,;!?]+$/, '') : '';
    if (!url) {
      return {
        tipo: 'leer_url',
        respuesta: 'No he encontrado una URL válida en la consulta.',
        conceptos: [],
        fuentes: [],
        avisos: ['Indica una dirección que empiece por http:// o https://.'],
      };
    }
    try {
      const destino = new URL(url);
      if (!/^https?:$/.test(destino.protocol)) throw new Error('solo se admiten http:// o https://');
      await assertPublic(destino);
    } catch (err) {
      return {
        tipo: 'leer_url',
        respuesta: `No he podido leer ${url}: ${err.message || 'dirección no permitida'}.`,
        conceptos: [],
        fuentes: [],
        avisos: ['Por seguridad no se leen direcciones locales ni privadas.'],
      };
    }
    const pagina = await fetchPageText(url, 12000);
    if (!pagina.ok) {
      return {
        tipo: 'leer_url',
        respuesta: `No he podido leer ${url}: ${pagina.error || 'error de red'}. No voy a inventar el contenido.`,
        conceptos: [],
        fuentes: [],
        avisos: ['La lectura de la página ha fallado; revisa la URL o la conexión.'],
      };
    }
    const consulta = `${String(texto || '').replace(url, ' ').trim()} ${pagina.titulo || ''}`.trim();
    const resumen = resumenExtractivo(pagina.texto, consulta, 1400);
    return {
      tipo: 'leer_url',
      respuesta: [
        `**${pagina.titulo || 'Página web'}**`,
        '',
        resumen || 'La página no contiene texto extraíble.',
        '',
        `Fuente: ${pagina.url}`,
      ].join('\n'),
      conceptos: [],
      fuentes: [`${pagina.titulo || pagina.url} — ${pagina.url}`],
      avisos: ['Contenido leído de la URL indicada en el momento de la consulta.'],
    };
  }

  function detectarIntencion(texto) {
    const lower = normalizar(texto);
    if (/https?:\/\//i.test(String(texto || ''))) return 'leer_url';
    if (esPeticionInforme(texto)) return 'informe_web';
    if (/(busca|buscar|buscame|consulta|consultar|averigua|averiguar|dime|encuentra)\s+(?:en\s+)?(?:internet|la\s+web|la\s+red|online|google)\b/.test(lower)) return 'internet';
    if (esPeticionNoticias(texto) || esPeticionActual(texto)) return 'internet';
    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(lower)) return 'saludo';
    if (/^(?:crea|crear|anade|añade|guarda|guardar)\s+(?:una?\s+)?(?:nota|lista(?:\s+de\s+tareas)?|documento|informe|archivo)\b/.test(lower)) return 'accion';
    if (/(correo|carta|email|e-mail)/.test(lower)
      && /(redacta|escribe|prepara|haz|borrador|formal|envia)/.test(lower)
      && !/(texto|ensayo|articulo)/.test(lower)) return 'correo';
    if (/(plan|horario|agenda|rutina)/.test(lower)
      && /(haz|prepara|planifica|organiza|semanal|semana)/.test(lower)
      && !/(texto|ensayo|articulo)/.test(lower)) return 'plan';
    if (/(relacion( hay| existe)? entre|que relacion)/.test(lower)) return 'camino';
    if (/(que es|que significa|define|definicion de|dime que es)/.test(lower)) return 'definir';
    if (/\b(es|son)\s+(un|una|unos|unas)\b/.test(lower)) return 'es_un';
    if (/(busca|buscar|informacion sobre|encuentra)/.test(lower)) return 'buscar';
    if (/(explica|explícame|redacta|escribe|desarrolla|ensayo|articulo|expositivo|texto (sobre|expositivo|universitario|academico))/.test(lower)) return 'texto';
    return 'definir';
  }

  function consultar(texto) {
    const entrada = String(texto ?? '').trim();
    if (!entrada) throw new Error('Escribe una consulta.');
    if (entrada.length > 20000) throw new Error('La consulta es demasiado larga.');
    const intencion = detectarIntencion(entrada);
    let resultado;
    switch (intencion) {
      case 'internet':
      case 'leer_url':
      case 'informe_web':
        resultado = {
          tipo: 'herramienta',
          respuesta: 'Esta consulta necesita una herramienta web. Usa consultarConHerramientas() o el endpoint /api/conocimiento/consultar.',
          conceptos: [],
          fuentes: [],
          avisos: ['La consulta síncrona no accede a internet para no bloquear el motor.'],
        };
        break;
      case 'accion':
        resultado = {
          tipo: 'herramienta',
          respuesta: 'Esta consulta requiere ejecutar una acción del sistema. Usa consultarConHerramientas() o el endpoint /api/conocimiento/consultar.',
          conceptos: [],
          fuentes: [],
          avisos: ['La consulta síncrona no modifica aplicaciones ni archivos.'],
        };
        break;
      case 'saludo':
        resultado = {
          tipo: 'saludo',
          respuesta: [
            'Soy el motor simbólico de WonderfulOS. No uso un modelo de lenguaje.',
            '',
            'Puedo:',
            '- definir conceptos y recorrer relaciones;',
            '- comprobar si algo es un/una algo y explicar la inferencia;',
            '- buscar en el diccionario y en los textos cargados;',
            '- redactar correos formales, planes y textos expositivos con plantillas.',
          ].join('\n'),
          conceptos: [],
          fuentes: [],
          avisos: ['Este modo es 100 % simbólico: no hay generación neuronal.'],
        };
        break;
      case 'correo':
        resultado = generarCorreo(entrada);
        break;
      case 'plan':
        resultado = generarPlan(entrada);
        break;
      case 'camino':
        resultado = respuestaCamino(entrada);
        break;
      case 'es_un':
        resultado = respuestaEsUn(entrada);
        break;
      case 'buscar':
        resultado = respuestaBuscar(entrada);
        break;
      case 'texto':
        resultado = generarTexto(entrada);
        break;
      case 'definir':
      default:
        resultado = respuestaDefinir(entrada);
        break;
    }
    return {
      ...resultado,
      modo: 'simbólico',
      modelo: false,
    };
  }

  async function consultarConHerramientas(texto) {
    const entrada = String(texto ?? '').trim();
    if (!entrada) throw new Error('Escribe una consulta.');
    if (entrada.length > 20000) throw new Error('La consulta es demasiado larga.');
    const intencion = detectarIntencion(entrada);
    let resultado;
    if (intencion === 'accion') resultado = await respuestaAccion(entrada);
    else if (intencion === 'informe_web') resultado = await respuestaInformeWeb(entrada);
    else if (intencion === 'internet') resultado = await respuestaInternet(entrada);
    else if (intencion === 'leer_url') resultado = await respuestaLeerUrl(entrada);
    else resultado = consultar(entrada);
    return {
      ...resultado,
      modo: 'simbólico',
      modelo: false,
    };
  }

  function estadisticas() {
    return {
      motor: 'simbólico',
      modelo: false,
      conceptos: state.conceptos.length,
      semilla: state.conceptos.filter((c) => c.origen === 'semilla').length,
      mcr: state.conceptos.filter((c) => c.origen === 'mcr').length,
      usuario: state.conceptos.filter((c) => c.origen === 'usuario').length,
      documentos: state.documentos.length,
      reglas: state.reglas.length,
      hechos: state.hechos.length,
      derivaciones: state.derivaciones.length,
      contradicciones: state.contradicciones.length,
      mcrCargado: state.mcrCargado,
      truncado: state.truncado,
    };
  }

  function ensenarConcepto(datos = {}) {
    const lema = String(datos.lema || '').trim();
    const definicion = String(datos.definicion || '').trim();
    if (!lema || !definicion) throw new Error('Indica al menos lema y definicion.');
    const concepto = normalizarConcepto({
      id: datos.id || slug(lema),
      lema,
      categoria: datos.categoria || 'sustantivo',
      sinonimos: datos.sinonimos || [],
      fuente: datos.fuente || 'Enseñado por el usuario',
      acepciones: [{
        definicion,
        genero: datos.genero || '',
        diferencia: datos.diferencia || '',
        ejemplo: datos.ejemplo || '',
        relaciones: datos.relaciones || [],
      }],
    }, 'usuario');
    const lista = state.usuario.conceptos;
    const i = lista.findIndex((c) => (c.id || slug(c.lema)) === concepto.id);
    if (i >= 0) lista[i] = concepto;
    else lista.push(concepto);
    guardarJson(ficheros.lexicoUsuario, { version: 1, conceptos: lista });
    cargar();
    return { ok: true, concepto, estadisticas: estadisticas() };
  }

  function ensenarRelacion(datos = {}) {
    const origen = String(datos.origen || '').trim();
    const tipo = String(datos.predicado || datos.relacion || datos.tipoRelacion || '').trim();
    const destino = String(datos.destino || '').trim();
    if (!origen || !tipo || !destino) throw new Error('Indica origen, predicado y destino.');
    const lista = state.usuario.relaciones;
    if (!lista.some((r) => r.origen === origen && r.tipo === tipo && r.destino === destino)) {
      lista.push({ origen, tipo, destino, fuente: datos.fuente || 'Enseñado por el usuario' });
      guardarJson(ficheros.relacionesUsuario, { version: 1, relaciones: lista });
      cargar();
    }
    return { ok: true, relacion: { origen, tipo, destino }, estadisticas: estadisticas() };
  }

  function ensenarTexto(datos = {}) {
    const titulo = String(datos.titulo || '').trim();
    const texto = String(datos.texto || '').trim();
    if (!titulo || !texto) throw new Error('Indica titulo y texto.');
    const documento = {
      id: datos.id || `usuario-${randomUUID()}`,
      titulo,
      texto,
      fuente: String(datos.fuente || 'Documento del usuario').trim(),
    };
    const lista = state.usuario.documentos;
    const i = lista.findIndex((d) => d.id === documento.id);
    if (i >= 0) lista[i] = documento;
    else lista.push(documento);
    guardarJson(ficheros.documentosUsuario, { version: 1, documentos: lista });
    cargar();
    return { ok: true, documento, estadisticas: estadisticas() };
  }

  function ensenarRegla(datos = {}) {
    const nombre = String(datos.nombre || '').trim();
    const si = datos.si;
    const entonces = datos.entonces;
    if (!nombre || !Array.isArray(si) || !Array.isArray(entonces)) {
      throw new Error('Indica nombre, si y entonces.');
    }
    const lista = state.usuario.reglas;
    lista.push({ nombre, si, entonces });
    guardarJson(ficheros.reglasUsuario, { version: 1, reglas: lista });
    cargar();
    return { ok: true, regla: { nombre, si, entonces }, estadisticas: estadisticas() };
  }

  function ensenar(datos = {}) {
    const tipo = String(datos.tipo || '').trim();
    if (tipo === 'concepto') return ensenarConcepto(datos);
    if (tipo === 'relacion') return ensenarRelacion(datos);
    if (tipo === 'texto') return ensenarTexto(datos);
    if (tipo === 'regla') return ensenarRegla(datos);
    throw new Error('tipo debe ser concepto, relacion, texto o regla.');
  }

  cargar();

  return {
    consultar,
    consultarConHerramientas,
    buscar: (texto, limite = 5) => buscarBM25(texto, limite),
    definir: (termino) => respuestaDefinir(`¿Qué es ${termino}?`),
    buscarConceptos,
    relacionesDe,
    estadisticas,
    ensenar,
    recargar: cargar,
  };
}

let motorPorDefecto = null;

export function motor() {
  if (!motorPorDefecto) motorPorDefecto = createEngine();
  return motorPorDefecto;
}

export const consultar = (texto) => motor().consultar(texto);
export const consultarConHerramientas = (texto) => motor().consultarConHerramientas(texto);
export const buscar = (texto, limite) => motor().buscar(texto, limite);
export const definir = (termino) => motor().definir(termino);
export const estadisticas = () => motor().estadisticas();
export const ensenar = (datos) => motor().ensenar(datos);
