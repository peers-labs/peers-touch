from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch
from urllib.parse import quote

from tooling.acceptance.core.attestation import source_proto_digest
from tooling.development.secure_content import attached_client, run


REPO_ROOT = Path(__file__).resolve().parents[3]
IDENTITY = {
    "workspaceId": "9eb2cb904c9ae460",
    "branch": "feat/federation",
    "head": "2d54851f95994d717928105aca6470c30adf3657",
}


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
                "pathPrefix": "apps/station/frame/core/auth",
            }
        ],
    }


def control_plane_runner(
    scenario: run.ScenarioDefinition,
    declarations: list[dict[str, Any]] | None = None,
):
    selected = active_declaration(scenario)
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
        elif command[:4] == [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=all",
        ]:
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        else:
            raise AssertionError(f"unexpected command: {command}")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(payload),
            stderr="",
        )

    return execute


def runtime_manifest(
    scenario: run.ScenarioDefinition,
    *,
    runtime: str = "native-tauri",
    clients: tuple[str, ...] = ("desktop-alice",),
    run_id: str = "runtime-run-1",
    attached: bool = True,
) -> dict[str, Any]:
    station_id = "station-four"

    def harness_identity(client_id: str) -> dict[str, str]:
        actor = client_id.rsplit("-", 1)[-1]
        authentication = (
            "ANONYMOUS" if actor == "anonymous" else "AUTHENTICATED"
        )
        identity = {"authenticationState": authentication}
        identity["sourceCommit"] = IDENTITY["head"]
        identity["clientArtifactSha256"] = hashlib.sha256(
            f"artifact:{client_id}".encode("utf-8")
        ).hexdigest()
        identity["sessionIdentitySha256"] = hashlib.sha256(
            f"session:{client_id}".encode("utf-8")
        ).hexdigest()
        if authentication == "AUTHENTICATED":
            identity["actorPtidSha256"] = hashlib.sha256(
                f"ptid:{actor}".encode("utf-8")
            ).hexdigest()
        if runtime == "native-tauri":
            identity["nativeRuntimeIdentitySha256"] = hashlib.sha256(
                f"runtime:{client_id}".encode("utf-8")
            ).hexdigest()
        return identity

    payload = {
        "artifactKind": "acceptance-runtime-manifest",
        "environmentId": "secure-content-development",
        "gateId": scenario.journey_id,
        "runId": run_id,
        "createdAt": "2026-09-15T00:00:00Z",
        "state": "FIXTURE_READY",
        "source": {
            "worktree": str(REPO_ROOT),
            "commit": IDENTITY["head"],
            "workspaceDigest": "clean",
        },
        "profile": {
            "requestedName": "four",
            "resolvedName": "four",
            "slot": 5,
        },
        "services": {
            station_id: {
                "kind": "station",
                "deploymentEnvironment": "station-four",
                "endpoint": "https://station.invalid",
                "liveCommit": IDENTITY["head"],
                "protocolDigest": source_proto_digest(REPO_ROOT),
                "workspaceDigest": "clean",
                "runtimeIdentity": "peer-station-four",
                "attestationArtifact": {"path": "runtime/station.json"},
            },
        },
        "credentialRefs": [],
        "clients": [
            {
                "id": client_id,
                "actor": client_id.rsplit("-", 1)[-1],
                "runtime": runtime,
                "worktree": str(REPO_ROOT),
                "gateway_port": 3030 + index,
                "renderer_port": 3210 + index,
                "webdriver_port": 4445 + index,
                "webdriver_session_id": f"webdriver-session-{index}",
                "profile": "four-app",
                "storage_root": f"/tmp/{client_id}",
                "storage_lifecycle": "ephemeral",
                "harness_identity": harness_identity(client_id),
                "required_service_roles": ["station"],
                "service_bindings": {
                    "station": {
                        "service_id": station_id,
                        "required_kind": "station",
                    },
                },
            }
            for index, client_id in enumerate(clients)
        ],
        "cleanup": {
            "registered": True,
            "resources": ["webdriver-session"],
        },
    }
    if attached:
        payload["developmentAttachment"] = {
            "kind": run.RUNTIME_ATTACHMENT_KIND,
            "sourceManifestRunId": run_id,
            "sourceManifestSha256": "f" * 64,
            "capturedAt": "2026-09-15T00:00:01Z",
            "namespace": "moments",
        }
    else:
        for client in payload["clients"]:
            client.pop("webdriver_session_id")
            client.pop("harness_identity")
    return payload


def write_service_attestations(root: Path, payload: dict[str, Any]) -> None:
    for service_id, service in payload["services"].items():
        relative = Path("runtime") / "services" / service_id / "attestation.json"
        attestation_path = root / relative
        attestation_path.parent.mkdir(parents=True, exist_ok=True)
        attestation_payload = {
            "artifactKind": "service-deployment-attestation",
            "capturedAt": run._timestamp(),
            "serviceId": service_id,
            "serviceKind": service["kind"],
            "environmentId": payload["environmentId"],
            "deploymentEnvironment": service["deploymentEnvironment"],
            "endpoint": service["endpoint"],
            "commit": service["liveCommit"],
            "workspaceDigest": service["workspaceDigest"],
            "protocolDigest": service["protocolDigest"],
            "producer": "secure-content-test",
            "runtimeIdentity": service["runtimeIdentity"],
            "liveMetadata": {
                "buildCommit": service["liveCommit"],
                "buildTime": run._timestamp(),
            },
        }
        attestation_bytes = json.dumps(
            attestation_payload,
            sort_keys=True,
        ).encode("utf-8")
        attestation_path.write_bytes(attestation_bytes)
        service["attestationArtifact"] = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": IDENTITY["workspaceId"],
            "gateId": payload["gateId"],
            "runId": payload["runId"],
            "path": relative.as_posix(),
            "sha256": hashlib.sha256(attestation_bytes).hexdigest(),
            "mediaType": "application/json",
        }


def write_runtime_manifest(path: Path, payload: dict[str, Any]) -> None:
    attachment = payload.get("developmentAttachment")
    if isinstance(attachment, dict):
        write_service_attestations(path.parent, payload)
        actor_path = path.with_name(f"{path.stem}.actors.json")
        actor_payload = {
            "artifactKind": "acceptance-actor-manifest",
            "fixtureId": "secure-content-test-actors",
            "environmentId": payload["environmentId"],
            "runId": payload["runId"],
            "createdAt": run._timestamp(),
            "initialState": "ready",
            "actors": [
                {
                    "role": client["actor"],
                    "accountRef": f"account:{client['actor']}",
                    "ptid": f"ptid:{client['actor']}",
                    "devicePolicy": "fresh",
                }
                for client in payload["clients"]
                if client["actor"] != "anonymous"
            ],
            "credentialRefs": [],
            "reset": {"authorized": False, "targetVerified": True},
        }
        actor_bytes = json.dumps(actor_payload, sort_keys=True).encode("utf-8")
        actor_path.write_bytes(actor_bytes)
        actor_digest = hashlib.sha256(actor_bytes).hexdigest()
        payload["actorManifest"] = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": IDENTITY["workspaceId"],
            "gateId": payload["gateId"],
            "runId": payload["runId"],
            "path": actor_path.name,
            "sha256": actor_digest,
            "mediaType": "application/json",
        }
        source_payload = json.loads(json.dumps(payload))
        source_payload.pop("developmentAttachment", None)
        for client in source_payload.get("clients", []):
            if isinstance(client, dict):
                client.pop("webdriver_session_id", None)
                client.pop("harness_identity", None)
        source_path = path.with_name(f"{path.stem}.source.json")
        source_bytes = json.dumps(source_payload, sort_keys=True).encode("utf-8")
        source_path.write_bytes(source_bytes)
        attachment["sourceManifestPath"] = str(source_path.resolve())
        attachment["sourceManifestSha256"] = hashlib.sha256(source_bytes).hexdigest()
        attachment["actorManifestPath"] = str(actor_path.resolve())
        attachment["actorManifestSha256"] = actor_digest
        attachment["capturedAt"] = run._timestamp()
    path.write_text(json.dumps(payload), encoding="utf-8")
    path.chmod(0o600)


def performance_entry(method: str, params: dict[str, Any]) -> dict[str, str]:
    return {
        "message": json.dumps(
            {
                "message": {
                    "method": method,
                    "params": params,
                }
            }
        )
    }


class SecureContentRunnerTest(unittest.TestCase):
    def test_actor_manifest_rejects_duplicate_role_ptids(self) -> None:
        with self.assertRaisesRegex(run.RunnerError, "actor binding"):
            run.canonical_actor_ptids(
                {
                    "actors": [
                        {"role": "alice", "ptid": "ptid:shared"},
                        {"role": "bob", "ptid": "ptid:shared"},
                    ]
                }
            )

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

    def test_runtime_mismatch_fails_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            nonlocal called
            called = True
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="service-only",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(run.RunnerError):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=Path(temp),
                    registry={scenario.scenario_id: scenario},
                )
        self.assertFalse(called)

    def test_writes_development_result_outside_repository(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, object]:
            self.assertEqual("service", context.runtime)
            context.run_check("real-service", ["/usr/bin/true"], cwd=REPO_ROOT)
            return {"observations": ["real service check passed"]}

        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp).resolve()
            result = run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=output_root,
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

            output = output_root / scenario.evidence_path
            self.assertTrue(output.is_file())
            self.assertFalse(output.is_relative_to(REPO_ROOT))
            persisted = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual("FUNCTIONAL_CHECK", persisted["verificationClass"])
            self.assertEqual("PASS", persisted["result"])
            self.assertRegex(persisted["runtimeBindingDigest"], r"^[0-9a-f]{64}$")
            self.assertNotEqual(
                persisted["declarationDigest"],
                persisted["runtimeBindingDigest"],
            )
            self.assertEqual(result, persisted)

    def test_preserves_ordered_multi_profile_binding(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, object]:
            self.assertIsNone(context.profile)
            self.assertEqual(("four", "fiveArm"), context.profiles)
            return {"observations": ["multi-profile binding preserved"]}

        scenario = run.ScenarioDefinition(
            scenario_id="multi-profile",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W2/SC-AS12/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profiles=("four", "fiveArm"),
                result_root=Path(temp),
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

        self.assertIsNone(result["profile"])
        self.assertEqual(["four", "fiveArm"], result["profiles"])

    def test_rejects_ambiguous_or_duplicate_profile_binding(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="profile-binding",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W2/SC-AS12/result.json"),
            execute=lambda _: {},
        )

        with tempfile.TemporaryDirectory() as temp:
            common = {
                "runtime": "desktop",
                "scenario_id": scenario.scenario_id,
                "budget_seconds": 10,
                "repo_root": REPO_ROOT,
                "result_root": Path(temp),
                "registry": {scenario.scenario_id: scenario},
                "workspace_identity": IDENTITY,
                "command_runner": control_plane_runner(scenario),
            }
            with self.assertRaisesRegex(
                run.RunnerError,
                "choose exactly one",
            ):
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

    def test_rejects_result_root_inside_repository(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )

        with self.assertRaises(run.RunnerError):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=REPO_ROOT / "development",
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

    def test_binds_external_runtime_manifest_into_result_identity(self) -> None:
        observed_digest = ""

        def execute(context: run.ScenarioContext) -> dict[str, object]:
            nonlocal observed_digest
            binding = context.require_runtime_manifest()
            observed_digest = binding.sha256
            self.assertEqual("desktop-alice", binding.client("desktop-alice")["id"])
            return {"observations": ["attached runtime manifest"]}

        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = root / "runtime-manifest.json"
            write_runtime_manifest(manifest_path, runtime_manifest(scenario))
            result = run.execute_scenario(
                runtime="desktop",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profile="four",
                clients=("desktop-alice",),
                runtime_manifest_path=manifest_path,
                result_root=root / "results",
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

        self.assertEqual(observed_digest, result["runtimeManifestDigest"])
        self.assertEqual(str(manifest_path.resolve()), result["runtimeManifestRef"])
        self.assertIn(str(manifest_path.resolve()), result["artifactRefs"])
        self.assertRegex(result["runtimeBindingDigest"], r"^[0-9a-f]{64}$")

    def test_runtime_manifest_requires_private_mode_and_exact_source_provenance(
        self,
    ) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = root / "runtime-manifest.json"
            write_runtime_manifest(manifest_path, runtime_manifest(scenario))
            manifest_path.chmod(0o644)
            with self.assertRaisesRegex(run.RunnerError, "current user and private"):
                run._runtime_manifest_binding(
                    path=manifest_path,
                    scenario=scenario,
                    identity=IDENTITY,
                    runtime="desktop",
                    profile="four",
                    profiles=(),
                    clients=("desktop-alice",),
                    repo_root=REPO_ROOT,
                )
            manifest_path.chmod(0o600)
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            source_path = Path(
                payload["developmentAttachment"]["sourceManifestPath"]
            )
            source_path.write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(run.RunnerError, "source digest"):
                run._runtime_manifest_binding(
                    path=manifest_path,
                    scenario=scenario,
                    identity=IDENTITY,
                    runtime="desktop",
                    profile="four",
                    profiles=(),
                    clients=("desktop-alice",),
                    repo_root=REPO_ROOT,
                )

    def test_runtime_manifest_requires_station_source_provenance(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        cases = {
            "dirty workspace": lambda service: service.__setitem__(
                "workspaceDigest",
                "dirty",
            ),
            "wrong protocol": lambda service: service.__setitem__(
                "protocolDigest",
                "f" * 64,
            ),
        }

        for name, mutate in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                payload = runtime_manifest(scenario)
                mutate(payload["services"]["station-four"])
                manifest_path = Path(temp) / "runtime-manifest.json"
                write_runtime_manifest(manifest_path, payload)

                with self.assertRaisesRegex(
                    run.RunnerError,
                    "Station service",
                ):
                    run._runtime_manifest_binding(
                        path=manifest_path,
                        scenario=scenario,
                        identity=IDENTITY,
                        runtime="desktop",
                        profile="four",
                        profiles=(),
                        clients=("desktop-alice",),
                        repo_root=REPO_ROOT,
                    )

    def test_runtime_manifest_rejects_source_profile_and_client_drift(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        cases = {
            "source commit": lambda manifest: manifest["source"].__setitem__(
                "commit",
                "f" * 40,
            ),
            "profile": lambda manifest: manifest["profile"].__setitem__(
                "resolvedName",
                "fiveArm",
            ),
            "client runtime": lambda manifest: manifest["clients"][0].__setitem__(
                "runtime",
                "browser",
            ),
            "client actor": lambda manifest: manifest["clients"][0].__setitem__(
                "actor",
                "",
            ),
            "client profile": lambda manifest: manifest["clients"][0].__setitem__(
                "profile",
                "fiveArm-app",
            ),
            "client storage": lambda manifest: manifest["clients"][0].__setitem__(
                "storage_root",
                "relative/storage",
            ),
            "webdriver session": lambda manifest: manifest["clients"][0].pop(
                "webdriver_session_id"
            ),
            "harness identity": lambda manifest: manifest["clients"][0].pop(
                "harness_identity"
            ),
            "post-launch attachment": lambda manifest: manifest.pop(
                "developmentAttachment"
            ),
            "actor role alias digest": lambda manifest: manifest["clients"][0][
                "harness_identity"
            ].__setitem__(
                "actorPtidSha256",
                hashlib.sha256(
                    manifest["clients"][0]["actor"].encode("utf-8")
                ).hexdigest(),
            ),
            "client source commit": lambda manifest: manifest["clients"][0][
                "harness_identity"
            ].__setitem__("sourceCommit", "f" * 40),
            "client artifact digest": lambda manifest: manifest["clients"][0][
                "harness_identity"
            ].__setitem__("clientArtifactSha256", "invalid"),
            "station identity": lambda manifest: manifest["services"][
                "station-four"
            ].__setitem__(
                "runtimeIdentity",
                "",
            ),
        }

        for name, mutate in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                payload = runtime_manifest(scenario)
                mutate(payload)
                manifest_path = root / "runtime-manifest.json"
                write_runtime_manifest(manifest_path, payload)
                with self.assertRaises(run.RunnerError):
                    run.execute_scenario(
                        runtime="desktop",
                        scenario_id=scenario.scenario_id,
                        budget_seconds=10,
                        repo_root=REPO_ROOT,
                        profile="four",
                        clients=("desktop-alice",),
                        runtime_manifest_path=manifest_path,
                        result_root=root / "results",
                        registry={scenario.scenario_id: scenario},
                        workspace_identity=IDENTITY,
                        command_runner=control_plane_runner(scenario),
                    )

    def test_runtime_manifest_rejects_swapped_attached_actor_hash(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        clients = ("desktop-alice", "desktop-bob")
        with tempfile.TemporaryDirectory() as temp:
            manifest_path = Path(temp) / "runtime-manifest.json"
            write_runtime_manifest(
                manifest_path,
                runtime_manifest(scenario, clients=clients),
            )
            attached = json.loads(manifest_path.read_text(encoding="utf-8"))
            attached["clients"][0]["harness_identity"]["actorPtidSha256"] = (
                attached["clients"][1]["harness_identity"]["actorPtidSha256"]
            )
            manifest_path.write_text(json.dumps(attached), encoding="utf-8")

            with self.assertRaisesRegex(
                run.RunnerError,
                "canonical actor binding",
            ):
                run._runtime_manifest_binding(
                    path=manifest_path,
                    scenario=scenario,
                    identity=IDENTITY,
                    runtime="desktop",
                    profile="four",
                    profiles=(),
                    clients=clients,
                    repo_root=REPO_ROOT,
                )

    def test_runtime_manifest_mutation_fails_pass_blocked_and_fail_paths(
        self,
    ) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )

        for outcome in ("pass", "blocked", "fail"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                manifest_path = root / "runtime-manifest.json"
                write_runtime_manifest(manifest_path, runtime_manifest(scenario))

                def execute(context: run.ScenarioContext) -> dict[str, object]:
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

                selected = run.ScenarioDefinition(
                    scenario_id=scenario.scenario_id,
                    journey_id=scenario.journey_id,
                    work_item_id=scenario.work_item_id,
                    runtimes=scenario.runtimes,
                    evidence_path=scenario.evidence_path,
                    execute=execute,
                )
                with self.assertRaises(run.ScenarioFailed):
                    run.execute_scenario(
                        runtime="desktop",
                        scenario_id=selected.scenario_id,
                        budget_seconds=10,
                        repo_root=REPO_ROOT,
                        profile="four",
                        clients=("desktop-alice",),
                        runtime_manifest_path=manifest_path,
                        result_root=root / "results",
                        registry={selected.scenario_id: selected},
                        workspace_identity=IDENTITY,
                        command_runner=control_plane_runner(selected),
                    )
                persisted = json.loads(
                    (root / "results" / selected.evidence_path).read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual("FAIL", persisted["result"])
                self.assertEqual(
                    "RUNTIME_BINDING_CHANGED",
                    persisted["firstFailure"]["kind"],
                )

    def test_bound_artifact_is_immutable_and_consumed_once(self) -> None:
        artifact_path: Path | None = None

        def produce(context: run.ScenarioContext) -> dict[str, object]:
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
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-A/result.json"),
            execute=produce,
        )

        consumed: list[str] = []

        def consume(context: run.ScenarioContext) -> dict[str, object]:
            self.assertIsNotNone(artifact_path)
            payload = context.consume_bound_artifact_json(
                artifact_path,
                kind="secure-content-test-handoff",
                producer_scenario_id=producer.scenario_id,
                producer_journey_id=producer.journey_id,
                producer_runtime="desktop",
            )
            consumed.append(str(payload["postId"]))
            return {}

        consumer = run.ScenarioDefinition(
            scenario_id="artifact-consumer",
            journey_id="journey-consumer",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-B/result.json"),
            execute=consume,
        )

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            producer_manifest = root / "producer-manifest.json"
            write_runtime_manifest(
                producer_manifest,
                runtime_manifest(producer, run_id="producer-run"),
            )
            run.execute_scenario(
                runtime="desktop",
                scenario_id=producer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profile="four",
                clients=("desktop-alice",),
                runtime_manifest_path=producer_manifest,
                result_root=root / "results",
                registry={producer.scenario_id: producer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(producer),
            )
            self.assertIsNotNone(artifact_path)
            bound = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(IDENTITY["head"], bound["sourceCommit"])
            self.assertEqual("work-1", bound["sessionId"])
            self.assertEqual("desktop", bound["runtime"])
            self.assertEqual("producer-run", bound["runtimeManifestRunId"])
            self.assertRegex(bound["bindingDigest"], r"^[0-9a-f]{64}$")
            self.assertRegex(bound["artifactDigest"], r"^[0-9a-f]{64}$")
            original_artifact = artifact_path.read_bytes()

            replacement_manifest = root / "replacement-manifest.json"
            write_runtime_manifest(
                replacement_manifest,
                runtime_manifest(producer, run_id="replacement-run"),
            )
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=producer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profile="four",
                    clients=("desktop-alice",),
                    runtime_manifest_path=replacement_manifest,
                    result_root=root / "results",
                    registry={producer.scenario_id: producer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(producer),
                )
            self.assertEqual(original_artifact, artifact_path.read_bytes())

            consumer_manifest = root / "consumer-manifest.json"
            write_runtime_manifest(
                consumer_manifest,
                runtime_manifest(consumer, run_id="consumer-run"),
            )

            def consume_then_fail(
                context: run.ScenarioContext,
            ) -> dict[str, object]:
                self.assertIsNotNone(artifact_path)
                context.consume_bound_artifact_json(
                    artifact_path,
                    kind="secure-content-test-handoff",
                    producer_scenario_id=producer.scenario_id,
                    producer_journey_id=producer.journey_id,
                    producer_runtime="desktop",
                )
                raise run.RunnerError("post-consumption assertion failed")

            failing_consumer = run.ScenarioDefinition(
                scenario_id=consumer.scenario_id,
                journey_id=consumer.journey_id,
                work_item_id=consumer.work_item_id,
                runtimes=consumer.runtimes,
                evidence_path=consumer.evidence_path,
                execute=consume_then_fail,
            )
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=failing_consumer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profile="four",
                    clients=("desktop-alice",),
                    runtime_manifest_path=consumer_manifest,
                    result_root=root / "results",
                    registry={failing_consumer.scenario_id: failing_consumer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(failing_consumer),
                )
            receipt_path = artifact_path.with_name("handoff.consumed.json")
            self.assertFalse(receipt_path.exists())

            retry_manifest = root / "retry-manifest.json"
            write_runtime_manifest(
                retry_manifest,
                runtime_manifest(consumer, run_id="retry-run"),
            )
            first = run.execute_scenario(
                runtime="desktop",
                scenario_id=consumer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profile="four",
                clients=("desktop-alice",),
                runtime_manifest_path=retry_manifest,
                result_root=root / "results",
                registry={consumer.scenario_id: consumer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(consumer),
            )
            self.assertEqual("PASS", first["result"])
            self.assertEqual(["post-1"], consumed)
            self.assertTrue(receipt_path.is_file())
            self.assertIn(str(receipt_path), first["artifactRefs"])
            prepared_path = (
                root / "results" / consumer.evidence_path
            ).with_name("result.prepared.json")
            self.assertTrue(prepared_path.is_file())
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            prepared = json.loads(prepared_path.read_text(encoding="utf-8"))
            self.assertEqual(
                prepared["preparedResultSha256"],
                receipt["preparedResultSha256"],
            )

            replay_manifest = root / "replay-manifest.json"
            write_runtime_manifest(
                replay_manifest,
                runtime_manifest(consumer, run_id="replay-run"),
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
                    profile="four",
                    clients=("desktop-alice",),
                    runtime_manifest_path=replay_manifest,
                    result_root=root / "results",
                    registry={consumer.scenario_id: consumer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(consumer),
                )
            self.assertEqual(["post-1"], consumed)

    def test_prepared_result_recovers_after_result_publication_interruption(
        self,
    ) -> None:
        artifact_path: Path | None = None

        def produce(context: run.ScenarioContext) -> dict[str, object]:
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
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-A/result.json"),
            execute=produce,
        )
        executed = 0

        def consume(context: run.ScenarioContext) -> dict[str, object]:
            nonlocal executed
            executed += 1
            self.assertIsNotNone(artifact_path)
            context.consume_bound_artifact_json(
                artifact_path,
                kind="secure-content-test-handoff",
                producer_scenario_id=producer.scenario_id,
                producer_journey_id=producer.journey_id,
                producer_runtime="desktop",
            )
            return {"observations": ["consumed once"]}

        consumer = run.ScenarioDefinition(
            scenario_id="crash-consumer",
            journey_id="journey-consumer",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-B/result.json"),
            execute=consume,
        )

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            producer_manifest = root / "producer.json"
            write_runtime_manifest(
                producer_manifest,
                runtime_manifest(producer, run_id="producer-run"),
            )
            run.execute_scenario(
                runtime="desktop",
                scenario_id=producer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profile="four",
                clients=("desktop-alice",),
                runtime_manifest_path=producer_manifest,
                result_root=root / "results",
                registry={producer.scenario_id: producer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(producer),
            )
            consumer_manifest = root / "consumer.json"
            write_runtime_manifest(
                consumer_manifest,
                runtime_manifest(consumer, run_id="consumer-run"),
            )
            result_path = root / "results" / consumer.evidence_path
            original_atomic_write = run._write_json_atomic

            def interrupt_result_write(
                path: Path,
                value: dict[str, Any],
            ) -> None:
                if path.resolve() == result_path.resolve():
                    raise OSError("simulated result publication interruption")
                original_atomic_write(path, value)

            with patch.object(
                run,
                "_write_json_atomic",
                side_effect=interrupt_result_write,
            ), self.assertRaisesRegex(
                OSError,
                "simulated result publication interruption",
            ):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=consumer.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    profile="four",
                    clients=("desktop-alice",),
                    runtime_manifest_path=consumer_manifest,
                    result_root=root / "results",
                    registry={consumer.scenario_id: consumer},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(consumer),
                )

            self.assertEqual(1, executed)
            self.assertFalse(result_path.exists())
            receipt_path = artifact_path.with_name(
                "crash-handoff.consumed.json"
            )
            self.assertTrue(receipt_path.is_file())
            self.assertTrue(
                result_path.with_name("result.prepared.json").is_file()
            )

            recovered = run.execute_scenario(
                runtime="desktop",
                scenario_id=consumer.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                profile="four",
                clients=("desktop-alice",),
                runtime_manifest_path=consumer_manifest,
                result_root=root / "results",
                registry={consumer.scenario_id: consumer},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(consumer),
            )

            self.assertEqual(1, executed)
            self.assertEqual("PASS", recovered["result"])
            self.assertEqual(
                recovered,
                json.loads(result_path.read_text(encoding="utf-8")),
            )
            self.assertTrue(receipt_path.is_file())

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
            self.assertEqual(
                "test-receipt",
                json.loads(path.read_text(encoding="utf-8"))["kind"],
            )

    def test_bound_artifact_rejects_manifest_captured_before_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            artifact_dir = Path(temp)
            producer = run.ScenarioContext(
                repo_root=REPO_ROOT,
                scenario_id="artifact-producer",
                journey_id="journey-producer",
                source_commit=IDENTITY["head"],
                session_id="work-1",
                declaration_id="work-1-9eb2cb904c9ae460",
                runtime="desktop",
                profile="four",
                profiles=("four",),
                clients=(),
                budget_seconds=10,
                started_monotonic=time.monotonic(),
                runtime_manifest=run.RuntimeManifestBinding(
                    path=artifact_dir / "producer.json",
                    sha256="a" * 64,
                    run_id="producer-run",
                    payload={
                        "developmentAttachment": {
                            "capturedAt": "2026-09-15T10:00:00.000Z",
                        }
                    },
                    clients={},
                    raw_bytes=b"producer",
                ),
                artifact_dir=artifact_dir,
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
                session_id="work-1",
                declaration_id="work-1-9eb2cb904c9ae460",
                runtime="desktop",
                profile="four",
                profiles=("four",),
                clients=(),
                budget_seconds=10,
                started_monotonic=time.monotonic(),
                runtime_manifest=run.RuntimeManifestBinding(
                    path=artifact_dir / "consumer.json",
                    sha256="b" * 64,
                    run_id="consumer-run",
                    payload={
                        "developmentAttachment": {
                            "capturedAt": "2026-09-15T09:59:59.999Z",
                        }
                    },
                    clients={},
                    raw_bytes=b"consumer",
                ),
                artifact_dir=artifact_dir,
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

        def execute(context: run.ScenarioContext) -> dict[str, object]:
            context.write_artifact_json(
                "diagnostic.json",
                {
                    "authorization": f"Bearer {secret}",
                    "detail": f"token={secret}",
                },
            )
            context.write_artifact_bytes(
                "diagnostic.txt",
                f"Authorization: Bearer {secret}\n".encode("utf-8"),
            )
            return {
                "observations": {
                    "authorization": f"Bearer {secret}",
                    "detail": f"token={secret}",
                }
            }

        scenario = run.ScenarioDefinition(
            scenario_id="redacted-result",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=root,
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )
            persisted = (root / scenario.evidence_path).read_text(encoding="utf-8")
            artifact = (
                root / scenario.evidence_path.parent / "diagnostic.json"
            ).read_text(encoding="utf-8")
            text_artifact = (
                root / scenario.evidence_path.parent / "diagnostic.txt"
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertNotIn(secret, artifact)
            self.assertNotIn(secret, text_artifact)
            self.assertNotIn(secret, json.dumps(result))
            self.assertIn("[REDACTED]", persisted)
            self.assertIn("[REDACTED]", artifact)
            self.assertIn("[REDACTED]", text_artifact)

    def test_rejects_any_dirty_source_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            nonlocal called
            called = True
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="dirty-source",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )
        base_runner = control_plane_runner(scenario)

        def dirty_runner(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            if command[:4] == [
                "git",
                "status",
                "--porcelain",
                "--untracked-files=all",
            ]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=" M docs/README.md\n",
                    stderr="",
                )
            return base_runner(command, cwd)

        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "checkpoint before FUNCTIONAL_CHECK",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=dirty_runner,
            )
        self.assertFalse(called)

    def test_failure_evidence_does_not_persist_exception_secrets(self) -> None:
        secret = "secret-bearer-value"

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            raise run.RunnerError(f"Authorization: Bearer {secret}")

        scenario = run.ScenarioDefinition(
            scenario_id="secret-failure",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=output_root,
                    registry={scenario.scenario_id: scenario},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(scenario),
                )

            persisted = (
                output_root / scenario.evidence_path
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertIn("scenario execution failed", persisted)

    def test_environment_blocker_writes_blocked_result(self) -> None:
        secret = "postgresql://owner:secret-password@db.invalid/runtime"

        def execute(context: run.ScenarioContext) -> dict[str, object]:
            context.block(
                f"required PostgreSQL DSN {secret} is unavailable",
                kind="DRIVER_FAILED",
                owner="local-dev-control-plane",
                retryable=True,
            )

        scenario = run.ScenarioDefinition(
            scenario_id="blocked-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp)
            with self.assertRaises(run.ScenarioBlocked) as raised:
                run.execute_scenario(
                    runtime="service",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=output_root,
                    registry={scenario.scenario_id: scenario},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(scenario),
                )

            result = json.loads(
                (output_root / scenario.evidence_path).read_text(encoding="utf-8")
            )
            self.assertEqual("BLOCKED", result["result"])
            self.assertEqual("DRIVER_FAILED", result["firstFailure"]["kind"])
            self.assertEqual(
                "local-dev-control-plane",
                result["firstFailure"]["owner"],
            )
            self.assertTrue(result["firstFailure"]["retryable"])
            self.assertNotIn(
                secret,
                (output_root / scenario.evidence_path).read_text(encoding="utf-8"),
            )
            self.assertEqual(
                (output_root / scenario.evidence_path).resolve(),
                raised.exception.result_path.resolve(),
            )

    def test_requires_exactly_one_active_current_workspace_declaration(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        duplicate = active_declaration(scenario, digest="b" * 64)

        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "exactly one active current-workspace declaration",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(
                    scenario,
                    [active_declaration(scenario), duplicate],
                ),
            )

    def test_budget_exhaustion_writes_failed_result(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, object]:
            context.started_monotonic = time.monotonic() - context.budget_seconds
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="budget-test",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=output_root,
                    registry={scenario.scenario_id: scenario},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(scenario),
                )

            result = json.loads(
                (output_root / scenario.evidence_path).read_text(encoding="utf-8")
            )
            self.assertEqual("FAIL", result["result"])
            self.assertEqual("TIMEOUT", result["firstFailure"]["kind"])


class RuntimeAttachmentManifestTest(unittest.TestCase):
    @staticmethod
    def _scenario() -> run.ScenarioDefinition:
        return run.ScenarioDefinition(
            scenario_id="desktop-manifest",
            journey_id="journey-desktop",
            work_item_id="work-1",
            runtimes=frozenset({"desktop"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )

    @staticmethod
    def _driver(session_id: str) -> SimpleNamespace:
        return SimpleNamespace(
            session_id=session_id,
            execute_async_script=lambda *_args, **_kwargs: None,
        )

    def test_producer_attaches_existing_sessions_without_mutating_source(self) -> None:
        scenario = self._scenario()
        clients = ("desktop-alice", "desktop-bob")
        source_payload = runtime_manifest(
            scenario,
            clients=clients,
            attached=False,
        )
        snapshots = {
            "session-alice": {
                "platform": "native",
                "authenticationState": "AUTHENTICATED",
                "sourceCommit": IDENTITY["head"],
                "clientArtifactSha256": hashlib.sha256(
                    b"artifact:desktop-alice"
                ).hexdigest(),
                "sessionIdentitySha256": hashlib.sha256(
                    b"session:desktop-alice"
                ).hexdigest(),
                "actorPtidSha256": hashlib.sha256(b"ptid:alice").hexdigest(),
                "nativeRuntimeIdentitySha256": hashlib.sha256(
                    b"runtime:alice"
                ).hexdigest(),
            },
            "session-bob": {
                "platform": "native",
                "authenticationState": "AUTHENTICATED",
                "sourceCommit": IDENTITY["head"],
                "clientArtifactSha256": hashlib.sha256(
                    b"artifact:desktop-bob"
                ).hexdigest(),
                "sessionIdentitySha256": hashlib.sha256(
                    b"session:desktop-bob"
                ).hexdigest(),
                "actorPtidSha256": hashlib.sha256(b"ptid:bob").hexdigest(),
                "nativeRuntimeIdentitySha256": hashlib.sha256(
                    b"runtime:bob"
                ).hexdigest(),
            },
        }
        sessions = {
            "desktop-alice": self._driver("session-alice"),
            "desktop-bob": self._driver("session-bob"),
        }

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source-runtime-manifest.json"
            actors = root / "actor-manifest.json"
            target = root / "attached-runtime-manifest.json"
            actor_payload = {
                "artifactKind": "acceptance-actor-manifest",
                "fixtureId": "secure-content-test-actors",
                "environmentId": source_payload["environmentId"],
                "runId": source_payload["runId"],
                "createdAt": run._timestamp(),
                "initialState": "ready",
                "actors": [
                    {
                        "role": actor,
                        "accountRef": f"account:{actor}",
                        "ptid": f"ptid:{actor}",
                        "devicePolicy": "fresh",
                    }
                    for actor in ("alice", "bob")
                ],
                "credentialRefs": [],
                "reset": {"authorized": False, "targetVerified": True},
            }
            actor_bytes = json.dumps(actor_payload, sort_keys=True).encode("utf-8")
            actors.write_bytes(actor_bytes)
            source_payload["actorManifest"] = {
                "artifactKind": "acceptance-artifact-ref",
                "workspaceId": IDENTITY["workspaceId"],
                "gateId": scenario.journey_id,
                "runId": source_payload["runId"],
                "path": actors.name,
                "sha256": hashlib.sha256(actor_bytes).hexdigest(),
                "mediaType": "application/json",
            }
            write_service_attestations(root, source_payload)
            source.write_text(json.dumps(source_payload), encoding="utf-8")
            original = source.read_bytes()

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
                    source_manifest_path=source,
                    output_path=target,
                    journey_id=scenario.journey_id,
                    sessions_by_client=sessions,
                    actor_manifest_path=actors,
                    repo_root=REPO_ROOT,
                )

            self.assertEqual(target.resolve(), result)
            self.assertEqual(original, source.read_bytes())
            self.assertEqual(0o600, os.stat(target).st_mode & 0o777)
            payload = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(
                run.RUNTIME_ATTACHMENT_KIND,
                payload["developmentAttachment"]["kind"],
            )
            self.assertEqual(
                hashlib.sha256(original).hexdigest(),
                payload["developmentAttachment"]["sourceManifestSha256"],
            )
            self.assertEqual(
                ["session-alice", "session-bob"],
                [
                    client["webdriver_session_id"]
                    for client in payload["clients"]
                ],
            )
            binding = run._runtime_manifest_binding(
                path=target,
                scenario=scenario,
                identity=IDENTITY,
                runtime="desktop",
                profile="four",
                profiles=(),
                clients=clients,
                repo_root=REPO_ROOT,
            )
            self.assertEqual(tuple(binding.clients), clients)
            original_target = target.read_bytes()

            with self.assertRaisesRegex(
                run.RunnerError,
                "already exists",
            ):
                attached_client.write_attached_runtime_manifest(
                    source_manifest_path=source,
                    output_path=target,
                    journey_id=scenario.journey_id,
                    sessions_by_client=sessions,
                    actor_manifest_path=actors,
                    repo_root=REPO_ROOT,
                )
            self.assertEqual(original_target, target.read_bytes())

    def test_producer_rejects_changed_source_or_incomplete_session_set(self) -> None:
        scenario = self._scenario()
        source_payload = runtime_manifest(scenario, attached=False)
        session = self._driver("session-alice")

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source-runtime-manifest.json"
            actors = root / "actor-manifest.json"
            actor_payload = {
                "artifactKind": "acceptance-actor-manifest",
                "fixtureId": "secure-content-test-actors",
                "environmentId": source_payload["environmentId"],
                "runId": source_payload["runId"],
                "createdAt": run._timestamp(),
                "initialState": "ready",
                "actors": [{
                    "role": "alice",
                    "accountRef": "account:alice",
                    "ptid": "ptid:alice",
                    "devicePolicy": "fresh",
                }],
                "credentialRefs": [],
                "reset": {"authorized": False, "targetVerified": True},
            }
            actor_bytes = json.dumps(actor_payload, sort_keys=True).encode("utf-8")
            actors.write_bytes(actor_bytes)
            source_payload["actorManifest"] = {
                "artifactKind": "acceptance-artifact-ref",
                "workspaceId": IDENTITY["workspaceId"],
                "gateId": scenario.journey_id,
                "runId": source_payload["runId"],
                "path": actors.name,
                "sha256": hashlib.sha256(actor_bytes).hexdigest(),
                "mediaType": "application/json",
            }
            write_service_attestations(root, source_payload)
            source.write_text(json.dumps(source_payload), encoding="utf-8")
            with self.assertRaisesRegex(
                run.RunnerError,
                "exactly match manifest clients",
            ):
                attached_client.write_attached_runtime_manifest(
                    source_manifest_path=source,
                    output_path=root / "missing-session.json",
                    journey_id=scenario.journey_id,
                    sessions_by_client={},
                    actor_manifest_path=actors,
                    repo_root=REPO_ROOT,
                )

            with patch.object(
                attached_client,
                "harness_ready",
                return_value=True,
            ), patch.object(
                attached_client,
                "call_async_harness",
                return_value={
                    "platform": "native",
                    "authenticationState": "AUTHENTICATED",
                    "sourceCommit": IDENTITY["head"],
                    "clientArtifactSha256": hashlib.sha256(
                        b"artifact:desktop-alice"
                    ).hexdigest(),
                    "sessionIdentitySha256": hashlib.sha256(
                        b"session:desktop-alice"
                    ).hexdigest(),
                    "actorPtidSha256": hashlib.sha256(b"ptid:bob").hexdigest(),
                    "nativeRuntimeIdentitySha256": hashlib.sha256(
                        b"runtime:alice"
                    ).hexdigest(),
                },
            ), self.assertRaisesRegex(
                run.RunnerError,
                "canonical actor binding",
            ):
                attached_client.write_attached_runtime_manifest(
                    source_manifest_path=source,
                    output_path=root / "swapped-actor.json",
                    journey_id=scenario.journey_id,
                    sessions_by_client={"desktop-alice": session},
                    actor_manifest_path=actors,
                    repo_root=REPO_ROOT,
                )

            def mutate_source(*_args: object, **_kwargs: object) -> dict[str, str]:
                source.write_text(
                    json.dumps({**source_payload, "createdAt": "changed"}),
                    encoding="utf-8",
                )
                return {
                    "platform": "native",
                    "authenticationState": "AUTHENTICATED",
                    "sourceCommit": IDENTITY["head"],
                    "clientArtifactSha256": hashlib.sha256(
                        b"artifact:desktop-alice"
                    ).hexdigest(),
                    "sessionIdentitySha256": hashlib.sha256(
                        b"session:desktop-alice"
                    ).hexdigest(),
                    "actorPtidSha256": hashlib.sha256(b"ptid:alice").hexdigest(),
                    "nativeRuntimeIdentitySha256": hashlib.sha256(
                        b"runtime:alice"
                    ).hexdigest(),
                }

            with patch.object(
                attached_client,
                "harness_ready",
                return_value=True,
            ), patch.object(
                attached_client,
                "call_async_harness",
                side_effect=mutate_source,
            ), self.assertRaisesRegex(
                run.RunnerError,
                "changed during attachment capture",
            ):
                attached_client.write_attached_runtime_manifest(
                    source_manifest_path=source,
                    output_path=root / "changed-source.json",
                    journey_id=scenario.journey_id,
                    sessions_by_client={"desktop-alice": session},
                    actor_manifest_path=actors,
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
                "NETWORK_CAPTURE_QUIET_SECONDS",
                0.002,
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

    def _binding(
        self,
        *,
        runtime: str = "native-tauri",
        actor: str = "alice",
    ) -> run.RuntimeManifestBinding:
        authentication = (
            "ANONYMOUS" if actor == "anonymous" else "AUTHENTICATED"
        )
        harness_identity = {"authenticationState": authentication}
        harness_identity["sourceCommit"] = IDENTITY["head"]
        harness_identity["clientArtifactSha256"] = hashlib.sha256(
            f"artifact:{actor}".encode("utf-8")
        ).hexdigest()
        harness_identity["sessionIdentitySha256"] = hashlib.sha256(
            f"session:{actor}".encode("utf-8")
        ).hexdigest()
        if authentication == "AUTHENTICATED":
            harness_identity["actorPtidSha256"] = hashlib.sha256(
                f"ptid:{actor}".encode("utf-8")
            ).hexdigest()
        if runtime == "native-tauri":
            harness_identity["nativeRuntimeIdentitySha256"] = hashlib.sha256(
                b"native-runtime"
            ).hexdigest()
        client = {
            "id": "desktop-alice",
            "actor": actor,
            "runtime": runtime,
            "profile": "four-app",
            "storage_root": "/tmp/desktop-alice",
            "webdriver_session_id": "external-session",
            "webdriver_port": 4445,
            "renderer_port": 3210,
            "gateway_port": 3030,
            "harness_identity": harness_identity,
            "required_service_roles": ["station"],
            "service_bindings": {
                "station": {
                    "service_id": "station-four",
                    "required_kind": "station",
                }
            },
        }
        payload = {
            "runId": "runtime-run",
            "source": {"commit": IDENTITY["head"]},
            "clients": [client],
            "services": {
                "station-four": {
                    "kind": "station",
                    "runtimeIdentity": "station-peer-four",
                }
            },
        }
        return run.RuntimeManifestBinding(
            path=Path("/tmp/runtime-manifest.json"),
            sha256="a" * 64,
            run_id="runtime-run",
            payload=payload,
            clients={"desktop-alice": client},
            raw_bytes=b"{}",
        )

    def _context(
        self,
        *,
        runtime: str = "desktop",
        actor: str = "alice",
    ) -> run.ScenarioContext:
        return run.ScenarioContext(
            repo_root=REPO_ROOT,
            scenario_id="attached-client",
            journey_id="journey-1",
            source_commit=IDENTITY["head"],
            session_id="session-1",
            declaration_id="work-1-9eb2cb904c9ae460",
            runtime=runtime,
            profile="four",
            profiles=("four",),
            clients=("desktop-alice",),
            budget_seconds=10,
            started_monotonic=time.monotonic(),
            runtime_manifest=self._binding(
                runtime="native-tauri" if runtime == "desktop" else runtime,
                actor=actor,
            ),
        )

    def test_live_harness_identity_must_match_manifest(self) -> None:
        context = self._context()
        client = attached_client.AttachedProductClient(
            context,
            "desktop-alice",
        )
        client._driver = SimpleNamespace(session_id="external-session")
        expected = dict(
            context.require_runtime_manifest().client_harness_binding(
                "desktop-alice"
            )
        )
        with patch.object(
            client,
            "_raw_call",
            return_value={"platform": "native", **expected},
        ):
            self.assertEqual("native", client.snapshot()["platform"])

        for field_name in expected:
            wrong_value = (
                "ANONYMOUS"
                if field_name == "authenticationState"
                else "f" * 64
            )
            with self.subTest(field=field_name), patch.object(
                client,
                "_raw_call",
                return_value={
                    "platform": "native",
                    **expected,
                    field_name: wrong_value,
                },
            ):
                with self.assertRaisesRegex(
                    run.RunnerError,
                    "does not match the runtime manifest",
                ):
                    client.snapshot()

        anonymous_context = self._context(runtime="browser", actor="anonymous")
        anonymous = attached_client.AttachedProductClient(
            anonymous_context,
            "desktop-alice",
        )
        anonymous._driver = SimpleNamespace(session_id="external-session")
        anonymous_expected = dict(
            anonymous_context.require_runtime_manifest().client_harness_binding(
                "desktop-alice"
            )
        )
        with patch.object(
            anonymous,
            "_raw_call",
            return_value={
                "platform": "browser",
                **anonymous_expected,
            },
        ):
            self.assertEqual(
                "ANONYMOUS",
                anonymous.snapshot()["authenticationState"],
            )
        with patch.object(
            anonymous,
            "_raw_call",
            return_value={
                "platform": "browser",
                **anonymous_expected,
                "actorPtidSha256": "f" * 64,
            },
        ):
            with self.assertRaisesRegex(
                run.RunnerError,
                "contradicts the runtime manifest",
            ):
                anonymous.snapshot()

    def test_non_snapshot_operations_are_fenced_by_full_live_identity(self) -> None:
        context = self._context()
        expected = dict(
            context.require_runtime_manifest().client_harness_binding(
                "desktop-alice"
            )
        )

        for field_name in ("actorPtidSha256", "sessionIdentitySha256"):
            with self.subTest(field=field_name):
                client = attached_client.AttachedProductClient(
                    context,
                    "desktop-alice",
                )
                client._driver = SimpleNamespace(session_id="external-session")
                post_operation = {
                    "platform": "native",
                    **expected,
                    field_name: "f" * 64,
                }
                with patch.object(
                    client,
                    "_raw_call",
                    side_effect=[
                        {"platform": "native", **expected},
                        {"ok": True},
                        post_operation,
                    ],
                ) as call:
                    with self.assertRaisesRegex(
                        run.RunnerError,
                        "does not match the runtime manifest",
                    ):
                        client.call("stageFriendsDraft", {"draftId": "draft-1"})
                self.assertEqual(
                    ["snapshot", "stageFriendsDraft", "snapshot"],
                    [invocation.args[0] for invocation in call.call_args_list],
                )

        client = attached_client.AttachedProductClient(
            context,
            "desktop-alice",
        )
        client._driver = SimpleNamespace(session_id="external-session")
        with patch.object(
            client,
            "_raw_call",
            return_value={
                "platform": "native",
                **expected,
                "sessionIdentitySha256": "f" * 64,
            },
        ) as call:
            with self.assertRaisesRegex(
                run.RunnerError,
                "does not match the runtime manifest",
            ):
                client.call("stageFriendsDraft", {"draftId": "draft-1"})
        self.assertEqual(["snapshot"], [item.args[0] for item in call.call_args_list])

        client._driver = SimpleNamespace(session_id="switched-session")
        with patch.object(
            client,
            "_raw_call",
            return_value={"platform": "native", **expected},
        ), self.assertRaisesRegex(
            run.RunnerError,
            "WebDriver session does not match",
        ):
            client.snapshot()

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

    def test_attached_driver_start_uses_only_declared_session_id(self) -> None:
        driver = object.__new__(attached_client._AttachedRemoteWebDriver)
        driver._attached_session_id = "externally-owned-session"
        driver.session_id = None
        driver.caps = {"unexpected": True}

        driver.start_session({"browserName": "chrome"})

        self.assertEqual("externally-owned-session", driver.session_id)
        self.assertEqual({}, driver.caps)

    def test_network_capture_rejects_streams_without_terminal_barrier(self) -> None:
        entries = [
            performance_entry(
                "Network.requestWillBeSent",
                {
                    "requestId": "request-1",
                    "request": {
                        "url": (
                            "https://station.invalid"
                            "/key-exchange/content-prekeys"
                        ),
                        "method": "POST",
                        "headers": {"Accept": "application/json"},
                        "postData": '{"public":true}',
                    },
                },
            ),
            performance_entry(
                "Network.responseReceived",
                {
                    "requestId": "request-1",
                    "response": {
                        "url": "https://station.invalid/api/v1/public",
                        "headers": {"Content-Type": "application/json"},
                    },
                },
            ),
            performance_entry(
                "Network.loadingFinished",
                {"requestId": "request-1"},
            ),
            performance_entry(
                "Network.webSocketCreated",
                {
                    "requestId": "socket-1",
                    "url": "wss://station.invalid/events",
                },
            ),
            performance_entry(
                "Network.webSocketWillSendHandshakeRequest",
                {
                    "requestId": "socket-1",
                    "request": {"headers": {"Upgrade": "websocket"}},
                },
            ),
            performance_entry(
                "Network.webSocketFrameReceived",
                {
                    "requestId": "socket-1",
                    "response": {"payloadData": '{"event":"public"}'},
                },
            ),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

            def execute_cdp_cmd(
                self,
                command: str,
                params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getResponseBody":
                    self.assert_request(params)
                    return {"body": '{"ok":true}', "base64Encoded": False}
                raise AssertionError(command)

            @staticmethod
            def assert_request(params: dict[str, Any]) -> None:
                if params != {"requestId": "request-1"}:
                    raise AssertionError(params)

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
            client.network_observation(
                private_plaintext="private-text",
                private_resource_id="private-post",
                require_response_body=True,
            )

    def test_network_capture_fetches_omitted_post_data(self) -> None:
        entries = [
            performance_entry(
                "Network.requestWillBeSent",
                {
                    "requestId": "request-private",
                    "request": {
                        "url": "https://station.invalid/api/v1/public",
                        "method": "POST",
                        "headers": {"Content-Type": "application/json"},
                        "hasPostData": True,
                    },
                },
            ),
            performance_entry(
                "Network.loadingFinished",
                {"requestId": "request-private"},
            ),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

            def execute_cdp_cmd(
                self,
                command: str,
                params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getRequestPostData":
                    if params != {"requestId": "request-private"}:
                        raise AssertionError(params)
                    return {"postData": '{"text":"private-text"}'}
                raise AssertionError(command)

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

        observation = client.network_observation(
            private_plaintext="private-text",
        )

        self.assertTrue(observation.capture_complete)
        self.assertEqual(1, observation.request_body_count)
        self.assertEqual(1, observation.plaintext_body_count)
        self.assertEqual(1, observation.secret_representation_count)

    def test_network_capture_inspects_event_source_payloads(self) -> None:
        secret = "private-sse-value"
        entries = [
            performance_entry(
                "Network.eventSourceMessageReceived",
                {
                    "requestId": "events-1",
                    "data": secret,
                    "eventName": "message",
                },
            )
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

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
            client.network_observation(private_plaintext=secret)

    def test_network_capture_detects_encoded_private_values(self) -> None:
        secret = "private value/with-symbols"
        encoded = base64.b64encode(secret.encode("utf-8")).decode("ascii")
        entries = [
            performance_entry(
                "Network.requestWillBeSent",
                {
                    "requestId": "request-1",
                    "request": {
                        "url": (
                            "https://station.invalid/api/public?q="
                            + quote(secret, safe="")
                        ),
                        "method": "GET",
                        "headers": {"X-Private-Probe": encoded},
                        "postData": json.dumps({"value": secret}),
                    },
                },
            ),
            performance_entry(
                "Network.responseReceived",
                {
                    "requestId": "request-1",
                    "response": {
                        "url": "https://station.invalid/api/public",
                        "headers": {"X-Private-Probe": encoded},
                    },
                },
            ),
            performance_entry(
                "Network.loadingFinished",
                {"requestId": "request-1"},
            ),
            performance_entry(
                "Network.webSocketHandshakeResponseReceived",
                {
                    "requestId": "socket-1",
                    "response": {"headers": {"X-Private-Probe": encoded}},
                },
            ),
            performance_entry(
                "Network.webSocketFrameSent",
                {
                    "requestId": "socket-1",
                    "response": {
                        "payloadData": encoded,
                    },
                },
            ),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

            def execute_cdp_cmd(
                self,
                command: str,
                params: dict[str, Any],
            ) -> dict[str, Any]:
                if command == "Network.enable":
                    return {}
                if command == "Network.getResponseBody":
                    if params != {"requestId": "request-1"}:
                        raise AssertionError(params)
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
        with self.assertRaisesRegex(
            run.RunnerError,
            "stream-terminal-barrier-unavailable",
        ):
            client.network_observation(
                private_plaintext=secret,
                require_response_body=True,
            )

    def test_network_capture_does_not_promote_delayed_websocket_quiet_period(
        self,
    ) -> None:
        request = performance_entry(
            "Network.requestWillBeSent",
            {
                "requestId": "request-1",
                "request": {
                    "url": "https://station.invalid/api/public",
                    "method": "GET",
                    "headers": {},
                },
            },
        )
        terminal = performance_entry(
            "Network.loadingFinished",
            {"requestId": "request-1"},
        )
        delayed_frame = performance_entry(
            "Network.webSocketFrameReceived",
            {
                "requestId": "socket-1",
                "response": {"payloadData": '{"event":"delayed"}'},
            },
        )

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], [request], [terminal], [delayed_frame]]

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

        with self.assertRaisesRegex(
            run.RunnerError,
            "stream-terminal-barrier-unavailable",
        ):
            client.network_observation(private_plaintext="private-text")

    def test_network_capture_fails_closed_with_pending_http_request(self) -> None:
        entries = [
            performance_entry(
                "Network.requestWillBeSent",
                {
                    "requestId": "request-pending",
                    "request": {
                        "url": "https://station.invalid/api/public",
                        "method": "GET",
                        "headers": {},
                    },
                },
            )
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

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

        with self.assertRaisesRegex(
            run.RunnerError,
            "pending HTTP request",
        ):
            client.network_observation(private_plaintext="private-text")

    def test_network_capture_fails_when_response_capture_is_insufficient(
        self,
    ) -> None:
        entries = [
            performance_entry(
                "Network.requestWillBeSent",
                {
                    "requestId": "request-1",
                    "request": {
                        "url": "https://station.invalid/api/public",
                        "method": "GET",
                        "headers": {},
                    },
                },
            ),
            performance_entry(
                "Network.loadingFinished",
                {"requestId": "request-1"},
            ),
        ]

        class Driver:
            def __init__(self) -> None:
                self.logs = [[], entries]

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

        with self.assertRaisesRegex(
            run.RunnerError,
            "browser network capture is insufficient",
        ):
            client.network_observation(
                private_plaintext="private-text",
                require_response_body=True,
            )

        unavailable_entries = [
            *entries,
            performance_entry(
                "Network.responseReceived",
                {
                    "requestId": "request-1",
                    "response": {
                        "url": "https://station.invalid/api/public",
                        "headers": {},
                    },
                },
            ),
        ]
        unavailable = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        unavailable.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        unavailable._driver = Driver()
        unavailable._driver.logs = [[], unavailable_entries]
        unavailable._network_capture_armed = False
        unavailable.clear_network_log()
        with self.assertRaisesRegex(
            run.RunnerError,
            "response-body-unavailable",
        ):
            unavailable.network_observation(private_plaintext="private-text")

        no_network = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        no_network.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        no_network._driver = Driver()
        no_network._driver.logs = [[], []]
        no_network._network_capture_armed = False
        no_network.clear_network_log()
        with self.assertRaisesRegex(
            run.RunnerError,
            "network-capture-unproven",
        ):
            no_network.network_observation(private_plaintext="private-text")

        validated_no_network = attached_client.AttachedProductClient.__new__(
            attached_client.AttachedProductClient
        )
        validated_no_network.context = SimpleNamespace(
            runtime="browser",
            remaining_seconds=lambda: 1.0,
        )
        validated_no_network._driver = Driver()
        validated_no_network._driver.logs = [[], []]
        validated_no_network._network_capture_armed = False
        validated_no_network.clear_network_log()
        with self.assertRaisesRegex(
            run.RunnerError,
            "network-capture-unproven",
        ):
            validated_no_network.network_observation(
                private_plaintext="private-text"
            )


if __name__ == "__main__":
    unittest.main()
