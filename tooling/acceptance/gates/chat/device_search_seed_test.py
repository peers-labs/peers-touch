"""Fixture pacing checks; these do not prove native message delivery."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat import device_search_runner as runner


class DeviceSearchSeedTests(unittest.TestCase):
    def fixture(self, *, stalled=False, incomplete=False):
        gate = object.__new__(runner.DeviceSearchGate)
        gate.clients = {"alice": object(), "bob": object()}
        gate.conversation = "conversation"
        gate.query = "周会 fixture"
        gate.token = "fixture"
        gate.report = SimpleNamespace(runtime={"search": {"resources": {}}})
        committed: list[str] = []
        outstanding: list[str] = []
        batches: list[tuple[int, int]] = []
        sends = 0
        pending_reads = 0

        def harness(client, method, payload, **kwargs):
            nonlocal sends, pending_reads
            if method == "sendInteractionMessage":
                sends += 1
                message_id = f"root-{sends}"
                if payload.get("threadRootMessageId"):
                    # A committed thread reply never enters the main page.
                    return {"messageId": message_id}
                outstanding.append(message_id)
                return {"messageId": message_id}
            if method == "sendInteractionMessageBatch":
                self.assertIs(client, gate.clients["bob"])
                self.assertEqual(outstanding, [], "next batch preceded receiver commit")
                start, count = payload["startIndex"], payload["count"]
                self.assertLessEqual(count, gate.history_batch_size)
                batches.append((start, count))
                ids = [f"filler-{i}" for i in range(start, start + count)]
                outstanding.extend(ids)
                pending_reads = 0
                return {"messageIds": ids[:-1] if incomplete else ids}
            self.assertEqual(method, "messagePage")
            self.assertIs(client, gate.receiver)
            self.assertEqual(payload["limit"], 100)
            pending_reads += 1
            # Admission stays invisible until the second receiver observation.
            if pending_reads >= 2 and not (stalled and batches):
                committed.extend(outstanding)
                outstanding.clear()
            return {"messageIds": list(committed)}

        def wait(predicate, description, timeout):
            self.assertEqual(timeout, 30)
            for _ in range(3):
                if predicate():
                    return True
            raise GateError("timed out waiting for receiver commits seeded message")

        return gate, harness, wait, batches

    def run_seed(self, gate, harness, wait):
        with patch.object(runner, "async_harness", side_effect=harness), \
                patch.object(runner, "wait_until", side_effect=wait):
            gate.seed()

    def test_all_history_is_received_before_each_next_admission(self):
        gate, harness, wait, batches = self.fixture()
        self.run_seed(gate, harness, wait)
        self.assertEqual(batches, [(1, 10), (11, 10), (21, 10),
                                   (31, 10), (41, 10), (51, 5)])
        resources = gate.report.runtime["search"]["resources"]
        expected = {f"filler-{i}" for i in range(1, 56)}
        self.assertEqual(set(resources["fillerIds"]), expected)
        self.assertEqual(set(resources["receiverFillerIds"]), expected)

    def test_stalled_receiver_stops_without_more_admission_or_replay(self):
        gate, harness, wait, batches = self.fixture(stalled=True)
        with self.assertRaisesRegex(GateError, "receiver commits seeded message"):
            self.run_seed(gate, harness, wait)
        self.assertEqual(batches, [(1, 10)])
        self.assertNotIn("receiverFillerIds", gate.report.runtime["search"]["resources"])

    def test_incomplete_admission_fails_before_another_batch(self):
        gate, harness, wait, batches = self.fixture(incomplete=True)
        with self.assertRaisesRegex(GateError, "did not admit every required message"):
            self.run_seed(gate, harness, wait)
        self.assertEqual(batches, [(1, 10)])


if __name__ == "__main__":
    unittest.main()
