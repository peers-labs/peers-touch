"""Native output capture shared by the existing simulator session owners."""
from __future__ import annotations

import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from tooling.acceptance.core import DriverError
from tooling.acceptance.core.redaction import redact_text


def ios_native_output_callbacks(
    *, directory: Path, client_id: str, device: str, application_id: str,
    writer: Any, sensitive_values: Sequence[str] = (),
) -> tuple[Callable[[], None], Callable[[], None]]:
    generation = 0
    captured_generation = 0

    def launch() -> None:
        nonlocal generation
        generation += 1
        directory.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            (
                "xcrun", "simctl", "launch", "--terminate-running-process",
                f"--stdout={directory / f'{generation}-stdout.log'}",
                f"--stderr={directory / f'{generation}-stderr.log'}",
                device, application_id,
            ),
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode:
            raise DriverError("Owned iOS native launch failed: " + redact_text(result.stderr or result.stdout))

    def capture() -> None:
        nonlocal captured_generation
        for index in range(captured_generation + 1, generation + 1):
            for stream in ("stdout", "stderr"):
                path = directory / f"{index}-{stream}.log"
                if not path.is_file():
                    continue
                with path.open("rb") as source:
                    source.seek(max(0, path.stat().st_size - 8 * 1024 * 1024))
                    value = source.read().decode("utf-8", errors="replace")
                for sensitive in sensitive_values:
                    if sensitive:
                        value = value.replace(sensitive, "<redacted>")
                writer.write_bytes(
                    f"runtime/mobile-simulator/native-output/{client_id}/{index}-{stream}.log",
                    redact_text(value).encode("utf-8"), media_type="text/plain",
                    role=f"mobile-native-{stream}/{client_id}/{index}",
                )
        captured_generation = generation

    return launch, capture
