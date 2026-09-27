from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/acceptance-prove.py"


def load_script():
    spec = importlib.util.spec_from_file_location("acceptance_prove", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceProveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_script()

    def test_extracts_explicit_manifest_after_progress_events(self) -> None:
        stdout = "\n".join(
            (
                '{"event":"tuple-pass","index":1}',
                "{",
                '  "manifest": "/tmp/artifacts/ws/gate/run/manifest.json",',
                '  "proofStatus": "CANDIDATE"',
                "}",
            )
        )

        self.assertEqual(
            self.module._producer_manifest_path(stdout),
            Path("/tmp/artifacts/ws/gate/run/manifest.json").resolve(),
        )

    def test_builds_candidate_ref_from_exact_evidence_store_path(self) -> None:
        gate_id = "agent-v2-home-command-center-e2e"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = (
                root
                / "0123456789abcdef"
                / gate_id
                / "20260923T000000000000Z-0123456789abcdef0123456789abcdef"
                / "manifest.json"
            )
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(
                json.dumps(
                    {
                        "artifactKind": "acceptance-run-manifest",
                        "gateId": gate_id,
                        "result": {"proofStatus": "CANDIDATE"},
                    },
                    sort_keys=True,
                ),
                encoding="utf-8",
            )

            reference = self.module._candidate_ref_from_manifest(
                manifest_path,
                gate_id=gate_id,
                artifact_root=root,
            )
            expected_hash = hashlib.sha256(manifest_path.read_bytes()).hexdigest()

        self.assertEqual(reference.workspace_id, "0123456789abcdef")
        self.assertEqual(reference.gate_id, gate_id)
        self.assertEqual(reference.path, "manifest.json")
        self.assertEqual(reference.sha256, expected_hash)


if __name__ == "__main__":
    unittest.main()
