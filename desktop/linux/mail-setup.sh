#!/bin/bash
# Correo de WonderfulOS: Roundcube (open source) con el aspecto de WonderfulOS, en el propio
# ordenador. Uso (como root): mail-setup.sh CARPETA   (CARPETA = desktop/linux/correo)
# Sirve igual para el motor Linux del Mac, WSL en Windows y Linux. Es idempotente.
set -eu
SRC="$1"
VER=1.7.4
DIR=/opt/roundcube DATA=/var/lib/colormail PORT=9990
export DEBIAN_FRONTEND=noninteractive
if [ ! -f "$DIR/.version-$VER" ]; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends php-cli php-sqlite3 php-intl php-mbstring php-xml php-curl php-zip php-gd \
    sqlite3 wget curl ca-certificates
  tmp=$(mktemp -d)
  wget -qO "$tmp/rc.tgz" "https://github.com/roundcube/roundcubemail/releases/download/$VER/roundcubemail-$VER-complete.tar.gz"
  rm -rf "$DIR" && mkdir -p "$DIR"
  tar -xzf "$tmp/rc.tgz" -C "$DIR" --strip-components=1
  rm -rf "$tmp"
  touch "$DIR/.version-$VER"
fi
id colormail >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin colormail
mkdir -p "$DATA/temp" "$DATA/logs"
# Configuración: el usuario entra con su correo y su contraseña; el plugin colormail
# elige el servidor de cada proveedor (Gmail, Outlook, iCloud, Yahoo…).
[ -f "$DATA/des_key" ] || head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24 > "$DATA/des_key"
cat > "$DIR/config/config.inc.php" <<PHP
<?php
\$config = [];
\$config['db_dsnw'] = 'sqlite:///$DATA/roundcube.db?mode=0640';
\$config['imap_host'] = 'ssl://imap.%s:993';
\$config['smtp_host'] = 'ssl://smtp.%s:465';
\$config['smtp_user'] = '%u';
\$config['smtp_pass'] = '%p';
\$config['support_url'] = '';
\$config['product_name'] = 'Correo';
\$config['des_key'] = '$(cat "$DATA/des_key")';
\$config['plugins'] = ['archive', 'zipdownload', 'markasjunk', 'newmail_notifier', 'colormail'];
\$config['skin'] = 'elastic';
\$config['language'] = 'es_ES';
\$config['temp_dir'] = '$DATA/temp/';
\$config['log_dir'] = '$DATA/logs/';
\$config['x_frame_options'] = false;
\$config['session_lifetime'] = 60 * 24 * 30;
\$config['login_autocomplete'] = 2;
\$config['ip_check'] = false;
\$config['use_https'] = false;
\$config['enable_installer'] = false;
\$config['draft_autosave'] = 60;
\$config['mime_param_folding'] = 0;
\$config['timezone'] = 'auto';
PHP
rm -rf "$DIR/plugins/colormail" && cp -r "$SRC/plugin/colormail" "$DIR/plugins/colormail"
# Panel de lectura vacío sin el logo de Roundcube.
printf '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:transparent"></body></html>' > "$DIR/skins/elastic/watermark.html"
[ -f "$DATA/roundcube.db" ] || sqlite3 "$DATA/roundcube.db" < "$DIR/SQL/sqlite.initial.sql"
chown -R colormail:colormail "$DATA"
chown -R root:root "$DIR" && chown -R colormail "$DIR/temp" "$DIR/logs" 2>/dev/null || true
[ -n "${COLORMAIL_NO_START:-}" ] && exit 0
CMD="/usr/bin/php -S 127.0.0.1:$PORT -t $DIR/public_html"
if [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/colormail.service <<UNIT
[Unit]
Description=Correo de WonderfulOS (Roundcube)
After=network-online.target
[Service]
User=colormail
WorkingDirectory=$DIR
ExecStart=$CMD
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable colormail >/dev/null 2>&1
  systemctl restart colormail
else
  pkill -f "php -S 127.0.0.1:$PORT" || true
  runuser -u colormail -- $CMD >"$DATA/logs/php.log" 2>&1 &
fi
for i in $(seq 1 30); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)" = 200 ] && exit 0
  sleep 1
done
echo "El correo no arrancó" >&2; exit 1
