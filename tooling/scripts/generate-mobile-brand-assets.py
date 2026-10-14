#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

try:
    from PIL import Image, ImageDraw
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
ANDROID_GENERATED_RES_DIR = (
    MOBILE_ROOT / "src-tauri/gen/android/app/src/main/res"
)
ANDROID_MANIFEST_PATH = (
    MOBILE_ROOT / "src-tauri/gen/android/app/src/main/AndroidManifest.xml"
)
ANDROID_LEGACY_ICON_PIXELS = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
ANDROID_ADAPTIVE_ICON_PIXELS = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}
ANDROID_ADAPTIVE_ICON_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/peers_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
"""
ANDROID_LAUNCHER_COLORS_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="peers_launcher_background">#FFFFFFFF</color>
</resources>
"""
ANDROID_DEFAULT_RESOURCES = (
    ANDROID_GENERATED_RES_DIR / "drawable-v24/ic_launcher_foreground.xml",
    ANDROID_GENERATED_RES_DIR / "drawable/ic_launcher_background.xml",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify committed assets without modifying them",
    )
    args = parser.parse_args()

    sync_auth_logos(args.check)
    icon = build_mobile_icon_from_desktop()
    write_image_asset(ICON_SOURCE_PATH, icon, args.check)
    update_ios_app_icons(icon, args.check)
    update_tauri_png_icons(icon, args.check)
    update_android_launcher_icons(icon, args.check)
    verify_android_manifest_branding()
    remove_android_default_resources(args.check)


def sync_auth_logos(check: bool) -> None:
    for destination in AUTH_LOGO_PATHS:
        if check:
            if (
                not destination.exists()
                or destination.read_bytes() != DESKTOP_AUTH_LOGO_PATH.read_bytes()
            ):
                raise SystemExit(f"brand asset is stale: {destination}")
            continue
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


def update_ios_app_icons(icon: Image.Image, check: bool) -> None:
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
        write_image_asset(
            icon_dir / filename,
            source.resize((pixels, pixels), Image.Resampling.LANCZOS),
            check,
        )


def update_tauri_png_icons(icon: Image.Image, check: bool) -> None:
    source = icon.convert("RGB")
    for filename, pixels in {
        "icon.png": 512,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "32x32.png": 32,
    }.items():
        write_image_asset(
            TAURI_ICONS_DIR / filename,
            source.resize((pixels, pixels), Image.Resampling.LANCZOS),
            check,
        )

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
            write_image_asset(
                path,
                source.resize(old_size, Image.Resampling.LANCZOS),
                check,
            )


def update_android_launcher_icons(icon: Image.Image, check: bool) -> None:
    foreground_source = build_android_foreground(icon)
    monochrome_source = build_android_monochrome(foreground_source)
    roots = (
        TAURI_ICONS_DIR / "android",
        ANDROID_GENERATED_RES_DIR,
    )

    for root in roots:
        for density, pixels in ANDROID_LEGACY_ICON_PIXELS.items():
            directory = root / f"mipmap-{density}"
            legacy = icon.convert("RGB").resize(
                (pixels, pixels),
                Image.Resampling.LANCZOS,
            )
            write_image_asset(directory / "ic_launcher.png", legacy, check)
            write_image_asset(
                directory / "ic_launcher_round.png",
                round_legacy_icon(legacy),
                check,
            )

        for density, pixels in ANDROID_ADAPTIVE_ICON_PIXELS.items():
            directory = root / f"mipmap-{density}"
            foreground = foreground_source.resize(
                (pixels, pixels),
                Image.Resampling.LANCZOS,
            )
            monochrome = monochrome_source.resize(
                (pixels, pixels),
                Image.Resampling.LANCZOS,
            )
            write_image_asset(
                directory / "ic_launcher_foreground.png",
                foreground,
                check,
            )
            write_image_asset(
                directory / "ic_launcher_monochrome.png",
                monochrome,
                check,
            )

    adaptive_dir = ANDROID_GENERATED_RES_DIR / "mipmap-anydpi-v26"
    write_text_asset(
        adaptive_dir / "ic_launcher.xml",
        ANDROID_ADAPTIVE_ICON_XML,
        check,
    )
    write_text_asset(
        adaptive_dir / "ic_launcher_round.xml",
        ANDROID_ADAPTIVE_ICON_XML,
        check,
    )
    write_text_asset(
        ANDROID_GENERATED_RES_DIR / "values" / "launcher_icon.xml",
        ANDROID_LAUNCHER_COLORS_XML,
        check,
    )


def build_android_foreground(icon: Image.Image) -> Image.Image:
    source = icon.convert("RGBA")
    pixels = source.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = pixels[x, y]
            distance_from_white = max(255 - red, 255 - green, 255 - blue)
            if alpha == 0 or distance_from_white <= 5:
                pixels[x, y] = (red, green, blue, 0)
                continue
            foreground_alpha = min(
                alpha,
                max(0, int((distance_from_white - 5) * 255 / 24)),
            )
            pixels[x, y] = (red, green, blue, foreground_alpha)

    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("Peers wordmark could not be extracted")
    wordmark = source.crop(bounds)
    canvas = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    target_width = 260
    target_height = max(1, round(wordmark.height * target_width / wordmark.width))
    wordmark = wordmark.resize(
        (target_width, target_height),
        Image.Resampling.LANCZOS,
    )
    canvas.alpha_composite(
        wordmark,
        (
            (canvas.width - wordmark.width) // 2,
            (canvas.height - wordmark.height) // 2,
        ),
    )
    return canvas


def build_android_monochrome(foreground: Image.Image) -> Image.Image:
    result = Image.new("RGBA", foreground.size, (255, 255, 255, 0))
    result.putalpha(foreground.getchannel("A"))
    return result


def round_legacy_icon(icon: Image.Image) -> Image.Image:
    rgba = icon.convert("RGBA")
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, icon.width - 1, icon.height - 1), fill=255)
    rgba.putalpha(mask)
    return rgba


def write_image_asset(path: Path, image: Image.Image, check: bool) -> None:
    if check:
        if not path.exists():
            raise SystemExit(f"brand asset is missing: {path}")
        with Image.open(path) as existing:
            if (
                existing.size != image.size
                or existing.convert("RGBA").tobytes()
                != image.convert("RGBA").tobytes()
            ):
                raise SystemExit(f"brand asset is stale: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def write_text_asset(path: Path, content: str, check: bool) -> None:
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            raise SystemExit(f"brand asset is stale: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def verify_android_manifest_branding() -> None:
    manifest = ANDROID_MANIFEST_PATH.read_text(encoding="utf-8")
    for required in (
        'android:icon="@mipmap/ic_launcher"',
        'android:roundIcon="@mipmap/ic_launcher_round"',
    ):
        if required not in manifest:
            raise SystemExit(f"Android manifest branding is incomplete: {required}")


def remove_android_default_resources(check: bool) -> None:
    for path in ANDROID_DEFAULT_RESOURCES:
        if check and path.exists():
            raise SystemExit(f"Tauri default launcher resource remains: {path}")
        if not check:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
