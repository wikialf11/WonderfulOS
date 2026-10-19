#!/bin/sh
# Construye la imagen nubeos-office: Collabora + nubeos.css.
# La hoja va en un archivo con su huella (nubeos-<hash>.css) que cool.html enlaza:
# así, cada cambio de aspecto llega a los navegadores aunque tengan la anterior en caché.
set -e
cd "$(dirname "$0")"
SRC=../web-desktop/agent/office  # fuente única: la usan también los ordenadores de los usuarios
rm -f dist-nubeos-*.css
HASH=$(shasum $SRC/nubeos.css | cut -c1-10)
cp $SRC/nubeos.css "dist-nubeos-$HASH.css"
python3 - "$HASH" "$SRC" <<'PY'
import sys
h, src = sys.argv[1], sys.argv[2]
html = open(f'{src}/cool.original.html').read()
mark = '<!--%BRANDING_CSS%-->'
assert mark in html, 'cool.html cambió: revisa el marcador de branding'
html = html.replace(mark, mark + f'\n<link rel="stylesheet" href="%SERVICE_ROOT%/browser/%VERSION%/nubeos-{h}.css" />', 1)
open('cool.html', 'w').write(html)
open('Dockerfile', 'w').write(f'''# LibreOffice en el navegador (Collabora Online) con el aspecto de WonderfulOS.
# Generado por build.sh: la imagen no tiene shell, así que todo se prepara fuera.
FROM collabora/code@sha256:bb8f3c9c5c9016045f25fccb5f0649be94469ebc7c7cc379f3576e470cccf33d
COPY cool.html /usr/share/coolwsd/browser/dist/cool.html
COPY dist-nubeos-{h}.css /usr/share/coolwsd/browser/dist/nubeos-{h}.css
''')
PY
docker build -q -t nubeos-office .
