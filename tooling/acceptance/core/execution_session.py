"""A bounded repair cycle ledger; no source mutation or product proof owner."""

from __future__ import annotations

from typing import Any, Mapping

from .execution_budget import ExecutionBudgetError, digest


class ExecutionSession:
    """Keep scope fixed across attempts; source changes invalidate all proof."""

    def __init__(self, required_gate_ids: list[str], policy_digest: str) -> None:
        if not required_gate_ids or len(set(required_gate_ids)) != len(required_gate_ids):
            raise ExecutionBudgetError("execution session requires unique Gate IDs")
        self.required_gate_ids = tuple(required_gate_ids)
        self.scope_digest = digest(required_gate_ids)
        self.policy_digest = policy_digest
        self.attempts: list[dict[str, Any]] = []
        self.current_source: dict[str, str] | None = None
        self.state = "READY"
        self.lineage: dict[str, Any] | None = None

    @classmethod
    def from_prior(
        cls, required_gate_ids: list[str], policy_digest: str,
        prior_value: Mapping[str, Any], *,
        manifest_ref: Mapping[str, Any], session_ref: Mapping[str, Any],
    ) -> "ExecutionSession":
        """A policy change starts fresh; resolved prior evidence is lineage only."""
        from .evidence_store import ArtifactRef

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
    ) -> tuple[str, ...]:
        if self.state not in {"READY", "REPAIRED"}:
            raise ExecutionBudgetError("diagnose and qualify repair before the next attempt")
        dispatch = tuple(dispatch_gate_ids or self.required_gate_ids)
        if (
            len(dispatch) != len(self.required_gate_ids)
            or set(dispatch) != set(self.required_gate_ids)
        ):
            raise ExecutionBudgetError(
                "repair attempt must preserve the complete Gate scope"
            )
        source_changed = self.current_source is not None and dict(source) != self.current_source
        self.current_source = dict(source)
        self.attempts.append({
            "attempt": len(self.attempts) + 1,
            "source": dict(source),
            "scopeDigest": self.scope_digest,
            "policyDigest": self.policy_digest,
            "invalidatedPriorProof": source_changed or bool(self.lineage and not self.attempts),
            "gateIds": list(dispatch),
            "state": "RUNNING",
        })
        self.state = "RUNNING"
        return dispatch

    def observe(self, report: Mapping[str, Any], report_ref: Mapping[str, Any]) -> None:
        if self.state != "RUNNING":
            raise ExecutionBudgetError("no active execution attempt")
        results = report.get("results", [])
        if (
            report.get("source") != self.current_source
            or {item.get("id") for item in results} != set(self.required_gate_ids)
            or len(results) != len(self.required_gate_ids)
        ):
            raise ExecutionBudgetError("execution report source or full scope mismatch")
        stop = report.get("executionBudget", {}).get("stop")
        self.attempts[-1].update({"report": dict(report_ref), "stop": stop})
        self.state = "PAUSED" if stop or any(
            item.get("status") != "passed"
            or item.get("completionStatus") != "DONE"
            or item.get("proofStatus") != "PROVEN"
            for item in results
        ) else "QUALIFIED"
        self.attempts[-1]["state"] = self.state

    def repair(self, *, cause: str, owner: str, correction: str,
               validation_refs: list[Mapping[str, Any]], qualification: str) -> None:
        if self.state != "PAUSED":
            raise ExecutionBudgetError("repair requires a paused attempt")
        if qualification not in {"ARCHITECTURE_OVERHEAD", "REQUIRED_DURATION", "PRODUCT_FAILURE", "UNKNOWN"}:
            raise ExecutionBudgetError("unknown failure attribution")
        if not cause or not owner or not correction or not validation_refs:
            raise ExecutionBudgetError("repair requires cause, owner, correction and validation evidence")
        self.attempts[-1]["repair"] = {
            "cause": cause, "owner": owner, "correction": correction,
            "validationRefs": [dict(ref) for ref in validation_refs],
            "qualification": qualification,
        }
        self.state = "NEEDS_JUDGMENT" if qualification == "UNKNOWN" else "REPAIRED"

    def report(self) -> dict[str, Any]:
        value = {
            "artifactKind": "acceptance-execution-session",
            "state": self.state,
            "scopeDigest": self.scope_digest,
            "requiredGateIds": list(self.required_gate_ids),
            "policyDigest": self.policy_digest,
            "attempts": list(self.attempts),
            "proofStatus": "supporting-only",
        }
        if self.lineage is not None:
            value["lineage"] = self.lineage
        return value

    @classmethod
    def restore(cls, value: Mapping[str, Any]) -> "ExecutionSession":
        if value.get("artifactKind") != "acceptance-execution-session":
            raise ExecutionBudgetError("not an execution session ledger")
        session = cls(value["requiredGateIds"], value["policyDigest"])
        if "lineage" in value:
            from .evidence_store import ArtifactRef

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
        attempts = value.get("attempts")
        if not isinstance(attempts, list) or not attempts:
            raise ExecutionBudgetError("execution session has no attempts")
        for index, attempt in enumerate(attempts, 1):
            if (
                attempt.get("attempt") != index
                or not isinstance(attempt.get("gateIds"), list)
                or len(attempt["gateIds"]) != len(session.required_gate_ids)
                or set(attempt["gateIds"]) != set(session.required_gate_ids)
                or attempt.get("scopeDigest") != session.scope_digest
                or attempt.get("policyDigest") != session.policy_digest
                or not isinstance(attempt.get("source"), dict)
                or attempt.get("state") not in {"PAUSED", "QUALIFIED"}
            ):
                raise ExecutionBudgetError("invalid execution session attempt")
        session.attempts = list(attempts)
        session.current_source = dict(attempts[-1]["source"])
        session.state = value.get("state")
        if session.state != "PAUSED":
            raise ExecutionBudgetError("only a paused session can resume with a qualified repair")
        return session
