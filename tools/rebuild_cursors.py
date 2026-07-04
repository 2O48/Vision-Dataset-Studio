from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CURSOR_DIR = ROOT / "frontend" / "assets" / "cursors"
TARGET_SIZE = 32


def read_hotspot(src_path: Path) -> tuple[int, int]:
    data = src_path.read_bytes()
    if len(data) < 14 or data[:4] != b"\x00\x00\x02\x00":
        return TARGET_SIZE // 2, TARGET_SIZE // 2
    hot_x, hot_y = struct.unpack_from("<HH", data, 10)
    return hot_x, hot_y


def make_cur(src_path: Path, dst_path: Path) -> None:
    image = Image.open(src_path).convert("RGBA")
    resized = image.resize((TARGET_SIZE, TARGET_SIZE), Image.Resampling.LANCZOS)
    hot_x, hot_y = read_hotspot(src_path)
    hotspot = (
        max(0, min(TARGET_SIZE - 1, round(hot_x * TARGET_SIZE / image.width))),
        max(0, min(TARGET_SIZE - 1, round(hot_y * TARGET_SIZE / image.height))),
    )

    width, height = resized.size
    pixels = resized.tobytes("raw", "BGRA")
    rows = [pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height - 1, -1, -1)]
    xor_bitmap = b"".join(rows)
    mask_stride = ((width + 31) // 32) * 4
    and_mask = b"\x00" * mask_stride * height
    dib_header = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        len(xor_bitmap),
        0,
        0,
        0,
        0,
    )
    image_data = dib_header + xor_bitmap + and_mask
    cursor_header = struct.pack("<HHH", 0, 2, 1)
    directory_entry = struct.pack(
        "<BBBBHHII",
        width if width < 256 else 0,
        height if height < 256 else 0,
        0,
        0,
        hotspot[0],
        hotspot[1],
        len(image_data),
        22,
    )
    dst_path.write_bytes(cursor_header + directory_entry + image_data)


def main() -> None:
    CURSOR_DIR.mkdir(parents=True, exist_ok=True)
    for src in CURSOR_DIR.glob("*.cur"):
        make_cur(src, src)


if __name__ == "__main__":
    main()
