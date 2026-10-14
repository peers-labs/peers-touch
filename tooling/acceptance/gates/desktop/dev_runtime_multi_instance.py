#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, REPORTS_DIR
from tooling.acceptance.drivers.tauri import (
    LocalTauriLauncher,
    TauriSession,
    find_app_binary,
)


REPORT_PATH = Path(
    os.environ.get(
        "DEV_RUNTIME_MULTI_INSTANCE_REPORT",
        str(REPORTS_DIR / "dev-runtime-multi-instance.json"),
    )
)
INSTANCE_PORTS = (4490, 4491)


class DevRuntimeMultiInstanceGate(AcceptanceGate):
    gate_id = "dev-runtime-multi-instance"
    report_path = REPORT_PATH

    def __init__(self) -> None:
        super().__init__()
        self.sessions: list[TauriSession] = []
        self.storage_roots: list[str] = []

    def launch_instance(
        self,
        label: str,
        webdriver_port: int,
        slot: int,
    ) -> tuple[TauriSession, dict[str, Any]]:
        storage_root = tempfile.mkdtemp(
            prefix=f"peers-native-multi-instance-{label}-"
        )
        self.storage_roots.append(storage_root)
        profile = f"acceptance-native-multi-{label}"
        session = TauriSession(
            LocalTauriLauncher(
                app_binary=find_app_binary(),
                port=webdriver_port,
                profile=profile,
                storage_root=storage_root,
                environment={
                    "PT_ACCEPTANCE_WINDOW_SLOT": str(slot),
                    "PT_ACCEPTANCE_WINDOW_COUNT": "2",
                },
            )
        )
        session.start()
        self.sessions.append(session)
        return session, {
            "label": label,
            "pid": session.process_id,
            "webdriver_port": webdriver_port,
            "storage_root": storage_root,
            "profile": profile,
            "title": session.get_title(),
        }

    def run(self) -> dict[str, Any]:
        binary = find_app_binary()
        self.report.runtime["binary_path"] = binary
        first_session, first = self.launch_instance(
            "a",
            INSTANCE_PORTS[0],
            0,
        )
        second_session, second = self.launch_instance(
            "b",
            INSTANCE_PORTS[1],
            1,
        )

        self.assert_condition(
            "native_processes_alive",
            first_session.launcher.is_alive()
            and second_session.launcher.is_alive(),
            "Both Native Desktop processes must remain alive",
        )
        self.assert_condition(
            "webdriver_ports_distinct",
            first["webdriver_port"] != second["webdriver_port"],
            "Embedded WebDriver ports must be distinct",
        )
        self.assert_condition(
            "pids_distinct",
            first["pid"] != second["pid"],
            "Native process identities must be distinct",
        )
        self.assert_condition(
            "storage_roots_distinct",
            first["storage_root"] != second["storage_root"],
            "Storage roots must be isolated",
        )
        self.assert_condition(
            "profiles_distinct",
            first["profile"] != second["profile"],
            "Profiles must be isolated",
        )

        return {
            "instances": {"a": first, "b": second},
            "isolation": {
                "webdriverPortsDistinct": True,
                "pidsDistinct": True,
                "storageRootsDistinct": True,
                "profilesDistinct": True,
                "concurrentNativeLiveness": True,
            },
        }

    def cleanup(self) -> None:
        errors: list[str] = []
        for session in reversed(self.sessions):
            try:
                session.stop()
            except Exception as error:
                errors.append(str(error))
        self.sessions.clear()
        for storage_root in self.storage_roots:
            shutil.rmtree(storage_root, ignore_errors=True)
        self.storage_roots.clear()
        if errors:
            raise RuntimeError("; ".join(errors))


if __name__ == "__main__":
    gate = DevRuntimeMultiInstanceGate()
    try:
        exit_code = gate.execute()
    finally:
        gate.cleanup()
    raise SystemExit(exit_code)
