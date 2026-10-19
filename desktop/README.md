# WonderfulOS en tu ordenador (Mac, Windows y Linux)

App de escritorio que ocupa toda la pantalla y se usa como el sistema: el escritorio de
WonderfulOS con la potencia real del equipo. Dentro corre el servidor de WonderfulOS en modo local
(`NUBEOS_LOCAL=1`): los archivos se guardan en este disco y el espacio es el del disco.

- Navegador: Chromium de la propia app, con pestañas; descargas a Archivos › Descargas.
- Oficina: LibreOffice del equipo con un perfil propio de WonderfulOS (modo oscuro, iconos,
  cinta de pestañas); cada vez que guardas, el documento se guarda en WonderfulOS.
- Tienda: Homebrew (Mac), winget (Windows) o Flathub (Linux).
- Ajustes › Este ordenador: abrir WonderfulOS al encender el equipo, pantalla completa, salir.

Probar: `npm start` (con `NUBEOS_WINDOWED=1` se abre en ventana).
Instaladores: `npx electron-builder --mac dmg`, `--win nsis`, `--linux AppImage` → `dist/`.
