#!/bin/sh
# Arranca WonderfulOS con LibreOffice en este ordenador: abre http://localhost:4500
# Tus archivos de prueba se guardan en ~/.nubeos-local.
cd "$(dirname "$0")/.."
# Si Docker no responde (a veces la máquina virtual de Colima se queda colgada), se reinicia.
docker info >/dev/null 2>&1 || { colima stop -f >/dev/null 2>&1; colima start; }
docker image inspect nubeos-office >/dev/null 2>&1 || ./office/build.sh
docker image inspect nubeos-navegador >/dev/null 2>&1 || docker build -t nubeos-navegador web-desktop/agent/navegador/
docker start nubeos-office >/dev/null 2>&1 || ./office/run-local.sh >/dev/null
echo "Esperando a LibreOffice…"
until curl -s -o /dev/null http://localhost:9980/hosting/discovery; do sleep 2; done
echo "Listo: abre http://localhost:4500"
NUBEOS_DEV_ALL_MACHINES=1 NUBEOS_BROWSER=docker NUBEOS_DATA="$HOME/.nubeos-local" HOST=0.0.0.0 PORT=4500 COLLABORA_URL=http://localhost:9980 \
  NUBEOS_WOPI_URL=http://host.docker.internal:4500 exec node web-desktop/server.mjs
