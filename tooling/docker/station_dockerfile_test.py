from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATION_DOCKERFILE = ROOT / "tooling" / "docker" / "station.Dockerfile"
BUILDER_DOCKERFILE = ROOT / "tooling" / "docker" / "builder-base.Dockerfile"


def go_version(lines: list[str]) -> str:
    declaration = next(
        line for line in lines if line.startswith("ARG GO_VERSION=")
    )
    return declaration.split("=", 1)[1]


class StationDockerfileTests(unittest.TestCase):
    def test_fallback_go_installer_receives_the_declared_version(self) -> None:
        lines = STATION_DOCKERFILE.read_text(encoding="utf-8").splitlines()
        first_from = next(
            index for index, line in enumerate(lines) if line.startswith("FROM ")
        )
        fallback = next(
            index
            for index, line in enumerate(lines)
            if "if ! command -v go" in line
        )

        self.assertLess(
            lines.index(f"ARG GO_VERSION={go_version(lines)}"),
            first_from,
        )
        self.assertIn("ARG GO_VERSION", lines[first_from + 1 : fallback])
        self.assertIn(
            'go${GO_VERSION}.linux-${ARCH}.tar.gz',
            STATION_DOCKERFILE.read_text(encoding="utf-8"),
        )

    def test_station_and_builder_base_pin_the_same_go_version(self) -> None:
        station_lines = STATION_DOCKERFILE.read_text(
            encoding="utf-8"
        ).splitlines()
        builder_lines = BUILDER_DOCKERFILE.read_text(
            encoding="utf-8"
        ).splitlines()

        self.assertEqual(go_version(station_lines), go_version(builder_lines))


if __name__ == "__main__":
    unittest.main()
