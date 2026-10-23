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
| **Agentic** | Asistente local con Ollama. Modo **Agente** para automatizar el sistema (`qwen3:1.7b`) y modo **Redacción** para correos, planes e ideas (`gemma2:2b`), sin herramientas y con menos contexto para ahorrar RAM. |
| **Llavero** | Contraseñas cifradas con una contraseña maestra propia, sin conexión ni recuperación remota. |
| **Ajustes** | Apariencia, fondo, dock, pantalla, accesibilidad, almacenamiento local y apps de Linux. |

Pruebas del motor de fórmulas:

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
  server/proxy.mjs       Proxy de navegación y búsqueda
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
