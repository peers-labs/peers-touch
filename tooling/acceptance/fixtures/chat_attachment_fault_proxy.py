#!/usr/bin/env python3
"""Transparent proxy with one-shot Conversation attachment transport loss."""

from __future__ import annotations

import http.client
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
)


ATTACHMENT_UPLOAD_BEGIN_PATH = "/conversation/attachments/uploads:begin"
ATTACHMENT_DOWNLOAD_PREFIX = "/conversation/attachments/objects/"
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
        self.upload_losses_remaining = 0
        self.download_losses_remaining = 0
        self.upload_connection_loss_count = 0
        self.download_connection_loss_count = 0
        self.forwarded_paths: dict[str, int] = {}

    def arm_upload_connection_loss_once(self) -> None:
        with self.lock:
            self.upload_losses_remaining = 1
            self.upload_connection_loss_count = 0

    def arm_download_connection_loss_once(self) -> None:
        with self.lock:
            self.download_losses_remaining = 1
            self.download_connection_loss_count = 0

    def classify(self, path: str) -> str:
        with self.lock:
            if (
                path == ATTACHMENT_UPLOAD_BEGIN_PATH
                and self.upload_losses_remaining > 0
            ):
                self.upload_losses_remaining -= 1
                self.upload_connection_loss_count += 1
                return "drop"
            if (
                path.startswith(ATTACHMENT_DOWNLOAD_PREFIX)
                and self.download_losses_remaining > 0
            ):
                self.download_losses_remaining -= 1
                self.download_connection_loss_count += 1
                return "drop"
            self.forwarded_paths[path] = self.forwarded_paths.get(path, 0) + 1
            return "forward"

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "uploadTargetPath": ATTACHMENT_UPLOAD_BEGIN_PATH,
                "downloadTargetPrefix": ATTACHMENT_DOWNLOAD_PREFIX,
                "uploadConnectionLossCount": self.upload_connection_loss_count,
                "downloadConnectionLossCount": self.download_connection_loss_count,
                "uploadLossesRemaining": self.upload_losses_remaining,
                "downloadLossesRemaining": self.download_losses_remaining,
                "forwardedPaths": dict(sorted(self.forwarded_paths.items())),
            }


class _ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, upstream_url: str) -> None:
        parsed = urllib.parse.urlparse(upstream_url)
        if parsed.scheme != "http" or not parsed.hostname or not parsed.port:
            raise ValueError(
                "Chat attachment fault proxy requires an HTTP upstream"
            )
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
        if self.proxy.state.classify(path) == "drop":
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
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
            self.send_error(502, "Acceptance Station forwarding failed")
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


class AcceptanceStationAttachmentFaultProxy:
    """Drop one upload/download request and forward the remaining traffic."""

    def __init__(self, station_url: str) -> None:
        acceptance_station_environment(station_url)
        self._server = _ProxyServer(station_url)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="chat-attachment-fault-proxy",
            daemon=True,
        )

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def start(self) -> None:
        self._thread.start()

    def arm_upload_connection_loss_once(self) -> None:
        self._server.state.arm_upload_connection_loss_once()

    def arm_download_connection_loss_once(self) -> None:
        self._server.state.arm_download_connection_loss_once()

    def evidence(self) -> dict[str, Any]:
        return self._server.state.snapshot()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
