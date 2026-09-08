from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.provisioners.windows_desktop_broker import (
    BrokerError,
    InteractiveTaskScheduler,
    ScheduledTask,
    WindowsDesktopBroker,
    _powershell_failure_detail,
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

    def test_idempotent_stop_and_unregister_end_with_explicit_success(
        self,
    ) -> None:
        runner = _RecordingRunner()
        scheduler = InteractiveTaskScheduler(
            user_id="administrator",
            runner=runner,
        )

        scheduler.stop("PeersTouch-Acceptance-run-actor-alice")
        scheduler.unregister("PeersTouch-Acceptance-run-actor-alice")

        self.assertEqual(len(runner.commands), 2)
        for command in runner.commands:
            self.assertTrue(_decode_script(command).endswith("; exit 0"))


class PowerShellCleanupTest(unittest.TestCase):
    def test_progress_only_clixml_is_not_reported_as_a_failure_detail(
        self,
    ) -> None:
        completed = subprocess.CompletedProcess(
            ("powershell.exe",),
            1,
            stdout="",
            stderr=(
                "#< CLIXML\n"
                '<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04">'
                '<Obj S="progress"><S N="Message">'
                "Preparing modules for first use."
                "</S></Obj></Objs>"
            ),
        )

        self.assertEqual(_powershell_failure_detail(completed), "exit code 1")

    def test_process_absence_closes_cleanup_despite_progress_clixml(
        self,
    ) -> None:
        completed = subprocess.CompletedProcess(
            ("powershell.exe",),
            1,
            stdout="",
            stderr=(
                "#< CLIXML\n"
                '<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04">'
                '<Obj S="progress"><S N="Message">'
                "Preparing modules for first use."
                "</S></Obj></Objs>"
            ),
        )
        with (
            patch(
                "tooling.acceptance.provisioners.windows_desktop_broker."
                "subprocess.run",
                return_value=completed,
            ),
            patch.object(
                WindowsDesktopBroker,
                "_process_alive",
                return_value=False,
            ),
        ):
            WindowsDesktopBroker._stop_process(42)

    def test_live_process_keeps_cleanup_fail_closed(self) -> None:
        completed = subprocess.CompletedProcess(
            ("powershell.exe",),
            1,
            stdout="",
            stderr=(
                "#< CLIXML\n"
                '<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04">'
                '<Obj S="progress"><S N="Message">'
                "Preparing modules for first use."
                "</S></Obj></Objs>"
            ),
        )
        with (
            patch(
                "tooling.acceptance.provisioners.windows_desktop_broker."
                "subprocess.run",
                return_value=completed,
            ),
            patch.object(
                WindowsDesktopBroker,
                "_process_alive",
                return_value=True,
            ),
            patch(
                "tooling.acceptance.provisioners.windows_desktop_broker."
                "time.monotonic",
                side_effect=(0.0, 16.0),
            ),
        ):
            with self.assertRaisesRegex(
                BrokerError,
                "process 42 remains alive; exit code 1",
            ):
                WindowsDesktopBroker._stop_process(42)


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

    def test_cleanup_releases_actors_after_lease_expiry(self) -> None:
        scheduler = _RecordingScheduler()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "runtime"
            actor_root = root / "actors" / "run-1" / "alice"
            storage_root = actor_root / "storage"
            log_path = actor_root / "desktop.log"
            storage_root.mkdir(parents=True)
            log_path.write_text("actor log", encoding="utf-8")
            broker = WindowsDesktopBroker(
                root,
                desktop_user="administrator",
                scheduler=scheduler,  # type: ignore[arg-type]
                now=lambda: 2_000.0,
            )
            broker._write_json(
                broker.lease_path,
                {
                    "artifactKind": "windows-desktop-broker-lease",
                    "runId": "run-1",
                    "desktopUser": "administrator",
                    "expiresAtEpoch": 1_000,
                    "actors": {
                        "alice": {
                            "taskName": "PeersTouch-Acceptance-run-1-actor-alice",
                            "processId": 42,
                            "webdriverPort": 4645,
                            "gatewayPort": 3230,
                            "storageRoot": str(storage_root),
                            "logPath": str(log_path),
                            "statePath": str(actor_root / "state.json"),
                            "profile": "chat-native-alice",
                        }
                    },
                },
            )

            with (
                patch.object(broker, "_stop_process"),
                patch.object(broker, "_process_alive", return_value=False),
                patch.object(broker, "_port_listening", return_value=False),
            ):
                result = broker.cleanup({"runId": "run-1", "expired": True})

            self.assertTrue(result["clean"])
            self.assertTrue(result["expired"])
            self.assertFalse(root.exists())
            self.assertIn(
                "PeersTouch-Acceptance-run-1-actor-alice",
                scheduler.unregistered,
            )
            self.assertIn(
                "PeersTouch-Acceptance-run-1-ttl-cleanup",
                scheduler.unregistered,
            )

    def test_actor_control_directory_is_scoped_by_run(self) -> None:
        scheduler = _RecordingScheduler()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "runtime"
            broker = WindowsDesktopBroker(
                root,
                desktop_user="administrator",
                scheduler=scheduler,  # type: ignore[arg-type]
                now=lambda: 1_000.0,
            )
            broker.acquire({"runId": "run-1", "expiresAtEpoch": 2_000})

            with patch.object(
                broker,
                "_wait_for_state",
                return_value={"status": "RUNNING", "processId": 42},
            ):
                broker.launch_actor(
                    {
                        "runId": "run-1",
                        "actor": "alice",
                        "executable": "C:\\runtime\\desktop.exe",
                        "storageRoot": "C:\\runtime\\storage",
                        "logPath": "C:\\runtime\\desktop.log",
                        "webdriverPort": 4645,
                        "gatewayPort": 3230,
                    }
                )

            self.assertTrue(
                (root / "actors" / "run-1" / "alice" / "launch.json").is_file()
            )
            self.assertFalse((root / "actors" / "alice").exists())

    def test_adapter_worker_binds_synced_source_before_import(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        error_boundary = worker.index("try:")
        source_binding = worker.index('sys.path.insert(0, request["sourceRoot"])')
        adapter_import = worker.index(
            "from tooling.acceptance.drivers.native.windows import"
        )
        self.assertLess(error_boundary, source_binding)
        self.assertLess(source_binding, adapter_import)

    def test_screenshot_probe_compresses_bitmap_control_payload(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        probe = worker[
            worker.index('elif operation == "probe_screenshot":'):
            worker.index('elif operation == "capture_screenshot":')
        ]

        self.assertIn('"captured": True', probe)
        self.assertIn('"byteLength": len(content)', probe)
        self.assertIn(
            "base64.b64encode(\n                zlib.compress(content)",
            probe,
        )
        self.assertIn('"contentEncoding": "zlib"', probe)
        self.assertIn(
            '"sha256": hashlib.sha256(content).hexdigest()',
            probe,
        )
        self.assertNotIn("base64.b64encode(content)", probe)

    def test_activation_observes_focus_in_the_same_worker(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        activation = worker.index("adapter.activate_process(process_id)")
        observation = worker.index(
            "adapter.focused_control(process_id).to_dict()"
        )

        self.assertLess(activation, observation)

    def test_targeted_mouse_activation_and_delivery_share_one_worker(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        targeted = worker[
            worker.index('elif operation == "post_mouse_to_process":'):
            worker.index('elif operation == "post_key":')
        ]
        activation = targeted.index("adapter.activate_process(process_id)")
        delivery = targeted.index("adapter.post_mouse(")
        observation = targeted.index(
            "adapter.focused_control(process_id).to_dict()"
        )

        self.assertLess(activation, delivery)
        self.assertLess(delivery, observation)

    def test_targeted_key_activation_and_delivery_share_one_worker(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        targeted = worker[
            worker.index('elif operation == "post_key_to_process":'):
            worker.index('elif operation == "post_key_sequence_to_process":')
        ]
        activation = targeted.index("adapter.activate_process(process_id)")
        delivery = targeted.index("adapter.post_key(")
        observation = targeted.index(
            "adapter.focused_control(process_id).to_dict()"
        )

        self.assertLess(activation, delivery)
        self.assertLess(delivery, observation)

    def test_targeted_key_sequence_uses_one_worker_and_bounded_intervals(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        targeted = worker[
            worker.index('elif operation == "post_key_sequence_to_process":'):
            worker.index('elif operation == "reveal_file_chooser_location":')
        ]
        activation = targeted.index("adapter.activate_process(process_id)")
        sequence = targeted.index("for index, key in enumerate(keys):")
        delivery = targeted.index("adapter.post_key(", sequence)
        interval = targeted.index("time.sleep(interval_seconds)", delivery)
        observation = targeted.index(
            "adapter.focused_control(process_id).to_dict()"
        )

        self.assertIn("if not keys:", targeted)
        self.assertIn(
            "if interval_seconds < 0 or interval_seconds > 1:",
            targeted,
        )
        self.assertLess(activation, sequence)
        self.assertLess(sequence, delivery)
        self.assertLess(delivery, interval)
        self.assertLess(interval, observation)

    def test_targeted_file_chooser_reveal_uses_one_worker(self) -> None:
        worker = WindowsDesktopBroker._adapter_worker_script()
        targeted = worker[
            worker.index(
                'elif operation == "reveal_file_chooser_location_to_process":'
            ):
            worker.index('elif operation == "focused_control":')
        ]
        activation = targeted.index("adapter.activate_process(process_id)")
        reveal = targeted.index("adapter.reveal_file_chooser_location()")
        observation = targeted.index(
            "adapter.focused_control(process_id).to_dict()"
        )

        self.assertLess(activation, reveal)
        self.assertLess(reveal, observation)


if __name__ == "__main__":
    unittest.main()
