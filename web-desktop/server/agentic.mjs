// Servicio de Agentic para WonderfulOS:
// Asistente inteligente y automatización del sistema operativo con Ollama (por defecto qwen3:1.7b).
// Automatiza: Documentos, Hojas de cálculo (Cálculo/Excel), Listas de tareas, Notas, Calendario y Archivos.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as store from './store.mjs';
import * as appdata from './appdata.mjs';
import * as ext from './mcp.mjs';
import * as mail from './mail.mjs';

const { DATA, USER } = store;
const CONFIG_FILE = path.join(DATA, 'agentic-config.json');

const DEFAULT_CONFIG = {
  // Modelo para el agente: herramientas, sistema operativo y automatización.
  model: 'qwen3:1.7b',
  // Modelo para redacción: correos, documentos, planes, ideas y creatividad.
  // Gemma 2 2B escribe mejor en español que Qwen3 1.7B con un consumo similar.
  writeModel: 'gemma2:2b',
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  temperature: 0.7,
  writingTemperature: 0.7,
  contextSize: 4096,
  writingContext: 2048,
};

export function getConfig() {
  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      const merged = { ...DEFAULT_CONFIG, ...saved };
      // Limitar el tamaño de contexto si estaba en 8192 para evitar colapsar la RAM y CPU
      if (merged.contextSize > 4096) merged.contextSize = 4096;
      if (!merged.writeModel) merged.writeModel = merged.model;
      if (merged.writingContext > 4096) merged.writingContext = 4096;
      if (merged.writingContext < 512) merged.writingContext = 512;
      return merged;
    } catch { /* config corrupta */ }
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(updates) {
  const current = getConfig();
  const next = { ...current, ...updates };
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ---------- Comunicación con Ollama ----------

export async function checkOllama(ollamaUrl = getConfig().ollamaUrl) {
  const url = ollamaUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { running: false, error: `Ollama respondió ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name || m.model);
    const cfg = getConfig();
    const currentModel = cfg.model;
    const writeModel = cfg.writeModel || cfg.model;
    const installed = (name) => models.some((m) => m === name || m.startsWith(`${name}:`) || name.startsWith(`${m}:`));
    return {
      running: true,
      currentModel,
      isModelInstalled: installed(currentModel),
      writeModel,
      isWriteModelInstalled: installed(writeModel),
      models,
    };
  } catch (err) {
    const cfg = getConfig();
    return {
      running: false,
      error: err.message || 'No se puede conectar con Ollama',
      currentModel: cfg.model,
      isModelInstalled: false,
      writeModel: cfg.writeModel || cfg.model,
      isWriteModelInstalled: false,
      models: [],
    };
  }
}

// Descarga un modelo de la memoria de Ollama. Se usa al cambiar de modo para
// que el agente y la redacción no ocupen RAM a la vez en equipos de 8 GB.
async function unloadModel(ollamaUrl, modelName) {
  if (!modelName) return;
  try {
    await fetch(`${String(ollamaUrl).replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* Ollama no disponible: el chat mostrará el error correspondiente */ }
}

export async function pullModelStream(modelName, res) {
  const cfg = getConfig();
  const url = `${cfg.ollamaUrl.replace(/\/+$/, '')}/api/pull`;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });

  const sendEvt = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName, stream: true }),
    });

    if (!response.ok) {
      sendEvt({ error: `Ollama respondió status ${response.status}` });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const json = JSON.parse(line);
          const percent = json.total ? Math.round(((json.completed || 0) / json.total) * 100) : null;
          sendEvt({ status: json.status, percent, completed: json.completed, total: json.total });
        } catch { /* parse error */ }
      }
    }
    sendEvt({ status: 'success', done: true, model: modelName });
    res.end();
  } catch (err) {
    sendEvt({ error: err.message });
    res.end();
  }
}

// ---------- Herramientas de automatización de WonderfulOS ----------

export const OS_TOOLS_SPEC = [
  {
    type: 'function',
    function: {
      name: 'crear_documento',
      description: 'Crea o sobrescribe un documento de texto o markdown en el disco de WonderfulOS (en /Documentos por defecto).',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del archivo, por ejemplo "Informe.md" o "Ideas.txt"' },
          ruta: { type: 'string', description: 'Ruta completa en WonderfulOS, por ejemplo "/Documentos/Informe.md"' },
          contenido: { type: 'string', description: 'Contenido completo en texto plano o markdown del documento' },
        },
        required: ['contenido'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_documento',
      description: 'Modifica o añade texto a un documento existente en WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta del documento, por ejemplo "/Documentos/Notas.txt"' },
          buscar: { type: 'string', description: 'Texto exacto a buscar para reemplazar (opcional si se da nuevo_contenido)' },
          reemplazar: { type: 'string', description: 'Nuevo texto con el que reemplazar' },
          nuevo_contenido: { type: 'string', description: 'Opcional: contenido completo si se reescribe entero' },
        },
        required: ['ruta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_documento',
      description: 'Lee el contenido de un archivo de texto o documento de WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta del documento, por ejemplo "/Documentos/Bienvenida.txt"' },
        },
        required: ['ruta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_calculo',
      description: 'Crea una hoja de cálculo (Excel / Cálculo) en WonderfulOS con filas, columnas y fórmulas (por ejemplo =SUMA(B2:B10), =PROMEDIO, etc.). Formato CSV compatible con Cálculo.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del archivo, por ejemplo "Presupuesto.csv" o "Ventas.csv"' },
          ruta: { type: 'string', description: 'Ruta completa en WonderfulOS, por ejemplo "/Documentos/Presupuesto.csv"' },
          cabeceras: { type: 'array', items: { type: 'string' }, description: 'Lista de nombres de columna' },
          filas: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } },
            description: 'Matriz de filas y celdas. Puede contener números, textos o fórmulas (como =SUMA(B2:B5))',
          },
        },
        required: ['cabeceras', 'filas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_lista_tareas',
      description: 'Crea una nueva lista de tareas en la aplicación Listas de WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título de la lista (ej: "Proyecto Wonderful", "Compras")' },
          emoji: { type: 'string', description: 'Emoji representativo (ej: 📝, 💼, 🛒, 🎯)' },
          tareas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                texto: { type: 'string', description: 'Descripción de la tarea' },
                due: { type: 'string', description: 'Fecha y hora de vencimiento opcional en formato ISO (YYYY-MM-DDTHH:mm)' },
              },
              required: ['texto'],
            },
            description: 'Lista de tareas iniciales',
          },
        },
        required: ['titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agregar_tarea',
      description: 'Añade una tarea a una lista existente o por título en la app Listas de WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          lista_titulo: { type: 'string', description: 'Título de la lista a la que añadir la tarea' },
          texto: { type: 'string', description: 'Texto de la tarea' },
          due: { type: 'string', description: 'Fecha de vencimiento opcional ISO' },
        },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_nota',
      description: 'Crea una nota rápida en la app Notas de WonderfulOS con color y opción de fijar.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título de la nota' },
          texto: { type: 'string', description: 'Cuerpo completo de la nota' },
          color: { type: 'string', description: 'Color hexadecimal opcional (ej: #fde68a amarillo, #bbf7d0 verde, #bfdbfe azul, #fbcfe8 rosa)' },
          fijada: { type: 'boolean', description: 'Si la nota debe aparecer fijada arriba' },
        },
        required: ['titulo', 'texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_evento_calendario',
      description: 'Crea un evento en la app Calendario de WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Nombre del evento' },
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          hora_inicio: { type: 'string', description: 'Hora de inicio HH:mm (ej: 10:00)' },
          hora_fin: { type: 'string', description: 'Hora de fin HH:mm (ej: 11:30)' },
          color: { type: 'string', description: 'Color opcional (ej: #ec4899)' },
        },
        required: ['titulo', 'fecha'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'listar_archivos',
      description: 'Lista los archivos y carpetas del disco local de WonderfulOS.',
      parameters: {
        type: 'object',
        properties: {
          carpeta: { type: 'string', description: 'Carpeta a listar, por ejemplo "/" o "/Documentos"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_internet',
      description: 'Busca información en internet en tiempo real (noticias, datos, documentación, precios, tutoriales, etc.) a través de DuckDuckGo.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Términos de búsqueda o pregunta para buscar en internet' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_imagenes',
      description: 'Busca fotografías e imágenes en internet de cualquier tema o elemento, devolviendo URLs directas y de alta resolución listas para descargar a /Imágenes.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Tema, objeto o descripción visual de la imagen a buscar (ej: "Planeta Tierra", "Gato", "Coche deportivo", "Paisaje")' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_pagina_web',
      description: 'Lee y extrae el texto limpio y legible de cualquier página web o artículo a partir de su URL para resumir, analizar o copiar su contenido.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Dirección URL completa de la página web (ej: https://es.wikipedia.org/...)' },
          longitud_max: { type: 'number', description: 'Longitud máxima de caracteres a extraer (por defecto 6000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'descargar_archivo',
      description: 'Descarga un archivo o imagen de internet a partir de una URL y lo guarda directamente en el disco de WonderfulOS (por defecto en /Imágenes para fotos o en /Descargas para documentos y otros archivos).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL directa del archivo o imagen a descargar' },
          carpeta: { type: 'string', description: 'Carpeta destino en WonderfulOS (ej: /Descargas, /Imágenes o /Documentos)' },
          nombre_archivo: { type: 'string', description: 'Nombre opcional con el que guardar el archivo (ej: foto.jpg o informe.pdf)' },
        },
        required: ['url'],
      },
    },
  },
  // ---------- Correo ----------
  {
    type: 'function',
    function: {
      name: 'listar_correos',
      description: 'Lista los correos de la app Correo de una carpeta (por defecto Recibidos). Devuelve id, remitente, asunto, fecha y extracto.',
      parameters: {
        type: 'object',
        properties: {
          carpeta: { type: 'string', enum: ['inbox', 'drafts', 'outbox', 'sent', 'archive', 'trash', 'all'], description: 'inbox=Recibidos, drafts=Borradores, outbox=Bandeja de salida, sent=Enviados, archive=Archivo, trash=Papelera, all=todas menos Papelera' },
          no_leidos: { type: 'boolean', description: 'Solo los no leídos' },
          limite: { type: 'number', description: 'Máximo de correos (por defecto 15)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_correos',
      description: 'Busca correos por texto en remitente, destinatario, asunto o cuerpo.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Texto a buscar (ej: "factura", "juan@empresa.com")' },
          carpeta: { type: 'string', enum: ['inbox', 'drafts', 'outbox', 'sent', 'archive', 'trash', 'all'], description: 'Carpeta donde buscar (por defecto all)' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leer_correo',
      description: 'Lee el contenido completo de un correo por su id y lo marca como leído.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Id del correo (los 8 caracteres que da listar_correos)' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_correo',
      description: 'Escribe un correo y lo guarda como borrador en Correo (no lo envía).',
      parameters: {
        type: 'object',
        properties: {
          para: { type: 'string', description: 'Destinatario(s), separados por comas' },
          asunto: { type: 'string', description: 'Asunto' },
          cuerpo: { type: 'string', description: 'Texto completo del correo' },
          cc: { type: 'string', description: 'Copia (opcional)' },
        },
        required: ['asunto', 'cuerpo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_correo',
      description: 'Envía un correo. Usa "id" para enviar un borrador existente, o "para", "asunto" y "cuerpo" para enviar uno nuevo directamente.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id del borrador a enviar (opcional)' },
          para: { type: 'string', description: 'Destinatario(s)' },
          asunto: { type: 'string', description: 'Asunto' },
          cuerpo: { type: 'string', description: 'Texto del correo' },
          cc: { type: 'string', description: 'Copia (opcional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'borrar_correo',
      description: 'Mueve un correo a la Papelera. Si ya está en la Papelera o definitivo=true, lo elimina para siempre.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id del correo' },
          definitivo: { type: 'boolean', description: 'Borrar para siempre sin pasar por la Papelera' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mover_correo',
      description: 'Mueve un correo a otra carpeta (archivar, restaurar de la papelera, etc.) o lo marca como leído/no leído/destacado.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id del correo' },
          carpeta: { type: 'string', enum: ['inbox', 'drafts', 'sent', 'archive', 'trash'], description: 'Carpeta destino (opcional)' },
          leido: { type: 'boolean', description: 'Marcar como leído (true) o no leído (false)' },
          destacado: { type: 'boolean', description: 'Marcar o quitar estrella' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vaciar_papelera',
      description: 'Elimina para siempre todos los correos de la Papelera (u otra carpeta indicada).',
      parameters: { type: 'object', properties: { carpeta: { type: 'string', enum: ['trash', 'drafts', 'outbox', 'sent', 'archive', 'inbox'], description: 'Carpeta a vaciar (por defecto trash)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sincronizar_correo',
      description: 'Descarga los correos nuevos del servidor y reintenta enviar la Bandeja de salida.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// Ejecutor de las herramientas contra el backend de WonderfulOS
export async function executeOsTool(name, args) {
  try {
    switch (name) {
      case 'crear_documento': {
        let p = args.ruta || (args.nombre ? `/Documentos/${args.nombre}` : `/Documentos/Documento-${Date.now()}.md`);
        if (!p.startsWith('/')) p = '/' + p;
        if (!p.startsWith('/Documentos') && !p.startsWith('/Descargas') && !p.startsWith('/Imágenes')) {
          p = `/Documentos/${p.replace(/^\/+/, '')}`;
        }
        store.applyOps(USER, [{
          op: 'set',
          path: p,
          node: { type: 'file', content: String(args.contenido || '') },
        }]);
        return { ok: true, accion: 'crear_documento', ruta: p, bytes: Buffer.byteLength(String(args.contenido || '')) };
      }

function getStoredFileContent(node) {
  if (!node) return '';
  if (typeof node.content === 'string') return node.content;
  if (node.blob) {
    const bp = path.join(store.DISK, node.blob);
    if (existsSync(bp)) {
      try { return readFileSync(bp, 'utf8'); } catch {}
    }
  }
  return '';
}

function resolveDocPath(rawPath) {
  let p = String(rawPath || '').trim();
  if (!p) return null;
  const t = store.tree(USER);
  if (t[p] && t[p].type === 'file') return p;
  if (!p.startsWith('/')) p = '/' + p;
  if (t[p] && t[p].type === 'file') return p;
  const docP = p.startsWith('/Documentos/') ? p : `/Documentos/${p.replace(/^\/+/, '')}`;
  if (t[docP] && t[docP].type === 'file') return docP;
  const base = path.basename(p).toLowerCase();
  const found = Object.keys(t).find((k) => t[k]?.type === 'file' && path.basename(k).toLowerCase() === base);
  if (found) return found;
  return docP;
}

      case 'editar_documento': {
        const p = resolveDocPath(args.ruta);
        const current = store.tree(USER)[p];
        if (!current || current.type !== 'file') {
          return { ok: false, error: `No existe el documento ${args.ruta}` };
        }
        const body = getStoredFileContent(current);
        let nextContent = '';
        if (args.nuevo_contenido !== undefined) {
          nextContent = String(args.nuevo_contenido);
        } else if (args.buscar !== undefined) {
          if (!body.includes(args.buscar)) {
            return { ok: false, error: `No se encontró el texto buscado en ${p}` };
          }
          nextContent = body.replace(args.buscar, args.reemplazar || '');
        } else {
          return { ok: false, error: 'Se requiere "buscar" y "reemplazar" o "nuevo_contenido"' };
        }
        store.applyOps(USER, [{
          op: 'set',
          path: p,
          node: { type: 'file', content: nextContent },
        }]);
        return { ok: true, accion: 'editar_documento', ruta: p };
      }

      case 'leer_documento': {
        const p = resolveDocPath(args.ruta);
        const node = store.tree(USER)[p];
        if (!node) return { ok: false, error: `No existe ${args.ruta}` };
        if (node.type === 'dir') return { ok: false, error: `${p} es una carpeta` };
        return { ok: true, accion: 'leer_documento', ruta: p, contenido: getStoredFileContent(node) || '(archivo binario o vacío)' };
      }

      case 'crear_calculo': {
        let p = args.ruta || (args.nombre ? `/Documentos/${args.nombre}` : `/Documentos/Hoja-${Date.now()}.csv`);
        if (!p.endsWith('.csv')) p += '.csv';
        if (!p.startsWith('/Documentos')) p = `/Documentos/${p.replace(/^\/+/, '')}`;

        const cabeceras = Array.isArray(args.cabeceras) ? args.cabeceras : [];
        const filas = Array.isArray(args.filas) ? args.filas : [];

        // Generar formato CSV limpio (con comillas si hay comas o fórmulas)
        const formatRow = (row) => row.map((cell) => {
          const s = String(cell ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replaceAll('"', '""')}"` : s;
        }).join(',');

        const lines = [formatRow(cabeceras)];
        for (const fila of filas) lines.push(formatRow(fila));
        const csvContent = lines.join('\n');

        store.applyOps(USER, [{
          op: 'set',
          path: p,
          node: { type: 'file', content: csvContent },
        }]);
        return { ok: true, accion: 'crear_calculo', ruta: p, filas: filas.length, columnas: cabeceras.length };
      }

      case 'crear_lista_tareas': {
        const tasksObj = {};
        if (Array.isArray(args.tareas)) {
          for (const item of args.tareas) {
            const tid = randomUUID().slice(0, 8);
            tasksObj[tid] = {
              id: tid,
              text: String(item.texto || item.text || 'Tarea'),
              done: false,
              due: item.due || null,
              created: Date.now(),
            };
          }
        }
        const doc = appdata.create(USER, 'listas', {
          title: String(args.titulo || 'Nueva lista'),
          emoji: args.emoji || '📝',
          tasks: tasksObj,
          created: Date.now(),
        });
        return { ok: true, accion: 'crear_lista_tareas', id: doc.id, titulo: doc.data.title, numTareas: Object.keys(tasksObj).length };
      }

      case 'agregar_tarea': {
        const lists = appdata.list(USER, 'listas');
        let targetList = null;
        if (args.lista_titulo) {
          targetList = lists.find((l) => (l.data.title || '').toLowerCase() === args.lista_titulo.toLowerCase());
        }
        if (!targetList && lists.length > 0) targetList = lists[0];
        if (!targetList) {
          targetList = appdata.create(USER, 'listas', { title: args.lista_titulo || 'Tareas', emoji: '📝', tasks: {}, created: Date.now() });
        }
        const tid = randomUUID().slice(0, 8);
        const task = { id: tid, text: String(args.texto), done: false, due: args.due || null, created: Date.now() };
        appdata.patch(USER, 'listas', targetList.id, [{ op: 'set', path: ['tasks', tid], value: task }]);
        return { ok: true, accion: 'agregar_tarea', lista: targetList.data.title, tarea: task.text };
      }

      case 'crear_nota': {
        const doc = appdata.create(USER, 'notas', {
          title: String(args.titulo || 'Nota'),
          body: String(args.texto || ''),
          color: args.color || '#fde68a',
          pinned: Boolean(args.fijada),
          created: Date.now(),
        });
        return { ok: true, accion: 'crear_nota', id: doc.id, titulo: doc.data.title };
      }

      case 'crear_evento_calendario': {
        const doc = appdata.create(USER, 'calendario', {
          title: String(args.titulo || 'Evento'),
          date: String(args.fecha || new Date().toISOString().slice(0, 10)),
          start: args.hora_inicio || '09:00',
          end: args.hora_fin || '10:00',
          color: args.color || '#ec4899',
          created: Date.now(),
        });
        return { ok: true, accion: 'crear_evento_calendario', id: doc.id, titulo: doc.data.title };
      }


      case 'listar_archivos': {
        const t = store.tree(USER);
        const folder = args.carpeta || '/Documentos';
        const items = Object.entries(t)
          .filter(([p]) => p !== '/' && (folder === '/' ? !p.slice(1).includes('/') : p.startsWith(folder) && p !== folder))
          .map(([p, node]) => ({ path: p, type: node.type, size: node.size || (node.content ? node.content.length : 0) }));
        return { ok: true, accion: 'listar_archivos', carpeta: folder, elementos: items.slice(0, 40) };
      }

      case 'buscar_internet': {
        return await searchWeb(args.consulta);
      }

      case 'buscar_imagenes': {
        return await searchImages(args.consulta);
      }

      case 'leer_pagina_web': {
        return await fetchPageText(args.url, args.longitud_max || 6000);
      }

      case 'descargar_archivo': {
        return await downloadFileToOs(args.url, {
          carpeta: args.carpeta,
          nombre_archivo: args.nombre_archivo,
        });
      }

      // ---------- Correo ----------
      case 'listar_correos': {
        const carpeta = args.carpeta || 'inbox';
        const items = mail.list({ folder: carpeta, unread: Boolean(args.no_leidos), limit: args.limite || 15 });
        return { ok: true, accion: 'listar_correos', carpeta, total: items.length, correos: items.map((d) => mail.summary(d)) };
      }
      case 'buscar_correos': {
        const items = mail.list({ folder: args.carpeta || 'all', query: args.consulta, limit: 15 });
        return { ok: true, accion: 'buscar_correos', consulta: args.consulta, total: items.length, correos: items.map((d) => mail.summary(d)) };
      }
      case 'leer_correo': {
        const d = mail.find(args.id);
        if (!d.data.read) mail.mark(d.id, { read: true });
        return { ok: true, accion: 'leer_correo', correo: { ...mail.summary(d, true), cuerpo: String(d.data.body || '').slice(0, 4000) } };
      }
      case 'crear_correo': {
        const d = mail.createDraft({ to: args.para || '', cc: args.cc || '', subject: args.asunto || '', body: args.cuerpo || '' });
        return { ok: true, accion: 'crear_correo', id: d.id.slice(0, 8), para: d.data.to, asunto: d.data.subject, carpeta: 'drafts' };
      }
      case 'enviar_correo': {
        const r = await mail.send({ id: args.id, to: args.para, cc: args.cc, subject: args.asunto, body: args.cuerpo });
        return { ...r, accion: 'enviar_correo' };
      }
      case 'borrar_correo': {
        return { ...mail.trash(args.id, Boolean(args.definitivo)), accion: 'borrar_correo' };
      }
      case 'mover_correo': {
        let d = mail.find(args.id);
        if (args.carpeta) d = args.carpeta === 'inbox' && d.data.folder === 'trash' ? mail.restore(d.id) : mail.move(d.id, args.carpeta);
        if (args.leido !== undefined || args.destacado !== undefined) d = mail.mark(d.id, { read: args.leido, starred: args.destacado });
        return { ok: true, accion: 'mover_correo', id: d.id.slice(0, 8), carpeta: d.data.folder, leido: d.data.read, destacado: d.data.starred };
      }
      case 'vaciar_papelera': {
        return { ...mail.emptyFolder(args.carpeta || 'trash'), accion: 'vaciar_papelera' };
      }
      case 'sincronizar_correo': {
        return { ...(await mail.sync()), accion: 'sincronizar_correo' };
      }

      default:
        return { ok: false, error: `Herramienta desconocida: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- Funciones auxiliares de Internet y Web ----------

export async function searchWeb(q) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`El buscador respondió ${res.status}`);
    const html = await res.text();
    const results = [];
    const blockRegex = /<div[^>]*class="[^"]*result\s+results_links[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < 6) {
      const block = match[1];
      const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i);
      if (linkMatch) {
        let href = linkMatch[1];
        if (href.includes('uddg=')) {
          try {
            const u = new URL(href, 'https://duckduckgo.com');
            href = decodeURIComponent(u.searchParams.get('uddg') || href);
          } catch {}
        }
        const title = decodeHtmlEntities(linkMatch[2].replace(/<[^>]*>/g, '').trim());
        const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
        if (title && href) {
          results.push({ titulo: title, enlace: href, descripcion: snippet });
        }
      }
    }
    return { ok: true, accion: 'buscar_internet', consulta: q, total: results.length, resultados: results };
  } catch (err) {
    return { ok: false, error: err.message, consulta: q, resultados: [] };
  }
}

export async function searchImages(q) {
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=8&prop=pageimages|extracts&exintro&explaintext&exchars=160&pithumbsize=1280&format=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WonderfulOS/1.0 (https://wonderful.os; contact@wonderful.os)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`El buscador de imágenes respondió ${res.status}`);
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    const images = [];

    for (const p of pages) {
      if (p.thumbnail?.source) {
        images.push({
          titulo: p.title,
          url_imagen: p.thumbnail.source,
          ancho: p.thumbnail.width,
          alto: p.thumbnail.height,
          descripcion: (p.extract || p.title).slice(0, 120),
        });
      }
    }

    return {
      ok: true,
      accion: 'buscar_imagenes',
      consulta: q,
      total: images.length,
      imagenes: images,
    };
  } catch (err) {
    return { ok: false, error: err.message, consulta: q, imagenes: [] };
  }
}

const HTML_ENTITIES = Object.freeze({
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  euro: '€', deg: '°', times: '×', divide: '÷', ordm: 'º', ordf: 'ª',
  iexcl: '¡', iquest: '¿', copy: '©', reg: '®',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
});

function decodeHtmlEntities(texto) {
  return String(texto ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (marca, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return marca;
      }
    })
    .replace(/&#(\d+);/g, (marca, decimal) => {
      try {
        return String.fromCodePoint(Number(decimal));
      } catch {
        return marca;
      }
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (marca, nombre) => HTML_ENTITIES[nombre] ?? marca);
}

export async function fetchPageText(url, maxLength = 6000) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    let clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

    clean = clean
      .replace(/<(?:h[1-6]|p|div|li|tr)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    clean = decodeHtmlEntities(clean);

    const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let text = lines.join('\n');
    const tituloBloqueado = /client challenge|access denied|captcha|just a moment/i.test(title);
    const textoBloqueado = /(?:ad blockers|enable javascript|javascript is disabled|verify (?:that )?you are human|checking your browser|unusual traffic)/i.test(text);
    if (tituloBloqueado || (textoBloqueado && text.length < 3000)) {
      return {
        ok: false,
        accion: 'leer_pagina_web',
        url,
        titulo: title,
        error: 'La página ha bloqueado la lectura automática.',
        bloqueada: true,
      };
    }
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '\n\n[...Contenido web truncado para el contexto...]';
    }

    return { ok: true, accion: 'leer_pagina_web', url, titulo: title, texto: text, caracteres: text.length };
  } catch (err) {
    return { ok: false, error: err.message, url };
  }
}

export async function downloadFileToOs(url, options = {}) {
  try {
    let targetUrl = url;
    let res = null;
    let fetchError = null;

    try {
      res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      fetchError = e;
    }

    // Si la URL directa dio 404, error de red o no es directa, recuperar automáticamente si se buscaba una imagen
    if (!res || !res.ok) {
      const isImgQuery = options.carpeta === '/Imágenes' || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(options.nombre_archivo || url);
      let topic = options.nombre_archivo?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || '';
      if (!topic || topic.length < 3) {
        try {
          topic = path.basename(new URL(url).pathname).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        } catch {}
      }
      if (!topic || topic.length < 3) topic = 'Paisaje Fondo de Pantalla';

      if (isImgQuery || res?.status === 404) {
        const imgSearch = await searchImages(topic);
        if (imgSearch.ok && imgSearch.imagenes?.length > 0) {
          targetUrl = imgSearch.imagenes[0].url_imagen;
          res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
          });
        }
      }
    }

    if (!res || !res.ok) {
      throw new Error(`Error HTTP al descargar: ${res ? res.status : (fetchError?.message || 'Error de conexión')}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';

    let fileName = options.nombre_archivo;
    if (!fileName) {
      try {
        const u = new URL(url);
        fileName = path.basename(u.pathname);
      } catch {}
    }
    if (!fileName || fileName === '/' || !fileName.includes('.')) {
      let ext = 'bin';
      if (mime.includes('jpeg')) ext = 'jpg';
      else if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('svg')) ext = 'svg';
      else if (mime.includes('pdf')) ext = 'pdf';
      else if (mime.includes('json')) ext = 'json';
      else if (mime.includes('csv')) ext = 'csv';
      else if (mime.includes('html')) ext = 'html';
      else if (mime.includes('text')) ext = 'txt';
      fileName = `descarga-${Date.now()}.${ext}`;
    }

    const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName);
    let dir = options.carpeta || (isImage ? '/Imágenes' : '/Descargas');
    dir = store.normalize(dir);

    const t = store.tree(USER);
    if (!t[dir]) {
      store.applyOps(USER, [{ op: 'set', path: dir, node: { type: 'dir', mtime: Date.now() } }]);
    }

    let finalPath = `${dir === '/' ? '' : dir}/${fileName}`;
    if (t[finalPath]) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      let i = 2;
      while (t[`${dir === '/' ? '' : dir}/${base}-${i}${ext}`]) i++;
      finalPath = `${dir === '/' ? '' : dir}/${base}-${i}${ext}`;
    }

    const { id } = store.prepareUpload(USER, finalPath, buffer.length);
    writeFileSync(store.blobPath(id), buffer);
    store.finishUpload(USER, finalPath, id, buffer.length, mime);

    return {
      ok: true,
      accion: 'descargar_archivo',
      ruta: finalPath,
      nombre: path.basename(finalPath),
      tamano: buffer.length,
      mime,
      url,
    };
  } catch (err) {
    return { ok: false, error: err.message, url };
  }
}

// Formatear el resultado de la herramienta de forma limpia y compacta para el modelo
function formatToolResultForModel(name, result) {
  if (!result || !result.ok) {
    return `Error al ejecutar ${name}: ${result?.error || 'fallo desconocido'}`;
  }
  if (name === 'buscar_internet') {
    if (!result.resultados || result.resultados.length === 0) {
      return `Búsqueda en internet para "${result.consulta}": No se encontraron resultados.`;
    }
    const items = result.resultados.slice(0, 5).map((r, i) => `${i + 1}. **${r.titulo}**\n   Enlace: ${r.enlace}\n   Resumen: ${r.descripcion}`);
    return `Resultados de búsqueda en internet para "${result.consulta}":\n\n${items.join('\n\n')}`;
  }
  if (name === 'buscar_imagenes') {
    if (!result.imagenes || result.imagenes.length === 0) {
      return `Búsqueda de imágenes para "${result.consulta}": No se encontraron imágenes disponibles.`;
    }
    const items = result.imagenes.slice(0, 4).map((img, i) => `${i + 1}. **${img.titulo}**\n   URL directa: ${img.url_imagen}\n   Descripción: ${img.descripcion}`);
    return `Imágenes encontradas para "${result.consulta}":\n\n${items.join('\n\n')}\n\nPuedes descargar cualquiera de estas URLs directas con la herramienta descargar_archivo a /Imágenes.`;
  }
  if (name === 'leer_pagina_web') {
    return `Contenido extraído de ${result.url} (Título: ${result.titulo || 'Web'}):\n\n${(result.texto || '').slice(0, 3500)}`;
  }
  if (name === 'descargar_archivo') {
    return `Archivo descargado con éxito y guardado en: ${result.ruta} (${result.tamano} bytes, tipo ${result.mime})`;
  }
  if (name === 'listar_correos' || name === 'buscar_correos') {
    if (!result.correos?.length) return name === 'buscar_correos' ? `No hay correos que coincidan con "${result.consulta}".` : `La carpeta ${result.carpeta} está vacía.`;
    const items = result.correos.map((c) => `- [${c.id}] ${c.leido ? '' : '(NO LEÍDO) '}${c.destacado ? '★ ' : ''}${c.fecha} · De: ${c.de} · Para: ${c.para} · Asunto: ${c.asunto} · ${c.extracto}`);
    return `${result.total} correos${result.consulta ? ` para "${result.consulta}"` : ` en ${result.carpeta}`}:\n${items.join('\n')}`;
  }
  if (name === 'leer_correo') {
    const c = result.correo;
    return `Correo [${c.id}] (${c.carpeta})\nDe: ${c.de}\nPara: ${c.para}\nFecha: ${c.fecha}\nAsunto: ${c.asunto}\n\n${c.cuerpo}`;
  }
  return JSON.stringify(result);
}

// ---------- Chat y bucle de agentes con Streaming SSE ----------

const SYSTEM_PROMPT = `Eres Agentic, el agente inteligente integrado en WonderfulOS.
Tienes capacidad para automatizar el sistema operativo, navegar por internet y utilizar sus aplicaciones:
- Búsqueda en internet: buscar información en tiempo real en la web con buscar_internet.
- Búsqueda de imágenes: buscar fotos e imágenes con URLs directas mediante buscar_imagenes.
- Lectura y copia de webs: leer y extraer artículos o texto limpio de páginas web con leer_pagina_web para resumirlos, copiarlos o utilizarlos.
- Descarga de archivos e imágenes: descargar fotos a /Imágenes y archivos a /Descargas con descargar_archivo. Si buscas una imagen para descargar, primero usa buscar_imagenes para obtener una URL directa de imagen que funcione y luego descargar_archivo.
- Texto y Documentos: crear y editar archivos (.txt, .md) en /Documentos.
- Cálculo (Excel / Hojas de cálculo): crear hojas de cálculo (.csv) con filas y fórmulas como =SUMA(B2:B5), =PROMEDIO, etc.
- Listas de tareas: crear listas y añadir tareas con fechas de vencimiento.
- Notas: crear notas rápidas con títulos y colores.
- Calendario: crear eventos con fecha y hora.
- Correo: listar_correos, buscar_correos, leer_correo, crear_correo (borrador), enviar_correo, borrar_correo (a la Papelera o definitivo), mover_correo (archivar, restaurar, marcar leído/destacado), vaciar_papelera y sincronizar_correo. Los ids de correo son los 8 caracteres que devuelven listar_correos o buscar_correos: lista o busca primero si no conoces el id. Antes de enviar un correo que el usuario no haya dictado palabra por palabra, crea el borrador con crear_correo y envíalo solo si el usuario lo pide.
- Archivos: leer y explorar los archivos del disco local.
- MCP y skills externas: el usuario puede conectar cualquier servidor MCP y cualquier skill. Usa esas herramientas cuando encajen con la petición.

REGLAS DE ACTUACIÓN:
1. Responde SIEMPRE en español con tono claro, servicial y profesional.
2. Sé conciso y directo en tu razonamiento interno y respuesta final para responder con rapidez.
3. Si el usuario te pide buscar información en internet, leer una página web, o descargar un archivo o imagen, EJECUTA buscar_internet, leer_pagina_web o descargar_archivo.
4. Si el usuario te pide buscar y guardar la información en un documento o descargar una imagen, puedes encadenar herramientas: buscar o leer la web y luego crear_documento o descargar_archivo.
5. Si el usuario te pide crear o modificar algo en el sistema operativo, EJECUTA LA HERRAMIENTA CORRESPONDIENTE. No te limites a decir cómo hacerlo; hazlo tú mismo de verdad.
6. Al crear hojas de cálculo, pon siempre encabezados claros en la primera fila y usa fórmulas adecuadas si hay números que sumar o calcular.
7. Una vez ejecutada la herramienta, confirma brevemente en una frase agradable lo que has hecho y el enlace, archivo o tarea creada.`;

const WRITING_SYSTEM_PROMPT = `Eres Redacción, el asistente de escritura, planificación y creatividad de WonderfulOS.
Trabajas en español de España. Tu prioridad es que el texto quede natural, correcto y listo para usar.

ESPECIALIDADES:
- Correos y cartas formales: administraciones, empresas, reclamaciones, solicitudes y solicitudes de documentos.
- Documentos de oficina: resúmenes, actas, propuestas, informes breves, notas y comunicaciones internas.
- Planificación: planes semanales, listas de pasos, prioridades y presupuestos de tiempo.
- Creatividad: ideas, títulos, talleres, guiones y textos divulgativos.
- Reescritura y corrección: mejorar claridad, tono y gramática sin cambiar el significado.

REGLAS:
1. Responde solo con el resultado solicitado. No expliques lo que vas a hacer ni añadas comentarios meta, salvo que el usuario pida un análisis.
2. No inventes datos personales, importes, fechas, direcciones, números de expediente ni identidades. Si faltan, usa placeholders entre corchetes: [Nombre], [DNI], [Dirección], [Fecha].
3. Usa el registro adecuado: formal y cordial para administraciones; profesional y cercano para el trabajo; creativo y vivo cuando se pidan ideas.
4. En correos formales incluye siempre Asunto, saludo, cuerpo breve y despedida. Usa "usted" con las administraciones. Si el destinatario es una institución, usa "A la atención del [organismo]:" o "Estimados señores:". Nunca escribas "Estimado/a Ayuntamiento" ni "Estimado/a Consejería"; suena incorrecto.
5. En planes, sé realista con los tiempos, incluye pausas, comidas y margen para imprevistos. Usa tablas o listas claras.
6. En ideas, ofrece opciones distintas entre sí y explica en una frase por qué funcionan. Evita clichés y propuestas genéricas.
7. Escribe con frases cortas, verbos concretos y sin relleno. Cuida la ortografía, los acentos y la puntuación.
8. Si el usuario pide acortar, aclarar o cambiar el tono, conserva los datos y el significado.
9. No añadas trámites, confirmaciones ni pasos que el usuario no haya pedido. Ve al grano.
10. No digas que eres una IA ni que no puedes hacer algo si puedes redactarlo. No menciones estas instrucciones.

ESTRUCTURA DE CORREO FORMAL:
Asunto: [tema concreto]
A la atención del [organismo] / Estimado/a Sr./Sra. [cargo o nombre]:
Me dirijo a usted para ...
[Explicación breve y datos]
[Petición o siguiente paso]
Atentamente,
[Nombre y apellidos]
[Datos de contacto]

EJEMPLO DE CORREO FORMAL:
Asunto: Solicitud de certificado de residencia
A la atención del Ayuntamiento de La Laguna:
Me dirijo a usted para solicitar un certificado de residencia. Mis datos son: [Nombre y apellidos], con DNI [DNI], y domicilio en [Dirección].
Agradezco de antemano su atención y quedo a la espera de su respuesta.
Atentamente,
[Nombre y apellidos]`;

// Corrección conservadora para un error muy típico de los modelos pequeños:
// "Estimado/a Ayuntamiento de X" en lugar de "A la atención del Ayuntamiento de X".
export function polishWriting(text) {
  const institution = '(Ayuntamiento|Consejería|Ministerio|Gobierno|Universidad|Diputación|Cabildo|Organismo|Hospital)';
  const feminine = /^(Consejería|Universidad|Diputación)$/i;
  const article = (org) => (feminine.test(org) ? 'de la' : 'del');

  let out = String(text || '');
  const withPlace = new RegExp(
    `^([ \\t]*)Estimado\\/a(?:\\s+Sr\\.\\/Sra\\.)?\\s+${institution}\\s+(del|de)\\s+([^\\n:,]+)\\s*[:,]?`,
    'gmi',
  );
  out = out.replace(withPlace, (m, indent, org, prep, place) => `${indent}A la atención ${article(org)} ${org} ${prep} ${place.trim()}:`);

  const withoutPlace = new RegExp(
    `^([ \\t]*)Estimado\\/a(?:\\s+Sr\\.\\/Sra\\.)?\\s+${institution}\\s*[:,]?`,
    'gmi',
  );
  out = out.replace(withoutPlace, (m, indent, org) => `${indent}A la atención ${article(org)} ${org}:`);

  // Typo frecuente de los modelos pequeños al estructurar el día.
  out = out.replace(/^([ \t]*)Tarda:/gm, '$1Tarde:');

  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Refuerza el formato según el tipo de tarea. Los modelos de 2B pierden
// estructura en tablas largas; una lista breve funciona mucho mejor.
function writingFormatHint(text) {
  const t = String(text || '');
  if (/(plan|planific|semana|horario|agenda|rutina|organiz)/i.test(t)) {
    return '[Formato: no uses una tabla. Usa una lista por día (lunes a viernes), con franjas de mañana y tarde. Sé breve: máximo 3 líneas por día y sin ejemplos entre paréntesis. Incluye trabajo profundo, administración, comidas, pausas y cuidado del familiar. Termina con tres consejos.]';
  }
  if (/(idea|creativ|taller|título|titulo|historia|poema|eslogan)/i.test(t)) {
    return '[Formato: empieza directamente con las ideas, sin introducción. Para cada idea escribe el título en negrita, una actividad breve y los materiales. No repitas los mismos materiales en todas.]';
  }
  if (/(correo|carta|email|solicitud|reclamación|reclamacion)/i.test(t)) {
    return '[Formato: incluye Asunto, saludo, cuerpo breve y despedida. Si el destinatario es una institución, saluda con "A la atención del [organismo]:" y no con "Estimado/a Sr./Sra.". Usa placeholders para los datos que falten. No añadas trámites que no se hayan pedido.]';
  }
  return '';
}

export async function chatStream(messages, res, req, opts = {}) {
  const cfg = getConfig();
  const isWriting = ['redaccion', 'redacción', 'writing'].includes(String(opts.mode || '').toLowerCase());
  const model = isWriting ? (cfg.writeModel || cfg.model) : cfg.model;
  // Liberar el modelo del otro modo para no duplicar RAM.
  const otherModel = isWriting ? cfg.model : cfg.writeModel;
  if (otherModel && otherModel !== model) await unloadModel(cfg.ollamaUrl, otherModel);
  const url = `${cfg.ollamaUrl.replace(/\/+$/, '')}/api/chat`;

  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true, 1000);
  }
  if (req?.socket) {
    req.socket.setTimeout(0);
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  let clientClosed = false;
  res.on('close', () => { clientClosed = true; });

  const send = (evt) => {
    if (clientClosed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch {}
  };

  // Heartbeat ping cada 1 segundo para mantener la conexión TCP activa e impedir que el navegador la corte
  const pingTimer = setInterval(() => {
    if (clientClosed || res.writableEnded) {
      clearInterval(pingTimer);
      return;
    }
    try {
      res.write(': keep-alive\n\n');
    } catch {}
  }, 1000);

  // En modo redacción no se cargan herramientas: el modelo se centra en escribir
  // y se evita que un modelo pequeño pierda calidad intentando llamar funciones.
  let tools = [];
  let mcpIndex = new Map();
  if (!isWriting) {
    const { specs: mcpSpecs, index } = await ext.getMcpOllamaTools();
    tools = [...OS_TOOLS_SPEC, ...ext.skillToolSpec(), ...mcpSpecs];
    mcpIndex = index;
  }

  // Mensajes de la conversación
  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const convo = [
    {
      role: 'system',
      content: isWriting ? WRITING_SYSTEM_PROMPT : SYSTEM_PROMPT + ext.skillPromptBlock(),
    },
    ...messages.map((m) => ({ role: m.role, content: m.content || '' })),
  ];

  // En redacción añadimos una pista de formato ajustada al tipo de tarea.
  if (isWriting) {
    const hint = writingFormatHint(lastUserText);
    const last = convo[convo.length - 1];
    if (hint && last?.role === 'user') last.content = `${last.content}\n\n${hint}`;
  }

  // Un poco más de temperatura para idear y un poco menos para textos formales.
  const isCreative = /(idea|creativ|taller|título|titulo|historia|poema|eslogan|brainstorm|lluvia de ideas)/i.test(lastUserText);
  const writingTemperature = isCreative
    ? Math.min(1, (cfg.writingTemperature ?? 0.7) + 0.15)
    : Math.max(0.2, (cfg.writingTemperature ?? 0.7) - 0.05);

  let loopCount = 0;
  const MAX_LOOPS = isWriting ? 1 : 4;

  try {
    while (loopCount < MAX_LOOPS) {
      if (clientClosed) break;
      loopCount++;

      const ollamaReq = {
        model,
        messages: convo,
        stream: true,
        keep_alive: isWriting ? '2m' : '5m',
        options: isWriting
          ? {
              temperature: writingTemperature,
              top_p: 0.95,
              repeat_penalty: 1.05,
              num_ctx: cfg.writingContext || 2048,
              num_predict: 900,
            }
          : {
              temperature: cfg.temperature,
              num_ctx: cfg.contextSize,
              num_predict: 1024,
            },
        ...(tools.length ? { tools } : {}),
        // Qwen3 puede gastar muchos tokens "pensando"; al redactar no interesa.
        ...(isWriting && String(model).startsWith('qwen3') ? { think: false } : {}),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ollamaReq),
      });

      if (!response.ok) {
        const errText = await response.text();
        send({ error: `Error de Ollama (${response.status}): ${errText}` });
        clearInterval(pingTimer);
        return res.end();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let thinkingContent = '';
      const toolCalls = [];

      while (true) {
        if (clientClosed) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data.error) {
              send({ error: data.error });
              clearInterval(pingTimer);
              return res.end();
            }

            // Transmisión inmediata del pensamiento en modelos como Qwen
            if (data.message?.thinking) {
              thinkingContent += data.message.thinking;
              send({ type: 'think', delta: data.message.thinking });
            }

            // Transmisión del contenido de respuesta
            if (data.message?.content) {
              assistantContent += data.message.content;
              send({ type: 'content', delta: data.message.content });
            }

            if (data.message?.tool_calls) {
              for (const tc of data.message.tool_calls) toolCalls.push(tc);
            }
          } catch {}
        }
      }

      // Texto final. En redacción se corrige un error típico de saludo institucional.
      const finalContent = isWriting ? polishWriting(assistantContent) : assistantContent;

      // En redacción no hay herramientas: cerramos con el texto generado.
      if (isWriting) {
        send({ type: 'done', fullContent: finalContent });
        break;
      }

      // Si el modelo solicitó llamar a herramientas
      if (toolCalls.length > 0) {
        convo.push({
          role: 'assistant',
          content: assistantContent || '',
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          if (clientClosed) break;
          const fnName = tc.function?.name;
          let fnArgs = tc.function?.arguments || {};
          if (typeof fnArgs === 'string') {
            try { fnArgs = JSON.parse(fnArgs); } catch { fnArgs = {}; }
          }
          send({ type: 'tool_start', name: fnName, args: fnArgs });

          let result;
          if (fnName === 'usar_skill') result = ext.loadSkillForTool(fnArgs.nombre);
          else if (fnName?.startsWith('mcp_') || mcpIndex.has(fnName)) result = await ext.executeMcpTool(mcpIndex, fnName, fnArgs);
          else result = await executeOsTool(fnName, fnArgs);
          send({ type: 'tool_end', name: fnName, result });

          convo.push({
            role: 'tool',
            tool_call_id: tc.id || `call_${fnName}_${Date.now()}`,
            name: fnName,
            content: formatToolResultForModel(fnName, result),
          });
        }
        // Repetir el bucle para que el modelo redacte su respuesta con el resultado de la herramienta
        continue;
      }

      // Sin más herramientas: respuesta terminada
      send({ type: 'done', fullContent: finalContent });
      break;
    }

    clearInterval(pingTimer);
    res.end();
  } catch (err) {
    clearInterval(pingTimer);
    send({ error: err.message || 'Error durante la ejecución del agente' });
    res.end();
  }
}


export function runCode(language, codeSnippet) {
  return new Promise((resolve) => {
    let cmd = 'node', args = ['-e', codeSnippet];
    if (language === 'python' || language === 'py') {
      cmd = process.platform === 'win32' ? 'python' : 'python3';
      args = ['-c', codeSnippet];
    }
    const proc = spawn(cmd, args, { timeout: 10000 });
    let stdout = '', stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d; });
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (status) => {
      resolve({ ok: status === 0, code: status, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', (err) => {
      resolve({ ok: false, code: -1, stdout: '', stderr: err.message });
    });
  });
}
