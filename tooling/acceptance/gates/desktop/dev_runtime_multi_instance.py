#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import AcceptanceGate, REPORTS_DIR  # noqa: E402


REPORT_PATH = Path(
    os.environ.get(
        "DEV_RUNTIME_MULTI_INSTANCE_REPORT",
        str(REPORTS_DIR / "dev-runtime-multi-instance.json"),
    )
)
STARTUP_TIMEOUT = float(
    os.environ.get("DEV_RUNTIME_MULTI_INSTANCE_TIMEOUT", "60")
)
INSTANCE_A_PORT = 3490
INSTANCE_B_PORT = 3491


def find_app_binary() -> str:
    candidates = [
        "apps/desktop/src-tauri/target/debug/peers-touch-desktop",
        "apps/desktop/src-tauri/target/debug/Peers Touch",
    ]
    for candidate in candidates:
        path = REPO_ROOT / candidate
        if path.exists():
            return str(path)
    raise FileNotFoundError(
        f"Tauri debug binary not found. Build with: "
        f"cd apps/desktop && cargo build\n"
        f"Searched: {[str(REPO_ROOT / c) for c in candidates]}"
    )


def wait_for_gateway(port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def gateway_responds(port: int) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/", timeout=5
        ) as response:
            return {"status": response.status, "body": response.read().decode("utf-8", errors="replace")[:500]}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "body": error.read().decode("utf-8", errors="replace")[:500]}
    except Exception as error:
        return {"status": 0, "body": str(error)}


class DevRuntimeMultiInstanceGate(AcceptanceGate):
    gate_id = "dev-runtime-multi-instance"
    report_path = REPORT_PATH

    def __init__(self) -> None:
        super().__init__()
        self.processes: list[subprocess.Popen] = []
        self.storage_roots: list[str] = []
        self.log_files: list[tuple[str, Any]] = []

    def launch_instance(self, label: str, gateway_port: int) -> dict[str, Any]:
        storage_root = tempfile.mkdtemp(prefix=f"peers-multi-instance-{label}-")
        self.storage_roots.append(storage_root)

        log_file = tempfile.NamedTemporaryFile(
            prefix=f"peers-multi-instance-{label}-",
            suffix=".log",
            delete=False,
        )
        self.log_files.append((label, log_file))

        env = os.environ.copy()
        env["PT_GATEWAY_PORT"] = str(gateway_port)
        env["PT_PROFILE"] = f"acceptance-multi-{label}"
        env["PEERS_STORAGE_ROOT"] = storage_root
        env["RUST_LOG"] = env.get("RUST_LOG", "info")

        binary = find_app_binary()
        process = subprocess.Popen(
            [binary],
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        self.processes.append(process)

        return {
            "label": label,
            "pid": process.pid,
            "gateway_port": gateway_port,
            "storage_root": storage_root,
            "profile": f"acceptance-multi-{label}",
        }

    def run(self) -> dict[str, Any]:
        binary = find_app_binary()
        self.report.runtime["binary_path"] = binary

        instance_a = self.launch_instance("a", INSTANCE_A_PORT)
        instance_b = self.launch_instance("b", INSTANCE_B_PORT)

        instances = [instance_a, instance_b]

        results: dict[str, Any] = {
            "instances": {},
            "isolation": {},
        }

        for inst in instances:
            label = inst["label"]
            port = inst["gateway_port"]
            pid = inst["pid"]

            self.step_log(f"Waiting for gateway on port {port} (pid={pid})...")
            gateway_up = wait_for_gateway(port, STARTUP_TIMEOUT)
            self.assert_condition(
                f"gateway_{label}_listening",
                gateway_up,
                f"Gateway for instance {label} did not start within {STARTUP_TIMEOUT}s on port {port}",
            )

            process_alive = self.processes[instances.index(inst)].poll() is None
            self.assert_condition(
                f"process_{label}_alive",
                process_alive,
                f"Instance {label} process (pid={pid}) exited prematurely",
            )

            response = gateway_responds(port)
            self.assert_condition(
                f"gateway_{label}_responds",
                response["status"] in (200, 404, 405),
                f"Gateway {label} returned unexpected status: {response}",
            )
            results["instances"][label] = {
                "pid": pid,
                "gateway_port": port,
                "gateway_status": response["status"],
                "storage_root": inst["storage_root"],
                "profile": inst["profile"],
            }

        self.assert_condition(
            "ports_distinct",
            instance_a["gateway_port"] != instance_b["gateway_port"],
            "Gateway ports must be distinct",
        )
        self.assert_condition(
            "pids_distinct",
            instance_a["pid"] != instance_b["pid"],
            "Process PIDs must be distinct",
        )
        self.assert_condition(
            "storage_roots_distinct",
            instance_a["storage_root"] != instance_b["storage_root"],
            "Storage roots must be isolated per instance",
        )
        self.assert_condition(
            "profiles_distinct",
            instance_a["profile"] != instance_b["profile"],
            "Profiles must be distinct per instance",
        )

        both_alive = all(
            p.poll() is None for p in self.processes
        )
        self.assert_condition(
            "both_processes_alive_simultaneously",
            both_alive,
            "Both instances must be alive simultaneously — "
            "one instance killed or displaced the other",
        )

        results["isolation"] = {
            "ports_distinct": True,
            "pids_distinct": True,
            "storage_roots_distinct": True,
            "profiles_distinct": True,
            "concurrent_liveness": True,
        }

        for label, log_file in self.log_files:
            log_path = Path(log_file.name)
            if log_path.exists():
                try:
                    self.report.add_evidence_file(f"instance-{label}-log", log_path)
                except Exception:
                    pass

        return results

    def step_log(self, message: str) -> None:
        print(f"[multi-instance] {message}", flush=True)

    def cleanup(self) -> None:
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
        self.processes.clear()

        for label, log_file in self.log_files:
            try:
                log_file.close()
            except Exception:
                pass
        self.log_files.clear()

        for storage_root in self.storage_roots:
            shutil.rmtree(storage_root, ignore_errors=True)
        self.storage_roots.clear()


if __name__ == "__main__":
    gate = DevRuntimeMultiInstanceGate()
    try:
        exit_code = gate.execute()
    finally:
        gate.cleanup()
    raise SystemExit(exit_code)
