from __future__ import annotations

import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.capability_contract import (
    _validate_api_ownership,
    validate_station_access_capability_contract,
)


class StationAccessCapabilityContractTest(unittest.TestCase):
    def test_current_repository_satisfies_contract(self) -> None:
        validate_station_access_capability_contract()

    def test_api_ownership_rejects_missing_canonical_access_route(self) -> None:
        with self.assertRaisesRegex(
            GateError,
            "station.identity.verify",
        ):
            _validate_api_ownership(
                {
                    "capabilities": [],
                    "target_absent_routes": [
                        {
                            "method": "POST",
                            "path": "/actor/" + "login",
                        }
                    ],
                }
            )

    def test_api_ownership_does_not_require_retired_route_metadata(self) -> None:
        capabilities = []
        for capability_id, (
            method,
            path,
            request_proto,
            response_proto,
        ) in {
            "station.identity.verify": (
                "POST",
                "/sub-bootstrap/station-identity",
                "peers_touch.model.peer.v1.StationIdentityRequest",
                "peers_touch.model.peer.v1.StationIdentityResponse",
            ),
            "access.gate.start": (
                "POST",
                "/actor/access/start",
                "peers_touch.model.access_gate.v1.StartAccessAttemptRequest",
                "peers_touch.model.access_gate.v1.StartAccessAttemptResponse",
            ),
            "access.gate.submit": (
                "POST",
                "/actor/access/submit",
                "peers_touch.model.access_gate.v1.SubmitAccessGateRequest",
                "peers_touch.model.access_gate.v1.SubmitAccessGateResponse",
            ),
            "access.gate.decision": (
                "POST",
                "/actor/access/decision",
                "peers_touch.model.access_gate.v1.GetAccessDecisionRequest",
                "peers_touch.model.access_gate.v1.GetAccessDecisionResponse",
            ),
            "access.gate.cancel": (
                "POST",
                "/actor/access/cancel",
                "peers_touch.model.access_gate.v1.CancelAccessAttemptRequest",
                "peers_touch.model.access_gate.v1.CancelAccessAttemptResponse",
            ),
        }.items():
            capabilities.append(
                {
                    "id": capability_id,
                    "canonical_route": {
                        "method": method,
                        "path": path,
                    },
                    "request_proto": request_proto,
                    "response_proto": response_proto,
                }
            )

        _validate_api_ownership(
            {
                "capabilities": capabilities,
                "target_absent_routes": [],
            }
        )


if __name__ == "__main__":
    unittest.main()
