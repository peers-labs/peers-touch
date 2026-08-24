from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core import REPO_ROOT, RuntimeCellContract
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.provisioners.native_desktop_linux import (
    _BASE_IMAGE_DIGEST,
    LinuxCellProfile,
    NativeDesktopLinuxProvisioner,
    _digest,
    _stop_tunnel_process,
)


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
        self.assertIn("libprotobuf-dev", source)
        self.assertIn("libwebkit2gtk-4.1-dev", source)
        self.assertIn("xserver-xorg-video-dummy", source)
        self.assertIn("x11vnc", source)
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
            self.assertIn(f"acceptance-cell-{action}:", source)
            self.assertIn(
                f"acceptance-cell.py {action} --cell",
                source,
            )


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
            "retention_days": 14,
        }
        return argparse.Namespace(**values)

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


if __name__ == "__main__":
    unittest.main()
