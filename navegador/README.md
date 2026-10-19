# Navegador de NubeOS

Cada usuario tiene su propio Chromium (imagen de [neko](https://github.com/m1k1o/neko),
código abierto) que corre en el servidor y se ve en la ventana del Navegador por WebRTC.
`web-desktop/server/browser.mjs` lo arranca al abrir el Navegador, guarda su perfil
(sesiones, historial) en `~/.nubeos/navegador/<usuario>/profile`, pasa las descargas a
Archivos › Descargas y lo apaga tras 15 minutos sin uso.

Construir la imagen (Chromium en español):

    docker build -t nubeos-navegador web-desktop/agent/navegador/

Activar en el servidor (necesita Docker):

| Variable | Valor |
|---|---|
| `NUBEOS_BROWSER` | `docker` |
| `NUBEOS_BROWSER_PUBLIC_HOST` | dominio o IP pública con la que los usuarios llegan a los puertos |
| `NUBEOS_BROWSER_NAT_IP` | IP pública del servidor (para WebRTC) |
| `NUBEOS_BROWSER_BASE_PORT` | primer puerto (5200); cada navegador usa 2 (HTTP y WebRTC TCP/UDP) |
| `NUBEOS_MAX_BROWSERS` | cuántos a la vez (4); cada uno usa ~1–1,5 GB de RAM |

Sin `NUBEOS_BROWSER`, NubeOS usa el navegador ligero por proxy (`navegador-ligero.js`).

## Llavero dentro del navegador

Chromium carga la extensión `web-desktop/agent/navegador/extension` (con una ficha propia por
usuario). La extensión cuenta a NubeOS en qué web estás, rellena usuario y contraseña cuando
pulsas la llave de la ventana del Navegador, y avisa cuando inicias sesión en una web para
que NubeOS te ofrezca guardarla. Las contraseñas se descifran solo en tu NubeOS (con tu
contraseña maestra) y viajan al navegador únicamente cuando pides rellenarlas.
Variable opcional: `NUBEOS_BROWSER_SERVER_URL` (dirección con la que el contenedor llega a NubeOS).
