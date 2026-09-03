from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from tooling.acceptance.provisioners.windows_desktop_broker import (
    BrokerError,
    InteractiveTaskScheduler,
    ScheduledTask,
    WindowsDesktopBroker,
)


def _decode_script(command: tuple[str, ...]) -> str:
    return base64.b64decode(command[-1]).decode("utf-16le")


class _RecordingRunner:
    def __init__(self, returncode: int = 0) -> None:
        self.returncode = returncode
        self.commands: list[tuple[str, ...]] = []

    def __call__(self, command: tuple[str, ...], **_: object) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        return subprocess.CompletedProcess(
            command,
            self.returncode,
            stdout="",
            stderr="" if self.returncode == 0 else "failed",
        )


class _RecordingScheduler:
    def __init__(self) -> None:
        self.registered: list[tuple[ScheduledTask, datetime | None]] = []
        self.started: list[str] = []
        self.unregistered: list[str] = []

    def register_interactive(
        self,
        task: ScheduledTask,
        *,
        start_at: datetime | None = None,
    ) -> None:
        self.registered.append((task, start_at))

    def start(self, task_name: str) -> None:
        self.started.append(task_name)

    def stop(self, task_name: str) -> None:
        self.started = [
            current for current in self.started if current != task_name
        ]

    def unregister(self, task_name: str) -> None:
        self.unregistered.append(task_name)

    def exists(self, task_name: str) -> bool:
        return task_name not in self.unregistered


class InteractiveTaskSchedulerTest(unittest.TestCase):
    def test_registration_uses_interactive_token_without_password(self) -> None:
        runner = _RecordingRunner()
        scheduler = InteractiveTaskScheduler(
            user_id="sixwin\\administrator",
            runner=runner,
        )
        scheduler.register_interactive(
            ScheduledTask(
                name="PeersTouch-Acceptance-run-actor-alice",
                executable="python.exe",
                arguments=("worker.py", "a b"),
                user_id="sixwin\\administrator",
            )
        )

        script = _decode_script(runner.commands[0])
        self.assertIn("[Console]::OutputEncoding=$utf8", script)
        self.assertIn("-LogonType Interactive", script)
        self.assertNotIn("-LogonType InteractiveToken", script)
        self.assertIn("-RunLevel Highest", script)
        self.assertIn("Register-ScheduledTask", script)
        self.assertNotIn("Password", script)

    def test_registration_failure_is_not_silently_ignored(self) -> None:
        scheduler = InteractiveTaskScheduler(
            user_id="administrator",
            runner=_RecordingRunner(returncode=1),
        )
        with self.assertRaisesRegex(BrokerError, "register scheduled task failed"):
            scheduler.register_interactive(
                ScheduledTask(
                    name="PeersTouch-Acceptance-run-probe",
                    executable="python.exe",
                    arguments=("worker.py",),
                    user_id="administrator",
                )
            )


class WindowsDesktopBrokerLeaseTest(unittest.TestCase):
    def test_acquire_persists_ttl_and_registers_independent_cleanup(self) -> None:
        scheduler = _RecordingScheduler()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "runtime"
            broker = WindowsDesktopBroker(
                root,
                desktop_user="administrator",
                scheduler=scheduler,  # type: ignore[arg-type]
                now=lambda: 1_000.0,
            )
            result = broker.acquire(
                {
                    "runId": "run-1",
                    "expiresAtEpoch": 2_000,
                }
            )

            lease = json.loads(
                (root / "lease.json").read_text(encoding="utf-8")
            )
            self.assertEqual(lease["runId"], "run-1")
            self.assertEqual(lease["expiresAtEpoch"], 2_000)
            self.assertEqual(result["desktopUser"], "administrator")
            self.assertEqual(len(scheduler.registered), 1)
            task, trigger = scheduler.registered[0]
            self.assertIn("ttl-cleanup", task.name)
            self.assertEqual(task.user_id, "administrator")
            self.assertEqual(
                int(trigger.astimezone(timezone.utc).timestamp()),  # type: ignore[union-attr]
                2_000,
            )
            request = json.loads(
                base64.b64decode(task.arguments[-1], validate=True)
            )
            self.assertEqual(request["operation"], "cleanup")
            self.assertTrue(request["expired"])

    def test_acquire_rejects_expired_ttl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            broker = WindowsDesktopBroker(
                Path(directory),
                desktop_user="administrator",
                scheduler=_RecordingScheduler(),  # type: ignore[arg-type]
                now=lambda: 1_000.0,
            )
            with self.assertRaisesRegex(BrokerError, "expiry"):
                broker.acquire(
                    {"runId": "run-1", "expiresAtEpoch": 1_000}
                )

    def test_adapter_worker_binds_synced_source_before_import(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        error_boundary = worker.index("try:")
        source_binding = worker.index('sys.path.insert(0, request["sourceRoot"])')
        adapter_import = worker.index(
            "from tooling.acceptance.drivers.native.windows import"
        )
        self.assertLess(error_boundary, source_binding)
        self.assertLess(source_binding, adapter_import)


if __name__ == "__main__":
    unittest.main()
