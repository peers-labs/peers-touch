from __future__ import annotations

import http.client
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tooling.acceptance.fixtures.chat_group_leave_fault_proxy import (
    CONVERSATION_GET_PATH,
    LEAVE_REJECT_START_PATH,
    _ProxyServer,
)


class _UpstreamHandler(BaseHTTPRequestHandler):
    paths: list[str] = []

    def _respond(self) -> None:
        self.paths.append(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        if length:
            self.rfile.read(length)
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _respond
    do_POST = _respond

    def log_message(self, _format: str, *_args: object) -> None:
        return


class ChatGroupLeaveFaultProxyTest(unittest.TestCase):
    def setUp(self) -> None:
        _UpstreamHandler.paths = []
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

    def test_rejection_commits_before_one_conversation_read_is_lost(self) -> None:
        self.proxy.state.arm()
        request = urllib.request.Request(
            f"{self.proxy_url}{LEAVE_REJECT_START_PATH}",
            data=b"start",
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)

        connection = http.client.HTTPConnection(
            self.proxy.server_address[0],
            self.proxy.server_address[1],
            timeout=2,
        )
        with self.assertRaises(
            (ConnectionError, http.client.HTTPException, OSError)
        ):
            connection.request("GET", CONVERSATION_GET_PATH)
            connection.getresponse()
        connection.close()

        with urllib.request.urlopen(
            f"{self.proxy_url}{CONVERSATION_GET_PATH}",
            timeout=2,
        ) as response:
            self.assertEqual(response.status, 200)

        evidence = self.proxy.state.snapshot()
        self.assertTrue(evidence["rejectionStarted"])
        self.assertEqual(evidence["connectionLossCount"], 1)
        self.assertEqual(
            _UpstreamHandler.paths,
            [LEAVE_REJECT_START_PATH, CONVERSATION_GET_PATH],
        )


if __name__ == "__main__":
    unittest.main()
