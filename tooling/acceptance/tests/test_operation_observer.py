"""Real elapsed-time observation, cancellation and stream backpressure."""

import fcntl
import os
import time
import unittest
from unittest.mock import patch

from tooling.acceptance.core.execution_budget import ExecutionDeadline, GateExecution, GateTimeLimits
from tooling.acceptance.core.operation_observer import OperationObserver, runner_operation_stream


class OperationObserverTest(unittest.TestCase):
    def test_active_operation_emits_bounded_heartbeat_and_stops_on_cancellation(self):
        execution = GateExecution("observed", GateTimeLimits(0.1, 0.1), time.monotonic() + 0.08)
        execution.observer = OperationObserver("observed", interval_seconds=0.005, maximum_samples=8)
        original_end = execution.ends["work"]
        with self.assertRaises(ExecutionDeadline):
            execution.call("active-command", time.sleep, 1)
        execution.call("cleanup", lambda: None, phase="cleanup")
        execution.finish()
        report = execution.report()
        self.assertEqual(report["limitDisposition"], "REQUEST_PREEMPTED")
        self.assertEqual(report["attribution"], "ADMINISTRATIVE_PREEMPTION")
        self.assertEqual(execution.ends["work"], original_end)
        observation = report["operationObservation"]
        self.assertEqual(observation["activeWorkers"], 0)
        self.assertGreater(observation["droppedSamples"], 0)
        self.assertLessEqual(len(observation["samples"]), 8)
        self.assertTrue(any(item["event"] == "HEARTBEAT" for item in observation["samples"]))
        self.assertEqual(observation["samples"][-1]["event"], "END")
        time.sleep(0.02)
        self.assertEqual(execution.observer.report(), observation)

    def test_full_stderr_pipe_drops_events_without_blocking_or_changing_host_flags(self):
        read_fd, write_fd = os.pipe()
        try:
            os.set_blocking(write_fd, False)
            while True:
                try:
                    os.write(write_fd, b"x" * 4096)
                except BlockingIOError:
                    break
            os.set_blocking(write_fd, True)
            original_flags = fcntl.fcntl(write_fd, fcntl.F_GETFL)
            observer = OperationObserver("backpressure", interval_seconds=0.005)
            with patch("tooling.acceptance.core.operation_observer.sys.stderr") as stderr:
                stderr.fileno.return_value = write_fd
                started = time.monotonic()
                with runner_operation_stream():
                    self.assertFalse(os.get_blocking(write_fd))
                    with observer.observe("work", "work", started + 1):
                        time.sleep(0.02)
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertEqual(fcntl.fcntl(write_fd, fcntl.F_GETFL), original_flags)
            self.assertGreater(observer.report()["droppedStreamEvents"], 0)
            self.assertEqual(observer.report()["activeWorkers"], 0)
        finally:
            os.close(write_fd)
            os.close(read_fd)

    def test_owner_limit_and_request_preemption_remain_separate(self):
        execution = GateExecution(
            "owner", GateTimeLimits(0.1, 0.1, operations={"read": 0.02}), time.monotonic() + 1,
        )
        with self.assertRaises(ExecutionDeadline):
            execution.call("read", time.sleep, 1)
        self.assertEqual(execution.report()["limitDisposition"], "OWNER_LIMIT_EXPIRED")
        self.assertEqual(execution.report()["attribution"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
