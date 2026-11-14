"""Run the original nine-scenario private Social Suite on prepared Native sessions."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate
from tooling.acceptance.core.evidence_store import current_run_directory, source_identity
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure, selected_native_runtime,
)
from tooling.development.secure_content.prepared_native import PreparedSocialNativeRuntime
from tooling.development.secure_content.runtime_owner import W7RuntimeOwner

from .cross_station_support import (
    SCENARIO_IDS,
    attach_suite_evidence,
    validate_suite_result,
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-native-e2e"
    phase = "CSS-09 Cross-Station Social Native E2E"
    bom = ("CSS-09",)
    spec = (
        "docs/architecture/domains/social/cross-station/integration.md",
        "docs/architecture/domains/social/federation/execution-plans/"
        "20261108-social-completion-native-runner/plan.md",
        "docs/architecture/domains/social/core/acceptance-matrix.md",
    )

    def run(self) -> dict[str, Any]:
        from tooling.acceptance.core import REPO_ROOT, workspace_id
        from pathlib import Path
        selected = selected_native_runtime(self.gate_id)
        if selected is None:
            raise ValueError("private Social requires Runner preparation")
        prepared = PreparedSocialNativeRuntime(
            selected, repo_root=REPO_ROOT, save_app_log=self.save_app_log,
        )
        root = current_run_directory(repo_root=REPO_ROOT)
        self.report.manifest = selected.manifest
        try:
            outcome = W7RuntimeOwner(
                repo_root=REPO_ROOT, result_root=root / "private-social",
            ).run_social_cross_station_suite(prepared=prepared)
        finally:
            self.report.runtime["nativeCleanup"] = cleanup_preserving_primary_failure(
                prepared.cleanup, self.report, "private Social",
            )
        result = validate_suite_result(
            {key: value for key, value in outcome.items() if key not in {"runtimeRoot", "suiteResult"}},
            result_path=Path(outcome["suiteResult"]), artifact_root=root, repo_root=REPO_ROOT,
            expected_workspace=workspace_id(REPO_ROOT), expected_source=source_identity(REPO_ROOT),
            expected_run_id=root.name,
        )
        attach_suite_evidence(self, result)
        self.report.runtime["bindingProof"] = selected.binding.binding_proof_evidence()
        self.report.runtime["privateSocialRuntime"] = result.payload["runtimeManifest"]

        for scenario_id in SCENARIO_IDS:
            scenario = result.payload["scenarioResults"][scenario_id]
            self.assert_condition(
                scenario_id,
                scenario["status"] == "PASS"
                and bool(scenario["evidenceRefs"]),
                "PASS with receiver-visible evidence",
            )
        self.assert_condition(
            "suite-runtime-cleanup",
            result.payload["cleanup"]["status"] == "CLEANED",
        )
        self.assert_condition(
            "suite-artifact-remains-non-self-proving",
            result.payload["proofState"] == "UNPROVEN",
        )
        return {
            "evidenceClass": "NATIVE_RECEIVER_PROOF",
            "suiteArtifactProofState": result.payload["proofState"],
            "runtimeCell": selected.binding.cell_id,
            "controlCommit": result.payload["controlCommit"],
            "sourceCommit": result.payload["sourceCommit"],
            "scenarioResults": result.payload["scenarioResults"],
            "resourceReuse": result.payload["resourceReuse"],
            "suiteRuntimeReportDigest": result.payload[
                "suiteRuntimeReportDigest"
            ],
            "provenScope": list(SCENARIO_IDS),
            "unprovenScope": [
                "Mobile Native parity",
                "cross-Federation private delivery",
            ],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
