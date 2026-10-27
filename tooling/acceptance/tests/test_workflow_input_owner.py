"""Workflow reuse binds real checksum code and disposable fixture inputs."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners.workflow_toolchain import (
    COMMAND, GATE_ID, checksum_inputs, perl_delegate_inputs,
    workflow_fixture_inputs, workflow_observation,
)


ROOT = Path(__file__).resolve().parents[3]
METADATA_ENVIRONMENT = {
    "NODE_DISABLE_COMPILE_CACHE": "1",
    "npm_config_manage_package_manager_versions": "false",
}


class WorkflowInputBoundaryTest(unittest.TestCase):
    def context(self, **extra):
        return {
            "gate": {"id": GATE_ID, "command": COMMAND, **extra},
            "source": {"commit": "candidate"}, "contextDigest": "candidate",
        }

    def test_foreign_or_changed_command_rejects_before_observation(self):
        for extra in ({"id": "foreign"}, {"command": COMMAND + " --foreign"}):
            with self.subTest(extra=extra), patch.dict(
                os.environ, METADATA_ENVIRONMENT,
            ), patch(
                "tooling.acceptance.input_owners.workflow_toolchain.node_source_observation",
            ) as observe:
                with self.assertRaises(ValueError):
                    workflow_observation(self.context(**extra), root=ROOT)
                observe.assert_not_called()

    def test_product_equipment_does_not_enter_the_source_owner(self):
        for extra in (
            {"environment": "live"}, {"provisioner": "runtime"},
            {"requiredRuntimeCells": ["native"]}, {"ephemeralCapabilities": ["runtime"]},
        ):
            with self.subTest(extra=extra), patch.dict(
                os.environ, METADATA_ENVIRONMENT,
            ), self.assertRaises(ValueError):
                workflow_observation(self.context(**extra), root=ROOT)

    def test_metadata_environment_is_required(self):
        for key in METADATA_ENVIRONMENT:
            with self.subTest(key=key), patch.dict(
                os.environ, {**METADATA_ENVIRONMENT, key: ""},
            ), self.assertRaises(ValueError):
                workflow_observation(self.context(), root=ROOT)

    def test_unknown_checksum_delegate_and_configured_loader_reject(self):
        with patch(
            "tooling.acceptance.input_owners.workflow_toolchain.shutil.which",
            return_value="/tmp/foreign-shasum",
        ), patch(
            "tooling.acceptance.input_owners.workflow_toolchain.perl_delegate_inputs",
        ) as observe:
            with self.assertRaises(ValueError):
                checksum_inputs()
            observe.assert_not_called()
        for key in ("PERL5LIB", "PERLLIB", "PERL5OPT"):
            with self.subTest(key=key), patch.dict(os.environ, {key: "foreign"}):
                with self.assertRaises(ValueError):
                    checksum_inputs()


@unittest.skipUnless(sys.platform == "darwin", "reviewed macOS checksum delegate")
class WorkflowActualInputsTest(unittest.TestCase):
    def test_real_perl_delegate_binds_same_size_restored_mtime_script_drift(self):
        original = Path("/usr/bin/shasum").read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            script = Path(temporary) / "shasum"
            script.write_bytes(original + b"\n# owned fixture 1\n")
            first = perl_delegate_inputs(script)
            metadata = script.stat()
            script.write_bytes(original + b"\n# owned fixture 2\n")
            os.utime(script, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            second = perl_delegate_inputs(script)
            self.assertNotEqual(first["script"]["bytes"], second["script"]["bytes"])
            self.assertEqual(
                {name: value for name, value in first["modules"].items()
                 if value["path"] != str(script)},
                {name: value for name, value in second["modules"].items()
                 if value["path"] != str(script)},
            )
            self.assertEqual(first["images"], second["images"])
            self.assertIn("Digest/SHA.pm", first["modules"])
            self.assertTrue(first["images"])
        self.assertEqual(Path("/usr/bin/shasum").read_bytes(), original)

    def test_real_temporary_parent_mode_drift_changes_fixture_identity(self):
        with tempfile.TemporaryDirectory() as temporary, patch(
            "tooling.acceptance.input_owners.workflow_toolchain.fixture_parent",
            return_value=Path(temporary),
        ):
            parent = Path(temporary)
            parent.chmod(0o700)
            first = workflow_fixture_inputs()
            parent.chmod(0o750)
            second = workflow_fixture_inputs()
            self.assertNotEqual(
                first["temporaryParents"][temporary], second["temporaryParents"][temporary],
            )
            self.assertEqual(first["gitConfiguration"], second["gitConfiguration"])
            self.assertEqual(first["templates"], second["templates"])


if __name__ == "__main__":
    unittest.main()
