"""Bounded owner liveness samples; never a business progress or deadline owner."""

from __future__ import annotations

import contextlib
from contextvars import ContextVar
from datetime import datetime, timezone
import json
import math
import os
import sys
import threading
import time
from typing import Any


_LOCK_OBSERVER: ContextVar[Any] = ContextVar("acceptance-lock-observer", default=None)


def current_lock_observer():
    """Capture the acquiring stage so a later release retains its real owner."""
    return _LOCK_OBSERVER.get()


@contextlib.contextmanager
def runner_operation_stream():
    """The CLI owns stderr mode for its lifetime and restores the inherited mode."""
    fd = None
    try:
        fd = sys.stderr.fileno()
        was_blocking = os.get_blocking(fd)
        os.set_blocking(fd, False)
    except (OSError, ValueError, AttributeError):
        fd = None
    try:
        yield
    finally:
        if fd is not None:
            os.set_blocking(fd, was_blocking)


class OperationObserver:
    def __init__(self, gate_id: str, *, interval_seconds: float = 1,
                 maximum_samples: int = 256) -> None:
        if (
            not isinstance(interval_seconds, (int, float)) or isinstance(interval_seconds, bool)
            or not math.isfinite(interval_seconds) or interval_seconds <= 0
            or not isinstance(maximum_samples, int) or isinstance(maximum_samples, bool)
            or maximum_samples < 2
        ):
            raise ValueError("observer requires positive interval and bounded sample capacity")
        self.gate_id = gate_id
        self.interval = interval_seconds
        self.maximum_samples = maximum_samples
        self.samples: list[dict[str, Any]] = []
        self.dropped = 0
        self.stream_dropped = 0
        self._lock = threading.Lock()
        self.active_workers = 0
        self.lock_samples: list[dict[str, Any]] = []
        self.dropped_lock_samples = 0
        self.lock_totals = {
            "acquisitions": 0, "contendedAcquisitions": 0, "failedAcquisitions": 0,
            "waitSeconds": 0.0, "holdSeconds": 0.0,
        }

    def _record_lock(self, stage: str, phase: str, value: dict[str, Any]) -> None:
        with self._lock:
            sample = {**value, "stage": stage, "phase": phase}
            if len(self.lock_samples) >= self.maximum_samples:
                self.lock_samples.pop(0)
                self.dropped_lock_samples += 1
            self.lock_samples.append(sample)
            if value["event"] == "ACQUIRED":
                self.lock_totals["acquisitions"] += 1
                self.lock_totals["contendedAcquisitions"] += int(value["attempts"] > 1)
            elif value["event"] != "RELEASED":
                self.lock_totals["failedAcquisitions"] += 1
            self.lock_totals["waitSeconds"] += value.get("waitSeconds", 0)
            self.lock_totals["holdSeconds"] += value.get("holdSeconds", 0)

    def _record(self, event: str, stage: str, phase: str, end: float, fd: int | None) -> None:
        sample = {
            "event": event, "gateId": self.gate_id, "stage": stage, "phase": phase,
            "observedAt": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
            "remainingSeconds": round(max(0, end - time.monotonic()), 6),
            "meaning": "owner-liveness; business-progress-unproven",
        }
        with self._lock:
            if len(self.samples) >= self.maximum_samples:
                self.samples.pop(0)
                self.dropped += 1
            self.samples.append(sample)
        # Observe only an actually nonblocking stream. Opening /dev/fd on macOS
        # may ignore O_NONBLOCK; readiness or the requested flags are not proof.
        if fd is not None:
            data = ("[ACCEPTANCE_OPERATION] " + json.dumps(sample, separators=(",", ":")) + "\n").encode()
            try:
                if os.write(fd, data) != len(data):
                    self.stream_dropped += 1
            except OSError:
                self.stream_dropped += 1

    @contextlib.contextmanager
    def observe(self, stage: str, phase: str, end: float):
        fd = None
        try:
            fd = os.open(f"/dev/fd/{sys.stderr.fileno()}", os.O_WRONLY | os.O_NONBLOCK)
            if os.get_blocking(fd):
                os.close(fd)
                fd = None
                self.stream_dropped += 1
        except (OSError, ValueError, AttributeError):
            self.stream_dropped += 1
        stopped = threading.Event()

        def heartbeat() -> None:
            while not stopped.wait(self.interval):
                self._record("HEARTBEAT", stage, phase, end, fd)

        worker = threading.Thread(target=heartbeat, name="acceptance-operation-observer", daemon=True)
        started = False
        token = _LOCK_OBSERVER.set(lambda value: self._record_lock(stage, phase, value))
        try:
            self._record("START", stage, phase, end, fd)
            worker.start()
            started = True
            self.active_workers += 1
            yield
        finally:
            stopped.set()
            try:
                if started:
                    worker.join(timeout=1)
                    if worker.is_alive():
                        raise RuntimeError("operation observer failed its bounded stop")
                    self.active_workers -= 1
                self._record("END", stage, phase, end, fd)
            finally:
                _LOCK_OBSERVER.reset(token)
                if fd is not None:
                    os.close(fd)

    def report(self) -> dict[str, Any]:
        with self._lock:
            return {
                "contract": "owner-liveness; business-progress-unproven",
                "intervalSeconds": self.interval, "maximumSamples": self.maximum_samples,
                "samples": list(self.samples), "droppedSamples": self.dropped,
                "droppedStreamEvents": self.stream_dropped,
                "activeWorkers": self.active_workers,
                "health": "BACKPRESSURE_OR_UNAVAILABLE" if self.stream_dropped else "HEALTHY",
                "lockObservation": {
                    "scope": "EvidenceStore locks in observed owner stages",
                    "samples": list(self.lock_samples),
                    "droppedSamples": self.dropped_lock_samples,
                    **{key: round(value, 6) if isinstance(value, float) else value
                       for key, value in self.lock_totals.items()},
                },
            }
