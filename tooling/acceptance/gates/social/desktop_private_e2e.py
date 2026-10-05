#!/usr/bin/env python3
"""Formal Native Desktop Acceptance gate for Social Private Moments."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "social-private-desktop-e2e"
REQUIRED_SCENARIOS = (
    "SOC-SEC-AS01",
    "SOC-SEC-AS02",
    "SOC-SEC-AS03",
    "SOC-SEC-AS04",
    "SOC-SEC-AS05",
    "SOC-SEC-AS06",
    "SOC-SEC-AS07",
    "SOC-SEC-AS08",
    "SOC-SEC-AS09",
    "SOC-SEC-AS10",
    "SOC-SEC-AS13",
    "SOC-SEC-AS15",
    "SOC-SEC-AS16",
)
HISTORICAL_SCENARIOS = ("SOC-SEC-AS12",)
EXPLICITLY_UNPROVEN_SCENARIOS = (
    "SOC-SEC-AS11",
    "SOC-SEC-AS14",
)
RUNTIME_SCENARIOS = (
    "private-comment",
    "social-expansion",
    "social-subtype",
    "social-object",
    "social-delete-block",
    "social-bounds",
)
RUNTIME_CLIENT_IDS = (
    "secure-content-desktop-alice",
    "secure-content-desktop-bob",
    "secure-content-desktop-eve",
)
RUNTIME_SERVICE_IDS = ("station-five-arm", "station-four")
RUNTIME_MANIFEST_FIELDS = frozenset(
    {
        "artifactKind",
        "schemaVersion",
        "state",
        "cleanupState",
        "runId",
        "workspaceId",
        "sourceCommit",
        "worktreeSetDigest",
        "scenarioManifestDigests",
        "serviceIds",
        "clientIds",
        "suiteRuntimeReportDigest",
    }
)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
WORKSPACE_ID = re.compile(r"^[0-9a-f]{16}$")


def _runtime_owner_command() -> list[str]:
    workspace_key = hashlib.sha256(
        str(REPO_ROOT).encode("utf-8")
    ).hexdigest()[:16]
    runtime_root = (
        Path(tempfile.gettempdir())
        / "pt-social-desktop"
        / workspace_key
    )
    return [
        sys.executable,
        "-m",
        "tooling.development.secure_content.runtime_owner",
        "run-social-desktop-acceptance-suite",
        "--profiles",
        "four,fiveArm",
        "--slot",
        "12",
        "--runtime-root",
        str(runtime_root),
    ]


def _parse_owner_output(stdout: str) -> dict[str, Any]:
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise GateError("Social Desktop runtime owner returned no result")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise GateError(
            "Social Desktop runtime owner returned invalid JSON"
        ) from error
    if not isinstance(payload, dict):
        raise GateError("Social Desktop runtime owner result must be an object")
    return payload


def _validate_runtime_manifest(
    payload: Mapping[str, Any],
    suite_report_digest: str,
) -> dict[str, Any]:
    manifest = payload.get("runtimeManifest")
    if (
        not isinstance(manifest, Mapping)
        or set(manifest) != RUNTIME_MANIFEST_FIELDS
        or manifest.get("artifactKind")
        != "social-private-desktop-suite-runtime-manifest"
        or manifest.get("schemaVersion") != 1
        or manifest.get("state") != "FIXTURE_READY"
        or manifest.get("cleanupState") != "CLEANED"
        or not isinstance(manifest.get("runId"), str)
        or not manifest["runId"]
        or WORKSPACE_ID.fullmatch(str(manifest.get("workspaceId"))) is None
        or COMMIT.fullmatch(str(manifest.get("sourceCommit"))) is None
        or SHA256.fullmatch(str(manifest.get("worktreeSetDigest"))) is None
        or manifest.get("suiteRuntimeReportDigest") != suite_report_digest
        or tuple(manifest.get("serviceIds") or ()) != RUNTIME_SERVICE_IDS
        or tuple(manifest.get("clientIds") or ()) != RUNTIME_CLIENT_IDS
    ):
        raise GateError("Social Desktop runtime evidence manifest is invalid")
    scenario_digests = manifest.get("scenarioManifestDigests")
    if (
        not isinstance(scenario_digests, Mapping)
        or set(scenario_digests) != set(RUNTIME_SCENARIOS)
        or any(
            SHA256.fullmatch(str(digest)) is None
            for digest in scenario_digests.values()
        )
    ):
        raise GateError(
            "Social Desktop scenario runtime manifest closure is invalid"
        )
    return dict(manifest)


def _validate_owner_result(
    payload: Mapping[str, Any],
) -> tuple[Path, list[Path], dict[str, Any]]:
    if (
        payload.get("status") != "FUNCTIONAL_PASS"
        or payload.get("proofState") != "UNPROVEN"
    ):
        raise GateError("Social Desktop runtime owner did not functionally pass")

    scenario_results = payload.get("scenarioResults")
    if not isinstance(scenario_results, Mapping):
        raise GateError("Social Desktop scenario results are missing")
    if tuple(sorted(scenario_results)) != tuple(sorted(REQUIRED_SCENARIOS)):
        raise GateError("Social Desktop scenario result set is incomplete")
    failed = [
        scenario_id
        for scenario_id in REQUIRED_SCENARIOS
        if scenario_results.get(scenario_id) != "PASS"
    ]
    if failed:
        raise GateError(f"Social Desktop scenarios did not pass: {failed}")

    if tuple(payload.get("unprovenScenarios") or ()) != (
        EXPLICITLY_UNPROVEN_SCENARIOS
    ):
        raise GateError("Browser and Mobile non-claims are missing or changed")
    if tuple(payload.get("historicalScenarios") or ()) != (
        HISTORICAL_SCENARIOS
    ):
        raise GateError(
            "superseded historical scenario disposition is missing or changed"
        )

    reuse = payload.get("resourceReuse")
    if not isinstance(reuse, Mapping):
        raise GateError("Social Desktop resource reuse evidence is missing")
    if (
        reuse.get("provisioningRuns") != 1
        or reuse.get("clientLaunches", 99) > 5
        or reuse.get("maxConcurrentNativeClients", 99) > 3
        or reuse.get("newAccountRegistrations") != 3
        or reuse.get("stationBuilds") != 0
        or reuse.get("stationDeployments") != 0
        or reuse.get("desktopBuilds") != 0
        or reuse.get("clientReplacements") != ["bob"]
    ):
        raise GateError("Social Desktop Suite exceeded its resource budget")

    suite_report = Path(str(payload.get("suiteRuntimeReport") or ""))
    if not suite_report.is_file():
        raise GateError("Social Desktop Suite Runtime report is missing")
    try:
        suite_payload = json.loads(suite_report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(
            "Social Desktop Suite Runtime report is invalid"
        ) from error
    suite_report_digest = str(payload.get("suiteRuntimeReportDigest") or "")
    if (
        not isinstance(suite_payload, Mapping)
        or SHA256.fullmatch(suite_report_digest) is None
        or suite_payload.get("reportDigest") != suite_report_digest
    ):
        raise GateError(
            "Social Desktop Suite Runtime report digest is invalid"
        )
    runtime_manifest = _validate_runtime_manifest(
        payload,
        suite_report_digest,
    )
    supporting = payload.get("supportingArtifacts") or []
    if (
        not isinstance(supporting, Sequence)
        or isinstance(supporting, (str, bytes))
    ):
        raise GateError("Social Desktop supporting artifact list is invalid")
    artifact_paths = [Path(str(path)) for path in supporting]
    if any(not path.is_file() for path in artifact_paths):
        raise GateError("Social Desktop supporting artifact is missing")
    return suite_report, artifact_paths, runtime_manifest


class SocialPrivateDesktopGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "Social Private Moments Desktop"
    bom = (
        "SOC-SEC-RC01",
        "SOC-SEC-RC03",
        "SOC-SEC-RC04",
        "SOC-SEC-RC05",
        "SOC-SEC-RC06",
    )
    spec = (
        "docs/architecture/social/product-definition.md",
        "docs/architecture/social/experience-contract.md",
        "docs/architecture/social/product-state-model.md",
        "docs/architecture/social/acceptance-matrix.md",
    )

    def run(self) -> dict[str, Any]:
        source_check = subprocess.run(
            [
                "go",
                "test",
                "-count=1",
                "-run",
                (
                    "^(TestPrivateContentServicePrepareSubmitReplay|"
                    "TestPrivateContentServicePrepareSubmitComment|"
                    "TestContentPreKeyDifferentPlansConsumeDistinctKeys)$"
                ),
                "./app/subserver/social/application",
                "./app/subserver/key_exchange",
            ],
            cwd=REPO_ROOT / "apps" / "station",
            text=True,
            capture_output=True,
            timeout=900,
            check=False,
        )
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix="social-private-desktop-source-",
            suffix=".log",
            delete=False,
        ) as output:
            output.write(source_check.stdout)
            output.write(source_check.stderr)
            source_log = Path(output.name)
        try:
            self.report.add_evidence_file(
                "viewer-envelope-and-prekey-source-check",
                source_log,
            )
        finally:
            source_log.unlink(missing_ok=True)
        if source_check.returncode != 0:
            raise GateError(
                "Social viewer-envelope or one-time PreKey source check failed"
            )

        completed = subprocess.run(
            _runtime_owner_command(),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=8800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-6000:]
            raise GateError(f"Social Desktop runtime owner failed: {detail}")

        payload = _parse_owner_output(completed.stdout)
        suite_report, supporting, runtime_manifest = _validate_owner_result(
            payload
        )
        self.report.manifest = runtime_manifest
        self.report.add_evidence_file("suite-runtime", suite_report)
        for index, path in enumerate(supporting):
            self.report.add_evidence_file(
                f"social-supporting-{index + 1}",
                path,
            )

        for scenario_id in REQUIRED_SCENARIOS:
            self.assert_condition(
                scenario_id,
                payload["scenarioResults"][scenario_id] == "PASS",
            )
        self.assert_condition(
            "desktop-only-non-claims",
            payload["unprovenScenarios"]
            == list(EXPLICITLY_UNPROVEN_SCENARIOS),
        )
        return {
            "runtimeCell": "social-private-desktop-native",
            "scenarioResults": payload["scenarioResults"],
            "resourceReuse": payload["resourceReuse"],
            "unprovenScenarios": payload["unprovenScenarios"],
            "historicalScenarios": payload["historicalScenarios"],
            "suiteRuntimeReportDigest": payload.get(
                "suiteRuntimeReportDigest"
            ),
        }


def main() -> int:
    return SocialPrivateDesktopGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
