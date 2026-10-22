# WonderfulOS

Un sistema operativo sencillo y bonito, basado en Linux, para trabajar: Navegador, Archivos,
Listas, Notas, Calendario, Texto, Cálculo, Presentaciones (LibreOffice), Llavero y Ajustes.
Es **software libre** (GPL-3.0-or-later).

- **Funciona en tu ordenador**: se instala como app en Mac, Windows y Linux (`desktop/`), o como
  sistema completo en un PC (`os/iso`, Debian + labwc).
- **100% privado y local**: tus datos se guardan en tu disco y no salen de tu ordenador.
- **Sin servidores externos ni cuentas externas**: no hay P2P, servidor de equipo ni nube de pago.

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

Qué incluye el MVP:

| | |
|---|---|
| **Escritorio** | Ventanas que se mueven, redimensionan, minimizan y maximizan; barra de tareas; menú Inicio con búsqueda; notificaciones; tema claro/oscuro y fondos. |
| **Cuentas** | Inicio de sesión local para separar perfiles. Los datos se guardan en este ordenador (`~/.nubeos` o `NUBEOS_DATA`), no en un servidor externo. |
| **Archivos** | Disco local: carpetas, crear, renombrar, eliminar, subir y descargar archivos y documentos. Sin carpetas compartidas ni funciones sociales. Si arrancas sin el servicio local, funciona en modo navegador con `localStorage`. |
| **Texto** | Editor `.txt`/`.md` con Abrir/Guardar (Ctrl+O / Ctrl+S), recuento de palabras y descarga. |
| **Cálculo** | Hoja de cálculo con fórmulas (`=SUMA(A1:A5)`, `PROMEDIO`, `MIN`, `MAX`, `CONTAR`, `SI`, `REDONDEAR`…), autosuma e importación/exportación CSV. |
| **Diapositivas** | Presentaciones con miniaturas, temas, reordenación y modo presentación a pantalla completa. |
| **Navegador** | Busca y abre webs dentro del escritorio (a través del proxy local de navegación), con atrás/adelante. Las direcciones locales (p. ej. ComfyUI en `127.0.0.1:8188`) se abren directamente. Las **descargas** se guardan en Archivos › Descargas, en este equipo. |
| **Ajustes** | Apariencia, fondo, dock, pantalla, accesibilidad, almacenamiento local y apps de terceros. |

Pruebas del motor de fórmulas:

```bash
cd web-desktop && node --test tests/*.test.mjs
```

## Estructura

```
docs/ARQUITECTURA.md     Visión, componentes, planes, seguridad y hoja de ruta
web-desktop/             Escritorio en el navegador (HTML/CSS/JS sin dependencias)
  server.mjs             Servidor: escritorio, API y proxy
  server/api.mjs         API local: cuentas, archivos y descargas
  server/store.mjs       Datos en disco: usuarios, sesiones y archivos
  server/proxy.mjs       Proxy de navegación y búsqueda
  js/wm.js               Gestor de ventanas
  js/fs.js               Sistema de archivos virtual
  js/desktop.js          Shell: registro de apps, menú Inicio, barra de tareas
  js/apps/               Apps nativas
  js/proxy.js           Navegación a través del proxy
  js/thirdparty.js       Registro y ejecución aislada de apps de terceros
  store/                 Tienda de apps y apps de ejemplo (Reloj, Calculadora)
image/                   Imagen Debian arrancable en modo kiosko (mkosi)
```

## Licencia

WonderfulOS es software libre: se distribuye bajo la licencia **GNU GPL versión 3 o posterior** (ver `LICENSE`). Usa piezas libres de otros proyectos con sus propias licencias: Collabora Online / LibreOffice (MPL-2.0), Roundcube (GPL-3.0), Electron (MIT), Lima (Apache-2.0), Xpra (GPL-2.0) y Debian.
