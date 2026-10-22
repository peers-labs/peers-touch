"""Home catalog publication and exact-byte API readback evidence."""

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.core.launch_context import EphemeralGateClient
from tooling.acceptance.gates.x_config.browser_report import (
    require_browser_journey,
)
from tooling.acceptance.provisioners.x_config_home import (
    CAPABILITY_ID,
    PUBLICATION_GATE_ID,
    PUBLICATION_OPERATIONS,
)


class HomePublicationGate(AcceptanceGate):
    gate_id = PUBLICATION_GATE_ID
    phase = "XHOS-02"
    bom = ("XHOS-HOME-PUBLICATION",)
    spec = (
        "docs/architecture/platform/client/control-plane/execution-plans/"
        "20261020-x-config-home-operator-state/tasks/XHOS-02.md",
    )

    def __init__(self):
        super().__init__()
        self.report = require_browser_journey(self.report)

    def run(self):
        client = EphemeralGateClient.from_environment()
        if client is None:
            raise GateError("parent-owned Home X Config capability required")
        observations = {}
        try:
            for operation in PUBLICATION_OPERATIONS:
                observations[operation] = dict(
                    client.invoke(
                        CAPABILITY_ID,
                        operation,
                        {},
                        timeout_seconds=1900,
                    )
                )
                self.assert_condition(operation, True)
        finally:
            client.close()
        publication = observations["publish-reviewed-catalog"]
        readback = observations["public-readback"]
        verifier = observations["client-verification"]
        self.assert_condition(
            "publication_sequence_advanced",
            publication["sequence"] > publication["priorSequence"],
        )
        self.assert_condition(
            "exact_public_bytes",
            publication["envelopeSha256"] == readback["envelopeSha256"]
            and readback["latestAndImmutableEqual"] is True
            and readback["credentialFreePublicRead"] is True,
        )
        self.assert_condition(
            "shared_client_verification",
            all(
                verifier.get(key) is True
                for key in (
                    "signatureVerified",
                    "tamperDenied",
                    "wrongChannelDenied",
                    "expiryDenied",
                    "rollbackDenied",
                )
            ),
        )
        self.assert_condition(
            "logout_remains_revoked_after_restart",
            observations["logout"]["revoked"] is True
            and observations["revocation-readback"]["revokedAfterRestart"]
            is True,
        )
        self.assert_condition(
            "no_admin_auth_git_mutation",
            observations["git-auth-isolation"]["adminAuthMutationCount"] == 0,
        )

        return {
            "journey": "CCP-J01-home-publication",
            "observations": observations,
            "proven_scope": [
                "GitHub-backed catalog CAS and direct publication",
                "exact latest and immutable public bytes",
                "shared x-config-core verification",
                "durable logout and revocation after restart",
            ],
            "unproven_scope": [
                "operator-visible browser publication action",
                "receiver-visible reusable Suite Runtime lifecycle",
                "Production promotion",
                "native Desktop and Mobile UI",
            ],
        }


def main() -> int:
    return HomePublicationGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
