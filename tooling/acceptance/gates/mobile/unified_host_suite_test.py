from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import (
    BlockedError, GateError, SuiteRuntimeAction, SuiteRuntimeLedger,
)
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.provisioners.mobile_native_build import embedded_identity_digest
from tooling.acceptance.gates.mobile import unified_host_suite
from tooling.acceptance.gates.mobile.ios_host_e2e import runtime_blockers
from tooling.acceptance.gates.mobile.proof_contracts_test import (
    build_attestation, physical_device_lease, lease_outcome,
)


SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "sha256:" + "b" * 64,
    "canonicalWorktreeHash": "0123456789abcdef",
}


def evidence(platform: str) -> dict:
    contract = unified_host_suite.reuse_contract(platform)
    ledger = SuiteRuntimeLedger(
        contract, suite_runtime_id="host-suite",
        source_digest="b" * 64, fixture_epoch="host-fixture",
    )
    ledger.record(SuiteRuntimeAction.PROVISION, resource_id="host")
    ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id="client")
    for scenario in contract.scenario_ids:
        ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario)
        ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario)
        ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=scenario)
        ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario)
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return {
        "artifactKind": f"unified-client-{platform}-host-runtime-evidence",
        "source": SOURCE,
        "runtimeCells": [f"mobile-{platform}-native"],
        "suiteRuntime": ledger.require_valid(),
        "scenarios": {
            scenario: {
                field: True
                for field in (
                    *unified_host_suite.HOST_ASSERTIONS[scenario],
                    "uiAction", "receiverVisible", "physicalDevice",
                )
            }
            for scenario in contract.scenario_ids
        },
    }


class UnifiedHostSuiteTest(unittest.TestCase):
    def validate(self, value: dict, platform: str) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree = root / "worktree"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            gate_id = f"unified-client-{platform}-host-e2e"
            run = store.begin_run(gate_id, source=SOURCE)
            binary = run.write_bytes(
                f"runtime/mobile/builds/{platform}.{'apk' if platform == 'android' else 'ipa'}",
                b"synthetic-unit-fixture",
                media_type="application/octet-stream",
            )
            identity = {
                "schema": "peers-mobile-build-identity",
                "buildId": "synthetic-build", "platform": platform,
                "configuration": "acceptance-debug",
                "sourceCommit": SOURCE["commit"], "workspaceState": "dirty",
                "workspaceDigest": SOURCE["workspaceDigest"],
                "buildInputsDigest": "sha256:" + "c" * 64,
                "allowlistedEnvironmentDigest": "sha256:" + "d" * 64,
                "applicationId": "com.peers.touch.mobile", "harnessEnabled": True,
            }
            build_payload = build_attestation(platform)
            build_payload.update({
                "artifactKind": "mobile-native-scenario-build-attestation",
                "gateId": gate_id, "runId": run.run_id,
                "buildIdentity": identity,
                "embeddedIdentitySha256": embedded_identity_digest(identity),
            })
            build_payload["artifact"].update({
                "sha256": f"sha256:{binary.sha256}",
                "sizeBytes": len(b"synthetic-unit-fixture"),
                "artifactRef": binary.to_dict(),
            })
            build = run.write_json("runtime/build.json", build_payload)
            client_id = f"alice-{platform}"
            acquisition = physical_device_lease(client_id, gate_id=gate_id)
            acquisition.update({"runId": run.run_id, "holderRunId": run.run_id})
            lease = run.write_json("runtime/lease.json", acquisition)
            outcome = lease_outcome(acquisition, "physical-device", lease.path)
            outcome.update({
                "runId": run.run_id,
                "acquisition": lease.to_dict(),
            })
            cleanup = run.write_json("runtime/cleanup.json", outcome)
            value["deviceCleanup"] = {client_id: cleanup.to_dict()}
            cell = run.write_json("runtime/cell.json", {
                "artifactKind": "acceptance-mobile-runtime-cell-manifest",
                "cellId": f"mobile-{platform}-native",
                "platform": platform, "gateId": gate_id, "runId": run.run_id,
                "source": SOURCE, "state": "LEASED",
                "attachmentMode": "attach-only",
                "lifecycleOwner": "environment-provisioner",
                "cleanupRegistered": True,
                "buildAttestation": build.to_dict(),
                "physicalDeviceLeases": {client_id: lease.to_dict()},
            })
            value["runtimeManifest"] = cell.to_dict()
            for scenario_id, scenario in value["scenarios"].items():
                png = run.write_bytes(
                    f"evidence/{scenario_id}.png", b"\x89PNG\r\n\x1a\nsynthetic",
                    media_type="image/png",
                )
                observation = run.write_json(f"evidence/{scenario_id}.json", {
                    "scenarioId": scenario_id,
                    "source": SOURCE, "binarySha256": binary.sha256,
                    "deviceClientId": client_id,
                    "assertions": {
                        field: True for field in unified_host_suite.HOST_ASSERTIONS[scenario_id]
                    },
                })
                scenario.update({
                    "uiArtifact": png.to_dict(), "receiverArtifact": png.to_dict(),
                    "observationArtifact": observation.to_dict(),
                })
            path = root / "host.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            try:
                return unified_host_suite.validate_runtime_evidence(
                    path, platform=platform, expected_source=SOURCE, store=store,
                )
            finally:
                run.close()

    def test_both_physical_host_contracts_accept_complete_evidence(self) -> None:
        for platform in ("android", "ios"):
            with self.subTest(platform=platform):
                result = self.validate(evidence(platform), platform)
                self.assertEqual(result["runtimeCells"], [f"mobile-{platform}-native"])

    def test_host_evidence_rejects_missing_stale_and_invalid_proof(self) -> None:
        for platform in ("android", "ios"):
            for mutation in ("source", "cell", "scenario", "boolean", "cleanup"):
                with self.subTest(platform=platform, mutation=mutation):
                    value = evidence(platform)
                    first = next(iter(value["scenarios"]))
                    if mutation == "source":
                        value["source"] = {**SOURCE, "commit": "c" * 40}
                    elif mutation == "cell":
                        value["runtimeCells"] = ["mobile-ios-simulator"]
                    elif mutation == "scenario":
                        del value["scenarios"][first]
                    elif mutation == "boolean":
                        value["scenarios"][first]["physicalDevice"] = "true"
                    else:
                        value["suiteRuntime"]["events"].pop()
                    with self.assertRaises(GateError):
                        self.validate(value, platform)

    def test_missing_file_is_environment_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(BlockedError):
                unified_host_suite.validate_runtime_evidence(
                    Path(directory) / "missing.json",
                    platform="ios", expected_source=SOURCE,
                )

    def test_boolean_only_report_cannot_prove_physical_host(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "host.json"
            path.write_text(json.dumps(evidence("android")), encoding="utf-8")
            with self.assertRaisesRegex(GateError, "schema"):
                unified_host_suite.validate_runtime_evidence(
                    path, platform="android", expected_source=SOURCE,
                )

    def test_available_simulator_does_not_make_disconnected_phone_available(self) -> None:
        blockers = runtime_blockers(
            {"PT_IOS_APNS_PROVIDER_CONFIG": "configured", "PT_ACCEPTANCE_RUNTIME_MANIFEST": "configured"},
            devicectl_path="/usr/bin/xcrun",
            device_inventory="iPhone available simulated\nphone unavailable physical",
        )
        self.assertEqual(blockers, ["physical-ios-device-unavailable"])


if __name__ == "__main__":
    unittest.main()
