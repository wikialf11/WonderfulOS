# WonderfulOS — Arquitectura

WonderfulOS es un sistema operativo en la nube basado en Linux. Cada usuario tiene
una máquina Linux propia que vive en un centro de datos y a la que accede de
dos formas:

1. **Desde el navegador**: abre `app.nubeos.com`, inicia sesión y ve su
   escritorio.
2. **Como SO instalado en un PC**: una imagen Linux mínima que arranca
   directamente en el escritorio de WonderfulOS (cliente ligero), con modo offline
   limitado.

Encima corre un escritorio propio con apps nativas (editor de texto, hoja de
cálculo, presentaciones), una tienda de apps de terceros compatibles y una
suscripción mensual cuyo nivel decide la potencia de la máquina en la nube.

---

## 1. Visión de conjunto

```
┌──────────────────────── Cliente ────────────────────────┐
│  Navegador web            │  PC con imagen WonderfulOS        │
│  (escritorio web)         │  (kiosko Linux + escritorio) │
└──────────────┬────────────┴───────────────┬─────────────┘
               │ HTTPS / WebSocket / WebRTC │
┌──────────────▼────────────────────────────▼─────────────┐
│                  Plano de control (API)                  │
│  Auth · Cuentas · Facturación · Tienda · Orquestador     │
└──────────────┬──────────────────────────────────────────┘
               │ crea / arranca / para / redimensiona
┌──────────────▼──────────────────────────────────────────┐
│                 Plano de datos (cómputo)                 │
│  Nodos KVM/Firecracker → una microVM Linux por usuario   │
│  ├─ nubeos-agent (API local del escritorio)              │
│  ├─ apps nativas (servidor) + contenedores de terceros   │
│  └─ volumen persistente del usuario (/home)              │
└─────────────────────────────────────────────────────────┘
```

### Decisiones clave

| Tema | Decisión | Motivo |
|---|---|---|
| Aislamiento por usuario | **microVM** (Firecracker o Cloud Hypervisor) | Aislamiento de kernel real con arranque en < 1 s; más seguro que contenedores compartidos. |
| SO invitado | Debian estable mínima | Paquetes estables, ecosistema amplio, fácil de construir con `mmdebstrap`. |
| Escritorio | **Web nativo** (HTML/JS) servido por la VM | Funciona igual en navegador y en el PC instalado; no requiere streaming de píxeles para las apps propias. |
| Apps de terceros Linux (GUI clásica) | Contenedor + **streaming** (Xpra/Wayland → WebRTC) en una ventana del escritorio | Compatibilidad con apps existentes sin reescribirlas. |
| Apps de terceros web | Paquetes `.nubeapp` (manifiesto + bundle web + backend opcional en contenedor) | Integración perfecta, ligera y segura. |
| Almacenamiento | Volumen de bloque por usuario + snapshots en almacenamiento de objetos (S3) | Persistencia, copias de seguridad y migración entre nodos. |
| Facturación | Stripe Billing con suscripciones por niveles | Estándar, gestiona impuestos y prorrateos. |

---

## 2. Componentes

### 2.1 Escritorio (`web-desktop/`)
Shell gráfico en el navegador: barra de tareas, menú de inicio, gestor de
ventanas (mover, redimensionar, minimizar, maximizar, foco), notificaciones y
sistema de archivos virtual.

- **MVP actual**: JavaScript sin dependencias ni paso de compilación, sistema
  de archivos guardado en `localStorage`.
- **Siguiente paso**: el sistema de archivos pasa a ser una API del
  `nubeos-agent` en la VM (`/api/fs`), con caché local (IndexedDB) para el modo
  offline.
- Las apps se registran con un manifiesto (`id`, nombre, icono, tipos de
  archivo que abren) y reciben una API común (`ctx.fs`, `ctx.window`,
  `ctx.notify`). Las apps de terceros usan exactamente la misma API, dentro de
  un `iframe` aislado con `postMessage`.

### 2.1.0 Cuentas, archivos y compartir (implementado)
El servidor guarda por usuario su árbol de archivos (JSON por usuario, con los
archivos grandes aparte en el disco) y una lista de compartidos
`{propietario, destinatario, ruta | app, permiso}`. El escritorio carga el árbol
al iniciar sesión, aplica los cambios al momento y los envía en segundo plano.
Lo compartido contigo se monta en `/Compartido conmigo`; con permiso de edición
los cambios se escriben en los archivos del propietario. Sesión por cookie
`HttpOnly`; la API exige la cabecera `x-nubeos` y comprueba el `Origin`.
En producción este almacenamiento pasa al plano de control + volúmenes de cada VM.

### 2.1.1 Navegador y Tienda
El Navegador es una app nativa más y la puerta de entrada a las apps de
terceros: abre la Tienda de WonderfulOS (catálogo revisado) y permite instalar
cualquier web como app. Una app instalada se guarda en el registro del usuario
y se abre en su propia ventana dentro de un `iframe` con `sandbox`. La Tienda
habla con el escritorio por `postMessage`, aceptado solo desde su origen.

En el MVP las apps de ejemplo se sirven desde el mismo origen que el
escritorio; en producción cada app de terceros se servirá desde un origen
propio (`<app>.apps.nubeos.com`) para que el `sandbox` la aísle de verdad. Muchos
sitios prohíben mostrarse dentro de otra página (`X-Frame-Options`, CSP). Por
eso el Navegador carga las páginas a través de un **proxy de navegación** que,
en producción, corre en la máquina en la nube del usuario: descarga la página,
quita esas cabeceras e inyecta un script que mantiene los enlaces, formularios
y el historial dentro del proxy. Las búsquedas se muestran en una página de
resultados propia. El proxy se sirve desde otro origen que el escritorio y
rechaza direcciones de la red local.

Límites conocidos del proxy: no conserva sesiones (cookies), así que no sirve
para iniciar sesión en sitios, y las webs con mucho JavaScript pueden fallar.
La solución completa es un Chromium real en la VM transmitido a la ventana
(WebRTC), igual que las apps Linux GUI (fase 3).

### 2.2 Apps nativas
| App | Formato propio | Importa / exporta |
|---|---|---|
| **Texto** (editor) | `.txt`, `.md` | `.docx`, `.odt`, `.pdf` (fase 2, conversión en servidor con LibreOffice headless) |
| **Cálculo** (hoja de cálculo) | `.nsheet` (JSON) | `.csv` ya en el MVP; `.xlsx`, `.ods` en fase 2 |
| **Diapositivas** (presentaciones) | `.nslides` (JSON) | `.pptx`, `.pdf` en fase 2 |

Fase 3: edición colaborativa en tiempo real con CRDT (Yjs) sincronizado por el
agente.

### 2.3 `nubeos-agent` (en cada VM)
Servicio (Go o Rust) que corre dentro de la VM del usuario:
- sirve el escritorio web y la API local (`/api/fs`, `/api/apps`, `/api/sys`);
- instala y lanza apps de terceros (contenedores con Podman sin root);
- hace de pasarela del streaming de apps Linux GUI (Xpra → WebRTC);
- reporta métricas (CPU, RAM, disco) al plano de control.

### 2.4 Plano de control
Servicios en Kubernetes (o, al principio, un monolito modular):
- **Auth**: OIDC (correo + contraseña, Google, passkeys).
- **Cuentas y suscripciones**: usuario ↔ nivel ↔ VM.
- **Orquestador**: decide en qué nodo vive cada VM; arranca VMs al iniciar
  sesión y las suspende tras inactividad (snapshot de memoria) para abaratar.
- **Pasarela**: proxy inverso con TLS que enruta `usuario.nubeos.com` a su VM.
- **Tienda**: catálogo, revisión y firma de apps de terceros.
- **Facturación**: webhooks de Stripe → cambios de nivel → redimensionado de VM.

### 2.5 Imagen instalable (`image/`)
Ver [image/README.md](../image/README.md). Debian mínima + Wayland kiosko
(`cage`) + navegador en modo app que abre el escritorio de WonderfulOS. Dos modos:
- **Cliente ligero** (por defecto): todo corre en la nube.
- **Local** (fase 3): ejecuta el `nubeos-agent` en el propio PC y sincroniza
  con la nube; útil sin conexión.

---

## 3. Suscripción por niveles

La potencia de la VM depende del plan. Precios orientativos, a validar con
costes reales de infraestructura.

| Plan | vCPU | RAM | Disco | GPU | Horas activas/mes | Precio orientativo |
|---|---|---|---|---|---|---|
| **Gratis** | 1 compartida | 2 GB | 10 GB | — | 40 h | 0 € |
| **Básico** | 2 | 4 GB | 50 GB | — | ilimitadas* | 9 €/mes |
| **Pro** | 4 | 16 GB | 200 GB | — | ilimitadas* | 29 €/mes |
| **Ultra** | 8 | 32 GB | 500 GB | GPU fraccional | ilimitadas* | 79 €/mes |

\* Con suspensión automática tras 30 min de inactividad, que es lo que hace
viable el precio.

### 3.1 Planes por tipo de uso (precio fijo mensual)

Precio fijo al mes, sin cobros por hora. Cada plan es el coste del proveedor
más ~25 % de comisión. En los planes con GPU las horas incluidas son un límite:
al agotarlas la GPU se pausa hasta el mes siguiente (el escritorio sigue
funcionando) o el usuario sube de plan. Costes orientativos de octubre de 2026
(Hostinger VPS, RunPod, Hetzner); revisar antes de lanzar.

**Planes principales**

| Plan | Para | Máquina | Coste aprox. | Precio |
|---|---|---|---|---|
| Básico | Ofimática | Parte de un VPS compartido | ~4,5 € | 9 €/mes |
| Creativo | Diseño gráfico, foto | Parte de un KVM 4 (3–4 usuarios) | ~10 € | 19 €/mes |
| Pro GPU | 3D y ComfyUI | RTX 4090 24 GB, 40 h/mes, 200 GB | ~37 € | 49 €/mes |

**Otros planes**

| Plan | Para | Máquina | Coste aprox. | Precio |
|---|---|---|---|---|
| Gratis | Probar | 1 vCPU compartida, 10 GB | ~1 € | 0 € |
| Pro GPU+ | 3D/ComfyUI intensivo | RTX 4090, 80 h/mes, 300 GB | ~62 € | 79 €/mes |
| Estudio IA | Flux, vídeo con IA | L40S 48 GB, 60 h/mes, 500 GB | ~70 € | 89 €/mes |
| Dedicada | GPU propia 24 h | Hetzner GEX44 (RTX 4000 Ada) | ~234 € | 295 €/mes |
| A medida | Lo que elija el usuario | Coste del proveedor | — | coste + 25 % |

Cambio de plan: el orquestador redimensiona la VM en el siguiente arranque
(o en caliente si el hipervisor lo permite). Al bajar de plan, se avisa si el
disco usado supera el nuevo límite.

---

## 4. Seguridad

- Cada usuario en su propia microVM; nada de procesos de varios usuarios en el
  mismo kernel.
- Apps de terceros: permisos declarados en el manifiesto (archivos, red,
  notificaciones) y concedidos por el usuario; web en `iframe` con `sandbox`,
  nativas en contenedor sin root.
- Volúmenes cifrados en reposo; TLS en todo el tráfico.
- Imagen instalable con arranque seguro (UEFI Secure Boot) y actualizaciones
  atómicas A/B.

---

## 5. Hoja de ruta

| Fase | Contenido |
|---|---|
| **0 — MVP (este repo)** | Escritorio web con ventanas, editor de texto, hoja de cálculo, presentaciones y archivos en el navegador. Esbozo de la imagen instalable. |
| **1 — Backend** | `nubeos-agent`, una VM por usuario en un solo servidor, login, sistema de archivos real. |
| **2 — Producto** | Stripe con niveles, orquestador multi-nodo, importación/exportación de formatos Office, tienda con primeras apps web de terceros. |
| **3 — Ecosistema** | Streaming de apps Linux GUI, colaboración en tiempo real, imagen instalable con modo local/offline, GPU. |
