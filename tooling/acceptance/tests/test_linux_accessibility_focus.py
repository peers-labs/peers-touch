"""Linux focus probes select the focused descendant over a modal ancestor."""

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from tooling.acceptance.drivers.native import NativeKey, NativeModifier
from tooling.acceptance.drivers.native.linux_x11 import LinuxX11NativeDesktopAdapter


class Node:
    def __init__(self, role, name, *, focused=False, active=False, children=()):
        self.role = role
        self.name = name
        self.focused = focused
        self.active = active
        self.children = children
        self.childCount = len(children)

    def __getitem__(self, index):
        return self.children[index]

    def get_process_id(self):
        return 123

    def getState(self):
        return SimpleNamespace(
            contains=lambda state: self.focused if state == 1 else self.active
        )

    def getRoleName(self):
        return self.role

    def queryText(self):
        raise NotImplementedError


class LinuxAccessibilityFocusTest(unittest.TestCase):
    def probe(self, application):
        desktop = Node("desktop", "", children=(application,))
        module = SimpleNamespace(
            STATE_FOCUSED=1,
            STATE_ACTIVE=2,
            Registry=SimpleNamespace(getDesktop=lambda _: desktop),
        )
        with patch.dict(sys.modules, {"pyatspi": module}):
            return LinuxX11NativeDesktopAdapter._focused_accessible(123)

    def test_focused_modal_ancestor_does_not_hide_location_entry(self):
        entry = Node("text", "Location", focused=True)
        modal = Node("dialog", "Upload", focused=True, children=(entry,))
        result = self.probe(Node("application", "", children=(modal,)))
        self.assertEqual(result["title"], "Location")
        self.assertEqual(result["kind"], "text-field")

    def test_modal_is_retained_when_no_descendant_has_focus(self):
        modal = Node("dialog", "Upload", focused=True)
        result = self.probe(Node("application", "", children=(modal,)))
        self.assertEqual(result["title"], "Upload")

    def test_active_file_chooser_wins_over_stale_webkit_focus(self):
        entry = Node("text", "Location", focused=True)
        chooser = Node("file chooser", "Select File", active=True, children=(entry,))
        modal = Node("dialog", "Upload", focused=True)
        main = Node("frame", "Peers", children=(modal,))
        for windows in ((chooser, main), (main, chooser)):
            with self.subTest(windows=windows):
                result = self.probe(Node("application", "", children=windows))
                self.assertEqual(result["title"], "Location")
                self.assertEqual(result["kind"], "text-field")

    def test_focused_text_accepts_exact_primary_selection(self):
        adapter = LinuxX11NativeDesktopAdapter.__new__(
            LinuxX11NativeDesktopAdapter
        )
        adapter._clipboard_selection_owner = Mock(return_value=41)
        adapter._read_selection = Mock(return_value=b"/tmp/brief.pdf")
        adapter.post_key = Mock()

        self.assertTrue(adapter.verify_focused_text(
            "/tmp/brief.pdf",
            timeout_seconds=0.1,
        ))
        self.assertEqual(adapter.post_key.call_args_list, [
            call(NativeKey.A, modifiers=(NativeModifier.PRIMARY,)),
        ])
        adapter._read_selection.assert_called_with("primary")

    def test_focused_text_falls_back_to_clipboard_owner_transfer(self):
        adapter = LinuxX11NativeDesktopAdapter.__new__(
            LinuxX11NativeDesktopAdapter
        )
        adapter._clipboard_selection_owner = Mock(
            side_effect=(41, 73)
        )
        adapter._read_selection = Mock(return_value=b"")
        adapter.post_key = Mock()
        adapter.read_clipboard = Mock(return_value=b"/tmp/brief.pdf")

        self.assertTrue(adapter.verify_focused_text(
            "/tmp/brief.pdf",
            timeout_seconds=0.6,
        ))
        self.assertEqual(adapter.post_key.call_args_list, [
            call(NativeKey.A, modifiers=(NativeModifier.PRIMARY,)),
            call(NativeKey.C, modifiers=(NativeModifier.PRIMARY,)),
        ])

    def test_focused_text_rejects_injected_clipboard_echo(self):
        adapter = LinuxX11NativeDesktopAdapter.__new__(
            LinuxX11NativeDesktopAdapter
        )
        adapter._clipboard_selection_owner = Mock(return_value=41)
        adapter._read_selection = Mock(return_value=b"")
        adapter.post_key = Mock()
        adapter.read_clipboard = Mock(return_value=b"/tmp/brief.pdf")

        self.assertFalse(adapter.verify_focused_text(
            "/tmp/brief.pdf",
            timeout_seconds=0.6,
        ))


if __name__ == "__main__":
    unittest.main()
