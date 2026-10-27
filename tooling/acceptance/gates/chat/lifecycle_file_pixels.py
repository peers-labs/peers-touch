"""Chat-owned pixel oracle for script-free Office frames in macOS WKWebView."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import MouseAction
from tooling.acceptance.drivers.native.macos_documents import process_document_window
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import wait_until


def _pixel_oracle(evidence_root: Path) -> tuple[Path, str]:
    if sys.platform != "darwin" or not shutil.which("swiftc"):
        raise GateError("Chat pixel proof requires a platform-owned OCR oracle")
    evidence_root.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix(".swift")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    oracle = evidence_root.parent / f"chat-file-pixels-{digest}"
    if not oracle.exists():
        subprocess.run(
            ["swiftc", str(source), "-o", str(oracle)],
            check=True, capture_output=True, timeout=30,
        )
    return oracle, digest


# Vision's text detector returns no results on extremely wide, short strips
# even when the glyphs are legible. Normalize toolbar/title crops to a bounded
# aspect ratio before OCR; content is unchanged, only resolution is reduced.
_MAX_OCR_STRIP_RATIO = 14


def _normalize_ocr_strip(path: Path) -> None:
    from PIL import Image

    with Image.open(path) as opened:
        width, height = opened.size
    if height <= 0 or width / height <= _MAX_OCR_STRIP_RATIO:
        return
    target_width = max(1, height * _MAX_OCR_STRIP_RATIO)
    with Image.open(path) as opened:
        opened.convert("RGB").resize(
            (target_width, height), Image.Resampling.LANCZOS,
        ).save(path)


def prove_native_document_pixels(
    adapter, process_id: int, filename: str, expected: str, evidence_root: Path,
) -> dict:
    """Prove a real process-owned native document through visible screen pixels."""
    from PIL import Image

    adapter.require_exclusive_input("observe native document pixels")
    oracle, digest = _pixel_oracle(evidence_root)
    geometry = wait_until(
        lambda: process_document_window(process_id),
        "process-owned native document window", timeout=20,
    )
    point = (geometry["x"] + geometry["width"] / 2, geometry["y"] + 18)
    stack = adapter.window_stack_at_point(point)
    if stack.error or not stack.point_owned_by(process_id):
        raise GateError("Native document title is occluded by another process")
    adapter.post_mouse(
        (MouseAction.MOVE, MouseAction.LEFT_DOWN, MouseAction.LEFT_UP), point,
    )
    screenshot = evidence_root / "native-preview.png"
    header = evidence_root / "native-preview-header.png"
    content = evidence_root / "native-preview-content.png"
    display = geometry["display"]
    x, y = geometry["x"] - display["x"], geometry["y"] - display["y"]
    width, height = geometry["width"], geometry["height"]
    if x < 0 or y < 0 or x + width > display["width"] or y + height > display["height"]:
        raise GateError("Native document window is outside the captured display")
    result = {}

    def capture() -> dict | None:
        nonlocal result
        if process_document_window(process_id) != geometry:
            raise GateError("Native document window changed before screenshot capture")
        adapter.capture_screenshot(screenshot)
        if process_document_window(process_id) != geometry:
            raise GateError("Native document window changed during screenshot capture")
        with Image.open(screenshot) as image:
            sx, sy = image.width / display["width"], image.height / display["height"]
            # Exclude the close button and trailing toolbar icons. Vision's
            # layout analysis otherwise selects only icons in this wide strip.
            title = image.crop((round((x + 32) * sx), round(y * sy),
                                round((x + width * .65) * sx), round((y + 38) * sy)))
            title.resize((title.width * 3, title.height * 3)).save(header)
            image.crop((round(x * sx), round((y + 38) * sy),
                        round((x + width) * sx), round((y + height) * sy))).save(content)
        header_lines = json.loads(subprocess.check_output(
            [str(oracle), str(header)], text=True, timeout=10,
        ))
        lines = json.loads(subprocess.check_output(
            [str(oracle), str(content)], text=True, timeout=10,
        ))
        matched = (
            filename.casefold() in " ".join(header_lines).casefold()
            and " ".join(expected.casefold().split())
            in " ".join(" ".join(lines).casefold().split())
        )
        result = {
            "geometry": geometry, "filename": filename, "expected": expected,
            "screenshot": str(screenshot), "headerScreenshot": str(header),
            "contentScreenshot": str(content), "headerOcrLines": header_lines,
            "ocrLines": lines, "contentMatched": matched,
            "screenshotSha256": hashlib.sha256(screenshot.read_bytes()).hexdigest(),
            "oracleSourceSha256": digest,
        }
        (evidence_root / "native-preview.json").write_text(json.dumps(result, indent=2))
        return result if matched else None

    return wait_until(capture, "native document filename and decoded content pixels", timeout=20)


def prove_preview_pixels(
    client: TauriSession, detail: str, filename: str, expected: list[str],
    evidence_root: Path, state: str,
) -> dict:
    from PIL import Image

    oracle, digest = _pixel_oracle(evidence_root)
    wait_until(
        lambda: client.execute_script(
            "return !document.querySelector('.ant-modal')?.getAnimations({subtree:true})"
            ".some(animation=>animation.playState==='running')"
        ),
        "Chat file modal animation completed", timeout=5,
    )
    script = """
        const detail = document.querySelector(arguments[0]);
        const preview = detail?.querySelector('.chat-file-preview-resource');
        if (!detail || preview?.dataset.chatPreviewState !== 'ready') return null;
        const r = preview.getBoundingClientRect();
        const title = detail.closest('.ant-modal')?.querySelector('.ant-modal-title');
        if (!title) return null;
        const host = title.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.bottom > innerHeight
            || getComputedStyle(detail).visibility !== 'visible') return null;
        const navigation = preview.querySelector('.chat-preview-pager .chat-preview-page-status');
        const nav = navigation?.getBoundingClientRect();
        return {filename: detail.dataset.chatFileName,
          attachment: detail.dataset.chatFileDetail,
          page: preview.querySelector('[data-chat-rendered-page]')?.dataset.chatRenderedPage,
          pageLabel: navigation?.textContent || '',
          rect: {x:r.x,y:r.y,right:r.right,bottom:r.bottom},
          titleRect: {x:host.x,y:host.y,right:host.right,bottom:host.bottom},
          navigationRect: nav ? {x:nav.x,y:nav.y,right:nav.right,bottom:nav.bottom} : null,
          viewport: {width:innerWidth,height:innerHeight}};
        """
    observation = client.execute_script(script, detail)
    if not observation or observation["filename"] != filename:
        raise GateError("Chat file pixel evidence does not match the selected ready file")
    screenshot = evidence_root / f"{state}.png"
    crop = evidence_root / f"{state}-content.png"
    header = evidence_root / f"{state}-header.png"
    navigation = evidence_root / f"{state}-navigation.png"
    client.save_screenshot(screenshot)
    if client.execute_script(script, detail) != observation:
        raise GateError("Chat selected file or page changed during screenshot capture")
    with Image.open(screenshot) as image:
        sx = image.width / observation["viewport"]["width"]
        sy = image.height / observation["viewport"]["height"]
        rect = observation["rect"]
        image.crop(tuple(round(rect[key] * (sx if key in ("x", "right") else sy))
                         for key in ("x", "y", "right", "bottom"))).save(crop)
        host = observation["titleRect"]
        header_image = image.crop((round(host["x"] * sx), round(host["y"] * sy),
                                   round(host["right"] * sx), round(host["bottom"] * sy)))
        header_image.resize((header_image.width * 3, header_image.height * 3)).save(header)
        _normalize_ocr_strip(header)
        nav = observation["navigationRect"]
        if nav:
            nav_image = image.crop((round((nav["x"] - 4) * sx), round((nav["y"] - 4) * sy),
                                    round((nav["right"] + 4) * sx), round((nav["bottom"] + 4) * sy)))
            nav_image.resize((nav_image.width * 3, nav_image.height * 3)).save(navigation)
            _normalize_ocr_strip(navigation)
    lines = json.loads(subprocess.check_output([str(oracle), str(crop)], text=True, timeout=10))
    header_lines = json.loads(subprocess.check_output([str(oracle), str(header)], text=True, timeout=10))
    navigation_lines = json.loads(subprocess.check_output(
        [str(oracle), str(navigation)], text=True, timeout=10,
    )) if observation["navigationRect"] else []
    text = " ".join(" ".join(lines).lower().split())
    missing = [value for value in expected if " ".join(value.lower().split()) not in text]
    # Exact filename is a pixel requirement, not a caller's DOM assertion.
    if filename.casefold() not in " ".join(header_lines).casefold():
        missing.append(filename)
    # OCR word segmentation may merge "of 2"; preserve every non-space glyph.
    page_label = "".join(observation["pageLabel"].casefold().split())
    if page_label and page_label != "".join(" ".join(navigation_lines).casefold().split()):
        missing.append(observation["pageLabel"])
    result = {
        **observation, "screenshot": str(screenshot), "contentScreenshot": str(crop),
        "headerScreenshot": str(header),
        "navigationScreenshot": str(navigation) if observation["navigationRect"] else None,
        "screenshotSha256": hashlib.sha256(screenshot.read_bytes()).hexdigest(),
        "ocrLines": lines, "headerOcrLines": header_lines, "navigationOcrLines": navigation_lines,
        "expected": expected, "missing": missing,
        "oracleSourceSha256": digest,
    }
    (evidence_root / f"{state}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    if missing:
        raise GateError(f"Chat rendered content pixels are missing: {missing}")
    return result
