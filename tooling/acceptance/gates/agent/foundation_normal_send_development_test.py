from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_normal_send_development import (
    NormalSendError,
    ROOT,
    evaluate_normal_send,
)


def valid_capture() -> dict[str, object]:
    operation = {
        "conversationId": "conversation-1",
        "turnId": "turn-1",
        "runState": "completed",
        "lastEventSeq": 7,
    }
    assistant = {
        "id": "message-assistant",
        "turnId": "turn-1",
        "content": "1\n2\n3",
        "loading": False,
        "error": None,
    }
    return {
        "turnId": "turn-1",
        "content": "1\n2\n3",
        "active": {
            "operation": {
                **operation,
                "runState": "streaming",
                "lastEventSeq": 3,
            },
            "assistant": {
                **assistant,
                "content": "1\n2",
                "loading": True,
            },
        },
        "completed": {
            "operation": operation,
            "assistant": assistant,
        },
        "reloaded": {
            "assistant": assistant,
        },
        "restarted": {
            "assistant": assistant,
        },
        "station": {
            "messages": [
                {
                    "messageId": "message-user",
                    "turnId": "turn-1",
                    "role": "user",
                    "status": "completed",
                    "content": "prompt",
                },
                {
                    "messageId": "message-assistant",
                    "turnId": "turn-1",
                    "role": "assistant",
                    "status": "completed",
                    "content": "1\n2\n3",
                },
            ],
        },
        "clientMessages": {
            "messages": [
                {
                    "id": "message-user",
                    "role": "user",
                    "hasToolCalls": False,
                },
                {
                    "id": "message-assistant",
                    "role": "assistant",
                    "hasToolCalls": False,
                },
            ],
        },
    }


class NormalSendDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_normal_send_replay(self) -> None:
        assertions = evaluate_normal_send(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_accepts_numeric_proto_enums(self) -> None:
        capture = valid_capture()
        capture["station"]["messages"][0]["role"] = 2
        capture["station"]["messages"][0]["status"] = 3
        capture["station"]["messages"][1]["role"] = 3
        capture["station"]["messages"][1]["status"] = 3

        assertions = evaluate_normal_send(capture)

        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_stream_content(self) -> None:
        capture = valid_capture()
        capture["active"]["assistant"]["content"] = ""

        with self.assertRaisesRegex(NormalSendError, "nonEmptySequencedStream"):
            evaluate_normal_send(capture)

    def test_rejects_duplicate_authoritative_terminal(self) -> None:
        capture = valid_capture()
        duplicate = copy.deepcopy(capture["station"]["messages"][1])
        duplicate["messageId"] = "message-assistant-duplicate"
        capture["station"]["messages"].append(duplicate)

        with self.assertRaisesRegex(
            NormalSendError,
            "singleAuthoritativeTerminal",
        ):
            evaluate_normal_send(capture)

    def test_rejects_completed_user_message_as_terminal(self) -> None:
        capture = valid_capture()
        capture["station"]["messages"][1]["role"] = "user"

        with self.assertRaisesRegex(
            NormalSendError,
            "singleAuthoritativeTerminal",
        ):
            evaluate_normal_send(capture)

    def test_rejects_failed_station_terminal(self) -> None:
        capture = valid_capture()
        capture["station"]["messages"][1]["status"] = "failed"

        with self.assertRaisesRegex(
            NormalSendError,
            "singleAuthoritativeTerminal",
        ):
            evaluate_normal_send(capture)

    def test_rejects_stream_prefix_drift(self) -> None:
        capture = valid_capture()
        capture["active"]["assistant"]["content"] = "different"

        with self.assertRaisesRegex(
            NormalSendError,
            "streamPrefixPreserved",
        ):
            evaluate_normal_send(capture)

    def test_rejects_restart_projection_drift(self) -> None:
        capture = valid_capture()
        capture["restarted"]["assistant"]["content"] = "different"

        with self.assertRaisesRegex(
            NormalSendError,
            "clientRestartReplayMatches",
        ):
            evaluate_normal_send(capture)

    def test_cleanup_uses_only_native_desktop_stop(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "foundation_normal_send_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn('"desktop", "stop"', source)
        self.assertNotIn('"--mode"', source)


if __name__ == "__main__":
    unittest.main()
