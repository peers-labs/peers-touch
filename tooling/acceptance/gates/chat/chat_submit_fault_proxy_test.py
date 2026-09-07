from __future__ import annotations

import hashlib
import http.client
import socket
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tooling.acceptance.fixtures.chat_submit_fault_proxy import (
    CONVERSATION_COMMAND_PATH,
    _ProxyServer,
)


def _encode_varint(value: int) -> bytes:
    encoded = bytearray()
    while value >= 0x80:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


class _UpstreamHandler(BaseHTTPRequestHandler):
    bodies: list[bytes] = []

    def do_GET(self) -> None:
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.bodies.append(body)
        response = b'{"accepted":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class ChatSubmitFaultProxyTest(unittest.TestCase):
    def setUp(self) -> None:
        _UpstreamHandler.bodies = []
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), _UpstreamHandler)
        self.upstream_thread = threading.Thread(
            target=self.upstream.serve_forever,
            daemon=True,
        )
        self.upstream_thread.start()
        host, port = self.upstream.server_address
        self.proxy = _ProxyServer(f"http://{host}:{port}")
        self.proxy_thread = threading.Thread(
            target=self.proxy.serve_forever,
            daemon=True,
        )
        self.proxy_thread.start()
        proxy_host, proxy_port = self.proxy.server_address
        self.proxy_url = f"http://{proxy_host}:{proxy_port}"

    def tearDown(self) -> None:
        self.proxy.shutdown()
        self.proxy.server_close()
        self.proxy_thread.join(timeout=5)
        self.upstream.shutdown()
        self.upstream.server_close()
        self.upstream_thread.join(timeout=5)

    def test_only_armed_submit_is_disconnected_before_forward(self) -> None:
        with urllib.request.urlopen(f"{self.proxy_url}/health", timeout=2) as response:
            self.assertEqual(response.status, 200)

        command = b"exact-command-bytes" * 20
        submit_request = b"\x0a" + _encode_varint(len(command)) + command
        self.proxy.state.arm()
        connection = http.client.HTTPConnection(
            self.proxy.server_address[0],
            self.proxy.server_address[1],
            timeout=2,
        )
        with self.assertRaises(
            (ConnectionError, http.client.HTTPException, OSError)
        ):
            connection.request(
                "POST",
                CONVERSATION_COMMAND_PATH,
                body=submit_request,
            )
            connection.getresponse()
        connection.close()

        self.assertEqual(_UpstreamHandler.bodies, [])
        evidence = self.proxy.state.snapshot()
        self.assertEqual(evidence["connectionLossCount"], 1)
        self.assertEqual(
            evidence["requestSha256"],
            [hashlib.sha256(submit_request).hexdigest()],
        )
        self.assertEqual(
            evidence["commandSha256"],
            [hashlib.sha256(command).hexdigest()],
        )

        self.proxy.state.disarm()
        request = urllib.request.Request(
            f"{self.proxy_url}{CONVERSATION_COMMAND_PATH}",
            data=submit_request,
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(_UpstreamHandler.bodies, [submit_request])

    def test_server_close_releases_listener(self) -> None:
        port = int(self.proxy.server_address[1])
        self.proxy.shutdown()
        self.proxy.server_close()
        self.proxy_thread.join(timeout=5)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            self.assertNotEqual(connection.connect_ex(("127.0.0.1", port)), 0)


if __name__ == "__main__":
    unittest.main()
