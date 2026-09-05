"""Run-local TCP proxy for deterministic Agent transport faults."""

from __future__ import annotations

import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from secrets import token_urlsafe
from urllib.parse import urlparse


class TcpFaultProxyError(RuntimeError):
    """The target URL cannot be represented by the TCP fault proxy."""


class TcpFaultProxy:
    """Transparent TCP proxy whose active connections can be cut deterministically."""

    def __init__(
        self,
        upstream_host: str,
        upstream_port: int,
        *,
        scheme: str,
    ) -> None:
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.scheme = scheme
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.listener.settimeout(0.2)
        self.port = int(self.listener.getsockname()[1])
        self._enabled = threading.Event()
        self._enabled.set()
        self._stopped = threading.Event()
        self._generation = 0
        self._connections: set[socket.socket] = set()
        self._lock = threading.Lock()
        self._started = False
        self._thread = threading.Thread(
            target=self._accept_loop,
            name="agent-stream-fault-proxy",
            daemon=True,
        )

    @classmethod
    def from_url(cls, station_url: str) -> TcpFaultProxy:
        parsed = urlparse(station_url)
        if parsed.scheme != "http":
            raise TcpFaultProxyError(
                "TCP fault proxy requires an HTTP Station URL"
            )
        if not parsed.hostname:
            raise TcpFaultProxyError("Station URL is missing a host")
        upstream_port = parsed.port or 80
        return cls(
            parsed.hostname,
            upstream_port,
            scheme=parsed.scheme,
        )

    @property
    def url(self) -> str:
        return f"{self.scheme}://127.0.0.1:{self.port}"

    @property
    def is_alive(self) -> bool:
        return self._thread.is_alive() and not self._stopped.is_set()

    def start(self) -> None:
        if self._stopped.is_set():
            raise TcpFaultProxyError("TCP fault proxy cannot restart after close")
        if self._started:
            return
        self._started = True
        self._thread.start()

    def cut(self) -> None:
        with self._lock:
            if self._stopped.is_set():
                raise TcpFaultProxyError("TCP fault proxy is closed")
            self._enabled.clear()
            self._generation += 1
            active = tuple(self._connections)
            self._connections.clear()
        self._close_connections(active)

    def restore(self) -> None:
        with self._lock:
            if self._stopped.is_set():
                raise TcpFaultProxyError("TCP fault proxy is closed")
            self._enabled.set()

    def close(self) -> None:
        with self._lock:
            if self._stopped.is_set():
                return
            self._stopped.set()
            self._enabled.set()
            self._generation += 1
            active = tuple(self._connections)
            self._connections.clear()
        try:
            self.listener.close()
        except OSError:
            pass
        self._close_connections(active)
        if self._started:
            self._thread.join(timeout=3)

    def _untrack(self, connection: socket.socket) -> None:
        with self._lock:
            self._connections.discard(connection)

    @staticmethod
    def _close_connections(connections: tuple[socket.socket, ...]) -> None:
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connection.close()
            except OSError:
                pass

    def _accept_loop(self) -> None:
        while not self._stopped.is_set():
            try:
                downstream, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with self._lock:
                enabled = (
                    not self._stopped.is_set()
                    and self._enabled.is_set()
                )
                generation = self._generation
                if enabled:
                    self._connections.add(downstream)
            if not enabled:
                downstream.close()
                continue
            try:
                upstream = socket.create_connection(
                    (self.upstream_host, self.upstream_port),
                    timeout=10,
                )
            except OSError:
                self._untrack(downstream)
                downstream.close()
                continue
            with self._lock:
                accepted = (
                    not self._stopped.is_set()
                    and self._enabled.is_set()
                    and self._generation == generation
                )
                if accepted:
                    self._connections.add(upstream)
                else:
                    self._connections.discard(downstream)
            if not accepted:
                self._close_connections((downstream, upstream))
                continue
            try:
                downstream.settimeout(None)
                upstream.settimeout(None)
            except OSError:
                self._untrack(downstream)
                self._untrack(upstream)
                self._close_connections((downstream, upstream))
                continue
            threading.Thread(
                target=self._pump,
                args=(downstream, upstream),
                daemon=True,
            ).start()
            threading.Thread(
                target=self._pump,
                args=(upstream, downstream),
                daemon=True,
            ).start()

    def _pump(self, source: socket.socket, target: socket.socket) -> None:
        try:
            while not self._stopped.is_set() and self._enabled.is_set():
                chunk = source.recv(64 * 1024)
                if not chunk:
                    break
                target.sendall(chunk)
        except OSError:
            pass
        finally:
            for connection in (source, target):
                self._untrack(connection)
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try:
                    connection.close()
                except OSError:
                    pass


class TcpFaultProxyCutController:
    """Token-bound loopback control plane that acknowledges completed cuts."""

    def __init__(self, proxy: TcpFaultProxy) -> None:
        self._proxy = proxy
        self._token = token_urlsafe(32)
        self._path = f"/cut/{self._token}"
        controller = self

        class CutHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                if self.path != controller._path:
                    self.send_error(404)
                    return
                try:
                    controller._proxy.cut()
                except TcpFaultProxyError:
                    self.send_error(409)
                    return
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), CutHandler)
        self._server.daemon_threads = True
        self.port = int(self._server.server_address[1])
        self._started = False
        self._closed = False
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="agent-stream-fault-control",
            daemon=True,
        )

    @property
    def cut_url(self) -> str:
        return f"http://127.0.0.1:{self.port}{self._path}"

    @property
    def is_alive(self) -> bool:
        return self._thread.is_alive()

    def start(self) -> None:
        if self._closed:
            raise TcpFaultProxyError(
                "TCP fault proxy cut controller cannot restart after close"
            )
        if self._started:
            return
        self._started = True
        self._thread.start()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._started:
            self._server.shutdown()
        self._server.server_close()
        if self._started:
            self._thread.join(timeout=3)
