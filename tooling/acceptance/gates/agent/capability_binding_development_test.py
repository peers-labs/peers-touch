from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.capability_binding_development import (
    CapabilityBindingDevelopmentError,
    J02_ACTOR_ACCOUNT,
    OPERATION_SCENARIO_ACTOR_ACCOUNT,
    ROOT,
    authenticate_native_client,
    confirm_native_actor_identity_enrollment,
    evaluate_capability_binding,
    persist_native_actor_identity,
    seed_native_actor_identity,
)


def valid_capture() -> dict[str, object]:
    return {
        "inventory": {
            "assertions": {
                "knowledgeInventoryVisible": True,
                "bindingAndPolicyCasReadback": True,
                "readinessAndCompatibilityVisible": True,
                "preSendRuntimeSnapshotVisible": True,
                "staleRejectedBeforeExecution": True,
                "disconnectedRejectedBeforeExecution": True,
                "retiredRejectedBeforeExecution": True,
            },
            "cleanup": {"status": "clean"},
        },
        "incompatible": {
            "assertions": {
                "typedIncompatibleCapabilityRejected": True,
                "localizedChooseCompatibleModelRecovery": True,
                "stationReadinessReadback": True,
                "zeroRejectedPathSideEffects": True,
                "replayEqual": True,
                "cleanupComplete": True,
            },
            "receiver-dom": {"visible": True},
            "station-readback": {
                "entityKind": "agent-capability-readiness",
            },
            "cleanup": {"status": "clean"},
        },
    }


class CapabilityBindingDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_native_journey(self) -> None:
        assertions = evaluate_capability_binding(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_failure_state_assertion(self) -> None:
        capture = valid_capture()
        capture["inventory"]["assertions"][
            "retiredRejectedBeforeExecution"
        ] = False

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "inventoryBindingAndFailureStates",
        ):
            evaluate_capability_binding(capture)

    def test_rejects_non_native_receiver_evidence(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["incompatible"]["receiver-dom"]["visible"] = False

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "nativeReceiverObserved",
        ):
            evaluate_capability_binding(capture)

    def test_rejects_incomplete_cleanup(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["inventory"]["cleanup"]["status"] = "failed"

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "inventoryCleanup",
        ):
            evaluate_capability_binding(capture)

    def test_runner_uses_canonical_profile_resolution(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "capability_binding_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("machine-dev.mjs", source)
        self.assertIn('"resolve",', source)
        self.assertIn(
            'resolved.get("authority") == "machine-control-plane"',
            source,
        )
        self.assertIn("provisioner._resolve_active_profile = lambda:", source)
        self.assertNotIn(".local/dev/active", source)
        self.assertIn('manifest.state.value == "FIXTURE_READY"', source)
        self.assertIn("authenticate_native_client(client, profile_env)", source)
        self.assertIn("account: str = J02_ACTOR_ACCOUNT", source)
        self.assertIn("persist_native_actor_identity(", source)
        self.assertNotIn("_authenticate_clients(", source)
        self.assertNotIn('"ensureProvider"', source)
        self.assertNotIn("reset_fixture", source)
        self.assertNotIn("CHAT_ACCEPTANCE_RESET", source)
        self.assertNotIn("J01_IDENTITY_SEED", source)
        self.assertNotIn("seed_native_client_state", source)
        self.assertIn('"debugCapabilitySnapshot"', source)
        self.assertIn('"runCapabilityIncompatibleDevelopment"', source)
        self.assertNotIn('"foundationDirectProbe"', source)
        self.assertIn("copy_native_runtime_logs(", source)
        self.assertIn('"--formal-candidate"', source)
        self.assertIn("capability_binding_candidate", source)

    def test_j02_persists_identity_only_after_native_success(
        self,
    ) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "capability_binding_development.py"
        ).read_text(encoding="utf-8")
        journey_call = source.find('"runCapabilityIncompatibleDevelopment"')
        persistence = source.rfind("persist_native_actor_identity(")

        self.assertGreaterEqual(journey_call, 0)
        self.assertGreaterEqual(persistence, 0)
        self.assertLess(journey_call, persistence)
        self.assertIn(
            "station_accepted=True",
            source[persistence:persistence + 500],
        )

    def test_operation_journeys_retain_identity_after_station_enrollment(
        self,
    ) -> None:
        journeys = {
            "governed_tool_development.py":
                '"runGovernedToolDevelopment"',
            "mcp_lifecycle_development.py":
                '"runMcpLifecycleDevelopment"',
            "connector_invocation_development.py":
                '"runConnectorInvocationDevelopment"',
        }

        for filename, journey_marker in journeys.items():
            with self.subTest(filename=filename):
                source = (
                    ROOT / "tooling/acceptance/gates/agent" / filename
                ).read_text(encoding="utf-8")
                journey_call = source.find(journey_marker)
                client_start = source.rfind(
                    ".start()",
                    0,
                    journey_call,
                )
                login = source.find(
                    "authenticate_native_client(",
                    client_start,
                    journey_call,
                )
                enrollment = source.find(
                    "confirm_native_actor_identity_enrollment(",
                    login,
                    journey_call,
                )
                persistence = source.find(
                    "persist_native_actor_identity(",
                    enrollment,
                    journey_call,
                )

                self.assertGreaterEqual(journey_call, 0)
                self.assertGreaterEqual(client_start, 0)
                self.assertGreaterEqual(login, 0)
                self.assertGreaterEqual(enrollment, 0)
                self.assertGreaterEqual(persistence, 0)
                self.assertLess(login, enrollment)
                self.assertLess(enrollment, persistence)
                self.assertLess(persistence, journey_call)
                self.assertIn(
                    "OPERATION_SCENARIO_ACTOR_ACCOUNT",
                    source,
                )
                self.assertIn("OPERATION_SCENARIO_IDENTITY_FIXTURE", source)
                self.assertNotIn("J02_ACTOR_ACCOUNT", source)
                self.assertNotIn("J02_IDENTITY_FIXTURE", source)
                self.assertNotIn("reset_fixture", source)

    def test_native_harness_uses_disposable_no_credential_runtime(self) -> None:
        source = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "createFoundationDisposableRuntimeFixture",
            source,
        )
        self.assertIn(
            "'[data-pt-agent-composer] [data-pt-agent-readiness-snapshot]'",
            source,
        )
        self.assertIn(
            "const providerId = 'ollama'",
            source,
        )
        self.assertIn("catalogProvider.show_api_key !== false", source)
        self.assertIn("function_call: false", source)
        self.assertIn(
            "deleteFoundationDisposableRuntimeFixture",
            source,
        )
        self.assertIn("submittedRevision: createdRevision.toString()", source)
        self.assertNotIn("stale binding composer rejection", source)
        self.assertIn("delete normalized.message", source)
        self.assertIn("fixtureModelDeleted", source)
        self.assertNotIn(
            "sourceProvider.api_key",
            source,
        )
        self.assertNotIn(
            "const fixtureProviderId = 'anthropic'",
            source,
        )

    def test_seeds_only_matching_retained_actor_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture"
            identity = (
                fixture
                / "actor-identity/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            identity.mkdir(parents=True)
            (identity / "actor.key").write_text("ab" * 32, encoding="utf-8")
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://station.example",
                }),
                encoding="utf-8",
            )
            target_identity = root / "target-identity"

            metadata = seed_native_actor_identity(
                fixture_root=fixture,
                target_root=target_identity,
                station_url="https://station.example/",
            )

            self.assertEqual(metadata["actorId"], "ptid:bob")
            self.assertEqual(
                (
                    target_identity
                    / "peers-touch/desktop/data/secure-store/"
                    "identity-keys/actor.key"
                ).read_text(encoding="utf-8"),
                "ab" * 32,
            )

    def test_persists_actor_identity_and_rejects_actor_rebinding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "source/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            source.mkdir(parents=True)
            (source / "actor.key").write_text("cd" * 32, encoding="utf-8")
            fixture = root / "fixture"

            metadata = persist_native_actor_identity(
                source_root=root / "source",
                fixture_root=fixture,
                station_url="https://station.example/",
                actor_id="ptid:bob",
                station_accepted=True,
            )

            self.assertEqual(metadata["account"], J02_ACTOR_ACCOUNT)
            self.assertEqual(
                (
                    fixture
                    / "actor-identity/peers-touch/desktop/data/"
                    "secure-store/identity-keys/actor.key"
                ).read_text(encoding="utf-8"),
                "cd" * 32,
            )
            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "belongs to another actor",
            ):
                persist_native_actor_identity(
                    source_root=root / "source",
                    fixture_root=fixture,
                    station_url="https://station.example",
                    actor_id="ptid:mallory",
                    station_accepted=True,
                )

    def test_refreshes_actor_metadata_after_station_accepts_same_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "source/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            source.mkdir(parents=True)
            (source / "actor.key").write_text("cd" * 32, encoding="utf-8")
            fixture = root / "fixture"
            fixture_identity = (
                fixture
                / "actor-identity/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            fixture_identity.mkdir(parents=True)
            (fixture_identity / "actor.key").write_text(
                "cd" * 32,
                encoding="utf-8",
            )
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:stale",
                    "stationUrl": "https://station.example",
                }),
                encoding="utf-8",
            )

            metadata = persist_native_actor_identity(
                source_root=root / "source",
                fixture_root=fixture,
                station_url="https://station.example",
                actor_id="ptid:current",
                station_accepted=True,
                allow_actor_rebinding=True,
            )

            self.assertEqual(metadata["actorId"], "ptid:current")
            self.assertEqual(
                json.loads(
                    (fixture / "fixture.json").read_text(encoding="utf-8")
                )["actorId"],
                "ptid:current",
            )

    def test_supports_explicit_profile_and_account_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "source/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            source.mkdir(parents=True)
            (source / "actor.key").write_text("12" * 32, encoding="utf-8")
            fixture = root / "fixture"

            metadata = persist_native_actor_identity(
                source_root=root / "source",
                fixture_root=fixture,
                station_url="https://station.example/",
                actor_id="ptid:carol",
                station_accepted=True,
                profile="scenario-profile",
                account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            )
            seeded = seed_native_actor_identity(
                fixture_root=fixture,
                target_root=root / "target",
                station_url="https://station.example",
                profile="scenario-profile",
                account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            )

            self.assertEqual(metadata["profile"], "scenario-profile")
            self.assertEqual(
                metadata["account"],
                OPERATION_SCENARIO_ACTOR_ACCOUNT,
            )
            self.assertEqual(seeded, metadata)

    def test_authenticates_explicit_account_and_confirms_station_enrollment(
        self,
    ) -> None:
        class Client:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def configure_station(self, *, timeout: int) -> None:
                self.calls.append(("configureStation", {"timeout": timeout}))

            def harness(
                self,
                name: str,
                payload: dict[str, object],
                *,
                timeout: int,
            ) -> dict[str, object]:
                self.calls.append((name, {**payload, "timeout": timeout}))
                responses: dict[str, dict[str, object]] = {
                    "loginWithPassword": {
                        "authenticated": True,
                        "actorId": "ptid:carol",
                    },
                    "navigateToAgent": {"navigated": True},
                    "getAcceptanceHarnessStatus": {"ready": True},
                    "getFoundationCapabilitySessions": {
                        "selectedStationSession": {
                            "ptid": "ptid:carol",
                            "session_id": "capability-session-carol",
                        },
                    },
                }
                return responses[name]

        client = Client()
        login = authenticate_native_client(
            client,
            {
                "PT_DEV_PROFILE": "scenario-profile",
                "CHAT_NATIVE_DEMO_PASSWORD": "fixture-password",
            },
            profile="scenario-profile",
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )
        enrollment = confirm_native_actor_identity_enrollment(
            client,
            actor_id=str(login["actorId"]),
        )

        login_call = next(
            payload
            for name, payload in client.calls
            if name == "loginWithPassword"
        )
        self.assertEqual(
            login_call["account"],
            OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )
        self.assertTrue(enrollment["accepted"])
        self.assertEqual(
            enrollment["capabilitySessionId"],
            "capability-session-carol",
        )

    def test_rejects_identity_persistence_without_station_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "source/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            source.mkdir(parents=True)
            (source / "actor.key").write_text("ef" * 32, encoding="utf-8")
            fixture = root / "fixture"

            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "Station acceptance proof is required",
            ):
                persist_native_actor_identity(
                    source_root=root / "source",
                    fixture_root=fixture,
                    station_url="https://station.example",
                    actor_id="ptid:bob",
                    station_accepted=False,
                )

            self.assertFalse(fixture.exists())

    def test_rejects_mismatched_or_malformed_identity_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture"
            identity = fixture / "actor-identity/identity-keys"
            identity.mkdir(parents=True)
            (identity / "actor.key").write_text("not-a-key", encoding="utf-8")
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://other-station.example",
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                f"does not match two/{J02_ACTOR_ACCOUNT}",
            ):
                seed_native_actor_identity(
                    fixture_root=fixture,
                    target_root=root / "target",
                    station_url="https://station.example",
                )
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://station.example",
                }),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "fixture key is invalid",
            ):
                seed_native_actor_identity(
                    fixture_root=fixture,
                    target_root=root / "target",
                    station_url="https://station.example",
                )


if __name__ == "__main__":
    unittest.main()
