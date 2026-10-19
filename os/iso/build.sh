#!/bin/sh
# Construye la ISO de WonderfulOS para PC dentro de un contenedor Debian (amd64):
# el escritorio es la app de WonderfulOS y el instalador permite conservar Windows.
# En un Mac con Apple Silicon usa Colima con Rosetta:
#   colima start --vm-type vz --vz-rosetta --cpu 8 --memory 12 --disk 60
# Resultado: os/iso/out/nubeos-amd64.hybrid.iso
set -eu
cd "$(dirname "$0")"
# Con Colima: el arranque del sistema base (debootstrap) solo va con QEMU, pero Python
# se cuelga a menudo con QEMU; así que debootstrap con QEMU y el resto con Rosetta.
binfmt() { # rosetta|qemu
  command -v colima >/dev/null 2>&1 || return 0
  if [ "$1" = rosetta ]; then r=1 q=0; else r=0 q=1; fi
  colima ssh -- sh -c "B=/proc/sys/fs/binfmt_misc; echo $r | sudo tee \$B/rosetta >/dev/null; echo $q | sudo tee \$B/qemu-x86_64 >/dev/null; true"
}
mkdir -p out cache
# La app de WonderfulOS para Linux (x64): npx electron-builder --linux --x64 en desktop/
APP=../../desktop/release/linux-unpacked
[ -x "$APP/nubeos" ] || { echo "Falta $APP: construye antes la app (cd desktop && npx electron-builder --linux --x64 -c.directories.output=release)"; exit 1; }
rm -rf config/includes.chroot/opt/nubeos && mkdir -p config/includes.chroot/opt && cp -a "$APP" config/includes.chroot/opt/nubeos
# Oficina (Collabora) con el aspecto de WonderfulOS: script de instalación y hoja de estilo.
mkdir -p config/includes.chroot/usr/share/nubeos
cp ../../desktop/linux/office-setup.sh config/includes.chroot/usr/share/nubeos/
cp ../../web-desktop/agent/office/nubeos.css config/includes.chroot/usr/share/nubeos/nubeos-office.css
binfmt qemu
C=nubeos-iso-build
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C --privileged --platform linux/amd64 \
  -v "$PWD":/src:ro -v "$PWD/out":/out -v "$PWD/cache":/cache debian:trixie sleep infinity >/dev/null
trap 'docker rm -f $C >/dev/null 2>&1; binfmt qemu' EXIT
step() { docker exec $C bash -c "set -eux; cd /build 2>/dev/null || true; $1"; }
step '
  apt-get update -qq
  apt-get install -y -qq live-build debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin mtools dosfstools >/dev/null
  rm -rf /build && cp -a /src /build && cd /build
  rm -rf out cache && ln -s /cache cache
  lb clean --purge >/dev/null 2>&1 || true
  lb config
  lb bootstrap 2>&1 | tee /out/build.log'
binfmt rosetta
step 'lb chroot 2>&1 | tee -a /out/build.log; lb binary 2>&1 | tee -a /out/build.log; cp -v ./*.iso /out/'
ls -lh out/*.iso
