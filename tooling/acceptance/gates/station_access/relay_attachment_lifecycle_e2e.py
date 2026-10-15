#!/usr/bin/env python3
"""Prove the managed Relay attachment lifecycle from exact source."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    EphemeralGateClient,
    EvidenceError,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
    source_identity,
)
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    validate_suite_runtime_report,
)
from tooling.acceptance.station_access_evidence import (
    GateSpec,
    check_gate,
)
from tooling.acceptance.provisioners.station_access_dual_relay import (
    CAPABILITY_ID,
    ENVIRONMENT_ID,
)


SUITE_GATE_ID = "RAL-G01"
PROJECTION_GATE_IDS = tuple(f"RAL-G0{index}" for index in range(2, 8))
AGGREGATE_GATE_ID = "RAL-G08"
ALL_RAL_GATE_IDS = (SUITE_GATE_ID, *PROJECTION_GATE_IDS, AGGREGATE_GATE_ID)
SCENARIO_IDS = tuple(f"RAL-G0{index}" for index in range(1, 8))
SPEC = (
    "docs/architecture/platform/runtime/node-connectivity/"
    "relay-attachment/integration.md"
)
SUITE_REPORT_PATH = "reports/RAL-G01-suite-runtime.json"
LIFECYCLE_REPORT_PATH = "reports/RAL-G01.json"
WAIT_SECONDS = 180.0
POLL_SECONDS = 1.0
RELAY_IDS = ("relay-a", "relay-b")

SCENARIO_ASSERTIONS: dict[str, tuple[str, ...]] = {
    "RAL-G01": (
        "fixture_starts_without_attachments",
        "active_invitation_delete_is_terminal",
        "targeted_invitation_mismatch_is_denied",
    ),
    "RAL-G02": (
        "relay_a_attachment_reaches_active_generation",
        "invitation_secret_absent_from_projection",
    ),
    "RAL-G03": (
        "relay_b_overlap_preserves_relay_a",
        "relay_generations_are_independent",
    ),
    "RAL-G04": (
        "relay_a_failure_preserves_relay_b",
        "relay_a_restart_recovers_dual_active",
    ),
    "RAL-G05": (
        "station_restart_recovers_both_attachments",
        "station_restart_preserves_relay_generations",
    ),
    "RAL-G06": (
        "offline_detach_disables_local_relay_a",
        "offline_detach_keeps_relay_b_active",
    ),
    "RAL-G07": (
        "cleanup_retry_completes_after_relay_recovery",
        "online_detach_is_idempotent",
        "consumed_invitations_are_not_deletable",
        "revocation_advances_each_generation_once",
        "final_attachment_projection_is_empty",
    ),
}

RUNTIME_REUSE_CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "RAL-G01",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 1,
        "minWarmReuseRate": 0.85,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} must be an object")
    return dict(value)


def _list(value: object, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(
        not isinstance(item, Mapping) for item in value
    ):
        raise GateError(f"{label} must be an array of objects")
    return [dict(item) for item in value]


def _attachments_by_relay(
    response: Mapping[str, object],
) -> dict[str, dict[str, Any]]:
    items = _list(response.get("items"), "Relay attachments")
    return {
        str(item.get("relay_peer_id") or ""): item
        for item in items
        if item.get("relay_peer_id")
    }


class RelayAttachmentLifecycleSuiteGate(AcceptanceGate):
    gate_id = SUITE_GATE_ID
    phase = "RAL"
    bom = SCENARIO_IDS
    spec = (SPEC,)

    def __init__(self, capability_client: EphemeralGateClient) -> None:
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(
            Path(manifest_path),
            self.gate_id,
        )
        if self.manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "RAL-G01 requires station-access-dual-relay"
            )
        services = _mapping(
            self.manifest.get("services"),
            "runtime services",
        )
        if set(services) != {"station", "relay-a", "relay-b"}:
            raise GateError("RAL-G01 service topology is incomplete")
        source = _mapping(self.manifest.get("source"), "runtime source")
        source_commit = str(source.get("commit") or "")
        if source.get("workspaceDigest") != "clean" or not source_commit:
            raise GateError("RAL-G01 requires clean exact source")
        relay_peer_ids = {
            relay: str(
                _mapping(services[relay], relay).get("runtimeIdentity")
                or ""
            )
            for relay in RELAY_IDS
        }
        if (
            any(not peer_id for peer_id in relay_peer_ids.values())
            or len(set(relay_peer_ids.values())) != 2
        ):
            raise GateError("RAL-G01 Relay identities are incomplete")
        self.capability_client = capability_client
        self.services = services
        self.source_commit = source_commit
        self.relay_peer_ids = relay_peer_ids
        self.fixture_epoch = str(self.manifest.get("runId") or "")
        self.ledger = SuiteRuntimeLedger(
            RUNTIME_REUSE_CONTRACT,
            suite_runtime_id=f"ral-{self.fixture_epoch}",
            source_digest=self.source_commit,
            fixture_epoch=self.fixture_epoch,
        )
        self.scenarios: dict[str, dict[str, Any]] = {}
        self.report.manifest = self.manifest
        self.report.station_url = str(
            _mapping(services["station"], "Station service").get("endpoint")
            or ""
        )

    def _invoke(
        self,
        operation: str,
        payload: Mapping[str, object] | None = None,
        *,
        timeout_seconds: float = 240,
    ) -> dict[str, Any]:
        return dict(
            self.capability_client.invoke(
                CAPABILITY_ID,
                operation,
                dict(payload or {}),
                timeout_seconds=timeout_seconds,
            )
        )

    def _scenario(
        self,
        scenario_id: str,
        action: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        self.ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        started = time.monotonic()
        result = action()
        duration = time.monotonic() - started
        self.ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id="operator-surface",
            duration_seconds=duration,
        )
        self.ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id="operator-projection",
        )
        self.ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
        self.scenarios[scenario_id] = result
        return result

    def _wait_attachments(
        self,
        predicate: Callable[[dict[str, dict[str, Any]]], bool],
        label: str,
    ) -> dict[str, dict[str, Any]]:
        deadline = time.monotonic() + WAIT_SECONDS
        latest: dict[str, dict[str, Any]] = {}
        while time.monotonic() < deadline:
            latest = _attachments_by_relay(
                self._invoke("attachments", timeout_seconds=30)
            )
            if predicate(latest):
                return latest
            time.sleep(POLL_SECONDS)
        raise GateError(
            f"{label} did not converge: "
            f"{json.dumps(latest, sort_keys=True)}"
        )

    def _active_pair(
        self,
        attachments: Mapping[str, Mapping[str, Any]],
    ) -> bool:
        return all(
            attachments.get(self.relay_peer_ids[relay], {}).get("state")
            == "active"
            and attachments.get(
                self.relay_peer_ids[relay],
                {},
            ).get("enabled")
            is True
            for relay in RELAY_IDS
        )

    def _run_g01(self) -> dict[str, Any]:
        initial = self._invoke("initial-state")
        self.assert_condition(
            "fixture_starts_without_attachments",
            initial.get("attachments") == []
            and all(
                int(value) == 0
                for value in _mapping(
                    initial.get("ownedActiveInviteCounts"),
                    "owned invitation counts",
                ).values()
            ),
            json.dumps(initial, sort_keys=True),
        )
        deleted = self._invoke(
            "active-invite-delete",
            {"relay": "relay-a"},
        )
        self.assert_condition(
            "active_invitation_delete_is_terminal",
            deleted.get("status") == 200
            and _mapping(
                deleted.get("result"),
                "active invitation delete result",
            ).get("status")
            == "deleted",
            json.dumps(deleted, sort_keys=True),
        )
        mismatch = self._invoke(
            "target-mismatch",
            {"relay": "relay-a"},
        )
        self.assert_condition(
            "targeted_invitation_mismatch_is_denied",
            mismatch.get("status") == 400
            and "another Station" in str(mismatch.get("error") or ""),
            json.dumps(mismatch, sort_keys=True),
        )
        return {
            "initial": initial,
            "activeInvitationDelete": deleted,
            "targetMismatch": mismatch,
        }

    def _run_g02(self) -> dict[str, Any]:
        attached = self._invoke("attach-relay", {"relay": "relay-a"})
        active = self._wait_attachments(
            lambda current: (
                current.get(
                    self.relay_peer_ids["relay-a"],
                    {},
                ).get("state")
                == "active"
                and int(
                    current.get(
                        self.relay_peer_ids["relay-a"],
                        {},
                    ).get("route_generation")
                    or 0
                )
                == 1
            ),
            "Relay A active attachment",
        )
        relay_a = active[self.relay_peer_ids["relay-a"]]
        self.assert_condition(
            "relay_a_attachment_reaches_active_generation",
            relay_a.get("enabled") is True
            and relay_a.get("cleanup_pending") is False
            and bool(relay_a.get("route_expires_at")),
            json.dumps(relay_a, sort_keys=True),
        )
        encoded = json.dumps(
            {"attach": attached, "projection": relay_a},
            sort_keys=True,
        )
        self.assert_condition(
            "invitation_secret_absent_from_projection",
            "invite_token" not in encoded
            and "relay_token" not in encoded
            and "credential_file" not in encoded,
        )
        return {"attach": attached, "active": relay_a}

    def _run_g03(self) -> dict[str, Any]:
        attached = self._invoke("attach-relay", {"relay": "relay-b"})
        overlap = self._wait_attachments(
            self._active_pair,
            "dual-Relay active overlap",
        )
        relay_a = overlap[self.relay_peer_ids["relay-a"]]
        relay_b = overlap[self.relay_peer_ids["relay-b"]]
        self.assert_condition(
            "relay_b_overlap_preserves_relay_a",
            relay_a.get("enabled") is True
            and relay_b.get("enabled") is True
            and relay_a.get("relay_peer_id")
            != relay_b.get("relay_peer_id"),
            json.dumps(overlap, sort_keys=True),
        )
        self.assert_condition(
            "relay_generations_are_independent",
            int(relay_a.get("route_generation") or 0) == 1
            and int(relay_b.get("route_generation") or 0) == 1,
            json.dumps(overlap, sort_keys=True),
        )
        return {"attach": attached, "overlap": overlap}

    def _run_g04(self) -> dict[str, Any]:
        before = self._wait_attachments(
            self._active_pair,
            "pre-failure dual active state",
        )
        stopped = self._invoke(
            "relay-state",
            {"relay": "relay-a", "action": "stop"},
        )
        surviving = self._wait_attachments(
            lambda current: (
                current.get(
                    self.relay_peer_ids["relay-b"],
                    {},
                ).get("state")
                == "active"
                and current.get(
                    self.relay_peer_ids["relay-b"],
                    {},
                ).get("enabled")
                is True
            ),
            "Relay B failure isolation",
        )
        self.assert_condition(
            "relay_a_failure_preserves_relay_b",
            stopped.get("health") == "stopped"
            and self.relay_peer_ids["relay-b"] in surviving,
            json.dumps(surviving, sort_keys=True),
        )
        started = self._invoke(
            "relay-state",
            {"relay": "relay-a", "action": "start"},
        )
        recovered = self._wait_attachments(
            lambda current: self._active_pair(current)
            and current[self.relay_peer_ids["relay-a"]].get(
                "route_expires_at"
            )
            != before[self.relay_peer_ids["relay-a"]].get(
                "route_expires_at"
            ),
            "Relay A recovery",
        )
        self.assert_condition(
            "relay_a_restart_recovers_dual_active",
            started.get("health") == "ready"
            and self._active_pair(recovered),
            json.dumps(recovered, sort_keys=True),
        )
        return {
            "before": before,
            "stopped": stopped,
            "surviving": surviving,
            "started": started,
            "recovered": recovered,
        }

    def _run_g05(self) -> dict[str, Any]:
        before = self._wait_attachments(
            self._active_pair,
            "pre-Station-restart dual active state",
        )
        restart = self._invoke("station-restart", timeout_seconds=240)
        recovered = self._wait_attachments(
            self._active_pair,
            "Station restart attachment recovery",
        )
        self.assert_condition(
            "station_restart_recovers_both_attachments",
            restart.get("restarted") is True
            and self._active_pair(recovered),
            json.dumps(
                {"restart": restart, "recovered": recovered},
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "station_restart_preserves_relay_generations",
            all(
                int(
                    before[self.relay_peer_ids[relay]].get(
                        "route_generation"
                    )
                    or 0
                )
                == int(
                    recovered[self.relay_peer_ids[relay]].get(
                        "route_generation"
                    )
                    or 0
                )
                == 1
                for relay in RELAY_IDS
            ),
            json.dumps(recovered, sort_keys=True),
        )
        return {"before": before, "restart": restart, "recovered": recovered}

    def _run_g06(self) -> dict[str, Any]:
        stopped = self._invoke(
            "relay-state",
            {"relay": "relay-a", "action": "stop"},
        )
        deleted = self._invoke(
            "delete-attachment",
            {"relay": "relay-a"},
        )
        pending = self._wait_attachments(
            lambda current: (
                current.get(
                    self.relay_peer_ids["relay-a"],
                    {},
                ).get("cleanup_pending")
                is True
                and current.get(
                    self.relay_peer_ids["relay-a"],
                    {},
                ).get("enabled")
                is False
                and current.get(
                    self.relay_peer_ids["relay-b"],
                    {},
                ).get("state")
                == "active"
            ),
            "offline Relay A cleanup pending",
        )
        relay_a = pending[self.relay_peer_ids["relay-a"]]
        relay_b = pending[self.relay_peer_ids["relay-b"]]
        self.assert_condition(
            "offline_detach_disables_local_relay_a",
            deleted.get("status") == 200
            and relay_a.get("state") == "cleanup_pending"
            and relay_a.get("cleanup_pending") is True,
            json.dumps(
                {"delete": deleted, "projection": relay_a},
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "offline_detach_keeps_relay_b_active",
            relay_b.get("enabled") is True
            and relay_b.get("cleanup_pending") is False
            and relay_b.get("state") == "active",
            json.dumps(relay_b, sort_keys=True),
        )
        return {
            "stopped": stopped,
            "delete": deleted,
            "pending": pending,
        }

    def _run_g07(self) -> dict[str, Any]:
        started = self._invoke(
            "relay-state",
            {"relay": "relay-a", "action": "start"},
        )
        retried = self._invoke(
            "retry-attachment",
            {"relay": "relay-a"},
        )
        after_retry = self._wait_attachments(
            lambda current: (
                self.relay_peer_ids["relay-a"] not in current
                and current.get(
                    self.relay_peer_ids["relay-b"],
                    {},
                ).get("state")
                == "active"
            ),
            "Relay A cleanup completion",
        )
        self.assert_condition(
            "cleanup_retry_completes_after_relay_recovery",
            started.get("health") == "ready"
            and retried.get("status") == 200
            and self.relay_peer_ids["relay-a"] not in after_retry,
            json.dumps(
                {"retry": retried, "projection": after_retry},
                sort_keys=True,
            ),
        )
        first_delete = self._invoke(
            "delete-attachment",
            {"relay": "relay-b"},
        )
        second_delete = self._invoke(
            "delete-attachment",
            {"relay": "relay-b"},
        )
        final_projection = self._wait_attachments(
            lambda current: not current,
            "final empty attachment projection",
        )
        first_response = _mapping(
            first_delete.get("response"),
            "first Relay B delete",
        )
        second_response = _mapping(
            second_delete.get("response"),
            "second Relay B delete",
        )
        self.assert_condition(
            "online_detach_is_idempotent",
            first_delete.get("status") == 200
            and second_delete.get("status") == 200
            and first_response.get("state") == "detached"
            and second_response.get("state") == "detached"
            and first_response.get("cleanup_pending") is False
            and second_response.get("cleanup_pending") is False,
            json.dumps(
                {"first": first_delete, "second": second_delete},
                sort_keys=True,
            ),
        )
        consumed = self._invoke("delete-consumed-invites")
        self.assert_condition(
            "consumed_invitations_are_not_deletable",
            all(
                _mapping(consumed.get(relay), relay).get("status") == 409
                for relay in RELAY_IDS
            ),
            json.dumps(consumed, sort_keys=True),
        )
        durable = self._invoke("durable-state")
        self.assert_condition(
            "revocation_advances_each_generation_once",
            all(
                len(
                    _list(
                        _mapping(durable.get(relay), relay).get(
                            "enrollments"
                        ),
                        f"{relay} enrollments",
                    )
                )
                == 1
                and int(
                    _list(
                        _mapping(durable.get(relay), relay).get(
                            "enrollments"
                        ),
                        f"{relay} enrollments",
                    )[0].get("status")
                    or 0
                )
                == 3
                and int(
                    _list(
                        _mapping(durable.get(relay), relay).get(
                            "enrollments"
                        ),
                        f"{relay} enrollments",
                    )[0].get("generation")
                    or 0
                )
                == 2
                and _list(
                    _mapping(durable.get(relay), relay).get("enrollments"),
                    f"{relay} enrollments",
                )[0].get("revoked")
                is True
                for relay in RELAY_IDS
            ),
            json.dumps(durable, sort_keys=True),
        )
        self.assert_condition(
            "final_attachment_projection_is_empty",
            final_projection == {},
            json.dumps(final_projection, sort_keys=True),
        )
        return {
            "started": started,
            "retry": retried,
            "afterRetry": after_retry,
            "firstDelete": first_delete,
            "secondDelete": second_delete,
            "consumedInviteDelete": consumed,
            "durable": durable,
            "final": final_projection,
        }

    def run(self) -> dict[str, Any]:
        self.ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="station-access-dual-relay",
        )
        runners = {
            "RAL-G01": self._run_g01,
            "RAL-G02": self._run_g02,
            "RAL-G03": self._run_g03,
            "RAL-G04": self._run_g04,
            "RAL-G05": self._run_g05,
            "RAL-G06": self._run_g06,
            "RAL-G07": self._run_g07,
        }
        for scenario_id in SCENARIO_IDS:
            self._scenario(scenario_id, runners[scenario_id])
        self.ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = self.ledger.require_valid()
        suite_ref = ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
        ).write_json(
            SUITE_REPORT_PATH,
            suite_report,
            role="suite-runtime",
        )
        expected_assertions = {
            assertion
            for values in SCENARIO_ASSERTIONS.values()
            for assertion in values
        }
        actual_assertions = {
            assertion.name for assertion in self.report.assertions
        }
        missing = sorted(expected_assertions - actual_assertions)
        if missing:
            raise GateError(
                f"RAL-G01 lifecycle assertions are missing: {missing}"
            )
        lifecycle = {
            "sourceCommit": self.source_commit,
            "fixtureEpoch": self.fixture_epoch,
            "relayPeerIds": self.relay_peer_ids,
            "scenarios": self.scenarios,
            "suiteRuntime": suite_ref.to_dict(),
        }
        self.report.runtime["relayAttachmentLifecycle"] = lifecycle
        return lifecycle


def _load_suite_report(
    store: EvidenceStore,
    *,
    expected_source: dict[str, str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = store.latest(SUITE_GATE_ID)
    if (
        manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("state") != "DURABLE"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != SUITE_GATE_ID
        or manifest.get("source") != expected_source
    ):
        raise GateError("RAL-G01 latest evidence identity is stale or invalid")
    result = _mapping(manifest.get("result"), "RAL-G01 result")
    if {
        key: result.get(key)
        for key in ("status", "completionStatus", "proofStatus")
    } != {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
    }:
        raise GateError("RAL-G01 latest evidence is not passed/DONE/PROVEN")
    artifacts = _mapping(manifest.get("artifacts"), "RAL-G01 artifacts")
    lifecycle_ref = artifacts.get(LIFECYCLE_REPORT_PATH)
    suite_ref = artifacts.get("suite-runtime") or artifacts.get(
        SUITE_REPORT_PATH
    )
    if not isinstance(lifecycle_ref, Mapping) or not isinstance(
        suite_ref,
        Mapping,
    ):
        raise GateError("RAL-G01 lifecycle artifacts are incomplete")
    lifecycle = store.read_json(ArtifactRef.from_dict(lifecycle_ref))
    suite = store.read_json(ArtifactRef.from_dict(suite_ref))
    validate_suite_runtime_report(
        suite,
        expected_contract=RUNTIME_REUSE_CONTRACT,
    )
    return lifecycle, suite


class RelayAttachmentProjectionGate(AcceptanceGate):
    phase = "RAL"
    spec = (SPEC,)

    def __init__(
        self,
        gate_id: str,
        *,
        store: EvidenceStore | None = None,
        expected_source: dict[str, str] | None = None,
    ) -> None:
        if gate_id not in PROJECTION_GATE_IDS:
            raise GateError(f"unsupported RAL projection Gate: {gate_id}")
        self.gate_id = gate_id
        self.bom = (gate_id,)
        super().__init__()
        self.store = store or EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        self.expected_source = expected_source or source_identity(REPO_ROOT)

    def run(self) -> dict[str, Any]:
        lifecycle, suite = _load_suite_report(
            self.store,
            expected_source=self.expected_source,
        )
        runtime = _mapping(
            lifecycle.get("runtime"),
            "RAL-G01 runtime",
        )
        lifecycle_runtime = _mapping(
            runtime.get("relayAttachmentLifecycle"),
            "RAL-G01 lifecycle runtime",
        )
        scenarios = _mapping(
            lifecycle_runtime.get("scenarios"),
            "RAL-G01 scenarios",
        )
        scenario = _mapping(
            scenarios.get(self.gate_id),
            f"{self.gate_id} scenario",
        )
        assertions = {
            str(item.get("name") or ""): item
            for item in _list(
                lifecycle.get("assertions"),
                "RAL-G01 assertions",
            )
        }
        for name in SCENARIO_ASSERTIONS[self.gate_id]:
            item = _mapping(assertions.get(name), name)
            passed = item.get("passed") is True
            self.report.add_assertion(
                name,
                passed,
                str(item.get("detail") or ""),
            )
            if not passed:
                raise GateError(
                    f"{self.gate_id} source assertion failed: {name}"
                )
        self.report.runtime.update(
            {
                "source": self.expected_source,
                "sourceGate": SUITE_GATE_ID,
                "scenario": scenario,
                "suiteRuntimeDigest": suite["reportDigest"],
            }
        )
        return {
            "sourceGate": SUITE_GATE_ID,
            "scenarioId": self.gate_id,
            "assertionCount": len(SCENARIO_ASSERTIONS[self.gate_id]),
            "suiteRuntimeDigest": suite["reportDigest"],
        }


class RelayAttachmentAggregateGate(AcceptanceGate):
    gate_id = AGGREGATE_GATE_ID
    phase = "RAL"
    bom = ALL_RAL_GATE_IDS
    spec = (SPEC,)
    preceding_gates = tuple(
        GateSpec(gate_id, gate_id)
        for gate_id in (SUITE_GATE_ID, *PROJECTION_GATE_IDS)
    ) + (
        GateSpec("NCP-G03", "NCP-G03", "desktop-macos-native"),
        GateSpec("NCP-G07", "NCP-G07"),
    )

    def __init__(
        self,
        *,
        store: EvidenceStore | None = None,
        expected_source: dict[str, str] | None = None,
    ) -> None:
        super().__init__()
        self.store = store or EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        self.expected_source = expected_source or source_identity(REPO_ROOT)

    def run(self) -> dict[str, Any]:
        results = [
            check_gate(
                self.store,
                spec,
                expected_source=self.expected_source,
            )
            for spec in self.preceding_gates
        ]
        for result in results:
            suffix = (
                f"[{result.runtime_cell}]"
                if result.runtime_cell
                else ""
            )
            self.report.add_assertion(
                f"{result.gate_id}{suffix}",
                result.status == "PASS",
                result.detail or result.status,
            )
        failed = [
            result
            for result in results
            if result.status != "PASS"
        ]
        self.report.runtime.update(
            {
                "source": self.expected_source,
                "gates": [
                    {
                        "gateId": result.gate_id,
                        "runtimeCell": result.runtime_cell,
                        "runId": result.run_id,
                        "status": result.status,
                        "detail": result.detail,
                    }
                    for result in results
                ],
            }
        )
        if failed:
            raise GateError(
                "RAL-G08 is incomplete: "
                + ", ".join(
                    f"{result.gate_id}={result.status}"
                    for result in failed
                )
            )
        return {
            "gateCount": len(results),
            "passedCount": len(results),
            "nativeContinuityGate": "NCP-G03",
            "renewalAndAdmissionGate": "NCP-G07",
        }


def main() -> int:
    gate_id = os.environ.get("PT_ACCEPTANCE_GATE_ID", "").strip()
    if gate_id == SUITE_GATE_ID:
        capability_client = EphemeralGateClient.from_environment()
        if capability_client is None:
            raise GateError("RAL-G01 dual-Relay capability is required")
        with capability_client:
            return RelayAttachmentLifecycleSuiteGate(
                capability_client
            ).execute()
    if gate_id in PROJECTION_GATE_IDS:
        return RelayAttachmentProjectionGate(gate_id).execute()
    if gate_id == AGGREGATE_GATE_ID:
        return RelayAttachmentAggregateGate().execute()
    raise GateError(f"unsupported Relay attachment Gate: {gate_id}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EvidenceError, GateError) as error:
        print(f"Relay attachment lifecycle validation failed: {error}")
        raise SystemExit(1)
