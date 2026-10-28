"""Consume authoritative, source-bound evidence for the accepted API closure."""

from dataclasses import asdict

from tooling.acceptance.core import AcceptanceGate, EvidenceStore, GateError, REPO_ROOT, source_identity
from tooling.acceptance.station_access_evidence import AggregateResult, GateSpec, check_gate


REQUIRED_GATES = (
    "x-config-operator-login-contract",
    "x-config-snapshot-core-contract",
    "x-config-snapshot-publication-contract",
    "x-config-admin-api-contract",
    "x-config-console-admin-e2e",
    "x-config-desktop-adapter-contract",
    "x-config-mobile-adapter-contract",
    "x-config-domain-validation",
    "x-config-home-operator-login-e2e",
    "x-config-home-publication-e2e",
)


class APIAggregateGate(AcceptanceGate):
    gate_id = "x-config-api-aggregate-e2e"
    phase = "CCP-10"
    bom = ("CCP-10-API-CLOSURE",)
    spec = (
        "docs/architecture/platform/client/control-plane/execution-plans/"
        "20261018-client-control-complete/tasks/CCP-10-API-CLOSURE.md",
    )

    def run(self):
        source = source_identity(REPO_ROOT)
        store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
        results = [
            check_gate(store, GateSpec("CCP-COMPLETE", gate), expected_source=source)
            for gate in REQUIRED_GATES
        ]
        self.report.runtime.update({
            "source": source, "gates": [asdict(result) for result in results],
            "proofStatus": "UNPROVEN",
            "completionStatus": "PARTIAL",
        })
        for result in results:
            self.report.add_assertion(result.gate_id, result.status == "PASS", result.detail)
        missing = [result for result in results if result.status != "PASS"]
        if not AggregateResult(source, results).passed:
            raise GateError("X Config API closure remains unproven: " + ", ".join(
                result.gate_id+"="+result.status for result in missing))
        return {"source": source, "gateCount": len(results), "proofStatus": "PROVEN"}


if __name__ == "__main__":
    raise SystemExit(APIAggregateGate().execute())
