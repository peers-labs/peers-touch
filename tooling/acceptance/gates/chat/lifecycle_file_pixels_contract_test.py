import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import NativeWindowBounds, NativeWindowSnapshot, NativeWindowStack
from tooling.acceptance.gates.chat import lifecycle_file_pixels as pixels


class PreviewPixelContractTest(unittest.TestCase):
    def prove(self, *, filename="report.pdf", changed=False, blank=False):
        observation = {
            "filename": "report.pdf", "attachment": "file-1", "page": "1",
            "pageLabel": "Page 1 of 2",
            "rect": {"x": 20, "y": 100, "right": 380, "bottom": 280},
            # The owning modal title is above the inner detail body.
            "titleRect": {"x": 20, "y": 20, "right": 380, "bottom": 50},
            "navigationRect": {"x": 20, "y": 100, "right": 100, "bottom": 120},
            "viewport": {"width": 400, "height": 300},
        }
        reads = 0

        class Client:
            def execute_script(self, script, *_):
                nonlocal reads
                if "getAnimations" in script:
                    return True
                reads += 1
                result = copy.deepcopy(observation)
                if changed and reads > 1:
                    result["page"] = "2"
                return result

            def save_screenshot(self, path):
                image = Image.new("RGB", (800, 600), "white")
                draw = ImageDraw.Draw(image)
                draw.rectangle((40, 40, 759, 99), fill="red")
                if not blank:
                    draw.rectangle((40, 200, 759, 559), fill="blue")
                image.save(path)

        def ocr(command, **_):
            with Image.open(command[1]) as image:
                if command[1].endswith("-navigation.png"):
                    return json.dumps(["Page 1 of2"])
                if command[1].endswith("-header.png"):
                    self.assertEqual(image.size, (2160, 180))
                    self.assertEqual(image.getpixel((300, 20)), (255, 0, 0))
                    return json.dumps(["report.pdf"])
                if image.getpixel((300, 20)) == (0, 0, 255):
                    return json.dumps(["Page 1 of 2", "Visible document"])
                return "[]"

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pixels.sys, "platform", "darwin"), \
                    patch.object(pixels.shutil, "which", return_value="swiftc"), \
                    patch.object(pixels.subprocess, "run"), \
                    patch.object(pixels.subprocess, "check_output", side_effect=ocr):
                result = pixels.prove_preview_pixels(
                    Client(), "[data-chat-file-detail]", filename,
                    ["Visible document"], Path(directory) / "pixels", "page-1",
                )
            record = json.loads((Path(directory) / "pixels/page-1.json").read_text())
            self.assertEqual(record["screenshotSha256"], result["screenshotSha256"])
            for key in ("screenshot", "contentScreenshot", "headerScreenshot", "navigationScreenshot"):
                self.assertTrue(Path(record[key]).is_file())
            return result

    def test_title_pixels_and_content_are_bound_to_selected_page(self):
        self.assertEqual(self.prove()["missing"], [])

    def test_different_filename_is_rejected(self):
        with self.assertRaises(GateError):
            self.prove(filename="other.pdf")

    def test_page_changed_during_capture_is_rejected(self):
        with self.assertRaisesRegex(GateError, "changed during screenshot"):
            self.prove(changed=True)

    def test_blank_image_cannot_inherit_ready_dom_proof(self):
        with self.assertRaisesRegex(GateError, "missing"):
            self.prove(blank=True)

    def test_wide_title_strip_is_normalized_for_ocr(self):
        with tempfile.TemporaryDirectory() as directory:
            strip = Path(directory) / "wide-header.png"
            Image.new("RGB", (4200, 100), "white").save(strip)
            pixels._normalize_ocr_strip(strip)
            with Image.open(strip) as normalized:
                self.assertLessEqual(normalized.width / normalized.height, 14)
                self.assertEqual(normalized.height, 100)

    def test_balanced_title_strip_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            strip = Path(directory) / "header.png"
            Image.new("RGB", (420, 60), "white").save(strip)
            pixels._normalize_ocr_strip(strip)
            with Image.open(strip) as normalized:
                self.assertEqual(normalized.size, (420, 60))


class NativeDocumentPixelContractTest(unittest.TestCase):
    def prove(self, *, wrong_title=False, blank=False, moved=False, occluded=False):
        geometry = {
            "processId": 12, "windowId": 42,
            "x": 20, "y": 20, "width": 360, "height": 260,
            "display": {"x": 0, "y": 0, "width": 400, "height": 300},
        }
        reads = 0

        def window(_):
            nonlocal reads
            reads += 1
            value = copy.deepcopy(geometry)
            if moved and reads >= 3:
                value["windowId"] = 43
            return value

        class Adapter:
            def require_exclusive_input(self, _):
                pass

            def window_stack_at_point(self, _):
                return NativeWindowStack(
                    windows=(NativeWindowSnapshot(
                        index=0, owner_pid=99 if occluded else 12, owner_name="qlmanage",
                        window_name="", layer=0, alpha=1,
                        bounds=NativeWindowBounds(20, 20, 360, 260),
                    ),),
                )

            def post_mouse(self, *_):
                pass

            def capture_screenshot(self, path):
                image = Image.new("RGB", (800, 600), "white")
                draw = ImageDraw.Draw(image)
                draw.rectangle((40, 40, 759, 115), fill="red")
                if not blank:
                    draw.rectangle((40, 116, 759, 559), fill="blue")
                image.save(path)

        def ocr(command, **_):
            with Image.open(command[1]) as image:
                if command[1].endswith("-header.png"):
                    self.assertEqual(image.size, (1212, 228))
                    self.assertEqual(image.getpixel((300, 20)), (255, 0, 0))
                    return json.dumps(["wrong.pdf" if wrong_title else "report.pdf"])
                if image.getpixel((300, 20)) == (0, 0, 255):
                    return json.dumps(["File viewing page 1"])
                return "[]"

        def once(action, message, **_):
            value = action()
            if value is None:
                raise GateError(message)
            return value

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pixels, "process_document_window", side_effect=window), \
                    patch.object(pixels, "wait_until", side_effect=once), \
                    patch.object(pixels.sys, "platform", "darwin"), \
                    patch.object(pixels.shutil, "which", return_value="swiftc"), \
                    patch.object(pixels.subprocess, "run"), \
                    patch.object(pixels.subprocess, "check_output", side_effect=ocr):
                return pixels.prove_native_document_pixels(
                    Adapter(), 12, "report.pdf", "File viewing page 1",
                    Path(directory) / "pixels",
                )

    def test_native_filename_and_content_match_real_window_crop(self):
        self.assertTrue(self.prove()["contentMatched"])

    def test_wrong_native_title_cannot_inherit_fixture_text(self):
        with self.assertRaises(GateError):
            self.prove(wrong_title=True)

    def test_blank_native_content_cannot_inherit_window_identity(self):
        with self.assertRaises(GateError):
            self.prove(blank=True)

    def test_window_replaced_during_capture_is_rejected(self):
        with self.assertRaisesRegex(GateError, "changed during screenshot"):
            self.prove(moved=True)

    def test_other_process_occluding_title_is_rejected(self):
        with self.assertRaisesRegex(GateError, "occluded"):
            self.prove(occluded=True)


if __name__ == "__main__":
    unittest.main()
