from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REMOTE_CONTROL_PATH = (
    Path(__file__).resolve().parents[1]
    / "images/desktop-linux/remote_control.py"
)
SPEC = importlib.util.spec_from_file_location(
    "desktop_linux_remote_control",
    REMOTE_CONTROL_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {REMOTE_CONTROL_PATH}")
remote_control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(remote_control)


class NativeDesktopLinuxActorTest(unittest.TestCase):
    def test_selects_exact_debug_process_window(self) -> None:
        self.assertEqual(
            remote_control._select_actor_window_process(
                "  92   92\n",
                "0x01  0 92 runtime Peers\n",
                92,
            ),
            92,
        )

    def test_selects_packaged_child_window_from_process_group(self) -> None:
        self.assertEqual(
            remote_control._select_actor_window_process(
                "  92   92\n  93   92\n 120  120\n",
                (
                    "0x01  0 120 runtime Other\n"
                    "0x02  0 93 runtime Peers\n"
                ),
                92,
            ),
            93,
        )

    def test_rejects_window_outside_actor_process_group(self) -> None:
        self.assertEqual(
            remote_control._select_actor_window_process(
                "  92   92\n 120  120\n",
                "0x01  0 120 runtime Other\n",
                92,
            ),
            0,
        )

    def test_cleanup_terminates_group_leader_not_window_child(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run_root = Path(temporary)
            actor_root = run_root / "actors/alice"
            actor_root.mkdir(parents=True)
            (actor_root / "app.log").write_text("started\n", encoding="utf-8")
            completed = [
                mock.Mock(returncode=0),
                mock.Mock(returncode=1),
            ]
            with mock.patch.object(
                remote_control.subprocess,
                "run",
                side_effect=completed,
            ) as run:
                result = remote_control._stop_actor_record(
                    "desktop-linux",
                    run_root,
                    {
                        "actor": "alice",
                        "processId": 93,
                        "processGroupId": 92,
                    },
                )

        self.assertIn("kill -TERM -- -92", run.call_args_list[0].args[0][-1])
        self.assertIn("kill -0 -- -92", run.call_args_list[1].args[0][-1])
        self.assertEqual(result["processId"], 93)
        self.assertEqual(result["processGroupId"], 92)


if __name__ == "__main__":
    unittest.main()
