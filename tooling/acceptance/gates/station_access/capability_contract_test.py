from __future__ import annotations

import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.capability_contract import (
    CLIENT_ACCESS_COMMAND_CONTRACTS,
    _validate_client_command_inventory,
    _validate_source_route_inventory,
    _validate_api_ownership,
    validate_station_access_capability_contract,
)


class StationAccessCapabilityContractTest(unittest.TestCase):
    def test_current_repository_satisfies_contract(self) -> None:
        validate_station_access_capability_contract()

    def test_api_ownership_rejects_missing_current_access_capability(self) -> None:
        with self.assertRaisesRegex(
            GateError,
            "station.identity.verify",
        ):
            _validate_api_ownership({"capabilities": []})

    def test_api_ownership_accepts_complete_current_inventory(self) -> None:
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
        for capability_id, method, path in (
            ("access.gate.start.preflight", "OPTIONS", "/actor/access/start"),
            ("access.gate.submit.preflight", "OPTIONS", "/actor/access/submit"),
            (
                "access.gate.decision.preflight",
                "OPTIONS",
                "/actor/access/decision",
            ),
            ("access.gate.cancel.preflight", "OPTIONS", "/actor/access/cancel"),
        ):
            capabilities.append(
                {
                    "id": capability_id,
                    "canonical_route": {"method": method, "path": path},
                    "request_proto": "",
                    "response_proto": "",
                }
            )

        _validate_api_ownership({"capabilities": capabilities})

    def test_api_ownership_rejects_unknown_access_route(self) -> None:
        capabilities = []
        for capability_id, (
            method,
            path,
            request_proto,
            response_proto,
        ) in {
            **{
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
            },
            **{
                f"preflight.{index}": ("OPTIONS", path, "", "")
                for index, path in enumerate(
                    (
                        "/actor/access/start",
                        "/actor/access/submit",
                        "/actor/access/decision",
                        "/actor/access/cancel",
                    )
                )
            },
            "access.gate.unknown": (
                "POST",
                "/actor/access/unknown",
                "example.Request",
                "example.Response",
            ),
        }.items():
            capabilities.append(
                {
                    "id": capability_id,
                    "canonical_route": {"method": method, "path": path},
                    "request_proto": request_proto,
                    "response_proto": response_proto,
                }
            )

        with self.assertRaisesRegex(GateError, "exactly match"):
            _validate_api_ownership({"capabilities": capabilities})

    def test_source_inventory_rejects_unknown_access_route(self) -> None:
        routes = [
            {"method": method, "path": path}
            for method, path in (
                ("POST", "/actor/access/start"),
                ("OPTIONS", "/actor/access/start"),
                ("POST", "/actor/access/submit"),
                ("OPTIONS", "/actor/access/submit"),
                ("POST", "/actor/access/decision"),
                ("OPTIONS", "/actor/access/decision"),
                ("POST", "/actor/access/cancel"),
                ("OPTIONS", "/actor/access/cancel"),
                ("POST", "/actor/access/unknown"),
            )
        ]

        with self.assertRaisesRegex(GateError, "implementation routes"):
            _validate_source_route_inventory({"routes": routes})

    def test_client_command_inventory_accepts_all_registered_surfaces(
        self,
    ) -> None:
        sources = {
            str(contract["path"]): "\n".join(
                self._command_line(surface, command)
                for command in sorted(set(contract["allowed"]))
            )
            for surface, contract in CLIENT_ACCESS_COMMAND_CONTRACTS.items()
        }

        inventories = _validate_client_command_inventory(sources)

        self.assertEqual(
            set(inventories),
            {
                *CLIENT_ACCESS_COMMAND_CONTRACTS,
                "Desktop production discovery",
                "Mobile production discovery",
            },
        )

    def test_client_command_inventory_rejects_direct_frontend_invoke(
        self,
    ) -> None:
        sources = self._valid_client_command_sources()
        path = "apps/desktop/src/services/desktop_api.ts"
        sources[path] += "\ninvoke('access_backdoor')"

        with self.assertRaisesRegex(GateError, "Desktop frontend"):
            _validate_client_command_inventory(sources)

    def test_client_command_inventory_rejects_extra_native_handler(
        self,
    ) -> None:
        sources = self._valid_client_command_sources()
        path = "apps/desktop/src-tauri/src/main.rs"
        sources[path] += "\nauth::access_backdoor,"

        with self.assertRaisesRegex(GateError, "Desktop Tauri handlers"):
            _validate_client_command_inventory(sources)

    def test_client_command_inventory_rejects_unknown_command_in_other_file(
        self,
    ) -> None:
        sources = self._valid_client_command_sources()
        sources["apps/mobile/src/services/rogueGateway.ts"] = (
            "const command = `access_backdoor`;\n"
            "invoke(command)"
        )

        with self.assertRaisesRegex(GateError, "Mobile production"):
            _validate_client_command_inventory(sources)

    @classmethod
    def _valid_client_command_sources(cls) -> dict[str, str]:
        return {
            str(contract["path"]): "\n".join(
                cls._command_line(surface, command)
                for command in sorted(set(contract["allowed"]))
            )
            for surface, contract in CLIENT_ACCESS_COMMAND_CONTRACTS.items()
        }

    @staticmethod
    def _command_line(surface: str, command: str) -> str:
        if surface == "Desktop frontend":
            return f"invokeAccessCommand('{command}')"
        if surface == "Desktop native commands":
            return f"pub fn {command}() {{}}"
        if surface == "Desktop Tauri handlers":
            return f"auth::{command},"
        if surface == "Desktop HTTP gateway":
            return f'    "{command}" => value,'
        if surface == "Mobile frontend":
            return f"invoke('{command}')"
        if surface == "Mobile native commands":
            return f"pub async fn {command}() {{}}"
        if surface == "Mobile Tauri handlers":
            return f"oauth::{command},"
        raise AssertionError(surface)


if __name__ == "__main__":
    unittest.main()
