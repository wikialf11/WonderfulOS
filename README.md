# WonderfulOS

Un sistema operativo sencillo y bonito, basado en Linux, para trabajar: Navegador, Archivos,
Listas, Notas, Calendario, Correo, Texto, Cálculo, Presentaciones (LibreOffice), Llavero y Ajustes.
Es **software libre** (GPL-3.0-or-later).

- **Funciona en tu ordenador**: se instala como app en Mac, Windows y Linux (`desktop/`), o como
  sistema completo en un PC (`os/iso`, Debian + labwc).
- **Privado y local**: tus datos se guardan en tu disco y no salen de tu ordenador.
- **Sin cuentas, nube ni servicios externos**: no hay inicio de sesión, P2P, mensajería,
  compartición de archivos ni compras. El único servicio es local y escucha en `127.0.0.1`.

Partes del proyecto:
- `desktop/`: la app de escritorio (Electron): servicio local, oficina y motor Linux en Mac.
- `web-desktop/`: el escritorio y sus apps (HTML/JS) y su servicio local (archivos, datos y apps).
- `os/`: la ISO para instalar WonderfulOS como sistema de un PC.
- `docs/`: arquitectura y notas.

## Instalar

Descarga el instalador de tu sistema en la página de *Releases* (`.dmg` para Mac, `Setup .exe` para
Windows, `.AppImage` para Linux) o compílalo:

```bash
cd desktop && npm install && npx electron-builder
```

## Probar el escritorio web

Solo necesita Node.js. La primera vez instala las dependencias del correo (IMAP/SMTP) y después
arranca el servicio:

```bash
cd web-desktop && npm install && node server.mjs
```

y abre <http://127.0.0.1:4310>. El servicio también arranca, en el puerto 4311,
el proxy local de navegación que permite al Navegador mostrar webs y buscar sin
salir del escritorio. Todo se queda en tu equipo.

Notas del correo:
- En Gmail, Outlook, Yahoo o iCloud usa una **contraseña de aplicación** (las 16 letras, sin
  espacios). En Gmail hay que activar además IMAP en *Configuración › Reenvío y correo POP/IMAP*.
- Si un antivirus con escaneo SSL (Norton, Kaspersky, ESET…) intercepta la conexión, Node no
  reconoce su certificado. Guarda el certificado raíz del antivirus en `~/.nubeos/mail-ca.pem`
  (o indica otra ruta con `NUBEOS_MAIL_CA`) y reinicia; no hace falta desactivar la verificación TLS.

Notas de Agentic:
- Necesita [Ollama](https://ollama.com). Los modelos se pueden descargar desde la propia app o con
  `ollama pull qwen3:1.7b gemma2:2b`.
- En equipos de 8 GB, `gemma2:2b` (1,6 GB) es el equilibrio recomendado para redactar;
  `gemma3:1b` (806 MB) es la opción ultraligera si necesitas más RAM libre, a cambio de menor calidad.
- El modo **Agente** usa `qwen3:1.7b` y las herramientas del sistema (4096 tokens de contexto).
  El modo **Redacción** usa `gemma2:2b`, 2048 tokens y ninguna herramienta: así escribe mejor y
  consume menos memoria.
- El modo **Lógica** no usa Ollama ni ningún modelo neuronal. Es un motor simbólico con
  diccionario abierto, reglas de inferencia, búsqueda BM25, plantillas deterministas y
  herramientas web explícitas para consultar fuentes actuales.

### Motor de conocimiento simbólico (`Lógica`)

El modo **Lógica** de Agentic funciona en cualquier equipo con Node.js, aunque no haya modelos
descargados. No entrena ni genera con una red neuronal. Por defecto razona en local; solo abre
conexiones a internet cuando se lo pides explícitamente (búsqueda web, noticias o lectura de una
URL), y entonces muestra las fuentes consultadas.

- **Diccionario abierto**: semilla curada de 103 conceptos más 18.913 synsets del
  [Multilingual Central Repository (MCR/WordNet)](https://github.com/omwn/omw-data) en español,
  con licencia **CC BY 3.0**. Los datos generados están en `web-desktop/data/conocimiento/mcr-es.json`.
- **Grafo y reglas**: relaciones `es_un`, `parte_de`, `asociado_con`, `opuesto_a`, `sinonimo`…
  y reglas de transitividad, simetría y herencia. Cada respuesta puede incluir la traza de la
  inferencia.
- **Recuperación local**: BM25 sobre definiciones y documentos de ejemplo. No consulta internet
  salvo que la petición pida la web de forma explícita.
- **Herramientas web**: búsqueda en DuckDuckGo, titulares y fechas de Google News, y lectura
  extractiva de una URL. La respuesta incluye enlaces y fragmentos de las fuentes; si la red falla,
  lo dice y no inventa una respuesta.
- **Acciones locales**: puede crear notas, listas de tareas y documentos en las apps de
  WonderfulOS, y guardar un informe con fuentes cuando se lo pides junto a una búsqueda web.
- **Generación determinista**: correos formales, planes semanales, textos expositivos con
  introducción/desarrollo/conclusión/fuentes y listas. Las plantillas marcan los datos que faltan
  con placeholders.
- **Enseñanza**: desde el botón **+ Enseñar concepto** del modo Lógica se añaden conceptos con
  definición, género y relaciones. La API permite además enseñar relaciones, textos y reglas. Todo
  se guarda en `NUBEOS_DATA/conocimiento/` y se usa en la siguiente consulta.

Ejemplos de consultas:

```text
¿Qué es el verde?
¿El verde es una cualidad?
¿Qué relación hay entre verde y vegetación?
Redacta un correo formal al Ayuntamiento de La Laguna para solicitar un certificado de residencia.
Hazme un plan semanal realista para una persona autónoma que cuida de un familiar mayor.
Explica la vegetación.
Busca en internet las noticias de hoy sobre inteligencia artificial.
Busca en internet información sobre fotosíntesis y crea un informe en Documentos.
Lee esta página y resúmela: https://es.wikipedia.org/wiki/Fotosíntesis
Crea una nota con las ideas de la reunión de mañana.
Crea una lista de tareas para el proyecto con revisar el correo, preparar el informe y llamar a Ana.
Busca información sobre fotosíntesis.
```

API local (requiere la cabecera `x-nubeos: 1`):

```bash
curl -s http://127.0.0.1:4310/api/conocimiento/status -H 'x-nubeos: 1'
curl -s http://127.0.0.1:4310/api/conocimiento/consultar \
  -H 'x-nubeos: 1' -H 'content-type: application/json' \
  -d '{"texto":"¿Qué es el verde?"}'
```

Para enseñar un concepto:

```bash
curl -s http://127.0.0.1:4310/api/conocimiento/ensenar \
  -H 'x-nubeos: 1' -H 'content-type: application/json' \
  -d '{"tipo":"concepto","lema":"fotosíntesis artificial","definicion":"proceso técnico que imita la fotosíntesis natural","genero":"proceso"}'
```

Para enseñar una relación, usa `predicado` (no `tipo`, que reserva el tipo de operación):

```json
{"tipo":"relacion","origen":"fotosíntesis artificial","predicado":"parte_de","destino":"tecnología"}
```

El motor y su formato de datos se documentan en `docs/ARQUITECTURA.md` y en
`web-desktop/data/conocimiento/README.md`. Para regenerar el diccionario desde MCR:

```bash
cd web-desktop && node scripts/importar-mcr.mjs
```

Qué incluye:

| | |
|---|---|
| **Escritorio** | Ventanas que se mueven, redimensionan, minimizan y maximizan; barra de tareas; Launchpad con búsqueda; notificaciones; tema claro/oscuro y fondos lisos. |
| **Perfil local** | Un único perfil, sin cuentas ni contraseñas de sistema. Los datos se guardan en este ordenador (`~/.nubeos` o `NUBEOS_DATA`). |
| **Archivos** | Disco local: carpetas, crear, renombrar, eliminar, subir y descargar archivos y documentos. Sin carpetas compartidas ni funciones sociales. Si arrancas sin el servicio local, funciona en modo navegador con `localStorage`. |
| **Texto** | Editor `.txt`/`.md` con Abrir/Guardar (Ctrl+O / Ctrl+S), recuento de palabras y descarga. |
| **Cálculo** | Hoja de cálculo con fórmulas (`=SUMA(A1:A5)`, `PROMEDIO`, `MIN`, `MAX`, `CONTAR`, `SI`, `REDONDEAR`…), autosuma e importación/exportación CSV. |
| **Diapositivas** | Presentaciones con miniaturas, temas, reordenación y modo presentación a pantalla completa. |
| **Navegador** | En la app de escritorio usa Chromium; en el escritorio web, el proxy local. Las direcciones locales (p. ej. ComfyUI en `127.0.0.1:8188`) se abren directamente. Las **descargas** se guardan en Archivos › Descargas, en este equipo. |
| **Correo** | Cliente inspirado en FairEmail: IMAP/SMTP con detección automática de servidores, carpetas, búsqueda, destacados, borradores con autoguardado y firma. Sin cuenta funciona en local y lo enviado espera en la Bandeja de salida. |
| **Agentic** | Asistente local con Ollama. Modo **Agente** para automatizar el sistema (`qwen3:1.7b`), modo **Redacción** para correos, planes e ideas (`gemma2:2b`) y modo **Lógica** 100 % simbólico, sin modelo y con diccionario abierto. |
| **Llavero** | Contraseñas cifradas con una contraseña maestra propia, sin conexión ni recuperación remota. |
| **Ajustes** | Apariencia, fondo, dock, pantalla, accesibilidad, almacenamiento local y apps de Linux. |

Pruebas del motor de fórmulas y del motor de conocimiento:

```bash
cd web-desktop && node --test tests/*.test.mjs
```

## Estructura

```
docs/ARQUITECTURA.md     Visión, componentes, seguridad y copias de seguridad
web-desktop/             Escritorio en el navegador (HTML/CSS/JS; el correo usa IMAP/SMTP)
  server.mjs             Servicio local: escritorio, API y proxy
  server/api.mjs         API local: archivos, descargas y datos de apps
  server/store.mjs       Datos en disco: perfil local y archivos
  server/conocimiento.mjs Motor simbólico: léxico, reglas, BM25 y plantillas
  server/proxy.mjs       Proxy de navegación y búsqueda
  data/conocimiento/     Semilla, reglas, textos y diccionario MCR generado
  scripts/importar-mcr.mjs Importación reproducible de MCR/WordNet
  js/wm.js               Gestor de ventanas
  js/fs.js               Sistema de archivos virtual
  js/desktop.js          Shell: registro de apps, Launchpad, barra de tareas
  js/apps/               Apps nativas
  js/proxy.js            Navegación a través del proxy
desktop/                 App de escritorio (Electron)
os/iso/                  Sistema instalable para PC
```

## Licencia

WonderfulOS es software libre: se distribuye bajo la licencia **GNU GPL versión 3 o posterior** (ver `LICENSE`). Usa piezas libres de otros proyectos con sus propias licencias: Collabora Online / LibreOffice (MPL-2.0), Electron (MIT), Lima (Apache-2.0), Xpra (GPL-2.0) y Debian.

El diccionario del modo Lógica deriva del **Multilingual Central Repository (MCR) 2.0 / Open
Multilingual WordNet**, WordNet en español, distribuido bajo **CC BY 3.0**. La atribución completa,
la URL de origen y las transformaciones aplicadas están en
`web-desktop/data/conocimiento/README.md`.
