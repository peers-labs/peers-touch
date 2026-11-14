"""Private Suite validation against original sealed Runner inventories."""
from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tooling.acceptance.core import GateError, SuiteRuntimeAction, SuiteRuntimeLedger
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.gates.social import cross_station_support as module


REPO_ROOT = Path(__file__).resolve().parents[4]
SOURCE_COMMIT = "a" * 40
PRODUCER = "social-cross-station-native-e2e"
CONSUMER = "social-private-desktop-e2e"


class _Report:
    def __init__(self) -> None:
        self.files = []
        self.runtime = {}

    def add_evidence_file(self, key, path):
        self.files.append((key, path))
        return str(path)


class _Gate:
    def __init__(self) -> None:
        self.report = _Report()
        self.assertions = []

    def assert_condition(self, name, condition, detail=None):
        if not condition:
            raise AssertionError(detail or name)
        self.assertions.append(name)


class SourceCommandTest(unittest.TestCase):
    def test_node_test_output_pattern_accepts_supported_reporters(self) -> None:
        self.assertRegex("# Subtest: focused behavior", module.NODE_TEST_OUTPUT_PATTERN)
        self.assertRegex("ℹ tests 18", module.NODE_TEST_OUTPUT_PATTERN)
        self.assertNotRegex("ℹ tests 0", module.NODE_TEST_OUTPUT_PATTERN)

    def test_success_attaches_log_and_records_assertion(self) -> None:
        gate = _Gate()
        command = module.SourceCommand("focused", ("tool", "test"), required_output_pattern=r"^TestFocused$")
        result = module.run_source_commands(
            gate, (command,),
            runner=mock.Mock(return_value=subprocess.CompletedProcess(command.argv, 0, "TestFocused\n", "")),
        )
        self.assertEqual("focused", result[0]["name"])
        self.assertEqual(["focused"], gate.assertions)
        self.assertEqual("focused-log", gate.report.files[0][0])

    def test_zero_focused_tests_fail_closed_after_attaching_log(self) -> None:
        gate = _Gate()
        command = module.SourceCommand("focused", ("tool", "test"), required_output_pattern=r"^TestFocused$")
        with self.assertRaisesRegex(GateError, "required focused test"):
            module.run_source_commands(
                gate, (command,),
                runner=mock.Mock(return_value=subprocess.CompletedProcess(command.argv, 0, "ok\n", "")),
            )
        self.assertEqual("focused-log", gate.report.files[0][0])

    def test_required_output_match_ignores_ansi_color_sequences(self) -> None:
        command = module.SourceCommand("focused", ("tool", "test"), required_output_pattern=r"Tests\s+[1-9][0-9]* passed")
        result = module.run_source_commands(
            _Gate(), (command,), runner=mock.Mock(return_value=subprocess.CompletedProcess(
                command.argv, 0, "\x1b[2m Tests \x1b[22m \x1b[32m33 passed\x1b[39m\n", "",
            )),
        )
        self.assertEqual("focused", result[0]["name"])


class SuiteResultValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = EvidenceStore(Path(self.temporary.name) / "artifacts", worktree=REPO_ROOT)
        self.source = {"commit": SOURCE_COMMIT, "workspaceDigest": "clean",
                       "canonicalWorktreeHash": self.store.workspace_id}
        self.run = self.store.begin_run(PRODUCER, source=self.source)
        self.addCleanup(self.run.close)
        self.enterContext(mock.patch.object(module.EvidenceStore, "from_environment", return_value=self.store))
        self.enterContext(mock.patch.object(module, "source_identity", return_value=self.source))
        # Full schema/reset/journal validation remains covered by the original
        # runtime-manifest tests. Here the transport is synthetic; ArtifactRef
        # digests, physical identity and sealed inventories are real.
        self.schema_loader = self.enterContext(mock.patch(
            "tooling.development.secure_content.runtime_manifest.load_canonical_private_schema_attestation",
            return_value=SimpleNamespace(provenance_files=(("journal.json", b"{}"),)),
        ))
        self.payload, self.result_ref = self.fixture()

    def fixture(self):
        run_id = self.run.run_id
        epoch = "prepared-fixture-epoch"
        ledger = SuiteRuntimeLedger(module.EXPECTED_RUNTIME_REUSE, suite_runtime_id=run_id,
                                    source_digest=SOURCE_COMMIT, fixture_epoch=epoch)
        ledger.record(SuiteRuntimeAction.PROVISION, resource_id="runtime:private")
        for actor in ("alice", "bob"):
            ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=f"client:{actor}")
        scenario_results, supporting = {}, []
        for scenario in module.SCENARIO_IDS:
            if scenario == "AS23":
                ledger.record(SuiteRuntimeAction.CLIENT_REPLACEMENT, resource_id="client:bob2")
            for action in (SuiteRuntimeAction.SCENARIO_START, SuiteRuntimeAction.UI_ACTION,
                           SuiteRuntimeAction.RECEIVER_ASSERTION, SuiteRuntimeAction.SCENARIO_END):
                ledger.record(action, scenario_id=scenario, resource_id=f"scenario:{scenario}")
            ref = self.run.write_json(f"private-social/{scenario}.json", {
                "artifactKind": "social-cross-station-receiver-evidence",
                "scenarioId": scenario, "receiverClientId": "bob",
            }).to_dict()
            path_ref = {"path": str(self.store.resolve(module.ArtifactRef.from_dict(ref))), "sha256": ref["sha256"]}
            supporting.append(path_ref)
            scenario_results[scenario] = {"status": "PASS", "evidenceRefs": [path_ref]}
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        suite_ref = self.run.write_json("private-social/suite-runtime.json", suite_report)
        inventory = {"artifactKind": "private-social-schema-inventory", "runId": epoch,
                     "workspaceId": self.store.workspace_id, "sourceCommit": SOURCE_COMMIT, "services": {}}
        profiles = {"fiveArm": "station-four", "four": "station-five-arm"}
        identities = {}
        for profile, role in profiles.items():
            physical = "station-five-arm" if profile == "fiveArm" else "station-four"
            peer = f"peer-{physical}"
            identities[role] = module.hashlib.sha256(peer.encode()).hexdigest()
            service_ref = self.run.write_json(f"services/{role}.json", {
                "serviceId": role, "serviceKind": "station", "commit": SOURCE_COMMIT,
                "workspaceDigest": "clean", "deploymentEnvironment": physical, "runtimeIdentity": peer,
                "endpoint": f"http://{role}.invalid", "protocolDigest": "b" * 64,
            })
            schema_ref = self.run.write_json(f"schemas/{physical}.json", {"syntheticTransport": physical})
            inventory["services"][role] = {
                "profileId": profile, "physicalServiceId": physical, "deploymentEnvironment": physical,
                "attestationRef": {"path": schema_ref.path, "sha256": schema_ref.sha256},
                "serviceAttestationRef": service_ref.to_dict(),
            }
        schema_inventory = self.run.write_json("runtime/private-social-schema.json", inventory)
        payload = {
            "artifactKind": module.SUITE_ARTIFACT_KIND, "schemaVersion": 1,
            "status": "FUNCTIONAL_PASS", "proofState": "UNPROVEN",
            "controlCommit": SOURCE_COMMIT, "sourceCommit": SOURCE_COMMIT,
            "workspaceId": self.store.workspace_id, "worktreeSetDigest": module.canonical_digest(self.source),
            "runId": run_id, "provisioningRunId": epoch, "fixtureEpoch": epoch, "source": self.source,
            "schemaInventory": schema_inventory.to_dict(),
            "runtimeManifest": {
                "artifactKind": "social-cross-station-suite-runtime-manifest", "schemaVersion": 1,
                "state": "FIXTURE_READY", "cleanupState": "CLEANED", "runId": run_id,
                "provisioningRunId": epoch, "fixtureEpoch": epoch, "workspaceId": self.store.workspace_id,
                "sourceCommit": SOURCE_COMMIT, "controlCommit": SOURCE_COMMIT,
                "worktreeSetDigest": module.canonical_digest(self.source), "profileBindings": profiles,
                "serviceRuntimeIdentityDigests": identities,
                "clientBindings": [
                    {"clientId": client_id, "actorRole": actor, "profileId": next(
                        profile for profile, service in profiles.items() if service == role),
                     "serviceId": role, "launched": client_id != "eve"}
                    for client_id, (actor, role) in module.CLIENT_BINDINGS.items()
                ],
                "scenarioManifestDigests": {"initial": "d" * 64, "replacement": "e" * 64},
                "suiteRuntimeReportDigest": suite_report["reportDigest"],
            },
            "scenarioResults": scenario_results, "suiteRuntimeReport": str(self.store.resolve(suite_ref)),
            "suiteRuntimeReportDigest": suite_report["reportDigest"], "supportingArtifacts": supporting,
            "resourceReuse": {
                "provisioningRuns": 1, "clientLaunches": 3, "maxConcurrentNativeClients": 2,
                "newAccountRegistrations": 0, "stationBuilds": 0, "stationDeployments": 0,
                "desktopBuilds": 0, "clientReplacements": ["bob2"], "fixtureOnlyClients": ["eve"],
            },
            "cleanup": {"status": "CLEANED"},
        }
        payload["resultDigest"] = module.canonical_digest(payload)
        result_ref = self.run.write_json("private-social/result.json", payload, role="suite-result")
        return payload, result_ref

    def validate(self, payload=None):
        return module.validate_suite_result(
            payload or self.payload, result_path=self.store.resolve(self.result_ref),
            artifact_root=self.run.run_dir, repo_root=REPO_ROOT,
            expected_workspace=self.store.workspace_id, expected_source=self.source,
            expected_run_id=self.run.run_id,
        )

    @staticmethod
    def resign(payload):
        payload["resultDigest"] = module.canonical_digest({key: value for key, value in payload.items() if key != "resultDigest"})

    def test_complete_current_run_result_is_accepted(self) -> None:
        result = self.validate()
        self.assertEqual(self.payload["suiteRuntimeReportDigest"], result.suite_runtime_report["reportDigest"])
        self.assertEqual(len(module.SCENARIO_IDS), len(result.supporting_artifacts))
        self.assertEqual({"station-four", "station-five-arm"},
                         {call.kwargs["service_id"] for call in self.schema_loader.call_args_list})

    def test_result_digest_mismatch_is_rejected(self) -> None:
        self.payload["cleanup"] = {"status": "FAILED"}
        with self.assertRaisesRegex(GateError, "digest"):
            self.validate()

    def test_source_run_epoch_and_client_drift_are_rejected(self) -> None:
        for field, value in (("sourceCommit", "f" * 40), ("controlCommit", "f" * 40),
                             ("runId", "foreign"), ("provisioningRunId", "foreign"),
                             ("fixtureEpoch", "foreign"), ("workspaceId", "f" * 16)):
            payload = copy.deepcopy(self.payload)
            payload[field] = value
            self.resign(payload)
            with self.subTest(field=field), self.assertRaises(GateError):
                self.validate(payload)
        payload = copy.deepcopy(self.payload)
        payload["runtimeManifest"]["clientBindings"][0]["serviceId"] = "station-five-arm"
        self.resign(payload)
        with self.assertRaisesRegex(GateError, "client"):
            self.validate(payload)

    def test_unknown_scenario_evidence_and_resource_expansion_are_rejected(self) -> None:
        for mutate, message in (
            (lambda payload: payload["scenarioResults"]["AS17"].update(evidenceRefs=["missing"]), "unavailable"),
            (lambda payload: payload["resourceReuse"].update(maxConcurrentNativeClients=3), "concurrent"),
            (lambda payload: payload["resourceReuse"].update(newAccountRegistrations=3), "newAccountRegistrations"),
            (lambda payload: payload["scenarioResults"].pop("AS23"), "incomplete"),
        ):
            payload = copy.deepcopy(self.payload)
            mutate(payload)
            self.resign(payload)
            with self.subTest(message=message), self.assertRaisesRegex(GateError, message):
                self.validate(payload)

    def test_physical_schema_owner_and_provenance_drift_are_rejected(self) -> None:
        original = self.store.read_json(module.ArtifactRef.from_dict(self.payload["schemaInventory"]))
        for mutate in (
            lambda inventory: inventory["services"]["station-four"].update(physicalServiceId="station-four"),
            lambda inventory: inventory.update(runId="foreign"),
            lambda inventory: inventory.update(sourceCommit="f" * 40),
        ):
            inventory = copy.deepcopy(original)
            mutate(inventory)
            payload = copy.deepcopy(self.payload)
            payload["schemaInventory"] = self.run.write_json(f"mutations/{module.canonical_digest(inventory)}.json", inventory).to_dict()
            self.resign(payload)
            with self.assertRaisesRegex(GateError, "schema"):
                self.validate(payload)
        self.schema_loader.return_value.provenance_files = ()
        with self.assertRaisesRegex(GateError, "provenance"):
            self.validate()

    def seal(self, policy="development"):
        report_ref = self.run.write_json("report.json", {
            "evidence": {"suite-result": self.result_ref.to_dict()},
        }, role="gate-report")
        result = {
            "id": PRODUCER, "status": "passed", "completionStatus": "DONE",
            "proofStatus": "NOT_APPLICABLE" if policy == "development" else "PROVEN",
            "cleanupStatus": "passed", "sourceArtifact": report_ref.to_dict(),
            "secretScan": {"status": "passed", "scannedHighEntropyValues": 0,
                           "scannedCredentialValues": 0, "redactedArtifacts": []},
        }
        if policy == "development":
            result.update(artifactKind="development-functional-result", verificationClass="FUNCTIONAL_CHECK",
                          developmentRunId=self.run.run_id, developmentArtifact=self.result_ref.to_dict())
        self.run.finalize(result=result)
        field = "developmentManifest" if policy == "development" else "runManifest"
        ref = self.run.manifest_ref.to_dict()
        self.run.close()
        self.refs = [{"gateId": PRODUCER, field: ref}]
        self.results = [{**result, field: ref}]
        self.enterContext(mock.patch.dict(os.environ, {
            "PT_ACCEPTANCE_PREREQUISITE_PROOFS": json.dumps(self.refs),
            "PT_ACCEPTANCE_CURRENT_RESULTS": json.dumps({"source": self.source, "results": self.results}),
        }))

    def test_consumer_reuses_original_sealed_artifacts_without_cloning(self) -> None:
        self.seal()
        result = module.load_suite_result(REPO_ROOT, consumer_gate_id=CONSUMER, execution_policy="development")
        self.assertEqual(self.refs[0], result.producer_manifest)
        self.assertEqual(self.result_ref.to_dict(), result.result_ref)
        gate = _Gate()
        module.attach_suite_evidence(gate, result)
        self.assertEqual([], gate.report.files)
        self.assertEqual(self.result_ref.to_dict(), gate.report.runtime["privateSocialProducer"]["originalSuiteResult"])

    def test_formal_consumer_requires_original_formal_manifest(self) -> None:
        self.seal("acceptance")
        result = module.load_suite_result(REPO_ROOT, consumer_gate_id=CONSUMER, execution_policy="acceptance")
        self.assertEqual(self.refs[0], result.producer_manifest)
        self.assertEqual(self.result_ref.to_dict(), result.result_ref)
        with self.assertRaises(GateError):
            module.load_suite_result(REPO_ROOT, consumer_gate_id=CONSUMER, execution_policy="development")

    def test_consumer_rejects_history_missing_failed_cleanup_and_wrong_policy(self) -> None:
        self.seal()
        for policy, refs, results in (
            ("acceptance", self.refs, self.results),
            ("development", [], self.results),
            ("development", self.refs, [{**self.results[0], "cleanupStatus": "failed"}]),
            ("development", self.refs, [{**self.results[0], "developmentRunId": "foreign"}]),
            ("development", self.refs, [self.results[0], self.results[0]]),
        ):
            with mock.patch.dict(os.environ, {
                "PT_ACCEPTANCE_PREREQUISITE_PROOFS": json.dumps(refs),
                "PT_ACCEPTANCE_CURRENT_RESULTS": json.dumps({"source": self.source, "results": results}),
            }), self.subTest(policy=policy, count=len(results)), self.assertRaises(Exception):
                module.load_suite_result(REPO_ROOT, consumer_gate_id=CONSUMER, execution_policy=policy)


if __name__ == "__main__":
    unittest.main()
