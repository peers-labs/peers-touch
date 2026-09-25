#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

try:
    from PIL import Image
except ModuleNotFoundError:
    system_python = Path("/usr/bin/python3")
    if Path(sys.executable) != system_python and system_python.exists():
        probe = subprocess.run(
            [str(system_python), "-c", "import PIL"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if probe.returncode == 0:
            os.execv(str(system_python), [str(system_python), *sys.argv])
    raise


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MOBILE_ROOT = PROJECT_ROOT / "apps/mobile"
DESKTOP_ICON_SOURCE_PATH = PROJECT_ROOT / "apps/desktop/src-tauri/icon-source.png"
DESKTOP_AUTH_LOGO_PATH = PROJECT_ROOT / "apps/desktop/src-tauri/icons/icon.png"
AUTH_LOGO_PATHS = (
    MOBILE_ROOT / "src/assets/logo.png",
    PROJECT_ROOT / "packages/prototypes/mobile/chat/src/assets/logo.png",
)
ICON_SOURCE_PATH = MOBILE_ROOT / "src-tauri/icon-source.png"
IOS_APPICON_CONTENTS = (
    MOBILE_ROOT / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json"
)
TAURI_ICONS_DIR = MOBILE_ROOT / "src-tauri/icons"


def main() -> None:
    sync_auth_logos()
    icon = build_mobile_icon_from_desktop()
    icon.save(ICON_SOURCE_PATH)
    update_ios_app_icons(icon)
    update_tauri_png_icons(icon)
    update_android_launcher_icons(icon)


def sync_auth_logos() -> None:
    for destination in AUTH_LOGO_PATHS:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DESKTOP_AUTH_LOGO_PATH, destination)


def build_mobile_icon_from_desktop() -> Image.Image:
    desktop_icon = Image.open(DESKTOP_ICON_SOURCE_PATH).convert("RGBA")
    content = crop_desktop_icon_body(desktop_icon)
    canvas = Image.new("RGBA", desktop_icon.size, (255, 255, 255, 255))
    target_size = mobile_icon_body_size(canvas, content)
    content = content.resize(target_size, Image.Resampling.LANCZOS)
    x = (canvas.width - content.width) // 2
    y = (canvas.height - content.height) // 2
    canvas.alpha_composite(content, (x, y))
    return canvas


def crop_desktop_icon_body(icon: Image.Image) -> Image.Image:
    bbox = detect_icon_body_bbox(icon)
    return icon.crop(bbox)


def detect_icon_body_bbox(icon: Image.Image) -> tuple[int, int, int, int]:
    pixels = icon.load()
    width, height = icon.size

    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 0 and not is_outer_frame_pixel(r, g, b):
                xs.append(x)
                ys.append(y)

    if not xs or not ys:
        return icon.getchannel("A").getbbox() or (0, 0, width, height)

    margin = max(0, int(width * 0.015))
    return (
        max(0, min(xs) - margin),
        max(0, min(ys) - margin),
        min(width, max(xs) + margin),
        min(height, max(ys) + margin),
    )


def is_outer_frame_pixel(r: int, g: int, b: int) -> bool:
    return r < 48 and g < 48 and b < 48


def mobile_icon_body_size(canvas: Image.Image, content: Image.Image) -> tuple[int, int]:
    # Slight bleed makes the desktop card edge sit outside the iOS mask.
    scale = max(canvas.width / content.width, canvas.height / content.height) * 1.04
    return (int(content.width * scale), int(content.height * scale))


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


if __name__ == "__main__":
    main()
