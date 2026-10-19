#!/bin/bash
# Instalación del ordenador (VPS) de un usuario de WonderfulOS sobre Ubuntu 24.04.
# El script post-instalación de Hostinger lo descarga y lo ejecuta como root.
# Salida en /var/log/nubeos-install.log.
#
# El nombre de la máquina lleva un código de un solo uso con el que se registra en
# el servidor central de WonderfulOS y recibe su secreto.
set -ux
exec >>/var/log/nubeos-install.log 2>&1

NUBEOS="${NUBEOS_ORIGIN:-https://nubeos.criaturasdelcolor.com}"
CODE="$(hostname | sed -n 's/^nubeos-//p')"
export DEBIAN_FRONTEND=noninteractive
DIR=/opt/nubeos
mkdir -p $DIR/navegador/Downloads $DIR/office $DIR/navegador-ext

apt-get update
apt-get install -y curl wget ca-certificates gnupg python3 ufw sudo debian-keyring debian-archive-keyring apt-transport-https

# Docker (LibreOffice y el Navegador corren en contenedores)
curl -fsSL https://get.docker.com | sh

# Node.js 22 (agente)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy (HTTPS automático)
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Xpra con cliente HTML5 + Flatpak/Flathub: apps de Linux que el usuario instale
wget -qO /usr/share/keyrings/xpra.asc https://xpra.org/xpra.asc
. /etc/os-release
wget -qO /etc/apt/sources.list.d/xpra.sources "https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/${VERSION_CODENAME}/xpra.sources"
apt-get update
apt-get install -y xpra xpra-html5 || apt-get install -y xpra
apt-get install -y flatpak dbus-x11 xdg-desktop-portal xdg-desktop-portal-gtk fonts-noto-color-emoji
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
useradd --create-home --shell /bin/bash nubeos || true

# Agente, tema de LibreOffice y extensión del Navegador (desde el servidor central)
curl -fsSL "$NUBEOS/agent/agent.mjs" -o $DIR/agent.mjs
for f in nubeos.css cool.original.html; do curl -fsSL "$NUBEOS/agent/office/$f" -o "$DIR/office/$f"; done
curl -fsSL "$NUBEOS/agent/navegador/Dockerfile" -o $DIR/navegador/Dockerfile
for f in manifest.json background.js content.js; do curl -fsSL "$NUBEOS/agent/navegador/extension/$f" -o "$DIR/navegador-ext/$f"; done

# Registro: devuelve el secreto de este ordenador y su dirección pública.
IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
curl -fsS -X POST "$NUBEOS/api/agent/register" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"ip\":\"$IP\"}" -o $DIR/config.json
chmod 600 $DIR/config.json
HOST="$(echo "$IP" | tr . -).sslip.io"

# LibreOffice con el aspecto de WonderfulOS (misma receta que office/build.sh)
cd $DIR/office
HASH=$(sha1sum nubeos.css | cut -c1-10)
cp nubeos.css "nubeos-$HASH.css"
python3 - "$HASH" <<'PY'
import sys
h = sys.argv[1]
html = open('cool.original.html').read()
mark = '<!--%BRANDING_CSS%-->'
html = html.replace(mark, mark + f'\n<link rel="stylesheet" href="%SERVICE_ROOT%/browser/%VERSION%/nubeos-{h}.css" />', 1)
open('cool.html', 'w').write(html)
open('Dockerfile', 'w').write(f'''FROM collabora/code@sha256:bb8f3c9c5c9016045f25fccb5f0649be94469ebc7c7cc379f3576e470cccf33d
COPY cool.html /usr/share/coolwsd/browser/dist/cool.html
COPY nubeos-{h}.css /usr/share/coolwsd/browser/dist/nubeos-{h}.css
''')
PY
docker build -t nubeos-office .
docker run -d --restart unless-stopped --name nubeos-office -p 127.0.0.1:9980:9980 \
  -e "aliasgroup1=$NUBEOS" \
  -e "server_name=$HOST" \
  -e "extra_params=--o:ssl.enable=false --o:ssl.termination=true --o:welcome.enable=false --o:user_interface.mode=notebookbar" \
  nubeos-office

# Navegador (Chromium de neko, en español)
docker build -t nubeos-navegador $DIR/navegador

cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  @office path /browser/* /cool/* /hosting/*
  reverse_proxy @office 127.0.0.1:9980
  reverse_proxy 127.0.0.1:7000
}
$HOST:8443 {
  reverse_proxy 127.0.0.1:8080
}
CADDY
systemctl restart caddy

cat > /etc/systemd/system/nubeos-xpra.service <<'UNIT'
[Unit]
Description=Apps de Linux de WonderfulOS (Xpra HTML5)
After=network-online.target

[Service]
User=nubeos
ExecStart=/usr/bin/xpra start :100 --daemon=no --bind-tcp=127.0.0.1:14500 --html=on --mdns=no --notifications=no --pulseaudio=no --exit-with-children=no
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/nubeos-agent.service <<'UNIT'
[Unit]
Description=Agente de WonderfulOS
After=network-online.target docker.service nubeos-xpra.service

[Service]
ExecStart=/usr/bin/node /opt/nubeos/agent.mjs
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now nubeos-xpra nubeos-agent

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8443/tcp
ufw allow 52000/tcp
ufw allow 52000/udp
ufw --force enable

curl -fsS -X POST "$NUBEOS/api/agent/ready" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" || true
echo "Ordenador de WonderfulOS listo en https://$HOST"
