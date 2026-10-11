from __future__ import annotations

import unittest

from tooling.acceptance.gates.mobile.three_client_suite_runtime import (
    INPUT_KIND,
    build_report,
)

SCENARIO_IDS = (
    "moments-publish-receive",
    "moments-react-comment",
    "moments-reply-rollback",
    "moments-draft-recovery",
)

def event(
    action: str,
    *,
    scenario_id: str = "",
    resource_id: str = "",
) -> dict[str, object]:
    return {
        "action": action,
        "scenarioId": scenario_id,
        "resourceId": resource_id,
        "durationSeconds": 0.01,
    }


def valid_input() -> dict[str, object]:
    events = [
        event("provision", resource_id="three-client-runtime"),
        event("account-provision", resource_id="actors:alice,bob,coral"),
    ]
    for client_id in ("android-alice", "desktop-bob", "ios-coral"):
        events.append(event("client-launch", resource_id=f"client:{client_id}"))
        events.append(event("login", resource_id=f"login:{client_id}"))
    for scenario_id in SCENARIO_IDS:
        events.extend(
            [
                event("scenario-start", scenario_id=scenario_id),
                event(
                    "ui-action",
                    scenario_id=scenario_id,
                    resource_id=f"ui:{scenario_id}",
                ),
                event(
                    "receiver-assertion",
                    scenario_id=scenario_id,
                    resource_id=f"receiver:{scenario_id}",
                ),
                event(
                    "supporting-observation",
                    scenario_id=scenario_id,
                    resource_id=f"trace:{scenario_id}",
                ),
                event("scenario-end", scenario_id=scenario_id),
            ]
        )
    events.append(event("cleanup-complete", resource_id="foreground-released"))
    return {
        "schemaVersion": 1,
        "kind": INPUT_KIND,
        "suiteRuntimeId": "mwpu-06-test",
        "sourceDigest": "a" * 40,
        "fixtureEpoch": "fixture-test",
        "runtimeReuse": {
            "scope": "suite",
            "entryCheckId": "moments-foreground-functional",
            "scenarioIds": list(SCENARIO_IDS),
            "maxProvisioningRuns": 1,
            "maxClientLaunches": 3,
            "minWarmReuseRate": 0.66,
            "requireAttachOnlyScenarios": True,
            "requireReceiverVisibleProof": True,
            "allowClientReplacement": False,
        },
        "events": events,
    }


class ThreeClientSuiteRuntimeTests(unittest.TestCase):
    def test_foreground_suite_uses_three_clients_and_four_ui_scenarios(
        self,
    ) -> None:
        report = build_report(valid_input())

        self.assertEqual(report["result"], "PASS")
        self.assertEqual(report["proofState"], "SUPPORTING")
        self.assertEqual(report["metrics"]["provisioningRuns"], 1)
        self.assertEqual(report["metrics"]["clientLaunches"], 3)
        self.assertEqual(report["metrics"]["completedScenarios"], 4)
        self.assertEqual(report["metrics"]["warmReuseRate"], 0.75)

    def test_harness_observations_cannot_replace_foreground_ui_actions(
        self,
    ) -> None:
        value = valid_input()
        value["events"] = [
            row
            for row in value["events"]
            if not (
                row["action"] == "ui-action"
                and row["scenarioId"] == SCENARIO_IDS[0]
            )
        ]

        with self.assertRaisesRegex(Exception, "no UI action"):
            build_report(value)


if __name__ == "__main__":
    unittest.main()
