#!/bin/sh
# Collabora con el aspecto de WonderfulOS en este ordenador, para probar con
# NUBEOS_WOPI_URL=http://host.docker.internal:4500 COLLABORA_URL=http://localhost:9980 node server.mjs
docker rm -f nubeos-office >/dev/null 2>&1 || true
docker run -d --restart unless-stopped --name nubeos-office -p 9980:9980 --add-host=host.docker.internal:host-gateway \
  -e "aliasgroup1=http://host.docker.internal:4500" \
  -e "extra_params=--o:ssl.enable=false --o:ssl.termination=false --o:welcome.enable=false --o:user_interface.mode=notebookbar" \
  -e username=admin -e password=nubeos-local-admin nubeos-office
