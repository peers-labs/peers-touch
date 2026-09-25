#!/usr/bin/env python3

import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Optional


MODULE_PATH = Path(__file__).with_name("cargo_gc.py")
SPEC = importlib.util.spec_from_file_location("pt_debug_cargo_gc", MODULE_PATH)
assert SPEC and SPEC.loader
CARGO_GC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CARGO_GC
SPEC.loader.exec_module(CARGO_GC)


class CargoGraphFixture:
    def __init__(self, root: Path):
        self.root = root
        self.profile = root / "target/debug"
        self.manifest = root / "Cargo.toml"
        self.manifest.parent.mkdir(parents=True, exist_ok=True)
        self.manifest.write_text(
            '[package]\nname = "app"\nversion = "0.1.0"\n',
            encoding="utf-8",
        )

    def unit(
        self,
        package: str,
        artifact_hash: str,
        marker: str,
        short_hash: str,
        dependencies=None,
        age_days: int = 0,
        profile: Optional[Path] = None,
    ) -> Path:
        profile = profile or self.profile
        directory = profile / ".fingerprint" / f"{package}-{artifact_hash}"
        directory.mkdir(parents=True, exist_ok=True)
        payload = {
            "features": "[]",
            "target": 1,
            "profile": 2,
            "path": 3,
            "deps": [
                [
                    index + 1,
                    name,
                    False,
                    int.from_bytes(bytes.fromhex(dep_short), "little"),
                ]
                for index, (name, dep_short) in enumerate(dependencies or [])
            ],
        }
        json_path = directory / f"{marker}.json"
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        (directory / marker).write_text(short_hash, encoding="utf-8")
        (directory / "invoked.timestamp").write_text(
            "This file has an mtime of when this was started.",
            encoding="utf-8",
        )
        timestamp = time.time() - age_days * 86400
        for path in directory.iterdir():
            os.utime(path, (timestamp, timestamp))
        return directory

    def artifact(
        self,
        family: str,
        artifact_hash: str,
        suffix: str = ".rlib",
        size: int = 4096,
        profile: Optional[Path] = None,
    ) -> Path:
        profile = profile or self.profile
        path = profile / "deps" / f"{family}-{artifact_hash}{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * size)
        return path


class CargoGraphTest(unittest.TestCase):
    def test_integration_test_fingerprint_is_retained_as_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "test-integration-test-api",
                "0101010101010101",
                age_days=30,
            )
            fixture.artifact(
                "api",
                "1111111111111111",
                suffix="",
            )

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "proven")
            self.assertEqual(report["candidate_groups"], 0)
            self.assertEqual(report["retained_root_units"], 1)

    def test_unknown_non_build_marker_for_root_package_is_retained(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "doc-lib-app",
                "0101010101010101",
                age_days=30,
            )

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "proven")
            self.assertEqual(report["candidate_groups"], 0)
            self.assertEqual(report["retained_root_units"], 1)

    def test_empty_fingerprint_directory_blocks_graph_cleanup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "bin-app",
                "0101010101010101",
            )
            (
                fixture.profile
                / ".fingerprint/broken-2222222222222222"
            ).mkdir(parents=True)

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "unproven")
            self.assertEqual(report["groups"], [])

    def test_symlinked_fingerprint_root_blocks_graph_cleanup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.profile.mkdir(parents=True)
            outside = fixture.root / "outside-fingerprints"
            outside.mkdir()
            (fixture.profile / ".fingerprint").symlink_to(
                outside,
                target_is_directory=True,
            )

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "unproven")
            self.assertEqual(report["groups"], [])

    def test_invalid_fingerprint_json_blocks_generation_cleanup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "bin-app",
                "0101010101010101",
            )
            fixture.unit(
                "app",
                "2222222222222222",
                "bin-app",
                "0202020202020202",
                age_days=30,
            )
            invalid = (
                fixture.profile
                / ".fingerprint/broken-3333333333333333/lib-broken.json"
            )
            invalid.parent.mkdir(parents=True)
            invalid.write_text("{", encoding="utf-8")

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "unproven")
            self.assertEqual(report["groups"], [])

    def test_cross_target_root_keeps_host_build_dependency_live(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            host_profile = fixture.profile
            target_profile = fixture.root / "target/aarch64-apple-ios-sim/debug"
            fixture.unit(
                "build-helper",
                "1111111111111111",
                "lib-build_helper",
                "0101010101010101",
                profile=host_profile,
            )
            fixture.unit(
                "build-helper",
                "2222222222222222",
                "lib-build_helper",
                "0202020202020202",
                age_days=30,
                profile=host_profile,
            )
            fixture.unit(
                "app",
                "3333333333333333",
                "lib-app",
                "0303030303030303",
                dependencies=[("build_helper", "0101010101010101")],
                profile=target_profile,
            )
            fixture.artifact(
                "libbuild_helper",
                "1111111111111111",
                profile=host_profile,
            )
            fixture.artifact(
                "libbuild_helper",
                "2222222222222222",
                profile=host_profile,
            )
            fixture.artifact(
                "libapp",
                "3333333333333333",
                profile=target_profile,
            )

            analysis = CARGO_GC.analyze_profiles(
                [host_profile, target_profile],
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            host_report = next(
                report
                for report in analysis["profiles"]
                if Path(report["profile"])
                == Path(os.path.abspath(str(host_profile)))
            )
            candidate_ids = {group["id"] for group in host_report["groups"]}
            self.assertNotIn("build-helper-1111111111111111", candidate_ids)
            self.assertIn("build-helper-2222222222222222", candidate_ids)

    def test_current_root_closure_protects_live_units_and_finds_old_groups(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "dep",
                "1111111111111111",
                "lib-dep",
                "0101010101010101",
            )
            fixture.unit(
                "app",
                "2222222222222222",
                "bin-app",
                "0202020202020202",
                dependencies=[("dep", "0101010101010101")],
            )
            fixture.unit(
                "dep",
                "3333333333333333",
                "lib-dep",
                "0303030303030303",
                age_days=30,
            )
            fixture.unit(
                "app",
                "4444444444444444",
                "bin-app",
                "0404040404040404",
                dependencies=[("dep", "0303030303030303")],
                age_days=30,
            )
            fixture.artifact("libdep", "1111111111111111")
            fixture.artifact("app", "2222222222222222", suffix="")
            fixture.artifact("libdep", "3333333333333333")
            fixture.artifact("app", "4444444444444444", suffix="")

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "proven")
            self.assertEqual(report["candidate_groups"], 2)
            candidate_ids = {group["id"] for group in report["groups"]}
            self.assertEqual(
                candidate_ids,
                {"app-4444444444444444", "dep-3333333333333333"},
            )
            self.assertGreater(report["conservative_reclaim_bytes"], 0)

            cleanup_report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
                include_paths=True,
            )
            self.assertTrue(
                all("_path_objects" in group for group in cleanup_report["groups"])
            )

    def test_unresolved_dependency_name_protects_all_matching_units(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "missing",
                "1111111111111111",
                "lib-missing",
                "0101010101010101",
                age_days=30,
            )
            fixture.unit(
                "app",
                "2222222222222222",
                "bin-app",
                "0202020202020202",
                dependencies=[("missing", "ffffffffffffffff")],
            )
            fixture.artifact("libmissing", "1111111111111111")

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "conservative")
            self.assertIn("missing", report["unresolved_dependency_names"])
            self.assertEqual(report["candidate_groups"], 0)

    def test_unmapped_dependency_blocks_entire_graph(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "bin-app",
                "0101010101010101",
                dependencies=[("absent", "ffffffffffffffff")],
            )
            fixture.unit(
                "old",
                "2222222222222222",
                "lib-old",
                "0202020202020202",
                age_days=30,
            )

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            self.assertEqual(report["status"], "unproven")
            self.assertEqual(report["groups"], [])

    def test_open_candidate_is_reported_but_not_cleanup_enabled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "bin-app",
                "0101010101010101",
            )
            fixture.unit(
                "app",
                "2222222222222222",
                "bin-app",
                "0202020202020202",
                age_days=30,
            )
            opened = fixture.artifact("app", "2222222222222222", suffix="")

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
                opened={opened.resolve()},
            )

            self.assertEqual(report["candidate_groups"], 1)
            self.assertEqual(report["cleanup_enabled_groups"], 0)
            self.assertTrue(report["groups"][0]["contains_open_file"])

    def test_shared_candidate_inode_is_counted_once(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = CargoGraphFixture(Path(temp_dir))
            fixture.unit(
                "app",
                "1111111111111111",
                "bin-app",
                "0101010101010101",
            )
            fixture.unit(
                "old-a",
                "2222222222222222",
                "lib-old_a",
                "0202020202020202",
                age_days=30,
            )
            fixture.unit(
                "old-b",
                "3333333333333333",
                "lib-old_b",
                "0303030303030303",
                age_days=30,
            )
            first = fixture.artifact("libold_a", "2222222222222222")
            second = (
                fixture.profile
                / "deps/libold_b-3333333333333333.rlib"
            )
            os.link(first, second)

            report = CARGO_GC.analyze_profile(
                fixture.profile,
                fixture.manifest,
                time.time() - 14 * 86400,
                keep_generations=1,
            )

            artifact_blocks = first.stat().st_blocks * 512
            group_reclaim = sum(
                group["conservative_reclaim_bytes"]
                for group in report["groups"]
            )
            group_upper = sum(
                group["allocated_upper_bound_bytes"]
                for group in report["groups"]
            )
            self.assertGreaterEqual(
                group_upper - group_reclaim,
                artifact_blocks,
            )
            self.assertGreaterEqual(
                report["batch_reclaim_bytes"] - group_reclaim,
                artifact_blocks,
            )


if __name__ == "__main__":
    unittest.main()
