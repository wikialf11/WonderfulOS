# Imagen Linux instalable de NubeOS (esbozo)

> Estado: **esbozo sin probar**. La configuración describe la imagen, pero aún no
> se ha construido ni arrancado en una máquina real.

## Qué es

Una imagen de disco Debian mínima que arranca directamente en el escritorio de
NubeOS. El PC actúa como **cliente ligero**: el escritorio y las apps corren en
la máquina en la nube del usuario y el PC solo muestra la interfaz.

```
UEFI → systemd-boot → kernel Debian → systemd
     → nubeos-kiosk.service (usuario "nubeos", tty1)
     → cage (compositor Wayland de una sola app)
     → Chromium --kiosk --app=$NUBEOS_URL
```

| Pieza | Archivo | Función |
|---|---|---|
| Definición de la imagen | `mkosi.conf` | Distribución, paquetes, formato de disco y arranque UEFI. |
| Script final | `mkosi.postinst` | Crea el usuario `nubeos` y activa los servicios. |
| Servicio de sesión | `mkosi.extra/etc/systemd/system/nubeos-kiosk.service` | Lanza la sesión gráfica en tty1 y la reinicia si se cierra. |
| Sesión | `mkosi.extra/usr/local/bin/nubeos-session` | `cage` + Chromium en modo kiosko apuntando al escritorio. |
| Configuración | `mkosi.extra/etc/nubeos/nubeos.conf` | URL del escritorio (nube o local). |

## Construir

```bash
./build.sh
```

En Linux usa `mkosi` directamente; en macOS lo ejecuta dentro de un contenedor
Debian (requiere Docker). El resultado queda en `out/nubeos.raw`.

Probar en una máquina virtual:

```bash
mkosi qemu
```

Grabar en un USB (sustituye `/dev/sdX` por tu USB, **se borrará**):

```bash
sudo dd if=out/nubeos.raw of=/dev/sdX bs=4M status=progress conv=fsync
```

## Pendiente

1. **Primer arranque**: asistente de Wi-Fi e inicio de sesión antes de abrir
   el escritorio (hoy se asume red por cable y login en la web).
2. **Actualizaciones atómicas A/B** con `systemd-sysupdate` y particiones
   verity, para que una actualización fallida no deje el PC sin arrancar.
3. **Secure Boot**: firmar `systemd-boot` y el kernel (UKI) con clave propia.
4. **Instalador**: hoy la imagen se graba tal cual; falta un instalador que la
   copie al disco interno y cifre `/home` con LUKS + TPM.
5. **Modo local / offline** (fase 3): incluir `nubeos-agent` y servir el
   escritorio desde `127.0.0.1`, sincronizando con la nube al recuperar
   conexión.
6. **Imagen de la VM en la nube**: misma base Debian, sin `cage`/Chromium y con
   `nubeos-agent` + Podman, en formato para Firecracker/Cloud Hypervisor.
