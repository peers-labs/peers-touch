from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from tooling.acceptance.core.attestation import (
    read_service_runtime_identity,
)
from tooling.acceptance.core.errors import BlockedError


class _Response:
    def __init__(self, payload: dict[str, str]) -> None:
        self._payload = payload

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


class ServiceRuntimeIdentityTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.core.attestation.urllib.request.urlopen",
        return_value=_Response(
            {
                "station_peer_id": "logical-station",
                "node_peer_id": "physical-node",
            }
        ),
    )
    def test_returns_logical_station_identity(self, _urlopen: object) -> None:
        self.assertEqual(
            read_service_runtime_identity("http://station.example"),
            "logical-station",
        )

    @patch(
        "tooling.acceptance.core.attestation.urllib.request.urlopen",
        return_value=_Response(
            {
                "station_peer_id": "shared-peer",
                "node_peer_id": "shared-peer",
            }
        ),
    )
    def test_rejects_reused_station_and_node_identity(
        self,
        _urlopen: object,
    ) -> None:
        with self.assertRaisesRegex(BlockedError, "reuses one PeerID"):
            read_service_runtime_identity("http://station.example")


if __name__ == "__main__":
    unittest.main()
