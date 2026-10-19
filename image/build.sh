#!/bin/sh
# Construye la imagen. mkosi necesita Linux; en macOS se usa un contenedor Debian.
set -eu
cd "$(dirname "$0")"
if [ "$(uname)" = "Linux" ]; then
  exec sudo mkosi -f build
fi
exec docker run --rm --privileged -v "$PWD":/work -w /work debian:bookworm sh -c '
  apt-get update -qq &&
  apt-get install -y -qq mkosi systemd-boot debian-archive-keyring dosfstools mtools >/dev/null &&
  mkosi -f build'
