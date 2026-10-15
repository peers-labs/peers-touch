from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native.base import NativeControlSnapshot
from tooling.acceptance.gates.desktop.profile_notifications_journey import (
    NOTIFICATION_TRIGGER_SELECTOR,
    _resume_receiver_notification_preview,
    focus_native_session,
)


class ProfileNotificationsJourneyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.receiver = Mock()
        self.sender = Mock()
        self.binding = Mock()

    def test_receiver_preview_is_reopened_after_sender_window_closed_it(
        self,
    ) -> None:
        self.receiver.find_element.return_value.get_attribute.return_value = (
            "false"
        )
        native_input = {"events": [{"type": "click", "trusted": True}]}

        with patch(
            "tooling.acceptance.gates.desktop.profile_notifications_journey."
            "open_notification_preview",
            return_value=native_input,
        ) as open_preview:
            result = _resume_receiver_notification_preview(
                self.receiver,
                self.sender,
                self.binding,
            )

        self.sender.find_element.assert_called_once_with(
            NOTIFICATION_TRIGGER_SELECTOR
        )
        self.sender.find_element.return_value.click.assert_called_once_with()
        self.binding.request_cooperative_activation.assert_called_once_with(
            self.receiver,
            (self.receiver, self.sender),
        )
        self.receiver.find_element.assert_called_once_with(
            NOTIFICATION_TRIGGER_SELECTOR,
            30,
        )
        open_preview.assert_called_once_with(
            self.receiver,
            self.binding,
            (self.receiver, self.sender),
        )
        self.assertEqual(
            result,
            {"reopened": True, "nativeInput": native_input},
        )

    def test_receiver_preview_is_not_toggled_when_it_remained_open(
        self,
    ) -> None:
        self.receiver.find_element.return_value.get_attribute.return_value = (
            "true"
        )

        with patch(
            "tooling.acceptance.gates.desktop.profile_notifications_journey."
            "open_notification_preview",
        ) as open_preview:
            result = _resume_receiver_notification_preview(
                self.receiver,
                self.sender,
                self.binding,
            )

        open_preview.assert_not_called()
        self.assertEqual(result, {"reopened": False})

    def test_native_focus_uses_exact_process_snapshot_not_dom_focus(
        self,
    ) -> None:
        self.receiver.process_id = 712
        self.binding.request_cooperative_activation.return_value = True
        self.binding.native_adapter.focused_control.return_value = (
            NativeControlSnapshot(
                window_count=1,
                frontmost=True,
                actual_frontmost_pid=712,
            )
        )

        result = focus_native_session(
            self.receiver,
            self.binding,
            (self.receiver, self.sender),
        )

        self.binding.request_cooperative_activation.assert_called_once_with(
            self.receiver,
            (self.receiver, self.sender),
        )
        self.binding.native_adapter.focused_control.assert_called_once_with(
            712
        )
        self.receiver.execute_script.assert_not_called()
        self.assertEqual(result["actualFrontmostPid"], 712)

    def test_native_focus_rejects_mismatched_frontmost_process(self) -> None:
        self.receiver.process_id = 712
        self.binding.request_cooperative_activation.return_value = True
        self.binding.native_adapter.focused_control.return_value = (
            NativeControlSnapshot(
                window_count=1,
                frontmost=False,
                actual_frontmost_pid=713,
            )
        )

        with self.assertRaisesRegex(
            GateError,
            "Native focus did not converge for exact process 712",
        ):
            focus_native_session(
                self.receiver,
                self.binding,
                (self.receiver, self.sender),
            )


if __name__ == "__main__":
    unittest.main()
