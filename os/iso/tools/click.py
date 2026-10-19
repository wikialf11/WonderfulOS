#!/usr/bin/env python3
"""Clic en la máquina virtual por VNC (sin contraseña): click.py X Y  (píxeles de la pantalla)."""
import socket, struct, sys, time
x, y = int(sys.argv[1]), int(sys.argv[2])
s = socket.create_connection(('127.0.0.1', 5901))
s.recv(12); s.sendall(b'RFB 003.008\n')
n = s.recv(1)[0]; s.recv(n); s.sendall(b'\x01'); s.recv(4)   # seguridad: ninguna
s.sendall(b'\x01')                                             # ClientInit (compartido)
init = s.recv(24); s.recv(struct.unpack('>I', init[20:24])[0])  # ServerInit + nombre
for mask in (0, 1, 0):
    s.sendall(struct.pack('>BBHH', 5, mask, x, y)); time.sleep(0.2)
s.close()
