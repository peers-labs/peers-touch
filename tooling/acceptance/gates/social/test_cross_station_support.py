from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import (
    GateError,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.social.cross_station_support import (
    CLIENT_BINDINGS,
    EXPECTED_RUNTIME_REUSE,
    SCENARIO_IDS,
    SERVICE_IDS,
    SourceCommand,
    _require_allowed_control_lineage,
    _require_source_ancestor,
    canonical_digest,
    discover_suite_result,
    run_source_commands,
    validate_acceptance_runtime_manifest,
    validate_suite_result,
)


CONTROL_COMMIT = "a" * 40
SOURCE_COMMIT = "b" * 40
WORKSPACE_ID = "c" * 16
WORKTREE_SET_DIGEST = "d" * 64
RUN_ID = "css-09-suite-run"
FIXTURE_EPOCH = "css-09-fixture-epoch"


class _Report:
    def __init__(self) -> None:
        self.files: list[tuple[str, Path]] = []

    def add_evidence_file(self, key: str, path: Path) -> str:
        self.files.append((key, path))
        return str(path)


class _Gate:
    def __init__(self) -> None:
        self.report = _Report()
        self.assertions: list[str] = []

    def assert_condition(
        self,
        name: str,
        condition: bool,
        detail: str | None = None,
    ) -> None:
        if not condition:
            raise AssertionError(detail or name)
        self.assertions.append(name)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class SourceCommandTest(unittest.TestCase):
    def test_success_attaches_log_and_records_assertion(self) -> None:
        gate = _Gate()
        command = SourceCommand(
            name="focused",
            argv=("tool", "test"),
            required_output_pattern=r"^TestFocused$",
        )
        completed = subprocess.CompletedProcess(
            command.argv,
            0,
            stdout="TestFocused\n",
            stderr="",
        )

        result = run_source_commands(
            gate,  # type: ignore[arg-type]
            (command,),
            runner=mock.Mock(return_value=completed),
        )

        self.assertEqual("focused", result[0]["name"])
        self.assertEqual(["focused"], gate.assertions)
        self.assertEqual("focused-log", gate.report.files[0][0])

    def test_zero_focused_tests_fail_closed_after_attaching_log(self) -> None:
        gate = _Gate()
        command = SourceCommand(
            name="focused",
            argv=("tool", "test"),
            required_output_pattern=r"^TestFocused$",
        )
        completed = subprocess.CompletedProcess(
            command.argv,
            0,
            stdout="ok\n",
            stderr="",
        )

        with self.assertRaisesRegex(GateError, "required focused test"):
            run_source_commands(
                gate,  # type: ignore[arg-type]
                (command,),
                runner=mock.Mock(return_value=completed),
            )

        self.assertEqual("focused-log", gate.report.files[0][0])

    def test_required_output_match_ignores_ansi_color_sequences(self) -> None:
        gate = _Gate()
        command = SourceCommand(
            name="focused",
            argv=("tool", "test"),
            required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
        )
        completed = subprocess.CompletedProcess(
            command.argv,
            0,
            stdout="\x1b[2m Tests \x1b[22m \x1b[32m33 passed\x1b[39m\n",
            stderr="",
        )

        result = run_source_commands(
            gate,  # type: ignore[arg-type]
            (command,),
            runner=mock.Mock(return_value=completed),
        )

        self.assertEqual("focused", result[0]["name"])


class SuiteResultValidationTest(unittest.TestCase):
    def _suite_report(self) -> dict[str, object]:
        ledger = SuiteRuntimeLedger(
            EXPECTED_RUNTIME_REUSE,
            suite_runtime_id=RUN_ID,
            source_digest=SOURCE_COMMIT,
            fixture_epoch=FIXTURE_EPOCH,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime:css-09",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="client:alice",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="client:bob",
        )
        for scenario_id in SCENARIO_IDS:
            if scenario_id == "AS23":
                ledger.record(
                    SuiteRuntimeAction.CLIENT_REPLACEMENT,
                    resource_id="client:bob2",
                )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            ledger.record(
                SuiteRuntimeAction.FIXTURE_RESET,
                scenario_id=scenario_id,
                resource_id=f"fixture:{scenario_id}",
            )
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id=scenario_id,
                resource_id=f"action:{scenario_id}",
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id=scenario_id,
                resource_id=f"receiver:{scenario_id}",
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id=f"supporting:{scenario_id}",
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        return ledger.require_valid()

    @staticmethod
    def _runtime_manifest(
        suite_runtime_report_digest: str,
    ) -> dict[str, object]:
        service_identities = {
            service_id: (
                "1" * 64 if service_id == "station-four" else "2" * 64
            )
            for service_id in SERVICE_IDS
        }
        clients: list[dict[str, object]] = []
        for client_id, (actor, service_id) in CLIENT_BINDINGS.items():
            clients.append(
                {
                    "clientId": f"cross-station-social-{client_id}",
                    "actorRole": actor,
                    "profileId": (
                        "four"
                        if service_id == "station-four"
                        else "fiveArm"
                    ),
                    "serviceId": service_id,
                    "launched": client_id != "eve",
                }
            )
        return {
            "artifactKind": "social-cross-station-suite-runtime-manifest",
            "schemaVersion": 1,
            "state": "FIXTURE_READY",
            "cleanupState": "CLEANED",
            "runId": RUN_ID,
            "workspaceId": WORKSPACE_ID,
            "sourceCommit": SOURCE_COMMIT,
            "controlCommit": CONTROL_COMMIT,
            "worktreeSetDigest": WORKTREE_SET_DIGEST,
            "profileBindings": {
                "four": "station-four",
                "fiveArm": "station-five-arm",
            },
            "serviceRuntimeIdentityDigests": service_identities,
            "clientBindings": clients,
            "fixtureEpoch": FIXTURE_EPOCH,
            "scenarioManifestDigests": {
                "initial": "3" * 64,
                "replacement": "4" * 64,
            },
            "suiteRuntimeReportDigest": suite_runtime_report_digest,
        }

    def _fixture(
        self,
        root: Path,
    ) -> tuple[dict[str, object], Path]:
        result_path = (
            root
            / "development"
            / "secure-content"
            / "CSS-09"
            / CONTROL_COMMIT
            / "suite"
            / "result.json"
        )
        suite_report = self._suite_report()
        suite_path = result_path.parent / "suite-runtime.json"
        _write_json(suite_path, suite_report)
        activation_path = result_path.parent / "activation.json"
        activation: dict[str, object] = {
            "schema_version": 1,
            "kind": "secure-content-schema-activation-aggregate",
            "workstream_id": "CSS-W-ACTIVATION",
            "task_id": "CSS-08A-schema-activation",
            "generation_id": SOURCE_COMMIT,
            "source_commit": SOURCE_COMMIT,
            "workspace_id": WORKSPACE_ID,
            "reset_intent": "SCHEMA_ACTIVATION",
            "profiles": ["four", "fiveArm"],
            "source_freeze_ref": "source-freeze.json",
            "source_freeze_digest": "5" * 64,
            "children": [
                {"profile_id": "four"},
                {"profile_id": "fiveArm"},
            ],
            "status": "PASS",
            "claim": "CANONICAL_SCHEMA_ACTIVE_ONLY",
            "completed_at": "2026-10-05T00:00:00Z",
        }
        activation["result_digest"] = canonical_digest(activation)
        _write_json(activation_path, activation)

        scenario_results: dict[str, object] = {}
        supporting: list[object] = [str(activation_path)]
        for scenario_id in SCENARIO_IDS:
            relative = f"evidence/{scenario_id}-receiver.json"
            evidence_path = result_path.parent / relative
            _write_json(
                evidence_path,
                {
                    "artifactKind": (
                        "social-cross-station-receiver-evidence"
                    ),
                    "scenarioId": scenario_id,
                    "receiverClientId": (
                        "alice"
                        if scenario_id == "same-station-regression"
                        else "bob"
                    ),
                },
            )
            supporting.append(relative)
            scenario_results[scenario_id] = {
                "status": "PASS",
                "evidenceRefs": [
                    {
                        "path": relative,
                        "sha256": hashlib.sha256(
                            evidence_path.read_bytes()
                        ).hexdigest(),
                    }
                ],
            }

        payload: dict[str, object] = {
            "artifactKind": "social-cross-station-suite-result",
            "schemaVersion": 1,
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "controlCommit": CONTROL_COMMIT,
            "sourceCommit": SOURCE_COMMIT,
            "workspaceId": WORKSPACE_ID,
            "worktreeSetDigest": WORKTREE_SET_DIGEST,
            "runId": RUN_ID,
            "fixtureEpoch": FIXTURE_EPOCH,
            "activation": {
                "aggregatePath": str(activation_path),
                "resultDigest": activation["result_digest"],
                "profiles": ["four", "fiveArm"],
            },
            "runtimeManifest": self._runtime_manifest(
                str(suite_report["reportDigest"])
            ),
            "scenarioResults": scenario_results,
            "suiteRuntimeReport": "suite-runtime.json",
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "supportingArtifacts": supporting,
            "resourceReuse": {
                "provisioningRuns": 1,
                "clientLaunches": 3,
                "maxConcurrentNativeClients": 2,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob2"],
                "fixtureOnlyClients": ["eve"],
            },
            "cleanup": {"status": "CLEANED"},
        }
        payload["resultDigest"] = canonical_digest(payload)
        _write_json(result_path, payload)
        return payload, result_path

    def _validate(
        self,
        payload: dict[str, object],
        result_path: Path,
        root: Path,
    ) -> None:
        validate_suite_result(
            payload,
            result_path=result_path,
            artifact_root=root,
            repo_root=Path("."),
            control_commit=CONTROL_COMMIT,
            expected_workspace=WORKSPACE_ID,
            require_ancestor=False,
        )

    def test_complete_current_control_result_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, result_path = self._fixture(root)

            result = validate_suite_result(
                payload,
                result_path=result_path,
                artifact_root=root,
                repo_root=Path("."),
                control_commit=CONTROL_COMMIT,
                expected_workspace=WORKSPACE_ID,
                require_ancestor=False,
            )

            self.assertEqual(
                payload["suiteRuntimeReportDigest"],
                result.suite_runtime_report["reportDigest"],
            )
            self.assertEqual(
                len(SCENARIO_IDS) + 1,
                len(result.supporting_artifacts),
            )

    def test_result_digest_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, result_path = self._fixture(root)
            payload["cleanup"] = {"status": "FAILED"}

            with self.assertRaisesRegex(GateError, "digest"):
                self._validate(payload, result_path, root)

    def test_unknown_scenario_evidence_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, result_path = self._fixture(root)
            mutated = copy.deepcopy(payload)
            mutated["scenarioResults"]["AS17"]["evidenceRefs"] = ["missing"]
            mutated["resultDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in mutated.items()
                    if key != "resultDigest"
                }
            )

            with self.assertRaisesRegex(GateError, "unavailable|unknown evidence"):
                self._validate(mutated, result_path, root)

    def test_resource_budget_expansion_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, result_path = self._fixture(root)
            mutated = copy.deepcopy(payload)
            mutated["resourceReuse"]["maxConcurrentNativeClients"] = 3
            mutated["resultDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in mutated.items()
                    if key != "resultDigest"
                }
            )

            with self.assertRaisesRegex(GateError, "concurrent"):
                self._validate(mutated, result_path, root)


class AcceptanceRuntimeManifestTest(unittest.TestCase):
    @staticmethod
    def _manifest() -> dict[str, object]:
        services = {
            service_id: {
                "kind": "station",
                "deploymentEnvironment": service_id,
                "endpoint": f"https://{service_id}.invalid",
                "liveCommit": CONTROL_COMMIT,
                "protocolDigest": "1" * 64,
                "workspaceDigest": "clean",
                "runtimeIdentity": f"{service_id}-runtime",
                "attestationArtifact": {
                    "artifactKind": "acceptance-artifact-ref"
                },
            }
            for service_id in SERVICE_IDS
        }
        clients = []
        for client_id, (actor, service_id) in CLIENT_BINDINGS.items():
            clients.append(
                {
                    "actor": actor,
                    "runtime": "native-tauri",
                    "worktree": "/tmp/worktree",
                    "gateway_port": 4000,
                    "renderer_port": 4100,
                    "webdriver_port": 4200,
                    "profile": f"social-{client_id}",
                    "storage_root": f"/tmp/storage/{client_id}",
                    "storage_lifecycle": "ephemeral",
                    "id": client_id,
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": service_id,
                            "required_kind": "station",
                        }
                    },
                }
            )
        return {
            "artifactKind": "acceptance-runtime-manifest",
            "environmentId": "cross-station-social-native",
            "gateId": "social-cross-station-native-e2e",
            "runId": "runtime-manifest-run",
            "createdAt": "2026-10-05T00:00:00Z",
            "state": "FIXTURE_READY",
            "source": {
                "worktree": "/tmp/worktree",
                "commit": CONTROL_COMMIT,
                "workspaceDigest": "clean",
            },
            "profile": {
                "requestedName": "four",
                "resolvedName": "four",
                "slot": 13,
            },
            "services": services,
            "credentialRefs": [],
            "clients": clients,
            "cleanup": {"registered": True, "resources": ["processes"]},
        }

    def test_required_station_and_client_bindings_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            _write_json(path, self._manifest())

            manifest = validate_acceptance_runtime_manifest(path)

            self.assertEqual(
                set(SERVICE_IDS),
                set(manifest["services"]),
            )

    def test_misbound_client_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = self._manifest()
            manifest["clients"][0]["service_bindings"]["station"][
                "service_id"
            ] = "station-five-arm"
            path = Path(directory) / "runtime.json"
            _write_json(path, manifest)

            with self.assertRaisesRegex(GateError, "misbound"):
                validate_acceptance_runtime_manifest(path)


class ControlLineageTest(unittest.TestCase):
    @staticmethod
    def _git(root: Path, *arguments: str) -> str:
        completed = subprocess.run(
            ["git", *arguments],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        )
        return completed.stdout.strip()

    def test_clean_allowed_descendant_can_reuse_nearest_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._git(root, "init", "-q")
            self._git(root, "config", "user.name", "CSS-09 Test")
            self._git(root, "config", "user.email", "css09@example.invalid")

            source_path = root / "source.txt"
            source_path.write_text("source\n", encoding="utf-8")
            self._git(root, "add", "source.txt")
            self._git(root, "commit", "-q", "-m", "source")
            source_commit = self._git(root, "rev-parse", "HEAD")

            evidence_path = (
                root
                / "docs"
                / "architecture"
                / "cross-station-social"
                / "evidence.md"
            )
            evidence_path.parent.mkdir(parents=True)
            evidence_path.write_text("control\n", encoding="utf-8")
            self._git(root, "add", str(evidence_path.relative_to(root)))
            self._git(root, "commit", "-q", "-m", "control")
            result_control = self._git(root, "rev-parse", "HEAD")

            gate_path = root / "tooling" / "acceptance" / "gate.py"
            gate_path.parent.mkdir(parents=True)
            gate_path.write_text("VALUE = 1\n", encoding="utf-8")
            self._git(root, "add", str(gate_path.relative_to(root)))
            self._git(root, "commit", "-q", "-m", "allowed descendant")
            current_head = self._git(root, "rev-parse", "HEAD")

            artifact_root = root.parent / f"{root.name}-artifacts"
            result_path = (
                artifact_root
                / "development"
                / "secure-content"
                / "CSS-09"
                / result_control
                / "suite"
                / "result.json"
            )
            _write_json(result_path, {})
            self.addCleanup(
                lambda: shutil.rmtree(
                    artifact_root,
                    ignore_errors=True,
                )
            )

            discovered, _, discovered_head, _ = discover_suite_result(
                root,
                artifact_root=artifact_root,
                control_commit=current_head,
            )

            self.assertEqual(result_path.resolve(), discovered)
            self.assertEqual(current_head, discovered_head)
            _require_source_ancestor(root, source_commit, result_control)
            _require_allowed_control_lineage(
                root,
                result_control,
                current_head,
            )

    def test_disallowed_clean_descendant_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._git(root, "init", "-q")
            self._git(root, "config", "user.name", "CSS-09 Test")
            self._git(root, "config", "user.email", "css09@example.invalid")
            seed = root / "seed.txt"
            seed.write_text("seed\n", encoding="utf-8")
            self._git(root, "add", "seed.txt")
            self._git(root, "commit", "-q", "-m", "result control")
            result_control = self._git(root, "rev-parse", "HEAD")

            product = root / "apps" / "product.txt"
            product.parent.mkdir(parents=True)
            product.write_text("changed\n", encoding="utf-8")
            self._git(root, "add", "apps/product.txt")
            self._git(root, "commit", "-q", "-m", "product drift")
            current_head = self._git(root, "rev-parse", "HEAD")

            with self.assertRaisesRegex(GateError, "disallowed"):
                _require_allowed_control_lineage(
                    root,
                    result_control,
                    current_head,
                )


if __name__ == "__main__":
    unittest.main()
