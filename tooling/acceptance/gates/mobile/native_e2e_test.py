from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import ArtifactRef, GateError
from tooling.acceptance.gates.mobile.native_e2e import (
    REQUIRED_ACCESS_VARIANTS,
    AccessVariantLedger,
    ClientEvidenceBinding,
    MobileNativeGate,
    MobileNativeBlocked,
    ProviderFlow,
    ProviderStep,
    _assert_fail_closed_projection,
    _begin_oauth,
    _fixture_target,
    _mobile_projection_summary,
    _negative_oauth_intent,
)


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


class ProviderFlowContractTests(unittest.TestCase):
    def test_parses_click_only_preauthenticated_native_automation(self) -> None:
        flow = ProviderFlow.from_credential(
            "github",
            json.dumps(
                {
                    "provider": "github",
                    "steps": [
                        {
                            "using": "accessibility id",
                            "selector": "Continue as disposable account",
                            "action": "click",
                        },
                    ],
                }
            ),
        )
        self.assertEqual(flow.provider, "github")
        self.assertEqual(len(flow.steps), 1)

    def test_rejects_untyped_provider_credential(self) -> None:
        with self.assertRaises(MobileNativeBlocked):
            ProviderFlow.from_credential("google", "plain-account-name")

    def test_rejects_callback_locator_for_provider_success(self) -> None:
        with self.assertRaisesRegex(
            MobileNativeBlocked,
            "must not define a callback locator",
        ):
            ProviderFlow.from_credential(
                "github",
                json.dumps(
                    {
                        "provider": "github",
                        "steps": [
                            {
                                "using": "accessibility id",
                                "selector": "Continue",
                                "action": "click",
                            }
                        ],
                        "callback": {
                            "using": "xpath",
                            "selector": "//*[@name='callback']",
                            "attribute": "value",
                        },
                    }
                ),
            )

    def test_rejects_provider_steps_that_send_secret_text(self) -> None:
        with self.assertRaisesRegex(
            MobileNativeBlocked,
            "pre-authenticated click action",
        ):
            ProviderFlow.from_credential(
                "google",
                json.dumps(
                    {
                        "provider": "google",
                        "steps": [
                            {
                                "using": "accessibility id",
                                "selector": "Password",
                                "action": "type",
                                "text": "must-not-cross-appium",
                            }
                        ],
                    }
                ),
            )


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
        class CancelSession(FakeHarnessSession):
            def call_action(
                self,
                action: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Any:
                if action == "oauth.cancel":
                    return {
                        "phase": "cancelled",
                        "session": None,
                    }
                if action == "projection.read":
                    return {
                        "station": {
                            "activeStationPeerId": "station-peer",
                            "entries": [{"stationPeerId": "station-peer"}],
                        },
                        "access": {
                            "decision": {
                                "state": "ACCESS_DECISION_STATE_ACTION_REQUIRED",
                                "attemptId": "access-attempt",
                                "currentGateId": "auth.oauth",
                                "accessGrantId": "",
                            },
                            "session": None,
                            "loading": False,
                            "errorKey": None,
                            "restored": False,
                        },
                        "oauth": {
                            "phase": "cancelled",
                            "session": None,
                        },
                    }
                return super().call_action(action, payload)

        gate = MobileNativeGate("access")
        readback = gate._run_cancel_variant(  # type: ignore[arg-type]
            CancelSession(),
            station_url="https://station.example",
            provider="github",
            client_id="alice-ios",
        )

        self.assertEqual(readback["oauth"]["phase"], "cancelled")
        self.assertIsNone(readback["oauth"]["session"])
        self.assertEqual(gate.lifecycle[-1]["event"], "oauth.cancel")

    def test_provider_success_waits_for_automatic_app_return(self) -> None:
        class AutomaticRedirectSession:
            def __init__(self) -> None:
                self.events: list[tuple[str, Any]] = []

            def switch_to_native(self) -> None:
                self.events.append(("context", "NATIVE_APP"))

            def find_element(self, using: str, selector: str) -> str:
                self.events.append(("find", (using, selector)))
                return "continue"

            def click(self, element_id: str) -> None:
                self.events.append(("click", element_id))

            def switch_to_app_webview(self, timeout: float = 30.0) -> str:
                self.events.append(("automatic-return", timeout))
                return "WEBVIEW_com.peers.touch.mobile"

        session = AutomaticRedirectSession()
        flow = ProviderFlow(
            provider="github",
            steps=(
                ProviderStep(
                    using="accessibility id",
                    selector="Continue",
                    action="click",
                ),
            ),
        )

        MobileNativeGate("access")._complete_provider_flow(  # type: ignore[arg-type]
            session,
            flow,
        )

        self.assertEqual(session.events[-1], ("automatic-return", 90))
        self.assertFalse(
            any(event[0] in {"attribute", "deep-link"} for event in session.events)
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
