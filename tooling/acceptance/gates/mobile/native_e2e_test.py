from __future__ import annotations

import inspect
import json
import tempfile
import unittest
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import ArtifactRef, GateError
from tooling.acceptance.gates.mobile.appium import (
    APPIUM_CAPABILITY_ID,
    AppiumSession,
)
from tooling.acceptance.gates.mobile.native_e2e import (
    CAPABILITY_OPERATIONS,
    LIFECYCLE_CYCLES,
    PLATFORM_PERMISSION_KINDS,
    PRODUCTION_OAUTH_PURGE_ACTION,
    PROVIDER_CAPABILITY,
    REQUIRED_ACCESS_VARIANTS,
    SCENARIO_GATES,
    SCENARIO_METADATA,
    SECURE_STORAGE_ABSENCE_FIELDS,
    STATION_FIXTURE_CAPABILITY,
    AccessVariantLedger,
    ClientEvidenceBinding,
    MobileNativeGate,
    MobileNativeBlocked,
    _assert_fail_closed_projection,
    _begin_oauth,
    _fixture_target,
    _mobile_projection_summary,
    _negative_oauth_intent,
)
from tooling.acceptance.gates.mobile.proof_contracts import ProofContractError


def artifact_ref(path: str) -> dict[str, str]:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "a" * 16,
        "gateId": "mobile-native-access-e2e",
        "runId": "20260830T120000000000Z-" + ("1" * 32),
        "path": path,
        "sha256": "b" * 64,
        "mediaType": "application/json",
    }


def variant_evidence(variant_id: str) -> dict[str, Any]:
    variant = next(
        item for item in REQUIRED_ACCESS_VARIANTS if item.id == variant_id
    )
    snapshots = {
        variant.service_id: artifact_ref(
            f"evidence/mobile/{variant.id}/station/{variant.service_id}.json"
        )
    }
    if variant.alternate_service_id:
        snapshots[variant.alternate_service_id] = artifact_ref(
            "evidence/mobile/"
            f"{variant.id}/station/{variant.alternate_service_id}.json"
        )
    return {
        "buildAttestation": artifact_ref(
            f"runtime/mobile/builds/{variant.platform}.json"
        ),
        "freshInstallTrace": artifact_ref(
            f"evidence/mobile/runtime/{variant.client_id}/install.json"
        ),
        "installedBuildIdentity": artifact_ref(
            "evidence/mobile/runtime/"
            f"{variant.client_id}/build-identity.json"
        ),
        "physicalDeviceLease": artifact_ref(
            f"runtime/mobile/leases/devices/{variant.client_id}.json"
        ),
        "providerAccountLease": artifact_ref(
            f"runtime/mobile/leases/accounts/{variant.provider}.json"
        ),
        "browserSessionLease": artifact_ref(
            f"runtime/mobile/leases/browsers/{variant.client_id}.json"
        ),
        "mobileEvidence": artifact_ref(
            f"evidence/mobile/{variant.id}/{variant.client_id}/projection.json"
        ),
        "stationSnapshots": snapshots,
    }


def valid_cleanup_result() -> dict[str, Any]:
    return {
        "oauthPurge": {
            "stationRevocation": "confirmed",
            "secureStorage": {
                field: True for field in SECURE_STORAGE_ABSENCE_FIELDS
            },
        },
        "webSessionProjectionCleared": True,
        "stationRegistryCleared": True,
    }


def lifecycle_snapshot(phase: str, generation: int) -> dict[str, Any]:
    status = "suspended" if phase == "SUSPENDED" else "ready"
    return {
        "phase": phase,
        "launchState": "station-selection",
        "generation": generation,
        "bootOrder": ["auth", "command"],
        "runtimes": [
            {"id": "auth", "status": status, "errorKey": None},
            {"id": "command", "status": status, "errorKey": None},
        ],
        "errorKey": None,
    }


class AccessVariantLedgerTests(unittest.TestCase):
    def test_ledger_contains_every_ms_ag03_platform_variant(self) -> None:
        self.assertEqual(
            {variant.id for variant in REQUIRED_ACCESS_VARIANTS},
            {
                "success-ios-github",
                "success-ios-google",
                "success-android-github",
                "success-android-google",
                "cancel-ios",
                "cancel-android",
                "following-gate-ios",
                "following-gate-android",
                "expiry-ios",
                "expiry-android",
                "replay-ios",
                "replay-android",
                "provider-mismatch-ios",
                "provider-mismatch-android",
                "station-mismatch-ios",
                "station-mismatch-android",
            },
        )

    def test_every_variant_has_exact_execution_and_owner_bindings(self) -> None:
        self.assertTrue(
            all(
                variant.operation
                and variant.client_id
                and variant.service_id
                and variant.provider
                for variant in REQUIRED_ACCESS_VARIANTS
            )
        )
        self.assertEqual(
            {
                variant.client_id
                for variant in REQUIRED_ACCESS_VARIANTS
                if variant.operation == "success"
            },
            {"alice-ios", "bob-ios", "alice-android", "bob-android"},
        )

    def test_incomplete_execution_cannot_be_proven(self) -> None:
        ledger = AccessVariantLedger()
        for variant in REQUIRED_ACCESS_VARIANTS[:6]:
            ledger.mark_passed(variant.id, variant_evidence(variant.id))

        with self.assertRaises(MobileNativeBlocked) as caught:
            ledger.require_proven()

        missing = caught.exception.evidence_gaps
        self.assertEqual(len(missing), 10)
        self.assertEqual(
            {item["variantId"] for item in missing},
            {
                "following-gate-ios",
                "following-gate-android",
                "expiry-ios",
                "expiry-android",
                "replay-ios",
                "replay-android",
                "provider-mismatch-ios",
                "provider-mismatch-android",
                "station-mismatch-ios",
                "station-mismatch-android",
            },
        )
        self.assertTrue(all(item["reason"] for item in missing))
        self.assertEqual(
            caught.exception.resource,
            "mobile-runtime:oauth-variant-ledger",
        )

    def test_all_sixteen_correlated_variants_can_be_proven(self) -> None:
        ledger = AccessVariantLedger()
        for variant in REQUIRED_ACCESS_VARIANTS:
            ledger.mark_passed(variant.id, variant_evidence(variant.id))

        ledger.require_proven()
        self.assertEqual(
            {item["status"] for item in ledger.as_dict()["requiredVariants"]},
            {"PASSED"},
        )

    def test_variant_evidence_requires_both_station_snapshots_for_mismatch(
        self,
    ) -> None:
        ledger = AccessVariantLedger()
        evidence = variant_evidence("station-mismatch-ios")
        del evidence["stationSnapshots"]["station-secondary"]

        with self.assertRaisesRegex(GateError, "incomplete Station snapshots"):
            ledger.mark_passed("station-mismatch-ios", evidence)

    def test_variant_evidence_rejects_missing_build_install_or_lease_ref(
        self,
    ) -> None:
        for field in (
            "buildAttestation",
            "freshInstallTrace",
            "installedBuildIdentity",
            "physicalDeviceLease",
            "providerAccountLease",
            "browserSessionLease",
        ):
            with self.subTest(field=field):
                ledger = AccessVariantLedger()
                evidence = variant_evidence("success-ios-github")
                del evidence[field]
                with self.assertRaisesRegex(GateError, f"missing {field}"):
                    ledger.mark_passed("success-ios-github", evidence)


class RecordingCapabilityClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], float]] = []
        self.responses: dict[tuple[str, str], Mapping[str, object]] = {}

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        self.calls.append(
            (capability_id, operation, dict(payload), timeout_seconds)
        )
        return self.responses.get((capability_id, operation), {})


def client_binding(client_id: str = "alice-ios") -> ClientEvidenceBinding:
    platform = "ios" if client_id.endswith("-ios") else "android"
    provider = "github" if client_id == "alice-ios" else "google"
    reference = ArtifactRef.from_dict(
        artifact_ref(f"runtime/mobile/builds/{platform}.json")
    )
    return ClientEvidenceBinding(
        client_id=client_id,
        platform=platform,
        provider=provider,
        service_id="station-primary",
        build_attestation_ref=reference,
        build_attestation={"buildIdentity": {"buildId": f"build-{platform}"}},
        physical_device_lease_ref=ArtifactRef.from_dict(
            artifact_ref(
                f"runtime/mobile/leases/devices/{client_id}.json"
            )
        ),
        physical_device_lease={
            "holderRunId": reference.run_id,
            "fenceToken": 11,
            "state": "BASELINE_VERIFIED",
            "expiresAt": "2099-08-30T12:10:00Z",
        },
        provider_account_lease_ref=ArtifactRef.from_dict(
            artifact_ref(
                f"runtime/mobile/leases/accounts/{provider}.json"
            )
        ),
        provider_account_lease={
            "holderRunId": reference.run_id,
            "fenceToken": 12,
            "state": "LEASED",
            "expiresAt": "2099-08-30T12:10:00Z",
        },
        browser_session_lease_ref=ArtifactRef.from_dict(
            artifact_ref(
                f"runtime/mobile/leases/browsers/{client_id}.json"
            )
        ),
        browser_session_lease={
            "holderRunId": reference.run_id,
            "fenceToken": 13,
            "state": "BASELINE_VERIFIED",
            "expiresAt": "2099-08-30T12:10:00Z",
        },
    )


class EphemeralCapabilityBindingTests(unittest.TestCase):
    def test_exact_plan_capability_table_is_preserved(self) -> None:
        self.assertEqual(
            CAPABILITY_OPERATIONS,
            {
                APPIUM_CAPABILITY_ID: (
                    "start",
                    "stop",
                    "wait_ready",
                    "is_alive",
                    "contexts",
                    "switch_context",
                    "harness_inventory",
                    "harness_action",
                    "harness_negative_callback",
                    "refresh_webview",
                    "find_element",
                    "click",
                    "capture_page_source",
                    "capture_screenshot",
                    "verify_build_identity",
                ),
                PROVIDER_CAPABILITY: ("authorize",),
                STATION_FIXTURE_CAPABILITY: (
                    "prepare_following_gate",
                    "expire_awaiting_attempt",
                    "read_proof_snapshot",
                ),
            },
        )

    def test_appium_start_and_identity_use_only_manifest_artifact_refs(
        self,
    ) -> None:
        client = RecordingCapabilityClient()
        binding = client_binding()
        client.responses[(APPIUM_CAPABILITY_ID, "start")] = {
            "sessionRef": "session-alice-ios",
            "applicationId": "com.peers.touch.mobile",
            "freshInstallTrace": artifact_ref(
                "evidence/mobile/runtime/alice-ios/install.json"
            )
        }
        client.responses[(APPIUM_CAPABILITY_ID, "verify_build_identity")] = {
            "installedBuildIdentity": artifact_ref(
                "evidence/mobile/runtime/alice-ios/build-identity.json"
            )
        }
        session = AppiumSession(
            client,  # type: ignore[arg-type]
            client_id=binding.client_id,
            platform=binding.platform,
            physical_device_lease=binding.physical_device_lease_ref,
            build_attestation=binding.build_attestation_ref,
            callback_scheme="peers-touch",
        )

        session.start()
        identity_ref = session.verify_installed_build_identity(
            session.fresh_install_trace
        )

        start = client.calls[0]
        self.assertEqual(start[:2], (APPIUM_CAPABILITY_ID, "start"))
        self.assertEqual(
            set(start[2]),
            {
                "clientId",
                "platform",
                "physicalDeviceLease",
                "buildAttestation",
            },
        )
        self.assertEqual(
            start[2]["physicalDeviceLease"],
            binding.physical_device_lease_ref.to_dict(),
        )
        self.assertEqual(
            start[2]["buildAttestation"],
            binding.build_attestation_ref.to_dict(),
        )
        self.assertEqual(
            identity_ref.path,
            "evidence/mobile/runtime/alice-ios/build-identity.json",
        )

    def test_provider_and_station_calls_use_exact_capabilities(self) -> None:
        client = RecordingCapabilityClient()
        client.responses[(PROVIDER_CAPABILITY, "authorize")] = {
            "authorized": True
        }
        client.responses[
            (STATION_FIXTURE_CAPABILITY, "prepare_following_gate")
        ] = {"completed": True}
        variant = next(
            item
            for item in REQUIRED_ACCESS_VARIANTS
            if item.id == "following-gate-ios"
        )
        gate = MobileNativeGate("access", capability_client=client)

        gate._authorize_provider(variant)
        gate._station_operation(
            "prepare_following_gate",
            variant,
            {
                "serviceId": "station-primary",
                "oauthAttemptRef": "oauth-attempt",
                "accessAttemptRef": "access-attempt",
                "deviceAlias": "alice-ios",
                "lifecycleGeneration": 7,
            },
        )

        self.assertEqual(
            [(call[0], call[1]) for call in client.calls],
            [
                (PROVIDER_CAPABILITY, "authorize"),
                (STATION_FIXTURE_CAPABILITY, "prepare_following_gate"),
            ],
        )

    def test_station_snapshot_accepts_only_same_run_artifact_ref(self) -> None:
        class Store:
            workspace_id = "a" * 16

        client = RecordingCapabilityClient()
        client.responses[
            (STATION_FIXTURE_CAPABILITY, "read_proof_snapshot")
        ] = {
            "artifactRef": artifact_ref(
                "evidence/mobile/success-ios-github/"
                "station/station-primary.json"
            )
        }
        variant = next(
            item
            for item in REQUIRED_ACCESS_VARIANTS
            if item.id == "success-ios-github"
        )
        gate = MobileNativeGate("access", capability_client=client)

        with patch(
            "tooling.acceptance.gates.mobile.native_e2e."
            "_load_contract_artifact",
        ) as validate:
            snapshots = gate._read_station_snapshots(
                Store(),  # type: ignore[arg-type]
                variant,
                {
                    "serviceId": "station-primary",
                    "oauthAttemptRef": "oauth-attempt",
                    "accessAttemptRef": "access-attempt",
                    "deviceAlias": "alice-ios",
                    "lifecycleGeneration": 7,
                },
                expected_run_id=artifact_ref("unused")["runId"],
            )

        self.assertEqual(set(snapshots), {"station-primary"})
        self.assertEqual(
            client.calls[0][:2],
            (STATION_FIXTURE_CAPABILITY, "read_proof_snapshot"),
        )
        validate.assert_called_once()

    def test_child_uses_product_purge_without_resource_cleanup_ownership(
        self,
    ) -> None:
        source = inspect.getsource(
            __import__(
                "tooling.acceptance.gates.mobile.native_e2e",
                fromlist=["native_e2e"],
            )
        )
        self.assertNotIn("CredentialRef", source)
        self.assertNotIn("device_broker", source)
        self.assertNotIn("secure_storage_remove", source)
        self.assertNotIn("session.stop()", source)
        self.assertEqual(PRODUCTION_OAUTH_PURGE_ACTION, "cleanup")
        self.assertIn("session.call_action(PRODUCTION_OAUTH_PURGE_ACTION)", source)
        self.assertIn("EphemeralGateClient.from_environment()", source)
        cutover = inspect.getsource(MobileNativeGate._run_access)
        self.assertNotIn("automation_name=", cutover)
        self.assertNotIn("artifact_reader=", cutover)
        self.assertNotIn("device_broker=", cutover)
        self.assertIn("physical_device_lease=", cutover)
        self.assertIn("build_attestation=", cutover)
        self.assertRegex(
            cutover,
            r"finally:\s+self\._purge_native_oauth\(artifacts, sessions\)"
            r"\s+return \{",
        )


class FinalEvidenceJudgmentTests(unittest.TestCase):
    def test_final_inventory_uses_exact_evidence_run_identity(self) -> None:
        evidence_run_id = "20260830T120000000000Z-" + ("4" * 32)
        provisioning_run_id = "20260830T120000000000Z-" + ("5" * 32)

        class Store:
            workspace_id = "a" * 16

            @staticmethod
            def read_json(_: ArtifactRef) -> dict[str, Any]:
                return {"artifactKind": "mobile-native-result"}

        class Artifacts:
            run_id = evidence_run_id
            store = Store()

        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            role_dir = run_dir / ".artifact-roles"
            role_dir.mkdir()
            (role_dir / "result.json").write_text(
                json.dumps(
                    {
                        "role": "mobile-native-result",
                        "artifact": artifact_ref(
                            "reports/mobile-native-result.json"
                        ),
                    }
                ),
                encoding="utf-8",
            )
            records = [object()]
            with (
                patch(
                    "tooling.acceptance.gates.mobile.native_e2e."
                    "current_run_directory",
                    return_value=run_dir,
                ),
                patch(
                    "tooling.acceptance.gates.mobile.native_e2e."
                    "artifact_records_from_evidence_manifest",
                    return_value=records,
                ) as project,
                patch(
                    "tooling.acceptance.gates.mobile.native_e2e."
                    "validate_artifact_roles",
                ) as validate,
            ):
                MobileNativeGate("access")._validate_final_artifact_roles(
                    Artifacts()  # type: ignore[arg-type]
                )

        projected_manifest = project.call_args.args[0]
        self.assertEqual(projected_manifest["runId"], evidence_run_id)
        self.assertNotEqual(projected_manifest["runId"], provisioning_run_id)
        validate.assert_called_once_with(
            records,
            expected_run_id=evidence_run_id,
            expected_gate_id="mobile-native-access-e2e",
            expected_workspace_id="a" * 16,
        )

    def test_proven_is_assigned_only_after_frozen_role_validation(self) -> None:
        events: list[str] = []

        class Store:
            workspace_id = "a" * 16

        class Artifacts:
            run_id = artifact_ref("unused")["runId"]
            store = Store()

            def __enter__(self) -> "Artifacts":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def complete(self, **values: object) -> None:
                self.completed = values
                events.append("complete")

            def write_json(self, *_args: object, **_kwargs: object) -> None:
                return None

        artifacts = Artifacts()
        gate = MobileNativeGate("access")
        with (
            patch(
                "tooling.acceptance.gates.mobile.native_e2e.ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_run_access",
                side_effect=lambda _: (
                    events.append("run")
                    or {
                        "artifactKind": "mobile-native-gate-result",
                        "gate": gate.gate_id,
                    }
                ),
            ),
            patch.object(
                gate,
                "_write_final_judgment_inputs",
                side_effect=lambda *_: events.append("write"),
            ),
            patch.object(
                gate,
                "_validate_final_artifact_roles",
                side_effect=lambda *_: events.append("validate"),
            ),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 0)
        self.assertEqual(events, ["run", "write", "validate", "complete"])
        self.assertEqual(artifacts.completed["proof_status"], "PROVEN")

    def test_role_validation_failure_keeps_gate_unproven(self) -> None:
        class Store:
            workspace_id = "a" * 16

        class Artifacts:
            run_id = artifact_ref("unused")["runId"]
            store = Store()

            def __enter__(self) -> "Artifacts":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def complete(self, **values: object) -> None:
                self.completed = values

            def write_json(self, *_args: object, **_kwargs: object) -> None:
                return None

        artifacts = Artifacts()
        gate = MobileNativeGate("access")
        with (
            patch(
                "tooling.acceptance.gates.mobile.native_e2e.ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_run_access",
                return_value={
                    "artifactKind": "mobile-native-gate-result",
                    "gate": gate.gate_id,
                },
            ),
            patch.object(gate, "_write_final_judgment_inputs"),
            patch.object(
                gate,
                "_validate_final_artifact_roles",
                side_effect=ProofContractError("missing frozen role"),
            ),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 1)
        self.assertEqual(artifacts.completed["proof_status"], "UNPROVEN")

    def test_scenario_reports_have_independent_traceability(self) -> None:
        lifecycle = MobileNativeGate("lifecycle")._result_base("BLOCKED")
        platform = MobileNativeGate("platform")._result_base("FAIL")

        self.assertEqual(lifecycle["phase"], "W9-C Physical Lifecycle")
        self.assertEqual(lifecycle["bom"], ["W3", "W7-C", "W7-D"])
        self.assertEqual(lifecycle["spec"], ["MS-AG02", "MS-AG05"])
        self.assertEqual(lifecycle["observedScope"], [])
        self.assertIn(
            "secure-storage deletion failure",
            lifecycle["unprovenScope"],
        )
        self.assertEqual(platform["phase"], "W7 Native Platform")
        self.assertEqual(platform["bom"], ["W7-C", "W7-D"])
        self.assertEqual(
            platform["spec"],
            ["MS-AG07", "MS-AG08", "MS-AG11"],
        )
        self.assertNotIn("MS-AG03", platform["spec"])

    def test_every_registered_scenario_can_emit_typed_blocked_evidence(self) -> None:
        self.assertEqual(set(SCENARIO_METADATA), set(SCENARIO_GATES))

        class Store:
            workspace_id = "a" * 16

        class Artifacts:
            run_id = artifact_ref("unused")["runId"]
            store = Store()

            def __enter__(self) -> "Artifacts":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def complete(self, **values: object) -> None:
                self.completed = values

            def write_json(
                self,
                _path: str,
                payload: dict[str, Any],
                **_kwargs: object,
            ) -> None:
                self.report = payload

        for scenario in (
            "recovery",
            "recovery-ui",
            "social-convergence",
            "chat-contacts",
            "moments",
            "settings",
        ):
            with self.subTest(scenario=scenario):
                artifacts = Artifacts()
                with patch(
                    "tooling.acceptance.gates.mobile.native_e2e.ArtifactSession",
                    return_value=artifacts,
                ):
                    exit_code = MobileNativeGate(scenario).execute()

                self.assertEqual(exit_code, 2)
                self.assertEqual(artifacts.report["status"], "BLOCKED")
                self.assertEqual(
                    artifacts.report["blockedResource"],
                    f"mobile-scenario:{scenario}",
                )
                self.assertEqual(artifacts.completed["status"], "BLOCKED")
                self.assertEqual(
                    artifacts.completed["proof_status"],
                    "UNPROVEN",
                )


class PhysicalScenarioBranchTests(unittest.TestCase):
    class Ref:
        def __init__(self, path: str) -> None:
            self.path = path

        def to_dict(self) -> dict[str, str]:
            return {"path": self.path}

    class Session:
        def __init__(self, platform: str) -> None:
            self.platform = platform
            self.generation = 3
            self.calls: list[str] = []
            self.permissions = {
                kind: "not_determined"
                for kind in PLATFORM_PERMISSION_KINDS
            }

        def call_action(
            self,
            action: str,
            payload: Mapping[str, Any] | None = None,
        ) -> Any:
            self.calls.append(action)
            if action == "lifecycle.snapshot":
                return lifecycle_snapshot("ACTIVE", self.generation)
            if action == "lifecycle.suspend":
                return {"snapshot": lifecycle_snapshot(
                    "SUSPENDED",
                    self.generation,
                )}
            if action == "lifecycle.resume":
                self.generation += 1
                return {"snapshot": lifecycle_snapshot(
                    "ACTIVE",
                    self.generation,
                )}
            if action == "lifecycle.restart":
                self.generation += 1
                return {"requested": True, "scope": "webview"}
            if action == "platform.permission.checkAll":
                return [
                    {
                        "kind": kind,
                        "status": self.permissions[kind],
                        "canRequest": self.permissions[kind]
                        == "not_determined",
                    }
                    for kind in PLATFORM_PERMISSION_KINDS
                ]
            if action == "platform.permission.check":
                return {
                    "kind": payload["kind"],
                    "status": self.permissions[payload["kind"]],
                    "canRequest": self.permissions[payload["kind"]]
                    == "not_determined",
                }
            if action == "platform.permission.request":
                self.permissions[payload["kind"]] = "granted"
                return {
                    "kind": payload["kind"],
                    "status": "granted",
                    "wasAlreadyGranted": False,
                }
            if action == "platform.network.read":
                return {
                    "connected": True,
                    "networkType": "wifi",
                    "updatedAtMs": 1,
                }
            raise AssertionError(f"unexpected action: {action}")

        def switch_to_native(self) -> None:
            self.calls.append("native")

        def switch_to_app_webview(self) -> str:
            self.calls.append("webview")
            return "WEBVIEW_app"

        def background_app(self, duration_seconds: float) -> None:
            self.calls.append(f"background:{duration_seconds}")
            self.generation += 1

        def capture_native_accessibility(self) -> "PhysicalScenarioBranchTests.Ref":
            return PhysicalScenarioBranchTests.Ref("native-ax.xml")

        def capture_screenshot(
            self,
            _capture_id: str,
        ) -> "PhysicalScenarioBranchTests.Ref":
            return PhysicalScenarioBranchTests.Ref("screenshot.png")

        def capture_web_dom(
            self,
            _capture_id: str,
        ) -> "PhysicalScenarioBranchTests.Ref":
            return PhysicalScenarioBranchTests.Ref("web-dom.html")

    def test_lifecycle_branch_runs_twenty_os_background_cycles_per_platform(
        self,
    ) -> None:
        gate = MobileNativeGate("lifecycle")
        sessions = {
            "alice-ios": self.Session("ios"),
            "alice-android": self.Session("android"),
        }
        with (
            patch.object(gate, "_load_manifest", return_value={}),
            patch.object(
                gate,
                "_start_device_scenario_sessions",
                return_value=sessions,
            ),
        ):
            result = gate._run_lifecycle(object())  # type: ignore[arg-type]

        self.assertEqual(result["phase"], "W9-C Physical Lifecycle")
        for session in sessions.values():
            self.assertEqual(
                session.calls.count("background:1.0"),
                LIFECYCLE_CYCLES,
            )
            self.assertNotIn("lifecycle.suspend", session.calls)
            self.assertNotIn("lifecycle.resume", session.calls)

    def test_platform_branch_uses_permission_and_network_actions(self) -> None:
        gate = MobileNativeGate("platform")
        sessions = {
            "alice-ios": self.Session("ios"),
            "alice-android": self.Session("android"),
        }
        with (
            patch.object(gate, "_load_manifest", return_value={}),
            patch.object(
                gate,
                "_start_device_scenario_sessions",
                return_value=sessions,
            ),
        ):
            result = gate._run_platform(object())  # type: ignore[arg-type]

        self.assertEqual(result["phase"], "W7 Native Platform")
        for session in sessions.values():
            self.assertIn("platform.permission.checkAll", session.calls)
            self.assertEqual(
                session.calls.count("platform.permission.check"),
                len(PLATFORM_PERMISSION_KINDS) * 2,
            )
            self.assertEqual(
                session.calls.count("platform.permission.request"),
                len(PLATFORM_PERMISSION_KINDS),
            )
            self.assertIn("platform.network.read", session.calls)


class FakeHarnessSession:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        body = dict(payload) if payload is not None else None
        self.calls.append((action, body))
        if action == "station.add":
            return {"verifiedStationPeerId": "station-peer"}
        if action == "access.submit":
            return {
                "decision": {
                    "state": "ACCESS_DECISION_STATE_ACTION_REQUIRED",
                    "attemptId": "access-attempt",
                    "currentGateId": "auth.oauth",
                    "gates": [],
                },
                "session": None,
            }
        if action == "oauth.start":
            return {
                "phase": "awaiting_provider",
                "provider": "github",
                "accessAttemptId": "access-attempt",
                "oauthAttemptRef": "oauth-attempt",
                "gateId": "auth.oauth",
                "lifecycleGeneration": 7,
            }
        raise AssertionError(f"unexpected action: {action}")


class MobileHarnessContractTests(unittest.TestCase):
    def test_physical_manifest_requires_purge_but_not_deep_link_adapter(
        self,
    ) -> None:
        environment_path = (
            Path(__file__).resolve().parents[2]
            / "environments"
            / "mobile-native.yaml"
        )
        environment = json.loads(environment_path.read_text(encoding="utf-8"))
        required_actions = environment["harness"]["required_actions"]

        self.assertIn(PRODUCTION_OAUTH_PURGE_ACTION, required_actions)
        self.assertNotIn("native.deliverDeepLink", required_actions)

    def test_product_purge_persists_four_secure_storage_absence_artifacts(
        self,
    ) -> None:
        class PurgeSession:
            def __init__(self) -> None:
                self.calls: list[tuple[str, Any]] = []

            def switch_to_app_webview(self, timeout: float = 30.0) -> str:
                self.calls.append(("switch_to_app_webview", timeout))
                return "WEBVIEW_com.peers.touch.mobile"

            def call_action(
                self,
                action: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Any:
                self.calls.append((action, payload))
                return valid_cleanup_result()

        class Artifacts:
            run_id = artifact_ref("unused")["runId"]

            def __init__(self) -> None:
                self.writes: list[tuple[str, dict[str, Any], str | None]] = []

            def write_json(
                self,
                path: str,
                value: Mapping[str, Any],
                *,
                role: str | None = None,
            ) -> None:
                self.writes.append((path, dict(value), role))

        sessions = {
            client_id: PurgeSession()
            for client_id in (
                "alice-ios",
                "bob-ios",
                "alice-android",
                "bob-android",
            )
        }
        artifacts = Artifacts()

        MobileNativeGate("access")._purge_native_oauth(  # type: ignore[arg-type]
            artifacts,  # type: ignore[arg-type]
            sessions,  # type: ignore[arg-type]
        )

        self.assertEqual(len(artifacts.writes), 4)
        self.assertEqual(
            {write[2] for write in artifacts.writes},
            {
                f"mobile-secure-storage-absence/{client_id}"
                for client_id in sessions
            },
        )
        for path, payload, _ in artifacts.writes:
            client_id = payload["clientId"]
            self.assertEqual(
                path,
                f"evidence/mobile/cleanup/secure-storage/{client_id}.json",
            )
            self.assertEqual(
                payload["secureStorage"],
                {
                    field: True
                    for field in SECURE_STORAGE_ABSENCE_FIELDS
                },
            )
            self.assertEqual(
                sessions[client_id].calls,
                [
                    ("switch_to_app_webview", 5),
                    (PRODUCTION_OAUTH_PURGE_ACTION, None),
                ],
            )

    def test_product_purge_fails_closed_on_incomplete_absence(self) -> None:
        incomplete = valid_cleanup_result()
        incomplete["oauthPurge"]["secureStorage"][
            "credentialRecordAbsent"
        ] = False

        with self.assertRaisesRegex(GateError, "secure-storage absence"):
            MobileNativeGate("access")._secure_storage_absence_result(
                "alice-ios",
                incomplete,
            )

    def test_runner_sends_exact_station_access_and_oauth_payloads(self) -> None:
        session = FakeHarnessSession()

        started = _begin_oauth(  # type: ignore[arg-type]
            session,
            station_url="https://station.example",
            provider="github",
            client_id="alice-ios",
        )

        self.assertEqual(
            started["station"],
            {"verifiedStationPeerId": "station-peer"},
        )
        self.assertEqual(started["oauth"]["oauthAttemptRef"], "oauth-attempt")
        self.assertEqual(
            session.calls,
            [
                ("station.add", {"url": "https://station.example"}),
                ("access.submit", {"kind": "start"}),
                (
                    "oauth.start",
                    {
                        "provider": "github",
                        "accessAttemptId": "access-attempt",
                        "gateId": "auth.oauth",
                    },
                ),
            ],
        )

    def test_nested_projection_readback_uses_canonical_granted_enum(self) -> None:
        summary = _mobile_projection_summary(
            {
                "station": {
                    "activeStationPeerId": "station-peer",
                    "entries": [{"stationPeerId": "station-peer"}],
                },
                "access": {
                    "decision": {
                        "state": "ACCESS_DECISION_STATE_GRANTED",
                        "attemptId": "access-attempt",
                        "currentGateId": "",
                        "accessGrantId": "grant",
                    },
                    "session": {
                        "stationPeerId": "station-peer",
                        "actorPtid": "ptid:alice",
                    },
                    "loading": False,
                    "errorKey": None,
                    "restored": True,
                },
                "oauth": {
                    "phase": "active_session",
                    "stationPeerId": "station-peer",
                    "accessAttemptId": "access-attempt",
                    "gateId": "auth.oauth",
                    "session": {"actorPtid": "ptid:alice"},
                },
            }
        )

        self.assertEqual(
            summary["access"]["decision"]["state"],
            "ACCESS_DECISION_STATE_GRANTED",
        )
        self.assertNotIn("runtimeIdentity", summary["station"])

    def test_oauth_readback_does_not_require_legacy_web_session(self) -> None:
        gate = MobileNativeGate("access")
        gate._verify_access_readback(
            {
                "station": {
                    "activeStationPeerId": "station-peer",
                    "entries": [{"stationPeerId": "station-peer"}],
                },
                "access": {
                    "decision": {
                        "state": "ACCESS_DECISION_STATE_GRANTED",
                    },
                    "session": None,
                },
                "oauth": {
                    "session": {"actorPtid": "ptid:alice"},
                },
            },
            {"phase": "active_session"},
            {
                "stations": {
                    "station-primary": {
                        "actors": [{"role": "alice", "ptid": "ptid:alice"}],
                    },
                },
            },
            "station-primary",
            "alice",
            {"verifiedStationPeerId": "station-peer"},
        )

    def test_nested_projection_rejects_secret_fields(self) -> None:
        with self.assertRaisesRegex(
            MobileNativeBlocked,
            "secret-bearing field",
        ):
            _mobile_projection_summary(
                {
                    "station": {},
                    "access": {"session": {"accessToken": "secret"}},
                    "oauth": {},
                }
            )

    def test_cancel_variant_requires_cancelled_projection_without_session(
        self,
    ) -> None:
        variant = next(
            item
            for item in REQUIRED_ACCESS_VARIANTS
            if item.id == "cancel-ios"
        )
        gate = MobileNativeGate("access")
        gate._require_terminal_projection(
            variant,
            {"phase": "cancelled", "session": None},
        )

        with self.assertRaisesRegex(GateError, "did not fail closed"):
            gate._require_terminal_projection(
                variant,
                {"phase": "cancelled", "session": {"actorPtid": "ptid:alice"}},
            )


class NegativeVariantContractTests(unittest.TestCase):
    def _binding(self) -> ClientEvidenceBinding:
        reference = ArtifactRef.from_dict(
            artifact_ref("runtime/mobile/builds/ios.json")
        )
        return ClientEvidenceBinding(
            client_id="alice-ios",
            platform="ios",
            provider="github",
            service_id="station-primary",
            build_attestation_ref=reference,
            build_attestation={"buildIdentity": {"buildId": "build-ios"}},
            physical_device_lease_ref=reference,
            physical_device_lease={
                "holderRunId": reference.run_id,
                "fenceToken": 11,
                "state": "BASELINE_VERIFIED",
                "expiresAt": "2099-08-30T12:10:00Z",
            },
            provider_account_lease_ref=reference,
            provider_account_lease={
                "holderRunId": reference.run_id,
                "fenceToken": 12,
                "state": "LEASED",
                "expiresAt": "2099-08-30T12:10:00Z",
            },
            browser_session_lease_ref=reference,
            browser_session_lease={
                "holderRunId": reference.run_id,
                "fenceToken": 13,
                "state": "BASELINE_VERIFIED",
                "expiresAt": "2099-08-30T12:10:00Z",
            },
        )

    def test_fixture_target_requires_exact_internal_correlation(self) -> None:
        target = _fixture_target(
            {
                "accessAttemptId": "access-attempt",
                "oauthAttemptRef": "oauth-attempt",
                "lifecycleGeneration": 7,
            },
            service_id="station-primary",
            client_id="alice-ios",
        )
        self.assertEqual(
            target,
            {
                "serviceId": "station-primary",
                "oauthAttemptRef": "oauth-attempt",
                "accessAttemptRef": "access-attempt",
                "deviceAlias": "alice-ios",
                "lifecycleGeneration": 7,
            },
        )
        with self.assertRaises(MobileNativeBlocked):
            _fixture_target(
                {
                    "accessAttemptId": "access-attempt",
                    "lifecycleGeneration": 7,
                },
                service_id="station-primary",
                client_id="alice-ios",
            )

    def test_negative_intent_binds_all_three_current_lease_fences(self) -> None:
        variant = next(
            item
            for item in REQUIRED_ACCESS_VARIANTS
            if item.id == "provider-mismatch-ios"
        )
        binding = self._binding()
        intent = _negative_oauth_intent(
            variant,
            binding,
            run_id=binding.build_attestation_ref.run_id,
        )
        self.assertEqual(
            intent["fenceTokens"],
            {
                "physicalDevice": 11,
                "providerAccount": 12,
                "browserSession": 13,
            },
        )
        self.assertEqual(
            intent["requiredLeaseRefs"],
            [
                "physical-device-lease/alice-ios",
                "provider-account-lease/github",
                "browser-session-lease/alice-ios",
            ],
        )

    def test_negative_result_requires_typed_failure_and_no_session(self) -> None:
        variant = next(
            item for item in REQUIRED_ACCESS_VARIANTS if item.id == "replay-ios"
        )
        result = _assert_fail_closed_projection(
            variant,
            {
                "operation": "replay",
                "failure": "oauthReplay",
                "projection": {
                    "phase": "failed",
                    "sessionPresent": False,
                },
            },
        )
        self.assertEqual(result["failure"], "oauthReplay")
        with self.assertRaisesRegex(GateError, "not fail-closed"):
            _assert_fail_closed_projection(
                variant,
                {
                    "operation": "replay",
                    "failure": "oauthReplay",
                    "projection": {
                        "phase": "failed",
                        "sessionPresent": True,
                    },
                },
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
