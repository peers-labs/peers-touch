"""Real decodable file inputs for the existing rich-media Native Journey."""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
import wave
import zipfile
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat.lifecycle_file_documents import create_office_documents


FILE_FORMAT_KINDS = {
    "image": "image",
    "audio": "audio",
    "audio_m4a": "audio",
    "video": "video",
    "pdf": "pdf",
    "text": "text",
    "office": "office",
    "workbook": "office",
    "presentation": "office",
    "archive": "file",
    "unsupported": "file",
    "oversized_text": "text",
}


def _write_pdf(path: Path) -> None:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for page in (1, 2):
        content = (
            f"BT /F1 18 Tf 25 350 Td (File viewing page {page}) Tj ET\n"
            "0.12 0.4 0.42 rg 25 325 250 3 re f\n"
            "0 0 0 rg BT /F1 12 Tf 25 300 Td (Content fidelity and local rendering) Tj ET\n"
            "0.23 0.65 0.62 rg 25 180 70 80 re f\n"
            "0.74 0.47 0.24 rg 120 180 140 80 re f\n"
        ).encode()
        objects.append(f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"endstream")
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + body + b"\nendobj\n")
    start = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
    )
    path.write_bytes(data)


def create_file_format_fixtures(root: Path) -> dict[str, Path]:
    from PIL import Image, ImageDraw

    root.mkdir(parents=True, exist_ok=True)
    files = {
        "image": root / "format-image.png",
        "audio": root / "format-audio.wav",
        "audio_m4a": root / "format-audio.m4a",
        "video": root / "format-video.mp4",
        "pdf": root / "format-report.pdf",
        "text": root / "format-report.txt",
        "office": root / "format-report.docx",
        "workbook": root / "format-report.xlsx",
        "presentation": root / "format-report.pptx",
        "archive": root / "format-report.zip",
        "unsupported": root / "format-active.html",
        "oversized_text": root / "format-oversized.txt",
    }
    image = Image.new("RGB", (4800, 3200), "#eaf3f3")
    drawing = ImageDraw.Draw(image)
    for x in range(0, 4800, 160):
        drawing.rectangle((x, 0, x + 80, 3200), fill=(40 + x // 40, 130, 160))
    drawing.rectangle((600, 500, 4200, 2700), fill="white", outline="#263c43", width=28)
    drawing.text((850, 800), "4800 x 3200 / 15.36 megapixels", fill="#111111", font_size=170)
    drawing.text((850, 1100), "HIGH RESOLUTION PREVIEW", fill="#111111", font_size=180)
    drawing.rectangle((900, 1700, 1800, 2400), fill="#3aa6a0")
    drawing.rectangle((2100, 1700, 3900, 2400), fill="#bd783f")
    image.save(files["image"])
    with wave.open(str(files["audio"]), "wb") as audio:
        audio.setparams((1, 2, 8000, 32000, "NONE", "not compressed"))
        audio.writeframes(b"".join(
            struct.pack("<h", int(8000 * math.sin(index * math.tau * 440 / 8000)))
            for index in range(32000)
        ))
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise GateError("file-format fixture requires the real ffmpeg encoder")
    subprocess.run(
        (ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=10", "-t", "4",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         str(files["video"])),
        check=True, timeout=30, capture_output=True,
    )
    subprocess.run(
        (ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-i", str(files["audio"]), "-c:a", "aac", str(files["audio_m4a"])),
        check=True, timeout=30, capture_output=True,
    )
    _write_pdf(files["pdf"])
    files["text"].write_text("Real encrypted file preview.\n", encoding="utf-8")
    create_office_documents(files, files["image"])
    with zipfile.ZipFile(files["archive"], "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(files["text"], "report.txt")
    files["unsupported"].write_text(
        '<html><script>window.__attachmentExecuted = true;</script></html>', encoding="utf-8",
    )
    files["oversized_text"].write_bytes(b"".join(
        f"TEXT PAGE {page + 1:02} / unique content\n".encode().ljust(32 * 1024, bytes([65 + page]))
        for page in range(16)
    ) + b"FINAL PARTIAL PAGE\n")
    return files
