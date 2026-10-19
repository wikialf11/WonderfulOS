# Compartir archivos y trabajar juntos, sin servidores (P2P)

Decisión del 17/10/2026: WonderfulOS no usa servidores centrales para compartir.

## Modelo

- **Cada equipo guarda lo suyo.** Lo que compartes sigue solo en tu PC.
- **Disponible mientras está encendido.** Un archivo compartido se puede ver
  y abrir cuando el equipo que lo tiene está encendido y conectado.
- **Guardar una copia.** Si ambos equipos están encendidos, quien recibe el
  archivo puede pulsar «Guardar en mi equipo» y tenerlo aunque el otro se apague.
- **Edición a la vez.** Si varias personas tienen el documento abierto y sus
  equipos encendidos, los cambios viajan directamente entre ellos y se fusionan
  sin conflictos.

## Piezas técnicas

| Necesidad | Solución |
|---|---|
| Identidad del equipo | Par de claves por equipo; se comparte con un ID o un enlace/QR. |
| Conexión directa | Syncthing (protocolo BEP, cifrado TLS), con descubrimiento y repetidores públicos de la comunidad para atravesar routers. Los repetidores no pueden leer nada. |
| Ver un archivo de otro equipo | Carpeta compartida en modo «solo bajo demanda»: se lista lo que hay y se descarga al abrirlo. |
| Guardar una copia | Copia del archivo a una carpeta local del receptor. |
| Edición en tiempo real | CRDT (Yjs) sobre WebRTC entre los equipos que tienen el documento abierto. |

## En el escritorio

- Archivos → clic derecho → **Compartir con…** (ID del otro equipo o enlace).
- Sección **Compartido conmigo**: cada persona con su estado (🟢 conectado /
  ⚪ apagado). Lo de los apagados se ve atenuado y no se puede abrir.
- En un archivo compartido: **Guardar en mi equipo**.
