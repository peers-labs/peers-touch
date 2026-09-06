from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent import foundation_scenario_runner
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter_test import (
    capture,
)
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    GroupOneProbeError,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    evaluate_as_f04,
    evaluate_as_f06,
    evaluate_as_f12,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios_test import (
    valid_as_f04_capture,
    valid_as_f06_capture,
    valid_as_f12_capture,
)


class DirectProbeHarnessClient:
    def __init__(self, *, mismatch: bool = False) -> None:
        self.mismatch = mismatch
        self.locales: list[str] = []

    def harness(
        self,
        method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        request = payload or {}
        if method == "setFoundationLocale":
            locale = str(request["locale"])
            self.locales.append(locale)
            return {"locale": locale}
        probe = DirectRuntimeProbeInput(
            platform=str(request["platform"]),
            locale=str(request["locale"]),
            cell=str(request["cell"]),
            sample_id=str(request["sampleId"]),
        )
        result = capture(probe)
        facts = valid_as_f04_capture(probe.platform)
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f04(
            facts,
            platform=probe.platform,
        )
        if self.mismatch:
            result["assertions"]["denialExecutedZero"] = False
        return result


class TimeoutCaptureHarnessClient:
    def __init__(self) -> None:
        self.timeout = 0.0
        self.locale = ""

    def harness(
        self,
        method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        if method == "setFoundationLocale":
            self.locale = str((payload or {})["locale"])
            return {"locale": self.locale}
        self.timeout = timeout
        raise RuntimeError("captured timeout")


class F06HarnessClient:
    def __init__(
        self,
        platform: str,
        *,
        cleanup_log: list[str] | None = None,
        event_log: list[str] | None = None,
        fail_prepare_at: int | None = None,
        fail_finalize: bool = False,
        lose_prepare_response: bool = False,
        invalid_reload_delivery: bool = False,
        invalid_restoration: bool = False,
    ) -> None:
        self.platform = platform
        self.station_url = "http://127.0.0.1:28080"
        self.cleanup_log = cleanup_log
        self.event_log = event_log
        self.fail_prepare_at = fail_prepare_at
        self.fail_finalize = fail_finalize
        self.lose_prepare_response = lose_prepare_response
        self.invalid_reload_delivery = invalid_reload_delivery
        self.invalid_restoration = invalid_restoration
        self.restart_count = 0
        self.transport_cut_count = 0
        self.transport_restore_count = 0
        self.prepare_calls: list[dict[str, object]] = []
        self.finalize_calls: list[dict[str, object]] = []
        self.failure_calls: list[dict[str, object]] = []
        self.restoration_calls: list[dict[str, object]] = []
        self.reload_calls: list[dict[str, object]] = []
        self.complete_calls: list[dict[str, object]] = []
        self.cleanup_calls: list[dict[str, object]] = []
        self.handoffs: dict[str, dict[str, object]] = {}

    def restart(self) -> None:
        self.restart_count += 1
        if self.event_log is not None:
            self.event_log.append(f"{self.platform}:client-restart")

    def prepare_foundation_f06(
        self,
        payload: dict[str, object],
        *,
        timeout: float,
    ) -> dict[str, object]:
        handoff = self.harness(
            "foundationF06Prepare",
            payload,
            timeout=timeout,
        )
        self.cut_station_transport()
        if self.lose_prepare_response:
            raise RuntimeError("prepare response lost")
        return handoff

    def cut_station_transport(self) -> None:
        self.transport_cut_count += 1
        if self.event_log is not None:
            self.event_log.append(f"{self.platform}:transport-cut")

    def restore_station_transport(self) -> None:
        self.transport_restore_count += 1
        if self.event_log is not None:
            self.event_log.append(f"{self.platform}:transport-restore")

    def harness(
        self,
        method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        request = payload or {}
        if method == "setFoundationLocale":
            return {"locale": request["locale"]}
        if method == "foundationF06Prepare":
            self.prepare_calls.append(request)
            if self.fail_prepare_at == len(self.prepare_calls):
                raise RuntimeError("prepare failed")
            suffix = f"{self.platform}-{len(self.prepare_calls)}"
            handoff = {
                "scenarioKey": str(request["scenarioKey"]),
                "conversationId": f"conversation-{suffix}",
                "turnId": f"turn-{suffix}",
                "toolIsolation": {
                    "disabledBindingCount": 1,
                    "readyCapabilityCount": 0,
                    "originalReadyCapabilityCount": 1,
                    "originalReadyCapabilityHash": "a" * 64,
                    "restoredBindingCount": 0,
                    "restoredReadyCapabilityCount": 0,
                    "restoredReadyCapabilityHash": "",
                    "restorationVerified": False,
                },
            }
            self.handoffs[str(request["scenarioKey"])] = handoff
            return handoff
        if method == "foundationF06FinalizePreparation":
            self.finalize_calls.append(request)
            if self.fail_finalize:
                raise RuntimeError("finalize failed")
            if self.event_log is not None:
                self.event_log.append(f"{self.platform}:boundary-finalized")
            return self.handoffs[str(request["scenarioKey"])]
        if method == "foundationF06ObserveFailure":
            self.failure_calls.append(request)
            if self.event_log is not None:
                self.event_log.append(f"{self.platform}:observe-failure")
            return {
                "activeFailureObserved": True,
                "blocker": "",
                "retry": {"observed": True},
            }
        if method == "foundationF06RestoreCapabilityIsolation":
            self.restoration_calls.append(request)
            scenario_key = str(request["scenarioKey"])
            handoff = self.handoffs[scenario_key]
            isolation = handoff["toolIsolation"]
            if not isinstance(isolation, dict):
                raise AssertionError("invalid fake tool isolation")
            isolation.update({
                "restoredBindingCount": 0 if self.invalid_restoration else 1,
                "restoredReadyCapabilityCount": 1,
                "restoredReadyCapabilityHash": "a" * 64,
                "restorationVerified": not self.invalid_restoration,
            })
            if self.event_log is not None:
                self.event_log.append(
                    f"{self.platform}:capability-restored"
                )
            return handoff
        if method == "foundationF06DurableReload":
            self.reload_calls.append(request)
            if self.event_log is not None:
                self.event_log.append(f"{self.platform}:durable-reload")
            if self.invalid_reload_delivery:
                return {"durableReload": {"observed": True}}
            return {
                "durableReload": {
                    "observed": True,
                    "source": "station-snapshot-reconcile",
                    "sourceDelivery": {
                        "transport": "station-sse",
                        "eventType": "snapshot",
                        "sequence": 7,
                        "rawPayloadHash": "a" * 64,
                    },
                }
            }
        if method == "foundationF06Cleanup":
            self.cleanup_calls.append(request)
            if self.cleanup_log is not None:
                self.cleanup_log.append(str(request["scenarioKey"]))
            return {"cleanupComplete": True}
        if method != "foundationDirectProbe":
            raise AssertionError(f"unexpected method: {method}")
        self.complete_calls.append(request)
        if self.event_log is not None:
            self.event_log.append(f"{self.platform}:complete")
        probe = DirectRuntimeProbeInput(
            platform=str(request["platform"]),
            locale=str(request["locale"]),
            cell=str(request["cell"]),
            sample_id=str(request["sampleId"]),
        )
        result = capture(probe)
        facts = valid_as_f06_capture(
            probe.platform,
            probe.locale,
            probe.sample_id,
        )
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f06(
            facts,
            platform=probe.platform,
            locale=probe.locale,
            sample_id=probe.sample_id,
        )
        return result


class F12HarnessClient:
    def __init__(
        self,
        platform: str,
        *,
        call_log: list[str],
        fail_direct: bool = False,
        fail_prepare: bool = False,
    ) -> None:
        self.platform = platform
        self.call_log = call_log
        self.fail_direct = fail_direct
        self.fail_prepare = fail_prepare
        self.restart_count = 0
        self.prepare_calls: list[dict[str, object]] = []
        self.direct_calls: list[dict[str, object]] = []
        self.cleanup_calls: list[dict[str, object]] = []

    def restart(self) -> None:
        self.restart_count += 1
        self.call_log.append(f"{self.platform}:restart")

    def harness(
        self,
        method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        request = payload or {}
        self.call_log.append(f"{self.platform}:{method}")
        if method == "setFoundationLocale":
            return {"locale": request["locale"]}
        if method == "foundationF12Prepare":
            self.prepare_calls.append(request)
            if self.fail_prepare:
                raise RuntimeError("prepare failed")
            scenario_key = str(request["scenarioKey"])
            suffix = scenario_key.replace("|", "-")
            conversation_ids = [
                f"conversation-alpha-{suffix}",
                f"conversation-beta-{suffix}",
            ]
            return {
                "scenarioKey": scenario_key,
                "conversationIds": conversation_ids,
                "primaryConversationId": conversation_ids[0],
                "primaryTurnId": f"turn-alpha-{suffix}",
            }
        if method == "foundationF12Cleanup":
            self.cleanup_calls.append(request)
            return {
                "cleanupComplete": True,
                "handoffCleared": True,
            }
        if method != "foundationDirectProbe":
            raise AssertionError(f"unexpected method: {method}")
        self.direct_calls.append(request)
        if self.fail_direct:
            raise RuntimeError("direct probe failed")
        probe = DirectRuntimeProbeInput(
            platform=str(request["platform"]),
            locale=str(request["locale"]),
            cell=str(request["cell"]),
            sample_id=str(request["sampleId"]),
        )
        result = capture(probe)
        facts = valid_as_f12_capture(
            probe.platform,
            probe.locale,
            probe.sample_id,
        )
        facts["restart"]["station"] = request["stationRestart"]
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f12(
            facts,
            platform=probe.platform,
            locale=probe.locale,
            sample_id=probe.sample_id,
        )
        return result


class SessionHarnessClient:
    def __init__(self, runtime: str, *, authenticated: bool = True) -> None:
        self.spec = SimpleNamespace(runtime=runtime)
        self.station_url = "http://127.0.0.1:28080"
        self.authenticated = authenticated
        self.restart_count = 0
        self.calls: list[str] = []
        self.payloads: dict[str, dict[str, object]] = {}

    def configure_station(self, *, timeout: float = 60) -> None:
        self.harness(
            "configureStation",
            {"stationUrl": self.station_url},
            timeout=timeout,
        )

    def restart(self) -> None:
        self.restart_count += 1

    def harness(
        self,
        method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        self.calls.append(method)
        self.payloads[method] = payload or {}
        if method == "getAcceptanceHarnessStatus":
            return {"ready": True}
        if method == "configureStation":
            return {
                "configured": True,
                "activeUrl": self.payloads[method]["stationUrl"],
                "online": True,
                "peerIdAvailable": True,
            }
        if method == "getRuntimeSnapshot":
            return {
                "authenticated": self.authenticated,
                "actorId": "ptid:test" if self.authenticated else None,
                "identityState": "ready" if self.authenticated else "onboarding",
                "identityPhase": (
                    "authenticated" if self.authenticated else "accountGate"
                ),
                "identityReason": None if self.authenticated else "session_missing",
            }
        if method == "navigateToAgent":
            return {"navigated": True}
        if method == "ensureProvider":
            return {"configured": True}
        if method == "openBrowserCapabilitySession":
            return {"opened": True}
        if method == "getFoundationCapabilitySessions":
            return {"selectedStationSession": {"session_id": "capability-session"}}
        if method == "loginWithPassword":
            return {"authenticated": True}
        raise AssertionError(f"unexpected method: {method}")


class CapabilityIsolationCleanupClient:
    def __init__(
        self,
        runtime: str,
        *,
        fail_first: bool = False,
        always_fail: bool = False,
        malformed: bool = False,
        verified: bool = True,
        fixture_verified: bool = True,
        connected: bool = True,
        storage_root: Path | None = None,
    ) -> None:
        self.spec = SimpleNamespace(
            runtime=runtime,
            storage_root=storage_root or Path("/missing"),
        )
        self.driver = object() if connected else None
        self.fail_first = fail_first
        self.always_fail = always_fail
        self.malformed = malformed
        self.verified = verified
        self.fixture_verified = fixture_verified
        self.calls = 0
        self.restart_count = 0

    def restart(self) -> None:
        self.restart_count += 1
        self.driver = object()

    def harness(
        self,
        method: str,
        _payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        if method != "restoreFoundationCapabilityIsolation":
            raise AssertionError(f"unexpected method: {method}")
        self.calls += 1
        if self.always_fail or (self.fail_first and self.calls == 1):
            raise RuntimeError("renderer unavailable for ptid:private")
        if self.malformed:
            return {}
        return {
            "restorationRequired": True,
            "fixtureRestorationRequired": False,
            "fixtureRestorationVerified": self.fixture_verified,
            "restoration": {
                "disabledBindingCount": 1,
                "readyCapabilityCount": 0,
                "originalReadyCapabilityCount": 1,
                "originalReadyCapabilityHash": "a" * 64,
                "restoredBindingCount": 1,
                "restoredReadyCapabilityCount": 1,
                "restoredReadyCapabilityHash": "a" * 64,
                "restorationVerified": self.verified,
            },
        }


class FoundationScenarioRunnerProfileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temporary_directory.name) / "two"
        self.active_profile = (
            self.repo_root / ".local" / "dev" / "active" / "two.env"
        )
        self.active_profile.parent.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def load_profile(self, resolved_name: str) -> dict[str, str]:
        manifest = {"profile": {"resolvedName": resolved_name}}
        with patch.object(
            foundation_scenario_runner,
            "REPO_ROOT",
            self.repo_root,
        ):
            return foundation_scenario_runner._load_profile_env(manifest)

    def test_loads_the_provisioned_active_profile(self) -> None:
        self.active_profile.write_text(
            "PT_DEV_PROFILE=two\nPT_AGENT_DEFAULT_MODEL_ID=model\n",
            encoding="utf-8",
        )

        profile = self.load_profile("two")

        self.assertEqual(profile["PT_DEV_PROFILE"], "two")
        self.assertEqual(profile["PT_AGENT_DEFAULT_MODEL_ID"], "model")

    def test_rejects_a_missing_active_profile(self) -> None:
        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "active profile cannot be resolved",
        ):
            self.load_profile("two")

    def test_rejects_a_different_active_profile_identity(self) -> None:
        self.active_profile.write_text(
            "PT_DEV_PROFILE=one\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "active profile identity does not match",
        ):
            self.load_profile("two")

    def test_builds_client_manifest_from_typed_station_service(self) -> None:
        clients = [{"runtime": "native-tauri"}, {"runtime": "browser"}]

        result = foundation_scenario_runner._build_client_manifest(
            {
                "services": {
                    "station": {
                        "kind": "station",
                        "endpoint": "https://station.example",
                    }
                },
                "clients": clients,
            }
        )

        self.assertEqual(
            result,
            {
                "station": {"url": "https://station.example"},
                "clients": clients,
            },
        )

    def test_rejects_legacy_top_level_station_manifest(self) -> None:
        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "services.station.endpoint",
        ):
            foundation_scenario_runner._build_client_manifest(
                {
                    "station": {"url": "https://station.example"},
                    "clients": [],
                }
            )

    def test_maps_the_exact_profile_provider_fixture(self) -> None:
        config = foundation_scenario_runner._agent_provider_config(
            {
                "PT_AGENT_PROVIDER_ID": "ark",
                "PT_AGENT_PROVIDER_API_KEY": "credential",
                "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
            }
        )

        self.assertEqual(
            config,
            {
                "providerId": "ark",
                "apiKey": "credential",
                "modelId": "endpoint-model",
                "baseUrl": "https://provider.example/v1",
            },
        )

    def test_rejects_an_incomplete_profile_provider_fixture(self) -> None:
        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "PT_AGENT_PROVIDER_BASE_URL",
        ):
            foundation_scenario_runner._agent_provider_config(
                {
                    "PT_AGENT_PROVIDER_ID": "ark",
                    "PT_AGENT_PROVIDER_API_KEY": "credential",
                    "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                }
            )

    def test_cleanup_restores_capability_isolation_on_both_clients(self) -> None:
        native = CapabilityIsolationCleanupClient("desktop_app")
        browser = CapabilityIsolationCleanupClient("browser")

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(errors, [])
        self.assertEqual(browser.calls, 1)
        self.assertEqual(native.calls, 1)

    def test_f06_restoration_accepts_an_empty_original_capability_set(
        self,
    ) -> None:
        error = foundation_scenario_runner._capability_isolation_restoration_error(
            "browser",
            {
                "disabledBindingCount": 0,
                "readyCapabilityCount": 0,
                "originalReadyCapabilityCount": 0,
                "originalReadyCapabilityHash": "a" * 64,
                "restoredBindingCount": 0,
                "restoredReadyCapabilityCount": 0,
                "restoredReadyCapabilityHash": "a" * 64,
                "restorationVerified": True,
            },
            allow_empty=True,
        )

        self.assertIsNone(error)

    def test_cleanup_restarts_client_before_retrying_isolation_restore(self) -> None:
        native = CapabilityIsolationCleanupClient(
            "desktop_app",
            fail_first=True,
        )
        browser = CapabilityIsolationCleanupClient("browser")
        authenticated: list[str] = []

        with patch.object(
            foundation_scenario_runner,
            "_authenticate_clients",
            side_effect=lambda _pair, _env, *, clients, **_kwargs: (
                authenticated.append(clients[0].spec.runtime)
            ),
        ):
            errors = (
                foundation_scenario_runner._restore_capability_isolation_for_cleanup(
                    SimpleNamespace(native=native, browser=browser),
                    {},
                )
            )

        self.assertEqual(errors, [])
        self.assertEqual(native.restart_count, 1)
        self.assertEqual(native.calls, 2)
        self.assertEqual(authenticated, ["desktop_app"])

    def test_cleanup_restarts_disconnected_client_with_retained_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage_root = Path(directory) / "storage"
            storage_root.mkdir()
            native = CapabilityIsolationCleanupClient(
                "desktop_app",
                connected=False,
                storage_root=storage_root,
            )
            browser = CapabilityIsolationCleanupClient("browser")
            authenticated: list[str] = []

            with patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
                side_effect=lambda _pair, _env, *, clients, **_kwargs: (
                    authenticated.append(clients[0].spec.runtime)
                ),
            ):
                errors = (
                    foundation_scenario_runner._restore_capability_isolation_for_cleanup(
                        SimpleNamespace(native=native, browser=browser),
                        {},
                    )
                )

        self.assertEqual(errors, [])
        self.assertEqual(native.restart_count, 1)
        self.assertEqual(native.calls, 1)
        self.assertEqual(authenticated, ["desktop_app"])

    def test_cleanup_rejects_unverified_isolation_restoration(self) -> None:
        native = CapabilityIsolationCleanupClient(
            "desktop_app",
            verified=False,
        )
        browser = CapabilityIsolationCleanupClient("browser")

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("was not verified", errors[0])

    def test_cleanup_rejects_malformed_isolation_response(self) -> None:
        native = CapabilityIsolationCleanupClient(
            "desktop_app",
            malformed=True,
        )
        browser = CapabilityIsolationCleanupClient("browser")

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("omitted restorationRequired", errors[0])

    def test_cleanup_rejects_unverified_fixture_restoration(self) -> None:
        native = CapabilityIsolationCleanupClient(
            "desktop_app",
            fixture_verified=False,
        )
        browser = CapabilityIsolationCleanupClient("browser")

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("fixture restoration was not verified", errors[0])

    def test_cleanup_rejects_contradictory_noop_restoration(self) -> None:
        native = CapabilityIsolationCleanupClient("desktop_app")
        browser = CapabilityIsolationCleanupClient("browser")
        native.harness = lambda *_args, **_kwargs: {
            "restorationRequired": False,
            "restoration": {"restorationVerified": True},
            "fixtureRestorationRequired": False,
            "fixtureRestorationVerified": True,
        }

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("contradictory evidence", errors[0])

    def test_cleanup_rejects_non_hex_restoration_hash(self) -> None:
        native = CapabilityIsolationCleanupClient("desktop_app")
        browser = CapabilityIsolationCleanupClient("browser")
        native.harness = lambda *_args, **_kwargs: {
            "restorationRequired": True,
            "fixtureRestorationRequired": False,
            "fixtureRestorationVerified": True,
            "restoration": {
                "disabledBindingCount": 1,
                "readyCapabilityCount": 0,
                "originalReadyCapabilityCount": 1,
                "originalReadyCapabilityHash": "z" * 64,
                "restoredBindingCount": 1,
                "restoredReadyCapabilityCount": 1,
                "restoredReadyCapabilityHash": "z" * 64,
                "restorationVerified": True,
            },
        }

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("was not verified", errors[0])

    def test_cleanup_accepts_restored_zero_ready_isolation(self) -> None:
        native = CapabilityIsolationCleanupClient("desktop_app")
        browser = CapabilityIsolationCleanupClient("browser")
        native.harness = lambda *_args, **_kwargs: {
            "restorationRequired": True,
            "fixtureRestorationRequired": True,
            "fixtureRestorationVerified": True,
            "restoration": {
                "disabledBindingCount": 1,
                "readyCapabilityCount": 0,
                "originalReadyCapabilityCount": 0,
                "originalReadyCapabilityHash": "a" * 64,
                "restoredBindingCount": 1,
                "restoredReadyCapabilityCount": 0,
                "restoredReadyCapabilityHash": "a" * 64,
                "restorationVerified": True,
            },
        }

        errors = foundation_scenario_runner._restore_capability_isolation_for_cleanup(
            SimpleNamespace(native=native, browser=browser),
            {},
        )

        self.assertEqual(errors, [])

    def test_cleanup_failure_does_not_leak_raw_identity(self) -> None:
        native = CapabilityIsolationCleanupClient(
            "desktop_app",
            always_fail=True,
        )
        browser = CapabilityIsolationCleanupClient("browser")

        with patch.object(
            foundation_scenario_runner,
            "_authenticate_clients",
        ):
            errors = (
                foundation_scenario_runner._restore_capability_isolation_for_cleanup(
                    SimpleNamespace(native=native, browser=browser),
                    {},
                )
            )

        self.assertEqual(len(errors), 1)
        self.assertIn("RuntimeError", errors[0])
        self.assertNotIn("ptid:private", errors[0])

    def test_run_scenario_withholds_produced_candidate_on_restore_failure(
        self,
    ) -> None:
        runtime_pair = Mock()
        runtime_pair.native = Mock()
        runtime_pair.browser = Mock()
        runtime_pair.stop.return_value = {"status": "clean"}
        run = Mock()
        store = Mock()
        store.begin_run.return_value = run
        producer = Mock()
        producer.produce.return_value = Path("/candidate/manifest.json")

        with (
            patch.object(
                foundation_scenario_runner,
                "_load_runtime_manifest",
                return_value={},
            ),
            patch.object(
                foundation_scenario_runner,
                "_load_profile_env",
                return_value={},
            ),
            patch.object(
                foundation_scenario_runner,
                "_build_client_manifest",
                return_value={},
            ),
            patch.object(
                foundation_scenario_runner,
                "_extract_station_profile",
                return_value={},
            ),
            patch.object(
                foundation_scenario_runner,
                "_extract_machine_id",
                return_value="machine",
            ),
            patch.object(
                foundation_scenario_runner.EvidenceStore,
                "from_environment",
                return_value=store,
            ),
            patch.object(
                foundation_scenario_runner,
                "source_identity",
                return_value=Mock(),
            ),
            patch.object(
                foundation_scenario_runner.FoundationRuntimePair,
                "from_manifest",
                return_value=runtime_pair,
            ),
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ),
            patch.object(
                foundation_scenario_runner,
                "_restore_capability_isolation_for_cleanup",
                return_value=["browser capability identity changed"],
            ),
            patch.object(
                foundation_scenario_runner,
                "FoundationCandidateProducer",
                return_value=producer,
            ),
        ):
            with self.assertRaisesRegex(
                foundation_scenario_runner.ScenarioRunnerError,
                "CLEANUP_FAILED: capability isolation restoration failed",
            ):
                foundation_scenario_runner.run_scenario()

        producer.produce.assert_called_once_with(run)
        runtime_pair.stop.assert_called_once_with(remove_storage=False)
        run.write_json.assert_called_once()
        cleanup = run.write_json.call_args.args[1]
        self.assertEqual(cleanup["status"], "failed")
        self.assertEqual(
            cleanup["capabilityIsolationFailures"],
            ["browser capability identity changed"],
        )

    def test_initial_setup_selects_verified_station_before_login(self) -> None:
        native = SessionHarnessClient("desktop_app")
        browser = SessionHarnessClient("browser")
        station_url = "https://station.example"

        foundation_scenario_runner._authenticate_clients(
            SimpleNamespace(native=native, browser=browser),
            {
                "PT_STATION_URL": f"{station_url}/",
                "PT_AGENT_PROVIDER_ID": "ark",
                "PT_AGENT_PROVIDER_API_KEY": "credential",
                "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
            },
        )

        for client in (native, browser):
            self.assertLess(
                client.calls.index("configureStation"),
                client.calls.index("loginWithPassword"),
            )
            self.assertEqual(
                client.payloads["configureStation"],
                {"stationUrl": client.station_url},
            )

    def test_initial_setup_restarts_a_dead_driver_before_login(self) -> None:
        browser = SessionHarnessClient("browser")
        runtime_pair = SimpleNamespace(
            native=SessionHarnessClient("desktop_app"),
            browser=browser,
        )

        with patch.object(
            foundation_scenario_runner,
            "_warm_up_client",
            side_effect=(False, True),
        ) as warm_up:
            foundation_scenario_runner._authenticate_clients(
                runtime_pair,
                {
                    "PT_STATION_URL": "https://station.example",
                    "PT_AGENT_PROVIDER_ID": "ark",
                    "PT_AGENT_PROVIDER_API_KEY": "credential",
                    "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                    "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
                },
                clients=(browser,),
            )

        self.assertEqual(warm_up.call_count, 2)
        self.assertEqual(browser.restart_count, 1)
        self.assertIn("configureStation", browser.calls)
        self.assertIn("loginWithPassword", browser.calls)

    def test_initial_setup_rejects_a_dead_driver_after_bounded_restart(
        self,
    ) -> None:
        browser = SessionHarnessClient("browser")
        runtime_pair = SimpleNamespace(
            native=SessionHarnessClient("desktop_app"),
            browser=browser,
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "_warm_up_client",
                side_effect=(False, False),
            ),
            self.assertRaisesRegex(
                foundation_scenario_runner.ScenarioRunnerError,
                "client session remained unavailable after bounded restart",
            ),
        ):
            foundation_scenario_runner._authenticate_clients(
                runtime_pair,
                {
                    "PT_STATION_URL": "https://station.example",
                    "PT_AGENT_PROVIDER_ID": "ark",
                    "PT_AGENT_PROVIDER_API_KEY": "credential",
                    "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                    "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
                },
                clients=(browser,),
            )

        self.assertEqual(browser.restart_count, 1)
        self.assertNotIn("configureStation", browser.calls)
        self.assertNotIn("loginWithPassword", browser.calls)

    def test_recovery_setup_reuses_existing_sessions_without_login(self) -> None:
        native = SessionHarnessClient("desktop_app")
        browser = SessionHarnessClient("browser")

        foundation_scenario_runner._authenticate_clients(
            SimpleNamespace(native=native, browser=browser),
            {
                "PT_AGENT_PROVIDER_ID": "ark",
                "PT_AGENT_PROVIDER_API_KEY": "credential",
                "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
            },
            require_existing_session=True,
        )

        self.assertNotIn("loginWithPassword", native.calls)
        self.assertNotIn("loginWithPassword", browser.calls)
        self.assertNotIn("configureStation", native.calls)
        self.assertNotIn("configureStation", browser.calls)
        self.assertNotIn("ensureProvider", native.calls)
        self.assertNotIn("ensureProvider", browser.calls)
        self.assertIn("getRuntimeSnapshot", native.calls)
        self.assertIn("getRuntimeSnapshot", browser.calls)

    def test_recovery_setup_rejects_a_missing_existing_session(self) -> None:
        native = SessionHarnessClient("desktop_app", authenticated=False)
        browser = SessionHarnessClient("browser")

        with self.assertRaises(
            foundation_scenario_runner.ScenarioRunnerError,
        ) as raised:
            foundation_scenario_runner._authenticate_clients(
                SimpleNamespace(native=native, browser=browser),
                {
                    "PT_AGENT_PROVIDER_ID": "ark",
                    "PT_AGENT_PROVIDER_API_KEY": "credential",
                    "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                    "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
                },
                require_existing_session=True,
                session_deadline=time.monotonic() + 0.01,
            )

        message = str(raised.exception)
        self.assertIn("existing session was not restored", message)
        self.assertIn('"actorPresent":false', message)
        self.assertIn('"authenticated":false', message)
        self.assertIn('"identityPhase":"accountGate"', message)
        self.assertIn('"identityReason":"session_missing"', message)
        self.assertIn('"identityState":"onboarding"', message)
        self.assertIn('"recoveryBoundary":"session-recovery"', message)
        self.assertNotIn("loginWithPassword", native.calls)
        self.assertEqual(browser.calls, [])

    def test_restore_failure_diagnostic_redacts_identity_and_error_detail(
        self,
    ) -> None:
        diagnostic = foundation_scenario_runner._restore_failure_diagnostic(
            recovery_boundary="station-restart",
            poll_count=3,
            session_state={
                "authenticated": False,
                "actorId": "ptid:private-actor",
                "identityState": "accountGate",
                "identityPhase": "accountGate",
                "identityReason": "restore_failed",
            },
            last_error=RuntimeError(
                "UNAUTHORIZED session revoked token=private-token"
            ),
        )

        self.assertIn('"actorPresent":true', diagnostic)
        self.assertIn('"errorCode":"UNAUTHORIZED"', diagnostic)
        self.assertIn('"errorReason":"session_revoked"', diagnostic)
        self.assertIn('"errorType":"RuntimeError"', diagnostic)
        self.assertIn('"identityPhase":"accountGate"', diagnostic)
        self.assertIn('"identityReason":"restore_failed"', diagnostic)
        self.assertIn('"identityState":"unknown"', diagnostic)
        self.assertIn('"recoveryBoundary":"station-restart"', diagnostic)
        self.assertNotIn("private-actor", diagnostic)
        self.assertNotIn("private-token", diagnostic)

    def test_direct_probe_runs_independent_group_one_oracle(self) -> None:
        probe_input = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F04",
            sample_id="sample-001",
        )

        client = DirectProbeHarnessClient()
        result = foundation_scenario_runner._make_direct_probe(client)(probe_input)

        self.assertTrue(result["assertions"]["autoPolicyExecutedOnce"])
        self.assertEqual(client.locales, ["en"])

    def test_direct_probe_rejects_harness_assertion_drift(self) -> None:
        probe_input = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F04",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "assertions do not match production scenario facts",
        ):
            foundation_scenario_runner._make_direct_probe(
                DirectProbeHarnessClient(mismatch=True)
            )(probe_input)

    def test_as_f07_direct_probe_budget_covers_revision_commands(self) -> None:
        client = TimeoutCaptureHarnessClient()
        probe_input = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="AS-F07",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(RuntimeError, "captured timeout"):
            foundation_scenario_runner._make_direct_probe(client)(probe_input)

        self.assertEqual(client.locale, "en")
        self.assertEqual(client.timeout, 900)

    def test_approval_expiry_budget_covers_deadline_and_recovery(self) -> None:
        client = TimeoutCaptureHarnessClient()
        probe_input = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-APPROVAL_EXPIRED",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(RuntimeError, "captured timeout"):
            foundation_scenario_runner._make_direct_probe(client)(probe_input)

        self.assertEqual(client.locale, "en")
        self.assertEqual(client.timeout, 1200)

    def test_as_f06_closes_each_tuple_around_its_own_restart(self) -> None:
        event_log: list[str] = []
        native = F06HarnessClient("desktop_app", event_log=event_log)
        browser = F06HarnessClient("browser", event_log=event_log)
        runtime_pair = SimpleNamespace(native=native, browser=browser)
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            runtime_pair,
            {"profile": {"resolvedName": "two"}},
            {},
        )
        probe = foundation_scenario_runner._make_direct_probe(
            browser,
            f06_coordinator=coordinator,
        )

        def restart_station(*_args: object, **kwargs: object) -> dict[str, object]:
            event_log.append("station:restart")
            kwargs["during_outage"](time.monotonic() + 165)
            event_log.append("station:ready")
            kwargs["after_restart"](time.monotonic() + 180)
            return {"containerId": "container"}

        def authenticate_clients(
            *_args: object,
            **kwargs: object,
        ) -> None:
            client = kwargs["clients"][0]
            event_log.append(
                f"{client.platform}:authenticate:"
                f"{kwargs['recovery_boundary']}"
            )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=restart_station,
            ) as restart,
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
                side_effect=authenticate_clients,
            ) as authenticate,
        ):
            first = probe(
                DirectRuntimeProbeInput(
                    platform="browser",
                    locale="en",
                    cell="AS-F06",
                    sample_id="sample-001",
                )
            )
            second = probe(
                DirectRuntimeProbeInput(
                    platform="browser",
                    locale="zh-CN",
                    cell="AS-F06",
                    sample_id="sample-001",
                )
            )

        self.assertEqual(restart.call_count, 4)
        self.assertEqual(authenticate.call_count, 8)
        self.assertTrue(all(
            call.kwargs.get("require_existing_session") is True
            for call in authenticate.call_args_list
        ))
        self.assertTrue(all(
            len(call.kwargs.get("clients", ())) == 1
            for call in authenticate.call_args_list
        ))
        self.assertEqual(
            [
                call.kwargs.get("recovery_boundary")
                for call in authenticate.call_args_list
            ],
            ["station-restart", "client-restart"] * 4,
        )
        self.assertEqual(native.restart_count, 2)
        self.assertEqual(browser.restart_count, 2)
        self.assertEqual(native.transport_cut_count, 2)
        self.assertEqual(browser.transport_cut_count, 2)
        self.assertEqual(native.transport_restore_count, 2)
        self.assertEqual(browser.transport_restore_count, 2)
        expected_order = []
        for runtime_tuple in (
            item
            for item in foundation_scenario_runner.group_one_tuples()
            if item.cell == "AS-F06"
        ):
            platform = runtime_tuple.platform
            expected_order.extend(
                (
                    f"{platform}:transport-cut",
                    f"{platform}:boundary-finalized",
                    "station:restart",
                    f"{platform}:observe-failure",
                    "station:ready",
                    f"{platform}:transport-restore",
                    f"{platform}:authenticate:station-restart",
                    f"{platform}:capability-restored",
                    f"{platform}:durable-reload",
                    f"{platform}:client-restart",
                    f"{platform}:authenticate:client-restart",
                    f"{platform}:complete",
                )
            )
        self.assertEqual(event_log, expected_order)
        self.assertEqual(len(native.prepare_calls), 2)
        self.assertEqual(len(browser.prepare_calls), 2)
        self.assertEqual(len(native.finalize_calls), 2)
        self.assertEqual(len(browser.finalize_calls), 2)
        self.assertEqual(len(native.failure_calls), 2)
        self.assertEqual(len(browser.failure_calls), 2)
        self.assertEqual(len(native.restoration_calls), 2)
        self.assertEqual(len(browser.restoration_calls), 2)
        self.assertEqual(len(native.reload_calls), 2)
        self.assertEqual(len(browser.reload_calls), 2)
        self.assertEqual(len(native.complete_calls), 2)
        self.assertEqual(len(browser.complete_calls), 2)
        for call in (*native.complete_calls, *browser.complete_calls):
            durable_evidence = call["durableReloadEvidence"]
            self.assertEqual(
                durable_evidence["durableReload"]["sourceDelivery"]["eventType"],
                "snapshot",
            )
        self.assertEqual(len(native.cleanup_calls), 2)
        self.assertEqual(len(browser.cleanup_calls), 2)
        self.assertEqual(
            first["scenarioFacts"]["scope"]["locale"],
            "en",
        )
        self.assertEqual(
            second["scenarioFacts"]["scope"]["locale"],
            "zh-CN",
        )
        self.assertNotEqual(
            native.prepare_calls[0]["scenarioKey"],
            native.prepare_calls[1]["scenarioKey"],
        )

    def test_as_f06_cleanup_requires_existing_sessions(self) -> None:
        native = SimpleNamespace(restart=Mock())
        browser = SimpleNamespace(restart=Mock())
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with patch.object(
            foundation_scenario_runner,
            "_authenticate_clients",
        ) as authenticate:
            errors = coordinator._restore_clients_for_cleanup()

        self.assertEqual(errors, [])
        native.restart.assert_called_once_with()
        browser.restart.assert_called_once_with()
        authenticate.assert_called_once()
        self.assertIs(
            authenticate.call_args.kwargs["require_existing_session"],
            True,
        )
        self.assertEqual(
            authenticate.call_args.kwargs["recovery_boundary"],
            "cleanup-restart",
        )

    def test_as_f06_finalize_failure_restores_transport_and_cleans_handoff(
        self,
    ) -> None:
        cleanup_log: list[str] = []
        browser = F06HarnessClient(
            "browser",
            cleanup_log=cleanup_log,
            fail_finalize=True,
        )
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(
                native=F06HarnessClient("desktop_app"),
                browser=browser,
            ),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with patch.object(
            foundation_scenario_runner,
            "_authenticate_clients",
        ):
            with self.assertRaisesRegex(RuntimeError, "finalize failed"):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

        self.assertEqual(browser.transport_cut_count, 1)
        self.assertEqual(browser.transport_restore_count, 1)
        self.assertEqual(
            cleanup_log,
            ["browser|en|AS-F06|sample-001"],
        )

    def test_as_f06_lost_prepare_response_restores_and_cleans_by_scenario(
        self,
    ) -> None:
        cleanup_log: list[str] = []
        browser = F06HarnessClient(
            "browser",
            cleanup_log=cleanup_log,
            lose_prepare_response=True,
        )
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(
                native=F06HarnessClient("desktop_app"),
                browser=browser,
            ),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with patch.object(
            foundation_scenario_runner,
            "_authenticate_clients",
        ):
            with self.assertRaisesRegex(RuntimeError, "prepare response lost"):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

        self.assertEqual(browser.transport_cut_count, 1)
        self.assertEqual(browser.transport_restore_count, 1)
        self.assertEqual(
            cleanup_log,
            ["browser|en|AS-F06|sample-001"],
        )
        self.assertEqual(
            browser.cleanup_calls[0],
            {
                "scenarioKey": "browser|en|AS-F06|sample-001",
                "conversationId": "",
                "turnId": "",
            },
        )

    def test_as_f06_rejects_durable_reload_without_source_delivery(
        self,
    ) -> None:
        native = F06HarnessClient("desktop_app")
        browser = F06HarnessClient(
            "browser",
            invalid_reload_delivery=True,
        )
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=lambda *_args, **kwargs: (
                    kwargs["during_outage"](time.monotonic() + 165),
                    kwargs["after_restart"](time.monotonic() + 180),
                    {"containerId": "container"},
                )[-1],
            ),
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ),
        ):
            with self.assertRaisesRegex(
                foundation_scenario_runner.ScenarioRunnerError,
                "durable reload source delivery is invalid",
            ):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

    def test_as_f06_rejects_unverified_capability_restoration(self) -> None:
        native = F06HarnessClient("desktop_app")
        browser = F06HarnessClient(
            "browser",
            invalid_restoration=True,
        )
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=lambda *_args, **kwargs: (
                    kwargs["during_outage"](time.monotonic() + 165),
                    kwargs["after_restart"](time.monotonic() + 180),
                    {"containerId": "container"},
                )[-1],
            ),
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ),
        ):
            with self.assertRaisesRegex(
                foundation_scenario_runner.ScenarioRunnerError,
                "capability-isolation restoration failed",
            ):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

    def test_as_f06_cleans_prepared_tuples_in_reverse_order_on_failure(
        self,
    ) -> None:
        cleanup_log: list[str] = []
        native = F06HarnessClient("desktop_app", cleanup_log=cleanup_log)
        browser = F06HarnessClient("browser", cleanup_log=cleanup_log)
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=RuntimeError("outage failed"),
            ),
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ) as authenticate,
        ):
            with self.assertRaisesRegex(RuntimeError, "outage failed"):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

        authenticate.assert_called_once()
        self.assertEqual(native.restart_count, 1)
        self.assertEqual(browser.restart_count, 1)
        self.assertEqual(
            cleanup_log,
            [
                "browser|en|AS-F06|sample-001",
            ],
        )

    def test_as_f06_cleans_prior_tuples_when_prepare_fails(self) -> None:
        cleanup_log: list[str] = []
        native = F06HarnessClient(
            "desktop_app",
            cleanup_log=cleanup_log,
            fail_prepare_at=2,
        )
        browser = F06HarnessClient("browser", cleanup_log=cleanup_log)
        coordinator = foundation_scenario_runner.FoundationF06Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=lambda *_args, **kwargs: (
                    kwargs["during_outage"](time.monotonic() + 165),
                    kwargs["after_restart"](time.monotonic() + 180),
                    {"containerId": "container"},
                )[-1],
            ) as restart,
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ) as authenticate,
        ):
            with self.assertRaisesRegex(RuntimeError, "prepare failed"):
                coordinator.capture(
                    DirectRuntimeProbeInput(
                        platform="browser",
                        locale="en",
                        cell="AS-F06",
                        sample_id="sample-001",
                    )
                )

        self.assertEqual(restart.call_count, 3)
        self.assertEqual(authenticate.call_count, 7)
        self.assertEqual(native.restart_count, 2)
        self.assertEqual(browser.restart_count, 3)
        self.assertEqual(
            cleanup_log,
            [
                "desktop_app|zh-CN|AS-F06|sample-001",
                "desktop_app|en|AS-F06|sample-001",
                "browser|zh-CN|AS-F06|sample-001",
                "browser|en|AS-F06|sample-001",
            ],
        )

    def test_as_f12_orders_restart_and_owning_client_restoration(
        self,
    ) -> None:
        call_log: list[str] = []
        native = F12HarnessClient("desktop_app", call_log=call_log)
        browser = F12HarnessClient("browser", call_log=call_log)
        runtime_pair = SimpleNamespace(native=native, browser=browser)
        coordinator = foundation_scenario_runner.FoundationF12Coordinator(
            runtime_pair,
            {"profile": {"resolvedName": "two"}},
            {},
        )
        probe = foundation_scenario_runner._make_direct_probe(
            browser,
            f12_coordinator=coordinator,
        )

        def restart(*_args: object, **_kwargs: object) -> dict[str, object]:
            call_log.append("station:restart")
            return {
                "stationUrlHash": "c" * 64,
                "protoDigest": "d" * 64,
                "containerId": "e" * 64,
                "imageId": "f" * 64,
                "imageRef": "foundation-station:test",
                "beforeStartedAt": "2026-09-04T00:00:00Z",
                "afterStartedAt": "2026-09-04T00:01:00Z",
                "sourceCommit": "a" * 40,
                "beforeCommit": "a" * 40,
                "afterCommit": "a" * 40,
            }

        def authenticate(
            _runtime_pair: object,
            _profile_env: object,
            **kwargs: object,
        ) -> None:
            clients = kwargs["clients"]
            owning_client = clients[0]
            call_log.append(f"{owning_client.platform}:authenticate")
            self.assertIs(kwargs["require_existing_session"], True)
            self.assertEqual(
                kwargs["recovery_boundary"],
                "as-f12-client-restart",
            )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                side_effect=restart,
            ) as station_restart,
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
                side_effect=authenticate,
            ) as authenticate_clients,
        ):
            result = probe(
                DirectRuntimeProbeInput(
                    platform="browser",
                    locale="en",
                    cell="AS-F12",
                    sample_id="sample-001",
                )
            )
            replay = probe(
                DirectRuntimeProbeInput(
                    platform="browser",
                    locale="en",
                    cell="AS-F12",
                    sample_id="sample-001",
                )
            )

        self.assertEqual(station_restart.call_count, 1)
        self.assertEqual(authenticate_clients.call_count, 1)
        self.assertEqual(native.restart_count, 0)
        self.assertEqual(browser.restart_count, 1)
        self.assertEqual(native.prepare_calls, [])
        self.assertEqual(len(browser.prepare_calls), 1)
        self.assertEqual(native.direct_calls, [])
        self.assertEqual(len(browser.direct_calls), 1)
        self.assertEqual(native.cleanup_calls, [])
        self.assertEqual(browser.cleanup_calls, [])
        self.assertEqual(result["cleanup"]["status"], "clean")
        self.assertEqual(replay, result)
        for client in (native, browser):
            for request in client.direct_calls:
                self.assertEqual(request["cell"], "AS-F12")
                self.assertIn("scenarioKey", request)
                self.assertIn("stationRestart", request)
                self.assertNotIn("topicConversationIds", request)
        for index, event in enumerate(call_log):
            if not event.endswith(":foundationF12Prepare"):
                continue
            platform = event.split(":", maxsplit=1)[0]
            self.assertEqual(
                call_log[index:index + 5],
                [
                    f"{platform}:foundationF12Prepare",
                    "station:restart",
                    f"{platform}:restart",
                    f"{platform}:authenticate",
                    f"{platform}:foundationDirectProbe",
                ],
            )

    def test_as_f12_failure_runs_explicit_cleanup(self) -> None:
        call_log: list[str] = []
        native = F12HarnessClient(
            "desktop_app",
            call_log=call_log,
            fail_direct=True,
        )
        browser = F12HarnessClient("browser", call_log=call_log)
        coordinator = foundation_scenario_runner.FoundationF12Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with (
            patch.object(
                foundation_scenario_runner,
                "restart_foundation_station",
                return_value={
                    "stationUrlHash": "c" * 64,
                    "protoDigest": "d" * 64,
                    "containerId": "e" * 64,
                    "imageId": "f" * 64,
                    "imageRef": "foundation-station:test",
                    "beforeStartedAt": "2026-09-04T00:00:00Z",
                    "afterStartedAt": "2026-09-04T00:01:00Z",
                    "sourceCommit": "a" * 40,
                    "beforeCommit": "a" * 40,
                    "afterCommit": "a" * 40,
                },
            ),
            patch.object(
                foundation_scenario_runner,
                "_authenticate_clients",
            ),
            self.assertRaisesRegex(RuntimeError, "direct probe failed"),
        ):
            coordinator.capture(
                DirectRuntimeProbeInput(
                    platform="desktop_app",
                    locale="en",
                    cell="AS-F12",
                    sample_id="sample-001",
                )
            )

        self.assertEqual(len(native.cleanup_calls), 1)
        cleanup = native.cleanup_calls[0]
        self.assertEqual(
            cleanup["scenarioKey"],
            "desktop_app|en|AS-F12|sample-001",
        )
        self.assertEqual(
            len(cleanup["conversationIds"]),
            2,
        )
        self.assertEqual(browser.cleanup_calls, [])

    def test_as_f12_prepare_failure_does_not_call_cleanup(self) -> None:
        call_log: list[str] = []
        native = F12HarnessClient(
            "desktop_app",
            call_log=call_log,
            fail_prepare=True,
        )
        browser = F12HarnessClient(
            "browser",
            call_log=call_log,
            fail_prepare=True,
        )
        coordinator = foundation_scenario_runner.FoundationF12Coordinator(
            SimpleNamespace(native=native, browser=browser),
            {"profile": {"resolvedName": "two"}},
            {},
        )

        with self.assertRaisesRegex(RuntimeError, "prepare failed"):
            coordinator.capture(
                DirectRuntimeProbeInput(
                    platform="desktop_app",
                    locale="en",
                    cell="AS-F12",
                    sample_id="sample-001",
                )
            )

        self.assertEqual(native.cleanup_calls, [])
        self.assertEqual(browser.cleanup_calls, [])


if __name__ == "__main__":
    unittest.main()
