#!/bin/sh
# Arranca la ISO de WonderfulOS en una máquina virtual QEMU (x86_64) para probarla.
#   tools/vm.sh start        → arranca (pantalla por VNC en 127.0.0.1:5901)
#   tools/vm.sh shot out.png → captura de pantalla
#   tools/vm.sh key ret      → envía una tecla
#   tools/vm.sh stop         → apaga
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOCK="$DIR/out/qemu-monitor.sock"
ISO="$(ls "$DIR"/out/*.iso | head -1)"
mon() { printf '%s\n' "$1" | nc -U "$SOCK" >/dev/null; }
case "${1:-}" in
  start)
    qemu-system-x86_64 -machine q35 -accel tcg,thread=multi -cpu max -smp 4 -m 6G \
      -cdrom "$ISO" -boot d -vga virtio -device qemu-xhci -device usb-tablet -display none -vnc 127.0.0.1:1 \
      -monitor "unix:$SOCK,server,nowait" -device virtio-net-pci,netdev=n -netdev user,id=n \
      -daemonize ;;
  shot)
    PPM="${TMPDIR:-/tmp}/nubeos-shot.ppm"  # sin espacios: el monitor de QEMU no los admite
    mon "screendump $PPM"; sleep 1
    python3 "$DIR/tools/ppm2png.py" "$PPM" "${2:-$DIR/out/shot.png}" ;;
  key) mon "sendkey $2" ;;
  stop) mon "quit" ;;
  *) echo "uso: $0 start|shot [archivo]|key TECLA|stop"; exit 1 ;;
esac
