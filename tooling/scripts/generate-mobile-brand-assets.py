#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MOBILE_ROOT = PROJECT_ROOT / "apps/mobile"
WORDMARK_PATH = MOBILE_ROOT / "src/assets/logo.png"
ICON_SOURCE_PATH = MOBILE_ROOT / "src-tauri/icon-source.png"
IOS_APPICON_CONTENTS = (
    MOBILE_ROOT / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json"
)
TAURI_ICONS_DIR = MOBILE_ROOT / "src-tauri/icons"


def main() -> None:
    normalize_wordmark()
    icon = build_app_icon()
    icon.save(ICON_SOURCE_PATH)
    update_ios_app_icons(icon)
    update_tauri_png_icons(icon)
    update_android_launcher_icons(icon)


def normalize_wordmark() -> None:
    source = Image.open(WORDMARK_PATH).convert("RGBA")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_pixels = source.load()
    output_pixels = output.load()

    for y in range(source.height):
        for x in range(source.width):
            r, g, b, a = source_pixels[x, y]
            if a > 0 and not (r > 235 and g > 235 and b > 235):
                output_pixels[x, y] = (r, g, b, a)

    bbox = output.getchannel("A").getbbox()
    if bbox:
        output = output.crop(bbox)
    output.save(WORDMARK_PATH)


def build_app_icon() -> Image.Image:
    size = 1024
    icon = Image.new("RGBA", (size, size), (8, 16, 36, 255))
    draw = ImageDraw.Draw(icon)

    for y in range(size):
        t = y / (size - 1)
        draw.line(
            (0, y, size, y),
            fill=(int(8 + 18 * t), int(16 + 28 * t), int(36 + 48 * t), 255),
        )

    for box, color, blur in [
        ((-230, -250, 620, 600), (102, 126, 234, 115), 150),
        ((540, -170, 1180, 470), (80, 190, 92, 95), 130),
        ((420, 650, 1180, 1340), (118, 75, 162, 76), 150),
    ]:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(box, fill=color)
        icon = Image.alpha_composite(icon, glow.filter(ImageFilter.GaussianBlur(blur)))

    icon = draw_monogram(icon)
    return draw_leaf_accent(icon)


def draw_monogram(icon: Image.Image) -> Image.Image:
    size = icon.width
    draw = ImageDraw.Draw(icon)
    font = ImageFont.truetype(resolve_font_path(), 650)
    bbox = draw.textbbox((0, 0), "P", font=font)
    x = (size - (bbox[2] - bbox[0])) // 2 - bbox[0] - 18
    y = (size - (bbox[3] - bbox[1])) // 2 - bbox[1] + 20

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x + 18, y + 24), "P", font=font, fill=(0, 0, 0, 95))
    icon = Image.alpha_composite(icon, shadow.filter(ImageFilter.GaussianBlur(18)))

    draw = ImageDraw.Draw(icon)
    draw.text((x, y), "P", font=font, fill=(255, 255, 255, 248))
    return icon


def draw_leaf_accent(icon: Image.Image) -> Image.Image:
    size = icon.width
    accent = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(accent)
    draw.ellipse((610, 250, 820, 460), fill=(80, 190, 92, 238))
    draw.ellipse((690, 215, 890, 415), fill=(120, 210, 96, 215))
    draw.rounded_rectangle((675, 326, 852, 390), radius=32, fill=(8, 16, 36, 245))
    return Image.alpha_composite(icon, accent)


def update_ios_app_icons(icon: Image.Image) -> None:
    contents = json.loads(IOS_APPICON_CONTENTS.read_text())
    icon_dir = IOS_APPICON_CONTENTS.parent
    source = icon.convert("RGB")

    for item in contents["images"]:
        filename = item.get("filename")
        if not filename:
            continue
        logical_size = float(item["size"].split("x")[0])
        scale = int(item["scale"].replace("x", ""))
        pixels = int(round(logical_size * scale))
        source.resize((pixels, pixels), Image.Resampling.LANCZOS).save(icon_dir / filename)


def update_tauri_png_icons(icon: Image.Image) -> None:
    source = icon.convert("RGB")
    for filename, pixels in {
        "icon.png": 512,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "32x32.png": 32,
    }.items():
        source.resize((pixels, pixels), Image.Resampling.LANCZOS).save(TAURI_ICONS_DIR / filename)

    for filename in [
        "Square310x310Logo.png",
        "Square284x284Logo.png",
        "Square150x150Logo.png",
        "Square142x142Logo.png",
        "Square107x107Logo.png",
        "Square89x89Logo.png",
        "Square71x71Logo.png",
        "Square44x44Logo.png",
        "Square30x30Logo.png",
        "StoreLogo.png",
    ]:
        path = TAURI_ICONS_DIR / filename
        if path.exists():
            old_size = Image.open(path).size
            source.resize(old_size, Image.Resampling.LANCZOS).save(path)


def update_android_launcher_icons(icon: Image.Image) -> None:
    source = icon.convert("RGB")
    android_icon_root = TAURI_ICONS_DIR / "android"

    for path in android_icon_root.glob("mipmap-*/*.png"):
        old_size = Image.open(path).size
        source.resize(old_size, Image.Resampling.LANCZOS).save(path)


def resolve_font_path() -> str:
    for path in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]:
        if Path(path).exists():
            return path
    raise RuntimeError("No supported bold font found for mobile app icon generation.")


if __name__ == "__main__":
    main()
