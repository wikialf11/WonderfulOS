// Agentic: Asistente inteligente y automatización para WonderfulOS.
// Automatiza tareas en el sistema operativo: Documentos, Cálculo (Excel), Listas, Notas, Calendario y Archivos.
// Utiliza modelos locales mediante Ollama (por defecto qwen3:1.7b, configurable por el usuario).

import { api } from '../api.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { esc } from '../util.js';

const APP = 'agentic';

export default {
  id: APP,
  name: 'Agentic',
  description: 'Asistente de automatización con IA para WonderfulOS',

  async launch(ctx) {
    const win = ctx.createWindow({
      title: 'Agentic',
      width: 960,
      height: 640,
      appId: APP,
    });
    win.body.classList.add('app-agentic');

    win.body.innerHTML = `
      <div class="ag-layout">
        <!-- Barra superior de estado -->
        <header class="ag-header">
          <div class="ag-brand">
            <span class="ag-icon">${ICONS.agentic}</span>
            <div>
              <div class="ag-title">Agentic</div>
              <div class="ag-desc">Automatización de WonderfulOS</div>
            </div>
          </div>
          <div class="ag-status-wrap">
            <button class="ag-pill ag-ext-btn" title="MCP y skills externas">
              ${GLYPHS.spark}
              <span class="ag-ext-label">Extensiones</span>
            </button>
            <button class="ag-pill ag-model-btn" title="Configurar modelo de IA">
              <span class="ag-dot"></span>
              <span class="ag-model-name">Cargando...</span>
              <span class="ag-chevron">▾</span>
            </button>
            <button class="icon-btn ag-clear-btn" title="Nueva conversación">${GLYPHS.trash}</button>
          </div>
        </header>

        <!-- Panel desplegable de configuración del modelo -->
        <div class="ag-model-panel" hidden>
          <div class="ag-panel-title">Modelos de IA</div>
          <div class="ag-panel-desc">Agentic usa un modelo para las herramientas del sistema y otro para redactar. Así puedes escribir mejor sin perder la automatización.</div>

          <div class="ag-model-selector">
            <label>Agente · herramientas y sistema</label>
            <div class="ag-input-row">
              <input type="text" class="ag-model-input" placeholder="ej: qwen3:1.7b" />
              <button class="pill ag-save-model-btn">Aplicar</button>
            </div>
          </div>

          <div class="ag-model-selector">
            <label>Redacción · correos, planes, ideas</label>
            <div class="ag-input-row">
              <input type="text" class="ag-write-model-input" placeholder="ej: gemma2:2b" />
              <button class="pill ag-save-write-model-btn">Aplicar</button>
            </div>
          </div>

          <div class="ag-model-status" aria-live="polite"></div>

          <div class="ag-quick-models">
            <span>Agente:</span>
            <button class="ag-tag" data-target="model" data-model="qwen3:1.7b">qwen3:1.7b</button>
          </div>

          <div class="ag-quick-models">
            <span>Redacción:</span>
            <button class="ag-tag" data-target="write" data-model="gemma2:2b">gemma2:2b (recomendado)</button>
            <button class="ag-tag" data-target="write" data-model="gemma3:1b">gemma3:1b (ultraligero)</button>
          </div>

          <div class="ag-download-area" hidden>
            <div class="ag-dl-status">El modelo no está descargado aún en este equipo.</div>
            <div class="ag-progress-bar" hidden><div class="ag-progress-fill" style="width: 0%"></div></div>
            <button class="pill soft ag-dl-btn">Descargar ahora en Ollama</button>
          </div>
        </div>

        <div class="ag-learn-panel" hidden>
          <div class="ag-panel-title">Enseñar un concepto</div>
          <div class="ag-panel-desc">Se guarda en tu perfil local. El motor simbólico lo usará en las próximas respuestas, sin entrenar ningún modelo.</div>
          <form class="ag-learn-form">
            <div class="ag-form-grid">
              <label>Lema<input type="text" class="ag-learn-lema" placeholder="fotosíntesis artificial" maxlength="120" required></label>
              <label>Género (opcional)<input type="text" class="ag-learn-genero" placeholder="proceso" maxlength="80"></label>
            </div>
            <label>Definición<textarea class="ag-learn-def" rows="2" placeholder="proceso técnico que imita la fotosíntesis natural" maxlength="600" required></textarea></label>
            <label>Relaciones (opcional)<input type="text" class="ag-learn-rel" placeholder="parte_de: tecnología, asociado_con: energía" maxlength="500"></label>
            <div class="ag-input-row">
              <button type="submit" class="pill ag-learn-save">Guardar concepto</button>
              <button type="button" class="pill soft ag-learn-cancel">Cancelar</button>
            </div>
            <div class="ag-learn-status" aria-live="polite"></div>
          </form>
        </div>

        <div class="ag-ext-panel" hidden>
          <div class="ag-panel-title">MCP y skills externas</div>
          <div class="ag-panel-desc">Conecta cualquier servidor MCP (stdio o HTTP) y añade skills tipo <code>SKILL.md</code>. Agentic las usará en el chat junto a las herramientas del sistema.</div>
          <div class="ag-ext-tabs">
            <button class="ag-ext-tab on" data-tab="mcp">Servidores MCP</button>
            <button class="ag-ext-tab" data-tab="skills">Skills</button>
          </div>
          <div class="ag-ext-pane" data-pane="mcp">
            <div class="ag-ext-list ag-mcp-list"></div>
            <form class="ag-ext-form ag-mcp-form">
              <div class="ag-form-grid">
                <label>Nombre<input class="ag-mcp-name" placeholder="github, filesystem…" required></label>
                <label>Transporte
                  <select class="ag-mcp-transport">
                    <option value="stdio">stdio (comando local)</option>
                    <option value="http">HTTP / URL remota</option>
                  </select>
                </label>
              </div>
              <div class="ag-mcp-stdio">
                <label>Comando<input class="ag-mcp-command" placeholder="npx, uvx, python, ruta al binario"></label>
                <label>Argumentos<input class="ag-mcp-args" placeholder='-y @modelcontextprotocol/server-github'></label>
                <label>Directorio de trabajo<input class="ag-mcp-cwd" placeholder="opcional"></label>
                <label>Variables de entorno<textarea class="ag-mcp-env" rows="2" placeholder="TOKEN=abc&#10;OTRA=valor"></textarea></label>
              </div>
              <div class="ag-mcp-http" hidden>
                <label>URL<input class="ag-mcp-url" placeholder="https://ejemplo.com/mcp"></label>
                <label>Cabeceras<textarea class="ag-mcp-headers" rows="2" placeholder="Authorization=Bearer …"></textarea></label>
              </div>
              <div class="ag-input-row">
                <button type="submit" class="pill">Añadir y conectar MCP</button>
              </div>
            </form>
            <label>Importar JSON de MCP (formato Cursor / Claude Desktop)
              <textarea class="ag-mcp-json" rows="5" placeholder='{"mcpServers":{"nombre":{"command":"npx","args":["-y","paquete"]}}}'></textarea>
            </label>
            <button type="button" class="pill soft ag-mcp-import">Importar JSON</button>
          </div>
          <div class="ag-ext-pane" data-pane="skills" hidden>
            <div class="ag-ext-list ag-skill-list"></div>
            <form class="ag-ext-form ag-skill-form">
              <div class="ag-form-grid">
                <label>Nombre<input class="ag-skill-name" placeholder="revisar-codigo (o déjalo y pega un SKILL.md)"></label>
                <label>Descripción<input class="ag-skill-desc" placeholder="Cuándo debe usarse esta skill"></label>
              </div>
              <label>Instrucciones (markdown o SKILL.md)
                <textarea class="ag-skill-body" rows="6" placeholder="---&#10;name: mi-skill&#10;description: …&#10;---&#10;Pasos que el agente debe seguir."></textarea>
              </label>
              <div class="ag-input-row">
                <button type="submit" class="pill">Añadir skill</button>
                <label class="pill soft ag-file-label">Importar archivo
                  <input type="file" class="ag-skill-file" accept=".md,.txt,.json" hidden>
                </label>
              </div>
            </form>
          </div>
        </div>

        <!-- Área de mensajes -->
        <div class="ag-chat-scroll">
          <div class="ag-chat-inner">
            <div class="ag-empty-state">
              <div class="ag-big-icon">${ICONS.agentic}</div>
              <h2>¿En qué te puedo ayudar hoy?</h2>
              <p>Puedo buscar en internet, trabajar con tus archivos y apps, y usar cualquier MCP o skill externa que conectes en Extensiones.</p>

              <div class="ag-prompts ag-prompts-agent">
                <button class="ag-prompt-chip" data-text="Busca en internet información sobre los avances de inteligencia artificial en 2026 y crea un informe en Documentos">
                  <span>🌐</span> Buscar en la web y crear informe
                </button>
                <button class="ag-prompt-chip" data-text="Crea una hoja de cálculo con un presupuesto mensual para el hogar con ingresos, gastos y la suma total">
                  <span>📊</span> Presupuesto mensual con fórmulas
                </button>
                <button class="ag-prompt-chip" data-text="Crea un documento de bienvenida con las características de WonderfulOS en Documentos">
                  <span>📄</span> Crear documento de bienvenida
                </button>
                <button class="ag-prompt-chip" data-text="Crea una lista de tareas para el proyecto con 4 tareas prioritarias">
                  <span>✅</span> Lista de tareas del proyecto
                </button>
                <button class="ag-prompt-chip" data-text="Escribe una nota rápida con ideas de diseño y colores para la interfaz">
                  <span>📝</span> Nota con ideas de diseño
                </button>
              </div>

              <div class="ag-prompts ag-prompts-write" hidden>
                <button class="ag-prompt-chip" data-text="Redacta un correo formal al Ayuntamiento de La Laguna para solicitar un certificado de residencia. Usa placeholders para mis datos y un tono cordial y administrativo.">
                  <span>✉️</span> Correo formal al Ayuntamiento
                </button>
                <button class="ag-prompt-chip" data-text="Hazme un plan semanal realista para una persona autónoma que trabaja desde casa y cuida de un familiar mayor. Incluye trabajo profundo, administración, comidas, pausas y tiempo de cuidado.">
                  <span>🗓️</span> Plan semanal realista
                </button>
                <button class="ag-prompt-chip" data-text="Propón 8 ideas originales para un taller de escritura creativa de 90 minutos para adultos mayores. Indica título, actividad y materiales.">
                  <span>💡</span> Ideas para un taller
                </button>
                <button class="ag-prompt-chip" data-text="Reescribe el siguiente texto en un registro formal y claro, sin cambiar el significado: [pega aquí tu texto]">
                  <span>🪄</span> Reescribir en formal
                </button>
              </div>

              <div class="ag-prompts ag-prompts-logica" hidden>
                <button class="ag-prompt-chip" data-text="¿Qué es el verde?">
                  <span>◇</span> Definir un concepto
                </button>
                <button class="ag-prompt-chip" data-text="Busca en internet las noticias de hoy sobre inteligencia artificial">
                  <span>🌐</span> Buscar noticias en internet
                </button>
                <button class="ag-prompt-chip" data-text="Crea una nota con ideas de diseño y colores para la interfaz">
                  <span>📝</span> Crear nota
                </button>
                <button class="ag-prompt-chip" data-text="Redacta un correo formal al Ayuntamiento de La Laguna para solicitar un certificado de residencia. Usa placeholders para mis datos y un tono cordial y administrativo.">
                  <span>▤</span> Correo formal con plantilla
                </button>
                <button class="ag-prompt-chip" data-text="Hazme un plan semanal realista para una persona autónoma que trabaja desde casa y cuida de un familiar mayor. Incluye trabajo profundo, administración, comidas, pausas y tiempo de cuidado.">
                  <span>▦</span> Plan semanal
                </button>
                <button class="ag-prompt-chip" data-text="Explica la vegetación.">
                  <span>▥</span> Texto expositivo con fuentes
                </button>
                <button class="ag-prompt-chip" data-text="Redacta un informe sobre la fotosíntesis">
                  <span>▤</span> Informe con fuentes web
                </button>
                <button class="ag-prompt-chip" data-text="¿Qué relación hay entre verde y vegetación?">
                  <span>↔</span> Recorrer relaciones
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Barra inferior de entrada -->
        <footer class="ag-footer">
          <div class="ag-mode-bar">
            <button type="button" class="ag-mode on" data-mode="agente">Agente</button>
            <button type="button" class="ag-mode" data-mode="redaccion">Redacción</button>
            <button type="button" class="ag-mode" data-mode="logica">Lógica</button>
            <span class="ag-mode-hint">Automatiza, redacta o usa el motor simbólico sin modelo</span>
            <button type="button" class="ag-tag ag-learn-toggle" hidden>+ Enseñar concepto</button>
          </div>
          <div class="ag-input-box">
            <textarea class="ag-input" placeholder="Pídele a Agentic que cree o automatice cualquier tarea..." rows="1"></textarea>
            <button class="icon-btn ag-send-btn" title="Enviar mensaje">${GLYPHS.send}</button>
          </div>
        </footer>
      </div>
    `;

    const $ = (s) => win.body.querySelector(s);
    const chatScroll = $('.ag-chat-scroll');
    const chatInner = $('.ag-chat-inner');
    const input = $('.ag-input');
    const sendBtn = $('.ag-send-btn');
    const modelBtn = $('.ag-model-btn');
    const modelNameEl = $('.ag-model-name');
    const modelDot = $('.ag-dot');
    const modelPanel = $('.ag-model-panel');
    const modelInput = $('.ag-model-input');
    const saveModelBtn = $('.ag-save-model-btn');
    const dlArea = $('.ag-download-area');
    const dlBtn = $('.ag-dl-btn');
    const dlStatus = $('.ag-dl-status');
    const progressBar = $('.ag-progress-bar');
    const progressFill = $('.ag-progress-fill');
    const clearBtn = $('.ag-clear-btn');
    const extBtn = $('.ag-ext-btn');
    const extPanel = $('.ag-ext-panel');
    const mcpListEl = $('.ag-mcp-list');
    const skillListEl = $('.ag-skill-list');
    const descEl = $('.ag-desc');
    const writeModelInput = $('.ag-write-model-input');
    const saveWriteModelBtn = $('.ag-save-write-model-btn');
    const modelStatusEl = $('.ag-model-status');
    const modeBtns = [...win.body.querySelectorAll('.ag-mode')];
    const learnToggle = $('.ag-learn-toggle');
    const learnPanel = $('.ag-learn-panel');
    const learnForm = $('.ag-learn-form');
    const learnStatus = $('.ag-learn-status');

    let history = []; // { role, content, think, tools }
    let isBusy = false;
    let currentStatus = null;
    let mode = 'agente';
    let downloadTarget = '';

    // Cambiar entre automatización del sistema, redacción y motor lógico.
    function setMode(next) {
      mode = ['redaccion', 'logica'].includes(next) ? next : 'agente';
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      if (descEl) {
        descEl.textContent = mode === 'redaccion'
          ? 'Escritura, planificación y creatividad'
          : mode === 'logica'
            ? 'Conocimiento simbólico, sin modelo neuronal'
            : 'Automatización de WonderfulOS';
      }
      input.placeholder = mode === 'redaccion'
        ? 'Escribe o pega el texto: correo formal, plan, ideas, reescritura…'
        : mode === 'logica'
          ? 'Pregunta qué es algo, pide un correo, un plan, un informe con fuentes o un texto expositivo…'
          : 'Pídele a Agentic que cree o automatice cualquier tarea...';
      win.body.querySelector('.ag-prompts-agent')?.toggleAttribute('hidden', mode !== 'agente');
      win.body.querySelector('.ag-prompts-write')?.toggleAttribute('hidden', mode !== 'redaccion');
      win.body.querySelector('.ag-prompts-logica')?.toggleAttribute('hidden', mode !== 'logica');
      learnToggle?.toggleAttribute('hidden', mode !== 'logica');
      if (mode !== 'logica') {
        learnPanel.hidden = true;
      } else {
        modelPanel.hidden = true;
        extPanel.hidden = true;
      }
      updateStatus();
    }

    modeBtns.forEach((btn) => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });

    // Actualizar estado de Ollama y del modelo
    async function updateStatus() {
      if (mode === 'logica') {
        modelNameEl.textContent = 'Motor lógico';
        modelDot.className = 'ag-dot ag-dot-ok';
        modelBtn.title = 'Motor simbólico local: sin modelo neuronal, sin Ollama';
        const chevron = modelBtn.querySelector('.ag-chevron');
        if (chevron) chevron.hidden = true;
        dlArea.hidden = true;
        dlBtn.hidden = true;
        downloadTarget = '';
        if (modelStatusEl) {
          modelStatusEl.innerHTML = 'Lógica: diccionario abierto + reglas + plantillas + web y acciones locales. <strong>Sin Ollama.</strong>';
        }
        try {
          const st = await api('conocimiento/status');
          if (mode !== 'logica') return;
          modelNameEl.textContent = `Lógica · ${st.conceptos.toLocaleString('es-ES')} conceptos`;
          modelBtn.title = `${st.conceptos} conceptos, ${st.reglas} reglas y ${st.documentos} documentos. Sin modelo neuronal.`;
          if (modelStatusEl) {
            modelStatusEl.innerHTML = `Conceptos: <strong>${st.conceptos.toLocaleString('es-ES')}</strong>`
              + ` &nbsp;|&nbsp; Reglas: <strong>${st.reglas}</strong>`
              + ` &nbsp;|&nbsp; Documentos: <strong>${st.documentos}</strong>`
              + ` &nbsp;|&nbsp; Derivaciones: <strong>${st.derivaciones}</strong>`
              + '<br>Motor simbólico local. <strong>Sin Ollama.</strong>';
          }
        } catch {
          if (mode === 'logica' && modelStatusEl) {
            modelStatusEl.innerHTML = 'No se pudo leer el estado del motor lógico. <strong>Sin Ollama.</strong>';
          }
        }
        return;
      }
      const chevron = modelBtn.querySelector('.ag-chevron');
      if (chevron) chevron.hidden = false;
      try {
        currentStatus = await api('agentic/status');
        const running = currentStatus.running;
        const agentModel = currentStatus.currentModel || 'qwen3:1.7b';
        const writeModel = currentStatus.writeModel || 'gemma2:2b';
        modelInput.value = agentModel;
        if (writeModelInput) writeModelInput.value = writeModel;

        const activeModel = mode === 'redaccion' ? writeModel : agentModel;
        const activeInstalled = mode === 'redaccion' ? currentStatus.isWriteModelInstalled : currentStatus.isModelInstalled;
        modelNameEl.textContent = activeModel;

        if (modelStatusEl) {
          modelStatusEl.innerHTML = `Agente: <strong>${esc(agentModel)}</strong> ${currentStatus.isModelInstalled ? '✓' : '· sin descargar'}`
            + ` &nbsp;|&nbsp; Redacción: <strong>${esc(writeModel)}</strong> ${currentStatus.isWriteModelInstalled ? '✓' : '· sin descargar'}`;
        }

        if (!running) {
          modelDot.className = 'ag-dot ag-dot-error';
          modelBtn.title = 'Ollama no está conectado (puerto 11434)';
          dlArea.hidden = false;
          dlStatus.innerHTML = '⚠️ Ollama no responde en <code>127.0.0.1:11434</code>. Asegúrate de iniciarlo con <code>ollama serve</code>.';
          dlBtn.hidden = true;
          downloadTarget = '';
        } else if (!activeInstalled) {
          modelDot.className = 'ag-dot ag-dot-warn';
          modelBtn.title = `El modelo ${activeModel} no está descargado`;
          dlArea.hidden = false;
          dlStatus.textContent = `El modelo ${activeModel} no está descargado aún en este equipo.`;
          dlBtn.hidden = false;
          dlBtn.disabled = false;
          dlBtn.textContent = `Descargar ${activeModel} ahora`;
          downloadTarget = activeModel;
        } else {
          modelDot.className = 'ag-dot ag-dot-ok';
          modelBtn.title = `Modelo activo: ${activeModel} (Listo)`;
          dlArea.hidden = true;
          downloadTarget = '';
        }
      } catch (err) {
        modelDot.className = 'ag-dot ag-dot-error';
        modelNameEl.textContent = 'Error';
      }
    }

    // Alternar panel de modelo
    modelBtn.onclick = () => {
      if (mode === 'logica') return;
      modelPanel.hidden = !modelPanel.hidden;
      if (!modelPanel.hidden) {
        extPanel.hidden = true;
        learnPanel.hidden = true;
      }
    };

    extBtn.onclick = () => {
      extPanel.hidden = !extPanel.hidden;
      if (!extPanel.hidden) {
        modelPanel.hidden = true;
        learnPanel.hidden = true;
        renderExtensions();
      }
    };

    // Enseñar un concepto desde el modo Lógica.
    function setLearnStatus(mensaje, tipo = '') {
      if (!learnStatus) return;
      learnStatus.textContent = mensaje;
      learnStatus.className = `ag-learn-status${tipo ? ` ${tipo}` : ''}`;
    }

    function leerRelaciones(valor) {
      return String(valor || '')
        .split(/[;,\n]+/)
        .map((parte) => parte.trim())
        .filter(Boolean)
        .map((parte) => {
          const m = parte.match(/^([a-z_]+)\s*[:=]\s*(.+)$/i);
          return m ? [m[1].toLowerCase(), m[2].trim()] : null;
        })
        .filter(Boolean);
    }

    learnToggle.onclick = () => {
      if (mode !== 'logica') return;
      learnPanel.hidden = !learnPanel.hidden;
      if (!learnPanel.hidden) {
        modelPanel.hidden = true;
        extPanel.hidden = true;
        learnPanel.querySelector('.ag-learn-lema')?.focus();
      }
    };

    learnForm.onsubmit = async (event) => {
      event.preventDefault();
      const lema = learnPanel.querySelector('.ag-learn-lema')?.value.trim() || '';
      const definicion = learnPanel.querySelector('.ag-learn-def')?.value.trim() || '';
      const genero = learnPanel.querySelector('.ag-learn-genero')?.value.trim() || '';
      const relaciones = leerRelaciones(learnPanel.querySelector('.ag-learn-rel')?.value);
      if (!lema || !definicion) {
        setLearnStatus('Indica al menos el lema y la definición.', 'error');
        return;
      }
      setLearnStatus('Guardando…');
      try {
        const r = await api('conocimiento/ensenar', {
          method: 'POST',
          body: { tipo: 'concepto', lema, definicion, genero, relaciones },
        });
        const total = r.estadisticas?.conceptos;
        setLearnStatus(`Guardado: ${r.concepto?.lema || lema}${total ? ` · ${total.toLocaleString('es-ES')} conceptos` : ''}.`, 'ok');
        learnForm.reset();
        updateStatus();
      } catch (err) {
        setLearnStatus(`No se pudo guardar: ${err.message}`, 'error');
      }
    };

    learnPanel.querySelector('.ag-learn-cancel').onclick = () => {
      learnForm.reset();
      learnPanel.hidden = true;
      setLearnStatus('');
    };

    win.body.querySelectorAll('.ag-ext-tab').forEach((tab) => {
      tab.onclick = () => {
        win.body.querySelectorAll('.ag-ext-tab').forEach((t) => t.classList.toggle('on', t === tab));
        win.body.querySelectorAll('.ag-ext-pane').forEach((p) => {
          p.hidden = p.dataset.pane !== tab.dataset.tab;
        });
      };
    });

    const mcpTransport = $('.ag-mcp-transport');
    mcpTransport.onchange = () => {
      const http = mcpTransport.value === 'http';
      $('.ag-mcp-stdio').hidden = http;
      $('.ag-mcp-http').hidden = !http;
    };

    async function renderExtensions() {
      let data = { mcps: [], skills: [] };
      try { data = await api('agentic/extensions'); } catch { /* sin servicio */ }
      const mcps = data.mcps || [];
      const skills = data.skills || [];
      extBtn.title = `${mcps.filter((m) => m.enabled).length} MCP · ${skills.filter((s) => s.enabled).length} skills`;

      mcpListEl.innerHTML = mcps.length ? '' : '<div class="ag-ext-empty">Aún no hay servidores MCP. Añade uno o importa un JSON.</div>';
      for (const mcp of mcps) {
        const row = document.createElement('div');
        row.className = 'ag-ext-item';
        const tools = (mcp.lastTools || []).map((t) => t.name).join(', ');
        row.innerHTML = `
          <div class="ag-ext-item-main">
            <strong>${esc(mcp.name)}</strong>
            <span class="ag-ext-meta">${esc(mcp.transport)}${mcp.command ? ' · ' + esc(mcp.command) : ''}${mcp.url ? ' · ' + esc(mcp.url) : ''}</span>
            <span class="ag-ext-meta">${mcp.lastError ? 'Error: ' + esc(mcp.lastError) : (tools ? 'Herramientas: ' + esc(tools) : 'Sin conectar aún')}</span>
          </div>
          <div class="ag-ext-item-actions">
            <label class="ag-toggle"><input type="checkbox" ${mcp.enabled ? 'checked' : ''}> Activo</label>
            <button type="button" class="pill soft" data-act="test">Probar</button>
            <button type="button" class="icon-btn" data-act="del" title="Quitar">${GLYPHS.trash}</button>
          </div>`;
        row.querySelector('input').onchange = async (e) => {
          await api(`agentic/mcp/${mcp.id}`, { method: 'POST', body: { enabled: e.target.checked } });
          renderExtensions();
        };
        row.querySelector('[data-act="test"]').onclick = async () => {
          ctx.notify('Conectando MCP…', 3000, { title: 'Agentic', icon: 'agentic' });
          const res = await api('agentic/mcp/test', { method: 'POST', body: { id: mcp.id } });
          ctx.notify(res.ok ? `MCP listo (${(res.tools || []).length} herramientas)` : (res.error || 'Falló'), 5000, { title: 'Agentic', icon: 'agentic' });
          renderExtensions();
        };
        row.querySelector('[data-act="del"]').onclick = async () => {
          await api(`agentic/mcp/${mcp.id}`, { method: 'DELETE' });
          renderExtensions();
        };
        mcpListEl.appendChild(row);
      }

      skillListEl.innerHTML = skills.length ? '' : '<div class="ag-ext-empty">Aún no hay skills. Pega un SKILL.md o escribe las instrucciones.</div>';
      for (const skill of skills) {
        const row = document.createElement('div');
        row.className = 'ag-ext-item';
        row.innerHTML = `
          <div class="ag-ext-item-main">
            <strong>${esc(skill.name)}</strong>
            <span class="ag-ext-meta">${esc(skill.description || '')}</span>
          </div>
          <div class="ag-ext-item-actions">
            <label class="ag-toggle"><input type="checkbox" ${skill.enabled ? 'checked' : ''}> Activa</label>
            <button type="button" class="icon-btn" data-act="del" title="Quitar">${GLYPHS.trash}</button>
          </div>`;
        row.querySelector('input').onchange = async (e) => {
          await api(`agentic/skill/${skill.id}`, { method: 'POST', body: { enabled: e.target.checked } });
          renderExtensions();
        };
        row.querySelector('[data-act="del"]').onclick = async () => {
          await api(`agentic/skill/${skill.id}`, { method: 'DELETE' });
          renderExtensions();
        };
        skillListEl.appendChild(row);
      }
    }

    $('.ag-mcp-form').onsubmit = async (e) => {
      e.preventDefault();
      const transport = mcpTransport.value;
      const body = {
        kind: 'mcp',
        name: $('.ag-mcp-name').value.trim(),
        transport,
        command: $('.ag-mcp-command').value.trim(),
        args: $('.ag-mcp-args').value.trim(),
        cwd: $('.ag-mcp-cwd').value.trim(),
        env: $('.ag-mcp-env').value,
        url: $('.ag-mcp-url').value.trim(),
        headers: $('.ag-mcp-headers').value,
      };
      try {
        const { mcp } = await api('agentic/extensions', { method: 'POST', body });
        $('.ag-mcp-form').reset();
        mcpTransport.onchange();
        ctx.notify(`MCP «${mcp.name}» añadido`, 3000, { title: 'Agentic', icon: 'agentic' });
        await renderExtensions();
        const testRes = await api('agentic/mcp/test', { method: 'POST', body: { id: mcp.id } });
        if (!testRes.ok) ctx.notify(testRes.error || 'No se pudo conectar el MCP', 6000, { title: 'Agentic', icon: 'agentic' });
        await renderExtensions();
      } catch (err) {
        ctx.notify(err.message, 6000, { title: 'Agentic', icon: 'agentic' });
      }
    };

    $('.ag-mcp-import').onclick = async () => {
      const json = $('.ag-mcp-json').value.trim();
      if (!json) return;
      try {
        const { mcps } = await api('agentic/extensions', { method: 'POST', body: { kind: 'import-mcp', json } });
        $('.ag-mcp-json').value = '';
        ctx.notify(`${(mcps || []).length} servidor(es) MCP importados`, 4000, { title: 'Agentic', icon: 'agentic' });
        await renderExtensions();
      } catch (err) {
        ctx.notify(err.message, 6000, { title: 'Agentic', icon: 'agentic' });
      }
    };

    $('.ag-skill-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('.ag-skill-name').value.trim();
      const description = $('.ag-skill-desc').value.trim();
      const body = $('.ag-skill-body').value;
      try {
        if (body.includes('---') && !description) {
          await api('agentic/extensions', { method: 'POST', body: { kind: 'skill', text: body, source: name || 'manual' } });
        } else {
          await api('agentic/extensions', { method: 'POST', body: { kind: 'skill', name, description, body } });
        }
        $('.ag-skill-form').reset();
        ctx.notify('Skill añadida', 3000, { title: 'Agentic', icon: 'agentic' });
        await renderExtensions();
      } catch (err) {
        ctx.notify(err.message, 6000, { title: 'Agentic', icon: 'agentic' });
      }
    };

    $('.ag-skill-file').onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const text = await file.text();
      try {
        await api('agentic/extensions', { method: 'POST', body: { kind: 'skill', text, source: file.name } });
        ctx.notify(`Skill importada desde ${file.name}`, 4000, { title: 'Agentic', icon: 'agentic' });
        await renderExtensions();
      } catch (err) {
        ctx.notify(err.message, 6000, { title: 'Agentic', icon: 'agentic' });
      }
    };

    // Cambiar el modelo del agente o el de redacción
    async function setModel(which, newModel) {
      const value = String(newModel || '').trim();
      if (!value) return;
      const key = which === 'write' ? 'writeModel' : 'model';
      const label = which === 'write' ? 'redacción' : 'agente';
      try {
        await api('agentic/config', { method: 'POST', body: { [key]: value } });
        ctx.notify(`Modelo de ${label} configurado a ${value}`, 4000, { title: 'Agentic', icon: 'agentic' });
        await updateStatus();
        const installed = which === 'write' ? currentStatus?.isWriteModelInstalled : currentStatus?.isModelInstalled;
        if (currentStatus?.running && !installed) {
          downloadTarget = value;
          dlArea.hidden = false;
          dlStatus.textContent = `El modelo ${value} no está descargado aún en este equipo.`;
          dlBtn.hidden = false;
          dlBtn.disabled = false;
          dlBtn.textContent = `Descargar ${value} ahora`;
          // Dejar el panel abierto para poder descargarlo.
        } else {
          modelPanel.hidden = true;
        }
      } catch (err) {
        ctx.notify(`Error al cambiar modelo: ${err.message}`, 6000, { title: 'Agentic', icon: 'agentic' });
      }
    }

    saveModelBtn.onclick = () => setModel('model', modelInput.value);
    saveWriteModelBtn.onclick = () => setModel('write', writeModelInput.value);

    // Sugerencias de modelos
    win.body.querySelectorAll('.ag-tag[data-target]').forEach((btn) => {
      btn.onclick = async () => {
        const target = btn.dataset.target === 'write' ? 'write' : 'model';
        const modelEl = target === 'write' ? writeModelInput : modelInput;
        const value = btn.dataset.model;
        modelEl.value = value;
        setMode(target === 'write' ? 'redaccion' : 'agente');
        await setModel(target, value);
      };
    });

    // Descargar modelo con streaming SSE
    dlBtn.onclick = async () => {
      const modelToPull = downloadTarget
        || (mode === 'redaccion' ? currentStatus?.writeModel : currentStatus?.currentModel)
        || 'qwen3:1.7b';
      dlBtn.disabled = true;
      progressBar.hidden = false;
      dlStatus.textContent = `Iniciando descarga de ${modelToPull}...`;

      try {
        const res = await fetch('/api/agentic/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nubeos': '1' },
          body: JSON.stringify({ model: modelToPull }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const rawEvent = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (rawEvent.startsWith('data: ')) {
              try {
                const data = JSON.parse(rawEvent.slice(6));
                if (data.status) dlStatus.textContent = `${data.status} ${data.percent !== null ? `(${data.percent}%)` : ''}`;
                if (data.percent !== null) progressFill.style.width = `${data.percent}%`;
                if (data.done) {
                  dlStatus.textContent = `✓ Modelo ${modelToPull} descargado con éxito.`;
                  progressFill.style.width = '100%';
                  setTimeout(async () => {
                    downloadTarget = '';
                    await updateStatus();
                    progressBar.hidden = true;
                    dlBtn.disabled = false;
                  }, 1200);
                  break;
                }
              } catch { /* json parse */ }
            }
          }
        }
      } catch (err) {
        dlStatus.textContent = `Error al descargar: ${err.message}`;
        dlBtn.disabled = false;
      }
    };

    // Auto-ajustar altura del textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.onclick = sendMessage;

    // Clics en sugerencias iniciales
    win.body.querySelectorAll('.ag-prompt-chip').forEach((chip) => {
      chip.onclick = () => {
        input.value = chip.dataset.text;
        sendMessage();
      };
    });

    // Nueva conversación
    clearBtn.onclick = () => {
      history = [];
      chatInner.innerHTML = `
        <div class="ag-empty-state">
          <div class="ag-big-icon">${ICONS.agentic}</div>
          <h2>Conversación limpia</h2>
          <p>¿Qué te gustaría que automatice ahora en WonderfulOS?</p>
        </div>`;
      input.value = '';
    };

    // Renderizar mensaje
    function appendMessage(role, text = '') {
      $('.ag-empty-state')?.remove();
      const msgEl = document.createElement('div');
      msgEl.className = `ag-msg ag-msg-${role}`;

      if (role === 'user') {
        msgEl.innerHTML = `<div class="ag-bubble ag-bubble-user">${esc(text).replace(/\n/g, '<br>')}</div>`;
      } else {
        msgEl.innerHTML = `
          <div class="ag-avatar">${ICONS.agentic}</div>
          <div class="ag-bubble ag-bubble-agent">
            <div class="ag-think-box" hidden>
              <button class="ag-think-toggle">💭 Ver razonamiento</button>
              <div class="ag-think-body" hidden></div>
            </div>
            <div class="ag-tools-container"></div>
            <div class="ag-text">${renderMarkdown(text)}</div>
          </div>`;

        const thinkToggle = msgEl.querySelector('.ag-think-toggle');
        const thinkBody = msgEl.querySelector('.ag-think-body');
        if (thinkToggle && thinkBody) {
          thinkToggle.onclick = () => {
            const isHidden = thinkBody.hidden;
            thinkBody.hidden = !isHidden;
            thinkToggle.textContent = isHidden ? '💭 Ocultar razonamiento' : '💭 Ver razonamiento';
          };
        }
      }

      chatInner.appendChild(msgEl);
      scrollBottom();
      return msgEl;
    }

    function scrollBottom() {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    // Renderizador básico de texto / markdown
    function renderMarkdown(str) {
      if (!str) return '';
      let s = esc(str);
      // Negritas
      s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Código en línea
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Bloques de código
      s = s.replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
      // Saltos de línea
      s = s.replace(/\n/g, '<br>');
      return s;
    }

    // Enviar mensaje y procesar respuesta con streaming y herramientas
    async function sendMessage() {
      const text = input.value.trim();
      if (!text || isBusy) return;

      input.value = '';
      input.style.height = 'auto';
      isBusy = true;
      sendBtn.disabled = true;

      // Mensaje del usuario
      appendMessage('user', text);
      history.push({ role: 'user', content: text });

      // Mensaje del agente
      const agentMsgEl = appendMessage('assistant', '');
      const textEl = agentMsgEl.querySelector('.ag-text');
      const thinkBox = agentMsgEl.querySelector('.ag-think-box');
      const thinkBody = agentMsgEl.querySelector('.ag-think-body');
      const toolsContainer = agentMsgEl.querySelector('.ag-tools-container');

      textEl.innerHTML = '<span class="ag-cursor">▊</span>';

      let fullContent = '';
      let fullThink = '';

      if (mode === 'logica') {
        try {
          const r = await api('conocimiento/consultar', { method: 'POST', body: { texto: text } });
          fullContent = r.respuesta || 'Sin respuesta.';
          textEl.innerHTML = renderMarkdown(fullContent);

          const bubble = agentMsgEl.querySelector('.ag-bubble-agent');
          bubble?.classList.add('ag-logic-bubble');
          if (bubble) {
            const badge = document.createElement('div');
            badge.className = 'ag-logic-badge';
            badge.textContent = 'Motor simbólico · sin modelo';
            bubble.prepend(badge);

            const partes = [];
            const conceptos = (r.conceptos || [])
              .map((id) => String(id))
              .filter((id) => !id.startsWith('mcr:'));
            if (conceptos.length) {
              partes.push(`<div><strong>Conceptos:</strong> ${conceptos.map(esc).join(' · ')}</div>`);
            }
            if (r.fuentes?.length) {
              partes.push(`<div><strong>Fuentes:</strong> ${r.fuentes.map(esc).join(' · ')}</div>`);
            }
            if (r.avisos?.length) {
              partes.push(`<div class="ag-logic-warn"><strong>Avisos:</strong> ${r.avisos.map(esc).join(' · ')}</div>`);
            }
            if (partes.length) {
              const meta = document.createElement('div');
              meta.className = 'ag-logic-meta';
              meta.innerHTML = partes.join('');
              bubble.appendChild(meta);
            }
          }

          history.push({ role: 'assistant', content: fullContent });
          scrollBottom();
        } catch (err) {
          textEl.innerHTML = `<span class="ag-error">Error del motor lógico: ${esc(err.message)}</span>`;
        } finally {
          textEl.querySelector('.ag-cursor')?.remove();
          isBusy = false;
          sendBtn.disabled = false;
          input.focus();
        }
        return;
      }

      try {
        const res = await fetch('/api/agentic/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nubeos': '1' },
          body: JSON.stringify({ messages: history, mode }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamTerminated = false;

        while (!streamTerminated) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const rawEvent = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!rawEvent.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(rawEvent.slice(6));

              if (ev.error) {
                textEl.innerHTML = `<span class="ag-error">❌ ${esc(ev.error)}</span>`;
                streamTerminated = true;
                break;
              }

              if (ev.type === 'think' && ev.delta) {
                fullThink += ev.delta;
                thinkBox.hidden = false;
                thinkBody.innerHTML = esc(fullThink).replace(/\n/g, '<br>');
                scrollBottom();
              }

              if (ev.type === 'content' && ev.delta) {
                fullContent += ev.delta;
                textEl.innerHTML = renderMarkdown(fullContent) + '<span class="ag-cursor">▊</span>';
                scrollBottom();
              }

              if (ev.type === 'tool_start') {
                const toolCard = document.createElement('div');
                toolCard.className = 'ag-tool-card ag-tool-running';
                toolCard.dataset.name = ev.name;
                toolCard.innerHTML = `<span class="ag-tool-spinner">⚙</span> Ejecutando: <strong>${esc(formatToolTitle(ev.name, ev.args))}</strong>...`;
                toolsContainer.appendChild(toolCard);
                scrollBottom();
              }

              if (ev.type === 'tool_end') {
                const card = toolsContainer.querySelector(`.ag-tool-running[data-name="${ev.name}"]`);
                if (card) {
                  card.className = 'ag-tool-card ag-tool-done';
                  card.innerHTML = formatToolResultHtml(ev.name, ev.result, ctx);
                  // Notificar al sistema para refrescar árbol de archivos o apps si están abiertas
                  ctx.fs?.reload?.();
                }
                scrollBottom();
              }

              if (ev.type === 'done') {
                fullContent = ev.fullContent || fullContent;
                textEl.innerHTML = renderMarkdown(fullContent);
                streamTerminated = true;
                break;
              }
            } catch { /* parse error */ }
          }
        }
        try { await reader.cancel(); } catch {}

        if (fullContent && fullContent.trim()) {
          history.push({ role: 'assistant', content: fullContent });
        }
      } catch (err) {
        if (!streamTerminated) {
          if (fullContent && fullContent.trim()) {
            textEl.innerHTML = renderMarkdown(fullContent);
          } else if (fullThink && fullThink.trim()) {
            textEl.innerHTML = `<span class="ag-error">⚠️ La respuesta se interrumpió durante el razonamiento (${esc(err.message)}). Por favor, vuelve a intentarlo.</span>`;
          } else {
            textEl.innerHTML = `<span class="ag-error">❌ Error: ${esc(err.message)}</span>`;
          }
        }
      } finally {
        textEl.querySelector('.ag-cursor')?.remove();
        isBusy = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }

    // Formatear nombres amigables de herramientas
    function formatToolTitle(name, args) {
      switch (name) {
        case 'crear_documento': return `Crear documento "${args.nombre || args.ruta || 'Documento'}"`;
        case 'editar_documento': return `Editar documento "${args.ruta}"`;
        case 'leer_documento': return `Leer archivo "${args.ruta}"`;
        case 'crear_calculo': return `Crear hoja de cálculo "${args.nombre || args.ruta || 'Cálculo'}"`;
        case 'crear_lista_tareas': return `Crear lista de tareas "${args.titulo}"`;
        case 'agregar_tarea': return `Añadir tarea "${args.texto}"`;
        case 'crear_nota': return `Crear nota "${args.titulo}"`;
        case 'crear_evento_calendario': return `Agendar evento "${args.titulo}"`;
        case 'listar_archivos': return `Explorar archivos`;
        case 'buscar_internet': return `Buscar en internet "${args.consulta}"`;
        case 'buscar_imagenes': return `Buscar imágenes de "${args.consulta}"`;
        case 'leer_pagina_web': return `Leer y extraer web "${args.url}"`;
        case 'descargar_archivo': return `Descargar desde "${args.url}"`;
        case 'usar_skill': return `Cargar skill "${args.nombre || ''}"`;
        case 'listar_correos': return `Listar correos (${args.carpeta || 'inbox'})`;
        case 'buscar_correos': return `Buscar correos "${args.consulta || ''}"`;
        case 'leer_correo': return `Leer correo ${args.id || ''}`;
        case 'crear_correo': return `Redactar correo "${args.asunto || ''}"`;
        case 'enviar_correo': return `Enviar correo${args.para ? ` a ${args.para}` : ''}`;
        case 'borrar_correo': return `Borrar correo ${args.id || ''}`;
        case 'mover_correo': return `Mover correo ${args.id || ''}`;
        case 'vaciar_papelera': return `Vaciar ${args.carpeta && args.carpeta !== 'trash' ? args.carpeta : 'Papelera'} de Correo`;
        case 'sincronizar_correo': return 'Sincronizar correo';
        default: return name.startsWith('mcp_') ? name.replace(/^mcp_/, 'MCP · ') : name;
      }
    }

    // Formatear resultado interactivo de herramientas con botones de acción directa en el SO
    function formatToolResultHtml(name, result, context) {
      if (!result.ok) {
        return `<span class="ag-tool-badge error">✗ Falló</span> Error: ${esc(result.error || 'Error al ejecutar')}`;
      }

      switch (name) {
        case 'buscar_internet': {
          const total = result.resultados?.length || 0;
          return `<span class="ag-tool-badge ok">✓ Búsqueda web completada</span> Encontrados <strong>${total} resultados</strong> relevantes`;
        }

        case 'buscar_imagenes': {
          const total = result.imagenes?.length || 0;
          return `<span class="ag-tool-badge ok">✓ Búsqueda de imágenes</span> Encontradas <strong>${total} imágenes</strong> listas`;
        }

        case 'leer_pagina_web': {
          return `<span class="ag-tool-badge ok">✓ Contenido web extraído</span> <strong>${esc(result.titulo || result.url)}</strong> (${result.caracteres || 0} caracteres leídos)`;
        }

        case 'descargar_archivo': {
          const p = result.ruta;
          const openBtnId = `btn-open-dl-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.openFile ? context.openFile(p) : context.apps?.find?.((a) => a.id === 'archivos')?.launch(context, p);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Archivo descargado</span> Guardado en <strong>${esc(p)}</strong>
            <button id="${openBtnId}" class="ag-action-pill">Ver en Archivos</button>`;
        }
        case 'crear_documento':
        case 'editar_documento': {
          const p = result.ruta;
          const openBtnId = `btn-open-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.openFile ? context.openFile(p) : context.apps?.find?.((a) => a.id === 'texto')?.launch(context, p);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Documento guardado</span> <strong>${esc(p)}</strong>
            <button id="${openBtnId}" class="ag-action-pill">Abrir en Texto</button>`;
        }

        case 'crear_calculo': {
          const p = result.ruta;
          const openBtnId = `btn-open-calc-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.openFile ? context.openFile(p) : context.apps?.find?.((a) => a.id === 'calculo')?.launch(context, p);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Hoja de cálculo creada</span> <strong>${esc(p)}</strong> (${result.filas || 0} filas con fórmulas)
            <button id="${openBtnId}" class="ag-action-pill">Abrir en Cálculo</button>`;
        }

        case 'crear_lista_tareas':
        case 'agregar_tarea': {
          const openBtnId = `btn-open-list-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.apps?.find?.((a) => a.id === 'listas')?.launch(context);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Tarea añadida</span> En <strong>Listas</strong>
            <button id="${openBtnId}" class="ag-action-pill">Ver en Listas</button>`;
        }

        case 'crear_nota': {
          const openBtnId = `btn-open-notes-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.apps?.find?.((a) => a.id === 'notas')?.launch(context);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Nota guardada</span> En <strong>Notas</strong>
            <button id="${openBtnId}" class="ag-action-pill">Ver en Notas</button>`;
        }

        case 'crear_evento_calendario': {
          const openBtnId = `btn-open-cal-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.apps?.find?.((a) => a.id === 'calendario')?.launch(context);
          }, 50);
          return `<span class="ag-tool-badge ok">✓ Evento programado</span> En <strong>Calendario</strong>
            <button id="${openBtnId}" class="ag-action-pill">Ver en Calendario</button>`;
        }

        case 'usar_skill':
          return `<span class="ag-tool-badge ok">✓ Skill</span> Instrucciones de <strong>${esc(result.nombre || name)}</strong>`;
        case 'listar_correos': case 'buscar_correos': case 'leer_correo': case 'crear_correo':
        case 'enviar_correo': case 'borrar_correo': case 'mover_correo': case 'vaciar_papelera': case 'sincronizar_correo': {
          const openBtnId = `btn-open-mail-${Date.now()}`;
          setTimeout(() => {
            const btn = document.getElementById(openBtnId);
            if (btn) btn.onclick = () => context.apps?.find?.((a) => a.id === 'correo')?.launch(context);
          }, 50);
          const text = {
            listar_correos: `${result.total ?? 0} correos`,
            buscar_correos: `${result.total ?? 0} resultados`,
            leer_correo: esc(result.correo?.asunto || 'Correo leído'),
            crear_correo: `Borrador "${esc(result.asunto || '')}" guardado`,
            enviar_correo: result.pendiente ? 'En Bandeja de salida (configura la cuenta)' : `Enviado a ${esc(result.para || '')}`,
            borrar_correo: result.borrado === 'definitivo' ? 'Eliminado para siempre' : 'Movido a la Papelera',
            mover_correo: `Ahora en ${esc(result.carpeta || '')}`,
            vaciar_papelera: `${result.borrados ?? 0} correos eliminados`,
            sincronizar_correo: `${result.nuevos ?? 0} correos nuevos`,
          }[name];
          return `<span class="ag-tool-badge ok">✓ Correo</span> ${text}
            <button id="${openBtnId}" class="ag-action-pill">Abrir Correo</button>`;
        }
        default:
          if (result.resultado) {
            return `<span class="ag-tool-badge ok">✓ MCP</span> ${esc(String(result.resultado).slice(0, 180))}`;
          }
          return `<span class="ag-tool-badge ok">✓ Completado</span> ${esc(name)}`;
      }
    }

    // Inicializar estado
    await updateStatus();
    await renderExtensions();
  },
};
