#!/usr/bin/env python3
"""Transparent Station proxy for the X3 catalog transport negative controls."""

from __future__ import annotations

import hashlib
import http.client
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


CATALOG_PATH = "/sub-agent/agent/package-catalog/official"
CATALOG_ACTIONS = ("pass", "tamper", "missing", "pass")
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


def _tamper_envelope_json(payload: bytes) -> bytes:
    mutated = bytearray(payload)
    offset = 0
    while offset < len(mutated):
        tag, offset = _read_varint(mutated, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if wire_type == 0:
            _, offset = _read_varint(mutated, offset)
            continue
        if wire_type == 1:
            offset += 8
            continue
        if wire_type == 2:
            length, value_offset = _read_varint(mutated, offset)
            value_end = value_offset + length
            if value_end > len(mutated):
                raise ValueError("truncated protobuf field")
            if field_number == 1:
                if length == 0:
                    raise ValueError("catalog envelope is empty")
                mutated[value_offset] ^= 0x01
                return bytes(mutated)
            offset = value_end
            continue
        if wire_type == 5:
            offset += 4
            continue
        raise ValueError("unsupported protobuf wire type")
    raise ValueError("catalog response has no envelope_json field")


class _FaultState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.catalog_request_count = 0
        self.actions: list[str] = []
        self.response_sha256: list[str] = []

    def next_action(self, path: str) -> str:
        if path != CATALOG_PATH:
            return "pass"
        with self.lock:
            index = self.catalog_request_count
            self.catalog_request_count += 1
            action = CATALOG_ACTIONS[index] if index < len(CATALOG_ACTIONS) else "pass"
            self.actions.append(action)
            return action

    def record_response(self, payload: bytes) -> None:
        with self.lock:
            self.response_sha256.append(hashlib.sha256(payload).hexdigest())

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "targetPath": CATALOG_PATH,
                "requestCount": self.catalog_request_count,
                "actions": list(self.actions),
                "responseSha256": list(self.response_sha256),
            }


class _ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, upstream_url: str) -> None:
        parsed = urllib.parse.urlparse(upstream_url)
        if parsed.scheme != "http" or not parsed.hostname or not parsed.port:
            raise ValueError("Marketplace catalog fault proxy requires an HTTP upstream")
        self.upstream_host = parsed.hostname
        self.upstream_port = parsed.port
        self.upstream_prefix = parsed.path.rstrip("/")
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
        split = urllib.parse.urlsplit(self.path)
        path = split.path
        action = self.proxy.state.next_action(path)
        if action == "missing":
            response_body = b'{"error":"not found"}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response_body)
            return

        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS
            and key.lower() not in {"host", "content-length"}
        }
        upstream_path = f"{self.proxy.upstream_prefix}{self.path}"
        upstream = http.client.HTTPConnection(
            self.proxy.upstream_host,
            self.proxy.upstream_port,
            timeout=30,
        )
        try:
            upstream.request(
                self.command,
                upstream_path,
                body=body or None,
                headers=headers,
            )
            response = upstream.getresponse()
            response_body = response.read()
            if action == "tamper" and response.status == 200:
                response_body = _tamper_envelope_json(response_body)
            if path == CATALOG_PATH and response.status == 200:
                self.proxy.state.record_response(response_body)
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
        except (OSError, http.client.HTTPException, ValueError):
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
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


class AgentMarketplaceCatalogFaultProxy:
    """Forward Station traffic and inject catalog-only negative responses."""

    def __init__(self, station_url: str) -> None:
        self._server = _ProxyServer(station_url.rstrip("/"))
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="agent-marketplace-catalog-fault-proxy",
            daemon=True,
        )

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def start(self) -> None:
        self._thread.start()

    def evidence(self) -> dict[str, Any]:
        return self._server.state.snapshot()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
