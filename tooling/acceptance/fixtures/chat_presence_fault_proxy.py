#!/usr/bin/env python3
"""Transparent Station proxy with a bounded Presence query outage."""

from __future__ import annotations

import http.client
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
)


PRESENCE_QUERY_PATH = "/presence/query"
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class _FaultState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.armed = False
        self.intercepted_count = 0
        self.forwarded_count = 0
        self.forwarded_paths: dict[str, int] = {}

    def arm(self) -> None:
        with self.lock:
            self.armed = True
            self.intercepted_count = 0
            self.forwarded_count = 0
            self.forwarded_paths = {}

    def disarm(self) -> None:
        with self.lock:
            self.armed = False

    def should_intercept(self, path: str) -> bool:
        with self.lock:
            if self.armed and path == PRESENCE_QUERY_PATH:
                self.intercepted_count += 1
                return True
            self.forwarded_count += 1
            self.forwarded_paths[path] = (
                self.forwarded_paths.get(path, 0) + 1
            )
            return False

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "targetPath": PRESENCE_QUERY_PATH,
                "armed": self.armed,
                "interceptedCount": self.intercepted_count,
                "forwardedCount": self.forwarded_count,
                "forwardedPaths": dict(sorted(self.forwarded_paths.items())),
            }


class _ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, upstream_url: str) -> None:
        parsed = urllib.parse.urlparse(upstream_url)
        if parsed.scheme != "http" or not parsed.hostname or not parsed.port:
            raise ValueError("Chat presence fault proxy requires an HTTP upstream")
        self.upstream_host = parsed.hostname
        self.upstream_port = parsed.port
        self.state = _FaultState()
        super().__init__(("127.0.0.1", 0), _ProxyHandler)


class _ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def proxy(self) -> _ProxyServer:
        return self.server  # type: ignore[return-value]

    def _handle(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length else b""
        path = urllib.parse.urlsplit(self.path).path
        if self.proxy.state.should_intercept(path):
            response = b'{"code":503,"error":"presence authority unavailable"}'
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return

        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS
            and key.lower() not in {"host", "content-length"}
        }
        upstream = http.client.HTTPConnection(
            self.proxy.upstream_host,
            self.proxy.upstream_port,
            timeout=30,
        )
        try:
            upstream.request(
                self.command,
                self.path,
                body=body or None,
                headers=headers,
            )
            response = upstream.getresponse()
            response_body = response.read()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if (
                    key.lower() not in HOP_BY_HOP_HEADERS
                    and key.lower() != "content-length"
                ):
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response_body)
        except (OSError, http.client.HTTPException):
            self.send_error(502, "Presence proxy forwarding failed")
        finally:
            upstream.close()

    do_DELETE = _handle
    do_GET = _handle
    do_HEAD = _handle
    do_OPTIONS = _handle
    do_PATCH = _handle
    do_POST = _handle
    do_PUT = _handle

    def log_message(self, _format: str, *_args: object) -> None:
        return


class AcceptanceStationPresenceFaultProxy:
    """Forward Station traffic while failing an armed Presence query."""

    def __init__(
        self,
        station_url: str,
        deployment_environment: str | None = None,
    ) -> None:
        acceptance_station_environment(
            station_url,
            deployment_environment,
        )
        self._server = _ProxyServer(station_url)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="chat-presence-fault-proxy",
            daemon=True,
        )

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def arm_query_failure(self) -> None:
        self._server.state.arm()

    def disarm(self) -> None:
        self._server.state.disarm()

    def evidence(self) -> dict[str, Any]:
        return self._server.state.snapshot()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
