from __future__ import annotations

import http.server
import threading
import unittest
import urllib.error
import urllib.request

from tooling.acceptance.fixtures.agent_marketplace_catalog_fault_proxy import (
    AgentMarketplaceCatalogFaultProxy,
    CATALOG_PATH,
)


def _encode_varint(value: int) -> bytes:
    encoded = bytearray()
    while value >= 0x80:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def _catalog_response(envelope: bytes) -> bytes:
    digest = b"a" * 64
    return b"".join(
        (
            b"\x0a",
            _encode_varint(len(envelope)),
            envelope,
            b"\x12\x10application/json",
            b"\x1a\x19peers-official-station-v1",
            b"\x22",
            _encode_varint(len(digest)),
            digest,
        )
    )


class _UpstreamHandler(http.server.BaseHTTPRequestHandler):
    response_body = _catalog_response(b'{"schemaVersion":"test"}')

    def do_GET(self) -> None:
        body = self.response_body if self.path == CATALOG_PATH else b"ok"
        self.send_response(200)
        self.send_header("Content-Type", "application/protobuf")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class AgentMarketplaceCatalogFaultProxyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.upstream = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0),
            _UpstreamHandler,
        )
        self.upstream_thread = threading.Thread(
            target=self.upstream.serve_forever,
            daemon=True,
        )
        self.upstream_thread.start()
        host, port = self.upstream.server_address
        self.proxy = AgentMarketplaceCatalogFaultProxy(f"http://{host}:{port}")
        self.proxy.start()

    def tearDown(self) -> None:
        self.proxy.stop()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.upstream_thread.join(timeout=5)

    def test_catalog_sequence_passes_tampers_returns_404_then_recovers(self) -> None:
        expected = _UpstreamHandler.response_body
        first = urllib.request.urlopen(self.proxy.url + CATALOG_PATH).read()
        second = urllib.request.urlopen(self.proxy.url + CATALOG_PATH).read()
        with self.assertRaises(urllib.error.HTTPError) as missing:
            urllib.request.urlopen(self.proxy.url + CATALOG_PATH)
        fourth = urllib.request.urlopen(self.proxy.url + CATALOG_PATH).read()

        self.assertEqual(first, expected)
        self.assertNotEqual(second, expected)
        self.assertEqual(len(second), len(expected))
        self.assertEqual(missing.exception.code, 404)
        self.assertEqual(fourth, expected)
        self.assertEqual(
            self.proxy.evidence()["actions"],
            ["pass", "tamper", "missing", "pass"],
        )

    def test_non_catalog_requests_are_forwarded_without_consuming_sequence(self) -> None:
        self.assertEqual(urllib.request.urlopen(self.proxy.url + "/health").read(), b"ok")
        self.assertEqual(self.proxy.evidence()["requestCount"], 0)
        self.assertEqual(
            urllib.request.urlopen(self.proxy.url + CATALOG_PATH).read(),
            _UpstreamHandler.response_body,
        )
        self.assertEqual(self.proxy.evidence()["actions"], ["pass"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
