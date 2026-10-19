# Despliegue de WonderfulOS (en la nube, solo ofimática)

WonderfulOS se usa desde el navegador. Las apps (Texto, Cálculo, Presentaciones) se
ejecutan en el ordenador de cada usuario, así que el servidor solo guarda
cuentas y archivos: no hay ninguna máquina por cliente ni coste por cliente
aparte del espacio.

## Hostinger (plan Business)

Una app Node.js en `nubeos.criaturasdelcolor.com`:

1. Empaquetar `web-desktop/` sin `tests/`:
   `cd web-desktop && zip -qr ../nubeos.zip . -x "tests/*"`
2. Subir `nubeos.zip` a `public_html`.
3. Compilar con Node 22, tipo `other`, script `build`, entrada `server.mjs`.

Variables de entorno (las pone el propietario en hPanel; nunca en el repositorio):

| Variable | Para qué |
|---|---|
| `HOST` | `0.0.0.0` |
| `NUBEOS_INVITE_CODE` | Opcional: código para poder crear cuenta (pruebas cerradas) |
| `NUBEOS_MAX_UPLOAD_MB` | Tamaño máximo de un archivo subido (2048 por defecto) |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook `https://nubeos.criaturasdelcolor.com/api/stripe/webhook` (eventos `checkout.session.completed` y `customer.subscription.deleted`) |
| `NUBEOS_STRIPE_PORTAL` | Opcional: enlace del portal de clientes de Stripe, para darse de baja |

Los datos (usuarios, sesiones, árbol de archivos y archivos subidos) se guardan
en `~/.nubeos`, fuera de `public_html`, así que sobreviven a cada despliegue.

## Planes: solo espacio en la nube (server/plans.mjs)

WonderfulOS se instala en el ordenador del usuario (`desktop/`) y usa su potencia. Los planes
solo añaden espacio en la nube: Gratis 5 GB, Personal 100 GB (1,99 €), Plus 500 GB
(4,99 €) y Pro 2 TB (9,99 €). El código de «un ordenador por usuario» (provision.mjs y
agent/) queda preparado pero ningún plan lo usa.

## Espacio real del servidor

El plan Business de Hostinger tiene un disco limitado y compartido por todos los
usuarios. Sirve para empezar; cuando los planes grandes se vendan, los archivos
subidos (carpeta `~/.nubeos/disco`) deberán pasar a un almacenamiento externo
que se pague a mes vencido (por ejemplo, Hetzner Storage Box o Backblaze B2).
