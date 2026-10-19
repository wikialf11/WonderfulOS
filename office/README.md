# Oficina de WonderfulOS (LibreOffice en el navegador)

Texto, Cálculo y Presentaciones son LibreOffice servido por **Collabora Online**
(código abierto, MPL). WonderfulOS hace de anfitrión WOPI (`web-desktop/server/office.mjs`):
Collabora lee y guarda los archivos del usuario a través de `/wopi/files/<id>`.

- `nubeos.css`: el aspecto de WonderfulOS (colores de cada app, esquinas, sin logos). Se
  añade al final del `branding.css` original de la versión fijada en el `Dockerfile`.
- `build.sh`: construye la imagen `nubeos-office`.
- `run-local.sh`: la arranca en este ordenador (puerto 9980) para probar con
  `HOST=0.0.0.0 PORT=4500 COLLABORA_URL=http://localhost:9980 NUBEOS_WOPI_URL=http://host.docker.internal:4500 node web-desktop/server.mjs`.

Al actualizar Collabora: cambiar el digest del `Dockerfile`, copiar su `branding.css`
nuevo a `branding.original.css` y volver a construir.

## En producción

Necesita un servidor con Docker (un VPS; el hosting compartido no sirve), con
HTTPS y estas variables en WonderfulOS:

| Variable | Valor |
|---|---|
| `COLLABORA_URL` | `https://office.<dominio>` (lo que ve el navegador) |
| `NUBEOS_PUBLIC_ORIGIN` | `https://nubeos.criaturasdelcolor.com` (origen de los mensajes) |

Y en Collabora: `aliasgroup1=https://nubeos.criaturasdelcolor.com` (solo ese
anfitrión puede pedirle documentos).

La edición CODE avisa a partir de 20 documentos o 10 conexiones a la vez; para
más uso hay que compilarla sin ese aviso o contratar el soporte de Collabora.
