#!/bin/bash
# Script post-instalación de la máquina dedicada de cada usuario (Ubuntu 24.04).
# Hostinger lo ejecuta una vez al instalar el VPS (salida en /post_install.log).
# ESBOZO SIN PROBAR: prepara la base para ejecutar apps Linux (AppImage) y
# mostrarlas dentro de NubeOS mediante Xpra (HTML5).
set -ux  # sin -e: si una pieza falla, el resto de la máquina sigue funcionando

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
# Node.js 22 para el agente de NubeOS, Xpra para mostrar apps gráficas en el navegador,
# FUSE para los AppImage y un cortafuegos básico.
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs libfuse2 ufw
apt-get install -y xpra xpra-html5 || apt-get install -y xpra

useradd --create-home --shell /bin/bash nubeos || true

# Sesión gráfica del usuario, accesible solo desde el servidor de NubeOS (a través de su proxy).
cat > /etc/systemd/system/nubeos-xpra.service <<'UNIT'
[Unit]
Description=Sesión gráfica de NubeOS (Xpra HTML5)
After=network-online.target

[Service]
User=nubeos
ExecStart=/usr/bin/xpra start :100 --daemon=no --bind-tcp=127.0.0.1:14500 --html=on --mdns=no --notifications=no
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nubeos-xpra

ufw allow OpenSSH
ufw --force enable
