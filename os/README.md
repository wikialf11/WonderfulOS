# WonderfulOS para PC (sistema operativo instalable)

Una ISO de Debian 13 en la que el escritorio **es WonderfulOS**: la misma app que en Mac y
Windows (`desktop/`), a pantalla completa sobre labwc (un gestor de ventanas pequeño
de Wayland). Las apps de Linux (paquetes del sistema, `.AppImage` y `.deb`) se abren
como ventanas encima de WonderfulOS.

- **Probar sin instalar:** se arranca desde un USB y entra directamente en WonderfulOS.
- **Instalar:** menú del sistema › «Instalar WonderfulOS en este ordenador» (Calamares).
  Permite *instalar junto a* Windows u otro sistema; al encender aparece un menú
  (GRUB, con os-prober) para elegir WonderfulOS o Windows.
- Oficina: LibreOffice del sistema con el aspecto de WonderfulOS. Navegador: el Chromium de
  la app. Archivos en el disco del PC, sin cuentas ni almacenamiento externo.

Los Mac con Apple Silicon no pueden arrancar otro sistema así (en los M4 todavía no
existe Linux); allí WonderfulOS es una app con un motor Linux (`desktop/linux.mjs`).

## Construir la ISO

```bash
cd desktop && npx electron-builder --linux --x64 -c.directories.output=release
cd ../os/iso && ./build.sh        # → os/iso/out/nubeos-amd64.hybrid.iso
```

`build.sh` copia `desktop/release/linux-unpacked` a `/opt/nubeos` de la imagen y
construye con live-build dentro de Docker (amd64). Grabar en un USB con balenaEtcher.

## Piezas

- `iso/config/package-lists/nubeos.list.chroot`: paquetes (labwc, LibreOffice,
  flatpak, Calamares, os-prober, firmware…).
- `iso/config/includes.chroot/usr/local/bin/nubeos-session` y `etc/nubeos/labwc/`:
  la sesión, con WonderfulOS siempre debajo y sin bordes.
- `iso/config/includes.chroot/etc/default/grub.d/nubeos.cfg`: menú de arranque con
  los demás sistemas.
- `iso/config/hooks/live/0100-nubeos.hook.chroot`: nombres, sesión por defecto e
  instalador con la marca WonderfulOS.
