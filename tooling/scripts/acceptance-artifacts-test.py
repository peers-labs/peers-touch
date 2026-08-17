from __future__ import annotations

import tempfile
import unittest
from os import environ
from pathlib import Path
from unittest.mock import patch

from _acceptance_artifacts import (
    REPO_ROOT,
    artifact_session,
    explicit_output_path,
    latest_artifact,
    replace_resolved_artifact_paths,
)
from tooling.acceptance.core.errors import EvidenceRootForbidden


class AcceptanceArtifactHelpersTest(unittest.TestCase):
    def test_explicit_output_rejects_repository_paths(self) -> None:
        with self.assertRaises(EvidenceRootForbidden):
            explicit_output_path(REPO_ROOT / "tooling/output.json")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.json"
            self.assertEqual(explicit_output_path(output), output.resolve())

    def test_resolved_paths_are_replaced_with_typed_refs(self) -> None:
        reference = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "0123456789abcdef",
            "gateId": "source-gate",
            "runId": (
                "20260817T000000000000Z-"
                "0123456789abcdef0123456789abcdef"
            ),
            "path": "reports/source.json",
            "sha256": "0" * 64,
            "mediaType": "application/json",
        }
        physical = "/external/artifacts/source.json"
        value = {
            "sourceArtifact": physical,
            "nested": [{"path": physical}],
            "fixture": "/external/fixture.json",
        }

        replaced = replace_resolved_artifact_paths(
            value,
            {physical: reference},
        )

        self.assertEqual(replaced["sourceArtifact"], reference)
        self.assertEqual(replaced["nested"][0]["path"], reference)
        self.assertEqual(replaced["fixture"], "/external/fixture.json")

    def test_latest_artifact_returns_one_resolved_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            environ,
            {"PT_ACCEPTANCE_ARTIFACT_ROOT": directory},
            clear=True,
        ):
            with artifact_session("source-gate") as session:
                expected = session.write_json(
                    "reports/source.json",
                    {"status": "passed"},
                    role="report",
                )
                session.complete(
                    status="passed",
                    completion_status="DONE",
                    proof_status="PROVEN",
                )
            path, reference = latest_artifact(
                "source-gate",
                "report",
            )

        self.assertEqual(reference, expected.to_dict())
        self.assertEqual(path.name, "source.json")


if __name__ == "__main__":
    unittest.main()
