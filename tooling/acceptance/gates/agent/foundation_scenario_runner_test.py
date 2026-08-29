from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios_test import (
    valid_as_f04_capture,
    valid_as_f06_capture,
)


class DirectProbeHarnessClient:
    def __init__(self, *, mismatch: bool = False) -> None:
        self.mismatch = mismatch

    def harness(
        self,
        _method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        request = payload or {}
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


class F06HarnessClient:
    def __init__(
        self,
        platform: str,
        *,
        cleanup_log: list[str] | None = None,
        fail_prepare_at: int | None = None,
    ) -> None:
        self.platform = platform
        self.cleanup_log = cleanup_log
        self.fail_prepare_at = fail_prepare_at
        self.restart_count = 0
        self.prepare_calls: list[dict[str, object]] = []
        self.failure_calls: list[dict[str, object]] = []
        self.reload_calls: list[dict[str, object]] = []
        self.complete_calls: list[dict[str, object]] = []
        self.cleanup_calls: list[dict[str, object]] = []

    def restart(self) -> None:
        self.restart_count += 1

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
            return {
                "conversationId": f"conversation-{suffix}",
                "turnId": f"turn-{suffix}",
            }
        if method == "foundationF06ObserveFailure":
            self.failure_calls.append(request)
            return {"activeFailureObserved": True}
        if method == "foundationF06DurableReload":
            self.reload_calls.append(request)
            return {"durableReload": {"observed": True}}
        if method == "foundationF06Cleanup":
            self.cleanup_calls.append(request)
            if self.cleanup_log is not None:
                self.cleanup_log.append(str(request["scenarioKey"]))
            return {"cleanupComplete": True}
        if method != "foundationDirectProbe":
            raise AssertionError(f"unexpected method: {method}")
        self.complete_calls.append(request)
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

    def test_direct_probe_runs_independent_group_one_oracle(self) -> None:
        probe_input = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F04",
            sample_id="sample-001",
        )

        result = foundation_scenario_runner._make_direct_probe(
            DirectProbeHarnessClient()
        )(probe_input)

        self.assertTrue(result["assertions"]["autoPolicyExecutedOnce"])

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

    def test_as_f06_closes_each_tuple_around_its_own_restart(self) -> None:
        native = F06HarnessClient("desktop_app")
        browser = F06HarnessClient("browser")
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
        self.assertEqual(authenticate.call_count, 4)
        authenticate.assert_called_with(runtime_pair, {})
        self.assertEqual(native.restart_count, 4)
        self.assertEqual(browser.restart_count, 4)
        self.assertEqual(len(native.prepare_calls), 2)
        self.assertEqual(len(browser.prepare_calls), 2)
        self.assertEqual(len(native.failure_calls), 2)
        self.assertEqual(len(browser.failure_calls), 2)
        self.assertEqual(len(native.reload_calls), 2)
        self.assertEqual(len(browser.reload_calls), 2)
        self.assertEqual(len(native.complete_calls), 2)
        self.assertEqual(len(browser.complete_calls), 2)
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
        self.assertEqual(authenticate.call_count, 4)
        self.assertEqual(native.restart_count, 4)
        self.assertEqual(browser.restart_count, 4)
        self.assertEqual(
            cleanup_log,
            [
                "desktop_app|en|AS-F06|sample-001",
                "browser|zh-CN|AS-F06|sample-001",
                "browser|en|AS-F06|sample-001",
            ],
        )


if __name__ == "__main__":
    unittest.main()
