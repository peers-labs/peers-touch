from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch
from urllib.parse import quote

from tooling.acceptance.core.attestation import source_proto_digest
from tooling.acceptance.core.errors import GateError
from tooling.development.secure_content import (
    attached_client,
    run,
    runtime_manifest,
)
from tooling.development.secure_content import (
    test_runtime_manifest as manifest_fixtures,
)
from tooling.development.secure_content.scenarios import desktop_pilot


REPO_ROOT = Path(__file__).resolve().parents[3]
IDENTITY = manifest_fixtures.IDENTITY


def active_declaration(
    scenario: run.ScenarioDefinition,
    *,
    digest: str = "a" * 64,
) -> dict[str, Any]:
    return {
        "declarationId": f"{scenario.work_item_id}-{IDENTITY['workspaceId']}",
        "workItemId": scenario.work_item_id,
        "sessionId": scenario.work_item_id,
        "workspaceId": IDENTITY["workspaceId"],
        "branch": IDENTITY["branch"],
        "sourceHead": IDENTITY["head"],
        "journeyId": scenario.journey_id,
        "state": "ACTIVE",
        "declarationDigest": digest,
        "sourceClaims": [
            {
                "mode": "exclusive-write",
                "pathPrefix": "tooling/development/secure_content",
            }
        ],
    }


def control_plane_runner(
    scenario: run.ScenarioDefinition,
    *,
    dirty: bool = False,
    declarations: list[dict[str, Any]] | None = None,
    declaration: dict[str, Any] | None = None,
) -> run.CommandRunner:
    selected = declaration or active_declaration(scenario)
    visible = declarations if declarations is not None else [selected]

    def execute(
        command: list[str],
        cwd: Path,
    ) -> subprocess.CompletedProcess[str]:
        if cwd != REPO_ROOT:
            raise AssertionError(f"unexpected cwd: {cwd}")
        if command == ["make", "dev-status"]:
            payload: Any = {
                "workspaceId": IDENTITY["workspaceId"],
                "declarations": visible,
            }
        elif command == [
            "make",
            "dev-check",
            f"WORK_ITEM={scenario.work_item_id}",
            f"SESSION={scenario.work_item_id}",
        ]:
            payload = selected
        elif command == [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=all",
        ]:
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=" M outside-scope.txt\n" if dirty else "",
                stderr="",
            )
        else:
            raise AssertionError(f"unexpected command: {command}")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(payload),
            stderr="",
        )

    return execute


def scenario(
    *,
    runtime_name: str = "desktop",
    execute: Any = None,
) -> run.ScenarioDefinition:
    return run.ScenarioDefinition(
        scenario_id="runtime-v3-test",
        journey_id="sc-dj-runtime-manifest-v3",
        work_item_id="secure-content-w7r",
        runtimes=frozenset({runtime_name}),
        evidence_path=Path("W7R/EC5R/result.json"),
        execute=execute or (lambda _: {}),
    )


def v3_payload() -> dict[str, Any]:
    payload = manifest_fixtures.manifest_payload()
    protocol_digest = source_proto_digest(REPO_ROOT)
    for service in payload["services"].values():
        service["protocol_digest"] = protocol_digest
    return runtime_manifest.with_manifest_digest(payload)


def write_v3_manifest(root: Path, payload: dict[str, Any] | None = None) -> Path:
    return manifest_fixtures.write_manifest(
        root,
        payload or v3_payload(),
        lease_window_from_manifest=True,
    )


def load_v3_binding(path: Path) -> runtime_manifest.RuntimeManifestBinding:
    return runtime_manifest.load_runtime_manifest(
        path,
        journey_id="sc-dj-runtime-manifest-v3",
        repo_root=REPO_ROOT,
        workspace_identity=IDENTITY,
        profile_selectors=("four", "fiveArm"),
        client_selectors=tuple(item[0] for item in manifest_fixtures.CLIENTS),
        runtime=None,
        expected_protocol_digest=source_proto_digest(REPO_ROOT),
    )


def network_capture_marker(
    action_id: str,
    *,
    initial_observer_sequence: int = 0,
    final_observer_sequence: int = 1,
    open_stream_identity_digests: tuple[str, ...] = (),
) -> tuple[dict[str, Any], dict[str, Any]]:
    capture = {
        "schemaVersion": 1,
        "captureId": hashlib.sha256(
            f"capture:{action_id}".encode("utf-8")
        ).hexdigest(),
        "actionId": action_id,
        "initialObserverSequence": initial_observer_sequence,
        "runtimeManifestDigest": "a" * 64,
    }
    marker: dict[str, Any] = {
        "schemaVersion": 1,
        "captureId": capture["captureId"],
        "actionId": action_id,
        "runtimeManifestDigest": capture["runtimeManifestDigest"],
        "finalObserverSequence": final_observer_sequence,
        "openStreamIdentityDigests": sorted(
            open_stream_identity_digests
        ),
        "captureIntervalDigest": hashlib.sha256(
            f"interval:{action_id}".encode("utf-8")
        ).hexdigest(),
    }
    marker["markerDigest"] = hashlib.sha256(
        json.dumps(
            marker,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return capture, marker


def terminal_marker_entry(marker: Mapping[str, Any]) -> dict[str, str]:
    persisted = dict(marker)
    persisted.pop("markerDigest")
    encoded = base64.urlsafe_b64encode(
        json.dumps(
            persisted,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return {
        "message": json.dumps(
            {
                "message": {
                    "method": "Network.requestWillBeSent",
                    "params": {
                        "requestId": "terminal-marker",
                        "request": {
                            "url": (
                                "http://localhost:3210"
                                f"{attached_client.TERMINAL_MARKER_PATH_PREFIX}"
                                f"{encoded}"
                            ),
                            "method": "GET",
                            "headers": {},
                        },
                    },
                }
            }
        )
    }


def write_manifest_for_scenario(
    root: Path,
    selected: run.ScenarioDefinition,
    *,
    run_id: str,
    parent: runtime_manifest.RuntimeManifestBinding | None = None,
    restart_request_id: str | None = None,
) -> Path:
    payload = v3_payload()
    payload["run_id"] = run_id
    payload["journey_id"] = selected.journey_id
    payload["created_at"] = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    payload["fixture_manifest_ref"]["path"] = (
        f"runtime/{run_id}/fixtures.json"
    )
    for service_id, service in payload["services"].items():
        service["attestation_artifact_ref"]["path"] = (
            f"runtime/{run_id}/{service_id}.json"
        )
    if parent is not None:
        parent_client = parent.client("desktop-alice")
        child_client = payload["clients"][0]
        child_client["boot_identity"] = manifest_fixtures.digest(
            f"boot:{run_id}"
        )
        child_client["session_generation"] = (
            parent_client["session_generation"] + 1
        )
        child_client["automation_attachment_ref"]["session_id"] = (
            f"session-{run_id}"
        )
        child_client["storage_identity_digest"] = parent_client[
            "storage_identity_digest"
        ]
        payload["continuation"] = {
            "parent_manifest_digest": parent.sha256,
            "restart_request_id": (
                restart_request_id or f"restart-{run_id}"
            ),
            "retained_client_id": "desktop-alice",
            "retained_storage_identity_digest": parent_client[
                "storage_identity_digest"
            ],
            "previous_boot_identity": parent_client["boot_identity"],
            "runtime_owner_acknowledgement_id": f"ack-{run_id}",
            "lease_evidence_ref": {
                "path": f"leases/{run_id}.json",
                "sha256": "0" * 64,
            },
        }
    return write_v3_manifest(root, runtime_manifest.with_manifest_digest(payload))


def load_scenario_binding(
    path: Path,
    selected: run.ScenarioDefinition,
) -> runtime_manifest.RuntimeManifestBinding:
    return runtime_manifest.load_runtime_manifest(
        path,
        journey_id=selected.journey_id,
        repo_root=REPO_ROOT,
        workspace_identity=IDENTITY,
        profile_selectors=("four", "fiveArm"),
        client_selectors=("desktop-alice",),
        runtime="desktop",
        expected_protocol_digest=source_proto_digest(REPO_ROOT),
    )


class SecureContentRunnerTest(unittest.TestCase):
    def test_discovers_optional_auth_scenario_dynamically(self) -> None:
        scenarios = run.discover_scenarios()

        self.assertIn("optional-auth", scenarios)
        self.assertEqual(
            frozenset({"service"}),
            scenarios["optional-auth"].runtimes,
        )
        self.assertEqual(
            "sc-dj-optional-auth",
            scenarios["optional-auth"].journey_id,
        )

    def test_workspace_identity_accepts_canonical_verifier_shape(self) -> None:
        expected = {
            "root": str(REPO_ROOT.resolve()),
            "workspaceId": IDENTITY["workspaceId"],
            "branch": IDENTITY["branch"],
            "head": IDENTITY["head"],
            "worktreeSetDigest": "f" * 64,
            "gitDir": str(REPO_ROOT / ".git"),
            "commonDir": str(REPO_ROOT / ".git"),
        }

        def execute(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            self.assertEqual(REPO_ROOT, cwd)
            self.assertIn("--capture", command)
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(expected),
                stderr="",
            )

        self.assertEqual(expected, run._workspace_identity(REPO_ROOT, execute))

    def test_runtime_mismatch_fails_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, Any]:
            nonlocal called
            called = True
            return {}

        selected = run.ScenarioDefinition(
            scenario_id="service-only",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/result.json"),
            execute=execute,
        )
        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "does not support runtime",
        ):
            run.execute_scenario(
                runtime="desktop",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={selected.scenario_id: selected},
            )
        self.assertFalse(called)

    def test_preserves_ordered_multi_profile_binding(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, Any]:
            self.assertIsNone(context.profile)
            self.assertEqual(("four", "fiveArm"), context.profiles)
            return {}

        selected = scenario(runtime_name="service", execute=execute)
        with tempfile.TemporaryDirectory() as temp:
            result = run.execute_scenario(
                runtime="service",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                result_root=Path(temp),
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )
        self.assertEqual(["four", "fiveArm"], result["profiles"])

    def test_rejects_ambiguous_or_duplicate_profile_binding(self) -> None:
        selected = scenario(runtime_name="service")
        common = {
            "runtime": "service",
            "scenario_id": selected.scenario_id,
            "budget_seconds": 10,
            "repo_root": REPO_ROOT,
            "registry": {selected.scenario_id: selected},
        }
        with self.assertRaisesRegex(run.RunnerError, "choose exactly one"):
            run.execute_scenario(
                **common,
                profile="four",
                profiles=("four", "fiveArm"),
            )
        with self.assertRaisesRegex(run.RunnerError, "duplicates"):
            run.execute_scenario(
                **common,
                profiles=("four", "four"),
            )

    def test_canonical_result_coordinates_partition_variant_and_run(self) -> None:
        selected = run.ScenarioDefinition(
            scenario_id="mobile-result",
            journey_id="mobile-result",
            work_item_id="mobile-result",
            runtimes=frozenset({"mobile"}),
            evidence_path=Path("legacy/result.json"),
            execute=lambda _: {},
            result_prefix=Path("W9"),
            result_task_id="W9",
            result_workstream_id="W9",
            result_variant=lambda _runtime, _profile, _profiles, clients: (
                "ios" if all(client.startswith("ios_") for client in clients)
                else "android"
            ),
        )

        path, coordinates = run._scenario_result_coordinates(
            scenario=selected,
            identity=IDENTITY,
            declaration={"sessionId": "mobile-session"},
            runtime="mobile",
            profile="four",
            profiles=("four",),
            clients=("ios_alice", "ios_bob"),
            runtime_manifest=SimpleNamespace(run_id="mobile-run"),
        )

        self.assertEqual(
            Path("W9")
            / IDENTITY["head"]
            / "ios"
            / "mobile-run"
            / "result.json",
            path,
        )
        self.assertEqual("W9", coordinates["taskId"])
        self.assertEqual("W9", coordinates["workstreamId"])
        self.assertEqual("ios", coordinates["variantId"])
        self.assertEqual("mobile-run", coordinates["runId"])

    def test_canonical_result_coordinates_isolate_manifest_preflight_failure(
        self,
    ) -> None:
        selected = run.ScenarioDefinition(
            scenario_id="mobile-result",
            journey_id="mobile-result",
            work_item_id="mobile-result",
            runtimes=frozenset({"mobile"}),
            evidence_path=Path("legacy/result.json"),
            execute=lambda _: {},
            result_prefix=Path("W9"),
            result_task_id="W9",
            result_workstream_id="W9",
            result_variant="ios",
        )

        path, coordinates = run._scenario_result_coordinates(
            scenario=selected,
            identity=IDENTITY,
            declaration={"sessionId": "mobile-session"},
            runtime="mobile",
            profile="four",
            profiles=("four",),
            clients=("ios_alice", "ios_bob"),
            runtime_manifest=None,
        )

        self.assertEqual(
            Path("W9")
            / IDENTITY["head"]
            / "ios"
            / "mobile-session"
            / "result.json",
            path,
        )
        self.assertEqual("mobile-session", coordinates["runId"])

    def test_canonical_result_is_partitioned_and_digest_bound(self) -> None:
        selected = run.ScenarioDefinition(
            scenario_id="canonical-result",
            journey_id="sc-dj-runtime-manifest-v3",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("legacy/result.json"),
            execute=lambda _: {"observations": {"receiverVisible": True}},
            result_prefix=Path("W11"),
            result_task_id="W11",
            result_workstream_id="W11",
            result_variant="desktop",
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = write_manifest_for_scenario(
                root,
                selected,
                run_id="canonical-run",
            )
            result_root = root / "results"

            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=manifest_path,
                result_root=result_root,
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )

            path = (
                result_root
                / "W11"
                / IDENTITY["head"]
                / "desktop"
                / "canonical-run"
                / "result.json"
            )
            self.assertTrue(path.is_file())
            self.assertEqual("W11", result["taskId"])
            self.assertEqual("W11", result["workstreamId"])
            self.assertEqual("desktop", result["variantId"])
            self.assertEqual("canonical-run", result["runId"])
            content = dict(result)
            digest = content.pop("resultDigest")
            self.assertEqual(digest, run._canonical_digest(content))

    def test_w12_result_copies_post_cut_manifest_binding(self) -> None:
        selected = run.ScenarioDefinition(
            scenario_id="w12-post-cut-result",
            journey_id="sc-dj-runtime-manifest-v3",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("legacy/result.json"),
            execute=lambda _: {"observations": {"receiverVisible": True}},
            result_prefix=Path("W12/product"),
            result_task_id="W12",
            result_workstream_id="W12",
            result_variant="desktop",
        )
        final_cut_bindings = {
            profile: {
                "result_digest": manifest_fixtures.digest(
                    f"result:{profile}"
                ),
                "reset_id": f"reset-{profile}",
                "schema_attestation_digest": manifest_fixtures.digest(
                    f"schema:{profile}"
                ),
                "station_runtime_identity": f"runtime-{profile}",
            }
            for profile in ("four", "fiveArm")
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = v3_payload()
            payload["post_cut_epoch_id"] = "post-cut-epoch"
            payload["final_cut_bindings"] = final_cut_bindings
            manifest_path = write_v3_manifest(root, payload)

            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=manifest_path,
                result_root=root / "results",
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )

            self.assertEqual("post-cut-epoch", result["postCutEpochId"])
            self.assertEqual(
                {
                    profile: {
                        "resultDigest": binding["result_digest"],
                        "resetId": binding["reset_id"],
                        "schemaAttestationDigest": binding[
                            "schema_attestation_digest"
                        ],
                        "stationRuntimeIdentity": binding[
                            "station_runtime_identity"
                        ],
                    }
                    for profile, binding in final_cut_bindings.items()
                },
                result["finalCutBindings"],
            )

    def test_rejects_result_root_inside_repository(self) -> None:
        selected = scenario(runtime_name="service")
        with self.assertRaisesRegex(run.RunnerError, "outside the repository"):
            run.execute_scenario(
                runtime="service",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=REPO_ROOT / "development",
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )

    def test_writes_source_result_outside_repository(self) -> None:
        selected = scenario(
            runtime_name="service",
            execute=lambda context: {
                "remaining": context.remaining_seconds() > 0,
            },
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = run.execute_scenario(
                runtime="service",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=root,
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )

            self.assertEqual("PASS", result["result"])
            self.assertEqual("UNPROVEN", result["proofState"])
            self.assertTrue((root / selected.evidence_path).is_file())

    def test_v3_manifest_is_bound_before_scenario_dispatch(self) -> None:
        called = False

        def execute(context: run.ScenarioContext) -> dict[str, Any]:
            nonlocal called
            called = True
            binding = context.require_runtime_manifest()
            self.assertEqual(
                "native-tauri",
                binding.client("desktop-alice")["runtime_kind"],
            )
            return {"manifestValidated": True}

        selected = scenario(execute=execute)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = write_v3_manifest(root)
            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("fiveArm", "four"),
                clients=("desktop-alice",),
                runtime_manifest_path=manifest_path,
                result_root=root / "results",
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected),
            )

            self.assertTrue(called)
            self.assertEqual("PASS", result["result"])
            self.assertEqual(
                result["runtimeManifestDigest"],
                json.loads(manifest_path.read_text())["manifest_digest"],
            )

    def test_invalid_v3_manifest_blocks_unproven_before_dispatch(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, Any]:
            nonlocal called
            called = True
            return {}

        selected = scenario(execute=execute)
        payload = v3_payload()
        payload["clients"][0]["runtime_kind"] = "physical-ios-device"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = write_v3_manifest(root, payload)
            with self.assertRaises(run.ScenarioBlocked) as raised:
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    runtime_manifest_path=manifest_path,
                    result_root=root / "results",
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )

            self.assertFalse(called)
            self.assertEqual("UNKNOWN_CLIENT_KIND", raised.exception.kind)
            result = json.loads(
                (root / "results" / selected.evidence_path).read_text()
            )
            self.assertEqual("BLOCKED", result["result"])
            self.assertEqual("UNPROVEN", result["proofState"])
            self.assertEqual("PRE_ACTION", result["firstFailure"]["stage"])

    def test_journey_fixture_capabilities_block_before_dispatch(self) -> None:
        called = False
        self.assertEqual(
            frozenset(manifest_fixtures.FIXTURE_CAPABILITIES),
            desktop_pilot.SCENARIO.required_fixture_capabilities,
        )

        def execute(_: run.ScenarioContext) -> dict[str, Any]:
            nonlocal called
            called = True
            return {}

        selected = run.ScenarioDefinition(
            scenario_id="fixture-preflight",
            journey_id="sc-dj-runtime-manifest-v3",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W7R/fixture-preflight/result.json"),
            execute=execute,
            required_fixture_capabilities=frozenset(
                {"journey-specific-capability"}
            ),
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = write_v3_manifest(root)
            with self.assertRaises(run.ScenarioBlocked) as raised:
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    runtime_manifest_path=manifest_path,
                    result_root=root / "results",
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            self.assertFalse(called)
            self.assertEqual(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                raised.exception.kind,
            )

    def test_fixture_action_uses_exact_handle_and_validates_acknowledgement(
        self,
    ) -> None:
        class FixtureClient:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str, Mapping[str, object]]] = []

            def invoke(
                self,
                capability: str,
                operation: str,
                payload: Mapping[str, object],
                *,
                timeout_seconds: float,
                request_id: str,
            ) -> Mapping[str, object]:
                del timeout_seconds, request_id
                self.calls.append((capability, operation, payload))
                acknowledgement: dict[str, object] = {
                    "schemaVersion": 1,
                    "capability": capability,
                    "operation": operation,
                    "handleId": payload["handleId"],
                    "expectedIdentityDigest": payload[
                        "expectedIdentityDigest"
                    ],
                    "runtimeManifestDigest": payload[
                        "runtimeManifestDigest"
                    ],
                    "outcome": {
                        "completed": True,
                        "fixtureIdentityDigest": payload[
                            "expectedIdentityDigest"
                        ],
                    },
                }
                acknowledgement["acknowledgementDigest"] = (
                    run._canonical_digest(acknowledgement)
                )
                return acknowledgement

        handle = {
            "kind": "account-switch-fixture",
            "opaque_id": "fixture-account-switch",
            "owner": "actor-session-provisioner",
            "capability": "account-switch",
            "expected_identity_digest": "c" * 64,
        }
        fixture_client = FixtureClient()
        context = run.ScenarioContext(
            repo_root=REPO_ROOT,
            scenario_id="fixture-action",
            journey_id="fixture-action",
            source_commit=IDENTITY["head"],
            session_id="secure-content-w7",
            declaration_id=f"secure-content-w7-{IDENTITY['workspaceId']}",
            runtime="desktop",
            profile="four",
            profiles=("four",),
            clients=(),
            budget_seconds=10,
            started_monotonic=time.monotonic(),
            runtime_manifest=runtime_manifest.RuntimeManifestBinding(
                path=Path("/tmp/runtime.json"),
                sha256="d" * 64,
                run_id="runtime-run",
                payload={},
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset({"account-switch"}),
                fixture_handles={"account-switch": handle},
                raw_bytes=b"runtime",
            ),
            fixture_action_client=fixture_client,  # type: ignore[arg-type]
        )

        acknowledgement = context.invoke_fixture_action(
            "account-switch",
            "round-trip",
        )

        self.assertTrue(acknowledgement["outcome"]["completed"])
        self.assertEqual(
            "fixture-account-switch",
            fixture_client.calls[0][2]["handleId"],
        )
        self.assertEqual("passed", context.checks[-1]["status"])

    def test_fixture_action_blocks_without_owner_channel(self) -> None:
        handle = {
            "kind": "account-switch-fixture",
            "opaque_id": "fixture-account-switch",
            "owner": "actor-session-provisioner",
            "capability": "account-switch",
            "expected_identity_digest": "c" * 64,
        }
        context = run.ScenarioContext(
            repo_root=REPO_ROOT,
            scenario_id="fixture-action",
            journey_id="fixture-action",
            source_commit=IDENTITY["head"],
            session_id="secure-content-w7",
            declaration_id=f"secure-content-w7-{IDENTITY['workspaceId']}",
            runtime="desktop",
            profile="four",
            profiles=("four",),
            clients=(),
            budget_seconds=10,
            started_monotonic=time.monotonic(),
            runtime_manifest=runtime_manifest.RuntimeManifestBinding(
                path=Path("/tmp/runtime.json"),
                sha256="d" * 64,
                run_id="runtime-run",
                payload={},
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset({"account-switch"}),
                fixture_handles={"account-switch": handle},
                raw_bytes=b"runtime",
            ),
        )

        with self.assertRaises(run.ScenarioBlocked) as raised:
            context.invoke_fixture_action("account-switch", "round-trip")

        self.assertEqual(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            raised.exception.kind,
        )

    def test_runtime_manifest_mutation_fails_pass_blocked_and_fail_paths(
        self,
    ) -> None:
        for outcome in ("pass", "blocked", "fail"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                manifest_path = write_v3_manifest(root)

                def execute(context: run.ScenarioContext) -> dict[str, Any]:
                    context.require_runtime_manifest().path.write_text(
                        "{}\n",
                        encoding="utf-8",
                    )
                    if outcome == "blocked":
                        context.block(
                            "runtime owner intervention required",
                            kind="DRIVER_FAILED",
                            owner="runtime-owner",
                            retryable=True,
                        )
                    if outcome == "fail":
                        raise run.RunnerError("scenario assertion failed")
                    return {}

                selected = scenario(execute=execute)
                with self.assertRaises(run.ScenarioBlocked) as raised:
                    run.execute_scenario(
                        runtime="desktop",
                        scenario_id=selected.scenario_id,
                        budget_seconds=10,
                        repo_root=REPO_ROOT,
                        profiles=("four", "fiveArm"),
                        clients=("desktop-alice",),
                        runtime_manifest_path=manifest_path,
                        result_root=root / "results",
                        registry={selected.scenario_id: selected},
                        workspace_identity=IDENTITY,
                        command_runner=control_plane_runner(selected),
                    )
                self.assertEqual(
                    "MUTABLE_MANIFEST_LINEAGE",
                    raised.exception.kind,
                )
                persisted = json.loads(
                    (root / "results" / selected.evidence_path).read_text()
                )
                self.assertEqual("BLOCKED", persisted["result"])
                self.assertEqual("UNPROVEN", persisted["proofState"])

    def test_restart_request_binds_parent_storage_and_resume(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            binding = load_v3_binding(write_v3_manifest(root))
            context = run.ScenarioContext(
                repo_root=REPO_ROOT,
                scenario_id="desktop-pilot",
                journey_id="sc-dj-desktop-pilot",
                source_commit=IDENTITY["head"],
                session_id="secure-content-w7",
                declaration_id=(
                    f"secure-content-w7-{IDENTITY['workspaceId']}"
                ),
                runtime="desktop",
                profile=None,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                budget_seconds=10,
                started_monotonic=time.monotonic(),
                runtime_manifest=binding,
                artifact_dir=root / "results",
            )
            context.write_bound_artifact_json(
                "desktop-pilot-resume.json",
                "secure-content-desktop-pilot-resume",
                {"postId": "post-1"},
            )

            with self.assertRaises(run.ScenarioBlocked) as raised:
                context.request_restart(
                    "desktop-alice",
                    reason="owner restart required",
                )
            self.assertEqual(
                "BLOCKED_RUNTIME_ACTION_REQUIRED",
                raised.exception.kind,
            )
            request = json.loads(
                context.artifact_path(
                    "restart-request-desktop-alice.json"
                ).read_text()
            )
            self.assertEqual(binding.sha256, request["parent_runtime_manifest_digest"])
            self.assertEqual(
                binding.client("desktop-alice")["storage_identity_digest"],
                request["retained_storage_identity_digest"],
            )
            self.assertRegex(request["resume_artifact_digest"], r"^[0-9a-f]{64}$")

    def test_owner_continuation_validates_control_plane_before_resume_consumption(
        self,
    ) -> None:
        selected = scenario()
        for mutation in ("none", "request-resume-digest", "ack-lease"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                parent_path = write_manifest_for_scenario(
                    root,
                    selected,
                    run_id=f"parent-{mutation}",
                )
                parent = load_scenario_binding(parent_path, selected)
                artifact_dir = root / "results" / selected.evidence_path.parent
                result_path = artifact_dir / "result.json"
                parent_context = run.ScenarioContext(
                    repo_root=REPO_ROOT,
                    scenario_id=selected.scenario_id,
                    journey_id=selected.journey_id,
                    source_commit=IDENTITY["head"],
                    session_id=selected.work_item_id,
                    declaration_id=(
                        f"{selected.work_item_id}-{IDENTITY['workspaceId']}"
                    ),
                    runtime="desktop",
                    profile=None,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    budget_seconds=10,
                    started_monotonic=time.monotonic(),
                    runtime_manifest=parent,
                    artifact_dir=artifact_dir,
                    result_path=result_path,
                )
                resume_path = parent_context.write_bound_artifact_json(
                    "runtime-v3-test-resume.json",
                    "secure-content-runtime-v3-resume",
                    {"stateDigest": "e" * 64},
                )
                with self.assertRaises(run.ScenarioBlocked):
                    parent_context.request_restart(
                        "desktop-alice",
                        reason="integration continuation test",
                    )
                request_path = parent_context.artifact_path(
                    "restart-request-desktop-alice.json"
                )
                request = json.loads(request_path.read_text())
                request_id = str(request["request_id"])
                run._write_json_atomic(
                    result_path,
                    {
                        "kind": run.RESULT_KIND,
                        "result": "BLOCKED",
                        "scenarioId": selected.scenario_id,
                        "journeyId": selected.journey_id,
                        "runtime": "desktop",
                        "sourceCommit": IDENTITY["head"],
                        "runtimeManifestDigest": parent.sha256,
                        "runtimeManifestRef": str(parent.path),
                        "firstFailure": {
                            "kind": "BLOCKED_RUNTIME_ACTION_REQUIRED"
                        },
                    },
                )

                child_path = write_manifest_for_scenario(
                    root,
                    selected,
                    run_id=f"child-{mutation}",
                    parent=parent,
                    restart_request_id=request_id,
                )
                child = load_scenario_binding(child_path, selected)
                continuation = child.payload["continuation"]
                child_client = child.client("desktop-alice")
                acknowledgement = {
                    "schema_version": 1,
                    "kind": (
                        runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND
                    ),
                    "request_id": request_id,
                    "owner_id": runtime_manifest.RUNTIME_OWNER_ID,
                    "acknowledgement_id": continuation[
                        "runtime_owner_acknowledgement_id"
                    ],
                    "parent_runtime_manifest_digest": parent.sha256,
                    "child_runtime_manifest_digest": child.sha256,
                    "previous_boot_identity": parent.client(
                        "desktop-alice"
                    )["boot_identity"],
                    "current_boot_identity": child_client["boot_identity"],
                    "session_generation": child_client[
                        "session_generation"
                    ],
                    "retained_storage_identity_digest": child_client[
                        "storage_identity_digest"
                    ],
                    "lease_evidence_ref": continuation[
                        "lease_evidence_ref"
                    ],
                }
                acknowledgement["artifact_digest"] = (
                    runtime_manifest.canonical_digest(acknowledgement)
                )
                if mutation == "request-resume-digest":
                    request["resume_artifact_digest"] = "f" * 64
                    request.pop("artifactDigest")
                    request["artifactDigest"] = run._canonical_digest(request)
                    run._write_json_atomic(request_path, request)
                elif mutation == "ack-lease":
                    acknowledgement["lease_evidence_ref"] = {
                        "path": "leases/wrong.json",
                        "sha256": "f" * 64,
                    }
                    acknowledgement["artifact_digest"] = (
                        runtime_manifest.canonical_digest(
                            {
                                key: value
                                for key, value in acknowledgement.items()
                                if key != "artifact_digest"
                            }
                        )
                    )
                acknowledgement_path = parent_context.artifact_path(
                    "restart-acknowledgement-desktop-alice.json"
                )
                run._write_json_immutable(
                    acknowledgement_path,
                    acknowledgement,
                )

                child_context = run.ScenarioContext(
                    repo_root=REPO_ROOT,
                    scenario_id=selected.scenario_id,
                    journey_id=selected.journey_id,
                    source_commit=IDENTITY["head"],
                    session_id=selected.work_item_id,
                    declaration_id=(
                        f"{selected.work_item_id}-{IDENTITY['workspaceId']}"
                    ),
                    runtime="desktop",
                    profile=None,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    budget_seconds=10,
                    started_monotonic=time.monotonic(),
                    runtime_manifest=child,
                    artifact_dir=artifact_dir,
                    result_path=result_path,
                )
                if mutation == "none":
                    consumed = child_context.consume_owner_continuation(
                        resume_path,
                        client_id="desktop-alice",
                        kind="secure-content-runtime-v3-resume",
                        producer_scenario_id=selected.scenario_id,
                        producer_journey_id=selected.journey_id,
                        producer_runtime="desktop",
                    )
                    self.assertEqual("e" * 64, consumed["stateDigest"])
                    self.assertEqual(
                        2,
                        len(child_context.pending_consumption_receipts),
                    )
                    competing_context = run.ScenarioContext(
                        repo_root=REPO_ROOT,
                        scenario_id=selected.scenario_id,
                        journey_id=selected.journey_id,
                        source_commit=IDENTITY["head"],
                        session_id=selected.work_item_id,
                        declaration_id=(
                            f"{selected.work_item_id}-"
                            f"{IDENTITY['workspaceId']}"
                        ),
                        runtime="desktop",
                        profile=None,
                        profiles=("four", "fiveArm"),
                        clients=("desktop-alice",),
                        budget_seconds=10,
                        started_monotonic=time.monotonic(),
                        runtime_manifest=child,
                        artifact_dir=artifact_dir,
                        result_path=result_path,
                    )
                    with self.assertRaisesRegex(
                        run.RunnerError,
                        "consumption claim already exists",
                    ):
                        competing_context.consume_owner_continuation(
                            resume_path,
                            client_id="desktop-alice",
                            kind="secure-content-runtime-v3-resume",
                            producer_scenario_id=selected.scenario_id,
                            producer_journey_id=selected.journey_id,
                            producer_runtime="desktop",
                        )
                    child_context.verify_continuation_unchanged()
                    run._write_json_atomic(
                        acknowledgement_path,
                        {
                            **acknowledgement,
                            "lease_evidence_ref": {
                                "path": "leases/rewritten.json",
                                "sha256": "e" * 64,
                            },
                        },
                    )
                    with self.assertRaises(
                        runtime_manifest.RuntimeManifestError
                    ):
                        child_context.verify_continuation_unchanged()
                else:
                    with self.assertRaises(
                        runtime_manifest.RuntimeManifestError
                    ) as raised:
                        child_context.consume_owner_continuation(
                            resume_path,
                            client_id="desktop-alice",
                            kind="secure-content-runtime-v3-resume",
                            producer_scenario_id=selected.scenario_id,
                            producer_journey_id=selected.journey_id,
                            producer_runtime="desktop",
                        )
                    self.assertEqual(
                        "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                        raised.exception.code,
                    )
                    self.assertEqual(
                        [],
                        child_context.pending_consumption_receipts,
                    )

    def test_bound_artifact_is_immutable_and_consumed_once(self) -> None:
        artifact_path: Path | None = None

        def produce(context: run.ScenarioContext) -> dict[str, Any]:
            nonlocal artifact_path
            artifact_path = context.write_bound_artifact_json(
                "handoff.json",
                "secure-content-test-handoff",
                {"postId": "post-1"},
            )
            return {}

        producer = run.ScenarioDefinition(
            scenario_id="artifact-producer",
            journey_id="journey-producer",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W7R/producer/result.json"),
            execute=produce,
        )
        consumed = 0

        def consume(context: run.ScenarioContext) -> dict[str, Any]:
            nonlocal consumed
            assert artifact_path is not None
            payload = context.consume_bound_artifact_json(
                artifact_path,
                kind="secure-content-test-handoff",
                producer_scenario_id=producer.scenario_id,
                producer_journey_id=producer.journey_id,
                producer_runtime="desktop",
            )
            self.assertEqual("post-1", payload["postId"])
            consumed += 1
            return {}

        consumer = run.ScenarioDefinition(
            scenario_id="artifact-consumer",
            journey_id="journey-consumer",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W7R/consumer/result.json"),
            execute=consume,
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            parent_path = write_manifest_for_scenario(
                root,
                producer,
                run_id="producer-run",
            )
            run.execute_scenario(
                runtime="desktop",
                scenario_id=producer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=parent_path,
                result_root=root / "results",
                registry={producer.scenario_id: producer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(producer),
            )
            assert artifact_path is not None
            original = artifact_path.read_bytes()
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=producer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    runtime_manifest_path=parent_path,
                    result_root=root / "results",
                    registry={producer.scenario_id: producer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(producer),
                )
            self.assertEqual(original, artifact_path.read_bytes())

            parent = load_scenario_binding(parent_path, producer)
            time.sleep(0.002)
            child_path = write_manifest_for_scenario(
                root,
                consumer,
                run_id="consumer-run",
                parent=parent,
            )
            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=consumer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=child_path,
                result_root=root / "results",
                registry={consumer.scenario_id: consumer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(consumer),
            )
            receipt = artifact_path.with_name("handoff.consumed.json")
            self.assertEqual(1, consumed)
            self.assertTrue(receipt.is_file())
            self.assertIn(str(receipt), result["artifactRefs"])

            time.sleep(0.002)
            replay_path = write_manifest_for_scenario(
                root,
                consumer,
                run_id="consumer-replay-run",
                parent=parent,
            )
            with self.assertRaisesRegex(
                run.RunnerError,
                "prepared result journal identity is invalid",
            ):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=consumer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    runtime_manifest_path=replay_path,
                    result_root=root / "results",
                    registry={consumer.scenario_id: consumer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(consumer),
                )

    def test_prepared_result_recovers_after_result_publication_interruption(
        self,
    ) -> None:
        artifact_path: Path | None = None

        def produce(context: run.ScenarioContext) -> dict[str, Any]:
            nonlocal artifact_path
            artifact_path = context.write_bound_artifact_json(
                "crash-handoff.json",
                "secure-content-test-handoff",
                {"postId": "post-crash"},
            )
            return {}

        producer = run.ScenarioDefinition(
            scenario_id="crash-producer",
            journey_id="journey-producer",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W7R/crash-producer/result.json"),
            execute=produce,
        )
        executed = 0

        def consume(context: run.ScenarioContext) -> dict[str, Any]:
            nonlocal executed
            executed += 1
            assert artifact_path is not None
            context.consume_bound_artifact_json(
                artifact_path,
                kind="secure-content-test-handoff",
                producer_scenario_id=producer.scenario_id,
                producer_journey_id=producer.journey_id,
                producer_runtime="desktop",
            )
            return {}

        consumer = run.ScenarioDefinition(
            scenario_id="crash-consumer",
            journey_id="journey-consumer",
            work_item_id="secure-content-w7r",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W7R/crash-consumer/result.json"),
            execute=consume,
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            parent_path = write_manifest_for_scenario(
                root,
                producer,
                run_id="crash-producer-run",
            )
            run.execute_scenario(
                runtime="desktop",
                scenario_id=producer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=parent_path,
                result_root=root / "results",
                registry={producer.scenario_id: producer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(producer),
            )
            parent = load_scenario_binding(parent_path, producer)
            time.sleep(0.002)
            child_path = write_manifest_for_scenario(
                root,
                consumer,
                run_id="crash-consumer-run",
                parent=parent,
            )
            result_path = root / "results" / consumer.evidence_path
            original_write = run._write_json_atomic

            def interrupt(path: Path, value: Mapping[str, Any]) -> None:
                if path.resolve() == result_path.resolve():
                    raise OSError("simulated result publication interruption")
                original_write(path, value)

            with patch.object(
                run,
                "_write_json_atomic",
                side_effect=interrupt,
            ), self.assertRaisesRegex(
                OSError,
                "simulated result publication interruption",
            ):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=consumer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profiles=("four", "fiveArm"),
                    clients=("desktop-alice",),
                    runtime_manifest_path=child_path,
                    result_root=root / "results",
                    registry={consumer.scenario_id: consumer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(consumer),
                )
            self.assertEqual(1, executed)
            self.assertFalse(result_path.exists())
            self.assertTrue(
                result_path.with_name("result.prepared.json").is_file()
            )

            recovered = run.execute_scenario(
                runtime="desktop",
                scenario_id=consumer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                clients=("desktop-alice",),
                runtime_manifest_path=child_path,
                result_root=root / "results",
                registry={consumer.scenario_id: consumer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(consumer),
            )
            self.assertEqual(1, executed)
            self.assertEqual("PASS", recovered["result"])

    def test_immutable_file_survives_directory_sync_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "receipt.json"
            with patch.object(
                run,
                "_fsync_directory",
                side_effect=run.RunnerError("simulated directory sync failure"),
            ), self.assertRaisesRegex(
                run.RunnerError,
                "simulated directory sync failure",
            ):
                run._write_json_immutable(
                    path,
                    {"schemaVersion": 1, "kind": "test-receipt"},
                )
            self.assertTrue(path.is_file())

    def test_bound_artifact_rejects_manifest_captured_before_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            producer_binding = runtime_manifest.RuntimeManifestBinding(
                path=root / "producer.json",
                sha256="a" * 64,
                run_id="producer-run",
                payload={"created_at": "2026-09-15T10:00:00.000Z"},
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset(),
                fixture_handles={},
                raw_bytes=b"producer",
            )
            producer = run.ScenarioContext(
                repo_root=REPO_ROOT,
                scenario_id="artifact-producer",
                journey_id="journey-producer",
                source_commit=IDENTITY["head"],
                session_id="secure-content-w7r",
                declaration_id=f"secure-content-w7r-{IDENTITY['workspaceId']}",
                runtime="desktop",
                profile="four",
                profiles=("four",),
                clients=(),
                budget_seconds=10,
                started_monotonic=time.monotonic(),
                runtime_manifest=producer_binding,
                artifact_dir=root,
            )
            artifact = producer.write_bound_artifact_json(
                "stale-handoff.json",
                "secure-content-test-handoff",
                {"postId": "post-1"},
            )
            consumer = run.ScenarioContext(
                repo_root=REPO_ROOT,
                scenario_id="artifact-consumer",
                journey_id="journey-consumer",
                source_commit=IDENTITY["head"],
                session_id="secure-content-w7r",
                declaration_id=f"secure-content-w7r-{IDENTITY['workspaceId']}",
                runtime="desktop",
                profile="four",
                profiles=("four",),
                clients=(),
                budget_seconds=10,
                started_monotonic=time.monotonic(),
                runtime_manifest=runtime_manifest.RuntimeManifestBinding(
                    path=root / "consumer.json",
                    sha256="b" * 64,
                    run_id="consumer-run",
                    payload={
                        "created_at": "2026-09-15T09:59:59.999Z",
                        "continuation": {
                            "parent_manifest_digest": "a" * 64,
                        },
                    },
                    clients={},
                    services={},
                    service_profiles=frozenset({"four"}),
                    fixture_capabilities=frozenset(),
                    fixture_handles={},
                    raw_bytes=b"consumer",
                ),
                artifact_dir=root,
            )
            with self.assertRaisesRegex(run.RunnerError, "fresh runtime manifest"):
                consumer.consume_bound_artifact_json(
                    artifact,
                    kind="secure-content-test-handoff",
                    producer_scenario_id="artifact-producer",
                    producer_journey_id="journey-producer",
                    producer_runtime="desktop",
                )

    def test_redacts_result_artifact_and_blocked_persistence(self) -> None:
        secret = "secret-bearer-value"

        def execute(context: run.ScenarioContext) -> dict[str, Any]:
            context.write_artifact_json(
                "diagnostic.json",
                {"authorization": f"Bearer {secret}"},
            )
            context.block(
                f"token={secret}",
                kind="DRIVER_FAILED",
                owner="runtime-owner",
                retryable=True,
            )

        selected = scenario(runtime_name="service", execute=execute)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(run.ScenarioBlocked):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=root,
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            persisted = (
                root / selected.evidence_path
            ).read_text(encoding="utf-8")
            artifact = (
                root / selected.evidence_path.parent / "diagnostic.json"
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, artifact)
            self.assertIn("[REDACTED]", persisted)

    def test_failure_evidence_does_not_persist_exception_secrets(self) -> None:
        secret = "secret-bearer-value"
        selected = scenario(
            runtime_name="service",
            execute=lambda _: (_ for _ in ()).throw(
                run.RunnerError(f"Authorization: Bearer {secret}")
            ),
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=root,
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            persisted = (
                root / selected.evidence_path
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertIn("Authorization: [REDACTED]", persisted)
            self.assertNotIn("scenario execution failed", persisted)

    def test_failure_evidence_preserves_redacted_harness_error(self) -> None:
        secret = "secret-harness-value"
        selected = scenario(
            runtime_name="service",
            execute=lambda _: (_ for _ in ()).throw(
                GateError(
                    "harness moments.publishFriendsDraft failed: "
                    f"Authorization: Bearer {secret}"
                )
            ),
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=root,
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            persisted = (
                root / selected.evidence_path
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertIn(
                "harness moments.publishFriendsDraft failed: "
                "Authorization: [REDACTED]",
                persisted,
            )
            self.assertNotIn("scenario execution failed", persisted)

    def test_environment_blocker_writes_blocked_result(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, Any]:
            context.block(
                "required service unavailable",
                kind="DRIVER_FAILED",
                owner="local-dev-control-plane",
                retryable=True,
            )

        selected = scenario(runtime_name="service", execute=execute)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(run.ScenarioBlocked):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=root,
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            result = json.loads(
                (root / selected.evidence_path).read_text()
            )
            self.assertEqual("BLOCKED", result["result"])
            self.assertTrue(result["firstFailure"]["retryable"])

    def test_requires_exactly_one_active_current_workspace_declaration(self) -> None:
        selected = scenario(runtime_name="service")
        declarations = [
            active_declaration(selected, digest="a" * 64),
            active_declaration(selected, digest="b" * 64),
        ]
        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "exactly one active current-workspace declaration",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(
                    selected,
                    declarations=declarations,
                ),
            )

    def test_budget_exhaustion_writes_failed_result(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, Any]:
            context.started_monotonic = (
                time.monotonic() - context.budget_seconds
            )
            return {}

        selected = scenario(runtime_name="service", execute=execute)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=selected.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=root,
                    registry={selected.scenario_id: selected},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(selected),
                )
            result = json.loads(
                (root / selected.evidence_path).read_text()
            )
            self.assertEqual("TIMEOUT", result["firstFailure"]["kind"])

    def test_rejects_any_dirty_source_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, Any]:
            nonlocal called
            called = True
            return {}

        selected = scenario(runtime_name="service", execute=execute)
        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "checkpoint before FUNCTIONAL_CHECK",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=selected.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={selected.scenario_id: selected},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(selected, dirty=True),
            )
        self.assertFalse(called)

    def test_desktop_pilot_fails_closed_at_design_amendment_boundary(self) -> None:
        def block(
            message: str,
            *,
            kind: str,
            owner: str,
            retryable: bool,
        ) -> None:
            raise run.ScenarioBlocked(
                message,
                kind=kind,
                owner=owner,
                retryable=retryable,
            )

        context = SimpleNamespace(
            runtime_manifest=None,
            block=block,
        )
        with patch.object(
            desktop_pilot,
            "_load_resume_artifact",
        ) as load_resume, self.assertRaises(run.ScenarioBlocked) as raised:
            desktop_pilot._execute(context)

        self.assertEqual("DRIVER_FAILED", raised.exception.kind)
        self.assertEqual("secure-content-w7-runtime", raised.exception.owner)
        self.assertTrue(raised.exception.retryable)
        self.assertIn("immutable external runtime manifest", str(raised.exception))
        load_resume.assert_not_called()

    def test_desktop_pilot_preserves_bounded_readback_failure_state(self) -> None:
        with self.assertRaisesRegex(
            run.RunnerError,
            (
                "Bob private Moment did not reach CONTENT_READY "
                r"\(state=CONTENT_UNAVAILABLE; errorCode=KEY_NOT_FOUND\)"
            ),
        ):
            desktop_pilot._require_projection_state(
                {
                    "state": "CONTENT_UNAVAILABLE",
                    "errorCode": "KEY_NOT_FOUND",
                },
                "CONTENT_READY",
                "Bob private Moment did not reach CONTENT_READY",
            )

        with self.assertRaises(run.RunnerError) as raised:
            desktop_pilot._require_projection_state(
                {
                    "state": "contains secret material",
                },
                "CONTENT_READY",
                "Bob private Moment did not reach CONTENT_READY",
            )
        self.assertIn(
            "state=<redacted>; errorCode=<missing>",
            str(raised.exception),
        )
        self.assertNotIn("secret material", str(raised.exception))

    def test_desktop_pilot_stages_private_draft_after_public_control(self) -> None:
        calls: list[tuple[str, str]] = []

        class RestartRequested(RuntimeError):
            pass

        class Client:
            def __init__(self, client_id: str) -> None:
                self.client_id = client_id

            def __enter__(self) -> Client:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def snapshot(self) -> Mapping[str, Any]:
                return {
                    "platform": "native",
                    "nativeRuntimeIdentitySha256": hashlib.sha256(
                        self.client_id.encode("utf-8")
                    ).hexdigest(),
                }

            def call(
                self,
                method: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Mapping[str, Any]:
                del payload
                calls.append((self.client_id, method))
                if method == "publishPublicMoment":
                    return {
                        "published": True,
                        "mediaCount": 1,
                        "textSha256": desktop_pilot._sha256(
                            desktop_pilot.PUBLIC_TEXT
                        ),
                    }
                if method == "stageFriendsDraft":
                    return {
                        "present": True,
                        "textSha256": desktop_pilot._sha256(
                            desktop_pilot.PRIVATE_TEXT
                        ),
                        "fileCount": 1,
                    }
                if method == "readPrivateMoment":
                    if self.client_id.endswith("bob"):
                        return {
                            "state": "CONTENT_READY",
                            "textSha256": desktop_pilot._sha256(
                                desktop_pilot.PRIVATE_TEXT
                            ),
                            "media": [{
                                "state": "MEDIA_READY",
                                "plaintextSha256": desktop_pilot._sha256(
                                    desktop_pilot.PNG_BYTES
                                ),
                            }],
                        }
                    return {"state": "NOT_FOUND_OR_NOT_AUTHORIZED"}
                if method == "clearLocalState":
                    return {}
                raise AssertionError(f"unexpected method: {method}")

        clients = {
            client_id: Client(client_id)
            for client_id in desktop_pilot.EXPECTED_CLIENTS
        }
        with tempfile.TemporaryDirectory() as temp:
            artifact_root = Path(temp)
            manifest = SimpleNamespace(
                sha256="a" * 64,
                service_for_client=lambda *_args: (
                    "station-four",
                    {"endpoint": "http://station.example"},
                ),
            )

            def write_artifact_bytes(
                name: str,
                value: bytes,
                *,
                durable: bool,
            ) -> Path:
                self.assertFalse(durable)
                path = artifact_root / name
                path.write_bytes(value)
                return path

            context = SimpleNamespace(
                artifact_path=lambda name: artifact_root / name,
                budget_seconds=1200,
                clients=desktop_pilot.EXPECTED_CLIENTS,
                profile=None,
                profiles=desktop_pilot.EXPECTED_PROFILES,
                request_restart=lambda *_args, **_kwargs: (
                    (_ for _ in ()).throw(RestartRequested())
                ),
                require_runtime_manifest=lambda: manifest,
                runtime="desktop",
                runtime_manifest=manifest,
                write_artifact_bytes=write_artifact_bytes,
                write_bound_artifact_json=lambda *_args, **_kwargs: None,
            )

            def publish(
                client: Client,
                method: str,
                **_: object,
            ) -> Mapping[str, Any]:
                calls.append((client.client_id, method))
                return {
                    "state": "PUBLISHED",
                    "transientPostId": "private-post-1",
                }

            with (
                patch.object(
                    desktop_pilot,
                    "AttachedProductClient",
                    side_effect=lambda _context, client_id: clients[client_id],
                ),
                patch.object(
                    desktop_pilot,
                    "_invalid_token_status",
                    return_value=401,
                ),
                patch.object(
                    desktop_pilot,
                    "_load_resume_artifact",
                    return_value=None,
                ),
                patch.object(
                    desktop_pilot,
                    "_require_runtime_binding",
                ),
                patch.object(
                    desktop_pilot,
                    "reconcile_private_moment_publish",
                    side_effect=publish,
                ),
                self.assertRaises(RestartRequested),
            ):
                desktop_pilot._execute(context)

        alice_methods = [
            method
            for client_id, method in calls
            if client_id == desktop_pilot.EXPECTED_CLIENTS[0]
        ]
        self.assertLess(
            alice_methods.index("publishPublicMoment"),
            alice_methods.index("stageFriendsDraft"),
        )
        self.assertLess(
            alice_methods.index("stageFriendsDraft"),
            alice_methods.index("publishFriendsDraft"),
        )


class RuntimeAttachmentManifestTest(unittest.TestCase):
    @staticmethod
    def _driver(session_id: str) -> SimpleNamespace:
        return SimpleNamespace(
            session_id=session_id,
            execute_async_script=lambda *_args, **_kwargs: None,
        )

    def test_owner_publishes_one_immutable_attached_v3_manifest(self) -> None:
        payload = v3_payload()
        payload.pop("manifest_digest")
        snapshots: dict[str, Mapping[str, Any]] = {}
        sessions: dict[str, SimpleNamespace] = {}
        attachments: dict[str, Mapping[str, Any]] = {}
        for index, client in enumerate(payload["clients"]):
            client_id = client["id"]
            session_id = f"owner-session-{index}"
            sessions[client_id] = self._driver(session_id)
            attachments[client_id] = {
                "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                "endpoint": f"http://127.0.0.1:{4600 + index}",
                "session_id": session_id,
            }
            client["automation_attachment_ref"] = attachments[client_id]
            snapshots[session_id] = manifest_fixtures.identity_snapshot(
                payload,
                client_id,
            )
            client.pop("automation_attachment_ref")
            client.pop("harness_identity_digest")

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seed = copy.deepcopy(payload)
            for client in seed["clients"]:
                client["automation_attachment_ref"] = attachments[client["id"]]
                manifest_fixtures.bind_identity_snapshot(
                    seed,
                    client["id"],
                    dict(
                        snapshots[
                            attachments[client["id"]]["session_id"]
                        ]
                    ),
                )
            manifest_fixtures.write_manifest(root, seed)
            payload["services"] = seed["services"]
            payload["fixture_manifest_ref"] = seed["fixture_manifest_ref"]
            payload["fixture_manifest_digest"] = seed["fixture_manifest_digest"]
            original = copy.deepcopy(payload)
            output = root / "owner-runtime-v3.json"
            with patch.object(
                attached_client,
                "harness_ready",
                return_value=True,
            ), patch.object(
                attached_client,
                "call_async_harness",
                side_effect=lambda driver, *_args, **_kwargs: snapshots[
                    driver.session_id
                ],
            ):
                result = attached_client.write_attached_runtime_manifest(
                    manifest_payload=payload,
                    output_path=output,
                    journey_id="sc-dj-runtime-manifest-v3",
                    sessions_by_client=sessions,
                    automation_refs_by_client=attachments,
                    repo_root=REPO_ROOT,
                )

            self.assertEqual(output.resolve(), result)
            self.assertEqual(original, payload)
            self.assertEqual(0o600, os.stat(output).st_mode & 0o777)
            published = json.loads(output.read_text())
            self.assertEqual(3, published["schema_version"])
            self.assertNotIn("profile", published)
            self.assertNotIn("developmentAttachment", published)
            load_v3_binding(output)
            original_bytes = output.read_bytes()
            with self.assertRaisesRegex(run.RunnerError, "already exists"):
                attached_client.write_attached_runtime_manifest(
                    manifest_payload=payload,
                    output_path=output,
                    journey_id="sc-dj-runtime-manifest-v3",
                    sessions_by_client=sessions,
                    automation_refs_by_client=attachments,
                    repo_root=REPO_ROOT,
                )
            self.assertEqual(original_bytes, output.read_bytes())

    def test_owner_attachment_requires_exact_session_closure(self) -> None:
        payload = v3_payload()
        payload.pop("manifest_digest")
        clients = payload["clients"]
        for client in clients:
            client.pop("automation_attachment_ref")
            client.pop("harness_identity_digest")
        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "exactly match manifest clients",
        ):
            attached_client.write_attached_runtime_manifest(
                manifest_payload=payload,
                output_path=Path(temp) / "runtime.json",
                journey_id="sc-dj-runtime-manifest-v3",
                sessions_by_client={},
                automation_refs_by_client={},
                repo_root=REPO_ROOT,
            )


class AttachedProductClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.capture_timing = (
            patch.object(
                attached_client,
                "NETWORK_CAPTURE_TIMEOUT_SECONDS",
                0.05,
            ),
            patch.object(
                attached_client,
                "NETWORK_CAPTURE_POLL_SECONDS",
                0.0005,
            ),
        )
        for timing in self.capture_timing:
            timing.start()

    def tearDown(self) -> None:
        for timing in reversed(self.capture_timing):
            timing.stop()

    def test_private_publish_reconciles_unknown_commit_with_same_action(
        self,
    ) -> None:
        calls: list[str] = []
        responses = iter(
            (
                {"state": "UNKNOWN_COMMIT"},
                {"state": "PUBLISHED", "transientPostId": "post-1"},
            )
        )
        client = SimpleNamespace(
            context=SimpleNamespace(remaining_seconds=lambda: 10.0),
            call=lambda method: calls.append(method) or next(responses),
        )

        with patch.object(attached_client.time, "sleep") as sleep:
            result = attached_client.reconcile_private_moment_publish(
                client,
                "publishFriendsDraft",
                label="test publish",
            )

        self.assertEqual("PUBLISHED", result["state"])
        self.assertEqual(
            ["publishFriendsDraft", "publishFriendsDraft"],
            calls,
        )
        sleep.assert_called_once_with(0.25)

    def test_private_publish_does_not_retry_terminal_state(self) -> None:
        calls: list[str] = []
        client = SimpleNamespace(
            context=SimpleNamespace(remaining_seconds=lambda: 10.0),
            call=lambda method: (
                calls.append(method)
                or {"state": "PUBLISH_FAILED", "errorCode": "REJECTED"}
            ),
        )

        with patch.object(attached_client.time, "sleep") as sleep:
            result = attached_client.reconcile_private_moment_publish(
                client,
                "publishFriendsDraft",
                label="test publish",
            )

        self.assertEqual("PUBLISH_FAILED", result["state"])
        self.assertEqual(["publishFriendsDraft"], calls)
        sleep.assert_not_called()

    def test_private_publish_fails_after_bounded_unknown_commit_retries(
        self,
    ) -> None:
        calls: list[str] = []
        client = SimpleNamespace(
            context=SimpleNamespace(remaining_seconds=lambda: 10.0),
            call=lambda method: (
                calls.append(method) or {"state": "UNKNOWN_COMMIT"}
            ),
        )

        with (
            patch.object(attached_client.time, "sleep") as sleep,
            self.assertRaisesRegex(
                run.RunnerError,
                "remained UNKNOWN_COMMIT after 3 attempts",
            ),
        ):
            attached_client.reconcile_private_moment_publish(
                client,
                "publishFriendsDraft",
                label="test publish",
            )

        self.assertEqual(
            ["publishFriendsDraft"] * 3,
            calls,
        )
        self.assertEqual(2, sleep.call_count)

    def _context_and_snapshot(
        self,
    ) -> tuple[run.ScenarioContext, Mapping[str, Any]]:
        payload = v3_payload()
        snapshot = manifest_fixtures.identity_snapshot(
            payload,
            "desktop-alice",
        )
        manifest_fixtures.bind_identity_snapshot(
            payload,
            "desktop-alice",
            snapshot,
        )
        with tempfile.TemporaryDirectory() as temp:
            binding = load_v3_binding(write_v3_manifest(Path(temp), payload))
        context = run.ScenarioContext(
            repo_root=REPO_ROOT,
            scenario_id="attached-client",
            journey_id="sc-dj-runtime-manifest-v3",
            source_commit=IDENTITY["head"],
            session_id="secure-content-w7r",
            declaration_id=(
                f"secure-content-w7r-{IDENTITY['workspaceId']}"
            ),
            runtime="desktop",
            profile=None,
            profiles=("four", "fiveArm"),
            clients=("desktop-alice",),
            budget_seconds=10,
            started_monotonic=time.monotonic(),
            runtime_manifest=binding,
        )
        return context, snapshot

    def test_live_harness_identity_must_match_manifest(self) -> None:
        context, snapshot = self._context_and_snapshot()
        client = attached_client.AttachedProductClient(
            context,
            "desktop-alice",
        )
        client._driver = SimpleNamespace(session_id="session-desktop-alice")
        with patch.object(client, "_raw_call", return_value=snapshot):
            self.assertEqual("native", client.snapshot()["platform"])
        with patch.object(
            client,
            "_raw_call",
            return_value={
                **snapshot,
                "draft": {"present": True},
                "publishState": "PUBLISHED",
                "privateProjectionCount": 5,
            },
        ):
            self.assertEqual("native", client.snapshot()["platform"])
        with patch.object(
            client,
            "_raw_call",
            return_value={**snapshot, "clientArtifactSha256": "f" * 64},
        ), self.assertRaisesRegex(run.RunnerError, "Harness identity"):
            client.snapshot()

    def test_non_snapshot_operations_are_fenced_by_full_live_identity(self) -> None:
        context, snapshot = self._context_and_snapshot()
        client = attached_client.AttachedProductClient(
            context,
            "desktop-alice",
        )
        client._driver = SimpleNamespace(session_id="session-desktop-alice")
        with patch.object(
            client,
            "_raw_call",
            side_effect=[
                snapshot,
                {"ok": True},
                {**snapshot, "sessionIdentitySha256": "f" * 64},
            ],
        ) as call, self.assertRaisesRegex(
            run.RunnerError,
            "Harness identity",
        ):
            client.call("stageFriendsDraft", {"draftId": "draft-1"})
        self.assertEqual(
            ["snapshot", "stageFriendsDraft", "snapshot"],
            [invocation.args[0] for invocation in call.call_args_list],
        )

    def test_attached_driver_quit_only_detaches_transport(self) -> None:
        class Executor:
            def __init__(self) -> None:
                self.closed = False

            def close(self) -> None:
                self.closed = True

        executor = Executor()
        driver = object.__new__(attached_client._AttachedRemoteWebDriver)
        driver.command_executor = executor
        driver.session_id = "externally-owned-session"
        driver.quit()

        self.assertTrue(executor.closed)
        self.assertIsNone(driver.session_id)

    def test_attached_driver_start_retains_only_required_cdp_capability(
        self,
    ) -> None:
        driver = object.__new__(attached_client._AttachedRemoteWebDriver)
        driver._attached_session_id = "externally-owned-session"
        driver.session_id = None
        driver.caps = {"unexpected": True}

        driver.start_session(
            {
                "browserName": "chrome",
                "acceptInsecureCerts": True,
            }
        )

        self.assertEqual("externally-owned-session", driver.session_id)
        self.assertEqual({"browserName": "chrome"}, driver.caps)
        with patch.object(
            driver,
            "execute",
            return_value={"value": {"enabled": True}},
        ) as execute:
            self.assertEqual(
                {"enabled": True},
                driver.execute_cdp_cmd("Network.enable", {}),
            )
        execute.assert_called_once_with(
            "executeCdpCommand",
            {"cmd": "Network.enable", "params": {}},
        )

    def test_attached_driver_reads_performance_log_via_webdriver_command(
        self,
    ) -> None:
        driver = object.__new__(attached_client._AttachedRemoteWebDriver)
        entries = [{"message": "{\"message\":{}}"}]

        with patch.object(
            driver,
            "execute",
            return_value={"value": entries},
        ) as execute:
            self.assertEqual(entries, driver.get_log("performance"))

        execute.assert_called_once_with("getLog", {"type": "performance"})

    def test_network_capture_rejects_streams_without_terminal_barrier(self) -> None:
        entry = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.webSocketFrameReceived",
                        "params": {
                            "requestId": "socket-1",
                            "response": {"payloadData": '{"event":"public"}'},
                        },
                    }
                }
            )
        }

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], [entry]]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command != "Network.enable":
                    raise AssertionError(command)
                return {}

            def get_log(self, name: str) -> list[dict[str, str]]:
                if name != "performance":
                    raise AssertionError(name)
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        with self.assertRaisesRegex(
            run.RunnerError,
            "stream-terminal-barrier-unavailable",
        ):
            client.network_observation(private_plaintext="private")

    def test_network_capture_fetches_omitted_post_data(self) -> None:
        action_id = "post-data-terminal"
        capture, marker = network_capture_marker(action_id)
        entries = [
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.requestWillBeSent",
                            "params": {
                                "requestId": "request-private",
                                "request": {
                                    "url": "https://station.invalid/public",
                                    "method": "POST",
                                    "headers": {},
                                    "hasPostData": True,
                                },
                            },
                        }
                    }
                )
            },
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.loadingFinished",
                            "params": {"requestId": "request-private"},
                        }
                    }
                )
            },
            terminal_marker_entry(marker),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]
                self.post_data_requests: list[dict[str, Any]] = []

            def execute_cdp_cmd(
                self,
                command: str,
                params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getRequestPostData":
                    self.post_data_requests.append(params)
                    return {"postData": '{"text":"private-text"}'}
                raise AssertionError(command)

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        driver = Driver()
        client._driver = driver
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        observation = client.network_observation(
            private_plaintext="private-text",
            terminal_marker=marker,
        )
        self.assertEqual(
            [{"requestId": "request-private"}],
            driver.post_data_requests,
        )
        self.assertEqual(1, observation.request_body_count)
        self.assertGreater(observation.secret_representation_count, 0)

    def test_network_capture_inspects_event_source_payloads(self) -> None:
        secret = "private-sse-value"
        action_id = "event-source-terminal"
        capture, marker = network_capture_marker(action_id)
        entry = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.eventSourceMessageReceived",
                        "params": {
                            "requestId": "events-1",
                            "data": secret,
                            "eventName": "message",
                        },
                    }
                }
            )
        }

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], [entry, terminal_marker_entry(marker)]]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command != "Network.enable":
                    raise AssertionError(command)
                return {}

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        observation = client.network_observation(
            private_plaintext=secret,
            terminal_marker=marker,
        )
        self.assertEqual(1, observation.websocket_event_count)
        self.assertGreater(observation.secret_representation_count, 0)

    def test_network_capture_detects_encoded_private_values(self) -> None:
        secret = "private value/with-symbols"
        encoded = base64.b64encode(secret.encode("utf-8")).decode("ascii")
        action_id = "encoded-value-terminal"
        capture, marker = network_capture_marker(action_id)
        entries = [
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.requestWillBeSent",
                            "params": {
                                "requestId": "request-1",
                                "request": {
                                    "url": (
                                        "https://station.invalid/public?q="
                                        + quote(secret, safe="")
                                    ),
                                    "method": "POST",
                                    "headers": {"X-Private": encoded},
                                    "postData": json.dumps({"value": secret}),
                                },
                            },
                        }
                    }
                )
            },
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.responseReceived",
                            "params": {
                                "requestId": "request-1",
                                "response": {
                                    "url": "https://station.invalid/public",
                                    "headers": {"X-Private": encoded},
                                },
                            },
                        }
                    }
                )
            },
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.loadingFinished",
                            "params": {"requestId": "request-1"},
                        }
                    }
                )
            },
            terminal_marker_entry(marker),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getResponseBody":
                    return {"body": encoded, "base64Encoded": False}
                raise AssertionError(command)

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        observation = client.network_observation(
            private_plaintext=secret,
            require_response_body=True,
            terminal_marker=marker,
        )
        self.assertGreater(observation.secret_representation_count, 0)

    def test_network_capture_stops_at_marker_and_excludes_later_events(
        self,
    ) -> None:
        action_id = "same-loop-terminal"
        capture, marker = network_capture_marker(action_id)
        request = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.requestWillBeSent",
                        "params": {
                            "requestId": "request-1",
                            "request": {
                                "url": "https://station.invalid/public",
                                "method": "GET",
                                "headers": {},
                            },
                        },
                    }
                }
            )
        }
        finished = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.loadingFinished",
                        "params": {"requestId": "request-1"},
                    }
                }
            )
        }
        delayed_frame = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.webSocketFrameReceived",
                        "params": {
                            "requestId": "socket-1",
                            "response": {
                                "payloadData": "private-after-terminal"
                            },
                        },
                    }
                }
            )
        }
        open_socket = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.webSocketCreated",
                        "params": {
                            "requestId": "socket-1",
                            "url": "wss://station.invalid/events",
                        },
                    }
                }
            )
        }

        class Driver:
            def __init__(self) -> None:
                self.logs = [
                    [],
                    [
                        request,
                        finished,
                        open_socket,
                        terminal_marker_entry(marker),
                        delayed_frame,
                    ],
                ]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command != "Network.enable":
                    raise AssertionError(command)
                return {}

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        observation = client.network_observation(
            private_plaintext="private-after-terminal",
            terminal_marker=marker,
        )
        self.assertEqual(1, observation.observed_request_count)
        self.assertEqual(1, observation.request_method_count)
        self.assertEqual(1, observation.websocket_event_count)
        self.assertEqual(0, observation.secret_representation_count)

    def test_network_capture_fails_closed_with_pending_http_request(self) -> None:
        action_id = "pending-request-terminal"
        capture, marker = network_capture_marker(action_id)
        entry = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.requestWillBeSent",
                        "params": {
                            "requestId": "request-pending",
                            "request": {
                                "url": "https://station.invalid/public",
                                "method": "GET",
                                "headers": {},
                            },
                        },
                    }
                }
            )
        }

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], [entry, terminal_marker_entry(marker)]]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command != "Network.enable":
                    raise AssertionError(command)
                return {}

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        with self.assertRaisesRegex(run.RunnerError, "pending HTTP request"):
            client.network_observation(
                private_plaintext="private",
                terminal_marker=marker,
            )

    def test_network_capture_drains_pre_marker_http_completion(self) -> None:
        action_id = "delayed-completion-terminal"
        capture, marker = network_capture_marker(action_id)

        def network_entry(method: str, params: Mapping[str, Any]) -> dict[str, str]:
            return {
                "message": json.dumps(
                    {
                        "message": {
                            "method": method,
                            "params": dict(params),
                        }
                    }
                )
            }

        request = network_entry(
            "Network.requestWillBeSent",
            {
                "requestId": "request-before-marker",
                "request": {
                    "url": "https://station.invalid/public",
                    "method": "GET",
                    "headers": {},
                },
            },
        )
        response = network_entry(
            "Network.responseReceived",
            {
                "requestId": "request-before-marker",
                "response": {
                    "url": "https://station.invalid/public",
                    "headers": {},
                },
            },
        )
        post_marker_request = network_entry(
            "Network.requestWillBeSent",
            {
                "requestId": "request-after-marker",
                "request": {
                    "url": "https://station.invalid/after-marker",
                    "method": "GET",
                    "headers": {},
                },
            },
        )
        pre_marker_finished = network_entry(
            "Network.loadingFinished",
            {"requestId": "request-before-marker"},
        )

        class Driver:
            def __init__(self) -> None:
                self.logs = [
                    [],
                    [request, response, terminal_marker_entry(marker)],
                    [post_marker_request, pre_marker_finished],
                ]

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getResponseBody":
                    return {"body": "{}", "base64Encoded": False}
                raise AssertionError(command)

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        client = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        client.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        client._driver = Driver()
        client._network_capture_armed = False
        client.clear_network_log()
        client._network_capture = capture
        observation = client.network_observation(
            private_plaintext="private",
            require_response_body=True,
            terminal_marker=marker,
        )

        self.assertEqual(1, observation.observed_request_count)
        self.assertEqual(1, observation.observed_response_count)
        self.assertEqual(1, observation.response_body_count)
        self.assertEqual(
            (
                hashlib.sha256(
                    b"https://station.invalid/public",
                ).hexdigest(),
            ),
            observation.request_url_digests,
        )

    def test_network_capture_fails_when_response_capture_is_insufficient(
        self,
    ) -> None:
        action_id = "response-control-terminal"
        capture, marker = network_capture_marker(action_id)
        request = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.requestWillBeSent",
                        "params": {
                            "requestId": "request-1",
                            "request": {
                                "url": "https://station.invalid/public",
                                "method": "GET",
                                "headers": {},
                            },
                        },
                    }
                }
            )
        }
        finished = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.loadingFinished",
                        "params": {"requestId": "request-1"},
                    }
                }
            )
        }
        response = {
            "message": json.dumps(
                {
                    "message": {
                        "method": "Network.responseReceived",
                        "params": {
                            "requestId": "request-1",
                            "response": {
                                "url": "https://station.invalid/public",
                                "headers": {},
                            },
                        },
                    }
                }
            )
        }

        class Driver:
            def __init__(
                self,
                entries: list[dict[str, str]],
                *,
                response_body_error: bool = False,
            ) -> None:
                self.logs = [[], entries]
                self.response_body_error = response_body_error

            def execute_cdp_cmd(
                self,
                command: str,
                _params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getResponseBody":
                    if self.response_body_error:
                        raise RuntimeError("body unavailable")
                    return {"body": "{}", "base64Encoded": False}
                raise AssertionError(command)

            def get_log(self, _name: str) -> list[dict[str, str]]:
                return self.logs.pop(0) if self.logs else []

        def client_with(driver: Driver) -> attached_client.AttachedProductClient:
            client = attached_client.AttachedProductClient.__new__(
                attached_client.AttachedProductClient
            )
            client.context = SimpleNamespace(
                runtime="browser",
                remaining_seconds=lambda: 1.0,
            )
            client._driver = driver
            client._network_capture_armed = False
            client.clear_network_log()
            client._network_capture = capture
            return client

        with self.assertRaisesRegex(
            run.RunnerError,
            "response-control-missing",
        ):
            client_with(
                Driver(
                    [
                        request,
                        finished,
                        terminal_marker_entry(marker),
                    ]
                )
            ).network_observation(
                private_plaintext="private",
                require_response_body=True,
                terminal_marker=marker,
            )
        with self.assertRaisesRegex(
            run.RunnerError,
            "response-body-unavailable",
        ):
            client_with(
                Driver(
                    [
                        request,
                        response,
                        finished,
                        terminal_marker_entry(marker),
                    ],
                    response_body_error=True,
                )
            ).network_observation(
                private_plaintext="private",
                terminal_marker=marker,
            )
        with self.assertRaisesRegex(
            run.RunnerError,
            "network-capture-unproven",
        ):
            client_with(
                Driver([terminal_marker_entry(marker)])
            ).network_observation(
                private_plaintext="private",
                terminal_marker=marker,
            )


if __name__ == "__main__":
    unittest.main()
