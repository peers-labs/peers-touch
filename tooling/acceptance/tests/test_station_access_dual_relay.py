from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import Mock

from tooling.acceptance.core import (
    ENVIRONMENTS_DIR,
    EnvironmentContract,
)
from tooling.acceptance.core.errors import EphemeralCapabilityBlocked
from tooling.acceptance.core.suite_runtime import (
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.station_access import (
    relay_attachment_lifecycle_e2e as lifecycle,
)
from tooling.acceptance.provisioners import (
    StationAccessDualRelayProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.station_access_dual_relay import (
    CAPABILITY_ID,
    DualRelayControlHandler,
)


ROOT = Path(__file__).resolve().parents[3]
EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}


def artifact(path: str) -> dict[str, str]:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": "RAL-G01",
        "runId": "20261015T120000000000Z-" + "b" * 32,
        "path": path,
        "sha256": "c" * 64,
        "mediaType": "application/json",
    }


def suite_report() -> dict[str, object]:
    ledger = SuiteRuntimeLedger(
        lifecycle.RUNTIME_REUSE_CONTRACT,
        suite_runtime_id="ral-suite",
        source_digest="a" * 40,
        fixture_epoch="fixture-1",
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id="station-access-dual-relay",
    )
    for scenario_id in lifecycle.SCENARIO_IDS:
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id="operator-surface",
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id="operator-projection",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return ledger.require_valid()


def lifecycle_report() -> dict[str, object]:
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": "RAL-G01",
        "gate": "RAL-G01",
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "runtime": {
            "relayAttachmentLifecycle": {
                "scenarios": {
                    gate_id: {"scenarioId": gate_id}
                    for gate_id in lifecycle.SCENARIO_IDS
                }
            }
        },
        "assertions": [
            {
                "name": assertion,
                "passed": True,
                "detail": "PASS",
            }
            for assertions in lifecycle.SCENARIO_ASSERTIONS.values()
            for assertion in assertions
        ],
    }


def passing_manifest(
    gate_id: str,
    *,
    source: dict[str, str] | None = None,
) -> dict[str, object]:
    manifest: dict[str, object] = {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": "20261015T120000000000Z-" + "d" * 32,
        "source": source or EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "result": {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "secretScan": {"status": "passed"},
        },
        "artifacts": {},
    }
    if gate_id == "RAL-G01":
        manifest["artifacts"] = {
            lifecycle.LIFECYCLE_REPORT_PATH: artifact(
                lifecycle.LIFECYCLE_REPORT_PATH
            ),
            "suite-runtime": artifact(lifecycle.SUITE_REPORT_PATH),
        }
    return manifest


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self) -> None:
        self.manifests = {
            gate_id: passing_manifest(gate_id)
            for gate_id in (
                *lifecycle.SCENARIO_IDS,
                "NCP-G03",
                "NCP-G07",
            )
        }

    def latest(
        self,
        gate_id: str,
        *,
        runtime_cell: str | None = None,
    ) -> dict[str, object]:
        del runtime_cell
        return self.manifests[gate_id]

    def read_json(self, reference) -> dict[str, object]:
        if reference.path == lifecycle.SUITE_REPORT_PATH:
            return suite_report()
        if reference.path == lifecycle.LIFECYCLE_REPORT_PATH:
            return lifecycle_report()
        raise AssertionError(reference.path)


class StationAccessDualRelayContractTest(unittest.TestCase):
    def test_environment_and_provisioner_are_registered(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "station-access-dual-relay.yaml"
        )

        provisioner = get_provisioner(contract)

        self.assertIsInstance(
            provisioner,
            StationAccessDualRelayProvisioner,
        )
        self.assertEqual(
            set(contract.services),
            {"station", "relay-a", "relay-b"},
        )
        self.assertEqual(contract.clients, ())

    def test_gate_catalog_defines_one_suite_owner_and_seven_projections(
        self,
    ) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]

        suite = gates["RAL-G01"]
        self.assertEqual(
            suite["environment"],
            "station-access-dual-relay",
        )
        self.assertEqual(
            suite["provisioner"],
            "station-access-dual-relay",
        )
        self.assertEqual(
            suite["ephemeralCapabilities"],
            [CAPABILITY_ID],
        )
        for gate_id in (*lifecycle.PROJECTION_GATE_IDS, "RAL-G08"):
            self.assertEqual(gates[gate_id]["environment"], "local")
            self.assertNotIn("provisioner", gates[gate_id])
            self.assertEqual(
                gates[gate_id]["argv"],
                suite["argv"],
            )

    def test_feature_capability_and_domain_trace_all_ral_gates(self) -> None:
        feature = json.loads(
            (
                ROOT
                / "tooling/acceptance/features/"
                "station-access-relay-attachment-lifecycle.yaml"
            ).read_text(encoding="utf-8")
        )
        capabilities = json.loads(
            (
                ROOT
                / "tooling/acceptance/capabilities/station-access.yaml"
            ).read_text(encoding="utf-8")
        )["capabilities"]
        domain = json.loads(
            (
                ROOT / "tooling/acceptance/domains/station-access.yaml"
            ).read_text(encoding="utf-8")
        )
        capability = next(
            item
            for item in capabilities
            if item["id"] == "station-access-relay-attachment-lifecycle"
        )

        self.assertEqual(
            feature["required_gates"],
            list(lifecycle.ALL_RAL_GATE_IDS),
        )
        self.assertEqual(
            capability["required_gates"],
            list(lifecycle.ALL_RAL_GATE_IDS),
        )
        self.assertIn(capability["id"], domain["capabilities"])

    def test_compose_runtime_has_isolated_station_and_relay_owners(
        self,
    ) -> None:
        source = (
            ROOT
            / "tooling/acceptance/runtime/"
            "station-access-dual-relay.compose.yml"
        ).read_text(encoding="utf-8")

        for service in (
            "station-postgres:",
            "station:",
            "relay-a-postgres:",
            "relay-a:",
            "relay-a-proxy:",
            "relay-b-postgres:",
            "relay-b:",
            "relay-b-proxy:",
        ):
            self.assertIn(f"  {service}", source)
        self.assertIn("restart: \"no\"", source)
        self.assertNotIn("container_name:", source)

    def test_projection_gates_validate_the_single_suite_generation(self) -> None:
        store = FakeStore()

        for gate_id in lifecycle.PROJECTION_GATE_IDS:
            gate = lifecycle.RelayAttachmentProjectionGate(
                gate_id,
                store=store,
                expected_source=EXPECTED_SOURCE,
            )
            result = gate.run()
            self.assertEqual(result["scenarioId"], gate_id)
            self.assertEqual(
                result["assertionCount"],
                len(lifecycle.SCENARIO_ASSERTIONS[gate_id]),
            )

    def test_aggregate_requires_ral_native_and_renewal_evidence(self) -> None:
        gate = lifecycle.RelayAttachmentAggregateGate(
            store=FakeStore(),
            expected_source=EXPECTED_SOURCE,
        )

        result = gate.run()

        self.assertEqual(
            result["gateCount"],
            len(lifecycle.RelayAttachmentAggregateGate.preceding_gates),
        )
        self.assertEqual(result["nativeContinuityGate"], "NCP-G03")
        self.assertEqual(result["renewalAndAdmissionGate"], "NCP-G07")

    def test_capability_projection_rejects_secret_material(self) -> None:
        handler = DualRelayControlHandler(
            transport=Mock(),
            project="pt-ral-test",
            station_url="http://station.example",
            relay_urls={
                "relay-a": "https://relay-a.example",
                "relay-b": "https://relay-b.example",
            },
            relay_cas={"relay-a": b"a", "relay-b": b"b"},
            relay_peer_ids={"relay-a": "peer-a", "relay-b": "peer-b"},
            container_ids={
                "station": "station",
                "relay-a": "relay-a",
                "relay-a-proxy": "relay-a-proxy",
                "relay-b": "relay-b",
                "relay-b-proxy": "relay-b-proxy",
                "relay-a-postgres": "postgres-a",
                "relay-b-postgres": "postgres-b",
            },
            source_commit="a" * 40,
            fixture_epoch="fixture",
        )
        handler._operator_tokens["relay-a"] = bytearray(b"secret-value")

        with self.assertRaises(EphemeralCapabilityBlocked):
            handler.project_response(
                "attachments",
                {"value": "secret-value"},
            )
        cleanup = handler.close()
        self.assertTrue(cleanup.closed)
        self.assertTrue(cleanup.secrets_zeroized)


if __name__ == "__main__":
    unittest.main()
