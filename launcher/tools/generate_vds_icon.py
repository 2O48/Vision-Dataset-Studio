from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "frontend" / "assets" / "favicon.png"
LAUNCHER_UI = ROOT / "launcher" / "ui"
TAURI_ICONS = ROOT / "launcher" / "src-tauri" / "icons"


def contain_square(image, size):
    image = image.convert("RGBA")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - image.width) // 2
    y = (size - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    if size <= 64:
        canvas = canvas.filter(ImageFilter.UnsharpMask(radius=0.65, percent=180, threshold=2))
    return canvas


def main():
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing source icon: {SOURCE}")

    LAUNCHER_UI.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)

    source = Image.open(SOURCE)
    contain_square(source.copy(), 512).save(LAUNCHER_UI / "vds-logo.png")
    contain_square(source.copy(), 512).save(TAURI_ICONS / "icon-512.png")
    contain_square(source.copy(), 256).save(TAURI_ICONS / "icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [contain_square(source.copy(), size) for size in sizes]
    ico_images[-1].save(TAURI_ICONS / "icon.ico", sizes=[(size, size) for size in sizes])


if __name__ == "__main__":
    main()
