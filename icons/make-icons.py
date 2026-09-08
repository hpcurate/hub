#!/usr/bin/env python3
"""Writes the extension's icons. No dependencies — a PNG is a zlib stream in a
few length-prefixed chunks, and the mark is simple enough to rasterise by hand.

    python icons/make-icons.py

The mark is HUB's favicon at three sizes: the app's ground, a violet dot inside
a light ring. Regenerate rather than editing the PNGs."""
import struct, zlib, os

BG   = (0x0e, 0x0e, 0x0e)
RING = (0xde, 0xde, 0xde)
DOT  = (0xa7, 0x8b, 0xfa)
HERE = os.path.dirname(os.path.abspath(__file__))

def px(size):
    """Rows of RGBA, supersampled 4x4 per pixel so the curves are not jagged."""
    c, S = (size - 1) / 2.0, 4
    r_out, r_in, r_dot = size * 0.34, size * 0.34 - max(1.0, size / 16.0), size * 0.145
    corner = size * 0.125
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(S):
                for sx in range(S):
                    fx, fy = x + (sx + .5) / S, y + (sy + .5) / S
                    dx, dy = fx - c - .5, fy - c - .5
                    d = (dx * dx + dy * dy) ** .5
                    # rounded-square ground
                    ox = max(abs(dx) - (size / 2.0 - corner), 0)
                    oy = max(abs(dy) - (size / 2.0 - corner), 0)
                    inside = (ox * ox + oy * oy) ** .5 <= corner and \
                             abs(dx) <= size / 2.0 and abs(dy) <= size / 2.0
                    if not inside:
                        col, a = BG, 0.0
                    elif d <= r_dot:
                        col, a = DOT, 1.0
                    elif r_in <= d <= r_out:
                        col, a = RING, 1.0
                    else:
                        col, a = BG, 1.0
                    acc[0] += col[0] * a; acc[1] += col[1] * a
                    acc[2] += col[2] * a; acc[3] += 255 * a
            n = S * S
            a = acc[3] / n
            row += bytes((int(acc[0] / n + .5), int(acc[1] / n + .5),
                          int(acc[2] / n + .5), int(a + .5)))
        rows.append(bytes(row))
    return rows

def png(path, size):
    raw = b''.join(b'\x00' + r for r in px(size))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + \
               struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)

if __name__ == '__main__':
    for s in (16, 48, 128):
        p = os.path.join(HERE, '%d.png' % s)
        print('%-3d -> %s (%d bytes)' % (s, os.path.basename(p), png(p, s)))
