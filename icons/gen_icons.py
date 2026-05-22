"""Generate simple PNG icons for the PWA."""
import struct
import zlib

def create_png(size, filename):
    """Create a simple PNG with a dark background and a fuel pump symbol."""
    # Create raw pixel data (RGBA)
    bg = (26, 26, 46, 255)  # #1a1a2e
    accent = (233, 69, 96, 255)  # #e94560

    rows = []
    center = size // 2
    radius = size // 3

    for y in range(size):
        row = b'\x00'  # filter byte
        for x in range(size):
            # Draw a circle in the center
            dx = x - center
            dy = y - center
            dist = (dx*dx + dy*dy) ** 0.5

            if dist < radius:
                # Inner circle - accent color with fuel pump shape
                if abs(dx) < radius * 0.3 and dy > -radius * 0.6 and dy < radius * 0.4:
                    row += bytes(accent)
                elif abs(dx) < radius * 0.5 and abs(dy) < radius * 0.2:
                    row += bytes(accent)
                else:
                    row += bytes((15, 52, 96, 255))  # #0f3460
            else:
                row += bytes(bg)
        rows.append(row)

    raw_data = b''.join(rows)

    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT
    compressed = zlib.compress(raw_data, 9)
    idat = make_chunk(b'IDAT', compressed)

    # IEND
    iend = make_chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(signature + ihdr + idat + iend)

    print(f"Created {filename} ({size}x{size})")

create_png(192, 'icon-192.png')
create_png(512, 'icon-512.png')
