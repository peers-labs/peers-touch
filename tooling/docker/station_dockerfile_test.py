from __future__ import annotations

import unittest
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATION_DOCKERFILE = ROOT / "tooling" / "docker" / "station.Dockerfile"
BUILDER_DOCKERFILE = ROOT / "tooling" / "docker" / "builder-base.Dockerfile"
ENTRYPOINT = ROOT / "tooling" / "docker" / "entrypoint.sh"
USER_COMPOSE = ROOT / "tooling" / "distribution" / "docker-compose.yml"


def go_version(lines: list[str]) -> str:
    declaration = next(
        line for line in lines if line.startswith("ARG GO_VERSION=")
    )
    return declaration.split("=", 1)[1]


class StationDockerfileTests(unittest.TestCase):
    def test_apt_override_preserves_distribution_and_default_bytes(self) -> None:
        helper = ROOT / "tooling/docker/configure-apt-mirror.sh"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / "sources.list.d"
            sources.mkdir()
            ubuntu = root / "sources.list"
            debian = sources / "debian.sources"
            original = "deb http://archive.ubuntu.com/ubuntu jammy main\ndeb http://ports.ubuntu.com/ubuntu-ports jammy main\n"
            ubuntu.write_text(original)
            debian.write_text("URIs: http://deb.debian.org/debian\nURIs: http://security.debian.org/debian-security\n")
            subprocess.run(["sh", str(helper), "", str(root)], check=True)
            self.assertEqual(ubuntu.read_text(), original)
            subprocess.run(["sh", str(helper), "https://mirror.example", str(root)], check=True)
            self.assertEqual(ubuntu.read_text(), original.replace("http://archive.ubuntu.com", "https://mirror.example").replace("http://ports.ubuntu.com", "https://mirror.example"))
            self.assertEqual(debian.read_text(), "URIs: https://mirror.example/debian\nURIs: https://mirror.example/debian-security\n")
            rejected = subprocess.run(["sh", str(helper), "https://mirror.example;touch /tmp/no", str(root)], capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn(b"APT_MIRROR_INVALID", rejected.stderr)

    def test_both_stages_and_builder_preserve_official_checksum_defaults(self) -> None:
        station = STATION_DOCKERFILE.read_text()
        self.assertEqual(station.count("ARG APT_MIRROR="), 2)
        self.assertEqual(station.count('sh /tmp/configure-apt-mirror.sh "${APT_MIRROR}"'), 2)
        for dockerfile in [STATION_DOCKERFILE, BUILDER_DOCKERFILE]:
            content = dockerfile.read_text()
            self.assertIn("ARG GO_TARBALL_MIRROR=https://go.dev/dl", content)
            self.assertIn("ARG GOPROXY=https://proxy.golang.org,direct", content)
            self.assertIn("ARG GOSUMDB=sum.golang.org", content)
            self.assertIn("ARG GONOSUMCHECK=\n", content)
            self.assertNotIn("ENV GOSUMDB=off", content)
            self.assertNotIn("mirrors.tuna", content)

    def test_every_compose_consumer_forwards_the_same_override_keys(self) -> None:
        for name in ["tooling/docker/compose.yml",
                     "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml",
                     "tooling/acceptance/runtime/station-access-dual-relay.compose.yml"]:
            lines = (ROOT / name).read_text().splitlines()
            builds = []
            for index, line in enumerate(lines):
                if line.strip() != "build:":
                    continue
                indentation = len(line) - len(line.lstrip())
                end = index + 1
                while end < len(lines):
                    candidate = lines[end]
                    if candidate.strip() and len(candidate) - len(candidate.lstrip()) <= indentation:
                        break
                    end += 1
                builds.append("\n".join(lines[index:end]))
            self.assertTrue(builds)
            for build in builds:
                for key in ["APT_MIRROR", "GO_TARBALL_MIRROR", "GOPROXY", "GOSUMDB", "GONOSUMCHECK"]:
                    self.assertIn(f"{key}: ${{{key}:-", build)

    def test_internal_acceptance_consumers_declare_restricted_network_defaults(self) -> None:
        for name in [
            "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml",
            "tooling/acceptance/runtime/station-access-dual-relay.compose.yml",
        ]:
            content = (ROOT / name).read_text()
            self.assertIn("APT_MIRROR: ${APT_MIRROR:-https://mirrors.aliyun.com}", content)
            self.assertIn("GO_TARBALL_MIRROR: ${GO_TARBALL_MIRROR:-https://mirrors.aliyun.com/golang}", content)
            self.assertIn("GOPROXY: ${GOPROXY:-https://goproxy.cn,direct}", content)
            self.assertIn("GOSUMDB: ${GOSUMDB:-off}", content)
            self.assertIn("GONOSUMCHECK: ${GONOSUMCHECK:-*}", content)

    def test_remote_builder_cache_ignores_ambient_mirror_policy(self) -> None:
        content = (ROOT / "tooling/docker/warm-builder-cache.sh").read_text()
        self.assertIn(
            "unset APT_MIRROR GO_TARBALL_MIRROR GOPROXY GOSUMDB GONOSUMCHECK",
            content,
        )
        self.assertIn(': "${APT_MIRROR:=https://mirrors.aliyun.com}"', content)
        self.assertIn(': "${GOPROXY:=https://goproxy.cn,direct}"', content)
        self.assertIn(': "${GOSUMDB:=off}"', content)

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

    def test_distribution_dashboard_credentials_override_development_defaults(self) -> None:
        entrypoint = ENTRYPOINT.read_text()
        compose = USER_COMPOSE.read_text()
        self.assertIn(
            'if [ "$PEERS_NODE_ROLE" = "station" ] &&',
            entrypoint,
        )
        self.assertIn("/app/conf/dashboard.docker.yml", entrypoint)
        self.assertIn("jwt_secret: ${PEERS_DASHBOARD_JWT_SECRET}", entrypoint)
        self.assertIn("password: ${PEERS_DASHBOARD_PASSWORD}", entrypoint)
        self.assertIn("dashboard.docker.yml store.docker.yml", entrypoint)
        for key in [
            "PEERS_DASHBOARD_USERNAME",
            "PEERS_DASHBOARD_PASSWORD",
            "PEERS_DASHBOARD_JWT_SECRET",
        ]:
            self.assertIn(f"{key}: ${{{key}:?", compose)
        self.assertNotIn("password: peers", compose)


if __name__ == "__main__":
    unittest.main()
