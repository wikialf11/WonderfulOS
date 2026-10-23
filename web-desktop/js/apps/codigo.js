// Código: Estudio de Programación Agéntica para WonderfulOS.
// Integra toda la potencia original de Agentic: razonamiento del arquitecto, generación de proyectos (/crear),
// editor de código, comprobador determinista de sintaxis y ejecución en terminal.

import { api } from '../api.js';
import { ICONS, GLYPHS } from '../shell/icons.js';
import { esc } from '../util.js';
import { prompt, confirm } from '../dialogs.js';

const APP = 'codigo';

export default {
  id: APP,
  name: 'Código',
  description: 'Estudio de programación y desarrollo agéntico con IA',

  async launch(ctx, arg) {
    const win = ctx.createWindow({
      title: 'Código — Estudio Agéntico',
      width: 1100,
      height: 700,
      appId: APP,
    });
    win.body.classList.add('app-workspace', 'app-codigo');

    win.body.innerHTML = `
      <div class="ide-layout">
        <!-- Barra de herramientas superior -->
        <header class="ide-toolbar">
          <div class="ide-tools-left">
            <span class="ide-brand-icon">${ICONS.codigo}</span>
            <span class="ide-brand-title">Estudio Agéntico</span>
            <button class="pill soft ide-new-file-btn" title="Nuevo archivo de código">${GLYPHS.plusDoc} Nuevo</button>
            <button class="pill soft ide-save-btn" title="Guardar archivo actual (Ctrl+S)">💾 Guardar</button>
            <button class="pill soft ide-check-btn" title="Comprobar sintaxis">✓ Sintaxis</button>
            <button class="pill ide-run-btn" title="Ejecutar archivo actual">${GLYPHS.play} Ejecutar</button>
          </div>
          <div class="ide-tools-right">
            <span class="ide-file-info">Sin archivo abierto</span>
            <button class="icon-btn ide-toggle-ai" title="Alternar panel de Agentic">${GLYPHS.spark}</button>
          </div>
        </header>

        <!-- Cuerpo del IDE: Explorador + Editor + Panel Agéntico -->
        <div class="ide-main">
          <!-- Explorador de archivos del proyecto -->
          <aside class="ide-files-side">
            <div class="ide-side-header">
              <span>PROYECTO</span>
              <button class="icon-btn ide-refresh-files" title="Refrescar archivos">↻</button>
            </div>
            <div class="ide-file-tree"></div>
          </aside>

          <!-- Centro: Tabs + Editor + Salida de consola -->
          <section class="ide-editor-center">
            <div class="ide-tabs"></div>
            <div class="ide-editor-wrap">
              <div class="ide-gutter"></div>
              <textarea class="ide-editor" spellcheck="false" placeholder="// Selecciona un archivo o pide a Agentic que escriba código..."></textarea>
            </div>
            <!-- Consola de salida / Terminal -->
            <div class="ide-console">
              <div class="ide-console-header">
                <span>Terminal / Salida</span>
                <button class="icon-btn ide-console-clear" title="Limpiar">${GLYPHS.trash}</button>
              </div>
              <pre class="ide-console-output">Listo. Pulsa «Ejecutar» o pídele a Agentic que programe para ti.</pre>
            </div>
          </section>

          <!-- Derecha: Copiloto y Arquitecto Agentic -->
          <aside class="ide-agent-side">
            <div class="ide-agent-header">
              <div class="ide-agent-title">
                <span>${ICONS.agentic}</span>
                <strong>Arquitecto Agentic</strong>
              </div>
              <span class="ide-agent-badge">qwen3:1.7b</span>
            </div>

            <div class="ide-agent-chat">
              <div class="ide-agent-scroll">
                <div class="ide-agent-intro">
                  <h3>Programación Autónoma</h3>
                  <p>Agentic puede diseñar arquitecturas, escribir módulos completos, corregir bugs y crear proyectos enteros a partir de tus especificaciones.</p>
                  <div class="ide-quick-prompts">
                    <button class="ide-prompt-btn" data-prompt="Crea un servidor web en Node.js con una API REST para gestionar tareas en JSON">API REST en Node.js</button>
                    <button class="ide-prompt-btn" data-prompt="Escribe un analizador de datos en JavaScript con cálculo de estadísticas y medianas">Analizador de datos</button>
                    <button class="ide-prompt-btn" data-prompt="Crea un juego sencillo de la serpiente (Snake) en HTML5 canvas y JavaScript">Juego Snake en HTML/JS</button>
                    <button class="ide-prompt-btn" data-prompt="Crea una función para procesar CSV con validación de columnas">Procesador de CSV</button>
                  </div>
                </div>
              </div>

              <!-- Input del agente de código -->
              <div class="ide-agent-input-wrap">
                <textarea class="ide-agent-input" placeholder="Pídele código a Agentic o escribe /crear <idea>..." rows="2"></textarea>
                <button class="pill ide-agent-send-btn">${GLYPHS.send} Generar</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    const $ = (s) => win.body.querySelector(s);
    const editor = $('.ide-editor');
    const gutter = $('.ide-gutter');
    const tabsEl = $('.ide-tabs');
    const fileTreeEl = $('.ide-file-tree');
    const fileInfo = $('.ide-file-info');
    const consoleOutput = $('.ide-console-output');
    const runBtn = $('.ide-run-btn');
    const checkBtn = $('.ide-check-btn');
    const saveBtn = $('.ide-save-btn');
    const newFileBtn = $('.ide-new-file-btn');
    const refreshFilesBtn = $('.ide-refresh-files');
    const agentScroll = $('.ide-agent-scroll');
    const agentInput = $('.ide-agent-input');
    const agentSendBtn = $('.ide-agent-send-btn');
    const consoleClearBtn = $('.ide-console-clear');
    const toggleAiBtn = $('.ide-toggle-ai');
    const agentSide = $('.ide-agent-side');

    let openFiles = new Map(); // path -> content
    let activePath = null;
    let isAgentBusy = false;

    // Actualizar numeración de líneas en el editor
    function updateGutter() {
      const linesCount = (editor.value || '').split('\n').length;
      gutter.innerHTML = Array.from({ length: linesCount }, (_, i) => i + 1).join('<br>');
    }

    editor.addEventListener('input', () => {
      updateGutter();
      if (activePath) openFiles.set(activePath, editor.value);
    });

    editor.addEventListener('scroll', () => {
      gutter.scrollTop = editor.scrollTop;
    });

    // Soporte para tabulador dentro del editor de código
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        updateGutter();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    // Cargar árbol de archivos
    async function loadTree() {
      const tree = ctx.fs.tree ? ctx.fs.tree() : {};
      fileTreeEl.innerHTML = '';

      const files = Object.entries(tree)
        .filter(([p, node]) => node.type === 'file' && (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.py') || p.endsWith('.html') || p.endsWith('.json') || p.endsWith('.css') || p.endsWith('.md') || p.endsWith('.txt')))
        .sort((a, b) => a[0].localeCompare(b[0]));

      if (files.length === 0) {
        fileTreeEl.innerHTML = `<div class="ide-empty-tree">No hay archivos de código aún en /Documentos</div>`;
        return;
      }

      for (const [p, node] of files) {
        const item = document.createElement('div');
        item.className = `ide-tree-item ${p === activePath ? 'on' : ''}`;
        const name = p.split('/').pop();
        const ext = name.split('.').pop();
        item.innerHTML = `<span class="ide-ext-badge ext-${esc(ext)}">${esc(ext)}</span><span class="ide-tree-name">${esc(name)}</span>`;
        item.onclick = () => openFile(p);
        fileTreeEl.appendChild(item);
      }
    }

    async function openFile(filePath) {
      if (!openFiles.has(filePath)) {
        const node = ctx.fs.stat(filePath);
        const content = node?.content !== undefined ? node.content : '';
        openFiles.set(filePath, content);
      }
      activePath = filePath;
      editor.value = openFiles.get(filePath);
      fileInfo.textContent = filePath;
      updateGutter();
      renderTabs();
      loadTree();
      editor.focus();
    }

    function renderTabs() {
      tabsEl.innerHTML = '';
      for (const p of openFiles.keys()) {
        const tab = document.createElement('div');
        tab.className = `ide-tab ${p === activePath ? 'on' : ''}`;
        const name = p.split('/').pop();
        tab.innerHTML = `<span>${esc(name)}</span><button class="ide-tab-close" data-path="${esc(p)}">×</button>`;
        tab.onclick = (e) => {
          if (e.target.classList.contains('ide-tab-close')) {
            e.stopPropagation();
            closeFile(p);
          } else {
            openFile(p);
          }
        };
        tabsEl.appendChild(tab);
      }
    }

    function closeFile(p) {
      openFiles.delete(p);
      if (activePath === p) {
        activePath = Array.from(openFiles.keys())[0] || null;
        if (activePath) openFile(activePath);
        else {
          editor.value = '';
          fileInfo.textContent = 'Sin archivo abierto';
          updateGutter();
        }
      }
      renderTabs();
    }

    async function saveCurrentFile() {
      if (!activePath) {
        const name = await prompt('Nombre del archivo:', 'app.js');
        if (!name) return;
        activePath = name.startsWith('/') ? name : `/Documentos/${name}`;
      }

      const content = editor.value;
      try {
        await ctx.fs.writeFile(activePath, content);
        openFiles.set(activePath, content);
        ctx.notify(`Guardado: ${activePath}`, 3000, { title: 'Código', icon: 'codigo' });
        loadTree();
      } catch (err) {
        ctx.notify(`Error al guardar: ${err.message}`, 4000, { title: 'Código', icon: 'codigo' });
      }
    }

    saveBtn.onclick = saveCurrentFile;

    newFileBtn.onclick = async () => {
      const name = await prompt('Nombre del nuevo archivo (ej: script.js o programa.py):', 'nuevo.js');
      if (!name) return;
      const p = name.startsWith('/') ? name : `/Documentos/${name}`;
      await ctx.fs.writeFile(p, '// Código inicial\nconsole.log("Hola desde WonderfulOS!");\n');
      await openFile(p);
    };

    refreshFilesBtn.onclick = loadTree;

    // Comprobador determinista de sintaxis
    checkBtn.onclick = async () => {
      const code = editor.value;
      const ext = activePath ? activePath.split('.').pop().toLowerCase() : 'js';

      consoleOutput.textContent = 'Comprobando sintaxis con analizador oficial...';
      try {
        if (ext === 'json') {
          JSON.parse(code);
          consoleOutput.textContent = '✓ Sintaxis JSON correcta.';
        } else {
          // Usar backend de ejecución para comprobar sintaxis (node --check)
          const res = await api('agentic/run-code', {
            method: 'POST',
            body: { language: ext, code: ext === 'js' || ext === 'mjs' ? code : code },
          });
          if (res.ok) {
            consoleOutput.textContent = `✓ Sintaxis ${ext.toUpperCase()} correcta. No se detectaron errores.`;
          } else {
            consoleOutput.textContent = `⚠ ERROR DE SINTAXIS:\n${res.stderr || 'Error al validar'}`;
          }
        }
      } catch (err) {
        consoleOutput.textContent = `⚠ ERROR:\n${err.message}`;
      }
    };

    // Ejecutar código
    runBtn.onclick = async () => {
      const code = editor.value;
      const ext = activePath ? activePath.split('.').pop().toLowerCase() : 'js';
      consoleOutput.textContent = `▶ Ejecutando ${activePath || 'código'} (${ext})...\n`;

      try {
        const res = await api('agentic/run-code', {
          method: 'POST',
          body: { language: ext, code },
        });

        const output = [];
        if (res.stdout) output.push(res.stdout);
        if (res.stderr) output.push(`[STDERR]\n${res.stderr}`);
        output.push(`\n[Proceso finalizado con código de salida: ${res.code}]`);
        consoleOutput.textContent = output.join('\n');
      } catch (err) {
        consoleOutput.textContent = `Error al ejecutar: ${err.message}`;
      }
    };

    consoleClearBtn.onclick = () => { consoleOutput.textContent = ''; };
    toggleAiBtn.onclick = () => { agentSide.hidden = !agentSide.hidden; };

    // Envío al Copiloto Agentic
    agentSendBtn.onclick = sendAgenticCodeTask;
    agentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAgenticCodeTask();
      }
    });

    win.body.querySelectorAll('.ide-prompt-btn').forEach((btn) => {
      btn.onclick = () => {
        agentInput.value = btn.dataset.prompt;
        sendAgenticCodeTask();
      };
    });

    async function sendAgenticCodeTask() {
      const task = agentInput.value.trim();
      if (!task || isAgentBusy) return;

      agentInput.value = '';
      isAgentBusy = true;
      agentSendBtn.disabled = true;

      const userCard = document.createElement('div');
      userCard.className = 'ide-agent-msg user';
      userCard.textContent = task;
      agentScroll.appendChild(userCard);

      const agentCard = document.createElement('div');
      agentCard.className = 'ide-agent-msg agent';
      agentCard.innerHTML = `
        <div class="ide-think-block" hidden>
          <div class="ide-think-title">💭 Razonamiento del arquitecto:</div>
          <div class="ide-think-text"></div>
        </div>
        <div class="ide-code-output"></div>
      `;
      agentScroll.appendChild(agentCard);
      agentScroll.scrollTop = agentScroll.scrollHeight;

      const thinkBlock = agentCard.querySelector('.ide-think-block');
      const thinkText = agentCard.querySelector('.ide-think-text');
      const codeOutput = agentCard.querySelector('.ide-code-output');

      let fullContent = '';
      let fullThink = '';

      try {
        const promptSystem = `Eres el Arquitecto y Programador Agentic dentro del IDE de WonderfulOS.
Tienes que escribir código real, completo y funcional para la petición del usuario.
Si te piden crear un script o programa, genera el código completo sin placeholders ni '...' usando la herramienta crear_documento o redactándolo directamente en bloques de código markdown con su lenguaje.`;

        const res = await fetch('/api/agentic/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nubeos': '1' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: promptSystem },
              { role: 'user', content: task },
            ],
          }),
        });

        if (!res.ok) throw new Error('Error al conectar con el motor de Agentic');

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
            if (!rawEvent.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(rawEvent.slice(6));
              if (ev.type === 'think' && ev.delta) {
                fullThink += ev.delta;
                thinkBlock.hidden = false;
                thinkText.innerHTML = esc(fullThink).replace(/\n/g, '<br>');
                agentScroll.scrollTop = agentScroll.scrollHeight;
              }
              if (ev.type === 'content' && ev.delta) {
                fullContent += ev.delta;
                codeOutput.innerHTML = esc(fullContent).replace(/\n/g, '<br>');
                agentScroll.scrollTop = agentScroll.scrollHeight;
              }
              if (ev.type === 'tool_end') {
                await loadTree();
                if (ev.result?.ruta) {
                  openFile(ev.result.ruta);
                }
              }
            } catch { /* parse */ }
          }
        }

        // Si el contenido trae un bloque de código, ofrecer insertarlo al editor
        const codeMatch = fullContent.match(/```(?:[a-z]+)?\n([\s\S]*?)```/);
        if (codeMatch && codeMatch[1]) {
          const insertBtn = document.createElement('button');
          insertBtn.className = 'pill soft ide-insert-code-btn';
          insertBtn.textContent = '📥 Cargar en el editor';
          insertBtn.onclick = () => {
            editor.value = codeMatch[1];
            updateGutter();
            ctx.notify('Código insertado en el editor', 3000, { title: 'Código', icon: 'codigo' });
          };
          agentCard.appendChild(insertBtn);
        }
      } catch (err) {
        codeOutput.innerHTML = `<span style="color:#ef4444">Error: ${esc(err.message)}</span>`;
      } finally {
        isAgentBusy = false;
        agentSendBtn.disabled = false;
      }
    }

    // Inicializar
    await loadTree();
    if (arg) openFile(arg);
    else {
      // Abrir un archivo inicial si existe
      const files = Object.keys(ctx.fs.tree ? ctx.fs.tree() : {}).filter((p) => p.endsWith('.js') || p.endsWith('.py'));
      if (files.length > 0) openFile(files[0]);
    }
  },
};
