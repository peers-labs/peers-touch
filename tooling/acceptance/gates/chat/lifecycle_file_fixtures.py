"""Real decodable file inputs for the existing rich-media Native Journey."""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
import wave
import zipfile
import zlib
from pathlib import Path

from tooling.acceptance.core import GateError


FILE_FORMAT_KINDS = {
    "image": "image",
    "audio": "audio",
    "audio_m4a": "audio",
    "video": "video",
    "pdf": "pdf",
    "text": "text",
    "office": "office",
    "archive": "file",
    "unsupported": "file",
    "oversized_text": "file",
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
        content = f"BT /F1 18 Tf 25 350 Td (File viewing page {page}) Tj ET\n".encode()
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
    root.mkdir(parents=True, exist_ok=True)
    files = {
        "image": root / "format-image.png",
        "audio": root / "format-audio.wav",
        "audio_m4a": root / "format-audio.m4a",
        "video": root / "format-video.mp4",
        "pdf": root / "format-report.pdf",
        "text": root / "format-report.txt",
        "office": root / "format-report.docx",
        "archive": root / "format-report.zip",
        "unsupported": root / "format-active.html",
        "oversized_text": root / "format-oversized.txt",
    }
    def png_chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(
            ">I", zlib.crc32(kind + body) & 0xFFFFFFFF,
        )
    pixels = b"\x00" + b"\xff\x00\x00\xff\x00\x00\xff\xff"
    pixels += b"\x00" + b"\x00\x00\xff\xff\xff\x00\x00\xff"
    files["image"].write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(pixels))
        + png_chunk(b"IEND", b"")
    )
    with wave.open(str(files["audio"]), "wb") as audio:
        audio.setparams((1, 2, 8000, 8000, "NONE", "not compressed"))
        audio.writeframes(b"".join(
            struct.pack("<h", int(8000 * math.sin(index * math.tau * 440 / 8000)))
            for index in range(8000)
        ))
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise GateError("file-format fixture requires the real ffmpeg encoder")
    subprocess.run(
        (ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-f", "lavfi", "-i", "testsrc=size=96x64:rate=5", "-t", "1",
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
    with zipfile.ZipFile(files["office"], "w", zipfile.ZIP_DEFLATED) as document:
        document.writestr("[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        document.writestr("_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        document.writestr("word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body><w:p><w:r><w:t>Real Office file preview.</w:t></w:r></w:p></w:body></w:document>')
    with zipfile.ZipFile(files["archive"], "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(files["text"], "report.txt")
    files["unsupported"].write_text(
        '<html><script>window.__attachmentExecuted = true;</script></html>', encoding="utf-8",
    )
    files["oversized_text"].write_bytes(b"x" * (512 * 1024 + 1))
    return files
