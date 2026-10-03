"""Domain-neutral lifecycle contract for reusable Acceptance suites."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping

from .errors import SuiteRuntimeError
from .redaction import redact_value


SCHEMA_VERSION = 1
ARTIFACT_KIND = "acceptance-suite-runtime-report"
SOURCE_DIGEST_LENGTHS = frozenset({40, 64})


class SuiteRuntimeAction(str, Enum):
    PROVISION = "provision"
    ACCOUNT_PROVISION = "account-provision"
    CLIENT_LAUNCH = "client-launch"
    LOGIN = "login"
    SCENARIO_START = "scenario-start"
    FIXTURE_RESET = "fixture-reset"
    UI_ACTION = "ui-action"
    RECEIVER_ASSERTION = "receiver-assertion"
    SUPPORTING_OBSERVATION = "supporting-observation"
    CLIENT_REPLACEMENT = "client-replacement"
    SCENARIO_END = "scenario-end"
    CLEANUP_COMPLETE = "cleanup-complete"


EXPENSIVE_ACTIONS = frozenset(
    {
        SuiteRuntimeAction.PROVISION,
        SuiteRuntimeAction.ACCOUNT_PROVISION,
        SuiteRuntimeAction.CLIENT_LAUNCH,
        SuiteRuntimeAction.LOGIN,
    }
)


def _require_identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_CONTRACT_INVALID",
            f"{field} must be a non-empty string",
        )
    return value


def _require_positive_int(value: object, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_CONTRACT_INVALID",
            f"{field} must be a positive integer",
        )
    return value


def _require_rate(value: object, field: str) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
        or not 0 <= float(value) <= 1
    ):
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_CONTRACT_INVALID",
            f"{field} must be a finite number between 0 and 1",
        )
    return float(value)


def _canonical_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class RuntimeReuseContract:
    entry_check_id: str
    scenario_ids: tuple[str, ...]
    max_provisioning_runs: int
    max_client_launches: int
    min_warm_reuse_rate: float
    require_attach_only_scenarios: bool = True
    require_receiver_visible_proof: bool = True
    allow_client_replacement: bool = False
    scope: str = "suite"

    @classmethod
    def from_dict(cls, value: object) -> "RuntimeReuseContract":
        expected_fields = {
            "scope",
            "entryCheckId",
            "scenarioIds",
            "maxProvisioningRuns",
            "maxClientLaunches",
            "minWarmReuseRate",
            "requireAttachOnlyScenarios",
            "requireReceiverVisibleProof",
            "allowClientReplacement",
        }
        if not isinstance(value, dict) or set(value) != expected_fields:
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                "runtimeReuse has unknown or missing fields",
            )
        if value["scope"] != "suite":
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_SCOPE_INVALID",
                "runtimeReuse.scope must be suite",
            )
        raw_scenarios = value["scenarioIds"]
        if (
            not isinstance(raw_scenarios, list)
            or len(raw_scenarios) < 2
            or any(
                not isinstance(scenario_id, str) or not scenario_id.strip()
                for scenario_id in raw_scenarios
            )
            or len(set(raw_scenarios)) != len(raw_scenarios)
        ):
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                "runtimeReuse.scenarioIds must contain unique scenario IDs",
            )
        boolean_fields = (
            "requireAttachOnlyScenarios",
            "requireReceiverVisibleProof",
            "allowClientReplacement",
        )
        if any(not isinstance(value[field], bool) for field in boolean_fields):
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                "runtimeReuse policy flags must be booleans",
            )
        return cls(
            entry_check_id=_require_identifier(
                value["entryCheckId"],
                "runtimeReuse.entryCheckId",
            ),
            scenario_ids=tuple(raw_scenarios),
            max_provisioning_runs=_require_positive_int(
                value["maxProvisioningRuns"],
                "runtimeReuse.maxProvisioningRuns",
            ),
            max_client_launches=_require_positive_int(
                value["maxClientLaunches"],
                "runtimeReuse.maxClientLaunches",
            ),
            min_warm_reuse_rate=_require_rate(
                value["minWarmReuseRate"],
                "runtimeReuse.minWarmReuseRate",
            ),
            require_attach_only_scenarios=value[
                "requireAttachOnlyScenarios"
            ],
            require_receiver_visible_proof=value[
                "requireReceiverVisibleProof"
            ],
            allow_client_replacement=value["allowClientReplacement"],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "scope": self.scope,
            "entryCheckId": self.entry_check_id,
            "scenarioIds": list(self.scenario_ids),
            "maxProvisioningRuns": self.max_provisioning_runs,
            "maxClientLaunches": self.max_client_launches,
            "minWarmReuseRate": self.min_warm_reuse_rate,
            "requireAttachOnlyScenarios": self.require_attach_only_scenarios,
            "requireReceiverVisibleProof": (
                self.require_receiver_visible_proof
            ),
            "allowClientReplacement": self.allow_client_replacement,
        }


@dataclass(frozen=True)
class SuiteRuntimeEvent:
    sequence: int
    action: SuiteRuntimeAction
    scenario_id: str = ""
    resource_id: str = ""
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "action": self.action.value,
            "scenarioId": self.scenario_id,
            "resourceId": self.resource_id,
            "durationSeconds": self.duration_seconds,
        }


class SuiteRuntimeLedger:
    """Record one reusable Suite lifecycle and fail closed on scope drift."""

    def __init__(
        self,
        contract: RuntimeReuseContract,
        *,
        suite_runtime_id: str,
        source_digest: str,
        fixture_epoch: str,
    ) -> None:
        self.contract = contract
        self.suite_runtime_id = _require_identifier(
            suite_runtime_id,
            "suiteRuntimeId",
        )
        self.source_digest = _require_identifier(
            source_digest,
            "sourceDigest",
        )
        if (
            len(self.source_digest) not in SOURCE_DIGEST_LENGTHS
            or any(character not in "0123456789abcdef" for character in self.source_digest)
        ):
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_SOURCE_INVALID",
                "sourceDigest must be a lowercase Git SHA-1 or SHA-256",
            )
        self.fixture_epoch = _require_identifier(
            fixture_epoch,
            "fixtureEpoch",
        )
        self._events: list[SuiteRuntimeEvent] = []
        self._active_scenario = ""
        self._completed_scenarios: set[str] = set()
        self._seen_resources: set[tuple[SuiteRuntimeAction, str]] = set()
        self._scenario_started = False

    def record(
        self,
        action: SuiteRuntimeAction | str,
        *,
        scenario_id: str = "",
        resource_id: str = "",
        duration_seconds: float = 0.0,
    ) -> None:
        try:
            resolved_action = SuiteRuntimeAction(action)
        except ValueError as error:
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_ACTION_INVALID",
                f"unsupported action {action!r}",
            ) from error
        if (
            not isinstance(duration_seconds, (int, float))
            or isinstance(duration_seconds, bool)
            or not math.isfinite(float(duration_seconds))
            or duration_seconds < 0
        ):
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_DURATION_INVALID",
                "durationSeconds must be a finite non-negative number",
            )
        if (
            self.contract.require_attach_only_scenarios
            and self._scenario_started
            and resolved_action in EXPENSIVE_ACTIONS
        ):
            raise SuiteRuntimeError(
                "SCENARIO_OWNED_PROVISIONING",
                f"{resolved_action.value} is forbidden after scenario execution starts",
            )
        if resolved_action in EXPENSIVE_ACTIONS:
            resource = _require_identifier(resource_id, "resourceId")
            identity = (resolved_action, resource)
            if identity in self._seen_resources:
                raise SuiteRuntimeError(
                    "DUPLICATE_SUITE_RESOURCE",
                    f"{resolved_action.value} repeated for {resource}",
                )
            self._seen_resources.add(identity)

        if resolved_action is SuiteRuntimeAction.SCENARIO_START:
            self._start_scenario(scenario_id)
        elif resolved_action is SuiteRuntimeAction.SCENARIO_END:
            self._end_scenario(scenario_id)
        elif resolved_action in {
            SuiteRuntimeAction.FIXTURE_RESET,
            SuiteRuntimeAction.UI_ACTION,
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            SuiteRuntimeAction.SUPPORTING_OBSERVATION,
        }:
            self._require_active_scenario(scenario_id, resolved_action)
        elif resolved_action is SuiteRuntimeAction.CLIENT_REPLACEMENT:
            if not self.contract.allow_client_replacement:
                raise SuiteRuntimeError(
                    "CLIENT_REPLACEMENT_FORBIDDEN",
                    "runtimeReuse does not allow client replacement",
                )
            _require_identifier(resource_id, "resourceId")
        elif resolved_action is SuiteRuntimeAction.CLEANUP_COMPLETE:
            if self._active_scenario:
                raise SuiteRuntimeError(
                    "SUITE_RUNTIME_CLEANUP_INVALID",
                    "cleanup cannot complete while a scenario is active",
                )

        self._events.append(
            SuiteRuntimeEvent(
                sequence=len(self._events) + 1,
                action=resolved_action,
                scenario_id=scenario_id,
                resource_id=resource_id,
                duration_seconds=float(duration_seconds),
            )
        )

    def _start_scenario(self, scenario_id: str) -> None:
        scenario = _require_identifier(scenario_id, "scenarioId")
        if scenario not in self.contract.scenario_ids:
            raise SuiteRuntimeError(
                "UNDECLARED_SUITE_SCENARIO",
                f"scenario {scenario!r} is not declared by runtimeReuse",
            )
        if self._active_scenario:
            raise SuiteRuntimeError(
                "SUITE_SCENARIO_OVERLAP",
                f"scenario {self._active_scenario!r} is already active",
            )
        if scenario in self._completed_scenarios:
            raise SuiteRuntimeError(
                "DUPLICATE_SUITE_SCENARIO",
                f"scenario {scenario!r} already completed",
            )
        self._active_scenario = scenario
        self._scenario_started = True

    def _end_scenario(self, scenario_id: str) -> None:
        self._require_active_scenario(
            scenario_id,
            SuiteRuntimeAction.SCENARIO_END,
        )
        self._completed_scenarios.add(scenario_id)
        self._active_scenario = ""

    def _require_active_scenario(
        self,
        scenario_id: str,
        action: SuiteRuntimeAction,
    ) -> None:
        if not scenario_id or scenario_id != self._active_scenario:
            raise SuiteRuntimeError(
                "SUITE_SCENARIO_STATE_INVALID",
                (
                    f"{action.value} requires active scenario "
                    f"{self._active_scenario!r}, got {scenario_id!r}"
                ),
            )

    def report(self) -> dict[str, Any]:
        findings = self._findings()
        provisioning_runs = sum(
            event.action is SuiteRuntimeAction.PROVISION
            for event in self._events
        )
        client_launches = sum(
            event.action
            in {
                SuiteRuntimeAction.CLIENT_LAUNCH,
                SuiteRuntimeAction.CLIENT_REPLACEMENT,
            }
            for event in self._events
        )
        scenario_count = len(self.contract.scenario_ids)
        warm_reuse_rate = max(
            0.0,
            (scenario_count - provisioning_runs) / scenario_count,
        )
        duration_by_action: dict[str, float] = {}
        for event in self._events:
            duration_by_action[event.action.value] = (
                duration_by_action.get(event.action.value, 0.0)
                + event.duration_seconds
            )
        payload: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "artifactKind": ARTIFACT_KIND,
            "suiteRuntimeId": self.suite_runtime_id,
            "sourceDigest": self.source_digest,
            "fixtureEpoch": self.fixture_epoch,
            "contract": self.contract.to_dict(),
            "events": [event.to_dict() for event in self._events],
            "metrics": {
                "provisioningRuns": provisioning_runs,
                "clientLaunches": client_launches,
                "completedScenarios": len(self._completed_scenarios),
                "warmReuseRate": round(warm_reuse_rate, 6),
                "durationSecondsByAction": duration_by_action,
            },
            "findings": findings,
            "result": "PASS" if not findings else "FAIL",
            "proofState": "SUPPORTING" if not findings else "UNPROVEN",
        }
        payload["reportDigest"] = _canonical_digest(payload)
        return redact_value(payload)

    def require_valid(self) -> dict[str, Any]:
        report = self.report()
        if report["result"] != "PASS":
            first = report["findings"][0]
            raise SuiteRuntimeError(first["code"], first["detail"])
        return report

    def _findings(self) -> list[dict[str, str]]:
        findings: list[dict[str, str]] = []
        actions = [event.action for event in self._events]
        provisioning_runs = actions.count(SuiteRuntimeAction.PROVISION)
        client_launches = actions.count(
            SuiteRuntimeAction.CLIENT_LAUNCH
        ) + actions.count(SuiteRuntimeAction.CLIENT_REPLACEMENT)
        if provisioning_runs == 0:
            findings.append(
                {
                    "code": "SUITE_PROVISIONING_MISSING",
                    "detail": "the suite has no provisioning event",
                }
            )
        if provisioning_runs > self.contract.max_provisioning_runs:
            findings.append(
                {
                    "code": "PROVISIONING_BUDGET_EXCEEDED",
                    "detail": (
                        f"{provisioning_runs} provisioning runs exceed "
                        f"budget {self.contract.max_provisioning_runs}"
                    ),
                }
            )
        if client_launches > self.contract.max_client_launches:
            findings.append(
                {
                    "code": "CLIENT_LAUNCH_BUDGET_EXCEEDED",
                    "detail": (
                        f"{client_launches} client launches exceed "
                        f"budget {self.contract.max_client_launches}"
                    ),
                }
            )
        expected = set(self.contract.scenario_ids)
        missing = sorted(expected - self._completed_scenarios)
        if missing:
            findings.append(
                {
                    "code": "SUITE_SCENARIOS_INCOMPLETE",
                    "detail": f"missing completed scenarios: {', '.join(missing)}",
                }
            )
        if self.contract.require_receiver_visible_proof:
            for scenario_id in self.contract.scenario_ids:
                scenario_actions = {
                    event.action
                    for event in self._events
                    if event.scenario_id == scenario_id
                }
                if SuiteRuntimeAction.UI_ACTION not in scenario_actions:
                    findings.append(
                        {
                            "code": "UI_ACTION_EVIDENCE_MISSING",
                            "detail": f"scenario {scenario_id!r} has no UI action",
                        }
                    )
                if (
                    SuiteRuntimeAction.RECEIVER_ASSERTION
                    not in scenario_actions
                ):
                    findings.append(
                        {
                            "code": "RECEIVER_ASSERTION_MISSING",
                            "detail": (
                                f"scenario {scenario_id!r} has no "
                                "receiver-visible assertion"
                            ),
                        }
                    )
        warm_reuse_rate = max(
            0.0,
            (
                len(self.contract.scenario_ids)
                - provisioning_runs
            )
            / len(self.contract.scenario_ids),
        )
        if warm_reuse_rate < self.contract.min_warm_reuse_rate:
            findings.append(
                {
                    "code": "WARM_REUSE_RATE_TOO_LOW",
                    "detail": (
                        f"warm reuse rate {warm_reuse_rate:.6f} is below "
                        f"{self.contract.min_warm_reuse_rate:.6f}"
                    ),
                }
            )
        if (
            not self._events
            or self._events[-1].action
            is not SuiteRuntimeAction.CLEANUP_COMPLETE
        ):
            findings.append(
                {
                    "code": "SUITE_CLEANUP_INCOMPLETE",
                    "detail": "the suite has no terminal cleanup-complete event",
                }
            )
        return findings


def validate_suite_runtime_report(
    value: object,
    *,
    expected_contract: RuntimeReuseContract | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_INVALID",
            "report must be an object",
        )
    required_fields = {
        "schemaVersion",
        "artifactKind",
        "suiteRuntimeId",
        "sourceDigest",
        "fixtureEpoch",
        "contract",
        "events",
        "metrics",
        "findings",
        "result",
        "proofState",
        "reportDigest",
    }
    if set(value) != required_fields:
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_INVALID",
            "report has unknown or missing fields",
        )
    if (
        value["schemaVersion"] != SCHEMA_VERSION
        or value["artifactKind"] != ARTIFACT_KIND
    ):
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_INVALID",
            "report identity is unsupported",
        )
    unsigned = dict(value)
    report_digest = unsigned.pop("reportDigest")
    if report_digest != _canonical_digest(unsigned):
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_DIGEST_MISMATCH",
            "report digest does not match its payload",
        )
    contract = RuntimeReuseContract.from_dict(value["contract"])
    if expected_contract is not None and contract != expected_contract:
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_CONTRACT_MISMATCH",
            "runtime report contract does not match the Task Slice",
        )
    ledger = SuiteRuntimeLedger(
        contract,
        suite_runtime_id=value["suiteRuntimeId"],
        source_digest=value["sourceDigest"],
        fixture_epoch=value["fixtureEpoch"],
    )
    events = value["events"]
    if not isinstance(events, list):
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_INVALID",
            "events must be an array",
        )
    expected_event_fields = {
        "sequence",
        "action",
        "scenarioId",
        "resourceId",
        "durationSeconds",
    }
    for index, event in enumerate(events, start=1):
        if not isinstance(event, dict) or set(event) != expected_event_fields:
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_REPORT_INVALID",
                f"event {index} has unknown or missing fields",
            )
        if event["sequence"] != index:
            raise SuiteRuntimeError(
                "SUITE_RUNTIME_REPORT_INVALID",
                f"event {index} has a non-monotonic sequence",
            )
        ledger.record(
            event["action"],
            scenario_id=event["scenarioId"],
            resource_id=event["resourceId"],
            duration_seconds=event["durationSeconds"],
        )
    recomputed = ledger.report()
    if recomputed != value:
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_REPLAY_MISMATCH",
            "runtime report does not equal the canonical event replay",
        )
    if recomputed["result"] != "PASS" or recomputed["proofState"] != "SUPPORTING":
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_UNPROVEN",
            "runtime report does not satisfy the lifecycle contract",
        )
    if recomputed["findings"]:
        raise SuiteRuntimeError(
            "SUITE_RUNTIME_REPORT_UNPROVEN",
            "a passing runtime report cannot contain findings",
        )
    return recomputed
