"""Convierte una captura PPM (P6) de QEMU a PNG sin dependencias."""
import struct, sys, zlib

def read_token(f):
    tok = b''
    while True:
        c = f.read(1)
        if c == b'#':
            f.readline(); continue
        if c.isspace():
            if tok: return tok
            continue
        tok += c

with open(sys.argv[1], 'rb') as f:
    assert read_token(f) == b'P6'
    w, h, mx = int(read_token(f)), int(read_token(f)), int(read_token(f))
    data = f.read(w * h * 3)
raw = b''.join(b'\x00' + data[y * w * 3:(y + 1) * w * 3] for y in range(h))
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
open(sys.argv[2], 'wb').write(png)
print(sys.argv[2], w, 'x', h)
