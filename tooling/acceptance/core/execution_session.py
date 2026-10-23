"""Fixed required scope across explicit bounded requests; no product proof owner."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping

from .execution_budget import ExecutionBudgetError, digest
from .evidence_store import ArtifactRef, new_run_id


class ExecutionSession:
    """Separate the complete obligation from a request's validated dispatch."""

    def __init__(self, required_gate_ids: list[str], policy_digest: str) -> None:
        if (
            not required_gate_ids
            or any(not isinstance(item, str) or not item for item in required_gate_ids)
            or len(set(required_gate_ids)) != len(required_gate_ids)
            or not isinstance(policy_digest, str) or not policy_digest
        ):
            raise ExecutionBudgetError("execution session requires unique Gate IDs")
        self.session_id = new_run_id()
        self.required_gate_ids = tuple(required_gate_ids)
        self.scope_digest = digest(required_gate_ids)
        self.policy_digest = policy_digest
        self.requests: list[dict[str, Any]] = []
        self.current_source: dict[str, str] | None = None
        self.graph_digest: str | None = None
        self.context_digest: str | None = None
        self.state = "READY"
        self.lineage: dict[str, Any] | None = None

    @classmethod
    def from_prior(
        cls, required_gate_ids: list[str], policy_digest: str,
        prior_value: Mapping[str, Any], *,
        manifest_ref: Mapping[str, Any], session_ref: Mapping[str, Any],
    ) -> "ExecutionSession":
        """A policy change starts fresh; resolved prior evidence is lineage only."""
        prior = cls.restore(prior_value)
        session = cls(required_gate_ids, policy_digest)
        if (
            set(prior.required_gate_ids) != set(session.required_gate_ids)
            or prior.policy_digest == policy_digest
        ):
            raise ExecutionBudgetError("new policy lineage must preserve scope and change policy")
        manifest = ArtifactRef.from_dict(manifest_ref)
        reference = ArtifactRef.from_dict(session_ref)
        if (
            manifest.path != "manifest.json"
            or reference.path != "reports/session.json"
            or (manifest.workspace_id, manifest.gate_id, manifest.run_id)
            != (reference.workspace_id, reference.gate_id, reference.run_id)
        ):
            raise ExecutionBudgetError("prior session lineage identity mismatch")
        session.lineage = {
            "manifest": manifest.to_dict(),
            "session": reference.to_dict(),
            "policyDigest": prior.policy_digest,
            "source": prior.current_source,
            "proofTransfer": "NONE",
        }
        return session

    def begin(
        self,
        source: Mapping[str, str],
        dispatch_gate_ids: list[str] | None = None,
        *,
        graph_digest: str,
        context_digest: str,
        validated_gate_ids: list[str] | None = None,
    ) -> tuple[str, ...]:
        if self.state not in {"READY", "REPAIRED", "PAUSED_REQUEST_EXHAUSTED"}:
            raise ExecutionBudgetError("diagnose and qualify repair before the next request")
        dispatch = tuple(self.required_gate_ids if dispatch_gate_ids is None else dispatch_gate_ids)
        validated = tuple(validated_gate_ids or ())
        if (
            len(set(dispatch)) != len(dispatch)
            or len(set(validated)) != len(validated)
            or set(dispatch) & set(validated)
            or set(dispatch) | set(validated) != set(self.required_gate_ids)
            or not graph_digest or not context_digest
        ):
            raise ExecutionBudgetError("request must account for the complete Gate scope")
        changed = self.current_source is not None and (
            dict(source) != self.current_source
            or graph_digest != self.graph_digest or context_digest != self.context_digest
        )
        if validated and (changed or self.state != "PAUSED_REQUEST_EXHAUSTED"):
            raise ExecutionBudgetError("changed or repaired candidate cannot transfer proof")
        self.current_source = dict(source)
        self.graph_digest = graph_digest
        self.context_digest = context_digest
        self.requests.append({
            "request": len(self.requests) + 1,
            "source": dict(source),
            "scopeDigest": self.scope_digest,
            "policyDigest": self.policy_digest,
            "graphDigest": graph_digest,
            "contextDigest": context_digest,
            "invalidatedPriorProof": changed or bool(self.lineage and not self.requests),
            "dispatchGateIds": list(dispatch),
            "validatedGateIds": list(validated),
            "state": "RUNNING",
        })
        self.state = "RUNNING"
        return dispatch

    @staticmethod
    def clean_request_exhaustion(report: Mapping[str, Any]) -> bool:
        stop = report.get("executionBudget", {}).get("stop")
        if not isinstance(stop, dict) or stop.get("reason") != "EXECUTION_BUDGET_STOP":
            return False
        overrun = stop.get("cost", {}).get("overrun", {})
        constraints = overrun.get("constraints", [])
        stopped = next(
            (item for item in report.get("results", []) if item.get("id") == stop.get("gateId")),
            {},
        )
        return (
            overrun.get("phase") == "work"
            and len(constraints) == 1
            and constraints[0].get("kind") == "request-work"
            and constraints[0].get("owner") == "Acceptance Runner"
            and constraints[0].get("source") == "requestSeconds"
            and stopped.get("cleanupStatus") in {"passed", "not-required"}
            and stopped.get("proofStatus") == "UNPROVEN"
            and not report.get("terminalObservation")
            and all(item.get("cleanupStatus", "not-required") in {"passed", "not-required"}
                    for item in report.get("results", []))
        )

    def observe(self, report: Mapping[str, Any], report_ref: Mapping[str, Any]) -> None:
        if self.state != "RUNNING":
            raise ExecutionBudgetError("no active execution request")
        results = report.get("results", [])
        if (
            report.get("source") != self.current_source
            or {item.get("id") for item in results} != set(self.required_gate_ids)
            or len(results) != len(self.required_gate_ids)
        ):
            raise ExecutionBudgetError("execution report source or full scope mismatch")
        reference = ArtifactRef.from_dict(report_ref)
        if reference.path != "reports/run.json":
            raise ExecutionBudgetError("session requires an original run report reference")
        stop = report.get("executionBudget", {}).get("stop")
        incomplete = stop or any(
            item.get("status") != "passed"
            or item.get("completionStatus") != "DONE"
            or item.get("proofStatus") != "PROVEN"
            or item.get("cleanupStatus", "not-required") not in {"passed", "not-required"}
            for item in results
        )
        self.state = (
            "PAUSED_REQUEST_EXHAUSTED" if self.clean_request_exhaustion(report)
            else "PAUSED_REPAIR_REQUIRED" if incomplete else "QUALIFIED"
        )
        self.requests[-1].update(
            report=reference.to_dict(), stop=deepcopy(stop), state=self.state,
        )

    def repair(self, *, cause: str, owner: str, correction: str,
               validation_refs: list[Mapping[str, Any]], qualification: str) -> None:
        if self.state != "PAUSED_REPAIR_REQUIRED":
            raise ExecutionBudgetError("repair requires a repair-required request")
        if qualification not in {"ARCHITECTURE_OVERHEAD", "REQUIRED_DURATION", "PRODUCT_FAILURE", "UNKNOWN"}:
            raise ExecutionBudgetError("unknown failure attribution")
        if not cause or not owner or not correction or not validation_refs:
            raise ExecutionBudgetError("repair requires cause, owner, correction and validation evidence")
        self.requests[-1]["repair"] = {
            "cause": cause, "owner": owner, "correction": correction,
            "validationRefs": [dict(ref) for ref in validation_refs],
            "qualification": qualification,
        }
        self.state = "NEEDS_JUDGMENT" if qualification == "UNKNOWN" else "REPAIRED"

    def report(self) -> dict[str, Any]:
        value = {
            "artifactKind": "acceptance-execution-session",
            "sessionId": self.session_id,
            "state": self.state,
            "scopeDigest": self.scope_digest,
            "requiredGateIds": list(self.required_gate_ids),
            "policyDigest": self.policy_digest,
            "requests": deepcopy(self.requests),
            "proofStatus": "supporting-only",
        }
        if self.lineage is not None:
            value["lineage"] = deepcopy(self.lineage)
        return value

    @classmethod
    def restore(cls, value: Mapping[str, Any]) -> "ExecutionSession":
        if value.get("artifactKind") != "acceptance-execution-session":
            raise ExecutionBudgetError("not an execution session ledger")
        fields = {
            "artifactKind", "sessionId", "state", "scopeDigest", "requiredGateIds",
            "policyDigest", "requests", "proofStatus",
        }
        if set(value) not in (fields, fields | {"lineage"}) or value.get("proofStatus") != "supporting-only":
            raise ExecutionBudgetError("execution session has unknown or missing fields")
        session = cls(value["requiredGateIds"], value["policyDigest"])
        from .evidence_store import validate_run_id

        validate_run_id(value["sessionId"])
        session.session_id = value["sessionId"]
        if "lineage" in value:
            lineage = value["lineage"]
            if (
                not isinstance(lineage, dict)
                or set(lineage) != {"manifest", "session", "policyDigest", "source", "proofTransfer"}
                or lineage.get("proofTransfer") != "NONE"
                or lineage.get("policyDigest") == session.policy_digest
                or not isinstance(lineage.get("source"), dict)
            ):
                raise ExecutionBudgetError("invalid execution session lineage")
            manifest = ArtifactRef.from_dict(lineage["manifest"])
            reference = ArtifactRef.from_dict(lineage["session"])
            if (
                manifest.path != "manifest.json"
                or reference.path != "reports/session.json"
                or (manifest.workspace_id, manifest.gate_id, manifest.run_id)
                != (reference.workspace_id, reference.gate_id, reference.run_id)
            ):
                raise ExecutionBudgetError("prior session lineage identity mismatch")
            session.lineage = dict(lineage)
        if value.get("scopeDigest") != session.scope_digest:
            raise ExecutionBudgetError("execution session scope digest mismatch")
        requests = value.get("requests")
        if not isinstance(requests, list) or not requests:
            raise ExecutionBudgetError("execution session has no requests")
        for index, request in enumerate(requests, 1):
            required_fields = {
                "request", "source", "scopeDigest", "policyDigest", "graphDigest",
                "contextDigest", "invalidatedPriorProof", "dispatchGateIds",
                "validatedGateIds", "state", "report", "stop",
            }
            if (
                not isinstance(request, dict)
                or set(request) not in (required_fields, required_fields | {"repair"})
                or request.get("request") != index
                or request.get("scopeDigest") != session.scope_digest
                or request.get("policyDigest") != session.policy_digest
                or not isinstance(request.get("source"), dict)
                or request.get("state") not in {
                    "PAUSED_REQUEST_EXHAUSTED", "PAUSED_REPAIR_REQUIRED", "QUALIFIED",
                }
            ):
                raise ExecutionBudgetError("invalid execution session request")
            dispatch, validated = request["dispatchGateIds"], request["validatedGateIds"]
            if (
                not isinstance(dispatch, list) or not isinstance(validated, list)
                or any(not isinstance(item, str) for item in [*dispatch, *validated])
                or len(set(dispatch)) != len(dispatch) or len(set(validated)) != len(validated)
                or set(dispatch) & set(validated)
                or set(dispatch) | set(validated) != set(session.required_gate_ids)
                or any(not isinstance(request[key], str) or not request[key]
                       for key in ("graphDigest", "contextDigest"))
                or type(request["invalidatedPriorProof"]) is not bool
            ):
                raise ExecutionBudgetError("invalid execution session request scope")
            reference = ArtifactRef.from_dict(request["report"])
            if reference.path != "reports/run.json":
                raise ExecutionBudgetError("invalid execution session report")
        session.requests = deepcopy(requests)
        session.current_source = dict(requests[-1]["source"])
        session.graph_digest = requests[-1]["graphDigest"]
        session.context_digest = requests[-1]["contextDigest"]
        session.state = value.get("state")
        if session.state != requests[-1]["state"] or session.state not in {
            "PAUSED_REQUEST_EXHAUSTED", "PAUSED_REPAIR_REQUIRED",
        }:
            raise ExecutionBudgetError("only an original paused session can resume")
        return session
