"""Deadline-aware bounded reads for urllib HTTP responses."""

from __future__ import annotations

import socket
import time
from collections import deque
from typing import Protocol


DEFAULT_HTTP_READ_CHUNK_BYTES = 64 * 1024
DEFAULT_HTTP_CANCELLATION_POLL_SECONDS = 0.05


class HttpResponseBodyTooLarge(RuntimeError):
    pass


class HttpResponseDeadlineExceeded(TimeoutError):
    pass


class HttpResponseCancelled(TimeoutError):
    pass


class HttpResponseDeadlineUnsupported(RuntimeError):
    pass


class HttpResponseReader(Protocol):
    def read1(self, size: int = -1) -> bytes:
        ...


class CancellationSignal(Protocol):
    def is_set(self) -> bool:
        ...


def read_bounded_http_response(
    response: HttpResponseReader,
    *,
    max_bytes: int,
    deadline_monotonic: float,
    chunk_bytes: int = DEFAULT_HTTP_READ_CHUNK_BYTES,
    cancellation: CancellationSignal | None = None,
) -> bytes:
    if (
        not isinstance(max_bytes, int)
        or isinstance(max_bytes, bool)
        or max_bytes <= 0
    ):
        raise ValueError("HTTP response byte limit must be positive")
    if chunk_bytes <= 0:
        raise ValueError("HTTP response chunk size must be positive")

    chunks = bytearray()
    reader = _resolve_incremental_reader(response)
    while True:
        if cancellation is not None and cancellation.is_set():
            raise HttpResponseCancelled("HTTP response read was cancelled")
        if _response_is_complete(response):
            return bytes(chunks)
        remaining_seconds = deadline_monotonic - time.monotonic()
        if remaining_seconds <= 0:
            raise HttpResponseDeadlineExceeded(
                "HTTP response exceeded its total deadline"
            )
        socket_timeout = remaining_seconds
        if cancellation is not None:
            socket_timeout = min(
                socket_timeout,
                DEFAULT_HTTP_CANCELLATION_POLL_SECONDS,
            )
        _set_response_timeout(response, socket_timeout)

        remaining_probe_bytes = max_bytes + 1 - len(chunks)
        try:
            chunk = reader.read1(
                min(chunk_bytes, remaining_probe_bytes)
            )
        except (TimeoutError, socket.timeout) as error:
            if cancellation is not None and cancellation.is_set():
                raise HttpResponseCancelled(
                    "HTTP response read was cancelled"
                ) from error
            if time.monotonic() < deadline_monotonic:
                continue
            raise HttpResponseDeadlineExceeded(
                "HTTP response exceeded its total deadline"
            ) from error
        if cancellation is not None and cancellation.is_set():
            raise HttpResponseCancelled("HTTP response read was cancelled")
        if time.monotonic() > deadline_monotonic:
            raise HttpResponseDeadlineExceeded(
                "HTTP response exceeded its total deadline"
            )
        if not isinstance(chunk, bytes):
            raise TypeError("HTTP response reader returned non-bytes data")
        if not chunk:
            return bytes(chunks)

        chunks.extend(chunk)
        if len(chunks) > max_bytes:
            raise HttpResponseBodyTooLarge(
                "HTTP response exceeded its byte limit"
            )


def _set_response_timeout(
    response: HttpResponseReader,
    timeout_seconds: float,
) -> None:
    pending: deque[object] = deque((response,))
    visited: set[int] = set()
    while pending:
        candidate = pending.popleft()
        identity = id(candidate)
        if identity in visited:
            continue
        visited.add(identity)

        setter = getattr(candidate, "settimeout", None)
        if callable(setter):
            setter(timeout_seconds)
            return

        for attribute in ("fp", "raw", "_sock"):
            nested = getattr(candidate, attribute, None)
            if nested is not None:
                pending.append(nested)

    raise HttpResponseDeadlineUnsupported(
        "HTTP response does not expose a deadline-controllable socket"
    )


def _resolve_incremental_reader(
    response: HttpResponseReader,
) -> HttpResponseReader:
    pending: deque[object] = deque((response,))
    visited: set[int] = set()
    while pending:
        candidate = pending.popleft()
        identity = id(candidate)
        if identity in visited:
            continue
        visited.add(identity)

        if callable(getattr(candidate, "read1", None)):
            return candidate  # type: ignore[return-value]

        nested = getattr(candidate, "fp", None)
        if nested is not None:
            pending.append(nested)

    raise HttpResponseDeadlineUnsupported(
        "HTTP response does not expose an incremental body reader"
    )


def _response_is_complete(response: HttpResponseReader) -> bool:
    is_closed = getattr(response, "isclosed", None)
    if callable(is_closed) and is_closed():
        return True
    return getattr(response, "length", None) == 0
