from __future__ import annotations

import argparse
import errno
import hashlib
import importlib.util
import io
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from tooling.acceptance.core import REPO_ROOT, RuntimeCellContract
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.provisioners.native_desktop_linux import (
    _BASE_IMAGE_DIGEST,
    _NATIVE_ADAPTER_PROBE_SCRIPT,
    LinuxCellProfile,
    NativeDesktopLinuxProvisioner,
    _digest,
    _stop_tunnel_process,
)


class SyntheticTunnel:
    def __init__(self, local_port: int) -> None:
        self.local_port = local_port
        self.stopped = False

    def is_alive(self) -> bool:
        return not self.stopped

    def failure_detail(self) -> dict[str, object] | None:
        return None

    def stop(self) -> None:
        self.stopped = True


IMAGE_ROOT = REPO_ROOT / "tooling" / "acceptance" / "images" / "desktop-linux"
CONTRACT_PATH = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "runtime-cells"
    / "desktop-linux-native.yaml"
)
REMOTE_CONTROL_PATH = IMAGE_ROOT / "remote_control.py"
REMOTE_CONTROL_SPEC = importlib.util.spec_from_file_location(
    "desktop_linux_remote_control",
    REMOTE_CONTROL_PATH,
)
assert REMOTE_CONTROL_SPEC is not None and REMOTE_CONTROL_SPEC.loader is not None
remote_control = importlib.util.module_from_spec(REMOTE_CONTROL_SPEC)
REMOTE_CONTROL_SPEC.loader.exec_module(remote_control)


class LinuxRuntimeCellContractTests(unittest.TestCase):
    def test_repository_contract_matches_linux_native_architecture(self) -> None:
        contract = RuntimeCellContract.from_yaml(CONTRACT_PATH)

        self.assertEqual(contract.cell_id, "desktop-linux-native")
        self.assertEqual(contract.platform, "linux")
        self.assertEqual(contract.display.session_type, "x11")
        self.assertEqual(contract.display.fixed_geometry, "1920x1080")
        self.assertTrue(contract.isolation.image_digest_required)
        self.assertEqual(contract.webdriver.bind, "127.0.0.1")
        self.assertEqual(contract.native_adapter.input, "x11-xtest")
        self.assertIn("gui-session-lease", contract.cleanup_resources)

    def test_containerfile_pins_base_and_toolchains(self) -> None:
        source = (IMAGE_ROOT / "Containerfile").read_text(encoding="utf-8")

        self.assertRegex(source, r"ubuntu@sha256:[0-9a-f]{64}")
        self.assertIn(_BASE_IMAGE_DIGEST, source)
        self.assertIn("ARG NODE_VERSION=24.10.0", source)
        self.assertIn("ARG PNPM_VERSION=9.12.0", source)
        self.assertIn("ARG RUST_TOOLCHAIN=1.94.0", source)
        self.assertIn("ENV COREPACK_HOME=/opt/corepack", source)
        self.assertIn('chmod -R a+rX "${COREPACK_HOME}"', source)
        self.assertIn("libprotobuf-dev", source)
        self.assertIn("libwebkit2gtk-4.1-dev", source)
        self.assertIn("xserver-xorg-video-dummy", source)
        self.assertIn("x11vnc", source)
        self.assertIn("zenity", source)
        self.assertIn("command -v setsid", source)
        self.assertIn("command -v zenity", source)
        self.assertNotIn("xvfb", source.lower())

    def test_supervisor_uses_real_xorg_and_loopback_observer(self) -> None:
        source = (IMAGE_ROOT / "entrypoint.sh").read_text(encoding="utf-8")

        self.assertIn("/usr/lib/xorg/Xorg \"$DISPLAY\"", source)
        self.assertIn("-nolisten tcp", source)
        self.assertIn("openbox >", source)
        self.assertIn("-localhost", source)
        self.assertIn("xprop -root _NET_CLIENT_LIST_STACKING", source)
        self.assertIn("xdpyinfo -queryExtensions", source)
        self.assertNotIn("Xvfb", source)

    def test_remote_control_has_ttl_and_cache_retention_paths(self) -> None:
        source = REMOTE_CONTROL_PATH.read_text(encoding="utf-8")

        self.assertIn("start_reaper", source)
        self.assertIn("time.sleep(delay)", source)
        self.assertIn("--cache-root", source)
        self.assertIn("removedCacheFiles", source)
        self.assertIn('setsid \\"$PT_CELL_APP_BINARY\\"', source)
        self.assertIn('f"kill -TERM -- -{process_id}"', source)
        self.assertIn('f"kill -KILL -- -{process_id}"', source)
        self.assertIn("_assert_ports_available", source)
        self.assertIn('"reveal_file_chooser_location"', source)
        self.assertIn(
            "adapter.reveal_file_chooser_location()",
            source,
        )

    def test_local_tunnel_supervisor_owns_bounded_forwards(self) -> None:
        source = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "provisioners"
            / "local_tunnel_supervisor.py"
        ).read_text(encoding="utf-8")

        self.assertIn("expires_at", source)
        self.assertIn("start_local_forward", source)
        self.assertIn("tunnel.stop()", source)

    def test_build_creates_cache_home_before_global_git_config(self) -> None:
        source = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "provisioners"
            / "native_desktop_linux.py"
        ).read_text(encoding="utf-8")

        self.assertLess(
            source.index("mkdir -p /workspace/cache/home"),
            source.index("git config --global --add safe.directory"),
        )
        self.assertIn('"COREPACK_HOME=/opt/corepack"', source)

    def test_native_probe_translates_client_origin_into_root_coordinates(
        self,
    ) -> None:
        self.assertIn(
            "origin = root.translate_coords(active_window, 0, 0)",
            _NATIVE_ADAPTER_PROBE_SCRIPT,
        )
        self.assertNotIn(
            "origin = active_window.translate_coords(root, 0, 0)",
            _NATIVE_ADAPTER_PROBE_SCRIPT,
        )

    def test_ready_holds_source_lease_through_manifest_validation(self) -> None:
        source = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "provisioners"
            / "native_desktop_linux.py"
        ).read_text(encoding="utf-8")

        acquired = source.index("lease.acquire()")
        validated = source.index("manifest.validate(self.contract)")
        released = source.index("lease.release()", validated)
        self.assertLess(acquired, validated)
        self.assertLess(validated, released)
        self.assertIn(
            'remote_control = Path(str(acquired["controlPath"]))',
            source,
        )
        self.assertIn(
            "source_lease_owner=source_lease_owner",
            source,
        )
        self.assertEqual(
            source.count(
                "f\"runtime-cell:{self.contract.cell_id}:{run_id}\""
            ),
            1,
        )

    def test_make_exposes_the_four_cell_lifecycle_commands(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "make" / "acceptance.mk"
        ).read_text(encoding="utf-8")
        for action in ("ready", "status", "logs", "stop"):
            target = f"acceptance-cell-{action}:"
            start = source.index(target)
            end = source.find("\n\n", start)
            recipe = source[start:] if end < 0 else source[start:end]
            self.assertIn(target, recipe)
            self.assertIn(
                f"acceptance-cell.py {action}",
                recipe,
            )
            self.assertIn('--cell "$(CELL)"', recipe)

    def test_wait_for_ready_parses_complete_multiline_document(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.transport = Mock()
        expected = {
            "runId": "run-1",
            "state": "DRIVER_READY",
            "processes": {"app": 123},
        }
        provisioner.transport.run_argv.return_value = (
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout=json.dumps(expected, indent=2) + "\n",
                stderr="",
            )
        )

        actual = provisioner._wait_for_ready("runtime-cell", timeout=0.1)

        self.assertEqual(actual, expected)

    def test_wait_for_ready_rejects_invalid_document(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.transport = Mock()
        provisioner.transport.run_argv.return_value = (
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="}\n",
                stderr="",
            )
        )

        with self.assertRaisesRegex(ProvisioningError, "invalid JSON"):
            provisioner._wait_for_ready("runtime-cell", timeout=0.1)


class LinuxCellProfileTests(unittest.TestCase):
    def test_profile_loads_non_sensitive_runtime_settings(self) -> None:
        contract = RuntimeCellContract.from_yaml(CONTRACT_PATH)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "acceptance-linux.env").write_text(
                "\n".join(
                    (
                        "PT_ACCEPTANCE_CELL_DEPLOY_ENV=acceptance-linux",
                        "PT_ACCEPTANCE_CELL_IMAGE=peers-touch/linux-cell:test",
                        "PT_ACCEPTANCE_CELL_DISPLAY=:99",
                        "PT_ACCEPTANCE_CELL_WEBDRIVER_PORT=4545",
                        "PT_ACCEPTANCE_CELL_GATEWAY_PORT=3130",
                        "PT_ACCEPTANCE_CELL_OBSERVER_PORT=5910",
                        (
                            "PT_ACCEPTANCE_CELL_CARGO_REGISTRY_INDEX="
                            "sparse+https://mirror.example.test/index/"
                        ),
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            profile = LinuxCellProfile.load(contract, profile_root=root)

        self.assertEqual(profile.deploy_environment, "acceptance-linux")
        self.assertEqual(profile.webdriver_port, 4545)
        self.assertEqual(profile.observer_port, 5910)
        self.assertEqual(
            profile.cargo_registry_index,
            "sparse+https://mirror.example.test/index/",
        )

    def test_duplicate_ports_fail_closed(self) -> None:
        profile = LinuxCellProfile(
            name="acceptance-linux",
            deploy_environment="acceptance-linux",
            image_ref="peers-touch/linux-cell:test",
            base_image_ref=(
                "ubuntu@sha256:"
                + _BASE_IMAGE_DIGEST
            ),
            node_dist_url="https://nodejs.org/dist",
            rustup_dist_server="https://static.rust-lang.org",
            rustup_update_root="https://static.rust-lang.org/rustup",
            cargo_registry_index="sparse+https://index.crates.io/",
            display=":99",
            webdriver_port=4445,
            gateway_port=4445,
            observer_port=5909,
        )
        with self.assertRaisesRegex(ProvisioningError, "ports must be distinct"):
            profile.validate()

    def test_digest_normalizes_source_sync_prefix(self) -> None:
        value = "a" * 64
        self.assertEqual(_digest(value, "test"), value)
        self.assertEqual(_digest(f"sha256:{value}", "test"), value)

    def test_tunnel_cleanup_rejects_reused_process_id(self) -> None:
        completed = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout="python3 unrelated.py\n",
            stderr="",
        )
        with patch(
            "tooling.acceptance.provisioners.native_desktop_linux.subprocess.run",
            return_value=completed,
        ):
            with self.assertRaisesRegex(ProvisioningError, "refusing to stop"):
                _stop_tunnel_process(
                    42,
                    local_port=4545,
                    remote_port=4545,
                    destination="acceptance@example.test",
                )

    def test_running_container_image_must_match_attested_digest(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.transport = Mock()
        provisioner.transport.run_argv.return_value = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout="sha256:" + ("b" * 64) + "\n",
            stderr="",
        )

        with self.assertRaisesRegex(
            ProvisioningError,
            "does not match",
        ):
            provisioner._assert_running_image(
                "runtime-cell",
                "a" * 64,
            )

    def test_runtime_container_starts_from_immutable_image_id(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.transport = Mock()
        provisioner.transport.run_argv.side_effect = (
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="1000\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="1000\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="container-id\n",
                stderr="",
            ),
        )
        provisioner.profile = SimpleNamespace(
            display=":99",
            observer_port=5909,
            webdriver_port=4545,
            gateway_port=3130,
            name="acceptance-linux",
        )
        provisioner.contract = SimpleNamespace(
            cell_id="desktop-linux-native",
        )

        provisioner._start_container(
            remote_source=Path("/remote/source"),
            run_root=Path("/remote/run"),
            run_id="run-1",
            container_name="runtime-cell",
            image_digest="a" * 64,
        )

        command = provisioner.transport.run_argv.call_args_list[-1].args[0]
        self.assertIn("sha256:" + ("a" * 64), command)

    def test_build_paths_reject_unexpected_owner(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.contract = SimpleNamespace(
            cell_id="desktop-linux-native",
        )
        provisioner.transport = Mock()
        provisioner.transport.run_argv.side_effect = (
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="0:0\n",
                stderr="",
            ),
        )

        with self.assertRaisesRegex(
            BlockedError,
            "unexpected ownership",
        ):
            provisioner._prepare_remote_build_paths(
                cache_root=Path("/remote/cache"),
                run_root=Path("/remote/run"),
                uid="1000",
                gid="1000",
            )

    def test_actor_launcher_owns_isolated_tunnels_without_stopping_cell(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provisioner = object.__new__(NativeDesktopLinuxProvisioner)
            provisioner.contract = SimpleNamespace(
                cell_id="desktop-linux-native",
            )
            provisioner.profile = SimpleNamespace(runtime_root=".cache/runtime")
            provisioner.state_path = Path(tmp) / "cell.json"
            provisioner._actors = {}
            provisioner.transport = Mock()
            webdriver = SyntheticTunnel(4445)
            gateway = SyntheticTunnel(3330)
            provisioner.transport.start_local_forward.side_effect = (
                webdriver,
                gateway,
            )
            state = {
                "runId": "run-1",
                "containerName": "runtime-cell",
                "remoteControl": "/remote/control.py",
            }
            remote = {
                "actor": "alice",
                "processId": 101,
                "webdriverPort": 4445,
                "gatewayPort": 3330,
                "profile": "chat-native-alice",
                "storageRoot": "/workspace/run/actors/alice/storage",
            }
            provisioner._require_state = Mock(return_value=state)
            provisioner._read_state = Mock(return_value=state)
            provisioner._start_remote_actor = Mock(return_value=remote)
            provisioner._stop_remote_actor = Mock(
                return_value={
                    "actor": "alice",
                    "stopped": True,
                    "logContent": "",
                }
            )
            provisioner.stop = Mock()

            launcher = provisioner.launch_actor(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                },
                {"PEERS_STATION_URL": "http://127.0.0.1:18080"},
            )
            launcher.start()
            launcher.stop()
            launcher.stop()

        self.assertTrue(webdriver.stopped)
        self.assertTrue(gateway.stopped)
        provisioner._stop_remote_actor.assert_called_once_with(
            remote_control=Path("/remote/control.py"),
            run_id="run-1",
            container_name="runtime-cell",
            actor="alice",
            preserve_state=False,
        )
        provisioner.stop.assert_not_called()
        self.assertNotIn("alice", provisioner._actors)

    def test_actor_ports_are_remapped_into_the_cell_owned_range(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provisioner = object.__new__(NativeDesktopLinuxProvisioner)
            provisioner.contract = SimpleNamespace(
                cell_id="desktop-linux-native",
            )
            provisioner.profile = SimpleNamespace(
                runtime_root=".cache/runtime",
                webdriver_port=4545,
                gateway_port=3130,
            )
            provisioner.state_path = Path(tmp) / "cell.json"
            provisioner._actors = {}
            provisioner._actor_port_slots = {}
            provisioner.transport = Mock()
            alice_gateway = SyntheticTunnel(53330)
            bob_webdriver = SyntheticTunnel(54446)
            bob_gateway = SyntheticTunnel(53331)
            provisioner.transport.start_local_forward.side_effect = (
                alice_gateway,
                bob_webdriver,
                bob_gateway,
            )
            provisioner._validated_tunnel_state = Mock(
                return_value={
                    "webdriver": {"localPort": 54545},
                }
            )
            provisioner._read_tunnel_state = Mock(return_value={})
            state = {
                "runId": "run-1",
                "containerName": "runtime-cell",
                "remoteControl": "/remote/control.py",
            }
            provisioner._require_state = Mock(return_value=state)
            provisioner._start_remote_actor = Mock(
                side_effect=(
                    {
                        "actor": "alice",
                        "processId": 101,
                        "webdriverPort": 4545,
                        "gatewayPort": 3130,
                        "profile": "chat-native-alice",
                        "storageRoot": "/workspace/run/actors/alice/storage",
                    },
                    {
                        "actor": "bob",
                        "processId": 102,
                        "webdriverPort": 4546,
                        "gatewayPort": 3131,
                        "profile": "chat-native-bob",
                        "storageRoot": "/workspace/run/actors/bob/storage",
                    },
                )
            )

            alice = provisioner.launch_actor(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                },
                {},
            )
            bob = provisioner.launch_actor(
                "bob",
                {
                    "webdriver_port": 4446,
                    "gateway_port": 3331,
                    "profile": "chat-native-bob",
                },
                {},
            )

        calls = provisioner._start_remote_actor.call_args_list
        self.assertEqual(calls[0].kwargs["webdriver_port"], 4545)
        self.assertEqual(calls[0].kwargs["gateway_port"], 3130)
        self.assertEqual(calls[1].kwargs["webdriver_port"], 4546)
        self.assertEqual(calls[1].kwargs["gateway_port"], 3131)
        self.assertEqual(alice.metadata.webdriver_port, 54545)
        self.assertEqual(alice.metadata.gateway_port, 53330)
        self.assertEqual(bob.metadata.webdriver_port, 54446)
        self.assertEqual(bob.metadata.gateway_port, 53331)

    def test_actor_restart_preserves_state_and_keeps_per_launch_logs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provisioner = object.__new__(NativeDesktopLinuxProvisioner)
            provisioner.contract = SimpleNamespace(
                cell_id="desktop-linux-native",
            )
            provisioner.profile = SimpleNamespace(runtime_root=".cache/runtime")
            provisioner.state_path = Path(tmp) / "cell.json"
            provisioner._actors = {}
            provisioner.transport = Mock()
            tunnels = [
                SyntheticTunnel(4445),
                SyntheticTunnel(3330),
                SyntheticTunnel(4445),
                SyntheticTunnel(3330),
            ]
            provisioner.transport.start_local_forward.side_effect = tunnels
            state = {
                "runId": "run-1",
                "containerName": "runtime-cell",
                "remoteControl": "/remote/control.py",
            }
            remote = {
                "actor": "alice",
                "webdriverPort": 4445,
                "gatewayPort": 3330,
                "profile": "chat-native-alice",
                "storageRoot": "/workspace/run/actors/alice/storage",
            }
            provisioner._require_state = Mock(return_value=state)
            provisioner._read_state = Mock(return_value=state)
            provisioner._start_remote_actor = Mock(
                side_effect=(
                    {**remote, "processId": 101},
                    {**remote, "processId": 102},
                )
            )
            provisioner._stop_remote_actor = Mock(
                return_value={
                    "actor": "alice",
                    "stopped": True,
                    "logContent": "",
                }
            )

            first = provisioner.launch_actor(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                },
                {},
            )
            first.start()
            first.stop(preserve_state=True)

            second = provisioner.launch_actor(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                },
                {},
            )
            second.start()
            second.stop()

        self.assertEqual(first.metadata.log_path.name, "alice-01.log")
        self.assertEqual(second.metadata.log_path.name, "alice-02.log")
        self.assertEqual(
            [
                item.kwargs["preserve_state"]
                for item in provisioner._stop_remote_actor.call_args_list
            ],
            [True, False],
        )
        self.assertTrue(all(tunnel.stopped for tunnel in tunnels))
        self.assertNotIn("alice", provisioner._actors)

    def test_actor_file_staging_refreshes_one_actor_scoped_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "fixture.png"
            source.write_bytes(b"fixture")
            first_digest = hashlib.sha256(b"fixture").hexdigest()
            second_digest = hashlib.sha256(b"updated fixture").hexdigest()
            source_identity = hashlib.sha256(
                os.fsencode(source.resolve())
            ).hexdigest()
            provisioner = object.__new__(NativeDesktopLinuxProvisioner)
            provisioner._actors = {
                "alice": SimpleNamespace(released=False),
            }
            provisioner.transport = Mock()
            provisioner._require_state = Mock(
                return_value={
                    "containerName": "runtime-cell",
                    "remoteControl": "/remote/run/remote_control.py",
                }
            )
            provisioner.transport.run_argv.side_effect = (
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess(
                    (),
                    0,
                    f"{first_digest}  incoming\n",
                    "",
                ),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess(
                    (),
                    0,
                    f"{second_digest}  incoming\n",
                    "",
                ),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
            )

            first_staged = provisioner.stage_actor_file("alice", source)
            source.write_bytes(b"updated fixture")
            second_staged = provisioner.stage_actor_file("alice", source)

        expected = (
            f"/workspace/run/actors/alice/fixtures/"
            f"{source_identity}/fixture.png"
        )
        self.assertEqual(first_staged, expected)
        self.assertEqual(second_staged, expected)
        self.assertEqual(
            provisioner.transport.copy_file.call_args_list,
            [
                call(
                    source.resolve(),
                    Path(
                        f"/remote/run/staging/alice/"
                        f"{first_digest}/fixture.png"
                    ),
                    timeout=60,
                ),
                call(
                    source.resolve(),
                    Path(
                        f"/remote/run/staging/alice/"
                        f"{second_digest}/fixture.png"
                    ),
                    timeout=60,
                ),
            ],
        )
        first_copy = provisioner.transport.run_argv.call_args_list[2].args[0]
        first_move = provisioner.transport.run_argv.call_args_list[4].args[0]
        second_copy = provisioner.transport.run_argv.call_args_list[8].args[0]
        second_move = provisioner.transport.run_argv.call_args_list[10].args[0]
        first_incoming = (
            f"/workspace/run/actors/alice/fixtures/{source_identity}/"
            f".fixture.png.{first_digest}.incoming"
        )
        second_incoming = (
            f"/workspace/run/actors/alice/fixtures/{source_identity}/"
            f".fixture.png.{second_digest}.incoming"
        )
        self.assertEqual(
            first_copy,
            (
                "docker",
                "cp",
                f"/remote/run/staging/alice/{first_digest}/fixture.png",
                f"runtime-cell:{first_incoming}",
            ),
        )
        self.assertEqual(
            first_move,
            (
                "docker",
                "exec",
                "runtime-cell",
                "mv",
                "-f",
                first_incoming,
                expected,
            ),
        )
        self.assertEqual(
            second_copy,
            (
                "docker",
                "cp",
                f"/remote/run/staging/alice/{second_digest}/fixture.png",
                f"runtime-cell:{second_incoming}",
            ),
        )
        self.assertEqual(
            second_move,
            (
                "docker",
                "exec",
                "runtime-cell",
                "mv",
                "-f",
                second_incoming,
                expected,
            ),
        )

    def test_actor_file_staging_preserves_target_on_digest_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "fixture.png"
            source.write_bytes(b"fixture")
            provisioner = object.__new__(NativeDesktopLinuxProvisioner)
            provisioner._actors = {
                "alice": SimpleNamespace(released=False),
            }
            provisioner.transport = Mock()
            provisioner._require_state = Mock(
                return_value={
                    "containerName": "runtime-cell",
                    "remoteControl": "/remote/run/remote_control.py",
                }
            )
            provisioner.transport.run_argv.side_effect = (
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, f"{'0' * 64}  incoming\n", ""),
                subprocess.CompletedProcess((), 0, "", ""),
                subprocess.CompletedProcess((), 0, "", ""),
            )

            with self.assertRaisesRegex(ProvisioningError, "digest mismatch"):
                provisioner.stage_actor_file("alice", source)

        commands = [
            item.args[0]
            for item in provisioner.transport.run_argv.call_args_list
        ]
        self.assertFalse(
            any(
                len(command) > 3
                and command[:3] == ("docker", "exec", "runtime-cell")
                and "mv" in command
                for command in commands
            )
        )

    def test_actor_file_digest_is_scoped_to_actor_runtime_root(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._actors = {
            "alice": SimpleNamespace(released=False),
        }
        provisioner.transport = Mock()
        provisioner._require_state = Mock(
            return_value={"containerName": "runtime-cell"}
        )
        expected = "a" * 64
        provisioner.transport.run_argv.return_value = subprocess.CompletedProcess(
            (),
            0,
            f"{expected}  cache.bin\n",
            "",
        )

        observed = provisioner.actor_file_sha256(
            "alice",
            "/workspace/run/actors/alice/storage/cache.bin",
        )

        self.assertEqual(observed, expected)
        provisioner.transport.run_argv.assert_called_once_with(
            (
                "docker",
                "exec",
                "runtime-cell",
                "sha256sum",
                "--",
                "/workspace/run/actors/alice/storage/cache.bin",
            ),
            timeout=15,
            check=True,
        )
        with self.assertRaisesRegex(ProvisioningError, "outside"):
            provisioner.actor_file_sha256(
                "alice",
                "/workspace/run/actors/bob/storage/cache.bin",
            )

    def test_actor_storage_clone_stays_inside_runtime_cell(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._actors = {
            "bob1": SimpleNamespace(released=False),
        }
        provisioner.transport = Mock()
        provisioner._require_state = Mock(
            return_value={"containerName": "runtime-cell"}
        )
        provisioner.transport.run_argv.return_value = (
            subprocess.CompletedProcess((), 0, "", "")
        )

        with patch(
            "tooling.acceptance.provisioners.native_desktop_linux."
            "secrets.token_hex",
            return_value="cloneid",
        ):
            provisioner.clone_actor_storage(
                "bob1",
                "bob2",
                "peers-touch/desktop/data/secure-store/identity-keys",
            )

        commands = [
            item.args[0]
            for item in provisioner.transport.run_argv.call_args_list
        ]
        source = (
            "/workspace/run/actors/bob1/storage/"
            "peers-touch/desktop/data/secure-store/identity-keys"
        )
        temporary_root = "/workspace/run/actors/.clone-bob2-cloneid"
        temporary = (
            f"{temporary_root}/storage/"
            "peers-touch/desktop/data/secure-store/identity-keys"
        )
        self.assertEqual(
            commands,
            [
                (
                    "docker",
                    "exec",
                    "runtime-cell",
                    "test",
                    "-d",
                    source,
                ),
                (
                    "docker",
                    "exec",
                    "runtime-cell",
                    "test",
                    "!",
                    "-e",
                    "/workspace/run/actors/bob2",
                ),
                (
                    "docker",
                    "exec",
                    "runtime-cell",
                    "mkdir",
                    "-p",
                    str(Path(temporary).parent),
                ),
                (
                    "docker",
                    "exec",
                    "runtime-cell",
                    "cp",
                    "-a",
                    source,
                    temporary,
                ),
                (
                    "docker",
                    "exec",
                    "runtime-cell",
                    "mv",
                    temporary_root,
                    "/workspace/run/actors/bob2",
                ),
            ],
        )

    def test_actor_storage_clone_removes_temporary_tree_on_copy_failure(
        self,
    ) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._actors = {
            "bob1": SimpleNamespace(released=False),
        }
        provisioner.transport = Mock()
        provisioner._require_state = Mock(
            return_value={"containerName": "runtime-cell"}
        )
        success = subprocess.CompletedProcess((), 0, "", "")
        copy_failure = RuntimeError("copy failed")
        provisioner.transport.run_argv.side_effect = (
            success,
            success,
            success,
            copy_failure,
            success,
        )

        with patch(
            "tooling.acceptance.provisioners.native_desktop_linux."
            "secrets.token_hex",
            return_value="cloneid",
        ), self.assertRaisesRegex(
            ProvisioningError,
            "actor storage clone failed",
        ):
            provisioner.clone_actor_storage(
                "bob1",
                "bob2",
                "secure-store/identity-keys",
            )

        cleanup = provisioner.transport.run_argv.call_args_list[-1]
        self.assertEqual(
            cleanup.args[0],
            (
                "docker",
                "exec",
                "runtime-cell",
                "rm",
                "-rf",
                "/workspace/run/actors/.clone-bob2-cloneid",
            ),
        )
        self.assertFalse(cleanup.kwargs["check"])

    def test_actor_storage_clone_rejects_active_target(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._actors = {
            "bob1": SimpleNamespace(released=False),
            "bob2": SimpleNamespace(released=False),
        }
        provisioner.transport = Mock()
        provisioner._require_state = Mock(
            return_value={"containerName": "runtime-cell"}
        )

        with self.assertRaisesRegex(
            ProvisioningError,
            "actor 'bob2' is already active",
        ):
            provisioner.clone_actor_storage(
                "bob1",
                "bob2",
                "secure-store/identity-keys",
            )

        provisioner.transport.run_argv.assert_not_called()

    def test_explicit_orchestrator_endpoint_owns_reverse_tunnel(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._endpoints = {}
        provisioner.transport = Mock()
        tunnel = SyntheticTunnel(0)
        tunnel.process_id = 73
        provisioner.transport.start_reverse_forward.return_value = tunnel
        provisioner.transport.remote_loopback_port_listening.return_value = False

        endpoint = provisioner.expose_orchestrator_endpoint(
            "reaction-proxy",
            "http://localhost:51219/fault?mode=drop",
        )
        released = provisioner.release_endpoint("reaction-proxy")

        provisioner.transport.start_reverse_forward.assert_called_once_with(
            local_port=51219,
            remote_port=51219,
        )
        self.assertEqual(
            endpoint["url"],
            "http://127.0.0.1:51219/fault?mode=drop",
        )
        self.assertEqual(endpoint["tunnelPid"], 73)
        self.assertTrue(released["released"])
        self.assertTrue(tunnel.stopped)
        self.assertTrue(
            provisioner.endpoint_cleanup_audit()["endpointsReleased"]
        )

    def test_orchestrator_endpoint_rejects_non_loopback_url(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._endpoints = {}
        provisioner.transport = Mock()

        with self.assertRaisesRegex(
            ProvisioningError,
            "HTTP\\(S\\) loopback URL",
        ):
            provisioner.expose_orchestrator_endpoint(
                "reaction-proxy",
                "http://10.37.94.156:18080",
            )

        provisioner.transport.start_reverse_forward.assert_not_called()

    def test_runtime_binding_requires_exact_gate_and_source_identity(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner._require_state = Mock(
            return_value={
                "manifest": {
                    "gateId": "chat-native-product-closure-e2e",
                    "source": {"commit": "abc123"},
                }
            }
        )

        provisioner.validate_binding(
            "chat-native-product-closure-e2e",
            "abc123",
        )
        with self.assertRaisesRegex(
            ProvisioningError,
            "Gate identity",
        ):
            provisioner.validate_binding("other-gate", "abc123")
        with self.assertRaisesRegex(
            ProvisioningError,
            "source commit",
        ):
            provisioner.validate_binding(
                "chat-native-product-closure-e2e",
                "def456",
            )

    def test_actor_launch_failure_cleans_tunnel_and_remote_process(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.contract = SimpleNamespace(
            cell_id="desktop-linux-native",
        )
        provisioner.profile = SimpleNamespace(runtime_root=".cache/runtime")
        provisioner.state_path = Path("/tmp/cell.json")
        provisioner._actors = {}
        provisioner.transport = Mock()
        webdriver = SyntheticTunnel(4445)
        provisioner.transport.start_local_forward.side_effect = (
            webdriver,
            ProvisioningError("gateway tunnel failed"),
        )
        provisioner._require_state = Mock(
            return_value={
                "runId": "run-1",
                "containerName": "runtime-cell",
                "remoteControl": "/remote/control.py",
            }
        )
        provisioner._start_remote_actor = Mock(
            return_value={
                "actor": "alice",
                "processId": 101,
                "webdriverPort": 4445,
                "gatewayPort": 3330,
                "profile": "chat-native-alice",
                "storageRoot": "/workspace/run/actors/alice/storage",
            }
        )
        provisioner._stop_remote_actor = Mock(return_value={"stopped": True})

        with self.assertRaisesRegex(ProvisioningError, "gateway tunnel failed"):
            provisioner.launch_actor(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                },
                {},
            )

        self.assertTrue(webdriver.stopped)
        provisioner._stop_remote_actor.assert_called_once()
        self.assertEqual(provisioner._actors, {})

    def test_remote_actor_stop_outlives_remote_port_release_wait(self) -> None:
        provisioner = object.__new__(NativeDesktopLinuxProvisioner)
        provisioner.contract = SimpleNamespace(
            cell_id="desktop-linux-native",
        )
        provisioner.profile = SimpleNamespace(runtime_root=".cache/runtime")
        provisioner.transport = Mock()
        provisioner.transport.run_argv.return_value = (
            subprocess.CompletedProcess(
                (),
                0,
                '{"actor":"alice","stopped":true}\n',
                "",
            )
        )

        result = provisioner._stop_remote_actor(
            remote_control=Path("/remote/control.py"),
            run_id="run-1",
            container_name="runtime-cell",
            actor="alice",
            preserve_state=True,
        )

        self.assertTrue(result["stopped"])
        provisioner.transport.run_argv.assert_called_once_with(
            (
                "python3",
                "/remote/control.py",
                "actor-stop",
                "--runtime-root",
                ".cache/runtime",
                "--cell-id",
                "desktop-linux-native",
                "--run-id",
                "run-1",
                "--container-name",
                "runtime-cell",
                "--actor",
                "alice",
                "--preserve-state",
            ),
            timeout=90,
            check=False,
        )


class RemoteLinuxCellControlTests(unittest.TestCase):
    def _args(self, action: str, root: str, run_id: str = "run-1") -> argparse.Namespace:
        values = {
            "command": action,
            "runtime_root": root,
            "cell_id": "desktop-linux-native",
            "run_id": run_id,
            "container_name": "pt-acceptance-desktop-linux-native",
            "build_container_name": "pt-acceptance-desktop-linux-native-build",
            "source_path": "peers-touch/acceptance-linux/repo",
            "source_commit": "a" * 40,
            "expires_at": 4_102_444_800,
            "webdriver_port": 45_445,
            "gateway_port": 41_310,
            "observer_port": 45_909,
            "actor": "alice",
            "display": ":99",
            "profile": "chat-native-alice",
            "environment_json": "{}",
            "timeout": 1,
            "retention_days": 14,
            "preserve_state": False,
        }
        return argparse.Namespace(**values)

    def test_adapter_uses_the_cell_dbus_session(self) -> None:
        args = self._args("adapter", ".cache/runtime")
        args.operation = "focused_control"
        args.payload = "e30="
        commands: list[tuple[str, ...]] = []

        def container_command(_container: str, *command: str, **_kwargs):
            commands.append(command)
            if command[:3] == ("sed", "-n", "1p"):
                return subprocess.CompletedProcess(
                    args=command,
                    returncode=0,
                    stdout="unix:path=/workspace/run/dbus.sock\n",
                    stderr="",
                )
            return subprocess.CompletedProcess(
                args=command,
                returncode=0,
                stdout="{}\n",
                stderr="",
            )

        with patch.object(
            remote_control,
            "_owned_lease",
            return_value=(Path("/tmp/lease.json"), {}),
        ), patch.object(
            remote_control,
            "_container_command",
            side_effect=container_command,
        ), patch("sys.stdout"):
            self.assertEqual(remote_control.adapter(args), 0)

        adapter_command = commands[1]
        self.assertIn(
            "DBUS_SESSION_BUS_ADDRESS=unix:path=/workspace/run/dbus.sock",
            adapter_command,
        )
        self.assertIn("NO_AT_BRIDGE=0", adapter_command)
        self.assertIn("PYTHONPATH=/workspace/source", adapter_command)

    def test_adapter_fails_when_cell_dbus_session_is_missing(self) -> None:
        args = self._args("adapter", ".cache/runtime")
        args.operation = "focused_control"
        args.payload = "e30="

        with patch.object(
            remote_control,
            "_owned_lease",
            return_value=(Path("/tmp/lease.json"), {}),
        ), patch.object(
            remote_control,
            "_container_command",
            return_value=subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="",
                stderr="",
            ),
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "D-Bus session address is unavailable",
            ):
                remote_control.adapter(args)

    def test_actor_storage_cleanup_retries_transient_directory_churn(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            actor_root = Path(tmp) / "actor"
            actor_root.mkdir()
            (actor_root / "log").write_text("data", encoding="utf-8")
            remove_tree = remote_control.shutil.rmtree
            attempts = 0

            def transient_remove(path):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise OSError(
                        errno.ENOTEMPTY,
                        "Directory not empty",
                        str(path),
                    )
                remove_tree(path)

            with patch.object(
                remote_control.shutil,
                "rmtree",
                side_effect=transient_remove,
            ):
                remote_control._remove_tree(actor_root)

        self.assertEqual(attempts, 2)

    def test_actor_start_allocates_isolated_process_storage_and_ports(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            args = self._args("acquire", ".cache/runtime")
            with patch.dict(os.environ, {"HOME": str(home)}), patch.object(
                remote_control,
                "_spawn_reaper",
                return_value=123,
            ), patch("sys.stdout"):
                self.assertEqual(remote_control.acquire(args), 0)
            run_root = (
                home
                / ".cache"
                / "runtime"
                / "desktop-linux-native"
                / "runs"
                / "run-1"
            )

            def launch(command, **_kwargs):
                if "--detach" in command:
                    actor = "alice" if "PT_PROFILE=chat-native-alice" in command else "bob"
                    actor_root = run_root / "actors" / actor
                    actor_root.mkdir(parents=True, exist_ok=True)
                    (actor_root / "app.pid").write_text(
                        "101" if actor == "alice" else "102",
                        encoding="utf-8",
                    )
                return subprocess.CompletedProcess(
                    args=command,
                    returncode=0,
                    stdout="",
                    stderr="",
                )

            with patch.dict(os.environ, {"HOME": str(home)}), patch.object(
                remote_control,
                "_container_command",
            ), patch.object(
                remote_control,
                "_wait_actor_port",
            ), patch.object(
                remote_control.subprocess,
                "run",
                side_effect=launch,
            ), patch("sys.stdout"):
                self.assertEqual(remote_control.actor_start(args), 0)
                bob = self._args("actor-start", ".cache/runtime")
                bob.actor = "bob"
                bob.profile = "chat-native-bob"
                bob.webdriver_port = 45_446
                bob.gateway_port = 41_311
                self.assertEqual(remote_control.actor_start(bob), 0)

            lease = json.loads(
                (
                    home
                    / ".cache"
                    / "runtime"
                    / "desktop-linux-native"
                    / "lease"
                    / "lease.json"
                ).read_text(encoding="utf-8")
            )

        self.assertEqual(
            [actor["actor"] for actor in lease["actors"]],
            ["alice", "bob"],
        )
        self.assertEqual(
            {actor["processId"] for actor in lease["actors"]},
            {101, 102},
        )
        self.assertEqual(
            {actor["storageRoot"] for actor in lease["actors"]},
            {
                "/workspace/run/actors/alice/storage",
                "/workspace/run/actors/bob/storage",
            },
        )

    def test_actor_start_rejects_a_port_owned_outside_the_cell(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM,
        ) as listener:
            home = Path(tmp)
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            args = self._args("acquire", ".cache/runtime")
            with patch.dict(os.environ, {"HOME": str(home)}), patch.object(
                remote_control,
                "_spawn_reaper",
                return_value=123,
            ), patch("sys.stdout"):
                self.assertEqual(remote_control.acquire(args), 0)

            actor = self._args("actor-start", ".cache/runtime")
            actor.webdriver_port = listener.getsockname()[1]
            with patch.dict(os.environ, {"HOME": str(home)}):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "actor port .* is already in use",
                ):
                    remote_control.actor_start(actor)

    def test_port_release_timeout_tracks_the_kernel_fin_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            timeout_path = Path(tmp) / "tcp_fin_timeout"
            timeout_path.write_text("45\n", encoding="utf-8")

            self.assertEqual(
                remote_control._port_release_timeout(timeout_path),
                50,
            )

    def test_port_release_timeout_falls_back_for_invalid_sysctl(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            timeout_path = Path(tmp) / "tcp_fin_timeout"
            timeout_path.write_text("invalid\n", encoding="utf-8")

            self.assertEqual(
                remote_control._port_release_timeout(timeout_path),
                65,
            )

    def test_port_release_waits_until_the_port_can_be_rebound(self) -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

        def release_listener() -> None:
            time.sleep(0.1)
            listener.close()

        release = threading.Thread(target=release_listener)
        release.start()
        try:
            remote_control._assert_ports_released((port,), timeout=1)
        finally:
            release.join()

    def test_port_release_fails_closed_when_rebind_remains_blocked(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            with self.assertRaisesRegex(
                RuntimeError,
                "ports remain unavailable after cleanup",
            ):
                remote_control._assert_ports_released(
                    (listener.getsockname()[1],),
                    timeout=0,
                )

    def test_outer_cleanup_stops_actors_in_reverse_launch_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cell_root = Path(tmp) / "desktop-linux-native"
            run_root = cell_root / "runs" / "run-1"
            run_root.mkdir(parents=True)
            remote_control._write_json(
                cell_root / "lease" / "lease.json",
                {
                    "runId": "run-1",
                    "containerName": "runtime-cell",
                    "actors": [
                        {"actor": "alice", "processId": 101},
                        {"actor": "bob", "processId": 102},
                        {"actor": "alice2", "processId": 103},
                    ],
                    "ports": [],
                },
            )
            stopped: list[str] = []

            def stop_actor(_container, _run_root, actor):
                stopped.append(str(actor["actor"]))
                return {"stopped": True}

            with patch.object(
                remote_control,
                "_stop_actor_record",
                side_effect=stop_actor,
            ), patch.object(remote_control, "_docker_remove"), patch.object(
                remote_control,
                "_clean_source",
            ), patch.object(remote_control, "_assert_ports_released"):
                self.assertTrue(
                    remote_control._cleanup_owned_run(
                        cell_root,
                        run_id="run-1",
                        container_name="runtime-cell",
                        stop_reaper=False,
                    )
                )

        self.assertEqual(stopped, ["alice2", "bob", "alice"])

    def test_actor_restart_stop_preserves_state_and_clears_runtime_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_root = Path(tmp)
            actor_root = run_root / "actors" / "alice"
            (actor_root / "home").mkdir(parents=True)
            (actor_root / "storage").mkdir()
            (actor_root / "runtime").mkdir()
            (actor_root / "home" / "device.key").write_text(
                "device",
                encoding="utf-8",
            )
            (actor_root / "storage" / "session.json").write_text(
                "session",
                encoding="utf-8",
            )
            (actor_root / "runtime" / "socket").write_text(
                "runtime",
                encoding="utf-8",
            )
            (actor_root / "app.pid").write_text("101", encoding="utf-8")
            (actor_root / "app.log").write_text("launch log", encoding="utf-8")
            completed = subprocess.CompletedProcess((), 0, "", "")
            stopped = subprocess.CompletedProcess((), 1, "", "")

            with patch.object(
                remote_control.subprocess,
                "run",
                side_effect=(completed, stopped),
            ):
                result = remote_control._stop_actor_record(
                    "runtime-cell",
                    run_root,
                    {"actor": "alice", "processId": 101},
                    preserve_state=True,
                )

            self.assertTrue(result["statePreserved"])
            self.assertTrue((actor_root / "home" / "device.key").is_file())
            self.assertTrue((actor_root / "storage" / "session.json").is_file())
            self.assertFalse((actor_root / "runtime").exists())
            self.assertFalse((actor_root / "app.pid").exists())
            self.assertFalse((actor_root / "app.log").exists())

    def test_acquire_status_and_stop_preserve_run_ownership(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with patch.dict(os.environ, {"HOME": str(home)}), patch.object(
                remote_control,
                "_docker_remove",
            ), patch.object(remote_control, "_clean_source"):
                with patch.object(
                    remote_control,
                    "_spawn_reaper",
                    return_value=123,
                ):
                    args = self._args("acquire", ".cache/runtime")
                    with patch("sys.stdout"):
                        self.assertEqual(remote_control.acquire(args), 0)
                lease_path = (
                    home
                    / ".cache"
                    / "runtime"
                    / "desktop-linux-native"
                    / "lease"
                    / "lease.json"
                )
                lease = json.loads(lease_path.read_text(encoding="utf-8"))
                self.assertEqual(lease["runId"], "run-1")
                self.assertEqual(lease["reaperPid"], 123)
                self.assertEqual(
                    lease["ports"],
                    [45_445, 41_310, 45_909],
                )
                self.assertTrue(
                    (
                        home
                        / ".cache"
                        / "runtime"
                        / "desktop-linux-native"
                        / "runs"
                        / "run-1"
                        / "remote_control.py"
                    ).is_file()
                )

                with patch("sys.stdout"):
                    self.assertEqual(remote_control.status(args), 0)
                wrong = self._args("stop", ".cache/runtime", run_id="run-2")
                with patch("sys.stdout"):
                    self.assertEqual(remote_control.stop(wrong), 75)
                self.assertTrue(lease_path.exists())

                with patch("sys.stdout"):
                    self.assertEqual(remote_control.stop(args), 0)
                self.assertFalse(lease_path.exists())

    def test_cleanup_failure_retains_lease_for_retry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            args = self._args("acquire", ".cache/runtime")
            with patch.dict(os.environ, {"HOME": str(home)}), patch.object(
                remote_control,
                "_spawn_reaper",
                return_value=123,
            ), patch.object(
                remote_control,
                "_docker_remove",
                side_effect=RuntimeError("container remains"),
            ), patch.object(remote_control, "_clean_source"), patch.object(
                remote_control,
                "_assert_ports_released",
            ):
                with patch("sys.stdout"):
                    self.assertEqual(remote_control.acquire(args), 0)
                lease_path = (
                    home
                    / ".cache"
                    / "runtime"
                    / "desktop-linux-native"
                    / "lease"
                    / "lease.json"
                )

                with self.assertRaisesRegex(
                    RuntimeError,
                    "container remains",
                ):
                    remote_control._cleanup_owned_run(
                        lease_path.parents[1],
                        run_id="run-1",
                        container_name=args.container_name,
                        stop_reaper=False,
                    )

                lease = json.loads(lease_path.read_text(encoding="utf-8"))
                self.assertEqual(lease["cleanupState"], "CLEANUP_FAILED")
                self.assertTrue(lease["cleanupErrors"])
                self.assertTrue(
                    (
                        lease_path.parents[1]
                        / "runs"
                        / "run-1"
                    ).is_dir()
                )

    def test_container_removal_failure_is_not_silently_accepted(self) -> None:
        exists = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout="container",
            stderr="",
        )
        failed_remove = subprocess.CompletedProcess(
            args=(),
            returncode=1,
            stdout="",
            stderr="daemon unavailable",
        )
        with patch.object(
            remote_control.subprocess,
            "run",
            side_effect=(exists, failed_remove),
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "daemon unavailable",
            ):
                remote_control._docker_remove("runtime-cell")

    def test_prune_never_removes_the_active_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            runtime_root = home / ".cache" / "runtime"
            cell_root = runtime_root / "desktop-linux-native"
            active = cell_root / "runs" / "active-run"
            stale = cell_root / "runs" / "stale-run"
            active.mkdir(parents=True)
            stale.mkdir()
            old = 1_000_000_000
            os.utime(active, (old, old))
            os.utime(stale, (old, old))
            remote_control._write_json(
                cell_root / "lease" / "lease.json",
                {"runId": "active-run"},
            )
            args = argparse.Namespace(
                runtime_root=".cache/runtime",
                cache_root=".cache/build",
                retention_days=1,
            )

            with patch.dict(os.environ, {"HOME": str(home)}), patch(
                "sys.stdout",
            ):
                self.assertEqual(remote_control.prune(args), 0)

            self.assertTrue(active.is_dir())
            self.assertFalse(stale.exists())

    def test_prune_removes_only_wholly_stale_cache_units(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cache_root = home / ".cache" / "build"
            active_cache = cache_root / "active-cache"
            stale_cache = cache_root / "stale-cache"
            active_cache.mkdir(parents=True)
            stale_cache.mkdir()
            old_file = active_cache / "old-package"
            recent_file = active_cache / "recent-package"
            stale_file = stale_cache / "package"
            for path in (old_file, recent_file, stale_file):
                path.write_text("cache\n", encoding="utf-8")
            old = time.time() - (2 * 86400)
            os.utime(old_file, (old, old))
            os.utime(stale_file, (old, old))
            os.utime(stale_cache, (old, old))
            args = argparse.Namespace(
                runtime_root=".cache/runtime",
                cache_root=".cache/build",
                retention_days=1,
            )
            output = io.StringIO()

            with patch.dict(os.environ, {"HOME": str(home)}), patch(
                "sys.stdout",
                output,
            ):
                self.assertEqual(remote_control.prune(args), 0)

            payload = json.loads(output.getvalue())
            self.assertTrue(old_file.is_file())
            self.assertTrue(recent_file.is_file())
            self.assertFalse(stale_cache.exists())
            self.assertEqual(payload["removedCacheEntries"], ["stale-cache"])
            self.assertEqual(payload["removedCacheFiles"], 1)

    def test_prune_does_not_scan_fresh_cache_units(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            fresh_cache = home / ".cache" / "build" / "fresh-cache"
            fresh_cache.mkdir(parents=True)
            (fresh_cache / "package").write_text("cache\n", encoding="utf-8")
            args = argparse.Namespace(
                runtime_root=".cache/runtime",
                cache_root=".cache/build",
                retention_days=1,
            )

            with patch.dict(os.environ, {"HOME": str(home)}), patch(
                "sys.stdout",
            ), patch.object(
                remote_control,
                "_cache_entry_stats",
                side_effect=AssertionError("fresh cache must not be scanned"),
            ):
                self.assertEqual(remote_control.prune(args), 0)

            self.assertTrue(fresh_cache.is_dir())


if __name__ == "__main__":
    unittest.main()
