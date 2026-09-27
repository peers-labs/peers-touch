from __future__ import annotations

import unittest
from typing import Any, Mapping

from tooling.development.secure_content.scenarios import (
    final_browser,
    final_chat,
    final_chat_mobile,
    final_desktop,
    final_mobile,
    hardcut_browser_regression,
    hardcut_chat_mobile_regression,
    hardcut_chat_regression,
    hardcut_mobile_regression,
    hardcut_regression,
)


class _Manifest:
    def __init__(self, clients: Mapping[str, Mapping[str, str]]) -> None:
        self.clients = dict(clients)

    def client(self, client_id: str) -> Mapping[str, str]:
        return self.clients[client_id]


class _DesktopContext:
    runtime = "desktop"
    profile = None
    profiles = ("four", "fiveArm")
    journey_id = "sc-dj-hardcut-regression"
    clients = tuple(sorted(hardcut_regression.EXPECTED_CLIENTS))
    repo_root = None

    def __init__(self) -> None:
        self.checks: list[str] = []
        self.operations: list[str] = []
        self._manifest = _Manifest(
            {
                client_id: {
                    "actor_role": client_id.rsplit("-", 1)[-1],
                    "runtime_kind": "native-tauri",
                }
                for client_id in self.clients
            }
        )

    def require_runtime_manifest(self) -> _Manifest:
        return self._manifest

    def run_check(
        self,
        check_id: str,
        _command: list[str],
        *,
        cwd: object,
    ) -> None:
        del cwd
        self.checks.append(check_id)

    def invoke_fixture_action(
        self,
        capability: str,
        operation: str,
        _payload: Mapping[str, object],
    ) -> Mapping[str, Any]:
        if capability != hardcut_regression.FIXTURE_CAPABILITY:
            raise AssertionError(capability)
        self.operations.append(operation)
        outcome: dict[str, Any] = {
            "completed": True,
            "partialPrivateRows": 0,
            "publicFallbackUsed": False,
            "receiverObservationDigests": [
                ("a" if operation == "full-social" else "b") * 64
            ],
        }
        if operation == "full-social":
            outcome["coveredAcceptanceIds"] = sorted(
                hardcut_regression.DESKTOP_ACCEPTANCE_IDS
            )
        else:
            outcome.update(
                {
                    "coveredBoundaries": sorted(
                        hardcut_regression.UOW_BOUNDARIES
                    ),
                    "allOrNone": True,
                    "replayExact": True,
                    "conflictingHashTerminal": True,
                }
            )
        return {"outcome": outcome}


class HardcutRegressionScenarioTest(unittest.TestCase):
    def test_desktop_regression_checks_source_social_and_uow(self) -> None:
        context = _DesktopContext()

        result = hardcut_regression._execute(context)  # type: ignore[arg-type]

        self.assertEqual(["hardcut-zero-reference"], context.checks)
        self.assertEqual(["full-social", "outer-uow"], context.operations)
        self.assertEqual(
            sorted(hardcut_regression.DESKTOP_ACCEPTANCE_IDS),
            result["observations"]["desktopAcceptanceIds"],
        )

    def test_hardcut_scenarios_use_w11_owned_results(self) -> None:
        scenarios = (
            hardcut_regression.SCENARIO,
            hardcut_browser_regression.SCENARIO,
            hardcut_mobile_regression.SCENARIO,
            hardcut_chat_regression.SCENARIO,
            hardcut_chat_mobile_regression.SCENARIO,
        )
        for scenario in scenarios:
            with self.subTest(scenario=scenario.scenario_id):
                self.assertEqual("secure-content-w11", scenario.work_item_id)
                self.assertEqual("W11", scenario.result_task_id)
                self.assertEqual("W11", scenario.result_workstream_id)

    def test_mobile_and_chat_variants_are_platform_partitioned(self) -> None:
        ios = (
            "secure-content-hardcut-ios-alice",
            "secure-content-hardcut-ios-bob",
            "secure-content-hardcut-ios-eve",
        )
        android_chat = (
            "secure-content-hardcut-android-alice",
            "secure-content-hardcut-android-bob",
        )

        self.assertEqual(
            "ios",
            hardcut_mobile_regression._result_variant(
                "mobile",
                "four",
                ("four",),
                ios,
            ),
        )
        self.assertEqual(
            "chat-android",
            hardcut_chat_mobile_regression._result_variant(
                "mobile",
                None,
                ("four", "fiveArm"),
                android_chat,
            ),
        )

    def test_final_adapters_use_w12_owned_product_results(self) -> None:
        scenarios = (
            final_desktop.SCENARIO,
            final_browser.SCENARIO,
            final_mobile.SCENARIO,
            final_chat.SCENARIO,
            final_chat_mobile.SCENARIO,
        )
        for scenario in scenarios:
            with self.subTest(scenario=scenario.scenario_id):
                self.assertEqual("secure-content-w12", scenario.work_item_id)
                self.assertEqual("W12", scenario.result_task_id)
                self.assertEqual("W12", scenario.result_workstream_id)
                self.assertEqual(
                    "W12/product",
                    scenario.result_prefix.as_posix(),
                )


if __name__ == "__main__":
    unittest.main()
