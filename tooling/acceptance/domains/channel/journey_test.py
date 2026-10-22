from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import BlockedError, GateError, REPO_ROOT
from tooling.acceptance.gates.channel.lark_e2e import (
    LarkChannelJourneyGate,
)

from .contract import (
    GATE_TO_JOURNEY,
    JOURNEY_CONTRACTS,
    ServiceIdentity,
    SourceIdentity,
    SuiteManifest,
    journey_contract,
)
from .runtime import (
    CHANNEL_API_PREFIX,
    SCENARIO_OBSERVATION_KIND,
    SCENARIO_PLAN_KIND,
    SCENARIO_PROTOCOL_VERSION,
    StationChannelClient,
    canonical_digest,
    validate_scenario_observation,
    validate_scenario_plan,
)


def current_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def valid_manifest() -> dict[str, object]:
    commit = current_commit()
    protocol_digest = "a" * 64
    return {
        "artifactKind": "lark-channel-suite-runtime-manifest",
        "schemaVersion": 2,
        "suiteRuntimeId": "lark-suite-test",
        "fixtureEpoch": "fixture-test",
        "source": {
            "worktree": str(REPO_ROOT),
            "commit": commit,
            "workspaceDigest": "clean",
            "protocolDigest": protocol_digest,
        },
        "services": {
            "station": {
                "kind": "station",
                "endpoint": "http://127.0.0.1:18080",
                "liveCommit": commit,
                "workspaceDigest": "clean",
                "protocolDigest": protocol_digest,
                "runtimeIdentity": "station-test",
            },
            "journey-control": {
                "kind": "lark-journey-control",
                "endpoint": "http://127.0.0.1:18081",
                "liveCommit": commit,
                "workspaceDigest": "clean",
                "protocolDigest": protocol_digest,
                "runtimeIdentity": "journey-control-test",
            },
        },
        "actors": {
            "station-operator": {
                "kind": "station-operator",
            },
            "lark-sender": {
                "kind": "lark-user",
                "executableRef": "env:PT_LARK_TEST_CLI",
                "configDirRef": "env:PT_LARK_TEST_SENDER_CONFIG",
                "dataDirRef": "env:PT_LARK_TEST_SENDER_DATA",
                "profile": "requester",
            },
            "lark-receiver": {
                "kind": "lark-user",
                "executableRef": "env:PT_LARK_TEST_CLI",
                "configDirRef": "env:PT_LARK_TEST_RECEIVER_CONFIG",
                "dataDirRef": "env:PT_LARK_TEST_RECEIVER_DATA",
                "profile": "requester",
            },
            "desktop-native": {
                "kind": "desktop-native",
                "webdriverHost": "127.0.0.1",
                "webdriverPort": 4445,
            },
        },
        "resources": {
            "primary_binding": "env:PT_LARK_TEST_PRIMARY_BINDING",
            "direct_chat": "env:PT_LARK_TEST_DIRECT_CHAT",
        },
        "capabilities": {
            "station-channel-api": {
                "kind": "station-channel-api",
                "subjectKind": "service",
                "subjectId": "station",
                "tokenRef": "env:PT_LARK_TEST_STATION_TOKEN",
            },
            "lark-sender": {
                "kind": "lark-sender",
                "subjectKind": "actor",
                "subjectId": "lark-sender",
                "tokenRef": "",
            },
            "lark-receiver": {
                "kind": "lark-receiver",
                "subjectKind": "actor",
                "subjectId": "lark-receiver",
                "tokenRef": "",
            },
            "journey-control": {
                "kind": "journey-control",
                "subjectKind": "service",
                "subjectId": "journey-control",
                "tokenRef": "env:PT_LARK_TEST_CONTROL_TOKEN",
            },
            "fault-control": {
                "kind": "fault-control",
                "subjectKind": "service",
                "subjectId": "journey-control",
                "tokenRef": "env:PT_LARK_TEST_CONTROL_TOKEN",
            },
        },
        "cleanup": {
            "policy": "namespaced",
            "ownedResourcePrefix": "lark-test",
            "releaseRequired": True,
        },
    }


class JourneyContractTest(unittest.TestCase):
    def test_declares_every_plan_journey_and_gate(self) -> None:
        self.assertEqual(len(JOURNEY_CONTRACTS), 22)
        self.assertEqual(len(GATE_TO_JOURNEY), 22)
        self.assertEqual(
            set(JOURNEY_CONTRACTS),
            {
                *(f"LARK-J{value:02d}" for value in range(1, 18)),
                "LARK-J18A",
                "LARK-J18B",
                "LARK-J18C",
                "LARK-J19",
                "LARK-J20",
            },
        )
        self.assertEqual(
            journey_contract("LARK-J18A").gate_id,
            "lark-18a-e2e",
        )

    def test_runtime_reuse_matches_two_scenario_contract(self) -> None:
        for contract in JOURNEY_CONTRACTS.values():
            reuse = contract.runtime_reuse
            self.assertEqual(reuse["scenarioIds"], list(contract.scenario_ids))
            self.assertTrue(reuse["requireAttachOnlyScenarios"])
            self.assertTrue(reuse["requireReceiverVisibleProof"])


class SuiteManifestTest(unittest.TestCase):
    def write_manifest(self, payload: dict[str, object]) -> Path:
        root = Path(tempfile.mkdtemp(prefix="lark-manifest-test-"))
        path = root / "manifest.json"
        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.addCleanup(
            lambda: __import__("shutil").rmtree(root, ignore_errors=True)
        )
        return path

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_loads_closed_source_bound_manifest(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        manifest = SuiteManifest.load(self.write_manifest(valid_manifest()))
        contract = journey_contract("LARK-J01")
        manifest.require_for(contract)
        self.assertEqual(manifest.station.service_id, "station")
        self.assertEqual(
            manifest.evidence_projection()["resources"],
            ["direct_chat", "primary_binding"],
        )

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_missing_live_capability_fails_closed(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        del payload["capabilities"]["fault-control"]  # type: ignore[index]
        manifest = SuiteManifest.load(self.write_manifest(payload))
        with self.assertRaisesRegex(BlockedError, "fault-control BLOCKED"):
            manifest.require_for(journey_contract("LARK-J01"))

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_unprovisioned_controls_and_resources_are_individually_blocked(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        payload["resources"] = {}
        del payload["capabilities"]["journey-control"]  # type: ignore[index]
        del payload["capabilities"]["fault-control"]  # type: ignore[index]
        manifest = SuiteManifest.load(self.write_manifest(payload))
        with self.assertRaisesRegex(
            BlockedError,
            (
                "fault-control BLOCKED; journey-control BLOCKED; "
                "resource:direct_chat BLOCKED; resource:primary_binding BLOCKED"
            ),
        ):
            manifest.require_for(journey_contract("LARK-J01"))

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_gate_keeps_source_projection_when_runtime_is_blocked(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        payload["resources"] = {}
        del payload["capabilities"]["journey-control"]  # type: ignore[index]
        del payload["capabilities"]["fault-control"]  # type: ignore[index]
        gate = LarkChannelJourneyGate(
            "LARK-J01",
            self.write_manifest(payload),
        )
        with self.assertRaises(BlockedError):
            gate.run()
        self.assertEqual(
            gate.report.manifest["source"]["commit"],
            current_commit(),
        )

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_station_channel_capability_requires_token_reference(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        payload["capabilities"]["station-channel-api"]["tokenRef"] = ""  # type: ignore[index]
        manifest = SuiteManifest.load(self.write_manifest(payload))
        with self.assertRaisesRegex(GateError, "source-bound tokenRef"):
            manifest.require_for(journey_contract("LARK-J01"))

    @patch.object(SourceIdentity, "validate_current_source")
    @patch.object(ServiceIdentity, "validate_source")
    def test_fault_control_must_be_source_bound_and_real(
        self,
        _validate_service: object,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        payload["services"]["journey-control"]["kind"] = "fake-control"  # type: ignore[index]
        manifest = SuiteManifest.load(self.write_manifest(payload))
        with self.assertRaisesRegex(GateError, "lark-journey-control service"):
            manifest.require_for(journey_contract("LARK-J01"))

    @patch.object(SourceIdentity, "validate_current_source")
    def test_service_source_mismatch_is_rejected(
        self,
        _validate_source: object,
    ) -> None:
        payload = valid_manifest()
        payload["services"]["station"]["liveCommit"] = "b" * 40  # type: ignore[index]
        with self.assertRaisesRegex(GateError, "not running the Suite source"):
            SuiteManifest.load(self.write_manifest(payload))

    def test_manifest_unknown_field_is_rejected(self) -> None:
        payload = valid_manifest()
        payload["unexpected"] = True
        with self.assertRaisesRegex(GateError, "unknown=.*unexpected"):
            SuiteManifest.load(self.write_manifest(payload))


class ScenarioProtocolTest(unittest.TestCase):
    marker = "pt-lark-j04-outcome-test"

    def plan(self) -> dict[str, object]:
        unsigned: dict[str, object] = {
            "artifactKind": SCENARIO_PLAN_KIND,
            "schemaVersion": SCENARIO_PROTOCOL_VERSION,
            "journeyId": "LARK-J04",
            "scenarioId": "LARK-J04-OUTCOME",
            "marker": self.marker,
            "action": {
                "kind": "desktop-click",
                "actor": "desktop-native",
                "targetResource": "",
                "content": "",
                "fileResource": "",
                "selector": "[data-testid=lark-product]",
                "stationPath": "",
                "stationBody": {},
            },
            "receiver": {
                "kind": "desktop-dom",
                "actor": "desktop-native",
                "chatResource": "",
                "marker": self.marker,
                "selector": "[data-testid=lark-product]",
                "timeoutSeconds": 30,
            },
            "station": {
                "bindingResource": "primary_binding",
                "bindingState": "connected",
                "requireTurn": False,
                "requireDelivery": False,
            },
            "planToken": "plan-token",
        }
        return {**unsigned, "planDigest": canonical_digest(unsigned)}

    def observation(self) -> dict[str, object]:
        unsigned: dict[str, object] = {
            "artifactKind": SCENARIO_OBSERVATION_KIND,
            "schemaVersion": SCENARIO_PROTOCOL_VERSION,
            "journeyId": "LARK-J04",
            "scenarioId": "LARK-J04-OUTCOME",
            "planToken": "plan-token",
            "turnId": "",
            "deliveryId": "",
            "executionCount": 0,
            "sideEffectCount": 1,
            "cleanup": {
                "status": "NAMESPACED",
                "ownedResourceCount": 1,
            },
        }
        return {
            **unsigned,
            "observationDigest": canonical_digest(unsigned),
        }

    def test_control_only_plans_product_action_and_observes_counts(self) -> None:
        plan = validate_scenario_plan(
            self.plan(),
            contract=journey_contract("LARK-J04"),
            scenario_id="LARK-J04-OUTCOME",
            marker=self.marker,
        )
        observation = validate_scenario_observation(
            self.observation(),
            contract=journey_contract("LARK-J04"),
            scenario_id="LARK-J04-OUTCOME",
            plan_token="plan-token",
        )
        self.assertEqual(plan["action"]["kind"], "desktop-click")
        self.assertEqual(observation["executionCount"], 0)

    def test_digest_mismatch_is_rejected(self) -> None:
        plan = self.plan()
        plan["planDigest"] = "0" * 64
        with self.assertRaisesRegex(GateError, "digest"):
            validate_scenario_plan(
                plan,
                contract=journey_contract("LARK-J04"),
                scenario_id="LARK-J04-OUTCOME",
                marker=self.marker,
            )

    def test_control_cannot_report_scenario_pass(self) -> None:
        plan = self.plan()
        plan["status"] = "PASS"
        with self.assertRaisesRegex(GateError, "unknown=.*status"):
            validate_scenario_plan(
                plan,
                contract=journey_contract("LARK-J04"),
                scenario_id="LARK-J04-OUTCOME",
                marker=self.marker,
            )

    def test_station_action_requires_deployed_channel_prefix(self) -> None:
        plan = self.plan()
        plan["action"] = {
            "kind": "station-channel-call",
            "actor": "station-operator",
            "targetResource": "",
            "content": "",
            "fileResource": "",
            "selector": "",
            "stationPath": "/channel/binding/list",
            "stationBody": {},
        }
        unsigned = dict(plan)
        unsigned.pop("planDigest")
        plan["planDigest"] = canonical_digest(unsigned)
        with self.assertRaisesRegex(GateError, "outside Channel ownership"):
            validate_scenario_plan(
                plan,
                contract=journey_contract("LARK-J04"),
                scenario_id="LARK-J04-OUTCOME",
                marker=self.marker,
            )


class StationChannelClientTest(unittest.TestCase):
    def test_rejects_unprefixed_channel_route_before_transport(self) -> None:
        client = StationChannelClient(
            endpoint="http://127.0.0.1:1",
            token="source-bound-token",
            expected_commit="a" * 40,
            expected_runtime_identity="station-test",
        )
        with self.assertRaisesRegex(GateError, "outside its owner"):
            client.post_channel("/channel/binding/list", {})
        self.assertEqual(CHANNEL_API_PREFIX, "/sub-channel/channel/")


class CatalogTraceTest(unittest.TestCase):
    def test_every_journey_gate_is_cataloged_and_required(self) -> None:
        gates = json.loads(
            (REPO_ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        registry = json.loads(
            (REPO_ROOT / "tooling/acceptance/registry.yaml").read_text(
                encoding="utf-8"
            )
        )
        rule = next(
            item
            for item in registry["rules"]
            if item["id"] == "lark-channel-production-contract"
        )
        capability = json.loads(
            (
                REPO_ROOT / "tooling/acceptance/capabilities/channel.yaml"
            ).read_text(encoding="utf-8")
        )["capabilities"][0]
        feature = json.loads(
            (
                REPO_ROOT
                / "tooling/acceptance/features/"
                "lark-channel-production-contract.yaml"
            ).read_text(encoding="utf-8")
        )
        expected = set(GATE_TO_JOURNEY)
        self.assertTrue(expected <= set(gates))
        self.assertTrue(expected <= set(rule["require"]))
        self.assertTrue(expected <= set(capability["required_gates"]))
        self.assertTrue(expected <= set(capability["evidence"]["proven_by"]))
        self.assertTrue(expected <= set(feature["required_gates"]))


if __name__ == "__main__":
    unittest.main()
