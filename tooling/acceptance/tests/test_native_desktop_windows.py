from __future__ import annotations

import ast
import base64
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import Mock

from tooling.acceptance.core import (
    RUNTIME_CELLS_DIR,
    RuntimeCellContract,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.provisioners.native_desktop_windows import (
    NativeDesktopWindowsProvisioner,
    WindowsCellProfile,
    _json_output,
    _normalized_windows_path,
    _screenshot_probe_geometry,
    _windows_path_is_descendant,
    _windows_verbatim_path,
)
from tooling.acceptance.transports.ssh import RemotePlatform


WINDOWS_PROVISIONER_PATH = (
    Path(__file__).parents[1]
    / "provisioners"
    / "native_desktop_windows.py"
)
WINDOWS_DRIVER_PATH = (
    Path(__file__).parents[1]
    / "drivers"
    / "native"
    / "windows.py"
)
WINDOWS_BUILD_SCRIPT_PATH = (
    Path(__file__).parents[2]
    / "scripts"
    / "windows-desktop-build.ps1"
)


class _BrokerTransport:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.commands: list[tuple[str, ...]] = []

    def run_argv(
        self,
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        envelope = {"status": "OK", "result": self.result}
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(envelope) + "\n",
            stderr="",
        )


class _DigestTransport:
    def __init__(self) -> None:
        self.commands: list[tuple[str, ...]] = []

    def run_argv(
        self,
        command: tuple[str, ...],
        **_: object,
    ) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=("a" * 64) + "\n",
            stderr="",
        )


class WindowsCellProfileTest(unittest.TestCase):
    def test_windows_path_ownership_accepts_verbatim_descendant(self) -> None:
        root = (
            r"C:\Users\developer\AppData\Local\PeersTouch"
            r"\AcceptanceCells\desktop-windows-native\actors"
            r"\run-1\bob"
        )
        candidate = (
            r"\\?\C:\Users\developer\AppData\Local\PeersTouch"
            r"\AcceptanceCells\desktop-windows-native\actors"
            r"\run-1\bob\storage\attachment-cache\attachment-1"
        )

        self.assertEqual(
            _normalized_windows_path(candidate),
            Path(root, "storage", "attachment-cache", "attachment-1"),
        )
        self.assertTrue(_windows_path_is_descendant(candidate, root))
        self.assertEqual(_windows_verbatim_path(candidate), candidate)
        self.assertEqual(_windows_verbatim_path(root), rf"\\?\{root}")
        self.assertFalse(
            _windows_path_is_descendant(
                candidate,
                root.replace(r"\bob", r"\alice"),
            )
        )

    def test_actor_file_digest_reads_long_path_with_verbatim_prefix(self) -> None:
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        transport = _DigestTransport()
        provisioner.transport = transport
        provisioner._require_state = Mock(
            return_value={
                "brokerRoot": r"C:\runtime",
                "runId": "run-1",
            }
        )
        provisioner._active_actor = Mock(return_value="bob")
        path = (
            r"C:\runtime\actors\run-1\bob\storage"
            + (r"\long-segment" * 30)
            + r"\attachment-1"
        )

        self.assertEqual(provisioner.actor_file_sha256("bob", path), "a" * 64)
        self.assertIn(r"\\?\C:\runtime", transport.commands[0][-1])

    def test_provisioner_registry_imports_in_fresh_process(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from tooling.acceptance.provisioners import "
                    "get_runtime_cell_lifecycle; "
                    "assert callable(get_runtime_cell_lifecycle)"
                ),
            ],
            cwd=Path(__file__).parents[3],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)

    def setUp(self) -> None:
        self.contract = RuntimeCellContract.from_yaml(
            RUNTIME_CELLS_DIR / "desktop-windows-native.yaml"
        )

    def test_profile_loads_windows_lifecycle_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "acceptance-windows.env").write_text(
                "\n".join(
                    (
                        "PT_ACCEPTANCE_CELL_DEPLOY_ENV=acceptance-windows",
                        "PT_ACCEPTANCE_CELL_DESKTOP_USER=administrator",
                        "PT_ACCEPTANCE_CELL_RUNTIME_ROOT=AppData/Local/PT/Cells",
                        "PT_ACCEPTANCE_CELL_CARGO_TARGET_ROOT=pt-cache/windows",
                        "PT_ACCEPTANCE_CELL_VSDEVCMD=C:/BuildTools/VsDevCmd.bat",
                        "PT_ACCEPTANCE_CELL_WINDOWS_SDK_ROOT="
                        "C:/Program Files (x86)/Windows Kits/10",
                        "PT_ACCEPTANCE_CELL_WINDOWS_SDK_VERSION=10.0.26100.0",
                        "PT_ACCEPTANCE_CELL_PERL=C:/Git/usr/bin/perl.exe",
                        "PT_ACCEPTANCE_CELL_PROTOC=C:/protobuf/bin/protoc.exe",
                        "PT_ACCEPTANCE_CELL_WEBDRIVER_PORT=4645",
                        "PT_ACCEPTANCE_CELL_GATEWAY_PORT=3230",
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            profile = WindowsCellProfile.load(
                self.contract,
                profile_root=root,
            )

            self.assertEqual(profile.desktop_user, "administrator")
            self.assertEqual(
                profile.cargo_target_root,
                "pt-cache/windows",
            )
            self.assertEqual(profile.perl_path, "C:/Git/usr/bin/perl.exe")
            self.assertEqual(
                profile.protoc_path,
                "C:/protobuf/bin/protoc.exe",
            )
            self.assertEqual(profile.webdriver_port, 4645)
            self.assertEqual(profile.gateway_port, 3230)

    def test_profile_rejects_absolute_runtime_root(self) -> None:
        profile = WindowsCellProfile(
            name="acceptance-windows",
            deploy_environment="acceptance-windows",
            desktop_user="administrator",
            runtime_root="C:/shared/runtime",
            python_executable="python",
            vsdevcmd_path="C:/BuildTools/VsDevCmd.bat",
            windows_sdk_root="C:/Program Files (x86)/Windows Kits/10",
            windows_sdk_version="10.0.26100.0",
            perl_path="C:/Git/usr/bin/perl.exe",
            protoc_path="C:/protobuf/bin/protoc.exe",
            webdriver_port=4645,
            gateway_port=3230,
        )
        with self.assertRaisesRegex(ProvisioningError, "relative"):
            profile.validate()


class WindowsProvisionerContractTest(unittest.TestCase):
    def test_orchestrator_endpoint_uses_distinct_remote_port(self) -> None:
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        provisioner._endpoints = {}
        provisioner.transport = Mock()
        provisioner.transport.available_remote_port.return_value = 61234
        tunnel = Mock()
        tunnel.process_id = 4321
        provisioner.transport.start_reverse_forward.return_value = tunnel

        result = provisioner.expose_orchestrator_endpoint(
            "fault-proxy",
            "http://127.0.0.1:58057/fault",
        )

        provisioner.transport.start_reverse_forward.assert_called_once_with(
            local_port=58057,
            remote_port=61234,
        )
        self.assertEqual(result["url"], "http://127.0.0.1:61234/fault")
        self.assertEqual(result["tunnelPid"], 4321)

    def test_screenshot_probe_geometry_uses_validated_metadata(self) -> None:
        content = bytearray(128)
        content[:2] = b"BM"
        struct.pack_into("<ii", content, 18, 1696, 912)
        self.assertEqual(
            _screenshot_probe_geometry(
                {
                    "captured": True,
                    "byteLength": len(content),
                    "content": base64.b64encode(
                        zlib.compress(content)
                    ).decode("ascii"),
                    "contentEncoding": "zlib",
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            ),
            (1696, 912),
        )

    def test_screenshot_probe_geometry_rejects_incomplete_metadata(self) -> None:
        with self.assertRaisesRegex(ProvisioningError, "metadata"):
            _screenshot_probe_geometry(
                {
                    "captured": True,
                    "byteLength": 54,
                    "sha256": "a" * 64,
                    "width": 1696,
                    "height": 912,
                }
            )

    def test_screenshot_probe_geometry_rejects_digest_mismatch(self) -> None:
        content = bytearray(128)
        content[:2] = b"BM"
        struct.pack_into("<ii", content, 18, 1696, 912)
        with self.assertRaisesRegex(ProvisioningError, "payload"):
            _screenshot_probe_geometry(
                {
                    "captured": True,
                    "byteLength": len(content),
                    "content": base64.b64encode(
                        zlib.compress(content)
                    ).decode("ascii"),
                    "contentEncoding": "zlib",
                    "sha256": "a" * 64,
                }
            )

    def test_win32_adapter_uses_topmost_process_window(self) -> None:
        source = WINDOWS_DRIVER_PATH.read_text(encoding="utf-8")

        self.assertNotIn("windows[-1]", source)
        self.assertGreaterEqual(source.count("hwnd = windows[0]"), 2)

    def test_implements_remote_runtime_binding_surface(self) -> None:
        module = ast.parse(
            WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        )
        provisioner = next(
            node
            for node in module.body
            if isinstance(node, ast.ClassDef)
            and node.name == "NativeDesktopWindowsProvisioner"
        )
        implemented = {
            node.name
            for node in provisioner.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        expected = {
            "ready",
            "status",
            "logs",
            "stop",
            "validate_binding",
            "launch_actor",
            "expose_orchestrator_endpoint",
            "release_endpoint",
            "endpoint_cleanup_audit",
            "binary_identity",
            "runtime_identity",
            "stage_actor_file",
            "actor_file_sha256",
            "clone_actor_storage",
            "execute_adapter",
            "actor_cleanup_audit",
        }
        self.assertEqual(expected - implemented, set())

    def test_source_uses_existing_transport_and_source_contracts(self) -> None:
        source = WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        self.assertIn("SourceSyncRequest.from_env_files(", source)
        self.assertIn("RemoteSourceSynchronizer(request).preflight()", source)
        self.assertIn("RemoteGitSourceLease(", source)
        self.assertIn("source_lease.acquire()", source)
        self.assertIn("remote_platform=RemotePlatform.WINDOWS", source)
        self.assertIn("config core.longpaths true", source)
        self.assertIn("_BUILD_SCRIPT_RELATIVE_PATH", source)
        self.assertIn('"powershell.exe"', source)
        self.assertNotIn("class SshTransport", source)
        self.assertNotIn("class SourceSyncRequest", source)

    def test_build_script_preserves_toolchain_environment(self) -> None:
        source = WINDOWS_BUILD_SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn("VsDevCmd", source)
        self.assertIn("$sdkInclude + $env:INCLUDE", source)
        self.assertIn("$sdkLib + $env:LIB", source)
        self.assertIn("$env:OPENSSL_SRC_PERL = $PerlPath", source)
        self.assertIn("$env:PROTOC = $ProtocPath", source)
        self.assertIn("$env:CARGO_TARGET_DIR = $CargoTargetRoot", source)
        self.assertIn(
            '$env:CARGO_HOME = Join-Path $CargoTargetRoot "cargo-home"',
            source,
        )
        self.assertIn("Split-Path -Parent $ProtocPath", source)
        self.assertIn("protoc-gen-es.CMD", source)
        self.assertIn('Get-ChildItem (', source)
        self.assertIn('-Recurse -Filter "*.proto"', source)
        self.assertIn('"--es_opt=target=ts"', source)
        install = source.index(
            'Invoke-NativeCommand "pnpm.cmd" @("install", "--frozen-lockfile")'
        )
        generate = source.index(
            "Invoke-NativeCommand $ProtocPath"
        )
        desktop_build = source.index(
            'Invoke-NativeCommand "pnpm.cmd" '
            '@("--dir", "apps/desktop", "run", "build")'
        )
        self.assertLess(install, generate)
        self.assertLess(generate, desktop_build)
        self.assertIn("$env:VITE_ACCEPTANCE_HARNESS = \"1\"", source)
        self.assertIn("$env:TAURI_CONFIG =", source)

    def test_interactive_gate_runs_after_source_and_build_preflight(self) -> None:
        source = WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        ready = source[source.index("    def ready("):source.index("    def status(")]

        self.assertLess(ready.index("self._sync_source("), ready.index("self._build_binary("))
        self.assertLess(
            ready.index("self._build_binary("),
            ready.index("self._require_interactive_desktop("),
        )
        self.assertLess(
            ready.index("self._require_interactive_desktop("),
            ready.index('self._broker('),
        )

    def test_interactive_gate_fails_closed_without_desktop_session(self) -> None:
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        provisioner.contract = RuntimeCellContract.from_yaml(
            RUNTIME_CELLS_DIR / "desktop-windows-native.yaml"
        )

        with self.assertRaises(BlockedError):
            provisioner._require_interactive_desktop(
                {
                    "interactive": False,
                    "width": 0,
                    "height": 0,
                }
            )

    def test_probe_uses_atomic_activation_focus_observation(self) -> None:
        source = WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        probe = source[
            source.index("    def _probe_adapter("):
            source.index("    def _manifest(")
        ]

        self.assertIn(
            'screenshot = self.execute_adapter("probe_screenshot", {})',
            probe,
        )
        self.assertNotIn(
            'screenshot = self.execute_adapter("capture_screenshot", {})',
            probe,
        )
        self.assertIn(
            'control = self.execute_adapter(\n'
            '                "activate_process",',
            probe,
        )
        self.assertNotIn(
            'self.execute_adapter(\n'
            '                "focused_control",',
            probe,
        )

    def test_cleanup_audits_actor_results_before_releasing_source_lease(
        self,
    ) -> None:
        source = WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        release_actor = source[
            source.index("    def release_actor("):
            source.index("    def actor_is_alive(")
        ]
        stop = source[
            source.index("    def stop("):
            source.index("    def _clean_remote_source(")
        ]

        for field in (
            "processStopped",
            "taskReleased",
            "portsReleased",
            "storageReleased",
        ):
            self.assertIn(f'"{field}"', release_actor)
        self.assertLess(
            stop.index('self._broker_from_state(state, "cleanup", {})'),
            stop.index("self._clean_remote_source("),
        )
        self.assertLess(
            stop.index("self._clean_remote_source("),
            stop.index("self._release_source_lease()"),
        )
        self.assertIn(
            'if cleanup.get("clean") is not True:',
            stop,
        )
        self.assertIn(
            'failures.append("remote broker reported clean=false")',
            stop,
        )

    def test_broker_request_contains_run_actor_and_is_base64_json(self) -> None:
        transport = _BrokerTransport(
            {
                "actor": "alice",
                "processId": 120,
                "storageRoot": "C:\\runtime\\alice",
            }
        )
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        provisioner.profile = WindowsCellProfile(
            name="acceptance-windows",
            deploy_environment="acceptance-windows",
            desktop_user="administrator",
            runtime_root="AppData/Local/PT/Cells",
            python_executable="python",
            vsdevcmd_path="C:/BuildTools/VsDevCmd.bat",
            windows_sdk_root="C:/Program Files (x86)/Windows Kits/10",
            windows_sdk_version="10.0.26100.0",
            perl_path="C:/Git/usr/bin/perl.exe",
            protoc_path="C:/protobuf/bin/protoc.exe",
            webdriver_port=4645,
            gateway_port=3230,
        )
        provisioner.transport = transport

        result = provisioner._broker(
            "C:\\repo\\windows_desktop_broker.py",
            "C:\\runtime\\run-1",
            "actor-status",
            {"runId": "run-1", "actor": "alice"},
        )

        self.assertEqual(result["processId"], 120)
        command = transport.commands[0]
        self.assertEqual(command[:2], ("python", "C:\\repo\\windows_desktop_broker.py"))
        request = json.loads(
            base64.b64decode(command[-1], validate=True)
        )
        self.assertEqual(request["operation"], "actor-status")
        self.assertEqual(request["runId"], "run-1")
        self.assertEqual(request["actor"], "alice")
        self.assertEqual(request["desktopUser"], "administrator")

    def test_remote_actor_storage_is_scoped_by_runtime_run(self) -> None:
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        state = {
            "brokerRoot": "C:\\runtime",
            "runId": "run-1",
            "binaryPath": "C:\\runtime\\desktop.exe",
        }
        provisioner._require_state = Mock(return_value=state)
        provisioner._broker_from_state = Mock(
            return_value={"actor": "alice", "processId": 42}
        )

        provisioner._launch_remote_actor(
            actor="alice",
            webdriver_port=4645,
            gateway_port=3230,
            profile="chat-native-alice",
            environment={},
        )

        payload = provisioner._broker_from_state.call_args.args[2]
        self.assertEqual(
            payload["storageRoot"],
            "C:\\runtime\\state\\run-1\\alice",
        )
        self.assertEqual(
            payload["logPath"],
            "C:\\runtime\\actors\\run-1\\alice\\logs\\desktop.log",
        )

    def test_actor_ports_are_stable_distinct_and_actor_scoped(self) -> None:
        provisioner = NativeDesktopWindowsProvisioner.__new__(
            NativeDesktopWindowsProvisioner
        )
        provisioner.profile = WindowsCellProfile(
            name="acceptance-windows",
            deploy_environment="acceptance-windows",
            desktop_user="administrator",
            runtime_root="AppData/Local/PT/Cells",
            python_executable="python",
            vsdevcmd_path="C:/BuildTools/VsDevCmd.bat",
            windows_sdk_root="C:/Program Files (x86)/Windows Kits/10",
            windows_sdk_version="10.0.26100.0",
            perl_path="C:/Git/usr/bin/perl.exe",
            protoc_path="C:/protobuf/bin/protoc.exe",
            webdriver_port=4645,
            gateway_port=3230,
        )
        provisioner._actor_slots = {}

        alice = provisioner._actor_remote_ports("alice")
        bob = provisioner._actor_remote_ports("bob")

        self.assertEqual(alice, (4645, 3230))
        self.assertEqual(bob, (4646, 3231))
        self.assertEqual(
            provisioner._actor_remote_ports("alice"),
            alice,
        )

    def test_broker_error_envelope_fails_closed(self) -> None:
        completed = subprocess.CompletedProcess(
            ("python", "broker.py"),
            0,
            stdout='{"status":"ERROR","error":"no interactive session"}\n',
            stderr="",
        )
        with self.assertRaisesRegex(
            ProvisioningError,
            "no interactive session",
        ):
            _json_output(completed, "preflight")

    def test_windows_target_platform_is_explicit(self) -> None:
        self.assertEqual(RemotePlatform.WINDOWS.value, "windows")


if __name__ == "__main__":
    unittest.main()
