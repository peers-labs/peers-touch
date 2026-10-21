"""Real Home operator login, restart, replay, CSRF and timing proof."""

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.core.launch_context import EphemeralGateClient
from tooling.acceptance.provisioners.x_config_home import (
    CAPABILITY_ID,
    OPERATOR_GATE_ID,
    OPERATOR_OPERATIONS,
)


class HomeOperatorLoginGate(AcceptanceGate):
    gate_id = OPERATOR_GATE_ID
    phase = "XHOS-02"
    bom = ("XHOS-HOME-OPERATOR",)
    spec = (
        "docs/architecture/platform/client/control-plane/execution-plans/"
        "20261020-x-config-home-operator-state/tasks/XHOS-02.md",
    )

    def run(self):
        client = EphemeralGateClient.from_environment()
        if client is None:
            raise GateError("parent-owned Home X Config capability required")
        observations = {}
        try:
            for operation in OPERATOR_OPERATIONS:
                observations[operation] = dict(
                    client.invoke(
                        CAPABILITY_ID,
                        operation,
                        {},
                        timeout_seconds=700,
                    )
                )
                self.assert_condition(operation, True)
        finally:
            client.close()
        self.assert_condition(
            "same_release_after_restart",
            observations["service-authority"]["releaseId"]
            == observations["restart-with-session"]["releaseId"],
        )
        self.assert_condition(
            "session_survives_restart",
            observations["operator-session"]["authenticated"] is True
            and observations["operator-session-after-restart"]["authenticated"]
            is True,
        )
        self.assert_condition(
            "csrf_and_replay_denied",
            observations["csrf-denial"]["missingDenied"] is True
            and observations["csrf-denial"]["invalidDenied"] is True
            and observations["replay-denial"]["callbackReplayDenied"] is True,
        )
        self.assert_condition(
            "twenty_warm_segmented_samples",
            observations["warm-timing"]["sampleCount"] == 20
            and observations["warm-timing"][
                "brokerTimingReportedSeparately"
            ]
            is True,
        )
        self.assert_condition(
            "no_admin_auth_git_mutation",
            observations["git-auth-isolation"]["adminAuthMutationCount"] == 0,
        )
        return {
            "journey": "CCP-J01-home-operator-login",
            "observations": observations,
            "proven_scope": [
                "real allowlisted provider login",
                "Home SQLite session restart continuity",
                "callback replay and CSRF denial",
                "twenty segmented warm timing samples",
                "absence of x-config/admin-auth Git mutations",
            ],
            "unproven_scope": [
                "OAuth Broker storage optimization",
                "native Desktop and Mobile UI",
            ],
        }


def main() -> int:
    return HomeOperatorLoginGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
