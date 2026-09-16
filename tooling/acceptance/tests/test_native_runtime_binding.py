from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core import (
    AppLaunchMetadata,
    BindingProofRecord,
    ClientRuntimeIdentity,
)
from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native.base import MouseAction, NativeKey
from tooling.acceptance.drivers.native.runtime import (
    LinuxNativeDesktopRuntimeBinding,
    LocalMacOSRuntimeBinding,
    WindowsNativeDesktopRuntimeBinding,
    resolve_native_desktop_runtime,
)
from tooling.acceptance.drivers.tauri import (
    MakeDesktopLauncher,
    ProvisionedTauriLauncher,
    TauriSession,
)


class SyntheticRemoteNativeLifecycle:
    def __init__(self, staged_path: str) -> None:
        self.staged_path = staged_path
        self.calls: list[tuple[str, object]] = []
        self.released_endpoints: list[str] = []

    def validate_binding(self, gate_id: str, source_commit: str) -> None:
        self.calls.append(("validate_binding", (gate_id, source_commit)))

    def launch_actor(
        self,
        actor: str,
        client_spec: dict[str, object],
        environment: dict[str, str],
    ) -> ProvisionedTauriLauncher:
        self.calls.append(
            ("launch_actor", (actor, client_spec, environment))
        )
        return ProvisionedTauriLauncher(
            AppLaunchMetadata(
                webdriver_host="127.0.0.1",
                webdriver_port=int(client_spec["webdriver_port"]),
                gateway_port=int(client_spec["gateway_port"]),
                profile=str(client_spec["profile"]),
                storage_root=str(client_spec["storage_root"]),
                process_id=712,
            )
        )

    def expose_orchestrator_endpoint(
        self,
        endpoint_id: str,
        url: str,
    ) -> dict[str, object]:
        self.calls.append(("expose_orchestrator_endpoint", (endpoint_id, url)))
        return {
            "endpointId": endpoint_id,
            "url": "http://127.0.0.1:40123/proxy",
        }

    def release_endpoint(self, endpoint_id: str) -> dict[str, object]:
        self.released_endpoints.append(endpoint_id)
        return {"endpointId": endpoint_id, "released": True}

    def endpoint_cleanup_audit(self) -> dict[str, object]:
        return {"endpointsReleased": True}

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": "runtime-cell:synthetic:desktop.exe",
            "sha256": "a" * 64,
            "sourceCommit": "source-commit",
        }

    def runtime_identity(self) -> dict[str, object]:
        return {"artifactKind": "acceptance-runtime-cell-manifest"}

    def stage_actor_file(self, actor: str, source: Path) -> str:
        self.calls.append(("stage_actor_file", (actor, source)))
        return self.staged_path

    def actor_file_sha256(self, actor: str, path: str) -> str:
        self.calls.append(("actor_file_sha256", (actor, path)))
        return "b" * 64

    def clone_actor_storage(
        self,
        source_actor: str,
        target_actor: str,
        relative_path: str,
    ) -> None:
        self.calls.append(
            (
                "clone_actor_storage",
                (source_actor, target_actor, relative_path),
            )
        )

    def execute_adapter(
        self,
        operation: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append(("execute_adapter", (operation, payload)))
        if operation == "capture_screenshot":
            return {
                "content": base64.b64encode(b"bitmap").decode("ascii"),
            }
        if operation == "read_clipboard":
            return {
                "content": base64.b64encode(b"clipboard").decode("ascii"),
            }
        if operation in {
            "activate_process",
            "focused_control",
            "reveal_file_chooser_location_to_process",
            "select_file_chooser_path_to_process",
        }:
            return {
                "kind": (
                    "text-field"
                    if operation in {
                        "reveal_file_chooser_location_to_process",
                        "select_file_chooser_path_to_process",
                    }
                    else "window"
                ),
                "actualFrontmostPid": payload["processId"],
                "frontmost": True,
            }
        return {}

    def actor_cleanup_audit(self) -> dict[str, object]:
        return {
            "processesReleased": True,
            "storageReleased": True,
        }


class RemoteNativeDesktopRuntimeBindingTest(unittest.TestCase):
    @staticmethod
    def runtime_manifest() -> dict[str, object]:
        return {
            "environmentId": "native-tauri-embedded-webdriver",
            "gateId": "chat-native",
            "runId": "provisioning-run",
            "services": {
                "station-four": {
                    "kind": "station",
                    "endpoint": "http://station.example",
                    "runtimeIdentity": "station-peer-four",
                    "attestationArtifact": {
                        "artifactKind": "acceptance-artifact-ref",
                        "workspaceId": "workspace",
                        "gateId": "chat-native",
                        "runId": "evidence-run",
                        "path": "runtime/services/station-four/attestation.json",
                        "sha256": "a" * 64,
                        "mediaType": "application/json",
                    },
                }
            },
            "clients": [
                {
                    "id": "alice",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "webdriver_port": 4445,
                    "gateway_port": 18081,
                    "profile": "alice",
                    "storage_root": "/workspace/run/actors/alice/storage",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-four",
                            "required_kind": "station",
                        }
                    },
                }
            ],
        }

    def test_windows_binding_delegates_to_platform_neutral_lifecycle(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle(
            r"C:\acceptance\actors\alice\fixture.png"
        )
        binding = WindowsNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )

        self.assertEqual(binding.cell_id, "desktop-windows-native")
        self.assertEqual(binding.native_adapter.platform, "win32")
        self.assertEqual(
            lifecycle.calls[0],
            ("validate_binding", ("chat-native", "source-commit")),
        )

        binding.native_adapter.activate_process(712)
        binding.native_adapter.post_mouse(
            (MouseAction.MOVE,),
            (14.5, 28.0),
        )
        binding.native_adapter.post_mouse_to_process(
            712,
            (MouseAction.MOVE, MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (18.0, 32.5),
        )
        binding.native_adapter.post_key(NativeKey.ENTER, text="value")
        binding.native_adapter.post_key_to_process(
            712,
            NativeKey.ENTER,
            private_source=True,
        )
        binding.native_adapter.post_key_sequence_to_process(
            712,
            (NativeKey.ENTER, NativeKey.TAB, NativeKey.ENTER),
            interval_seconds=0.2,
            private_source=True,
        )
        revealed_control = (
            binding.native_adapter.reveal_file_chooser_location_to_process(712)
        )
        path_control = binding.native_adapter.select_file_chooser_path_to_process(
            712,
            r"C:\acceptance\fixture.png",
        )
        activated_control = binding.native_adapter.activate_and_focused_control(712)
        control = binding.native_adapter.focused_control(712)
        self.assertIsNotNone(revealed_control)
        self.assertEqual(revealed_control.kind, "text-field")
        self.assertIsNotNone(path_control)
        self.assertEqual(path_control.kind, "text-field")
        self.assertTrue(activated_control.frontmost)
        self.assertTrue(control.frontmost)
        self.assertEqual(control.actual_frontmost_pid, 712)
        self.assertIn(
            (
                "execute_adapter",
                (
                    "post_key_to_process",
                    {
                        "processId": 712,
                        "key": "enter",
                        "modifiers": [],
                        "text": "",
                        "privateSource": True,
                    },
                ),
            ),
            lifecycle.calls,
        )
        self.assertIn(
            (
                "execute_adapter",
                (
                    "post_mouse_to_process",
                    {
                        "processId": 712,
                        "actions": ["move", "left-down", "left-up"],
                        "point": [18.0, 32.5],
                    },
                ),
            ),
            lifecycle.calls,
        )
        self.assertIn(
            (
                "execute_adapter",
                (
                    "reveal_file_chooser_location_to_process",
                    {"processId": 712},
                ),
            ),
            lifecycle.calls,
        )
        self.assertIn(
            (
                "execute_adapter",
                (
                    "select_file_chooser_path_to_process",
                    {
                        "processId": 712,
                        "path": r"C:\acceptance\fixture.png",
                    },
                ),
            ),
            lifecycle.calls,
        )
        self.assertIn(
            (
                "execute_adapter",
                (
                    "post_key_sequence_to_process",
                    {
                        "processId": 712,
                        "keys": ["enter", "tab", "enter"],
                        "intervalSeconds": 0.2,
                        "privateSource": True,
                    },
                ),
            ),
            lifecycle.calls,
        )

        with tempfile.TemporaryDirectory() as directory:
            screenshot = Path(directory) / "native.bmp"
            binding.native_adapter.capture_screenshot(screenshot)
            self.assertEqual(screenshot.read_bytes(), b"bitmap")
        self.assertEqual(binding.native_adapter.read_clipboard(), b"clipboard")

    def test_windows_binding_accepts_drive_absolute_remote_paths(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle(
            r"C:\acceptance\actors\alice\fixture.png"
        )
        binding = WindowsNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )

        staged = binding.stage_native_file("alice", Path("fixture.png"))

        self.assertEqual(
            str(staged),
            r"C:\acceptance\actors\alice\fixture.png",
        )
        self.assertEqual(
            binding.native_file_sha256("alice", staged),
            "b" * 64,
        )

    def test_windows_clipboard_write_retries_one_broker_failure(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle(
            r"C:\acceptance\actors\alice\fixture.png"
        )
        lifecycle.execute_adapter = Mock(
            side_effect=[DriverError("broker timeout"), {}],
        )
        binding = WindowsNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )

        binding.native_adapter.write_clipboard(b"replacement")

        self.assertEqual(lifecycle.execute_adapter.call_count, 2)
        lifecycle.execute_adapter.assert_called_with(
            "write_clipboard",
            {
                "content": base64.b64encode(b"replacement").decode("ascii"),
            },
        )

    def test_remote_binding_delegates_session_endpoint_and_cleanup(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle(
            "/workspace/run/actors/alice/fixture.png"
        )
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )
        client_spec = {
            "webdriver_port": 4445,
            "gateway_port": 18081,
            "profile": "alice",
            "storage_root": "/workspace/run/actors/alice/storage",
        }

        session = binding._create_session(
            "alice",
            client_spec,
            {"PEERS_STATION_URL": "http://station.example"},
        )
        binding.set_runtime_manifest(self.runtime_manifest())
        handle = binding.create_transport_override(
            "alice",
            "station",
            "http://127.0.0.1:39000/proxy"
        )
        binding.clone_actor_storage(
            "alice",
            client_spec,
            "alice-restarted",
            client_spec,
            "profiles/alice",
        )
        cleanup = binding.finalize_cleanup([session], {"alice": client_spec})

        self.assertEqual(session.process_id, 712)
        self.assertFalse(hasattr(handle, "url"))
        self.assertEqual(
            lifecycle.released_endpoints,
            ["orchestrator-endpoint-1"],
        )
        self.assertTrue(cleanup["processesReleased"])
        self.assertTrue(cleanup["endpointsReleased"])
        self.assertEqual(cleanup["cleanupErrors"], [])

    def test_bound_session_launches_observes_and_accumulates_proof(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle("/tmp/fixture.png")
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )
        binding.set_runtime_manifest(self.runtime_manifest())
        proof = BindingProofRecord(
            evidence_run_id="evidence-run",
            provisioning_run_id="provisioning-run",
            environment_id="native-tauri-embedded-webdriver",
            gate_id="chat-native",
            client_id="alice",
            binding_role="station",
            declared_service_id="station-four",
            launch_generation=1,
            service_attestation_ref={
                "artifactKind": "acceptance-artifact-ref",
                "sha256": "a" * 64,
            },
            service_attestation_digest="a" * 64,
            client_runtime_identity=ClientRuntimeIdentity(
                runtime="native-tauri",
                instance_id="alice-generation-1",
                identity_digest="b" * 64,
            ),
            observed_runtime_identity="station-peer-four",
            captured_at="2026-09-03T00:00:00+00:00",
            proof_mechanism="native-tauri-peer-id-check",
            verifier_id="core-client-binding",
            verifier_source_digest="c" * 64,
        )
        reference = {
            "artifactKind": "acceptance-artifact-ref",
            "path": "runtime/client-bindings/alice/generation-1/station.json",
        }

        with (
            patch.object(TauriSession, "start"),
            patch.object(TauriSession, "wait_for_acceptance_harness"),
            patch.object(
                binding,
                "_configure_session_station",
            ) as configure,
            patch.object(
                binding,
                "_observe_live_service_identity",
                return_value="station-peer-four",
            ) as observe,
            patch(
                "tooling.acceptance.drivers.native.runtime."
                "persist_client_binding_observation",
                return_value=(proof, reference),
            ) as persist,
        ):
            session = binding.create_bound_session("alice")

        self.assertIsNotNone(session)
        configure.assert_called_once_with(session, "http://station.example")
        observe.assert_called_once()
        persist.assert_called_once()
        self.assertEqual(binding.proof_refs(), (reference,))
        launch_environment = lifecycle.calls[-1][1][2]
        self.assertNotIn("PEERS_STATION_URL", launch_environment)

    def test_bound_session_uses_client_id_for_same_actor_devices(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle("/tmp/fixture.png")
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )
        manifest = self.runtime_manifest()
        client = manifest["clients"][0]
        client["id"] = "alice2"
        client["actor"] = "alice"
        binding.set_runtime_manifest(manifest)

        with (
            patch.object(TauriSession, "start"),
            patch.object(TauriSession, "wait_for_acceptance_harness"),
            patch.object(binding, "_configure_session_station"),
            patch.object(
                binding,
                "_observe_live_service_identity",
                return_value="station-peer-four",
            ),
            patch(
                "tooling.acceptance.drivers.native.runtime."
                "persist_client_binding_observation",
                return_value=(object(), {}),
            ),
        ):
            binding.create_bound_session("alice2")

        launch_call = next(
            call for call in lifecycle.calls if call[0] == "launch_actor"
        )
        self.assertEqual(launch_call[1][0], "alice2")
        self.assertEqual(launch_call[1][1]["actor"], "alice")

    def test_linux_binding_keeps_posix_absolute_path_validation(self) -> None:
        lifecycle = SyntheticRemoteNativeLifecycle("relative/fixture.png")
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native",
            "source-commit",
            lifecycle,
        )

        with self.assertRaisesRegex(
            DriverError,
            "desktop-linux-native returned a relative staged file path",
        ):
            binding.stage_native_file("alice", Path("fixture.png"))

    def test_resolver_uses_registered_lifecycle_for_remote_platforms(self) -> None:
        linux_lifecycle = SyntheticRemoteNativeLifecycle("/tmp/fixture.png")
        windows_lifecycle = SyntheticRemoteNativeLifecycle(
            r"C:\acceptance\fixture.png"
        )
        lifecycles = {
            "desktop-linux-native": linux_lifecycle,
            "desktop-windows-native": windows_lifecycle,
        }

        with patch(
            "tooling.acceptance.provisioners.get_runtime_cell_lifecycle",
            side_effect=lifecycles.__getitem__,
        ) as get_lifecycle:
            linux = resolve_native_desktop_runtime(
                "desktop-linux-native",
                gate_id="chat-native",
                source_commit="source-commit",
            )
            windows = resolve_native_desktop_runtime(
                "desktop-windows-native",
                gate_id="chat-native",
                source_commit="source-commit",
            )

        self.assertIsInstance(linux, LinuxNativeDesktopRuntimeBinding)
        self.assertIsInstance(windows, WindowsNativeDesktopRuntimeBinding)
        self.assertEqual(
            [call.args[0] for call in get_lifecycle.call_args_list],
            ["desktop-linux-native", "desktop-windows-native"],
        )

    def test_macos_development_binding_launches_through_make(self) -> None:
        client = {
            "worktree": str(Path.cwd()),
            "webdriver_port": 4447,
            "gateway_port": 3140,
            "renderer_port": 3410,
            "profile": "chat-native-alice",
            "storage_root": "/tmp/chat-native-alice",
        }
        with patch.dict(
            "os.environ",
            {"PT_ACCEPTANCE_NATIVE_DEV": "1"},
        ):
            binding = LocalMacOSRuntimeBinding()
            session = binding._create_session(
                "alice",
                client,
                {
                    "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                    "PT_ACCEPTANCE_WINDOW_COUNT": "2",
                },
            )

        self.assertIsInstance(session.launcher, MakeDesktopLauncher)
        self.assertEqual(session.launcher.worktree, Path.cwd())
        self.assertEqual(session.launcher.port, 4447)
        self.assertEqual(session.launcher.gateway_port, 3140)
        self.assertEqual(session.launcher.renderer_port, 3410)
        self.assertEqual(session.launcher.profile, "chat-native-alice")

    def test_make_launcher_uses_allocated_ports_after_managed_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "peers-group-chat"
            active = root / ".local" / "dev" / "active"
            profiles = root / ".local" / "dev" / "profiles"
            active.mkdir(parents=True)
            profiles.mkdir(parents=True)
            (root / "Makefile").write_text("desktop-stop:\n\t@true\n", encoding="utf-8")
            profile = profiles / "four.env"
            profile.write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=four",
                        "PT_DEV_SLOT=3",
                        "PT_DESKTOP_APP_GATEWAY_PORT=3140",
                        "PT_DESKTOP_APP_WEB_PORT=3410",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            (active / "peers-group-chat.env").symlink_to(
                Path("..") / "profiles" / "four.env"
            )
            launcher = MakeDesktopLauncher(
                worktree=root,
                port=4476,
                gateway_port=3141,
                renderer_port=3411,
                profile="four-app",
                storage_root=str(root / "storage"),
            )
            process = Mock(pid=1234)
            process.poll.return_value = 0
            response = Mock()

            with patch(
                "tooling.acceptance.drivers.tauri.subprocess.Popen",
                return_value=process,
            ), patch(
                "tooling.acceptance.drivers.tauri.urllib.request.urlopen",
                return_value=response,
            ), patch.object(
                launcher,
                "_managed_process_pid",
                return_value=5678,
            ), patch.object(
                launcher,
                "_owned_listener_pid",
                return_value=9012,
            ) as owned_listener:
                metadata = launcher.start()

            self.assertEqual(metadata.process_id, 9012)
            owned_listener.assert_called_once_with(4476, 5678)
            runtime_profile = Path(
                launcher._launch_environment["PT_DEV_PROFILE_FILE"]
            )
            rendered = runtime_profile.read_text(encoding="utf-8")
            self.assertIn("PT_DEV_PROFILE=four-app", rendered)
            self.assertIn("PT_DESKTOP_APP_GATEWAY_PORT=3141", rendered)
            self.assertIn("PT_DESKTOP_APP_WEB_PORT=3411", rendered)
            self.assertEqual(
                launcher._launch_environment[
                    "PT_DEV_PROFILE_FILE_AUTHORITY"
                ],
                "acceptance-runtime-manifest",
            )
            self.assertEqual(
                launcher._launch_environment["PT_DESKTOP_E2E"],
                "true",
            )

            stopped = Mock(returncode=0, stdout="", stderr="")
            runtime_profile_root = runtime_profile.parent
            with patch(
                "tooling.acceptance.drivers.tauri.subprocess.run",
                return_value=stopped,
            ) as run:
                launcher.stop()

            self.assertIn(
                ["make", "desktop-stop"],
                [call.args[0] for call in run.call_args_list],
            )
            self.assertFalse(runtime_profile_root.exists())

    def test_macos_cleanup_retains_persistent_client_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ephemeral = root / "ephemeral"
            persistent = root / "persistent"
            ephemeral.mkdir()
            persistent.mkdir()
            (ephemeral / "state").write_text("temporary", encoding="utf-8")
            (persistent / "state").write_text("durable", encoding="utf-8")
            with patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_NATIVE_DEV": "1"},
            ):
                binding = LocalMacOSRuntimeBinding()
            client_specs = {
                "alice": {
                    "webdriver_port": 4445,
                    "gateway_port": 3140,
                    "renderer_port": 3410,
                    "storage_root": str(persistent),
                    "storage_lifecycle": "persistent",
                },
                "bob": {
                    "webdriver_port": 4446,
                    "gateway_port": 3141,
                    "renderer_port": 3411,
                    "storage_root": str(ephemeral),
                    "storage_lifecycle": "ephemeral",
                },
            }

            with patch(
                "tooling.acceptance.drivers.native.runtime._wait_for",
                return_value=True,
            ):
                cleanup = binding.finalize_cleanup([], client_specs)

            self.assertTrue(persistent.is_dir())
            self.assertEqual(
                (persistent / "state").read_text(encoding="utf-8"),
                "durable",
            )
            self.assertFalse(ephemeral.exists())
            self.assertTrue(cleanup["storageReleased"])
            self.assertTrue(cleanup["persistentStorageRetained"])
            self.assertEqual(
                cleanup["persistentStorageRoots"],
                [str(persistent)],
            )
            self.assertEqual(
                cleanup["releasedStorageRoots"],
                [str(ephemeral)],
            )

    def test_macos_cleanup_rejects_unknown_storage_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = Path(temp_dir) / "unknown"
            storage.mkdir()
            with patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_NATIVE_DEV": "1"},
            ):
                binding = LocalMacOSRuntimeBinding()
            client_specs = {
                "alice": {
                    "webdriver_port": 4445,
                    "gateway_port": 3140,
                    "renderer_port": 3410,
                    "storage_root": str(storage),
                    "storage_lifecycle": "mystery",
                },
            }

            with patch(
                "tooling.acceptance.drivers.native.runtime._wait_for",
                return_value=True,
            ):
                cleanup = binding.finalize_cleanup([], client_specs)

            self.assertTrue(storage.is_dir())
            self.assertFalse(cleanup["storageReleased"])
            self.assertIn(
                "invalid runtime client storage_lifecycle",
                cleanup["storageErrors"][0]["error"],
            )

    def test_macos_development_binding_attests_running_make_binary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            binary = Path(temp_dir) / "peers-touch-desktop"
            binary.write_bytes(b"native-binary")
            launcher = MakeDesktopLauncher(
                worktree=Path.cwd(),
                port=4447,
                gateway_port=3140,
                renderer_port=3410,
                profile="four",
                storage_root=str(Path(temp_dir) / "storage"),
            )
            session = TauriSession(launcher)
            with patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_NATIVE_DEV": "1"},
            ):
                binding = LocalMacOSRuntimeBinding()
                binding._sessions_by_client["alice"] = session
                with patch.object(
                    launcher,
                    "runtime_binary_path",
                    return_value=binary,
                ):
                    identity = binding.binary_identity()

        self.assertEqual(identity["path"], str(binary))
        instances = json.loads(identity["instances"])
        self.assertEqual(
            instances,
            [
                {
                    "path": str(binary),
                    "sha256": hashlib.sha256(b"native-binary").hexdigest(),
                }
            ],
        )
        self.assertEqual(
            identity["sha256"],
            hashlib.sha256(
                json.dumps(
                    instances,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
