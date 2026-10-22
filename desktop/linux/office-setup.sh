#!/bin/bash
# Oficina de WonderfulOS dentro del motor Linux: la misma que la versión online (Collabora
# Online, LibreOffice en el navegador) con el aspecto de WonderfulOS. Uso: office-setup.sh CSS
# Se ejecuta como root; es idempotente (solo instala la primera vez). Sirve para el motor
# Linux del Mac, para WSL en Windows (sin systemd) y para Linux (Debian/Ubuntu).
set -eu
CSS="$1"
HASH=$(sha1sum "$CSS" | cut -c1-10)
DIST=/usr/share/coolwsd/browser/dist
export DEBIAN_FRONTEND=noninteractive
if ! command -v coolwsd >/dev/null; then
  command -v wget >/dev/null && command -v curl >/dev/null || { apt-get update -qq; apt-get install -y -qq wget curl ca-certificates; }
  wget -qO /usr/share/keyrings/collaboraonline-release-keyring.gpg https://collaboraoffice.com/downloads/gpg/collaboraonline-release-keyring.gpg
  printf 'Types: deb\nURIs: https://www.collaboraoffice.com/repos/CollaboraOnline/CODE-deb\nSuites: ./\nSigned-By: /usr/share/keyrings/collaboraonline-release-keyring.gpg\n' > /etc/apt/sources.list.d/collaboraonline.sources
  apt-get update -qq
  apt-get install -y -qq coolwsd code-brand
  apt-get install -y -qq collaboraofficebasis-es 2>/dev/null || true
fi
if [ ! -f /etc/coolwsd/nubeos-configurado ]; then
  C="coolconfig set"
  $C ssl.enable false; $C ssl.termination false; $C welcome.enable false
  $C user_interface.mode notebookbar; $C admin_console.enable false
  $C net.post_allow.host[0] '.*'; $C storage.wopi.alias_groups[@mode] first
  touch /etc/coolwsd/nubeos-configurado
fi
# Aspecto de WonderfulOS: la hoja con su huella, enlazada desde cool.html.
if [ ! -f "$DIST/nubeos-$HASH.css" ]; then
  rm -f "$DIST"/nubeos-*.css
  cp "$CSS" "$DIST/nubeos-$HASH.css"
  sed -i '/nubeos-.*\.css/d' "$DIST/cool.html"
  sed -i "s|<!--%BRANDING_CSS%-->|<!--%BRANDING_CSS%-->\n<link rel=\"stylesheet\" href=\"%SERVICE_ROOT%/browser/%VERSION%/nubeos-$HASH.css\" />|" "$DIST/cool.html"
  RESTART=1
fi
# NUBEOS_NO_START=1: solo instalar y configurar (la ISO al construirse; Windows lo arranca aparte).
[ -n "${NUBEOS_NO_START:-}" ] && exit 0
# Con systemd (Mac, Linux) como servicio; sin él (WSL) se arranca directamente.
if [ -d /run/systemd/system ]; then
  [ -n "${RESTART:-}" ] && systemctl restart coolwsd
  systemctl disable coolwsd >/dev/null 2>&1 || true
  systemctl start coolwsd >/dev/null 2>&1
else
  [ -n "${RESTART:-}" ] && pkill -x coolwsd && sleep 2
  if ! pgrep -x coolwsd >/dev/null; then
    runuser -u cool -- /usr/bin/coolwsd --o:sys_template_path=/opt/cool/systemplate --o:child_root_path=/opt/cool/child-roots \
      --o:file_server_root_path=/usr/share/coolwsd --o:cache_files.path=/opt/cool/cache >/tmp/coolwsd.log 2>&1 &
  fi
fi
for i in $(seq 1 60); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:9980/hosting/discovery)" = 200 ] && exit 0
  sleep 2
done
echo "La oficina no arrancó" >&2; exit 1
