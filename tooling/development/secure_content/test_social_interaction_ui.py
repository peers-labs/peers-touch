"""Original Social UI controls must be revealed before viewport visibility."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tooling.acceptance.gates.agent.foundation_runtime_client import FoundationClientError
from tooling.development.secure_content.social_interaction_ui import SocialCommentUI


class Element:
    tag_name = "button"

    def __init__(self, identity, events, *, clipped=False, hidden=False):
        self.id = identity
        self.events = events
        self.clipped = clipped
        self.hidden = hidden
        self.expanded = False
        self.clicks = 0

    def is_displayed(self):
        self.events.append(("displayed", self.id))
        return not self.clipped and not self.hidden

    def get_attribute(self, name):
        if name == "aria-expanded":
            return str(self.expanded).lower()
        return None

    def click(self):
        self.events.append(("click", self.id))
        self.clicks += 1
        self.expanded = True


class Driver:
    session_id = "synthetic-window-session"

    def __init__(self, *, missing=False, hidden=False, repaint=False):
        self.events = []
        self.nav = Element("nav", self.events)
        self.parent = Element("parent", self.events, clipped=True, hidden=hidden)
        self.replacement = Element("replacement", self.events, clipped=True)
        self.missing, self.repaint = missing, repaint
        self.parent_reads = 0

    def find_elements(self, using, selector):
        if using != "css selector":
            raise AssertionError("UI controls require the original CSS locator")
        if 'data-pt-primary-nav="moments"' in selector:
            return [self.nav]
        if 'data-post-id="post"' in selector and "social-open-comments" in selector:
            self.parent_reads += 1
            if self.missing:
                return []
            return [self.replacement if self.repaint and self.parent_reads > 1 else self.parent]
        return []

    def execute_script(self, script, element):
        if "scrollIntoView" in script:
            self.events.append(("reveal", element.id))
            element.clipped = False
            return None
        if "getBoundingClientRect" in script:
            return not element.clipped and not element.hidden
        raise AssertionError("The original UI action must not mutate product state")


class SocialCommentViewportTest(unittest.TestCase):
    def controls(self, **options):
        directory = TemporaryDirectory(prefix="pt-social-viewport-")
        self.addCleanup(directory.cleanup)
        driver = Driver(**options)
        controls = SocialCommentUI(SimpleNamespace(driver=driver), "reader", Path(directory.name))
        self.waits = []

        def wait(predicate, description, *, timeout, **_):
            self.waits.append((description, timeout))
            for _ in range(3):
                value = predicate()
                if value:
                    return value
            raise FoundationClientError(f"timed out waiting for {description}")

        override = patch(
            "tooling.development.secure_content.social_interaction_ui.wait_until",
            side_effect=wait,
        )
        override.start()
        self.addCleanup(override.stop)
        return controls, driver

    def test_clipped_parent_is_revealed_before_visibility_and_expanded_once(self):
        controls, driver = self.controls()
        self.assertEqual(controls.open_thread("post"), controls.post_selector("post"))
        self.assertLess(
            driver.events.index(("reveal", "parent")),
            driver.events.index(("displayed", "parent")),
        )
        self.assertEqual(driver.parent.clicks, 1)
        self.assertTrue(driver.parent.expanded)
        self.assertIn(("reader private parent card", 120), self.waits)

    def test_repainted_clipped_parent_is_revealed_as_its_current_element(self):
        controls, driver = self.controls(repaint=True)
        controls.open_thread("post")
        self.assertIn(("reveal", "replacement"), driver.events)
        self.assertEqual(driver.parent.clicks, 0)
        self.assertEqual(driver.replacement.clicks, 1)

    def test_missing_or_hidden_parent_remains_a_failure_at_original_wait(self):
        for options in ({"missing": True}, {"hidden": True}):
            with self.subTest(options=options):
                controls, driver = self.controls(**options)
                with self.assertRaisesRegex(FoundationClientError, "private parent card"):
                    controls.open_thread("post")
                self.assertIn(("reader private parent card", 120), self.waits)
                self.assertEqual(driver.parent.clicks, 0)
                self.assertFalse(driver.parent.expanded)
                if options.get("hidden"):
                    self.assertTrue(driver.parent.hidden)


if __name__ == "__main__":
    unittest.main()
