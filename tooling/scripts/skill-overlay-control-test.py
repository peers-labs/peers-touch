from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTROL = REPO_ROOT / "tooling/scripts/skill-overlay-control.py"


class SkillOverlayControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.machine_root = self.root / "machine"
        self.sources = self.root / "sources"
        self.sources.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def create_overlay(
        self,
        name: str = "english",
        *,
        priority: int = 100,
        body: str = "# English Overlay\n\nTransform input.\n",
        manifest_updates: dict[str, object] | None = None,
    ) -> Path:
        source = self.sources / name
        source.mkdir()
        (source / "SKILL.md").write_text(
            (
                "---\n"
                f"name: {name}\n"
                f"description: Apply {name} interaction preferences when pt-ew resolves it.\n"
                "---\n\n"
                f"{body}"
            ),
            encoding="utf-8",
        )
        manifest: dict[str, object] = {
            "kind": "peers-touch-skill-overlay",
            "name": name,
            "target": "pt-ew",
            "entry": "SKILL.md",
            "priority": priority,
        }
        manifest.update(manifest_updates or {})
        (source / "overlay.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return source

    def command(self, *arguments: str, expected: int = 0) -> dict[str, object]:
        environment = {
            **os.environ,
            "PT_MACHINE_DEV_ROOT": str(self.machine_root),
        }
        completed = subprocess.run(
            [sys.executable, str(CONTROL), *arguments],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
        self.assertEqual(
            completed.returncode,
            expected,
            msg=f"stdout={completed.stdout}\nstderr={completed.stderr}",
        )
        return json.loads(completed.stdout if expected == 0 else completed.stderr)

    def source_digest(self, source: Path) -> str:
        entries = []
        for candidate in sorted(path for path in source.rglob("*") if path.is_file()):
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(source).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
        serialized = json.dumps(
            entries,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        return hashlib.sha256(serialized).hexdigest()

    def test_install_resolve_disable_enable_and_uninstall(self) -> None:
        source = self.create_overlay()
        installed = self.command("install", "--source", str(source))
        self.assertEqual(installed["status"], "INSTALLED")
        self.assertTrue(Path(installed["skillPath"]).is_file())

        resolved = self.command("resolve", "--target", "pt-ew")
        self.assertEqual([item["name"] for item in resolved["overlays"]], ["english"])

        self.command("disable", "english")
        self.assertEqual(
            self.command("resolve", "--target", "pt-ew")["overlays"],
            [],
        )
        self.command("enable", "english")
        self.assertEqual(
            self.command("resolve", "--target", "pt-ew")["overlays"][0]["name"],
            "english",
        )

        self.command("uninstall", "english")
        self.assertEqual(self.command("list")["overlays"], [])
        self.assertFalse(
            (self.machine_root / "skill-overlays/store/english").exists()
        )

    def test_install_uses_immutable_copy_and_requires_explicit_replace(self) -> None:
        source = self.create_overlay()
        first = self.command("install", "--source", str(source))
        first_skill = Path(first["skillPath"])
        original = first_skill.read_text(encoding="utf-8")

        (source / "SKILL.md").write_text(
            original.replace("Transform input.", "Transform input naturally."),
            encoding="utf-8",
        )
        self.assertEqual(first_skill.read_text(encoding="utf-8"), original)

        conflict = self.command(
            "install",
            "--source",
            str(source),
            expected=2,
        )
        self.assertEqual(conflict["error"]["code"], "OVERLAY_NAME_CONFLICT")

        replacement = self.command(
            "install",
            "--source",
            str(source),
            "--replace",
        )
        self.assertNotEqual(
            replacement["overlay"]["digest"],
            first["overlay"]["digest"],
        )
        self.assertFalse(first_skill.parent.exists())

    def test_resolve_orders_enabled_overlays_by_priority_then_name(self) -> None:
        later = self.create_overlay("later", priority=200)
        alpha = self.create_overlay("alpha", priority=100)
        beta = self.create_overlay("beta", priority=100)
        for source in (later, beta, alpha):
            self.command("install", "--source", str(source))

        resolved = self.command("resolve")
        self.assertEqual(
            [item["name"] for item in resolved["overlays"]],
            ["alpha", "beta", "later"],
        )

    def test_rejects_manifest_versions_and_unknown_fields(self) -> None:
        source = self.create_overlay(
            manifest_updates={"schemaVersion": 1},
        )
        result = self.command(
            "install",
            "--source",
            str(source),
            expected=2,
        )
        self.assertEqual(result["error"]["code"], "OVERLAY_MANIFEST_INVALID")

    @unittest.skipIf(os.name == "nt", "symlink creation requires privileges on Windows")
    def test_rejects_source_symlinks(self) -> None:
        source = self.create_overlay()
        (source / "linked.txt").symlink_to(source / "SKILL.md")
        result = self.command(
            "install",
            "--source",
            str(source),
            expected=2,
        )
        self.assertEqual(result["error"]["code"], "OVERLAY_SOURCE_INVALID")

    @unittest.skipIf(os.name == "nt", "symlink creation requires privileges on Windows")
    def test_rejects_manifest_symlink_before_parsing(self) -> None:
        source = self.create_overlay()
        external = self.root / "external-overlay.json"
        external.write_text(
            (source / "overlay.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (source / "overlay.json").unlink()
        (source / "overlay.json").symlink_to(external)

        result = self.command(
            "install",
            "--source",
            str(source),
            expected=2,
        )
        self.assertEqual(result["error"]["code"], "OVERLAY_SOURCE_INVALID")

    def test_resolve_fails_closed_when_installed_copy_is_modified(self) -> None:
        source = self.create_overlay()
        installed = self.command("install", "--source", str(source))
        Path(installed["skillPath"]).write_text("tampered\n", encoding="utf-8")

        result = self.command("resolve", expected=2)
        self.assertEqual(result["error"]["code"], "OVERLAY_SKILL_INVALID")

    def test_corrupt_preexisting_digest_path_is_not_published(self) -> None:
        source = self.create_overlay()
        digest = self.source_digest(source)
        destination = (
            self.machine_root / "skill-overlays/store/english" / digest
        )
        destination.mkdir(parents=True)
        (destination / "overlay.json").write_bytes(
            (source / "overlay.json").read_bytes()
        )
        (destination / "SKILL.md").write_text("tampered\n", encoding="utf-8")

        result = self.command(
            "install",
            "--source",
            str(source),
            expected=2,
        )
        self.assertEqual(result["error"]["code"], "OVERLAY_SKILL_INVALID")
        self.assertFalse(
            (self.machine_root / "skill-overlays/registry.json").exists()
        )

    def test_rejects_malformed_registry(self) -> None:
        registry = self.machine_root / "skill-overlays/registry.json"
        registry.parent.mkdir(parents=True)
        registry.write_text('{"schemaVersion": 1}\n', encoding="utf-8")

        result = self.command("list", expected=2)
        self.assertEqual(result["error"]["code"], "OVERLAY_REGISTRY_INVALID")


if __name__ == "__main__":
    unittest.main()
