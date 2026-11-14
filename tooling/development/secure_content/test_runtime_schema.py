"""Private Suite schema preparation retains explicit physical target identity."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.tests.synthetic_git import synthetic_git_environment
from tooling.development.secure_content import runtime_schema


class PrivateSocialRuntimeSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        # The host's Git wrapper writes .git/ai asynchronously, including after
        # read-only status. Reuse the existing concrete Git fixture environment.
        self.enterContext(mock.patch.dict(os.environ, synthetic_git_environment(), clear=True))
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        self.commit = "a" * 40
        self.authority = {
            "binding": {
                "canonicalRoot": str(self.root),
                "workspaceId": "b" * 16,
                "allowedCapabilities": ["station.connect", "station.deploy", "station.reset"],
            },
            "profile": {
                "profile": "fiveArm",
                "stationDeployEnvironment": "station-five-arm",
                "resetPolicy": "agent-resettable",
                "sourceState": "tracked-clean",
                "stationMode": "remote",
            },
            "source": {"head": self.commit},
            "workspaceStateRoot": str(Path(self.temp.name) / "state"),
        }
        self.transport = mock.Mock()
        self.boundary = mock.MagicMock()
        self.session = self.boundary.open.return_value.__enter__.return_value
        self.session.prepare.return_value = {"manifest_digest": "c" * 64}
        self.session.invoke.return_value = {}
        self.command_environments: list[dict[str, str]] = []
        self.real_run = subprocess.run

    def run_command(self, argv: list[str], **kwargs: object) -> object:
        if argv == ["make", "env-check"]:
            self.command_environments.append(dict(kwargs["env"]))
            return SimpleNamespace(stdout=json.dumps(self.authority))
        return self.real_run(argv, **kwargs)

    def prepare(self) -> Path:
        with (
            mock.patch.object(runtime_schema.subprocess, "run", side_effect=self.run_command),
            mock.patch.object(runtime_schema, "ReviewedSchemaActivationTransport",
                              return_value=self.transport),
            mock.patch.object(runtime_schema, "LeaseWrappedSSHMaintenanceBoundary",
                              return_value=self.boundary),
            mock.patch.object(runtime_schema, "validate_reset_manifest"),
            mock.patch.object(runtime_schema, "_validate_execution_result",
                              return_value=({"journal": "complete"}, {"physical": "fiveArm"})),
        ):
            return runtime_schema.prepare_private_social_runtime(
                self.root, task_id="social-cross-station-native-e2e",
                target_profile="fiveArm", source_commit=self.commit,
            )

    def test_explicit_secondary_target_survives_reset_and_both_deploys(self) -> None:
        parent = {"PT_DEV_TARGET_PROFILE": "four"}
        with mock.patch.dict(os.environ, parent):
            before = dict(os.environ)
            path = self.prepare()
            self.assertEqual(before, dict(os.environ))
        self.assertEqual("fiveArm", self.command_environments[0]["PT_DEV_TARGET_PROFILE"])
        self.assertEqual(2, self.transport.deploy.call_count)
        request = self.transport.deploy.call_args_list[0].args[0]
        self.assertEqual("fiveArm", request["profile_id"])
        self.assertEqual("station-five-arm", request["station_service_id"])
        self.assertEqual("station-five-arm", request["deployment_environment"])
        self.assertEqual(request, self.transport.deploy.call_args_list[1].args[0])
        self.assertEqual(request, self.boundary.open.call_args.args[0])
        self.assertEqual(2, self.session.invoke.call_count)
        for call in self.session.invoke.call_args_list:
            self.assertEqual("", call.args[0]["plan_id"])
            self.assertEqual("fiveArm", call.args[0]["profile_id"])
            self.assertEqual(self.commit, call.args[0]["source_commit"])
        self.assertEqual({"physical": "fiveArm"}, json.loads(path.read_text()))
        self.assertEqual(0o600, path.stat().st_mode & 0o777)

    def test_unrelated_untracked_site_work_does_not_block_station_checkpoint(self) -> None:
        site = self.root / "apps/official-site/draft"
        site.parent.mkdir(parents=True)
        site.write_text("unrelated")
        self.prepare()
        self.assertEqual("unrelated", site.read_text())

    def test_station_model_and_remote_owner_drift_fail_before_reset(self) -> None:
        for relative in (
            "apps/station/app/main.go", "apps/applets/note/service/entry.go",
            "model/domain/social/moments.proto",
            "tooling/development/secure_content/schema_activation.py",
        ):
            with self.subTest(path=relative):
                changed = self.root / relative
                changed.parent.mkdir(parents=True, exist_ok=True)
                changed.write_text("new uncheckpointed source")
                with self.assertRaisesRegex(BlockedError, "checkpoint-clean"):
                    self.prepare()
                self.transport.deploy.assert_not_called()
                self.boundary.open.assert_not_called()
                changed.unlink()

    def test_source_target_and_capability_drift_fail_before_deployment(self) -> None:
        baseline = copy.deepcopy(self.authority)
        for section, field, value in (
            ("source", "head", "d" * 40),
            ("profile", "profile", "four"),
            ("profile", "stationDeployEnvironment", "station-four"),
            ("profile", "resetPolicy", "protected"),
            ("profile", "sourceState", "dirty"),
            ("profile", "stationMode", "local"),
            ("binding", "canonicalRoot", str(self.root.parent)),
            ("binding", "allowedCapabilities", ["station.connect"]),
        ):
            with self.subTest(field=field):
                self.authority = copy.deepcopy(baseline)
                self.authority[section][field] = value
                with self.assertRaises(BlockedError):
                    self.prepare()
                self.transport.deploy.assert_not_called()
                self.boundary.open.assert_not_called()
