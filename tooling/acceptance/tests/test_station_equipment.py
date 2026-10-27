"""Independent process-boundary checks for Profile Station equipment."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError, EphemeralLaunchCleanupFailed
from tooling.acceptance.provisioners.station_equipment import equip_station_profile


class StationEquipmentTests(unittest.TestCase):
    def test_equipment_preserves_failed_process_cleanup(self):
        error = EphemeralLaunchCleanupFailed(
            "equipment descendant did not stop", operation="gate_process",
            result={"retained": "equipment"},
        )
        with patch(
            "tooling.acceptance.provisioners.station_equipment.GateProcessLauncher.run",
            side_effect=error,
        ), self.assertRaises(EphemeralLaunchCleanupFailed) as caught:
            equip_station_profile("four", "a" * 40, repo_root=Path("/synthetic"))
        self.assertIs(caught.exception, error)
        self.assertEqual(caught.exception.result, {"retained": "equipment"})

    def test_target_is_projected_without_inheriting_a_runtime_profile_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "tooling/devctl/index.mjs"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                "import fs from 'node:fs';"
                "fs.writeFileSync('observation.json', JSON.stringify({"
                "target:process.env.PT_DEV_TARGET_PROFILE,"
                "source:process.env.PT_BUILD_SOURCE_COMMIT,"
                "override:process.env.PT_DEV_PROFILE_FILE ?? null,"
                "args:process.argv.slice(2)}));",
            )
            with patch.dict(os.environ, {
                "PT_DEV_PROFILE_FILE": "/foreign/runtime.env",
                "PT_DEV_PROFILE_FILE_AUTHORITY": "acceptance-runtime-manifest",
                "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT": "/foreign",
                "PT_ACCEPTANCE_RUN_ID": "",
            }):
                equip_station_profile("fiveArm", "a" * 40, repo_root=root, timeout_seconds=5)
            observed = json.loads((root / "observation.json").read_text())
        self.assertEqual(observed["target"], "fiveArm")
        self.assertEqual(observed["source"], "a" * 40)
        self.assertIsNone(observed["override"])
        self.assertEqual(observed["args"], [
            "station", "start", "--target-profile", "fiveArm", "--json",
        ])

    def test_equipment_keeps_evidence_context_out_of_deployment_environment(self):
        run_id = "20261025T000000000000Z-" + "a" * 32
        runtime_fields = {
            "PT_ACCEPTANCE_RUN_ID": run_id,
            "PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "1",
            "PT_AGENT_EXTERNAL_RUNTIME_ROOT": "/foreign/agent-runtime",
            "PT_AGENT_EXTERNAL_START_ARGV_JSON": '["start"]',
            "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON": '["resume"]',
            "PT_AGENT_EXTERNAL_RESET_ARGV_JSON": '["reset"]',
        }
        for environment_id in ("native-tauri-embedded-webdriver", "mobile-simulator"):
            with self.subTest(environment=environment_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                entry = root / "tooling/devctl/index.mjs"
                entry.parent.mkdir(parents=True)
                fields = ["PT_ACCEPTANCE_ENVIRONMENT", *runtime_fields]
                entry.write_text(
                    "import fs from 'node:fs';"
                    f"const fields = {json.dumps(fields)};"
                    "fs.writeFileSync('observation.json', JSON.stringify({"
                    "runtime:Object.fromEntries(fields.map(key => [key, process.env[key] ?? null])),"
                    "target:process.env.PT_DEV_TARGET_PROFILE,"
                    "source:process.env.PT_BUILD_SOURCE_COMMIT}));"
                    "process.stdout.write('original deployment output');"
                    "process.stderr.write(JSON.stringify({error:{code:'TARGET_DEPLOY_FAILED'}}));"
                    "process.exitCode = 2;",
                )
                with (
                    patch.dict(os.environ, {
                        **runtime_fields, "PT_ACCEPTANCE_ENVIRONMENT": environment_id,
                    }),
                    patch(
                        "tooling.acceptance.provisioners.station_equipment.write_current_artifact",
                        autospec=True,
                    ) as write_artifact,
                    patch(
                        "tooling.acceptance.provisioners.station_equipment.current_artifact_ref",
                        autospec=True,
                    ) as artifact_ref,
                    self.assertRaises(BlockedError) as caught,
                ):
                    artifact_ref.return_value.to_dict.return_value = {
                        "artifactKind": "acceptance-artifact-ref",
                        "workspaceId": "synthetic", "gateId": "equipment",
                        "runId": run_id, "path": "runtime/station-equipment/four.log",
                        "sha256": "b" * 64, "mediaType": "text/plain",
                    }
                    equip_station_profile("four", "a" * 40, repo_root=root, timeout_seconds=5)
                observed = json.loads((root / "observation.json").read_text())
                diagnostic = caught.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]
                write_artifact.assert_called_once()
                artifact_ref.assert_called_once()
                self.assertEqual(write_artifact.call_args.args, (
                    "runtime/station-equipment/four.log",
                    b'original deployment output{"error":{"code":"TARGET_DEPLOY_FAILED"}}',
                ))
                self.assertEqual(write_artifact.call_args.kwargs["environment"]["PT_ACCEPTANCE_RUN_ID"], run_id)
                self.assertEqual(artifact_ref.call_args.kwargs["environment"]["PT_ACCEPTANCE_RUN_ID"], run_id)
                self.assertEqual(diagnostic["exitCode"], 2)
                self.assertEqual(diagnostic["machineCode"], "TARGET_DEPLOY_FAILED")
                self.assertEqual(diagnostic["log"]["runId"], run_id)
                self.assertEqual(observed["target"], "four")
                self.assertEqual(observed["source"], "a" * 40)
                self.assertEqual(observed["runtime"], dict.fromkeys(fields))

    def test_equipment_timeout_reaps_the_owned_process_and_retains_diagnostic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "tooling/devctl/index.mjs"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                "import fs from 'node:fs';"
                "fs.writeFileSync('pid', String(process.pid));"
                "setInterval(() => {}, 100);",
            )
            with patch.dict(os.environ, {"PT_ACCEPTANCE_RUN_ID": ""}):
                with self.assertRaises(BlockedError) as caught:
                    equip_station_profile("four", "a" * 40, repo_root=root, timeout_seconds=1)
            pid = int((root / "pid").read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        diagnostic = caught.exception.diagnostic.to_dict()
        self.assertEqual(diagnostic["owner"], "tooling/acceptance/provisioners/station_equipment.py")
        self.assertEqual(
            diagnostic["resourceChecks"][0]["observed"]["errorType"],
            "EphemeralLaunchTimeout",
        )


if __name__ == "__main__":
    unittest.main()
