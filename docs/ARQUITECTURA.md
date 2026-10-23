# WonderfulOS — Arquitectura

WonderfulOS es un sistema operativo personal y local basado en Linux. La app de
escritorio (Electron) y el escritorio web comparten la misma interfaz y las
mismas apps, pero todos los datos se quedan en el ordenador del usuario.

No hay P2P, servidor de equipo, mensajería, compartición de archivos, cuentas
externas ni planes en la nube. El único servicio que se ejecuta es local y
escucha en `127.0.0.1`.

---

## 1. Visión de conjunto

```
┌────────────────────────── Este ordenador ──────────────────────────┐
│                                                                   │
│  WonderfulOS (Electron)          Navegador del usuario            │
│  ├─ ventana + Chromium           └─ http://127.0.0.1:4310          │
│  ├─ servicio local (Node)                                          │
│  │   ├─ API de archivos y apps                                     │
│  │   ├─ datos de Listas, Notas, Calendario y Llavero              │
│  │   └─ proxy de navegación (127.0.0.1:4311)                       │
│  ├─ oficina (LibreOffice / motor local)                            │
│  └─ Llavero cifrado                                                │
│                                                                   │
│  Disco: ~/.nubeos o NUBEOS_DATA                                    │
└───────────────────────────────────────────────────────────────────┘
```

### Decisiones clave

| Tema | Decisión | Motivo |
|---|---|---|
| Privacidad | Todo se guarda en el disco local | Los datos no salen del equipo. |
| Servicio | Node sin dependencias en `web-desktop/server.mjs` | Sirve la interfaz, los archivos y los datos de las apps. |
| Acceso | Solo `127.0.0.1` | El servicio no se expone a la red local ni a internet. |
| Perfil | Un único perfil local, sin cuentas ni contraseñas de sistema | No hay inicio de sesión ni sesiones que mantener. |
| Archivos | Árbol JSON del perfil + blobs en disco | Sencillo, rápido y fácil de copiar o hacer copia de seguridad. |
| Apps | HTML/JS sin compilación, API común `ctx` | Mismo código en Electron y en el navegador. |
| Oficina | LibreOffice del equipo o motor Linux local | Documentos reales sin depender de un servicio externo. |
| Llavero | AES-GCM + PBKDF2, con contraseña maestra propia | Solo el usuario puede descifrarlo. |
| Navegador | Chromium de Electron o proxy local | Navegar por internet es una acción voluntaria del usuario. |

---

## 2. Componentes

### 2.1 App de escritorio (`desktop/`)

Electron arranca el servicio local y abre la interfaz. En macOS puede usar un
motor Linux (Lima) para la oficina y las apps de Linux. En Windows y Linux usa
las aplicaciones del propio sistema cuando están disponibles.

- `main.mjs`: ventana, menús, IPC, perfil local y ciclo de vida.
- `local.mjs`: archivos del sistema, oficina del equipo y descargas.
- `linux.mjs`: motor Linux opcional.
- `preload.cjs`: puente seguro entre la interfaz y Electron.
- `office-engine.mjs`: oficina local y dirección WOPI.

El Llavero usa IPC (`nubeos:llavero-load/save`) y guarda `datos/llavero.json`
con permisos `0600`.

### 2.2 Escritorio web (`web-desktop/`)

Shell gráfico en HTML/CSS/JS: barra superior, dock, Launchpad, ventanas,
buscador, centro de control, notificaciones y ajustes.

- **Sin compilación**: se sirve tal cual.
- **Servicio local**: `server.mjs` en el puerto 4310.
- **Proxy**: `server/proxy.mjs` en el puerto 4311, separado a propósito para que
  las webs visitadas no puedan leer los datos del escritorio.
- **Modo sin servicio**: si la API no está disponible, los archivos se guardan
  en `localStorage` y la oficina muestra un aviso.

Las apps se registran con un manifiesto (`id`, nombre, icono, extensiones) y
reciben una API común (`ctx.fs`, `ctx.createWindow`, `ctx.notify`, `ctx.launch`).

### 2.3 Archivos

`web-desktop/js/fs.js` ofrece una API síncrona para las apps. En modo local
escribe en `localStorage`; con el servicio local carga el árbol del perfil y
envía los cambios en segundo plano.

- Carpetas: `/Documentos`, `/Descargas`, `/Imágenes`.
- Operaciones: listar, leer, escribir, crear, renombrar, eliminar, subir y
  descargar.
- Archivos grandes: se guardan como blobs en el disco y se sirven por
  `api/blobs/…`.
- No existen mounts, carpetas compartidas ni permisos entre usuarios.

### 2.4 Datos de las apps

Listas, Notas y Calendario usan `web-desktop/js/appdata.js` contra la API local de
`server/appdata.mjs`. La caché es local y los cambios se aplican al instante;
el servicio confirma la escritura en el disco.

- Todos los documentos pertenecen al perfil local.
- No hay invitaciones, miembros, roles ni avisos de compartición.
- El Llavero es independiente: no usa esta API.

### 2.5 Oficina

Texto, Cálculo y Presentaciones abren documentos reales mediante LibreOffice o
el motor local. En el navegador sin app de escritorio se usa el servicio WOPI
local de `server/office.mjs`. Los archivos se leen y guardan en el sistema de
archivos local.

### 2.6 Navegador

En Electron se usa un Chromium real dentro de la app. En el escritorio web se
usa el proxy local: descarga la página, elimina las cabeceras que impiden
mostrarla en un `iframe` e inyecta la navegación. Las descargas se guardan en
`/Descargas` del sistema local.

El proxy no conserva cookies de sesión de terceros. Las webs con mucho
JavaScript pueden no funcionar; en ese caso se abre la dirección en el
navegador del sistema.

### 2.7 Imagen instalable (`os/`)

Imagen Debian mínima con labwc que abre WonderfulOS como sistema completo. Usa
el mismo escritorio y el mismo servicio local; no hay cliente ligero ni
sincronización con una nube.

### 2.8 Motor de conocimiento simbólico (`Lógica`)

El modo **Lógica** de Agentic es independiente de Ollama y de cualquier modelo
neuronal. Vive en `web-desktop/server/conocimiento.mjs` y se apoya en datos
locales:

```
data/conocimiento/
  seed-lexico.json          conceptos y relaciones curados
  reglas.json               reglas de inferencia
  documentos-ejemplo.json   textos para recuperación
  mcr-es.json               diccionario MCR/WordNet generado
```

Flujo de una consulta:

1. **Detección de intención**: definición, comprobación `es_un`, camino entre
   conceptos, búsqueda local, correo, plan o texto expositivo.
2. **Resolución de conceptos**: índice por lema y sinónimo; prioriza la semilla
   y los conceptos enseñados por el usuario sobre MCR.
3. **Hechos y reglas**: se construyen hechos `es_un`, `parte_de`,
   `asociado_con`, etc., y se aplican reglas de transitividad, simetría y
   herencia. Las deducciones guardan premisas y nombre de regla.
4. **Recuperación**: índice BM25 sobre definiciones y documentos. La consulta se
   expande con sinónimos. No se consulta internet.
5. **Generación**: plantillas deterministas para correos, planes y textos. Los
   huecos se marcan con placeholders y cada respuesta incluye conceptos,
   fuentes y avisos.
6. **Verificación**: la comprobación `es_un` y el detector de contradicciones
   solo afirman lo que está en la base o se deduce de ella.

La API está en `server/api.mjs`:

| Ruta | Uso |
|---|---|
| `GET /api/conocimiento/status` | Estadísticas del motor. |
| `POST /api/conocimiento/consultar` | `{ "texto": "¿Qué es el verde?" }`. |
| `POST /api/conocimiento/ensenar` | Concepto, relación, texto o regla. |
| `GET /api/conocimiento/buscar?q=...` | Búsqueda BM25 directa. |
| `GET /api/conocimiento/concepto?lema=...` | Definición directa. |

En la interfaz, el botón **+ Enseñar concepto** del modo Lógica usa
`POST /api/conocimiento/ensenar` para guardar un concepto con su definición,
género y relaciones. Los datos enseñados se guardan en
`NUBEOS_DATA/conocimiento/` y se recargan en cada alta. El diccionario
`mcr-es.json` se regenera con
`web-desktop/scripts/importar-mcr.mjs`; su origen y licencia se documentan en
`web-desktop/data/conocimiento/README.md`.

---

## 3. Seguridad y privacidad

- El servicio escucha solo en loopback (`127.0.0.1`).
- La API exige la cabecera `x-nubeos` y comprueba el origen.
- No hay cuentas, contraseñas de sistema, sesiones ni cierre de sesión.
- Los blobs y los datos de las apps viven en `~/.nubeos` o en el directorio
  indicado por `NUBEOS_DATA`.
- El Llavero cifra con AES-GCM y deriva la clave con PBKDF2. No hay recuperación
  si se pierde la contraseña maestra.
- No hay telemetría, P2P, servidor de equipo ni funciones sociales.
- El motor simbólico no abre conexiones de red: solo lee los datos locales y los
  textos que el usuario haya enseñado. La importación de MCR es un paso manual
  y reproducible.

---

## 4. Copias de seguridad

Basta con copiar el directorio de datos (`~/.nubeos` por defecto). Incluye el
perfil, los archivos, los documentos de las apps y el Llavero cifrado. Para
restaurar, se copia de nuevo antes de arrancar WonderfulOS.
