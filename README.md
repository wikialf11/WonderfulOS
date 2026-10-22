# WonderfulOS

Un sistema operativo sencillo y bonito, basado en Linux, para trabajar: Navegador, Archivos,
Listas, Notas, Calendario, Texto, Cálculo, Presentaciones (LibreOffice), Llavero y Ajustes.
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

No necesita dependencias ni compilación, solo Node.js. Desde la carpeta del proyecto:

```bash
cd web-desktop && node server.mjs
```

y abre <http://127.0.0.1:4310>. El servicio también arranca, en el puerto 4311,
el proxy local de navegación que permite al Navegador mostrar webs y buscar sin
salir del escritorio. Todo se queda en tu equipo.

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
| **Llavero** | Contraseñas cifradas con una contraseña maestra propia, sin conexión ni recuperación remota. |
| **Ajustes** | Apariencia, fondo, dock, pantalla, accesibilidad, almacenamiento local y apps de Linux. |

Pruebas del motor de fórmulas:

```bash
cd web-desktop && node --test tests/*.test.mjs
```

## Estructura

```
docs/ARQUITECTURA.md     Visión, componentes, seguridad y copias de seguridad
web-desktop/             Escritorio en el navegador (HTML/CSS/JS sin dependencias)
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
