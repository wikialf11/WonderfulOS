// MCP y skills externas para Agentic.
// Permite añadir cualquier servidor MCP (stdio o HTTP) y cualquier skill (SKILL.md o texto).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as store from './store.mjs';

const FILE = path.join(store.DATA, 'agentic-extensions.json');

const emptyState = () => ({ mcps: [], skills: [] });

export function loadExtensions() {
  if (!existsSync(FILE)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    return {
      mcps: Array.isArray(raw.mcps) ? raw.mcps : [],
      skills: Array.isArray(raw.skills) ? raw.skills : [],
    };
  } catch {
    return emptyState();
  }
}

function saveExtensions(state) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export function slugName(raw, fallback = 'item') {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

export function mcpToolName(serverName, toolName) {
  return `mcp_${slugName(serverName, 'srv')}_${slugName(toolName, 'tool')}`;
}

export function parseSkillMarkdown(text, filename = '') {
  const src = String(text || '').replace(/^\uFEFF/, '');
  let name = '';
  let description = '';
  let body = src;
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    const meta = fm[1];
    body = fm[2].trim();
    const nameMatch = meta.match(/^name:\s*(.+)$/m);
    const descMatch = meta.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  if (!name) {
    const heading = body.match(/^#\s+(.+)$/m);
    name = heading ? heading[1].trim() : path.basename(filename || 'skill', path.extname(filename || '.md'));
  }
  if (!description) {
    const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    description = (firstLine || name).slice(0, 240);
  }
  return { name: name.slice(0, 80), description: description.slice(0, 400), body };
}

export function parseMcpServersConfig(input) {
  let obj = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    obj = JSON.parse(trimmed);
  }
  if (!obj || typeof obj !== 'object') return [];
  const map = obj.mcpServers && typeof obj.mcpServers === 'object' ? obj.mcpServers : obj;
  const out = [];
  for (const [name, cfg] of Object.entries(map)) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
    const transport = cfg.url || cfg.serverUrl ? 'http' : 'stdio';
    out.push(normalizeMcp({
      name,
      transport,
      command: cfg.command || '',
      args: Array.isArray(cfg.args) ? cfg.args : [],
      env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
      cwd: cfg.cwd || '',
      url: cfg.url || cfg.serverUrl || '',
      headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {},
      enabled: cfg.enabled !== false,
    }));
  }
  return out;
}

function parseArgList(value) {
  if (Array.isArray(value)) return value.map(String);
  const s = String(value || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* texto plano */ }
  }
  const parts = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) { parts.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseEnvBlock(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const env = {};
    for (const [k, v] of Object.entries(value)) {
      if (k) env[String(k)] = String(v ?? '');
    }
    return env;
  }
  const env = {};
  for (const line of String(value || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

export function normalizeMcp(raw = {}) {
  const transport = raw.transport === 'http' || raw.url ? 'http' : 'stdio';
  return {
    id: raw.id || randomUUID().slice(0, 12),
    name: String(raw.name || 'mcp').trim().slice(0, 64) || 'mcp',
    enabled: raw.enabled !== false,
    transport,
    command: String(raw.command || '').trim(),
    args: parseArgList(raw.args),
    env: parseEnvBlock(raw.env),
    cwd: String(raw.cwd || '').trim(),
    url: String(raw.url || '').trim(),
    headers: parseEnvBlock(raw.headers),
    lastError: raw.lastError || '',
    lastTools: Array.isArray(raw.lastTools) ? raw.lastTools : [],
  };
}

export function normalizeSkill(raw = {}) {
  return {
    id: raw.id || randomUUID().slice(0, 12),
    name: String(raw.name || 'skill').trim().slice(0, 80) || 'skill',
    description: String(raw.description || '').trim().slice(0, 400),
    body: String(raw.body || '').slice(0, 80_000),
    enabled: raw.enabled !== false,
    source: String(raw.source || 'manual').slice(0, 120),
  };
}

function publicMcp(mcp) {
  const env = {};
  for (const k of Object.keys(mcp.env || {})) env[k] = mcp.env[k] ? '••••' : '';
  const headers = {};
  for (const k of Object.keys(mcp.headers || {})) headers[k] = mcp.headers[k] ? '••••' : '';
  return { ...mcp, env, headers };
}

export function listPublicExtensions() {
  const state = loadExtensions();
  return {
    mcps: state.mcps.map(publicMcp),
    skills: state.skills,
  };
}

export function addMcp(raw) {
  const state = loadExtensions();
  const mcp = normalizeMcp(raw);
  if (mcp.transport === 'stdio' && !mcp.command) {
    throw new Error('El MCP stdio necesita un comando (por ejemplo npx o la ruta del binario)');
  }
  if (mcp.transport === 'http' && !mcp.url) {
    throw new Error('El MCP HTTP necesita una URL');
  }
  state.mcps.push(mcp);
  saveExtensions(state);
  return mcp;
}

export function updateMcp(id, patch) {
  const state = loadExtensions();
  const idx = state.mcps.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error('MCP no encontrado');
  const prev = state.mcps[idx];
  const mergedEnv = { ...prev.env };
  if (patch.env !== undefined) {
    const nextEnv = parseEnvBlock(patch.env);
    for (const [k, v] of Object.entries(nextEnv)) {
      if (v === '••••') continue;
      mergedEnv[k] = v;
    }
    for (const k of Object.keys(mergedEnv)) {
      if (!(k in nextEnv) && patch.replaceEnv) delete mergedEnv[k];
    }
  }
  const mergedHeaders = { ...prev.headers };
  if (patch.headers !== undefined) {
    const nextH = parseEnvBlock(patch.headers);
    for (const [k, v] of Object.entries(nextH)) {
      if (v === '••••') continue;
      mergedHeaders[k] = v;
    }
  }
  const next = normalizeMcp({
    ...prev,
    ...patch,
    id: prev.id,
    env: mergedEnv,
    headers: mergedHeaders,
  });
  state.mcps[idx] = next;
  saveExtensions(state);
  disconnectMcp(id);
  return next;
}

export function removeMcp(id) {
  const state = loadExtensions();
  state.mcps = state.mcps.filter((m) => m.id !== id);
  saveExtensions(state);
  disconnectMcp(id);
  return { ok: true };
}

export function importMcps(input) {
  const parsed = parseMcpServersConfig(input);
  if (!parsed.length) throw new Error('No se encontraron servidores MCP en el JSON');
  const state = loadExtensions();
  const added = [];
  for (const mcp of parsed) {
    const existing = state.mcps.find((m) => m.name === mcp.name);
    if (existing) {
      const next = normalizeMcp({ ...existing, ...mcp, id: existing.id });
      const idx = state.mcps.findIndex((m) => m.id === existing.id);
      state.mcps[idx] = next;
      added.push(next);
      disconnectMcp(existing.id);
    } else {
      state.mcps.push(mcp);
      added.push(mcp);
    }
  }
  saveExtensions(state);
  return added;
}

export function addSkill(raw) {
  const state = loadExtensions();
  const skill = normalizeSkill(raw);
  if (!skill.body && !skill.description) throw new Error('La skill necesita instrucciones');
  state.skills.push(skill);
  saveExtensions(state);
  return skill;
}

export function addSkillFromText(text, source = 'manual') {
  const parsed = parseSkillMarkdown(text, source);
  return addSkill({ ...parsed, source });
}

export function addSkillFromPath(filePath) {
  const p = String(filePath || '').trim();
  if (!p) throw new Error('Ruta vacía');
  if (!existsSync(p)) throw new Error(`No existe ${p}`);
  const text = readFileSync(p, 'utf8');
  return addSkillFromText(text, p);
}

export function updateSkill(id, patch) {
  const state = loadExtensions();
  const idx = state.skills.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('Skill no encontrada');
  const next = normalizeSkill({ ...state.skills[idx], ...patch, id });
  state.skills[idx] = next;
  saveExtensions(state);
  return next;
}

export function removeSkill(id) {
  const state = loadExtensions();
  state.skills = state.skills.filter((s) => s.id !== id);
  saveExtensions(state);
  return { ok: true };
}

export function enabledSkills() {
  return loadExtensions().skills.filter((s) => s.enabled);
}

export function skillPromptBlock() {
  const skills = enabledSkills();
  if (!skills.length) return '';
  const lines = [
    '',
    'SKILLS EXTERNAS ACTIVAS:',
    'Si la petición del usuario encaja con una skill, sigue al pie de la letra sus instrucciones. Puedes cargar el texto completo con usar_skill.',
  ];
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description || '(sin descripción)'}`);
    const snippet = s.body.length <= 2500 ? s.body : `${s.body.slice(0, 2500)}\n[...usa usar_skill para el resto]`;
    if (s.body) lines.push(`Instrucciones de «${s.name}»:\n${snippet}`);
  }
  return lines.join('\n');
}

export function skillToolSpec() {
  const skills = enabledSkills();
  if (!skills.length) return [];
  return [{
    type: 'function',
    function: {
      name: 'usar_skill',
      description: 'Carga las instrucciones completas de una skill externa activa para aplicarlas a la tarea actual.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: `Nombre de la skill. Disponibles: ${skills.map((s) => s.name).join(', ')}` },
        },
        required: ['nombre'],
      },
    },
  }];
}

export function loadSkillForTool(name) {
  const q = String(name || '').toLowerCase();
  const skills = enabledSkills();
  const found = skills.find((s) => s.name.toLowerCase() === q)
    || skills.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
  if (!found) return { ok: false, error: `Skill no encontrada: ${name}` };
  return {
    ok: true,
    accion: 'usar_skill',
    nombre: found.name,
    descripcion: found.description,
    instrucciones: found.body,
  };
}

// ---------- Cliente MCP ----------

const clients = new Map(); // id -> client

function jsonSchemaOrObject(schema) {
  if (schema && typeof schema === 'object') return schema;
  return { type: 'object', properties: {} };
}

class StdioMcpClient {
  constructor(mcp) {
    this.mcp = mcp;
    this.proc = null;
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.tools = [];
  }

  start() {
    const env = { ...process.env, ...this.mcp.env };
    this.proc = spawn(this.mcp.command, this.mcp.args || [], {
      env,
      cwd: this.mcp.cwd || undefined,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', () => { /* logs del servidor, se ignoran */ });
    this.proc.on('error', (err) => this.failAll(err));
    this.proc.on('exit', () => this.failAll(new Error('El proceso MCP se cerró')));
  }

  failAll(err) {
    for (const [, { reject }] of this.pending) reject(err);
    this.pending.clear();
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const msg = this.readMessage();
      if (!msg) break;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  }

  readMessage() {
    const asStr = this.buf.toString('utf8');
    const headerEnd = asStr.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = asStr.slice(0, headerEnd);
      const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (lenMatch) {
        const len = Number(lenMatch[1]);
        const start = headerEnd + 4;
        const raw = Buffer.from(asStr.slice(0, start), 'utf8');
        if (this.buf.length < raw.length + len) return null;
        const jsonBuf = this.buf.subarray(raw.length, raw.length + len);
        this.buf = this.buf.subarray(raw.length + len);
        try { return JSON.parse(jsonBuf.toString('utf8')); } catch { return null; }
      }
    }
    const nl = this.buf.indexOf(10);
    if (nl === -1) return null;
    const line = this.buf.subarray(0, nl).toString('utf8').trim();
    this.buf = this.buf.subarray(nl + 1);
    if (!line || line.startsWith('Content-')) return this.readMessage();
    try { return JSON.parse(line); } catch { return this.readMessage(); }
  }

  send(obj) {
    if (!this.proc?.stdin?.writable) throw new Error('MCP no está conectado');
    const json = JSON.stringify(obj);
    const body = Buffer.from(json, 'utf8');
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  request(method, params, timeoutMs = 25000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tiempo agotado en ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async initialize() {
    this.start();
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'WonderfulOS-Agentic', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    const listed = await this.request('tools/list', {});
    this.tools = listed?.tools || [];
    return this.tools;
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args || {} }, 60000);
  }

  close() {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}

class HttpMcpClient {
  constructor(mcp) {
    this.mcp = mcp;
    this.sessionId = '';
    this.tools = [];
    this.endpoint = mcp.url;
  }

  headers(extra = {}) {
    const h = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2024-11-05',
      ...this.mcp.headers,
      ...extra,
    };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  async post(body, timeoutMs = 25000) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const ct = res.headers.get('content-type') || '';
    if (!res.ok && !ct.includes('json') && !ct.includes('event-stream')) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      return parseSseJson(text);
    }
    return res.json();
  }

  async rpc(method, params, timeoutMs) {
    const payload = { jsonrpc: '2.0', id: Date.now(), method, params };
    const data = await this.post(payload, timeoutMs);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.result;
  }

  async initialize() {
    const result = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'WonderfulOS-Agentic', version: '1.0.0' },
    });
    try {
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    } catch { /* algunos servidores no aceptan notify */ }
    const listed = await this.rpc('tools/list', {});
    this.tools = listed?.tools || result?.tools || [];
    return this.tools;
  }

  async callTool(name, args) {
    return this.rpc('tools/call', { name, arguments: args || {} }, 60000);
  }

  close() {
    this.sessionId = '';
  }
}

function parseSseJson(text) {
  const blocks = String(text || '').split(/\n\n+/);
  let last = null;
  for (const block of blocks) {
    const dataLines = block.split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) continue;
    try { last = JSON.parse(dataLines.join('\n')); } catch { /* fragmento */ }
  }
  if (!last) throw new Error('El servidor MCP no devolvió JSON');
  return last;
}

export function disconnectMcp(id) {
  const c = clients.get(id);
  if (c) {
    try { c.close(); } catch {}
    clients.delete(id);
  }
}

async function connectMcp(mcp) {
  disconnectMcp(mcp.id);
  const client = mcp.transport === 'http' ? new HttpMcpClient(mcp) : new StdioMcpClient(mcp);
  const tools = await client.initialize();
  clients.set(mcp.id, client);
  return { client, tools };
}

export async function testMcp(id) {
  const state = loadExtensions();
  const mcp = state.mcps.find((m) => m.id === id);
  if (!mcp) throw new Error('MCP no encontrado');
  try {
    const { tools } = await connectMcp(mcp);
    mcp.lastError = '';
    mcp.lastTools = tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    saveExtensions(state);
    return { ok: true, tools: mcp.lastTools.map(({ name, description }) => ({ name, description })) };
  } catch (err) {
    mcp.lastError = err.message;
    mcp.lastTools = [];
    saveExtensions(state);
    disconnectMcp(mcp.id);
    return { ok: false, error: err.message, tools: [] };
  }
}

export async function getMcpOllamaTools() {
  const state = loadExtensions();
  const specs = [];
  const index = new Map();
  for (const mcp of state.mcps.filter((m) => m.enabled)) {
    let tools = mcp.lastTools || [];
    try {
      if (!clients.has(mcp.id) || !tools.length) {
        const connected = await connectMcp(mcp);
        tools = connected.tools.map((t) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema,
        }));
        mcp.lastTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));
        mcp.lastError = '';
        saveExtensions(state);
        const client = clients.get(mcp.id);
        for (const t of connected.tools) {
          const fn = mcpToolName(mcp.name, t.name);
          index.set(fn, { mcpId: mcp.id, client, original: t.name, server: mcp.name });
          specs.push({
            type: 'function',
            function: {
              name: fn,
              description: `[MCP ${mcp.name}] ${t.description || t.name}`,
              parameters: jsonSchemaOrObject(t.inputSchema),
            },
          });
        }
        continue;
      }
      const client = clients.get(mcp.id);
      for (const t of tools) {
        const fn = mcpToolName(mcp.name, t.name);
        index.set(fn, { mcpId: mcp.id, client, original: t.name, server: mcp.name });
        specs.push({
          type: 'function',
          function: {
            name: fn,
            description: `[MCP ${mcp.name}] ${t.description || t.name}`,
            parameters: jsonSchemaOrObject(t.inputSchema),
          },
        });
      }
    } catch (err) {
      mcp.lastError = err.message;
      saveExtensions(state);
    }
  }
  return { specs, index };
}

export async function executeMcpTool(index, fnName, args) {
  let entry = index.get(fnName);
  if (!entry) {
    const state = loadExtensions();
    for (const mcp of state.mcps.filter((m) => m.enabled)) {
      for (const t of mcp.lastTools || []) {
        if (mcpToolName(mcp.name, t.name) === fnName || t.name === fnName) {
          try {
            const { client } = await connectMcp(mcp);
            entry = { mcpId: mcp.id, client, original: t.name, server: mcp.name };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        }
      }
    }
  }
  if (!entry?.client) return { ok: false, error: `Herramienta MCP desconocida: ${fnName}` };
  try {
    const result = await entry.client.callTool(entry.original, args || {});
    const text = formatMcpResult(result);
    return { ok: true, accion: fnName, servidor: entry.server, herramienta: entry.original, resultado: text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function formatMcpResult(result) {
  if (result == null) return '(sin resultado)';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) {
    return result.content.map((c) => {
      if (typeof c === 'string') return c;
      if (c?.text) return c.text;
      return JSON.stringify(c);
    }).join('\n');
  }
  try { return JSON.stringify(result); } catch { return String(result); }
}
