"""Chat-owned pixel oracle for script-free Office frames in macOS WKWebView."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import wait_until


def prove_preview_pixels(
    client: TauriSession, detail: str, filename: str, expected: list[str],
    evidence_root: Path, state: str,
) -> dict:
    from PIL import Image

    if sys.platform != "darwin" or not shutil.which("swiftc"):
        raise GateError("Chat Office pixel proof requires a platform-owned OCR oracle")
    evidence_root.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix(".swift")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    oracle = evidence_root.parent / f"chat-file-pixels-{digest}"
    if not oracle.exists():
        subprocess.run(
            ["swiftc", str(source), "-o", str(oracle)],
            check=True, capture_output=True, timeout=30,
        )
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
        const navigation = preview.querySelector('.chat-preview-navigation [role="status"]');
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
        image.crop((round(host["x"] * sx), round(host["y"] * sy),
                    round(host["right"] * sx), round(host["bottom"] * sy))).save(header)
        nav = observation["navigationRect"]
        if nav:
            nav_image = image.crop((round((nav["x"] - 4) * sx), round((nav["y"] - 4) * sy),
                                    round((nav["right"] + 4) * sx), round((nav["bottom"] + 4) * sy)))
            nav_image.resize((nav_image.width * 3, nav_image.height * 3)).save(navigation)
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
