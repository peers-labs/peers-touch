#!/usr/bin/env python3

import importlib.util
import io
import os
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("scan.py")
SPEC = importlib.util.spec_from_file_location("pt_debug_space_scan", MODULE_PATH)
assert SPEC and SPEC.loader
SCAN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SCAN
SPEC.loader.exec_module(SCAN)


class DemandTest(unittest.TestCase):
    def test_process_report_does_not_expose_command_or_environment(self):
        report = SCAN.process_for_report(
            {
                "pid": 42,
                "name": "cargo",
                "cwd": "/tmp/worktree",
                "command": "TOKEN=secret cargo build",
            }
        )

        self.assertNotIn("command", report)
        self.assertEqual(report["classes"], ["cargo_writer"])
        self.assertTrue(SCAN.writer_state([report])["cargo"])

    def test_desktop_task_does_not_keep_mobile_platforms(self):
        demand = SCAN.infer_demand(
            [],
            [
                {
                    "taskId": "CHAT-03-direct",
                    "purpose": "Close direct chat on Desktop",
                    "sourceClaims": [
                        {"pathPrefix": "apps/desktop"},
                        {"pathPrefix": "apps/station/app/subserver/conversation"},
                    ],
                }
            ],
            [],
        )
        writers = {"cargo": False, "ios": False, "android": False, "node": False}
        desktop = {
            "kind": "cargo_profile",
            "domain": "desktop_native",
            "cargo": True,
        }
        ios = {
            "kind": "cargo_target",
            "domain": "ios_sim",
            "cargo": True,
        }

        self.assertEqual(
            SCAN.classify_component(desktop, demand, True, writers)[0],
            "keep_hot",
        )
        self.assertEqual(
            SCAN.classify_component(ios, demand, True, writers)[0],
            "current_task_irrelevant",
        )

    def test_ios_dirty_path_keeps_ios_hot_and_android_irrelevant(self):
        demand = SCAN.infer_demand(
            [
                "apps/mobile/src-tauri/plugins/secure-storage/ios/Sources/Plugin.swift",
                "apps/mobile/src-tauri/src/platform/secure_storage/ios_keychain.rs",
            ],
            [],
            [],
        )
        writers = {"cargo": False, "ios": False, "android": False, "node": False}
        ios = {"kind": "cargo_target", "domain": "ios_sim", "cargo": True}
        android = {"kind": "cargo_target", "domain": "android", "cargo": True}

        self.assertEqual(
            SCAN.classify_component(ios, demand, True, writers)[0],
            "keep_hot",
        )
        self.assertEqual(
            SCAN.classify_component(android, demand, True, writers)[0],
            "current_task_irrelevant",
        )

    def test_shared_mobile_rust_keeps_native_platforms_warm(self):
        demand = SCAN.infer_demand(
            ["apps/mobile/src-tauri/src/runtime/command_ledger/mod.rs"],
            [],
            [],
        )
        writers = {"cargo": False, "ios": False, "android": False, "node": False}
        host = {"kind": "cargo_profile", "domain": "mobile_host", "cargo": True}
        ios = {"kind": "cargo_target", "domain": "ios_sim", "cargo": True}
        android = {"kind": "cargo_target", "domain": "android", "cargo": True}

        self.assertEqual(
            SCAN.classify_component(host, demand, True, writers)[0],
            "keep_hot",
        )
        self.assertEqual(
            SCAN.classify_component(ios, demand, True, writers)[0],
            "keep_warm",
        )
        self.assertEqual(
            SCAN.classify_component(android, demand, True, writers)[0],
            "keep_warm",
        )

    def test_mobile_web_only_does_not_keep_native_targets(self):
        demand = SCAN.infer_demand(
            ["apps/mobile/src/components/MobileShell.tsx"],
            [],
            [],
        )
        writers = {"cargo": False, "ios": False, "android": False, "node": False}
        host = {"kind": "cargo_profile", "domain": "mobile_host", "cargo": True}
        node = {"kind": "node_modules", "domain": "node", "cargo": False}

        self.assertEqual(
            SCAN.classify_component(host, demand, True, writers)[0],
            "current_task_irrelevant",
        )
        self.assertEqual(
            SCAN.classify_component(node, demand, True, writers)[0],
            "keep_hot",
        )

    def test_cargo_manifest_change_keeps_rust_domains_warm(self):
        demand = SCAN.infer_demand(
            ["packages/messaging-core/Cargo.toml"],
            [],
            [],
        )

        self.assertEqual(demand["desktop_native"]["level"], 1)
        self.assertEqual(demand["mobile_host"]["level"], 1)
        self.assertEqual(demand["ios_sim"]["level"], 1)
        self.assertEqual(demand["android"]["level"], 1)

    def test_cargo_writer_blocks_only_cargo_components(self):
        writers = {"cargo": True, "ios": False, "android": False, "node": False}
        cargo = {"kind": "cargo_target", "domain": "android", "cargo": True}
        gradle = {"kind": "android_build", "domain": "android", "cargo": False}

        self.assertEqual(
            SCAN.classify_component(cargo, {}, False, writers)[0],
            "blocked",
        )
        self.assertEqual(
            SCAN.classify_component(gradle, {}, False, writers)[0],
            "derived_idle",
        )


class ComponentTest(unittest.TestCase):
    def artifact(
        self,
        profile: Path,
        family: str,
        artifact_hash: str,
        suffix: str,
        age_days: int,
        executable: bool = False,
    ) -> Path:
        path = profile / "deps" / f"{family}-{artifact_hash}{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * 4096)
        if executable:
            path.chmod(0o755)
        timestamp = time.time() - age_days * 86400
        os.utime(path, (timestamp, timestamp))
        return path

    def test_mobile_target_is_split_by_platform_and_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "peers-example"
            target = root / "apps/mobile/src-tauri/target"
            (target / "debug/deps").mkdir(parents=True)
            (target / "aarch64-apple-ios-sim/debug").mkdir(parents=True)
            (target / "aarch64-apple-ios/debug").mkdir(parents=True)
            (target / "x86_64-linux-android/debug").mkdir(parents=True)
            (target / "ios-proof").mkdir(parents=True)
            (target / "ios-proof/screenshot.png").write_bytes(b"proof")

            components = SCAN.discover_components(root, root.name, "workspace")
            by_id = {item["id"]: item for item in components}
            owner = f"{root.name}@workspace"

            self.assertIn(f"{owner}:mobile-host-cargo-debug", by_id)
            self.assertIn(
                f"{owner}:mobile-ios-simulator-aarch64-apple-ios-sim",
                by_id,
            )
            self.assertIn(
                f"{owner}:mobile-ios-device-aarch64-apple-ios",
                by_id,
            )
            self.assertIn(
                f"{owner}:mobile-android-x86_64-linux-android",
                by_id,
            )
            self.assertEqual(
                by_id[f"{owner}:mobile-target-evidence"]["kind"],
                "evidence",
            )

    def test_symlinked_cargo_profile_is_blocked(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "peers-example"
            outside = Path(temp_dir) / "outside"
            outside.mkdir()
            target = root / "apps/desktop/src-tauri/target"
            target.mkdir(parents=True)
            (target / "debug").symlink_to(outside, target_is_directory=True)

            components = SCAN.discover_components(
                root,
                root.name,
                "workspace",
            )
            item = next(
                component
                for component in components
                if component["kind"] == "symlink"
            )
            writers = {
                "cargo": False,
                "ios": False,
                "android": False,
                "node": False,
            }

            self.assertEqual(
                SCAN.classify_component(item, {}, False, writers)[0],
                "blocked",
            )
            with self.assertRaisesRegex(RuntimeError, "symbolic link"):
                SCAN.validate_cleanup_path(
                    target / "debug/deps/example",
                    root,
                )

    def test_component_ids_include_workspace_identity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            first = Path(temp_dir) / "first/shared-name"
            second = Path(temp_dir) / "second/shared-name"
            (first / "apps/desktop/src-tauri/target/debug").mkdir(parents=True)
            (second / "apps/desktop/src-tauri/target/debug").mkdir(parents=True)

            first_ids = {
                item["id"]
                for item in SCAN.discover_components(
                    first,
                    first.name,
                    "workspace-a",
                )
            }
            second_ids = {
                item["id"]
                for item in SCAN.discover_components(
                    second,
                    second.name,
                    "workspace-b",
                )
            }

            self.assertTrue(first_ids)
            self.assertTrue(second_ids)
            self.assertTrue(first_ids.isdisjoint(second_ids))

    def test_old_extensionless_test_binary_is_safe_candidate(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            profile = Path(temp_dir) / "target/debug"
            binary = self.artifact(
                profile,
                "sample",
                "1234567890abcdef",
                "",
                age_days=8,
                executable=True,
            )
            component = {
                "kind": "cargo_profile",
                "cargo": True,
                "class": "keep_hot",
                "paths": [str(profile)],
            }

            self.assertEqual(
                SCAN.old_test_binaries(
                    [component],
                    time.time() - 7 * 86400,
                    set(),
                ),
                [binary],
            )

    def test_locked_revalidation_drops_rebuilt_test_binary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            profile = Path(temp_dir) / "target/debug"
            binary = self.artifact(
                profile,
                "sample",
                "1234567890abcdef",
                "",
                age_days=8,
                executable=True,
            )
            component = {
                "kind": "cargo_profile",
                "cargo": True,
                "class": "keep_hot",
                "paths": [str(profile)],
            }
            now = time.time()
            os.utime(binary, (now, now))

            self.assertEqual(
                SCAN.old_test_binaries(
                    [component],
                    time.time() - 7 * 86400,
                    set(),
                ),
                [],
            )

    def test_descriptor_cleanup_does_not_follow_child_symlink(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "worktree"
            profile = root / "target/debug"
            group = profile / "deps/old-generation"
            outside = Path(temp_dir) / "outside"
            group.mkdir(parents=True)
            outside.mkdir()
            protected = outside / "protected"
            protected.write_text("keep", encoding="utf-8")
            (group / "external").symlink_to(outside, target_is_directory=True)
            directory_fd = SCAN.open_directory_beneath(root, profile)
            try:
                SCAN.remove_beneath(
                    directory_fd,
                    Path("deps/old-generation"),
                )
            finally:
                os.close(directory_fd)

            self.assertTrue(protected.is_file())
            self.assertFalse(group.exists())

    def test_descriptor_cleanup_rejects_symlinked_ancestor(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "worktree"
            profile = root / "target/debug"
            outside = Path(temp_dir) / "outside"
            profile.mkdir(parents=True)
            outside.mkdir()
            protected = outside / "protected"
            protected.write_text("keep", encoding="utf-8")
            (profile / "deps").symlink_to(outside, target_is_directory=True)
            directory_fd = SCAN.open_directory_beneath(root, profile)
            try:
                with self.assertRaises(OSError):
                    SCAN.remove_beneath(
                        directory_fd,
                        Path("deps/protected"),
                    )
            finally:
                os.close(directory_fd)

            self.assertTrue(protected.is_file())

    def test_locked_profile_identity_detects_directory_replacement(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "worktree"
            profile = root / "target/debug"
            profile.mkdir(parents=True)
            locks, blocked = SCAN.cargo_locks([profile], root)
            self.assertIsNone(blocked)
            moved = root / "target/debug-old"
            profile.rename(moved)
            profile.mkdir()
            try:
                with self.assertRaisesRegex(RuntimeError, "identity changed"):
                    SCAN.verify_locked_profile_identity(locks)
            finally:
                SCAN.release_cargo_locks(locks)

    def test_rebuildable_generation_keeps_latest_four(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            profile = Path(temp_dir) / "target/debug"
            hashes = [f"{index:016x}" for index in range(1, 7)]
            for index, artifact_hash in enumerate(hashes):
                age = 30 - index
                self.artifact(profile, "sample", artifact_hash, "", age, True)
                self.artifact(profile, "sample", artifact_hash, ".d", age)
                self.artifact(profile, "sample", artifact_hash, ".rcgu.o", age)
            component = {
                "kind": "cargo_profile",
                "cargo": True,
                "paths": [str(profile)],
            }

            deps, build, incremental, counts = SCAN.rust_rebuildable_candidates(
                [component],
                time.time() - 14 * 86400,
                keep_generations=4,
            )

            self.assertEqual(counts["deps"], 2)
            self.assertEqual(build, [])
            self.assertEqual(incremental, [])
            self.assertEqual(len(deps), 4)
            self.assertTrue(all(path.suffix for path in deps))

    def test_allocated_size_deduplicates_hardlinks(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            first = Path(temp_dir) / "first"
            second = Path(temp_dir) / "second"
            first.write_bytes(b"x" * 4096)
            os.link(first, second)

            self.assertEqual(
                SCAN.allocated_tree_bytes([first, second]),
                first.stat().st_blocks * 512,
            )

    def test_evidence_is_never_a_clean_candidate(self):
        item = {"kind": "evidence", "domain": "evidence", "cargo": False}
        writers = {"cargo": False, "ios": False, "android": False, "node": False}

        self.assertEqual(
            SCAN.classify_component(item, {}, False, writers)[0],
            "evidence_review",
        )

class CliTest(unittest.TestCase):
    def test_rust_generation_cleanup_uses_locked_descriptor_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "shared-name"
            profile = root / "target/debug"
            artifact = profile / "deps/app-deadbeefdeadbeef.rlib"
            fingerprint = (
                profile / ".fingerprint/app-deadbeefdeadbeef"
            )
            artifact.parent.mkdir(parents=True)
            fingerprint.mkdir(parents=True)
            artifact.write_bytes(b"artifact")
            (fingerprint / "bin-app").write_text(
                "0101010101010101",
                encoding="utf-8",
            )
            cleanup_id = (
                "shared-name@workspace-root:desktop-cargo-debug:"
                "rust:debug:app-deadbeefdeadbeef"
            )
            item = {
                "id": "shared-name@workspace-root:desktop-cargo-debug",
                "class": "derived_idle",
                "cargo": True,
                "kind": "cargo_profile",
                "manifest_path": str(root / "Cargo.toml"),
                "paths": [str(profile)],
            }
            worktree = {
                "name": "shared-name",
                "root": str(root),
                "current": False,
                "components": [item],
                "current_reasons": {"processes": []},
            }
            args = SimpleNamespace(
                clean_rust_group_id=cleanup_id,
                worktree=None,
                generation_age_days=14,
                keep_generations=4,
                repo_root=root,
            )
            graph = {
                "profiles": [
                    {
                        "profile": str(profile),
                        "groups": [
                            {
                                "id": "app-deadbeefdeadbeef",
                                "cleanup_enabled": True,
                                "reason": "unreachable",
                                "_path_objects": [artifact, fingerprint],
                                "allocated_upper_bound_bytes": 4096,
                                "conservative_reclaim_bytes": 4096,
                            }
                        ],
                    }
                ]
            }

            with patch.object(
                SCAN,
                "scan",
                return_value={"worktrees": [worktree]},
            ), patch.object(
                SCAN,
                "opened_paths",
                return_value=set(),
            ), patch.object(
                SCAN,
                "assert_worktree_inactive",
            ), patch.object(
                SCAN.cargo_gc,
                "analyze_profiles",
                return_value=graph,
            ):
                result = SCAN.clean_rust_group(args)

            self.assertFalse(artifact.exists())
            self.assertFalse(fingerprint.exists())
            self.assertEqual(result["removed_paths"], 2)
            self.assertTrue((profile / ".cargo-lock").is_file())

    def test_required_probe_failure_is_not_treated_as_empty_state(self):
        with self.assertRaises(SCAN.ProbeError):
            SCAN.run_text(
                ["pt-command-that-does-not-exist"],
                required=True,
            )

    def test_clean_requires_confirmation(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                SCAN.parse_args(["--clean-safe"])

    def test_rust_generation_cleanup_requires_alternate_config_acceptance(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                SCAN.parse_args(
                    [
                        "--clean-rust-group-id",
                        "example:desktop-cargo-debug:rust:debug:app-deadbeefdeadbeef",
                        "--confirm",
                    ]
                )

        args = SCAN.parse_args(
            [
                "--clean-rust-group-id",
                "example:desktop-cargo-debug:rust:debug:app-deadbeefdeadbeef",
                "--confirm",
                "--accept-alternate-config-rebuild",
            ]
        )
        self.assertTrue(args.accept_alternate_config_rebuild)

    def test_cleanup_id_resolves_worktree_without_identity_collision(self):
        self.assertEqual(
            SCAN.cleanup_worktree_name(
                "peers-social@0123456789ab:desktop-cargo-debug"
            ),
            "peers-social",
        )


if __name__ == "__main__":
    unittest.main()
