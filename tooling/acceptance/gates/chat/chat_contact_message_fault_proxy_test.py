from __future__ import annotations

import http.client
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tooling.acceptance.fixtures.chat_contact_message_fault_proxy import (
    CREATE_DIRECT_PATH,
    _ProxyServer,
)


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
        if self.path == CREATE_DIRECT_PATH:
            response = b'{"conversationId":"conv-123"}'
        else:
            response = b'{"accepted":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class ContactMessageFaultProxyTest(unittest.TestCase):
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

    def test_armed_create_direct_returns_500(self) -> None:
        self.proxy.state.arm()
        connection = http.client.HTTPConnection(
            self.proxy.server_address[0],
            self.proxy.server_address[1],
            timeout=2,
        )
        connection.request("POST", CREATE_DIRECT_PATH, body=b'{"peerPtid":"ptid:bob"}')
        response = connection.getresponse()
        self.assertEqual(response.status, 500)
        response.read()
        connection.close()

        self.assertEqual(_UpstreamHandler.bodies, [])
        evidence = self.proxy.state.snapshot()
        self.assertEqual(evidence["interceptedCount"], 1)
        self.assertEqual(evidence["forwardedCount"], 0)

    def test_other_posts_forwarded_when_armed(self) -> None:
        self.proxy.state.arm()
        request = urllib.request.Request(
            f"{self.proxy_url}/messaging/conversation/list",
            data=b"",
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)

        evidence = self.proxy.state.snapshot()
        self.assertEqual(evidence["interceptedCount"], 0)
        self.assertEqual(evidence["forwardedCount"], 1)

    def test_create_direct_forwards_when_disarmed(self) -> None:
        request = urllib.request.Request(
            f"{self.proxy_url}{CREATE_DIRECT_PATH}",
            data=b'{"peerPtid":"ptid:bob"}',
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)

        self.assertEqual(len(_UpstreamHandler.bodies), 1)
        evidence = self.proxy.state.snapshot()
        self.assertEqual(evidence["interceptedCount"], 0)
        self.assertEqual(evidence["forwardedCount"], 1)


if __name__ == "__main__":
    unittest.main()
