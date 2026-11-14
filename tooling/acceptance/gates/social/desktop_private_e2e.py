#!/usr/bin/env python3
"""Private comment proof attached to the original CSS-09 Native Suite."""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError

from .cross_station_support import (
    SourceCommand,
    ValidatedSuiteResult,
    attach_suite_evidence,
    canonical_digest,
    load_suite_result,
    run_source_commands,
)


GATE_ID = "social-private-desktop-e2e"
SAME_STATION_SCENARIO = "same-station-regression"
INTERACTION_SCENARIOS = ("AS20", "AS23", SAME_STATION_SCENARIO)
HISTORICAL_SCENARIOS = ("SOC-SEC-AS12",)
EXPLICITLY_UNPROVEN_SCENARIOS = (
    "SOC-SEC-AS11",
    "SOC-SEC-AS14",
)
SOURCE_COMMANDS = (
    SourceCommand(
        name="viewer-envelope-and-prekey-source-check",
        argv=(
            "go",
            "test",
            "-count=1",
            "-run",
            (
                "^(TestPrivateContentServicePrepareSubmitReplay|"
                "TestPrivateContentServicePrepareSubmitComment|"
                "TestContentPreKeyDifferentPlansConsumeDistinctKeys)$"
            ),
            "./subserver/social/application",
            "./subserver/key_exchange",
        ),
        cwd="apps/station/app",
        timeout_seconds=900,
    ),
)


def _validate_attached_suite(
    payload: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    scenario_results = payload.get("scenarioResults")
    if not isinstance(scenario_results, Mapping):
        raise GateError("CSS-09 Social scenario results are missing")
    same_station = scenario_results.get(SAME_STATION_SCENARIO)
    if (
        not isinstance(same_station, Mapping)
        or same_station.get("status") != "PASS"
        or not same_station.get("evidenceRefs")
    ):
        raise GateError(
            "CSS-09 same-Station regression lacks receiver-visible evidence"
        )

    reuse = payload.get("resourceReuse")
    if not isinstance(reuse, Mapping):
        raise GateError("CSS-09 Social resource reuse evidence is missing")
    if (
        reuse.get("provisioningRuns") != 1
        or reuse.get("clientLaunches") != 3
        or reuse.get("maxConcurrentNativeClients", 99) > 2
        or reuse.get("newAccountRegistrations") != 0
        or reuse.get("stationBuilds") != 0
        or reuse.get("stationDeployments") != 0
        or reuse.get("desktopBuilds") != 0
        or reuse.get("clientReplacements") != ["bob2"]
        or reuse.get("fixtureOnlyClients") != ["eve"]
    ):
        raise GateError("CSS-09 Social Suite exceeded its resource budget")

    runtime_manifest = payload.get("runtimeManifest")
    if (
        not isinstance(runtime_manifest, Mapping)
        or runtime_manifest.get("state") != "FIXTURE_READY"
        or not runtime_manifest.get("runId")
    ):
        raise GateError("CSS-09 Social runtime manifest is incomplete")
    return dict(same_station), dict(reuse), dict(runtime_manifest)


def _interaction_observations(
    result: ValidatedSuiteResult, scenario: str,
) -> Mapping[str, Any]:
    selected = result.payload["scenarioResults"].get(scenario)
    if not isinstance(selected, Mapping) or selected.get("status") != "PASS":
        raise GateError(f"CSS-09 {scenario} comment interaction is missing")
    artifacts = {path.resolve() for path in result.supporting_artifacts}
    for reference in selected.get("evidenceRefs", ()):
        if not isinstance(reference, Mapping) or not isinstance(reference.get("path"), str):
            continue
        path = Path(reference["path"])
        path = path.resolve() if path.is_absolute() else (result.path.parent / path).resolve()
        if path not in artifacts or path.suffix != ".json":
            continue
        artifact = json.loads(path.read_text(encoding="utf-8"))
        if artifact.get("artifactKind") != "social-cross-station-scenario-evidence":
            continue
        unsigned = {key: value for key, value in artifact.items() if key != "artifactDigest"}
        if (
            canonical_digest(unsigned) != artifact.get("artifactDigest")
            or artifact.get("scenarioId") != scenario
            or artifact.get("status") != "PASS"
            or any(artifact.get(key) != result.payload.get(key)
                   for key in ("runId", "sourceCommit", "controlCommit", "fixtureEpoch"))
        ):
            raise GateError(f"CSS-09 {scenario} interaction source identity is invalid")
        observations = artifact.get("observations")
        if isinstance(observations, Mapping):
            for row in observations.get("commentReactionAssertions", ()):
                if not isinstance(row, Mapping):
                    raise GateError("CSS-09 comment painted capture is malformed")
                for role, suffix in (("screenshot", ".png"), ("dom", ".html")):
                    capture = row.get(role)
                    if not isinstance(capture, Mapping) or not isinstance(capture.get("path"), str):
                        raise GateError("CSS-09 comment painted capture is missing")
                    capture_path = Path(capture["path"])
                    if not capture_path.is_absolute():
                        capture_path = result.path.parent / capture_path
                    capture_path = capture_path.resolve()
                    if capture_path not in artifacts or capture_path.suffix != suffix:
                        raise GateError("CSS-09 comment capture is outside validated Suite artifacts")
                    data = capture_path.read_bytes()
                    if hashlib.sha256(data).hexdigest() != capture.get("sha256"):
                        raise GateError("CSS-09 comment painted capture digest changed")
                    if role == "screenshot" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                        raise GateError("CSS-09 comment capture is not a Native PNG")
            return observations
    raise GateError(f"CSS-09 {scenario} lacks comment interaction artifacts")


def _validate_comment_trace(
    cross: Mapping[str, Any], replacement: Mapping[str, Any], local: Mapping[str, Any],
) -> None:
    def rows(observations: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        value = observations.get("commentReactionAssertions")
        if not isinstance(value, list) or not value:
            raise GateError("CSS-09 comment interaction lacks painted assertions")
        for row in value:
            if (
                not isinstance(row, Mapping)
                or type(row.get("count")) is not int
                or type(row.get("liked")) is not bool
                or row.get("tag") != "button"
                or row.get("paintFrames") != 2
                or not row.get("automationSessionId")
                or any(not isinstance(row.get(key), str) or len(row[key]) != 64
                       for key in ("postIdSha256", "commentIdSha256", "commentTextSha256"))
            ):
                raise GateError("CSS-09 comment interaction is not a painted button assertion")
        return value

    cross_rows, replacement_rows, local_rows = rows(cross), rows(replacement), rows(local)
    identities: dict[int, tuple[str, str, str]] = {}
    local_identities: dict[int, tuple[str, str, str]] = {}
    sessions: dict[str, str] = {}

    def require(
        values: list[Mapping[str, Any]], actor: str, phase: str,
        depth: int, count: int, liked: bool, *, bind_cross: bool,
    ) -> None:
        matches = [row for row in values if row.get("actor") == actor
                   and row.get("phase") == phase and row.get("depth") == depth]
        if len(matches) != 1 or matches[0]["count"] != count or matches[0]["liked"] is not liked:
            raise GateError(f"CSS-09 comment LIKE {actor}/{phase}/{depth} lacks receiver convergence")
        row = matches[0]
        identity = tuple(row[key] for key in ("postIdSha256", "commentIdSha256", "commentTextSha256"))
        target_identities = identities if bind_cross else local_identities
        if target_identities.setdefault(depth, identity) != identity:
            raise GateError("CSS-09 comment LIKE target changed across clients or restart")
        session = row["automationSessionId"]
        if sessions.setdefault(actor, session) != session:
            raise GateError("CSS-09 comment LIKE automation session changed within the Suite")

    for depth, label in ((0, "root"), (1, "reply")):
        for initiator in ("bob", "alice"):
            for operation, count in (("like", 1), ("unlike", 0)):
                phase = f"{initiator}-{label}-{operation}"
                for actor in ("alice", "bob"):
                    require(cross_rows, actor, phase, depth, count,
                            operation == "like" and actor == initiator, bind_cross=True)
        for phase in (f"alice-{label}-retain", "durable-retry"):
            require(cross_rows, "alice", phase, depth, 1, True, bind_cross=True)
            require(cross_rows, "bob", phase, depth, 1, False, bind_cross=True)
        require(replacement_rows, "bob2", "replacement-readback", depth, 1, False, bind_cross=True)
        require(local_rows, "alice", f"local-{label}-like", depth, 1, True, bind_cross=False)
        require(local_rows, "alice", f"local-{label}-unlike", depth, 0, False, bind_cross=False)
    if (identities[0][1] == identities[1][1]
        or local_identities[0][1] == local_identities[1][1]
        or identities[0][0] != identities[1][0]
        or local_identities[0][0] != local_identities[1][0]
        or sessions["bob"] == sessions["bob2"]):
        raise GateError("CSS-09 root/reply or replacement identity is not distinct")
    for observations, expected in (
        (cross, {(actor, f"{actor}-{label}-{operation}")
                 for actor in ("alice", "bob") for label in ("root", "reply")
                 for operation in ("like", "unlike")}),
        (local, {("alice", f"local-{label}-{operation}")
                 for label in ("root", "reply") for operation in ("like", "unlike")}),
    ):
        actions = observations.get("commentReactionActions")
        if not isinstance(actions, list):
            raise GateError("CSS-09 comment LIKE lacks real UI actions")
        for actor, action in expected:
            matches = [row for row in actions if isinstance(row, Mapping)
                       and row.get("actor") == actor and row.get("action") == action
                       and row.get("tag") == "button"
                       and row.get("automationSessionId") == sessions[actor]]
            if len(matches) != 1:
                raise GateError(f"CSS-09 {action} lacks real comment button activation")
    replays = cross.get("commentReactionReplays")
    if not isinstance(replays, list) or len(replays) != 2 or any(not isinstance(replay, Mapping) for replay in replays):
        raise GateError("CSS-09 comment LIKE lacks durable retry evidence")
    if {replay.get("commentIdSha256") for replay in replays} != {identity[1] for identity in identities.values()}:
        raise GateError("CSS-09 comment retry targets do not match painted rows")
    for replay in replays:
        values = replay.get("replays")
        if (replay.get("nativeRetryCount") != 2 or replay.get("state") != "REACTION_COMMITTED"
            or replay.get("operation") != "REACT" or not replay.get("commandIdSha256")
            or not isinstance(values, list) or len(values) != 2 or values[0] != values[1]
            or not isinstance(values[0], Mapping)
            or values[0].get("count") != 1 or values[0].get("liked") is not True
            or not values[0].get("projectionRevision")):
            raise GateError("CSS-09 native comment retry changed its committed projection")


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
        "docs/architecture/domains/social/core/product-definition.md",
        "docs/architecture/domains/social/core/experience-contract.md",
        "docs/architecture/domains/social/core/product-state-model.md",
        "docs/architecture/domains/social/core/acceptance-matrix.md",
        "docs/architecture/domains/social/cross-station/integration.md",
        "docs/architecture/domains/social/federation/interaction-completion.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, SOURCE_COMMANDS)
        result = load_suite_result(
            consumer_gate_id=self.gate_id, execution_policy=self.e2e_preflight["executionPolicy"],
        )
        same_station, resource_reuse, runtime_manifest = (
            _validate_attached_suite(result.payload)
        )
        self.report.manifest = runtime_manifest
        attach_suite_evidence(self, result)
        _validate_comment_trace(*(
            _interaction_observations(result, scenario)
            for scenario in INTERACTION_SCENARIOS
        ))

        self.assert_condition(
            "private-comment-like-retry-and-replacement",
            True,
            "real root/reply actions, bilateral painted convergence and Native durable retry",
        )
        self.assert_condition(
            SAME_STATION_SCENARIO,
            same_station["status"] == "PASS"
            and bool(same_station["evidenceRefs"]),
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
            "runtimeCell": "cross-station-social-native",
            "controlCommit": result.payload["controlCommit"],
            "sourceCommit": result.payload["sourceCommit"],
            "scenarioResults": {
                scenario: result.payload["scenarioResults"][scenario]
                for scenario in INTERACTION_SCENARIOS
            },
            "resourceReuse": resource_reuse,
            "commands": commands,
            "historicalScenarios": list(HISTORICAL_SCENARIOS),
            "unprovenScenarios": list(EXPLICITLY_UNPROVEN_SCENARIOS),
            "suiteRuntimeReportDigest": result.payload[
                "suiteRuntimeReportDigest"
            ],
            "provenScope": list(INTERACTION_SCENARIOS),
            "unprovenScope": [
                "Browser private Social",
                "Mobile Native parity",
            ],
        }


def main() -> int:
    return SocialPrivateDesktopGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
