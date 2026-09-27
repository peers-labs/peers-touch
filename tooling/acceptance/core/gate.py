from __future__ import annotations

import sys
import time
import traceback
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional

from .drivers.base import BaseDriver, DomDriver
from .errors import GateError
from .evidence import EvidenceReport, new_report
from .harness import call_async_harness


class AcceptanceGate(ABC):
    gate_id: str = ""
    phase: str = ""
    bom: tuple[str, ...] = ()
    spec: tuple[str, ...] = ()
    report_path: Optional[Path] = None
    evidence_dir: Optional[Path] = None

    def __init__(self) -> None:
        if not self.gate_id:
            raise GateError(f"Gate subclass {type(self).__name__} must define gate_id")
        self.report: EvidenceReport = new_report(
            self.gate_id,
            phase=self.phase or None,
            bom=self.bom,
            spec=self.spec,
        )
        self._start_time: float = 0.0
        self._drivers: list[BaseDriver] = []

    def register_driver(self, driver: BaseDriver) -> BaseDriver:
        self._drivers.append(driver)
        return driver

    def _cleanup_drivers(self) -> list[str]:
        failures: list[str] = []
        for driver in reversed(self._drivers):
            try:
                driver.stop()
            except Exception as error:
                failures.append(f"{type(driver).__name__}: {error}")
        self._drivers.clear()
        return failures

    def save_app_log(self, driver: BaseDriver, name: str) -> Any:
        log_path = getattr(driver, "log_path", None)
        if log_path:
            path = Path(log_path)
            if path.exists():
                return self.report.add_evidence_file(
                    f"{name}-app-log",
                    path,
                    destination_dir=self.evidence_dir,
                )
        return ""

    def save_screenshot(self, driver: DomDriver, name: str) -> Any:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            driver.save_screenshot(str(tmp_path))
            return self.report.add_evidence_file(
                f"{name}-screenshot",
                tmp_path,
                destination_dir=self.evidence_dir,
            )
        finally:
            tmp_path.unlink(missing_ok=True)

    def save_dom(self, driver: DomDriver, name: str) -> Any:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as tmp:
            tmp.write(driver.get_page_source())
            tmp_path = Path(tmp.name)
        try:
            return self.report.add_evidence_file(
                f"{name}-dom",
                tmp_path,
                destination_dir=self.evidence_dir,
            )
        finally:
            tmp_path.unlink(missing_ok=True)

    def harness(self, driver: DomDriver, method: str, payload: dict[str, Any] | None = None,
                namespace: str | None = None, timeout: float = 45.0) -> Any:
        return call_async_harness(
            driver,
            method,
            payload,
            namespace=namespace,
            script_timeout=timeout,
        )

    def assert_condition(self, name: str, condition: bool, detail: str | None = None) -> None:
        if not condition:
            self.report.add_assertion(name, False, detail)
            raise GateError(f"assertion failed: {name}" + (f" — {detail}" if detail else ""))
        self.report.add_assertion(name, True, detail)

    @abstractmethod
    def run(self) -> dict[str, Any]:
        ...

    def execute(self) -> int:
        self._start_time = time.time()
        if self.evidence_dir is not None:
            self.evidence_dir.mkdir(parents=True, exist_ok=True)
        result: dict[str, Any] = {}
        caught_error: Exception | None = None
        try:
            result = self.run()
            runtime_binding = getattr(self, "runtime_binding", None)
            if runtime_binding is not None:
                self.report.runtime["clientBindingProofs"] = (
                    runtime_binding.binding_proof_evidence()
                )
            self.report.status = "PASS"
            if isinstance(result, dict):
                self.report.runtime.update({k: v for k, v in result.items()
                                             if k not in ("gate", "status", "evidence", "error", "assertions")})
                if "evidence" in result and isinstance(result["evidence"], dict):
                    for k, v in result["evidence"].items():
                        if v:
                            self.report.evidence[k] = v
        except Exception as error:
            caught_error = error
            self.report.status = "FAIL"
            self.report.error = str(error)
            self.report.error_type = type(error).__name__
            runtime_binding = getattr(self, "runtime_binding", None)
            if runtime_binding is not None:
                self.report.runtime["clientBindingProofs"] = {
                    "proofRefs": list(runtime_binding.proof_refs()),
                    "closure": "UNPROVEN",
                }
        cleanup_failures = self._cleanup_drivers()
        if cleanup_failures:
            detail = "; ".join(cleanup_failures)
            self.report.add_assertion("driver_cleanup", False, detail)
            if caught_error is None:
                caught_error = GateError(f"driver cleanup failed: {detail}")
                self.report.status = "FAIL"
                self.report.error = str(caught_error)
                self.report.error_type = type(caught_error).__name__

        self.report.duration_ms = int((time.time() - self._start_time) * 1000)
        try:
            self.report_path = self.report.write(self.report_path)
        except Exception as report_error:
            self._print_fail(report_error)
            return 1

        if caught_error is not None:
            self._print_fail(caught_error)
            return 1
        self._print_pass(result)
        return 0

    def _print_pass(self, result: Any) -> None:
        print(f"PASS: {self.gate_id}")

    def _print_fail(self, error: Exception) -> None:
        traceback.print_exception(type(error), error, error.__traceback__, file=sys.stderr)
        print(f"FAIL: {self.gate_id}: {error}", file=sys.stderr)
