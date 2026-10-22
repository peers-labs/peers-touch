"""Bounded Gate lifecycle accounting; product proof remains runner-owned."""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import signal
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping


class ExecutionBudgetError(ValueError):
    pass


class ExecutionDeadline(BaseException):
    """A cancellation boundary that ordinary polling must not swallow."""

    def __init__(self, gate_id: str, stage: str, phase: str) -> None:
        self.gate_id = gate_id
        self.stage = stage
        self.phase = phase
        super().__init__(f"{gate_id}: {phase}/{stage} exceeded its deadline")


def positive_seconds(value: object, field: str) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
    ):
        raise ExecutionBudgetError(f"{field} must be positive finite seconds")
    return float(value)


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


@dataclass(frozen=True)
class GateBudget:
    total_seconds: float
    cleanup_seconds: float
    publish_seconds: float

    @classmethod
    def from_dict(cls, value: object) -> "GateBudget":
        fields = {"totalSeconds", "cleanupSeconds", "publishSeconds"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ExecutionBudgetError("Gate budget has unknown or missing fields")
        budget = cls(
            positive_seconds(value["totalSeconds"], "totalSeconds"),
            positive_seconds(value["cleanupSeconds"], "cleanupSeconds"),
            positive_seconds(value["publishSeconds"], "publishSeconds"),
        )
        if budget.work_seconds <= 0:
            raise ExecutionBudgetError("Gate budget must reserve time for work")
        return budget

    @property
    def work_seconds(self) -> float:
        return self.total_seconds - self.cleanup_seconds - self.publish_seconds

    def to_dict(self) -> dict[str, float]:
        return {
            "totalSeconds": self.total_seconds,
            "cleanupSeconds": self.cleanup_seconds,
            "publishSeconds": self.publish_seconds,
        }


class ExecutionBudgetPolicy:
    """Explicit experimental thresholds; never learns a larger deadline."""

    def __init__(self, value: object) -> None:
        fields = {"requestSeconds", "planningSeconds", "default", "tiers", "gates"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ExecutionBudgetError("execution budget has unknown or missing fields")
        self.request_seconds = positive_seconds(value["requestSeconds"], "requestSeconds")
        self.planning_seconds = positive_seconds(value["planningSeconds"], "planningSeconds")
        self.default = GateBudget.from_dict(value["default"])
        self.tiers = self._budgets(value["tiers"], "tiers")
        self.gates = self._budgets(value["gates"], "gates")
        self.identity = digest(value)

    @staticmethod
    def _budgets(value: object, field: str) -> dict[str, GateBudget]:
        if not isinstance(value, dict) or any(
            not isinstance(key, str) or not key for key in value
        ):
            raise ExecutionBudgetError(f"{field} must be an identifier map")
        return {key: GateBudget.from_dict(item) for key, item in value.items()}

    def for_gate(self, gate: Mapping[str, Any]) -> GateBudget:
        return self.gates.get(
            gate["id"], self.tiers.get(gate.get("tier", ""), self.default)
        )


@contextlib.contextmanager
def deadline(seconds: float, error: ExecutionDeadline):
    """Interrupt synchronous POSIX owner calls, preserving an outer timer."""
    positive_seconds(seconds, "deadline")
    if not hasattr(signal, "setitimer") or threading.current_thread() is not threading.main_thread():
        raise ExecutionBudgetError("bounded owner calls require a POSIX main thread")
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()

    def expired(_signal: int, _frame: Any) -> None:
        raise error

    signal.signal(signal.SIGALRM, expired)
    effective = min(seconds, previous_timer[0]) if previous_timer[0] else seconds
    signal.setitimer(signal.ITIMER_REAL, effective)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            remaining = previous_timer[0] - (time.monotonic() - started)
            # An expired enclosing timer has already cancelled the call.
            # Re-arming it while its owner unwinds can deliver SIGALRM after
            # the default handler is restored, killing the diagnostic owner.
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, previous_timer[1])


class GateExecution:
    """One work deadline and reserved cleanup/publish tails, not per-call resets."""

    def __init__(self, gate_id: str, budget: GateBudget, request_deadline: float) -> None:
        self.gate_id = gate_id
        self.budget = budget
        self.started = time.monotonic()
        self.ends = {
            "work": min(self.started + budget.work_seconds, request_deadline),
            "cleanup": min(
                self.started + budget.work_seconds + budget.cleanup_seconds,
                request_deadline + budget.cleanup_seconds,
            ),
            "publish": min(
                self.started + budget.total_seconds,
                request_deadline + budget.cleanup_seconds + budget.publish_seconds,
            ),
        }
        self.spans: list[dict[str, Any]] = []
        self.overrun: dict[str, str] | None = None
        self._phase = "work"
        self._finished: float | None = None

    def remaining(self, phase: str = "work") -> float:
        return max(0.0, self.ends[phase] - time.monotonic())

    def enter_phase(self, phase: str) -> None:
        order = ("work", "cleanup", "publish")
        if phase not in order or order.index(phase) < order.index(self._phase):
            raise ExecutionBudgetError("Gate lifecycle cannot move backwards")
        if phase != self._phase:
            reserve = getattr(self.budget, f"{phase}_seconds")
            self.ends[phase] = min(self.ends[phase], time.monotonic() + reserve)
        self._phase = phase

    @contextlib.contextmanager
    def stage(self, name: str, *, phase: str = "work"):
        self.enter_phase(phase)
        started = time.monotonic()
        status = "completed"
        try:
            remaining = self.remaining(phase)
            if remaining <= 0:
                raise ExecutionDeadline(self.gate_id, name, phase)
            # The launcher already enforces the work deadline. Its termination
            # must finish inside the reserved cleanup tail without being
            # interrupted by a second alarm at the same work boundary.
            termination_tail = (
                min(3.1, self.budget.cleanup_seconds)
                if name == "command" and phase == "work" else 0
            )
            with deadline(
                remaining + termination_tail,
                ExecutionDeadline(self.gate_id, name, phase),
            ):
                yield
        except ExecutionDeadline:
            status = "overrun"
            self.overrun = self.overrun or {"stage": name, "phase": phase}
            raise
        except BaseException:
            status = "failed"
            raise
        finally:
            if time.monotonic() >= self.ends[phase]:
                self.overrun = self.overrun or {"stage": name, "phase": phase}
                if status == "completed":
                    status = "overrun"
            self.spans.append({
                "stage": name,
                "phase": phase,
                "startSeconds": round(started - self.started, 6),
                "durationSeconds": round(time.monotonic() - started, 6),
                "status": status,
            })

    def call(self, name: str, function: Callable[..., Any], *args: Any,
             phase: str = "work", **kwargs: Any) -> Any:
        with self.stage(name, phase=phase):
            return function(*args, **kwargs)

    def finish(self) -> None:
        if self._finished is None:
            self._finished = time.monotonic()

    def report(self) -> dict[str, Any]:
        elapsed = (self._finished or time.monotonic()) - self.started
        if elapsed > self.budget.total_seconds and self.overrun is None:
            self.overrun = {"stage": "gate-total", "phase": self._phase}
        return {
            "gateId": self.gate_id,
            "budget": self.budget.to_dict(),
            "durationSeconds": round(elapsed, 6),
            "state": "OVER_BUDGET" if self.overrun else "WITHIN_BUDGET",
            "overrun": self.overrun,
            "attribution": (
                "ARCHITECTURE_OVERHEAD"
                if self.overrun and self.overrun["phase"] != "work"
                else "UNKNOWN" if self.overrun else None
            ),
            "mandatoryDuration": "UNPROVEN",
            "spans": list(self.spans),
            "stageGranularity": "owner-boundary",
            "productProof": "runner-owned",
        }


def execute_stage(execution: GateExecution | None, name: str,
                  function: Callable[..., Any], *args: Any,
                  phase: str = "work", **kwargs: Any) -> Any:
    if execution is None:
        return function(*args, **kwargs)
    return execution.call(name, function, *args, phase=phase, **kwargs)


def freeze_scope(
    definitions: Mapping[str, Any],
    capabilities: list[dict[str, Any]],
    *,
    excluded_domains: list[str],
    excluded_gates: list[str],
) -> dict[str, Any]:
    """Every catalog node gets an inclusion decision; shared dependencies stay."""
    gate_owners: dict[str, set[str]] = {gate_id: set() for gate_id in definitions}
    gate_requirements: dict[str, list[str]] = {gate_id: [] for gate_id in definitions}
    domains = {item["domain"] for item in capabilities}
    unknown = set(excluded_domains) - domains
    if unknown or set(excluded_gates) - set(definitions):
        raise ExecutionBudgetError("scope exclusions contain unknown domains or Gates")
    for capability in capabilities:
        for gate_id in capability.get("required_gates", []):
            if gate_id not in definitions:
                raise ExecutionBudgetError(f"capability references missing Gate {gate_id}")
            gate_owners[gate_id].add(capability["domain"])
            gate_requirements[gate_id].append(capability["id"])
    decisions = []
    for gate_id, definition in definitions.items():
        owners = gate_owners[gate_id]
        explicit = gate_id in excluded_gates
        domain_only = bool(owners) and owners <= set(excluded_domains)
        catalog_execution = definition.get("catalogExecution", "automatic")
        if catalog_execution not in {"automatic", "manual"}:
            raise ExecutionBudgetError(
                f"{gate_id}: invalid catalogExecution"
            )
        manual = catalog_execution == "manual"
        decisions.append({
            "gateId": gate_id,
            "included": not (explicit or domain_only or manual),
            "reason": (
                "explicit-gate-exclusion" if explicit else
                "excluded-domain-only" if domain_only else
                "manual-execution-only" if manual else
                "shared-or-included-domain" if owners else "unmapped-included"
            ),
            "catalogExecution": catalog_execution,
            "domains": sorted(owners),
            "capabilityIds": sorted(gate_requirements[gate_id]),
            "definitionDigest": digest(definition),
            "executionModel": (
                "prerequisite-judgment" if definition.get("judgment") else
                "producer-with-prerequisites" if definition.get("dependsOn") else "opaque-gate"
            ),
            "reuseQualification": (
                "explicit-prerequisites" if definition.get("dependsOn") else "NOT_DECLARED"
            ),
        })
    scope = {
        "artifactKind": "acceptance-execution-scope",
        "excludedDomains": sorted(set(excluded_domains)),
        "excludedGateIds": sorted(set(excluded_gates)),
        "decisions": decisions,
        "requiredGateIds": [item["gateId"] for item in decisions if item["included"]],
        "capabilityDigest": digest(capabilities),
    }
    rank = {"ci-structure": 0, "ci-cheap": 1, "env-evidence": 2, "local-evidence": 3}
    scope["dispatchGateIds"] = sorted(
        scope["requiredGateIds"],
        key=lambda gate_id: rank.get(definitions[gate_id].get("tier", ""), 4),
    )
    scope["digest"] = digest(scope)
    return scope


def stopped_results(gates: list[dict[str, Any]], completed_ids: set[str],
                    stop: Mapping[str, Any]) -> list[dict[str, Any]]:
    stop_reference = {
        key: stop[key] for key in ("gateId", "reason", "policyDigest") if key in stop
    }
    return [
        {
            "id": gate["id"],
            "status": "blocked",
            "completionStatus": "BLOCKED",
            "proofStatus": "UNPROVEN",
            "duration_seconds": 0,
            "reason": "not dispatched after execution stopped",
            "blockedReason": stop.get("reason", "EXECUTION_BUDGET_STOP"),
            "executionStop": stop_reference,
            "artifactPath": {"executionStop": stop_reference},
            "sampleEmissionAllowed": False,
        }
        for gate in gates if gate["id"] not in completed_ids
    ]
