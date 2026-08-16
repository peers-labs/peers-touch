#!/usr/bin/env python3
"""Transparent Profile Three proxy with bounded Chat submit connection loss."""

from __future__ import annotations

import hashlib
import http.client
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from tooling.acceptance.fixtures.chat_native_reset import profile_three_environment


SUBMIT_PATH = "/messaging/command/submit"
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


def _read_varint(payload: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(payload) and shift < 64:
        byte = payload[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            return value, offset
        shift += 7
    raise ValueError("invalid protobuf varint")


def _submit_command_bytes(payload: bytes) -> bytes:
    offset = 0
    while offset < len(payload):
        tag, offset = _read_varint(payload, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if wire_type == 0:
            _, offset = _read_varint(payload, offset)
            continue
        if wire_type == 1:
            offset += 8
            continue
        if wire_type == 2:
            length, offset = _read_varint(payload, offset)
            end = offset + length
            if end > len(payload):
                raise ValueError("truncated protobuf field")
            value = payload[offset:end]
            if field_number == 1:
                return value
            offset = end
            continue
        if wire_type == 5:
            offset += 4
            continue
        raise ValueError("unsupported protobuf wire type")
    raise ValueError("submit request has no command field")


class _FaultState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.armed = False
        self.request_sha256: list[str] = []
        self.command_sha256: list[str] = []
        self.connection_loss_count = 0
        self.forwarded_count = 0

    def arm(self) -> None:
        with self.lock:
            self.armed = True
            self.request_sha256 = []
            self.command_sha256 = []
            self.connection_loss_count = 0
            self.forwarded_count = 0

    def disarm(self) -> None:
        with self.lock:
            self.armed = False

    def classify(self, path: str, body: bytes) -> bool:
        with self.lock:
            if path == SUBMIT_PATH:
                self.request_sha256.append(hashlib.sha256(body).hexdigest())
                command = _submit_command_bytes(body)
                self.command_sha256.append(hashlib.sha256(command).hexdigest())
            if self.armed and path == SUBMIT_PATH:
                self.connection_loss_count += 1
                return True
            self.forwarded_count += 1
            return False

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "targetPath": SUBMIT_PATH,
                "armed": self.armed,
                "requestSha256": list(self.request_sha256),
                "commandSha256": list(self.command_sha256),
                "connectionLossCount": self.connection_loss_count,
                "forwardedCount": self.forwarded_count,
            }


class _ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, upstream_url: str) -> None:
        parsed = urllib.parse.urlparse(upstream_url)
        if parsed.scheme != "http" or not parsed.hostname or not parsed.port:
            raise ValueError("Chat submit fault proxy requires an HTTP upstream")
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
        if self.proxy.state.classify(path, body):
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
            self.send_error(502, "Profile Three forwarding failed")
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


class ProfileThreeSubmitFaultProxy:
    """Forward to Profile Three and drop armed command-submit connections."""

    def __init__(self, station_url: str) -> None:
        profile_three_environment(station_url)
        self._server = _ProxyServer(station_url)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="chat-submit-fault-proxy",
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

    def arm_connection_loss(self) -> None:
        self._server.state.arm()

    def disarm(self) -> None:
        self._server.state.disarm()

    def evidence(self) -> dict[str, Any]:
        return self._server.state.snapshot()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
