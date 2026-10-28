"""Bounded Gate lifecycle accounting; product proof remains runner-owned."""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import signal
import threading
import time
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Callable, Mapping, Sequence

from .operation_observer import OperationObserver


class ExecutionBudgetError(ValueError):
    pass


class ExecutionDeadline(BaseException):
    """A cancellation boundary that ordinary polling must not swallow."""

    def __init__(self, gate_id: str, stage: str, phase: str, *,
                 constraints: list[dict[str, Any]] | None = None) -> None:
        self.gate_id = gate_id
        self.stage = stage
        self.phase = phase
        self.constraints = constraints or []
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
class GateTimeLimits:
    """Exit protections and explicitly owned work limits; no default Gate cap."""

    cleanup_seconds: float
    publish_seconds: float
    work_seconds: float | None = None
    operations: Mapping[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        positive_seconds(self.cleanup_seconds, "cleanupSeconds")
        positive_seconds(self.publish_seconds, "publishSeconds")
        if self.work_seconds is not None:
            positive_seconds(self.work_seconds, "workSeconds")
        if not isinstance(self.operations, Mapping) or any(
            not isinstance(key, str) or not key for key in self.operations
        ):
            raise ExecutionBudgetError("operations must be an owner-stage map")
        object.__setattr__(self, "operations", MappingProxyType({
            key: positive_seconds(limit, f"operations.{key}")
            for key, limit in self.operations.items()
        }))

    @classmethod
    def from_dict(cls, value: object) -> "GateTimeLimits":
        required = {"cleanupSeconds", "publishSeconds"}
        optional = {"workSeconds", "operations"}
        if (
            not isinstance(value, dict)
            or not required <= set(value)
            or set(value) - required - optional
        ):
            raise ExecutionBudgetError("Gate time limits have unknown or missing fields")
        operations = value.get("operations", {})
        if not isinstance(operations, dict) or any(
            not isinstance(key, str) or not key for key in operations
        ):
            raise ExecutionBudgetError("operations must be an owner-stage map")
        return cls(
            positive_seconds(value["cleanupSeconds"], "cleanupSeconds"),
            positive_seconds(value["publishSeconds"], "publishSeconds"),
            positive_seconds(value["workSeconds"], "workSeconds")
            if "workSeconds" in value else None,
            {key: positive_seconds(limit, f"operations.{key}")
             for key, limit in operations.items()},
        )

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "cleanupSeconds": self.cleanup_seconds,
            "publishSeconds": self.publish_seconds,
        }
        if self.work_seconds is not None:
            value["workSeconds"] = self.work_seconds
        if self.operations:
            value["operations"] = dict(self.operations)
        return value


class ExecutionBudgetPolicy:
    """Independent request, owner-operation and exit protections."""

    def __init__(self, value: object) -> None:
        fields = {"requestSeconds", "planningSeconds", "lifecycle", "gates"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ExecutionBudgetError("execution budget has unknown or missing fields")
        self.request_seconds = positive_seconds(value["requestSeconds"], "requestSeconds")
        self.planning_seconds = positive_seconds(value["planningSeconds"], "planningSeconds")
        self.lifecycle = GateTimeLimits.from_dict(value["lifecycle"])
        if self.lifecycle.work_seconds is not None or self.lifecycle.operations:
            raise ExecutionBudgetError("lifecycle cannot define a uniform work or operation cap")
        self.gates = self._budgets(value["gates"], "gates")
        self.identity = digest(value)

    @staticmethod
    def _budgets(value: object, field: str) -> dict[str, GateTimeLimits]:
        if not isinstance(value, dict) or any(
            not isinstance(key, str) or not key for key in value
        ):
            raise ExecutionBudgetError(f"{field} must be an identifier map")
        return {key: GateTimeLimits.from_dict(item) for key, item in value.items()}

    def for_gate(self, gate: Mapping[str, Any]) -> GateTimeLimits:
        return self.gates.get(gate["id"], self.lifecycle)


@contextlib.contextmanager
def deadline(seconds: float, error: ExecutionDeadline):
    """Interrupt synchronous POSIX owner calls, preserving an outer timer."""
    positive_seconds(seconds, "deadline")
    if not hasattr(signal, "setitimer") or threading.current_thread() is not threading.main_thread():
        raise ExecutionBudgetError("bounded owner calls require a POSIX main thread")
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    outer_first = bool(previous_timer[0] and previous_timer[0] <= seconds)

    def expired(_signal: int, _frame: Any) -> None:
        nonlocal outer_first
        if outer_first:
            if not callable(previous_handler):
                # Preserve ambient SIG_DFL/SIG_IGN semantics rather than
                # falsely assigning an outer alarm to this operation.
                signal.signal(signal.SIGALRM, previous_handler)
                signal.raise_signal(signal.SIGALRM)
                signal.signal(signal.SIGALRM, expired)
            else:
                previous_handler(_signal, _frame)
            outer_first = False
            remaining = seconds - (time.monotonic() - started)
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining)
                return
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
    """Request-bound work and phase tails fixed on first entry."""

    def __init__(self, gate_id: str, budget: GateTimeLimits, request_deadline: float) -> None:
        self.gate_id = gate_id
        self.budget = budget
        self.started = time.monotonic()
        self.request_deadline = request_deadline
        work_end = min(
            self.started + budget.work_seconds if budget.work_seconds is not None
            else request_deadline,
            request_deadline,
        )
        self.ends = {
            "work": work_end,
            "cleanup": min(
                work_end + budget.cleanup_seconds,
                request_deadline + budget.cleanup_seconds,
            ),
            "publish": min(
                work_end + budget.cleanup_seconds + budget.publish_seconds,
                request_deadline + budget.cleanup_seconds + budget.publish_seconds,
            ),
        }
        self.spans: list[dict[str, Any]] = []
        self.overrun: dict[str, Any] | None = None
        self._phase = "work"
        self._finished: float | None = None
        self.observer = OperationObserver(gate_id)

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
    def stage(self, name: str, *, phase: str = "work",
              timeout_seconds: float | None = None):
        self.enter_phase(phase)
        started = time.monotonic()
        status = "completed"
        declared_limits = [
            limit for limit in (
                positive_seconds(timeout_seconds, name) if timeout_seconds is not None else None,
                self.budget.operations.get(name),
            ) if limit is not None
        ]
        operation_limit = min(declared_limits) if declared_limits else None
        protections = []
        if phase == "work":
            protections.append(("request-work", self.request_deadline, "requestSeconds"))
            if self.budget.work_seconds is not None:
                protections.append((
                    "gate-work", self.started + self.budget.work_seconds, "explicit owner workSeconds",
                ))
        else:
            protections.append((phase, self.ends[phase], f"{phase}Seconds; fixed first-entry tail"))
        if operation_limit is not None:
            operation_sources = []
            if timeout_seconds == operation_limit:
                operation_sources.append("caller timeout_seconds")
            if self.budget.operations.get(name) == operation_limit:
                operation_sources.append(f"exact Gate operations.{name}")
            protections.append((
                "owner-operation", started + operation_limit,
                "; ".join(operation_sources),
            ))
        effective_end = min(end for _kind, end, _source in protections)
        triggered = [
            {"kind": kind, "owner": self.gate_id if kind != "request-work" else "Acceptance Runner",
             "source": source, "deadlineSeconds": round(end - self.started, 6)}
            for kind, end, source in protections if end == effective_end
        ]
        cancellation = ExecutionDeadline(self.gate_id, name, phase, constraints=triggered)
        try:
            with self.observer.observe(name, phase, effective_end):
                remaining = max(0, effective_end - time.monotonic())
                if remaining <= 0:
                    raise cancellation
                with deadline(remaining, cancellation):
                    yield
        except ExecutionDeadline as error:
            status = "overrun"
            self.overrun = self.overrun or {
                "stage": error.stage, "phase": error.phase,
                "constraints": error.constraints,
            }
            raise
        except BaseException:
            status = "failed"
            raise
        finally:
            if time.monotonic() >= effective_end:
                self.overrun = self.overrun or {
                    "stage": name, "phase": phase, "constraints": triggered,
                }
                if status == "completed":
                    status = "overrun"
            self.spans.append({
                "stage": name,
                "phase": phase,
                "startSeconds": round(started - self.started, 6),
                "durationSeconds": round(time.monotonic() - started, 6),
                "status": status,
                "operationLimitSeconds": operation_limit,
                "effectiveDeadlineSeconds": round(effective_end - self.started, 6),
                "limitingConstraints": triggered,
            })

    def call(self, name: str, function: Callable[..., Any], *args: Any,
             phase: str = "work", **kwargs: Any) -> Any:
        with self.stage(name, phase=phase):
            return function(*args, **kwargs)

    def finish(self) -> None:
        if self._finished is None:
            self._finished = time.monotonic()

    def limit_disposition(self) -> str | None:
        if not self.overrun:
            return None
        kinds = [item.get("kind") for item in self.overrun.get("constraints", [])]
        if self.overrun["phase"] == "work" and kinds == ["request-work"]:
            return "REQUEST_PREEMPTED"
        if self.overrun["phase"] != "work":
            return "EXIT_PROTECTION_EXPIRED"
        return "OWNER_LIMIT_EXPIRED" if len(kinds) == 1 else "MIXED_OR_UNKNOWN_LIMIT"

    def report(self) -> dict[str, Any]:
        elapsed = (self._finished or time.monotonic()) - self.started
        return {
            "gateId": self.gate_id,
            "budget": self.budget.to_dict(),
            "durationSeconds": round(elapsed, 6),
            "state": "OVER_BUDGET" if self.overrun else "WITHIN_BUDGET",
            "overrun": self.overrun,
            "limitDisposition": self.limit_disposition(),
            "attribution": (
                "ADMINISTRATIVE_PREEMPTION" if self.limit_disposition() == "REQUEST_PREEMPTED"
                else "ARCHITECTURE_OVERHEAD"
                if self.overrun and self.overrun["phase"] != "work"
                else "UNKNOWN" if self.overrun else None
            ),
            "mandatoryDuration": "UNPROVEN",
            "performanceStatus": "UNPROVEN",
            "progressContract": "owner-liveness; business-progress-unproven",
            "operationObservation": self.observer.report(),
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
    features: Sequence[Mapping[str, Any]] = (),
    domains: Sequence[Mapping[str, Any]] = (),
    rules: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Every catalog node gets an inclusion decision; shared dependencies stay."""
    from .scope_ownership import collect_scope_ownership

    try:
        ownership = collect_scope_ownership(
            definitions, capabilities, features=features, domains=domains, rules=rules,
        )
    except ValueError as error:
        raise ExecutionBudgetError(str(error)) from error
    unknown = set(excluded_domains) - set(ownership["domains"])
    if unknown or set(excluded_gates) - set(definitions):
        raise ExecutionBudgetError("scope exclusions contain unknown domains or Gates")
    decisions = []
    for gate_id, definition in definitions.items():
        owners = set(ownership["owners"][gate_id])
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
            "capabilityIds": [
                item["id"] for item in ownership["sources"][gate_id]
                if item["kind"] == "capability"
            ],
            "ownershipSources": ownership["sources"][gate_id],
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
        "ownershipDigest": digest({
            "capabilities": capabilities, "features": features,
            "domains": domains, "rules": rules,
        }),
        "unresolvedFeatureReferences": ownership["unresolvedFeatureReferences"],
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
