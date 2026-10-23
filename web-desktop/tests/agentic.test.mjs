import test from 'node:test';
import assert from 'node:assert/strict';
import { executeOsTool, getConfig, polishWriting, saveConfig } from '../server/agentic.mjs';
import { parseSkillMarkdown, parseMcpServersConfig, mcpToolName, addSkill, loadSkillForTool, importMcps, listPublicExtensions, removeSkill, removeMcp } from '../server/mcp.mjs';
import * as store from '../server/store.mjs';
import * as appdata from '../server/appdata.mjs';

test('agentic config: default model is qwen3:1.7b and user can change it', () => {
  const cfg = getConfig();
  assert.equal(cfg.model, 'qwen3:1.7b');

  const updated = saveConfig({ model: 'qwen2.5:1.5b' });
  assert.equal(updated.model, 'qwen2.5:1.5b');
  assert.equal(getConfig().model, 'qwen2.5:1.5b');

  // Restaurar a qwen3:1.7b
  saveConfig({ model: 'qwen3:1.7b' });
  assert.equal(getConfig().model, 'qwen3:1.7b');
});

test('agentic config: default writing model is gemma2:2b and can be changed', () => {
  const cfg = getConfig();
  assert.equal(cfg.writeModel, 'gemma2:2b');
  assert.equal(cfg.writingContext, 2048);

  const updated = saveConfig({ writeModel: 'gemma3:1b', writingContext: 1536 });
  assert.equal(updated.writeModel, 'gemma3:1b');
  assert.equal(getConfig().writingContext, 1536);

  // Restaurar los valores recomendados para redacción.
  saveConfig({ writeModel: 'gemma2:2b', writingContext: 2048 });
  assert.equal(getConfig().writeModel, 'gemma2:2b');
});

test('agentic redacción: corrige el saludo a instituciones', () => {
  assert.equal(
    polishWriting('Asunto: Certificado\n\nEstimado/a Ayuntamiento de La Laguna:\n\nCuerpo.\n\nAtentamente,'),
    'Asunto: Certificado\n\nA la atención del Ayuntamiento de La Laguna:\n\nCuerpo.\n\nAtentamente,',
  );
  assert.equal(
    polishWriting('Estimado/a Sr./Sra. Consejería de Educación:'),
    'A la atención de la Consejería de Educación:',
  );
  assert.equal(
    polishWriting('A la atención del Ayuntamiento de La Laguna:'),
    'A la atención del Ayuntamiento de La Laguna:',
  );
});

test('agentic os tools: crear y leer documento', async () => {
  const docResult = await executeOsTool('crear_documento', {
    nombre: 'PruebaAgentic.md',
    contenido: '# Documento de prueba creado por Agentic\n\nAutomatización completada.',
  });

  assert.equal(docResult.ok, true);
  assert.equal(docResult.ruta, '/Documentos/PruebaAgentic.md');

  const readResult = await executeOsTool('leer_documento', {
    ruta: '/Documentos/PruebaAgentic.md',
  });
  assert.equal(readResult.ok, true);
  assert.match(readResult.contenido, /Automatización completada/);
});

test('agentic os tools: crear hoja de cálculo con fórmulas', async () => {
  const calcResult = await executeOsTool('crear_calculo', {
    nombre: 'GastosTest.csv',
    cabeceras: ['Concepto', 'Enero', 'Febrero', 'Total'],
    filas: [
      ['Alquiler', '800', '800', '=SUMA(B2:C2)'],
      ['Suministros', '120', '140', '=SUMA(B3:C3)'],
      ['Total general', '=SUMA(B2:B3)', '=SUMA(C2:C3)', '=SUMA(D2:D3)'],
    ],
  });

  assert.equal(calcResult.ok, true);
  assert.equal(calcResult.ruta, '/Documentos/GastosTest.csv');
  assert.equal(calcResult.filas, 3);
  assert.equal(calcResult.columnas, 4);

  const file = store.tree(store.USER)['/Documentos/GastosTest.csv'];
  assert.ok(file);
  assert.match(file.content, /=SUMA\(B2:C2\)/);
});

test('agentic os tools: crear lista de tareas y agregar tarea', async () => {
  const listResult = await executeOsTool('crear_lista_tareas', {
    titulo: 'Tareas Sprint',
    emoji: '🚀',
    tareas: [{ texto: 'Diseñar interfaz' }, { texto: 'Configurar servidor' }],
  });

  assert.equal(listResult.ok, true);
  assert.equal(listResult.titulo, 'Tareas Sprint');
  assert.equal(listResult.numTareas, 2);

  const addResult = await executeOsTool('agregar_tarea', {
    lista_titulo: 'Tareas Sprint',
    texto: 'Escribir documentación',
  });
  assert.equal(addResult.ok, true);
  assert.equal(addResult.tarea, 'Escribir documentación');
});

test('agentic os tools: crear nota', async () => {
  const noteResult = await executeOsTool('crear_nota', {
    titulo: 'Idea maravillosa',
    texto: 'Integrar IA local y privada en WonderfulOS.',
    color: '#bbf7d0',
    fijada: true,
  });

  assert.equal(noteResult.ok, true);
  assert.equal(noteResult.titulo, 'Idea maravillosa');

  const notes = appdata.list(store.USER, 'notas');
  const found = notes.find((n) => n.id === noteResult.id);
  assert.ok(found);
  assert.equal(found.data.title, 'Idea maravillosa');
  assert.equal(found.data.pinned, true);
});

test('agentic os tools: crear evento de calendario', async () => {
  const calResult = await executeOsTool('crear_evento_calendario', {
    titulo: 'Reunión de equipo',
    fecha: '2026-11-01',
    hora_inicio: '10:00',
    hora_fin: '11:00',
  });

  assert.equal(calResult.ok, true);
  assert.equal(calResult.titulo, 'Reunión de equipo');
});

test('agentic extensions: parse skill markdown and mcp json', () => {
  const skill = parseSkillMarkdown(`---
name: revisar-pr
description: Revisa un pull request con foco en seguridad
---
Busca secretos y valida tests.
`);
  assert.equal(skill.name, 'revisar-pr');
  assert.match(skill.description, /seguridad/);
  assert.match(skill.body, /secretos/);

  const mcps = parseMcpServersConfig(`{
    "mcpServers": {
      "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "x" } },
      "remote": { "url": "https://ejemplo.com/mcp", "headers": { "Authorization": "Bearer z" } }
    }
  }`);
  assert.equal(mcps.length, 2);
  assert.equal(mcps[0].transport, 'stdio');
  assert.equal(mcps[1].transport, 'http');
  assert.equal(mcpToolName('GitHub', 'list issues'), 'mcp_github_list_issues');
});

test('agentic extensions: add and load skill', () => {
  const skill = addSkill({
    name: 'nota-rapida',
    description: 'Redacta notas breves',
    body: 'Escribe en tres viñetas.',
  });
  const loaded = loadSkillForTool('nota-rapida');
  assert.equal(loaded.ok, true);
  assert.match(loaded.instrucciones, /viñetas/);
  removeSkill(skill.id);
});

test('agentic extensions: import mcp config without connecting', () => {
  const added = importMcps({
    mcpServers: {
      demo: { command: 'npx', args: ['-y', 'paquete-demo'] },
    },
  });
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'demo');
  const listed = listPublicExtensions();
  assert.ok(listed.mcps.some((m) => m.name === 'demo'));
  assert.equal(listed.mcps.find((m) => m.name === 'demo').env.GITHUB_TOKEN, undefined);
  removeMcp(added[0].id);
});

test('agentic web tools: busqueda en internet', async () => {
  const searchResult = await executeOsTool('buscar_internet', {
    consulta: 'JavaScript',
  });
  assert.equal(searchResult.ok, true);
  assert.equal(searchResult.consulta, 'JavaScript');
  assert.ok(Array.isArray(searchResult.resultados));
  assert.ok(searchResult.resultados.length > 0);
  assert.ok(searchResult.resultados[0].titulo);
  assert.ok(searchResult.resultados[0].enlace);
});

test('agentic web tools: leer y extraer contenido web', async () => {
  const pageResult = await executeOsTool('leer_pagina_web', {
    url: 'https://es.wikipedia.org/wiki/JavaScript',
  });
  assert.equal(pageResult.ok, true);
  assert.match(pageResult.titulo, /JavaScript/);
  assert.ok(pageResult.caracteres > 0);
});

test('agentic web tools: descargar archivo o imagen a WonderfulOS', async () => {
  const fileName = `test-logo-${Date.now()}.png`;
  const dlResult = await executeOsTool('descargar_archivo', {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/JavaScript-logo.png',
    nombre_archivo: fileName,
  });
  assert.equal(dlResult.ok, true);
  assert.equal(dlResult.ruta, `/Imágenes/${fileName}`);
  assert.ok(dlResult.tamano > 0);

  const fileNode = store.tree(store.USER)[`/Imágenes/${fileName}`];
  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');
});

test('agentic web tools: busqueda de imagenes', async () => {
  const imgResult = await executeOsTool('buscar_imagenes', {
    consulta: 'Tierra',
  });
  assert.equal(imgResult.ok, true);
  assert.ok(Array.isArray(imgResult.imagenes));
  assert.ok(imgResult.imagenes.length > 0);
  assert.ok(imgResult.imagenes[0].url_imagen.startsWith('https://'));
});
