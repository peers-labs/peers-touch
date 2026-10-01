from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from tooling.development.secure_content import runtime_manifest


REPO_ROOT = Path(__file__).resolve().parents[3]
COMMIT = "600e3d468dfa46ec0522c10b4d7ec0ddf7ccb929"
WORKTREE_SET_DIGEST = (
    "35f0ea99b3cfef1e4b7dd6df54ea74f34fcb2b7caf18ba60af138f0c6c1c06cb"
)
PROTOCOL_DIGEST = "a" * 64
IDENTITY = {
    "workspaceId": "9eb2cb904c9ae460",
    "branch": "feat/federation",
    "head": COMMIT,
    "worktreeSetDigest": WORKTREE_SET_DIGEST,
}
CLIENTS = (
    ("desktop-alice", "alice", "native-tauri", "station-four"),
    ("browser-alice", "browser-alice", "browser", "station-four"),
    ("ios-alice", "alice", "tauri-ios-simulator", "station-five-arm"),
    ("android-bob", "bob", "tauri-android-emulator", "station-five-arm"),
)
FIXTURE_CAPABILITIES = (
    "account-switch",
    "station-switch",
    "publisher-device-revocation",
    "historical-recovery-epoch",
)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fixture_payload() -> dict[str, Any]:
    payload = {
        "schema_version": 1,
        "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
        "fixture_set_id": "secure-content-runtime-v3",
        "source_checkpoint": COMMIT,
        "handles": [
            {
                "kind": "owner-fixture",
                "opaque_id": f"fixture-{index}",
                "owner": "runtime-owner",
                "capability": capability,
                "expected_identity_digest": digest(capability),
            }
            for index, capability in enumerate(FIXTURE_CAPABILITIES)
        ],
    }
    return runtime_manifest.with_manifest_digest(payload)


def service_payload(
    service_id: str,
    profile_id: str,
) -> dict[str, Any]:
    deployment = runtime_manifest.CANONICAL_PROFILES[profile_id]
    return {
        "kind": "station",
        "profile_id": profile_id,
        "deployment_environment": deployment,
        "endpoint": f"http://127.0.0.1:{8400 if profile_id == 'four' else 8500}",
        "schema_attestation_endpoint": f"https://{deployment}.invalid",
        "live_commit": COMMIT,
        "protocol_digest": PROTOCOL_DIGEST,
        "runtime_identity": f"peer-{service_id}",
        "attestation_artifact_ref": {
            "path": f"attestations/{service_id}.json",
            "sha256": "0" * 64,
        },
        "canonical_private_schema_attestation_ref": {
            "path": (
                f"schema-attestations/{service_id}/"
                f"{runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME}"
            ),
            "sha256": "0" * 64,
        },
    }


def client_payload(
    client_id: str,
    actor_role: str,
    runtime_kind: str,
    service_id: str,
    index: int,
) -> dict[str, Any]:
    actor_identity = digest(f"ptid:{actor_role}")
    return {
        "id": client_id,
        "actor_role": actor_role,
        "actor_role_digest": actor_identity,
        "runtime_kind": runtime_kind,
        "required_service_roles": ["station"],
        "service_bindings": {
            "station": {
                "service_id": service_id,
                "required_kind": "station",
            }
        },
        "storage_identity_digest": digest(f"storage:{client_id}"),
        "boot_identity": digest(f"boot:{client_id}"),
        "session_generation": index + 1,
        "automation_attachment_ref": {
            "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
            "endpoint": f"http://127.0.0.1:{4400 + index}",
            "session_id": f"session-{client_id}",
        },
        "harness_identity_digest": digest(f"harness:{client_id}"),
    }


def identity_snapshot(
    payload: dict[str, Any],
    client_id: str,
    *,
    draft_present: bool = False,
) -> dict[str, Any]:
    client = next(
        item for item in payload["clients"] if item["id"] == client_id
    )
    station_binding = client["service_bindings"]["station"]
    station = payload["services"][station_binding["service_id"]]
    authenticated = client["actor_role"] != "anonymous"
    snapshot = {
        "platform": {
            "native-tauri": "native",
            "browser": "browser",
            "tauri-ios-simulator": "mobile",
            "tauri-android-emulator": "mobile",
        }[client["runtime_kind"]],
        "authenticationState": (
            "AUTHENTICATED" if authenticated else "ANONYMOUS"
        ),
        "sourceCommit": payload["source"]["commit"],
        "clientArtifactSha256": digest(f"artifact:{client_id}"),
        "sessionIdentitySha256": digest(f"session:{client_id}"),
        "bootIdentitySha256": client["boot_identity"],
        "sessionGeneration": client["session_generation"],
        "stationRuntimeIdentitySha256": digest(
            station["runtime_identity"]
        ),
        "stationEndpointSha256": digest(
            station["endpoint"].rstrip("/")
        ),
        "draft": {"present": draft_present},
        "publishState": "PUBLISHED" if draft_present else "IDLE",
        "privateProjectionCount": 1 if draft_present else 0,
    }
    if authenticated:
        snapshot["actorPtidSha256"] = client["actor_role_digest"]
    if client["runtime_kind"] != "browser":
        snapshot["nativeRuntimeIdentitySha256"] = client["boot_identity"]
    return snapshot


def bind_identity_snapshot(
    payload: dict[str, Any],
    client_id: str,
    snapshot: dict[str, Any],
) -> None:
    client = next(
        item for item in payload["clients"] if item["id"] == client_id
    )
    station_binding = client["service_bindings"]["station"]
    station = payload["services"][station_binding["service_id"]]
    client["harness_identity_digest"] = (
        runtime_manifest.harness_identity_digest(
            snapshot,
            client=client,
            source_commit=payload["source"]["commit"],
            station=station,
            automation_session_id=client["automation_attachment_ref"][
                "session_id"
            ],
        )
    )


def manifest_payload() -> dict[str, Any]:
    fixture = fixture_payload()
    payload = {
        "schema_version": runtime_manifest.SCHEMA_VERSION,
        "kind": runtime_manifest.MANIFEST_KIND,
        "run_id": "runtime-v3-run",
        "journey_id": "sc-dj-runtime-manifest-v3",
        "source": {
            "canonical_worktree": str(REPO_ROOT),
            "workspace_id": IDENTITY["workspaceId"],
            "commit": COMMIT,
            "worktree_set_digest": WORKTREE_SET_DIGEST,
            "workspace_digest": "clean",
        },
        "controller_binding": {"profile_id": "four", "slot": 5},
        "services": {
            "station-four": service_payload("station-four", "four"),
            "station-five-arm": service_payload(
                "station-five-arm",
                "fiveArm",
            ),
        },
        "clients": [
            client_payload(client_id, actor, kind, service_id, index)
            for index, (client_id, actor, kind, service_id) in enumerate(CLIENTS)
        ],
        "fixture_manifest_ref": {
            "path": "fixtures.json",
            "sha256": "0" * 64,
        },
        "fixture_manifest_digest": fixture["manifest_digest"],
        "lifecycle_observer_capabilities": sorted(
            runtime_manifest.LIFECYCLE_OBSERVER_CAPABILITIES
        ),
        "created_at": "2026-09-17T00:00:00Z",
    }
    return runtime_manifest.with_manifest_digest(payload)


def write_manifest(
    root: Path,
    payload: dict[str, Any],
    *,
    lease_window_from_manifest: bool = False,
) -> Path:
    fixture = fixture_payload()
    fixture_path = root / payload["fixture_manifest_ref"]["path"]
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_bytes = json.dumps(
        fixture,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    fixture_path.write_bytes(fixture_bytes)
    payload["fixture_manifest_ref"]["sha256"] = hashlib.sha256(
        fixture_bytes
    ).hexdigest()
    payload["fixture_manifest_digest"] = fixture["manifest_digest"]

    for service_id, service in payload["services"].items():
        attestation_path = root / service["attestation_artifact_ref"]["path"]
        attestation_path.parent.mkdir(parents=True, exist_ok=True)
        attestation = {
            "artifactKind": runtime_manifest.SERVICE_ATTESTATION_KIND,
            "serviceId": service_id,
            "serviceKind": service["kind"],
            "deploymentEnvironment": service["deployment_environment"],
            "endpoint": service["endpoint"],
            "commit": service["live_commit"],
            "workspaceDigest": "clean",
            "protocolDigest": service["protocol_digest"],
            "runtimeIdentity": service["runtime_identity"],
            "runId": payload["run_id"],
            "gateId": payload["journey_id"],
        }
        attestation_bytes = json.dumps(
            attestation,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        attestation_path.write_bytes(attestation_bytes)
        service["attestation_artifact_ref"]["sha256"] = hashlib.sha256(
            attestation_bytes
        ).hexdigest()
        schema_root = (
            root
            / service["canonical_private_schema_attestation_ref"]["path"]
        ).parent
        schema_root.mkdir(parents=True, exist_ok=True)
        public_snapshot = {
            "schema_version": 1,
            "profile_id": service["profile_id"],
            "public_post_schema_digest": "1" * 64,
            "public_post_rows_digest": "2" * 64,
            "public_comment_rows_digest": "3" * 64,
            "public_reaction_rows_digest": "4" * 64,
            "public_object_metadata_digest": "5" * 64,
            "public_object_bytes_digest": "6" * 64,
            "counts": {
                "public_comments": 3,
                "public_objects": 1,
                "public_posts": 2,
                "public_reactions": 4,
            },
        }
        public_snapshot["snapshot_digest"] = (
            runtime_manifest.canonical_digest(public_snapshot)
        )
        reset_manifest = {
            "schema_version": 1,
            "reset_id": f"reset-{service['profile_id']}",
            "reset_intent": "SCHEMA_ACTIVATION",
            "source_commit": payload["source"]["commit"],
            "workspace_id": payload["source"]["workspace_id"],
            "profile_id": service["profile_id"],
            "deployment_environment": service["deployment_environment"],
            "destructive_scope": (
                runtime_manifest.CANONICAL_PRIVATE_SCHEMA_SCOPES[
                    service["profile_id"]
                ]
            ),
            "database_identity_digest": "7" * 64,
            "public_snapshot_before": public_snapshot,
            "database_targets": [],
            "canonical_private_object_targets": [],
            "legacy_oss_object_targets": [],
            "out_of_scope_table_names": [],
            "created_at": "2026-09-16T23:58:00Z",
        }
        reset_manifest["manifest_digest"] = (
            runtime_manifest.canonical_digest(reset_manifest)
        )
        reset_bytes = json.dumps(
            reset_manifest,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        reset_path = schema_root / runtime_manifest.RESET_MANIFEST_FILENAME
        reset_path.write_bytes(reset_bytes)
        reset_path.chmod(0o600)

        transitions = []
        for index in range(
            len(runtime_manifest.RESET_JOURNAL_STATES) - 1
        ):
            transition = {
                "from_state": runtime_manifest.RESET_JOURNAL_STATES[index],
                "to_state": runtime_manifest.RESET_JOURNAL_STATES[index + 1],
                "transitioned_at": f"2026-09-16T23:59:0{index}Z",
            }
            transition["transition_digest"] = (
                runtime_manifest.canonical_digest(transition)
            )
            transitions.append(transition)
        journal = {
            "schema_version": 1,
            "reset_manifest_digest": reset_manifest["manifest_digest"],
            "current_state": "COMPLETE",
            "accepted_invocations": [
                {
                    "invocation_id": f"invoke-{service['profile_id']}",
                    "invocation_digest": "8" * 64,
                    "accepted_at": "2026-09-16T23:59:00Z",
                }
            ],
            "transitions": transitions,
            "failure": None,
        }
        journal_bytes = json.dumps(
            journal,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        journal_path = (
            schema_root / runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME
        )
        journal_path.write_bytes(journal_bytes)
        journal_path.chmod(0o600)

        schema_attestation = {
            "schema_version": 1,
            "source_commit": payload["source"]["commit"],
            "workspace_id": payload["source"]["workspace_id"],
            "profile_id": service["profile_id"],
            "deployment_environment": service["deployment_environment"],
            "destructive_scope": reset_manifest["destructive_scope"],
            "station_service_id": service_id,
            "station_peer_id": f"peer-{service_id}",
            "station_runtime_identity": service["runtime_identity"],
            "service_attestation_digest": (
                runtime_manifest.schema_service_attestation_binding_digest(
                    service_id,
                    service,
                )
            ),
            "reset_intent": reset_manifest["reset_intent"],
            "reset_manifest_digest": reset_manifest["manifest_digest"],
            "completed_journal_digest": runtime_manifest.canonical_digest(
                journal
            ),
            "canonical_private_schema_digest": "9" * 64,
            "retired_columns_absent": True,
            "public_snapshot_digest": public_snapshot["snapshot_digest"],
            "created_at": "2026-09-17T00:00:00Z",
        }
        schema_attestation["attestation_digest"] = (
            runtime_manifest.canonical_digest(schema_attestation)
        )
        schema_bytes = json.dumps(
            schema_attestation,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        schema_path = (
            root
            / service["canonical_private_schema_attestation_ref"]["path"]
        )
        schema_path.write_bytes(schema_bytes)
        schema_path.chmod(0o600)
        service["canonical_private_schema_attestation_ref"]["sha256"] = (
            hashlib.sha256(schema_bytes).hexdigest()
        )

    continuation = payload.get("continuation")
    if isinstance(continuation, dict):
        manifest_created_at = (
            datetime.fromisoformat(
                str(payload["created_at"]).replace("Z", "+00:00")
            ).astimezone(timezone.utc)
            if lease_window_from_manifest
            else datetime(2026, 9, 17, tzinfo=timezone.utc)
        )
        lease_path = root / "leases" / f"{payload['run_id']}.json"
        lease_path.parent.mkdir(parents=True, exist_ok=True)
        lease_evidence = {
            "schema_version": 1,
            "kind": runtime_manifest.RUNTIME_LEASE_EVIDENCE_KIND,
            "owner_id": runtime_manifest.RUNTIME_OWNER_ID,
            "request_id": continuation["restart_request_id"],
            "parent_manifest_digest": continuation[
                "parent_manifest_digest"
            ],
            "retained_client_id": continuation["retained_client_id"],
            "lease_ids": [f"lease-{payload['run_id']}"],
            "acquired_at": (
                manifest_created_at - timedelta(minutes=1)
            ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "expires_at": (
                manifest_created_at + timedelta(minutes=20)
            ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        lease_evidence["artifact_digest"] = (
            runtime_manifest.canonical_digest(lease_evidence)
        )
        lease_bytes = json.dumps(
            lease_evidence,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        lease_path.write_bytes(lease_bytes)
        continuation["lease_evidence_ref"] = {
            "path": lease_path.relative_to(root).as_posix(),
            "sha256": hashlib.sha256(lease_bytes).hexdigest(),
        }

    finalized = runtime_manifest.with_manifest_digest(payload)
    path = root / f"{finalized['run_id']}.json"
    path.write_text(
        json.dumps(finalized, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    path.chmod(0o600)
    return path


def rewrite_schema_artifacts(
    path: Path,
    *,
    service_id: str = "station-four",
    mutate_manifest: Callable[[dict[str, Any]], None] | None = None,
    mutate_attestation: Callable[[dict[str, Any]], None] | None = None,
    mutate_journal: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    service = payload["services"][service_id]
    reference = service["canonical_private_schema_attestation_ref"]
    attestation_path = path.parent / reference["path"]
    schema_root = attestation_path.parent
    attestation = json.loads(attestation_path.read_text(encoding="utf-8"))
    reset_path = schema_root / runtime_manifest.RESET_MANIFEST_FILENAME
    reset_manifest = json.loads(reset_path.read_text(encoding="utf-8"))
    journal_path = (
        schema_root / runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME
    )
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    if mutate_manifest is not None:
        mutate_manifest(reset_manifest)
        reset_manifest.pop("manifest_digest", None)
        reset_manifest["manifest_digest"] = runtime_manifest.canonical_digest(
            reset_manifest
        )
        reset_path.write_text(
            json.dumps(reset_manifest, separators=(",", ":"), sort_keys=True),
            encoding="utf-8",
        )
        reset_path.chmod(0o600)
        journal["reset_manifest_digest"] = reset_manifest["manifest_digest"]
        attestation["reset_manifest_digest"] = reset_manifest["manifest_digest"]
    if mutate_journal is not None:
        mutate_journal(journal)
    if mutate_manifest is not None or mutate_journal is not None:
        journal_path.write_text(
            json.dumps(journal, separators=(",", ":"), sort_keys=True),
            encoding="utf-8",
        )
        journal_path.chmod(0o600)
        attestation["completed_journal_digest"] = (
            runtime_manifest.canonical_digest(journal)
        )
    if mutate_attestation is not None:
        mutate_attestation(attestation)
    attestation.pop("attestation_digest", None)
    attestation["attestation_digest"] = runtime_manifest.canonical_digest(
        attestation
    )
    attestation_bytes = json.dumps(
        attestation,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    attestation_path.write_bytes(attestation_bytes)
    attestation_path.chmod(0o600)
    reference["sha256"] = hashlib.sha256(attestation_bytes).hexdigest()
    path.write_text(
        json.dumps(
            runtime_manifest.with_manifest_digest(payload),
            separators=(",", ":"),
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def load(
    path: Path,
    *,
    profiles: tuple[str, ...] = ("four", "fiveArm"),
    clients: tuple[str, ...] = tuple(item[0] for item in CLIENTS),
    runtime: str | None = None,
) -> runtime_manifest.RuntimeManifestBinding:
    return runtime_manifest.load_runtime_manifest(
        path,
        journey_id="sc-dj-runtime-manifest-v3",
        repo_root=REPO_ROOT,
        workspace_identity=IDENTITY,
        profile_selectors=profiles,
        client_selectors=clients,
        runtime=runtime,
        expected_protocol_digest=PROTOCOL_DIGEST,
        required_fixture_capabilities=FIXTURE_CAPABILITIES,
    )


class RuntimeManifestV3Test(unittest.TestCase):
    def test_post_cut_binding_is_closed_and_optional(self) -> None:
        bindings = {
            profile: {
                "result_digest": digest(f"result:{profile}"),
                "reset_id": f"reset-{profile}",
                "schema_attestation_digest": digest(f"schema:{profile}"),
                "station_runtime_identity": f"runtime-{profile}",
            }
            for profile in ("four", "fiveArm")
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = manifest_payload()
            payload["post_cut_epoch_id"] = "post-cut-epoch"
            payload["final_cut_bindings"] = bindings
            path = write_manifest(root, payload)

            loaded = load(path)

            self.assertEqual(
                "post-cut-epoch",
                loaded.payload["post_cut_epoch_id"],
            )
            self.assertEqual(bindings, loaded.payload["final_cut_bindings"])

        for missing in ("post_cut_epoch_id", "final_cut_bindings"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                payload = manifest_payload()
                payload["post_cut_epoch_id"] = "post-cut-epoch"
                payload["final_cut_bindings"] = bindings
                payload.pop(missing)
                path = write_manifest(root, payload)
                with self.assertRaisesRegex(
                    runtime_manifest.RuntimeManifestError,
                    "must be declared together",
                ):
                    load(path)

    def test_rfc3339_nano_accepts_variable_fractional_precision(self) -> None:
        parsed = runtime_manifest._timestamp_for_code(
            "2026-09-20T18:34:17.98966Z",
            "accepted_at",
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        )

        self.assertEqual(989660, parsed.microsecond)

    def test_validates_exact_multi_service_and_four_client_kind_closure(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            binding = load(path)

            self.assertEqual("runtime-v3-run", binding.run_id)
            self.assertEqual(
                frozenset({"four", "fiveArm"}),
                binding.service_profiles,
            )
            self.assertEqual(
                runtime_manifest.CLIENT_KINDS,
                frozenset(
                    client["runtime_kind"]
                    for client in binding.clients.values()
                ),
            )
            self.assertEqual(
                [item[1] for item in CLIENTS],
                [
                    binding.client(item[0])["actor_role"]
                    for item in CLIENTS
                ],
            )
            self.assertTrue(
                all(
                    set(client) == runtime_manifest.CLIENT_FIELDS
                    for client in binding.clients.values()
                )
            )
            self.assertEqual(
                frozenset(FIXTURE_CAPABILITIES),
                binding.fixture_capabilities,
            )
            self.assertEqual(
                set(FIXTURE_CAPABILITIES),
                set(binding.fixture_handles),
            )
            self.assertEqual(
                "fixture-0",
                binding.fixture_handle("account-switch")["opaque_id"],
            )
            self.assertEqual(
                binding.payload["manifest_digest"],
                binding.sha256,
            )

    def test_rejects_runtime_manifest_v2_after_v3_hard_cut(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            payload = manifest_payload()
            payload["schema_version"] = 2
            path = write_manifest(Path(temp), payload)

            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as raised:
                load(path)

            self.assertEqual(
                "UNSUPPORTED_MANIFEST_VERSION",
                raised.exception.code,
            )

    def test_distinct_service_endpoints_bind_separate_attestations(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            binding = load(path)
            service = binding.services["station-four"]
            attestation = json.loads(
                (
                    path.parent
                    / service["attestation_artifact_ref"]["path"]
                ).read_text(encoding="utf-8")
            )
            schema_attestation = json.loads(
                (
                    path.parent
                    / service[
                        "canonical_private_schema_attestation_ref"
                    ]["path"]
                ).read_text(encoding="utf-8")
            )

            self.assertNotEqual(
                service["endpoint"],
                service["schema_attestation_endpoint"],
            )
            self.assertEqual(service["endpoint"], attestation["endpoint"])
            self.assertEqual(
                runtime_manifest.schema_service_attestation_binding_digest(
                    "station-four",
                    service,
                ),
                schema_attestation["service_attestation_digest"],
            )

    def test_rejects_endpoint_boundary_failures_with_owned_errors(self) -> None:
        cases: dict[
            str,
            tuple[str, Callable[[dict[str, Any]], None]],
        ] = {
            "malformed live endpoint": (
                "SERVICE_CLOSURE_MISMATCH",
                lambda payload: payload["services"]["station-four"].__setitem__(
                    "endpoint",
                    "http://[::1",
                ),
            ),
            "malformed schema endpoint": (
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                lambda payload: payload["services"]["station-four"].__setitem__(
                    "schema_attestation_endpoint",
                    "http://station-four.invalid:70000",
                ),
            ),
            "whitespace schema endpoint": (
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                lambda payload: payload["services"]["station-four"].__setitem__(
                    "schema_attestation_endpoint",
                    "https://station four.invalid",
                ),
            ),
            "substituted schema endpoint": (
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                lambda payload: payload["services"]["station-four"].__setitem__(
                    "schema_attestation_endpoint",
                    "https://substituted.invalid",
                ),
            ),
        }
        for name, (code, mutate) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                path = write_manifest(Path(temp), manifest_payload())
                payload = json.loads(path.read_text(encoding="utf-8"))
                mutate(payload)
                path.write_text(
                    json.dumps(
                        runtime_manifest.with_manifest_digest(payload),
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    encoding="utf-8",
                )

                with self.assertRaises(
                    runtime_manifest.RuntimeManifestError
                ) as raised:
                    load(path)

                self.assertEqual(code, raised.exception.code)

    def test_requires_closed_canonical_private_schema_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["services"]["station-four"].pop(
                "canonical_private_schema_attestation_ref"
            )
            path.write_text(
                json.dumps(
                    runtime_manifest.with_manifest_digest(payload),
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                encoding="utf-8",
            )

            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as raised:
                load(path)
            self.assertEqual(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                raised.exception.code,
            )

    def test_requires_schema_attestation_endpoint_in_closed_service_shape(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["services"]["station-four"].pop(
                "schema_attestation_endpoint"
            )
            path.write_text(
                json.dumps(
                    runtime_manifest.with_manifest_digest(payload),
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                encoding="utf-8",
            )

            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as raised:
                load(path)

            self.assertEqual(
                "SERVICE_CLOSURE_MISMATCH",
                raised.exception.code,
            )

    def test_rejects_stale_or_wrong_schema_attestation_bindings(self) -> None:
        cases: dict[str, Callable[[dict[str, Any]], None]] = {
            "source": lambda value: value.__setitem__(
                "source_commit",
                "f" * 40,
            ),
            "workspace": lambda value: value.__setitem__(
                "workspace_id",
                "wrong-workspace",
            ),
            "profile": lambda value: value.__setitem__(
                "profile_id",
                "fiveArm",
            ),
            "environment": lambda value: value.__setitem__(
                "deployment_environment",
                "station-five-arm",
            ),
            "scope": lambda value: value.__setitem__(
                "destructive_scope",
                "station-five-arm-social-private",
            ),
            "service": lambda value: value.__setitem__(
                "station_service_id",
                "station-five-arm",
            ),
            "peer": lambda value: value.__setitem__(
                "station_peer_id",
                "",
            ),
            "runtime": lambda value: value.__setitem__(
                "station_runtime_identity",
                "wrong-runtime",
            ),
            "service attestation": lambda value: value.__setitem__(
                "service_attestation_digest",
                "f" * 64,
            ),
            "schema": lambda value: value.__setitem__(
                "canonical_private_schema_digest",
                "not-a-digest",
            ),
            "retired columns": lambda value: value.__setitem__(
                "retired_columns_absent",
                False,
            ),
            "reset intent": lambda value: value.__setitem__(
                "reset_intent",
                "UNKNOWN",
            ),
            "public snapshot": lambda value: value.__setitem__(
                "public_snapshot_digest",
                "f" * 64,
            ),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                path = write_manifest(Path(temp), manifest_payload())
                rewrite_schema_artifacts(
                    path,
                    mutate_attestation=mutate,
                )
                with self.assertRaises(
                    runtime_manifest.RuntimeManifestError
                ) as raised:
                    load(path)
                self.assertEqual(
                    "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                    raised.exception.code,
                )

    def test_rejects_non_complete_schema_activation_journal(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            rewrite_schema_artifacts(
                path,
                mutate_journal=lambda journal: journal.update(
                    {
                        "current_state": "POST_AUDIT_PASSED",
                        "transitions": journal["transitions"][:-1],
                    }
                ),
            )

            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as raised:
                load(path)
            self.assertEqual(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                raised.exception.code,
            )

    def test_accepts_exact_recovery_predecessor(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            rewrite_schema_artifacts(
                path,
                mutate_manifest=lambda manifest: manifest.__setitem__(
                    "recovery_predecessor",
                    {
                        "reset_id": "reset-four-old",
                        "reset_manifest_digest": "1" * 64,
                        "journal_digest": "2" * 64,
                        "state": "STATION_DEPLOYED",
                        "failure_code": "RESET_SCHEMA_TARGET_UNREVIEWED",
                    },
                ),
            )

            load(path)

    def test_rejects_explicit_null_recovery_predecessor(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            rewrite_schema_artifacts(
                path,
                mutate_manifest=lambda manifest: manifest.__setitem__(
                    "recovery_predecessor",
                    None,
                ),
            )

            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as raised:
                load(path)
            self.assertEqual(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                raised.exception.code,
            )

    def test_rejects_service_attestation_without_run_or_journey_identity(
        self,
    ) -> None:
        for field_name in ("runId", "gateId"):
            with self.subTest(field=field_name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = write_manifest(root, manifest_payload())
                payload = json.loads(path.read_text(encoding="utf-8"))
                reference = payload["services"]["station-four"][
                    "attestation_artifact_ref"
                ]
                attestation_path = root / reference["path"]
                attestation = json.loads(
                    attestation_path.read_text(encoding="utf-8")
                )
                attestation.pop(field_name)
                attestation_bytes = json.dumps(
                    attestation,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
                attestation_path.write_bytes(attestation_bytes)
                reference["sha256"] = hashlib.sha256(
                    attestation_bytes
                ).hexdigest()
                path.write_text(
                    json.dumps(
                        runtime_manifest.with_manifest_digest(payload),
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    encoding="utf-8",
                )

                with self.assertRaises(
                    runtime_manifest.RuntimeManifestError
                ) as raised:
                    load(path)
                self.assertEqual(
                    "SOURCE_ATTESTATION_MISMATCH",
                    raised.exception.code,
                )

    def test_runtime_selector_uses_exact_kind_partition_not_manifest_order(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            desktop = load(
                path,
                clients=("desktop-alice",),
                runtime="desktop",
            )
            mobile = load(
                path,
                clients=("android-bob", "ios-alice"),
                runtime="mobile",
            )

            self.assertEqual(
                "native-tauri",
                desktop.client("desktop-alice")["runtime_kind"],
            )
            self.assertEqual(
                {"ios-alice", "android-bob"},
                set(mobile.clients).intersection({"ios-alice", "android-bob"}),
            )

    def test_rejects_v1_and_every_legacy_topology_field(self) -> None:
        cases: dict[str, Callable[[dict[str, Any]], None]] = {
            "schema v1": lambda payload: payload.__setitem__(
                "schema_version",
                1,
            ),
            "artifactKind": lambda payload: payload.__setitem__(
                "artifactKind",
                "acceptance-runtime-manifest",
            ),
            "singular profile": lambda payload: payload.__setitem__(
                "profile",
                {"requestedName": "four"},
            ),
            "development attachment": lambda payload: payload.__setitem__(
                "developmentAttachment",
                {},
            ),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                payload = manifest_payload()
                mutate(payload)
                path = write_manifest(Path(temp), payload)
                with self.assertRaises(runtime_manifest.RuntimeManifestError):
                    load(path)

    def test_rejects_fail_closed_negative_matrix(self) -> None:
        cases: dict[
            str,
            tuple[str, Callable[[dict[str, Any]], None]],
        ] = {
            "unknown client kind": (
                "UNKNOWN_CLIENT_KIND",
                lambda payload: payload["clients"][0].__setitem__(
                    "runtime_kind",
                    "physical-ios-device",
                ),
            ),
            "endpoint copied into binding": (
                "SERVICE_CLOSURE_MISMATCH",
                lambda payload: payload["clients"][0]["service_bindings"][
                    "station"
                ].__setitem__("endpoint", "https://guessed.invalid"),
            ),
            "dangling service": (
                "SERVICE_CLOSURE_MISMATCH",
                lambda payload: payload["clients"][0]["service_bindings"][
                    "station"
                ].__setitem__("service_id", "station-guessed"),
            ),
            "duplicate storage": (
                "DUPLICATE_STORAGE_IDENTITY",
                lambda payload: payload["clients"][1].__setitem__(
                    "storage_identity_digest",
                    payload["clients"][0]["storage_identity_digest"],
                ),
            ),
            "duplicate boot": (
                "STALE_CLIENT_IDENTITY",
                lambda payload: payload["clients"][1].__setitem__(
                    "boot_identity",
                    payload["clients"][0]["boot_identity"],
                ),
            ),
            "stale session generation": (
                "STALE_CLIENT_IDENTITY",
                lambda payload: payload["clients"][0].__setitem__(
                    "session_generation",
                    0,
                ),
            ),
            "unsupported attachment": (
                "UNSUPPORTED_ATTACHMENT",
                lambda payload: payload["clients"][0][
                    "automation_attachment_ref"
                ].__setitem__("kind", "launch-command"),
            ),
            "source mismatch": (
                "SOURCE_IDENTITY_MISMATCH",
                lambda payload: payload["source"].__setitem__(
                    "commit",
                    "f" * 40,
                ),
            ),
            "service source mismatch": (
                "SOURCE_ATTESTATION_MISMATCH",
                lambda payload: payload["services"]["station-four"].__setitem__(
                    "live_commit",
                    "f" * 40,
                ),
            ),
            "empty service roles": (
                "SERVICE_CLOSURE_MISMATCH",
                lambda payload: (
                    payload["clients"][0].__setitem__(
                        "required_service_roles",
                        [],
                    ),
                    payload["clients"][0].__setitem__(
                        "service_bindings",
                        {},
                    ),
                ),
            ),
            "missing Station role": (
                "SERVICE_CLOSURE_MISMATCH",
                lambda payload: (
                    payload["clients"][0].__setitem__(
                        "required_service_roles",
                        ["social"],
                    ),
                    payload["clients"][0].__setitem__(
                        "service_bindings",
                        {
                            "social": {
                                "service_id": "station-four",
                                "required_kind": "station",
                            }
                        },
                    ),
                ),
            ),
        }
        for name, (code, mutate) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                payload = manifest_payload()
                mutate(payload)
                path = write_manifest(Path(temp), payload)
                with self.assertRaises(runtime_manifest.RuntimeManifestError) as raised:
                    load(path)
                self.assertEqual(code, raised.exception.code)
                self.assertEqual("BLOCKED", raised.exception.result)
                self.assertEqual("UNPROVEN", raised.exception.proof_state)
                self.assertEqual("PRE_ACTION", raised.exception.stage)

    def test_rejects_profile_and_client_selector_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            with self.assertRaises(runtime_manifest.RuntimeManifestError) as profile:
                load(path, profiles=("four",))
            self.assertEqual("PROFILE_SELECTOR_DRIFT", profile.exception.code)

            with self.assertRaises(runtime_manifest.RuntimeManifestError) as client:
                load(path, clients=("desktop-alice",))
            self.assertEqual("CLIENT_CLOSURE_MISMATCH", client.exception.code)

    def test_rejects_missing_fixture_capability_before_actions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = write_manifest(Path(temp), manifest_payload())
            with self.assertRaises(runtime_manifest.RuntimeManifestError) as raised:
                runtime_manifest.load_runtime_manifest(
                    path,
                    journey_id="sc-dj-runtime-manifest-v3",
                    repo_root=REPO_ROOT,
                    workspace_identity=IDENTITY,
                    profile_selectors=("four", "fiveArm"),
                    client_selectors=tuple(item[0] for item in CLIENTS),
                    runtime=None,
                    expected_protocol_digest=PROTOCOL_DIGEST,
                    required_fixture_capabilities=(
                        *FIXTURE_CAPABILITIES,
                        "missing-capability",
                    ),
                )
            self.assertEqual(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                raised.exception.code,
            )
            self.assertTrue(raised.exception.retryable)

    def test_detects_manifest_and_provenance_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = write_manifest(root, manifest_payload())
            binding = load(path)
            path.write_text("{}\n", encoding="utf-8")
            with self.assertRaises(runtime_manifest.RuntimeManifestError) as manifest:
                binding.verify_unchanged()
            self.assertEqual(
                "MUTABLE_MANIFEST_LINEAGE",
                manifest.exception.code,
            )

            path = write_manifest(
                root,
                {
                    **manifest_payload(),
                    "run_id": "runtime-v3-provenance",
                },
            )
            binding = load(path)
            fixture_path = root / "fixtures.json"
            fixture_path.write_text("{}\n", encoding="utf-8")
            with self.assertRaises(runtime_manifest.RuntimeManifestError) as fixture:
                binding.verify_unchanged()
            self.assertEqual(
                "MUTABLE_MANIFEST_LINEAGE",
                fixture.exception.code,
            )

    def test_harness_digest_uses_only_live_identity_projection(self) -> None:
        payload = manifest_payload()
        client_id = "desktop-alice"
        baseline = identity_snapshot(payload, client_id)
        bind_identity_snapshot(payload, client_id, baseline)
        with tempfile.TemporaryDirectory() as temp:
            binding = load(write_manifest(Path(temp), payload))
            session_id = binding.client(client_id)[
                "automation_attachment_ref"
            ]["session_id"]

            runtime_manifest.validate_harness_snapshot(
                binding,
                client_id,
                identity_snapshot(
                    payload,
                    client_id,
                    draft_present=True,
                ),
                automation_session_id=session_id,
            )

            identity_mutations = {
                "actor": {"actorPtidSha256": "f" * 64},
                "source": {"sourceCommit": "f" * 40},
                "artifact": {"clientArtifactSha256": "f" * 64},
                "station endpoint": {"stationEndpointSha256": "f" * 64},
                "station runtime": {
                    "stationRuntimeIdentitySha256": "f" * 64
                },
                "boot": {"bootIdentitySha256": "f" * 64},
                "native boot": {"nativeRuntimeIdentitySha256": "f" * 64},
                "session generation": {"sessionGeneration": 999},
                "session": {"sessionIdentitySha256": "f" * 64},
            }
            for name, mutation in identity_mutations.items():
                with self.subTest(name=name), self.assertRaises(
                    runtime_manifest.RuntimeManifestError
                ):
                    runtime_manifest.validate_harness_snapshot(
                        binding,
                        client_id,
                        {**baseline, **mutation},
                        automation_session_id=session_id,
                    )
            with self.assertRaises(runtime_manifest.RuntimeManifestError):
                runtime_manifest.validate_harness_snapshot(
                    binding,
                    client_id,
                    baseline,
                    automation_session_id="wrong-automation-session",
                )

    def test_browser_harness_identity_binds_boot_and_session_generation(
        self,
    ) -> None:
        payload = manifest_payload()
        client_id = "browser-alice"
        baseline = identity_snapshot(payload, client_id)
        bind_identity_snapshot(payload, client_id, baseline)
        with tempfile.TemporaryDirectory() as temp:
            binding = load(write_manifest(Path(temp), payload))
            session_id = binding.client(client_id)[
                "automation_attachment_ref"
            ]["session_id"]
            for mutation in (
                {"bootIdentitySha256": "f" * 64},
                {"sessionGeneration": 999},
            ):
                with self.subTest(mutation=mutation), self.assertRaises(
                    runtime_manifest.RuntimeManifestError
                ):
                    runtime_manifest.validate_harness_snapshot(
                        binding,
                        client_id,
                        {**baseline, **mutation},
                        automation_session_id=session_id,
                    )

    def test_validates_attach_only_owner_continuation_for_mobile_client_id(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            parent_payload = manifest_payload()
            parent_payload["clients"][2]["id"] = "ios_alice"
            parent_payload["clients"][2]["automation_attachment_ref"][
                "session_id"
            ] = "session-ios_alice"
            client_ids = tuple(
                "ios_alice" if client_id == "ios-alice" else client_id
                for client_id, *_ in CLIENTS
            )
            parent_path = write_manifest(root, parent_payload)
            parent = load(parent_path, clients=client_ids)

            child_payload = copy.deepcopy(parent_payload)
            child_payload["run_id"] = "runtime-v3-child"
            retained = child_payload["clients"][2]
            previous = parent.client("ios_alice")
            retained["boot_identity"] = digest(
                "boot:ios_alice:restarted"
            )
            retained["session_generation"] = previous["session_generation"] + 1
            retained["automation_attachment_ref"]["session_id"] = (
                "session-ios_alice-restarted"
            )
            child_payload["continuation"] = {
                "parent_manifest_digest": parent.sha256,
                "restart_request_id": "restart-ios-alice",
                "retained_client_id": "ios_alice",
                "retained_storage_identity_digest": previous[
                    "storage_identity_digest"
                ],
                "previous_boot_identity": previous["boot_identity"],
                "runtime_owner_acknowledgement_id": "ack-ios-alice",
                "lease_evidence_ref": {
                    "path": "leases/runtime-v3-child.json",
                    "sha256": "0" * 64,
                },
            }
            child_path = write_manifest(root, child_payload)
            child = load(child_path, clients=client_ids)

            expired_payload = copy.deepcopy(child_payload)
            expired_payload["run_id"] = "runtime-v3-expired-child"
            expired_payload["created_at"] = "2026-09-17T00:20:01Z"
            with self.assertRaises(
                runtime_manifest.RuntimeManifestError
            ) as expired:
                load(
                    write_manifest(root, expired_payload),
                    clients=client_ids,
                )
            self.assertEqual(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                expired.exception.code,
            )

            request = {
                "schema_version": 1,
                "kind": "secure-content-runtime-restart-request",
                "run_id": parent.run_id,
                "request_id": "restart-ios-alice",
                "client_id": "ios_alice",
                "parent_runtime_manifest_digest": parent.sha256,
                "expected_source_checkpoint": COMMIT,
                "expected_profile": ["fiveArm", "four"],
                "retained_storage_identity_digest": previous[
                    "storage_identity_digest"
                ],
                "resume_artifact_digest": "d" * 64,
            }
            acknowledgement = {
                "schema_version": 1,
                "kind": runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND,
                "request_id": "restart-ios-alice",
                "owner_id": runtime_manifest.RUNTIME_OWNER_ID,
                "acknowledgement_id": "ack-ios-alice",
                "parent_runtime_manifest_digest": parent.sha256,
                "child_runtime_manifest_digest": child.sha256,
                "previous_boot_identity": previous["boot_identity"],
                "current_boot_identity": retained["boot_identity"],
                "session_generation": retained["session_generation"],
                "retained_storage_identity_digest": retained[
                    "storage_identity_digest"
                ],
                "lease_evidence_ref": child.payload["continuation"][
                    "lease_evidence_ref"
                ],
            }
            acknowledgement["artifact_digest"] = (
                runtime_manifest.canonical_digest(acknowledgement)
            )

            runtime_manifest.validate_owner_continuation(
                parent,
                child,
                restart_request=request,
                acknowledgement=acknowledgement,
                resume_artifact_digest="d" * 64,
            )

            acknowledgement["current_boot_identity"] = previous["boot_identity"]
            acknowledgement["artifact_digest"] = (
                runtime_manifest.canonical_digest(
                    {
                        key: value
                        for key, value in acknowledgement.items()
                        if key != "artifact_digest"
                    }
                )
            )
            with self.assertRaises(runtime_manifest.RuntimeManifestError) as raised:
                runtime_manifest.validate_owner_continuation(
                    parent,
                    child,
                    restart_request=request,
                    acknowledgement=acknowledgement,
                    resume_artifact_digest="d" * 64,
                )
            self.assertEqual(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                raised.exception.code,
            )


if __name__ == "__main__":
    unittest.main()
