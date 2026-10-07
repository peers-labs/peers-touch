from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.core.source_sync import SourceSyncRequest
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.scripts.deploy.source_sync import _source_lease
from tooling.scripts.deploy.windows_runtime import (
    WindowsRuntimeConfig,
    _remote_runtime_script,
    execute,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOY_SCRIPT = REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"


def _write_environment(path: Path, *, platform: str = "windows") -> None:
    path.write_text(
        "\n".join(
            (
                "PT_DEPLOY_HOST=windows.example",
                "PT_DEPLOY_USER=administrator",
                "PT_DEPLOY_PATH=.peers-touch/deploy/sixwin-station/source",
                "PT_DEPLOY_RUNTIME_PATH=.peers-touch/runtime/sixwin-station",
                "PT_DEPLOY_ROLE=station",
                "PT_DEPLOY_PROFILE=sixwin",
                "PT_DEPLOY_SOURCE=direct",
                f"PT_DEPLOY_PLATFORM={platform}",
                "PT_DEPLOY_HTTP_PORT=18080",
                "PT_DEPLOY_HEALTH_PATH=/sub-oss/healthz",
                "PT_DEPLOY_PUBLIC_BASE_URL=http://10.36.3.187:18080",
                "PT_DEPLOY_TASK_NAME=PeersTouch-sixwin-station",
                "PT_DEPLOY_FIREWALL_REMOTE_ADDRESS=10.0.0.0/8",
                "",
            )
        ),
        encoding="utf-8",
    )


class SourceSyncPlatformTests(unittest.TestCase):
    def test_reviewed_environment_selects_windows_transport(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / "sixwin-station.env.example"
            _write_environment(environment)
            request = SourceSyncRequest.from_env_files(
                "sixwin-station",
                source_root=REPO_ROOT,
                environments_dir=root,
                central_environment_path=root / "git-server.env",
                environment_path=environment,
                branch="main",
            )

        self.assertEqual(request.remote_platform, RemotePlatform.WINDOWS)
        lease = _source_lease(request, "test-owner")
        self.assertEqual(lease.remote_platform, RemotePlatform.WINDOWS)
        self.assertEqual(
            lease.transport.target.remote_platform,
            RemotePlatform.WINDOWS,
        )

    def test_unknown_reviewed_platform_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / "sixwin-station.env.example"
            _write_environment(environment, platform="unknown")
            with self.assertRaisesRegex(
                ProvisioningError,
                "unsupported PT_DEPLOY_PLATFORM",
            ):
                SourceSyncRequest.from_env_files(
                    "sixwin-station",
                    source_root=REPO_ROOT,
                    environments_dir=root,
                    central_environment_path=root / "git-server.env",
                    environment_path=environment,
                    branch="main",
                )


class _FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[list[str], dict[str, object]]] = []

    def run_argv(
        self,
        argv: list[str],
        **kwargs: object,
    ) -> subprocess.CompletedProcess[str]:
        self.calls.append((argv, kwargs))
        return subprocess.CompletedProcess(
            args=argv,
            returncode=0,
            stdout='{"healthy": true, "role": "station"}\n',
            stderr="",
        )


class WindowsRuntimeTests(unittest.TestCase):
    def test_config_requires_reviewed_windows_platform(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "sixwin-station.env.example"
            _write_environment(environment, platform="posix")
            with self.assertRaisesRegex(
                ProvisioningError,
                "PT_DEPLOY_PLATFORM must be windows",
            ):
                WindowsRuntimeConfig.load("sixwin-station", environment)

    def test_execute_uses_windows_transport_protocol_and_exact_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "sixwin-station.env.example"
            _write_environment(environment)
            config = WindowsRuntimeConfig.load(
                "sixwin-station",
                environment,
            )
        transport = _FakeTransport()
        with (
            patch(
                "tooling.scripts.deploy.windows_runtime._git_output",
                return_value="a" * 40,
            ),
            patch(
                "tooling.scripts.deploy.windows_runtime._git_tree_digest",
                return_value="sha256:" + ("b" * 64),
            ),
        ):
            result = execute(
                "deploy",
                config,
                branch="feature",
                transport=transport,  # type: ignore[arg-type]
            )

        self.assertTrue(result["healthy"])
        argv, options = transport.calls[0]
        self.assertEqual(argv[:3], ["python", "-", "deploy"])
        self.assertIn('"sourceCommit": "aaaaaaaa', argv[3])
        self.assertIn('"sourceTreeDigest": "sha256:bbbb', argv[3])
        self.assertEqual(options["input_text"], _remote_runtime_script())

    def test_remote_runtime_owns_isolated_build_service_and_secrets(self) -> None:
        script = _remote_runtime_script()

        self.assertIn("runtime path must be isolated from source checkout", script)
        self.assertIn("sourceTreeDigest", script)
        self.assertIn("runtime build contaminated source checkout", script)
        self.assertIn("openssl", script)
        self.assertIn("icacls.exe", script)
        self.assertIn("schtasks.exe", script)
        self.assertIn('"SYSTEM"', script)
        self.assertIn("New-NetFirewallRule", script)
        self.assertNotIn("C:\\\\peers-touch", script)

    def test_deploy_entrypoint_dispatches_reviewed_windows_platform(self) -> None:
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('PT_DEPLOY_PLATFORM:-posix', source)
        self.assertIn('exec python3 "$WINDOWS_RUNTIME_SCRIPT"', source)
        self.assertIn('"$windows_action"', source)
        self.assertIn("stop)", source)


if __name__ == "__main__":
    unittest.main()
