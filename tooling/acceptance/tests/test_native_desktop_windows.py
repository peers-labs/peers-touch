from __future__ import annotations

import ast
import base64
import json
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import (
    RUNTIME_CELLS_DIR,
    RuntimeCellContract,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.provisioners.native_desktop_windows import (
    NativeDesktopWindowsProvisioner,
    WindowsCellProfile,
    _bmp_geometry,
    _json_output,
)
from tooling.acceptance.transports.ssh import RemotePlatform


WINDOWS_PROVISIONER_PATH = (
    Path(__file__).parents[1]
    / "provisioners"
    / "native_desktop_windows.py"
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


class WindowsCellProfileTest(unittest.TestCase):
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
                        "PT_ACCEPTANCE_CELL_VSDEVCMD=C:/BuildTools/VsDevCmd.bat",
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
            perl_path="C:/Git/usr/bin/perl.exe",
            protoc_path="C:/protobuf/bin/protoc.exe",
            webdriver_port=4645,
            gateway_port=3230,
        )
        with self.assertRaisesRegex(ProvisioningError, "relative"):
            profile.validate()


class WindowsProvisionerContractTest(unittest.TestCase):
    def test_bmp_geometry_uses_interactive_adapter_capture(self) -> None:
        content = bytearray(26)
        content[:2] = b"BM"
        struct.pack_into("<ii", content, 18, 1696, 912)

        self.assertEqual(
            _bmp_geometry(base64.b64encode(content).decode("ascii")),
            (1696, 912),
        )

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
        self.assertIn('set "OPENSSL_SRC_PERL=', source)
        self.assertIn('set "PROTOC=', source)
        self.assertNotIn('set "PATH={perl_directory}', source)
        self.assertNotIn("class SshTransport", source)
        self.assertNotIn("class SourceSyncRequest", source)

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
