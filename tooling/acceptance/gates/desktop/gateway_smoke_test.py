#!/usr/bin/env python3
"""Desktop Gateway smoke runtime-contract tests."""

from __future__ import annotations

import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.desktop.gateway_smoke import (
    FEDERATION_APPLICATION,
    DesktopGatewaySmokeGate,
    catalog_search_uses_direct_typed_proto,
    runtime_endpoints,
)


class RuntimeEndpointsTests(unittest.TestCase):
    def test_catalog_search_uses_direct_typed_proto_transport(self) -> None:
        source = FEDERATION_APPLICATION.read_text(encoding="utf-8")

        self.assertTrue(catalog_search_uses_direct_typed_proto(source))

    def test_rejects_legacy_peers_response_envelope_transport(self) -> None:
        broken_source = """
pub fn catalog_search() {
    station_client::request_peers_proto::<
        FederationCatalogSearchRequest,
        FederationCatalogSearchResponse,
    >();
}

pub fn encode_catalog_search() {}
"""

        self.assertFalse(catalog_search_uses_direct_typed_proto(broken_source))

    def test_declares_federation_traceability(self) -> None:
        gate = DesktopGatewaySmokeGate()

        self.assertEqual(gate.report.phase, "WS-6")
        self.assertEqual(
            gate.report.bom,
            ["desktop-federation-context-surface"],
        )
        self.assertEqual(gate.report.spec, ["desktop-federation-surfaces"])

    def test_resolves_endpoints_from_provisioned_runtime(self) -> None:
        target_url, gateway_url, station_url = runtime_endpoints(
            {
                "clients": [
                    {
                        "gateway_port": 3300,
                        "renderer_port": 3480,
                    }
                ],
                "services": {
                    "station": {
                        "kind": "station",
                        "endpoint": "http://10.37.94.156:18132/",
                    },
                },
            }
        )

        self.assertEqual(target_url, "http://localhost:3480/")
        self.assertEqual(gateway_url, "http://127.0.0.1:3300")
        self.assertEqual(station_url, "http://10.37.94.156:18132")

    def test_rejects_missing_or_invalid_runtime_endpoints(self) -> None:
        invalid_manifests = (
            {},
            {"clients": []},
            {
                "clients": [{"gateway_port": 0, "renderer_port": 3480}],
                "services": {
                    "station": {"kind": "station", "endpoint": "http://station"},
                },
            },
            {
                "clients": [{"gateway_port": 3300, "renderer_port": "3480"}],
                "services": {
                    "station": {"kind": "station", "endpoint": "http://station"},
                },
            },
            {
                "clients": [{"gateway_port": 3300, "renderer_port": 3480}],
                "services": {"station": {"kind": "station"}},
            },
        )

        for manifest in invalid_manifests:
            with self.subTest(manifest=manifest), self.assertRaises(GateError):
                runtime_endpoints(manifest)


if __name__ == "__main__":
    unittest.main()
