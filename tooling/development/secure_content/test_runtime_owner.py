from __future__ import annotations

import json
import shutil
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from typing import Mapping
from unittest.mock import MagicMock, call, patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.fixtures.secure_content_w7 import (
    W7FixtureBinding,
    W7FixtureCapabilityHandler,
    W7FixtureOwner,
    W7_FIXTURE_OPERATIONS,
    W7_FIXTURE_OWNERS,
)
from tooling.development.secure_content import runtime_manifest
from tooling.development.secure_content.run import RunnerError, ScenarioContext
from tooling.development.secure_content.runtime_owner import (
    BROWSER_JOURNEY,
    REQUIRED_FIXTURE_CAPABILITIES,
    RuntimeOwnerBlocked,
    _activate_scenario_journey,
    _authenticate_running_client,
    _build_fixture_owner,
    _client_payload,
    _continuation_run_id,
    _continuation_services,
    _copy_immutable,
    _error_message_with_cleanup,
    _make_client,
    _manifest_payload,
    _open_station_tunnels,
    _prepare_accepted_friendship,
    _publish_canonical_private_schema_attestation,
    _provision_runtime_accounts,
    _resolve_canonical_private_schema_attestation,
    _restart_lease,
    _runtime_cleanup_scope,
    _service_payload,
    _stage_continuation_evidence,
    _start_client,
    _stop_client_or_raise,
    _storage_identity,
    _validate_fixture,
    _verify_live_canonical_private_schema_attestation,
    _wait_for_moments_snapshot,
)


COMMIT = "6" * 40
IDENTITY = {
    "root": "/tmp/peers-touch",
    "workspaceId": "9eb2cb904c9ae460",
    "head": COMMIT,
    "worktreeSetDigest": "7" * 64,
}


def fixture_payload() -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": 1,
        "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
        "fixture_set_id": "w7-owner-fixture",
        "source_checkpoint": COMMIT,
        "handles": [
            {
                "kind": f"{capability}-fixture",
                "opaque_id": f"observed-{index}",
                "owner": W7_FIXTURE_OWNERS[capability],
                "capability": capability,
                "expected_identity_digest": str(index + 1) * 64,
                **(
                    {"secret_channel_ref": "w7-recovery-secret-channel"}
                    if capability == "historical-recovery-epoch"
                    else {}
                ),
            }
            for index, capability in enumerate(
                sorted(REQUIRED_FIXTURE_CAPABILITIES)
            )
        ],
    }
    payload["manifest_digest"] = runtime_manifest.canonical_digest(payload)
    return payload


class RuntimeOwnerTest(unittest.TestCase):
    def test_client_launch_uses_projected_runtime_source_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch(
                    "tooling.development.secure_content.runtime_owner._free_port",
                    side_effect=(4501, 4502, 4503),
                ),
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "FoundationRuntimeClient"
                ) as client_type,
            ):
                _make_client(
                    repo_root=Path(__file__).resolve().parents[3],
                    runtime_root=Path(directory),
                    station_url="https://station.invalid",
                    profile_env={},
                    source_commit=COMMIT,
                    client_id="desktop-alice",
                    runtime_kind="native-tauri",
                    port_bases=(4501, 4502, 4503),
                    reserved_ports=set(),
                )

        self.assertEqual(
            {
                "PT_BUILD_SOURCE_COMMIT": COMMIT,
                "PT_SECURE_CONTENT_RUNTIME_OWNER": "1",
            },
            client_type.call_args.kwargs["launch_env"],
        )
        self.assertEqual(
            COMMIT,
            client_type.call_args.kwargs["profile_env"][
                "PT_BUILD_SOURCE_COMMIT"
            ],
        )

    def test_running_client_authentication_uses_fixture_replacement_and_retries(
        self,
    ) -> None:
        client = MagicMock()
        client.driver = object()
        client.harness_namespace = "moments"
        client.spec = SimpleNamespace(profile="secure-content-desktop-alice")
        namespaces: list[str] = []

        def restore(*_args: object, **_kwargs: object) -> Mapping[str, object]:
            namespaces.append(client.harness_namespace)
            if len(namespaces) == 1:
                raise RuntimeError("acceptance bridge reloading")
            return {"authenticated": True}

        client.harness.side_effect = restore

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            _authenticate_running_client(
                client,
                account="alice@testnet.local",
                password="password",
            )

        self.assertEqual(2, client.harness.call_count)
        self.assertEqual(
            [
                call(
                    "restoreSessionWithPassword",
                    {
                        "account": "alice@testnet.local",
                        "password": "password",
                    },
                    timeout=120,
                ),
                call(
                    "restoreSessionWithPassword",
                    {
                        "account": "alice@testnet.local",
                        "password": "password",
                    },
                    timeout=120,
                ),
            ],
            client.harness.call_args_list,
        )
        self.assertEqual(
            ["secure-content-fixture", "secure-content-fixture"],
            namespaces,
        )
        self.assertEqual("moments", client.harness_namespace)

    def test_runtime_accounts_are_unique_and_provisioned_on_required_stations(
        self,
    ) -> None:
        response = MagicMock()
        response.status = 201
        response.read.return_value = b"{}"
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with patch(
            "tooling.development.secure_content.runtime_owner."
            "urllib.request.urlopen",
            return_value=response,
        ) as open_request:
            accounts, password = _provision_runtime_accounts(
                primary_station_url="http://127.0.0.1:4101",
                secondary_station_url="http://127.0.0.1:4102",
                run_id="w7-runtime-accounts",
                roles=("alice", "bob", "eve", "browser_actor"),
                secondary_roles=("bob",),
            )

        self.assertEqual(
            {"alice", "bob", "eve", "browser_actor"},
            set(accounts),
        )
        self.assertEqual(4, len(set(accounts.values())))
        self.assertTrue(password.startswith("W7Aa1!"))
        self.assertEqual(5, open_request.call_count)
        urls = [call.args[0].full_url for call in open_request.call_args_list]
        self.assertEqual(4, urls.count("http://127.0.0.1:4101/actor/sign-up"))
        self.assertEqual(1, urls.count("http://127.0.0.1:4102/actor/sign-up"))

    def test_accepted_friendship_uses_social_authority_flow(self) -> None:
        alice = MagicMock()
        alice.harness_namespace = "agent"
        alice.harness.side_effect = (
            {"actorPtid": "ptid:alice"},
            {
                "federationId": "federation-1",
                "homeStationPeerId": "station-four",
            },
            {"requestId": "friend-request-1"},
        )
        bob = MagicMock()
        bob.harness_namespace = "agent"
        bob.harness.side_effect = (
            {"actorPtid": "ptid:bob"},
            {
                "federationId": "federation-1",
                "homeStationPeerId": "station-four",
            },
            {"accepted": True, "requestId": "friend-request-1"},
        )

        _prepare_accepted_friendship(alice, bob)

        self.assertEqual(
            [
                call("acceptanceActorIdentity", {}, timeout=120),
                call("friendshipAuthority", {}, timeout=120),
                call(
                    "sendFriendRequest",
                    {
                        "actorPtid": "ptid:bob",
                        "federationId": "federation-1",
                        "homeStationPeerId": "station-four",
                    },
                    timeout=120,
                ),
            ],
            alice.harness.call_args_list,
        )
        self.assertEqual(
            [
                call("acceptanceActorIdentity", {}, timeout=120),
                call("friendshipAuthority", {}, timeout=120),
                call(
                    "acceptFriendRequest",
                    {"actorPtid": "ptid:alice"},
                    timeout=120,
                ),
            ],
            bob.harness.call_args_list,
        )
        self.assertEqual("agent", alice.harness_namespace)
        self.assertEqual("agent", bob.harness_namespace)

    def test_fixture_owner_prepares_recovery_prekeys_for_author_and_recipient(
        self,
    ) -> None:
        alice = MagicMock(name="alice")
        bob = MagicMock(name="bob")
        eve = MagicMock(name="eve")
        fixture_calls: list[tuple[object, str]] = []

        def fixture_harness(
            client: object,
            method: str,
            _payload: Mapping[str, object] | None = None,
            *,
            timeout: float = 120,
        ) -> Mapping[str, object]:
            del timeout
            fixture_calls.append((client, method))
            if method == "prepareAccountSwitch":
                return {
                    "primaryAccountId": "eve-account",
                    "secondaryAccountId": "alice-account",
                    "primaryActorPtid": "ptid:eve",
                    "secondaryActorPtid": "ptid:alice",
                    "primaryStorageIdentitySha256": "1" * 64,
                    "secondaryStorageIdentitySha256": "2" * 64,
                }
            if method == "prepareStationSwitch":
                return {
                    "primaryStationUrl": "http://127.0.0.1:4101",
                    "secondaryStationUrl": "http://127.0.0.1:4102",
                    "primaryStationPeerId": "station-four",
                    "secondaryStationPeerId": "station-five-arm",
                }
            if method == "preparePublisherDeviceRevocation":
                return {
                    "actorPtid": "ptid:alice",
                    "deviceId": "alice-device",
                    "observedProfileVersion": "1",
                }
            if method == "prepareHistoricalRecoveryEpoch":
                actor = "alice" if client is alice else "bob"
                return {
                    "actorPtid": f"ptid:{actor}",
                    "backupId": f"{actor}-backup",
                    "recoveryEpoch": 1,
                    "recoveryPreKeyAvailable": 100,
                }
            raise AssertionError(f"unexpected fixture method: {method}")

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_fixture_harness",
                side_effect=fixture_harness,
            ),
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
            ),
        ):
            owner = _build_fixture_owner(
                identity=IDENTITY,
                run_id="w7-recovery-precondition",
                secondary_station_url="http://127.0.0.1:4102",
                password="password",
                accounts={
                    "alice": "alice@testnet.local",
                    "bob": "bob@testnet.local",
                    "eve": "eve@testnet.local",
                },
                desktop={
                    "secure-content-desktop-alice": alice,
                    "secure-content-desktop-bob": bob,
                    "secure-content-desktop-eve": eve,
                },
            )

        recovery_clients = [
            client
            for client, method in fixture_calls
            if method == "prepareHistoricalRecoveryEpoch"
        ]
        self.assertEqual(2, len(recovery_clients))
        self.assertIs(alice, recovery_clients[0])
        self.assertIs(bob, recovery_clients[1])
        self.assertEqual(
            {"historical-recovery-epoch"},
            {
                handle["capability"]
                for handle in owner.manifest()["handles"]
                if handle["capability"] == "historical-recovery-epoch"
            },
        )

    def test_moments_readiness_retries_transient_native_identity_gap(
        self,
    ) -> None:
        snapshot = {
            "platform": "native",
            "nativeRuntimeIdentitySha256": "1" * 64,
        }
        client = MagicMock()
        client.harness_namespace = "agent"
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-alice"
        )
        client.harness.side_effect = (
            RuntimeError("moments.acceptance.nativeRuntimeIdentityMissing"),
            snapshot,
        )

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            result = _wait_for_moments_snapshot(client)

        self.assertEqual(snapshot, result)
        self.assertEqual("moments", client.harness_namespace)
        self.assertEqual(
            [
                call("snapshot", timeout=10),
                call("snapshot", timeout=10),
            ],
            client.harness.call_args_list,
        )

    def test_moments_readiness_timeout_is_typed(self) -> None:
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-bob"
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner.harness_ready",
                return_value=True,
            ),
            patch(
                "tooling.development.secure_content.runtime_owner.wait_until",
                side_effect=RuntimeError(
                    "moments.acceptance.nativeRuntimeIdentityMissing"
                ),
            ),
        ):
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _wait_for_moments_snapshot(client)

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertEqual(
            "client:secure-content-desktop-bob",
            raised.exception.resource,
        )

    def test_start_client_uses_shared_moments_readiness(self) -> None:
        snapshot = {
            "platform": "native",
            "nativeRuntimeIdentitySha256": "1" * 64,
        }
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-alice"
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
            ) as authenticate,
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_wait_for_moments_snapshot",
                return_value=snapshot,
            ) as wait_for_snapshot,
        ):
            result = _start_client(
                client,
                account="alice@p.t",
                password="1",
            )

        client.start.assert_called_once_with()
        client.configure_station.assert_called_once_with()
        authenticate.assert_called_once_with(
            client,
            account="alice@p.t",
            password="1",
        )
        wait_for_snapshot.assert_called_once_with(client)
        self.assertEqual(snapshot, result)

    def test_station_tunnels_use_reviewed_profile_bindings_and_close(self) -> None:
        primary = MagicMock(local_port=4101)
        primary.is_alive.return_value = False
        secondary = MagicMock(local_port=4102)
        secondary.is_alive.return_value = False
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
            side_effect=(primary, secondary),
        ) as open_tunnel:
            stack, endpoints = _open_station_tunnels(
                (
                    (
                        "station-four",
                        {
                            "PT_STATION_DEPLOY_ENV": "station-four",
                            "PT_STATION_PORT": "18080",
                        },
                    ),
                    (
                        "station-five-arm",
                        {
                            "PT_STATION_DEPLOY_ENV": "station-five-arm",
                            "PT_STATION_PORT": "18080",
                        },
                    ),
                )
            )
            stack.close()

        self.assertEqual(
            {
                "station-four": "http://127.0.0.1:4101",
                "station-five-arm": "http://127.0.0.1:4102",
            },
            endpoints,
        )
        self.assertEqual(
            [
                ("station-four", 18080),
                ("station-five-arm", 18080),
            ],
            [
                (
                    call.args[0],
                    call.kwargs["remote_port"],
                )
                for call in open_tunnel.call_args_list
            ],
        )
        primary.stop.assert_called_once_with()
        secondary.stop.assert_called_once_with()

    def test_station_tunnel_open_failure_preserves_primary_error(self) -> None:
        primary = MagicMock(local_port=4101)
        primary.stop.side_effect = RuntimeError("tunnel cleanup failed")
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
            side_effect=(
                primary,
                BlockedError(
                    "second tunnel failed",
                    resource="station-tunnel:station-five-arm",
                ),
            ),
        ):
            with self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "second tunnel failed",
            ) as raised:
                _open_station_tunnels(
                    (
                        (
                            "station-four",
                            {
                                "PT_STATION_DEPLOY_ENV": "station-four",
                                "PT_STATION_PORT": "18080",
                            },
                        ),
                        (
                            "station-five-arm",
                            {
                                "PT_STATION_DEPLOY_ENV": "station-five-arm",
                                "PT_STATION_PORT": "18080",
                            },
                        ),
                    )
                )

        self.assertEqual(1, len(raised.exception.secondary_cleanup_failures))
        self.assertIn(
            "RUNTIME_CLEANUP_FAILED",
            raised.exception.secondary_cleanup_failures[0],
        )
        self.assertIn(
            "tunnel cleanup failed",
            raised.exception.secondary_cleanup_failures[0],
        )
        self.assertIn(
            "secondary runtime cleanup failure: RUNTIME_CLEANUP_FAILED",
            raised.exception.payload()["message"],
        )

    def test_fixture_handler_rejects_an_unbound_runtime_manifest(self) -> None:
        handler = W7FixtureCapabilityHandler(
            W7FixtureBinding(
                capability="account-switch",
                opaque_id="fixture-account",
                expected_identity_digest="1" * 64,
                action=lambda *_: {
                    "completed": True,
                    "fixtureIdentityDigest": "1" * 64,
                },
            ),
            frozenset({"a" * 64}),
        )

        with self.assertRaisesRegex(Exception, "action binding is invalid"):
            handler.invoke(
                "round-trip",
                {
                    "actionPayload": {},
                    "expectedIdentityDigest": "1" * 64,
                    "handleId": "fixture-account",
                    "runtimeManifestDigest": "b" * 64,
                },
                deadline_monotonic=time.monotonic() + 1,
                cancellation=threading.Event(),
            )

    def test_scenario_journey_transition_uses_the_active_owner_session(self) -> None:
        session_id = "secure-content-w7-functional-20260918"
        declaration = {
            "state": "ACTIVE",
            "workItemId": "secure-content-w7",
            "planId": "SECURE-CONTENT-HARD-CUT-20260913",
            "taskId": "W7",
            "sessionId": session_id,
            "journeyId": "sc-dj-desktop-pilot",
        }
        responses = [
            {"declarations": [declaration]},
            {**declaration, "journeyId": BROWSER_JOURNEY},
            {**declaration, "journeyId": BROWSER_JOURNEY},
        ]
        commands: list[list[str]] = []

        def run(command: list[str], **_: object) -> SimpleNamespace:
            commands.append(command)
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(responses[len(commands) - 1]),
                stderr="",
            )

        activated = _activate_scenario_journey(
            Path("/tmp/peers-touch"),
            BROWSER_JOURNEY,
            command_runner=run,
        )

        self.assertEqual(BROWSER_JOURNEY, activated["journeyId"])
        self.assertIn(session_id, commands[1])
        self.assertEqual("update", commands[1][2])
        self.assertEqual("check", commands[2][2])

    def test_scenario_journey_transition_rejects_another_plan_task(self) -> None:
        declaration = {
            "state": "ACTIVE",
            "workItemId": "secure-content-w7",
            "planId": "SECURE-CONTENT-HARD-CUT-20260913",
            "taskId": "W7-RUNTIME-OWNER",
            "sessionId": "wrong-task",
            "journeyId": "sc-dj-desktop-pilot",
        }

        def run(_command: list[str], **_: object) -> SimpleNamespace:
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"declarations": [declaration]}),
                stderr="",
            )

        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "not the active Plan task",
        ):
            _activate_scenario_journey(
                Path("/tmp/peers-touch"),
                BROWSER_JOURNEY,
                command_runner=run,
            )

    def test_fixture_requires_exact_source_and_all_capabilities(self) -> None:
        fixture = fixture_payload()
        _validate_fixture(fixture, source_commit=COMMIT)

        fixture["source_checkpoint"] = "8" * 40
        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "not source-bound",
        ):
            _validate_fixture(fixture, source_commit=COMMIT)

    def test_fixture_copy_is_private_and_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            source.write_text(json.dumps(fixture_payload()), encoding="utf-8")
            target = root / "owner" / "fixture.json"

            payload, reference = _copy_immutable(source, target)

            self.assertEqual(payload, fixture_payload())
            self.assertEqual("fixture.json", reference["path"])
            self.assertEqual(0o600, target.stat().st_mode & 0o777)
            with self.assertRaises(FileExistsError):
                _copy_immutable(source, target)

    def test_continuation_evidence_is_staged_in_child_result_directory(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent_dir = root / "desktop" / "parent-run"
            parent_dir.mkdir(parents=True)
            blocked_result_path = parent_dir / "result.json"
            resume_path = parent_dir / "desktop-pilot-resume.json"
            request_path = (
                parent_dir
                / "restart-request-secure-content-desktop-bob.json"
            )
            blocked_result_path.write_text('{"result":"BLOCKED"}\n')
            resume_path.write_text('{"kind":"resume"}\n')
            request_path.write_text('{"kind":"request"}\n')
            acknowledgement = {
                "schema_version": 1,
                "kind": runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND,
            }

            child_dir = _stage_continuation_evidence(
                blocked_result_path=blocked_result_path,
                request_path=request_path,
                child_run_id="child-run",
                client_id="secure-content-desktop-bob",
                acknowledgement=acknowledgement,
            )

            self.assertEqual(root / "desktop" / "child-run", child_dir)
            for source in (blocked_result_path, resume_path, request_path):
                self.assertEqual(
                    source.read_bytes(),
                    (child_dir / source.name).read_bytes(),
                )
            self.assertEqual(
                acknowledgement,
                json.loads(
                    (
                        child_dir
                        / "restart-acknowledgement-secure-content-desktop-bob.json"
                    ).read_text(encoding="utf-8")
                ),
            )

    def test_fixture_owner_publishes_and_executes_bound_actions(self) -> None:
        calls: list[tuple[str, Mapping[str, object]]] = []

        def action(
            payload: Mapping[str, object],
            deadline_monotonic: float,
            cancellation: threading.Event,
        ) -> Mapping[str, object]:
            self.assertGreater(deadline_monotonic, time.monotonic())
            self.assertFalse(cancellation.is_set())
            calls.append(("called", payload))
            return {
                "completed": True,
                "fixtureIdentityDigest": "1" * 64,
            }

        owner = W7FixtureOwner(
            source_checkpoint=COMMIT,
            run_id="w7-fixture-owner-test",
            bindings=tuple(
                W7FixtureBinding(
                    capability=capability,
                    opaque_id=f"fixture-{index}",
                    expected_identity_digest=str(index + 1) * 64,
                    action=action,
                    secret_channel_ref=(
                        "w7-recovery-secret-channel"
                        if capability == "historical-recovery-epoch"
                        else None
                    ),
                )
                for index, capability in enumerate(
                    sorted(W7_FIXTURE_OPERATIONS)
                )
            ),
        )
        manifest = owner.manifest()
        _validate_fixture(manifest, source_commit=COMMIT)
        account_handle = next(
            handle
            for handle in manifest["handles"]
            if handle["capability"] == "account-switch"
        )

        context, client = owner.open_action_channel(
            workspace_id=IDENTITY["workspaceId"],
            gate_id="sc-dj-desktop-pilot",
            runtime_manifest_digests=("a" * 64,),
        )
        self.assertEqual({}, dict(owner.bindings))
        try:
            result = client.invoke(
                "account-switch",
                "round-trip",
                {
                    "actionPayload": {},
                    "expectedIdentityDigest": account_handle[
                        "expected_identity_digest"
                    ],
                    "handleId": account_handle["opaque_id"],
                    "runtimeManifestDigest": "a" * 64,
                },
                timeout_seconds=1,
            )
        finally:
            client.close()
            context.quiesce()
            cleanup = context.close()

        self.assertEqual([("called", {})], calls)
        self.assertTrue(result["outcome"]["completed"])
        self.assertTrue(cleanup.succeeded)

    def test_fixture_owner_rejects_action_identity_mismatch(self) -> None:
        def action(
            payload: Mapping[str, object],
            deadline_monotonic: float,
            cancellation: threading.Event,
        ) -> Mapping[str, object]:
            del payload, deadline_monotonic, cancellation
            return {
                "completed": True,
                "fixtureIdentityDigest": "f" * 64,
            }

        owner = W7FixtureOwner(
            source_checkpoint=COMMIT,
            run_id="w7-fixture-owner-mismatch",
            bindings=tuple(
                W7FixtureBinding(
                    capability=capability,
                    opaque_id=f"fixture-{index}",
                    expected_identity_digest=str(index + 1) * 64,
                    action=action,
                    secret_channel_ref=(
                        "w7-recovery-secret-channel"
                        if capability == "historical-recovery-epoch"
                        else None
                    ),
                )
                for index, capability in enumerate(
                    sorted(W7_FIXTURE_OPERATIONS)
                )
            ),
        )
        context, client = owner.open_action_channel(
            workspace_id=IDENTITY["workspaceId"],
            gate_id="sc-dj-desktop-pilot",
            runtime_manifest_digests=("a" * 64,),
        )
        try:
            with self.assertRaisesRegex(
                Exception,
                "fixture action identity does not match",
            ):
                client.invoke(
                    "account-switch",
                    "round-trip",
                    {
                        "actionPayload": {},
                        "expectedIdentityDigest": "1" * 64,
                        "handleId": "fixture-0",
                        "runtimeManifestDigest": "a" * 64,
                    },
                    timeout_seconds=1,
                )
        finally:
            client.close()
            context.quiesce()
            context.close()

    def test_client_cleanup_failure_is_typed_and_retained_for_retry(self) -> None:
        client = SimpleNamespace(
            spec=SimpleNamespace(profile="secure-content-desktop-alice"),
            stop=lambda: {
                "status": "failed",
                "failures": [
                    "renderer port remains open",
                    "logout: Authorization: Bearer secret-cleanup-token",
                ],
            },
        )
        active_client_ids = {id(client)}

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _stop_client_or_raise(
                client,
                purpose="Desktop",
                active_client_ids=active_client_ids,
            )

        self.assertEqual("RUNTIME_CLEANUP_FAILED", raised.exception.code)
        self.assertIn("Authorization: [REDACTED]", str(raised.exception))
        self.assertIn("renderer port remains open", str(raised.exception))
        self.assertNotIn("secret-cleanup-token", str(raised.exception))
        self.assertIn(id(client), active_client_ids)

    def test_runtime_cleanup_scope_preserves_primary_failure(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "secondary cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)
        with self.assertRaisesRegex(RunnerError, "primary product failure") as raised:
            with _runtime_cleanup_scope(stack):
                raise RunnerError("primary product failure")

        self.assertEqual(
            (
                "secondary runtime cleanup failure: RUNTIME_CLEANUP_FAILED: "
                "secondary cleanup failed",
            ),
            raised.exception.secondary_cleanup_failures,
        )
        self.assertEqual(
            (
                "primary product failure; secondary runtime cleanup failure: "
                "RUNTIME_CLEANUP_FAILED: secondary cleanup failed"
            ),
            _error_message_with_cleanup(raised.exception),
        )

    def test_runtime_cleanup_scope_reports_cleanup_failure_without_primary(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)
        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            with _runtime_cleanup_scope(stack):
                pass

        self.assertEqual("RUNTIME_CLEANUP_FAILED", raised.exception.code)

    def test_runtime_owner_blocked_payload_retains_secondary_cleanup(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            with _runtime_cleanup_scope(stack):
                raise RuntimeOwnerBlocked(
                    "PRIMARY_FAILURE",
                    "primary failure",
                    resource="runtime:secure-content-w7",
                )

        self.assertEqual(
            (
                "primary failure; secondary runtime cleanup failure: "
                "RUNTIME_CLEANUP_FAILED: cleanup failed"
            ),
            raised.exception.payload()["message"],
        )

    def test_manifest_payload_preserves_owner_bound_source(self) -> None:
        payload = _manifest_payload(
            identity=IDENTITY,
            journey_id=BROWSER_JOURNEY,
            run_id="w7-owner-run",
            services={"station-four": {"kind": "station"}},
            fixture_ref={"path": "fixture.json", "sha256": "1" * 64},
            fixture_digest="2" * 64,
            clients=[{"id": "browser"}],
        )

        self.assertNotIn("manifest_digest", payload)
        self.assertEqual(
            {
                "canonical_worktree": IDENTITY["root"],
                "workspace_id": IDENTITY["workspaceId"],
                "commit": COMMIT,
                "worktree_set_digest": IDENTITY["worktreeSetDigest"],
                "workspace_digest": "clean",
            },
            payload["source"],
        )
        self.assertEqual({"profile_id": "four", "slot": 5}, payload["controller_binding"])

    def test_continuation_manifest_has_fresh_run_identity_and_consumes_parent_artifact(
        self,
    ) -> None:
        parent_run_id = "w7-owner-run"
        child_run_id = _continuation_run_id(
            parent_run_id,
            "restart-request",
        )
        self.assertNotEqual(parent_run_id, child_run_id)
        self.assertEqual(
            child_run_id,
            _continuation_run_id(parent_run_id, "restart-request"),
        )

        with tempfile.TemporaryDirectory() as directory:
            artifact_dir = Path(directory)
            attestation = MagicMock()
            attestation.to_dict.return_value = {
                "artifactKind": runtime_manifest.SERVICE_ATTESTATION_KIND,
                "serviceId": "station-four",
            }
            child_services = _continuation_services(
                artifact_dir,
                run_id=child_run_id,
                journey_id="desktop-journey",
                services={
                    "station-four": {
                        "kind": "station",
                        "attestation_artifact_ref": {
                            "path": "attestations/station-four.json",
                            "sha256": "0" * 64,
                        },
                    },
                },
                attestations={"station-four": attestation},
            )
            child_attestation_ref = child_services["station-four"][
                "attestation_artifact_ref"
            ]
            child_attestation = json.loads(
                (artifact_dir / child_attestation_ref["path"]).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(child_run_id, child_attestation["runId"])
            self.assertEqual(
                "continuation-attestations/station-four.json",
                child_attestation_ref["path"],
            )

            parent = runtime_manifest.RuntimeManifestBinding(
                path=artifact_dir / "runtime-parent.json",
                sha256="a" * 64,
                run_id=parent_run_id,
                payload={"created_at": "2026-09-21T10:00:00.000Z"},
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset(),
                fixture_handles={},
                raw_bytes=b"parent",
            )
            context_args = {
                "repo_root": Path(__file__).resolve().parents[3],
                "source_commit": COMMIT,
                "session_id": "secure-content-w7",
                "declaration_id": "secure-content-w7-declaration",
                "runtime": "desktop",
                "profile": "four",
                "profiles": ("four",),
                "clients": (),
                "budget_seconds": 10,
                "started_monotonic": time.monotonic(),
                "artifact_dir": artifact_dir,
            }
            producer = ScenarioContext(
                scenario_id="desktop-parent",
                journey_id="desktop-journey",
                runtime_manifest=parent,
                **context_args,
            )
            artifact = producer.write_bound_artifact_json(
                "restart-request.json",
                "secure-content-runtime-restart-request",
                {"requestId": "restart-request"},
            )
            child = runtime_manifest.RuntimeManifestBinding(
                path=artifact_dir / "runtime-child.json",
                sha256="b" * 64,
                run_id=child_run_id,
                payload={
                    "created_at": "2099-09-21T10:00:00.000Z",
                    "continuation": {
                        "parent_manifest_digest": parent.sha256,
                    },
                },
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset(),
                fixture_handles={},
                raw_bytes=b"child",
            )
            consumer = ScenarioContext(
                scenario_id="desktop-child",
                journey_id="desktop-journey",
                runtime_manifest=child,
                **context_args,
            )

            consumed = consumer.consume_bound_artifact_json(
                artifact,
                kind="secure-content-runtime-restart-request",
                producer_scenario_id="desktop-parent",
                producer_journey_id="desktop-journey",
                producer_runtime="desktop",
            )

        self.assertEqual("restart-request", consumed["requestId"])

    def test_service_payload_preserves_both_attestation_references(self) -> None:
        service_attestation_ref = {
            "path": "attestations/station-four.json",
            "sha256": "1" * 64,
        }
        schema_attestation_ref = {
            "path": "schema-attestations/station-four/schema-attestation.json",
            "sha256": "2" * 64,
        }
        payload = _service_payload(
            SimpleNamespace(
                service_kind="station",
                deployment_environment="station-four",
                endpoint="http://127.0.0.1:49152",
                live_commit=COMMIT,
                protocol_digest="3" * 64,
                runtime_identity="runtime-four",
            ),
            service_attestation_ref,
            schema_attestation_ref,
            profile_id="four",
            schema_attestation_endpoint="https://station-four.invalid",
        )

        self.assertEqual(runtime_manifest.SERVICE_FIELDS, set(payload))
        self.assertEqual(
            "http://127.0.0.1:49152",
            payload["endpoint"],
        )
        self.assertEqual(
            "https://station-four.invalid",
            payload["schema_attestation_endpoint"],
        )
        self.assertEqual(
            service_attestation_ref,
            payload["attestation_artifact_ref"],
        )
        self.assertEqual(
            schema_attestation_ref,
            payload["canonical_private_schema_attestation_ref"],
        )

    def test_missing_schema_attestation_fails_closed_before_launch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _resolve_canonical_private_schema_attestation(
                    Path(directory),
                    Path(__file__).resolve().parents[3],
                    IDENTITY,
                    SimpleNamespace(
                        service_kind="station",
                        deployment_environment="station-four",
                        endpoint="https://station-four.invalid",
                        live_commit=COMMIT,
                        protocol_digest="3" * 64,
                        runtime_identity="runtime-four",
                    ),
                    service_id="station-four",
                    profile_id="four",
                    attested_endpoint="https://station-four.invalid",
                )

        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_resolves_and_copies_exact_source_schema_attestation(self) -> None:
        from tooling.development.secure_content.test_runtime_manifest import (
            manifest_payload,
            write_manifest,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            activation = (
                root
                / "W12A"
                / "activation"
                / "600e3d468dfa46ec0522c10b4d7ec0ddf7ccb929"
                / "four"
                / "reset-four"
            )
            path = write_manifest(activation, manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            service = payload["services"]["station-four"]
            schema_source = (
                activation
                / service["canonical_private_schema_attestation_ref"]["path"]
            )
            for filename in (
                runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
                runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME,
                runtime_manifest.RESET_MANIFEST_FILENAME,
            ):
                source = schema_source.parent / filename
                target = activation / filename
                shutil.copyfile(source, target)
                target.chmod(0o600)

            binding = _resolve_canonical_private_schema_attestation(
                root,
                Path(__file__).resolve().parents[3],
                {
                    **IDENTITY,
                    "head": payload["source"]["commit"],
                },
                SimpleNamespace(
                    service_kind=service["kind"],
                    deployment_environment=service[
                        "deployment_environment"
                    ],
                    endpoint="http://127.0.0.1:49152",
                    live_commit=service["live_commit"],
                    protocol_digest=service["protocol_digest"],
                    runtime_identity=service["runtime_identity"],
                ),
                service_id="station-four",
                profile_id="four",
                attested_endpoint=service["schema_attestation_endpoint"],
                live_verifier=lambda _binding: None,
            )
            published_root = root / "published"
            reference = _publish_canonical_private_schema_attestation(
                published_root,
                "station-four",
                binding,
            )

            self.assertEqual(
                (
                    "schema-attestations/station-four/"
                    "canonical-private-schema-attestation.json"
                ),
                reference["path"],
            )
            self.assertEqual(
                {
                    "canonical-private-schema-attestation.json",
                    "completed-reset-journal.json",
                    "reset-manifest.json",
                },
                {
                    item.name
                    for item in (
                        published_root
                        / "schema-attestations"
                        / "station-four"
                    ).iterdir()
                },
            )

    def test_final_cut_admission_rejects_activation_attestation(self) -> None:
        from tooling.development.secure_content.test_runtime_manifest import (
            manifest_payload,
            write_manifest,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            activation = (
                root
                / "W12A"
                / "activation"
                / "600e3d468dfa46ec0522c10b4d7ec0ddf7ccb929"
                / "four"
                / "reset-four"
            )
            path = write_manifest(activation, manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            service = payload["services"]["station-four"]
            schema_source = (
                activation
                / service["canonical_private_schema_attestation_ref"]["path"]
            )
            for filename in (
                runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
                runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME,
                runtime_manifest.RESET_MANIFEST_FILENAME,
            ):
                source = schema_source.parent / filename
                target = activation / filename
                shutil.copyfile(source, target)
                target.chmod(0o600)

            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _resolve_canonical_private_schema_attestation(
                    root,
                    Path(__file__).resolve().parents[3],
                    {
                        **IDENTITY,
                        "head": payload["source"]["commit"],
                    },
                    SimpleNamespace(
                        service_kind=service["kind"],
                        deployment_environment=service[
                            "deployment_environment"
                        ],
                        endpoint=service["endpoint"],
                        live_commit=service["live_commit"],
                        protocol_digest=service["protocol_digest"],
                        runtime_identity=service["runtime_identity"],
                    ),
                    service_id="station-four",
                    profile_id="four",
                    attested_endpoint=service[
                        "schema_attestation_endpoint"
                    ],
                    accepted_intents=("FINAL_CUT",),
                    live_verifier=lambda _binding: None,
                )

        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_live_schema_verifier_requires_exact_ssh_readback(self) -> None:
        payload = {
            "schema_version": 1,
            "deployment_environment": "station-four",
            "attestation_digest": "1" * 64,
        }
        binding = runtime_manifest.CanonicalPrivateSchemaAttestationBinding(
            path=Path("/tmp/canonical-private-schema-attestation.json"),
            payload=payload,
            raw_bytes=json.dumps(payload).encode("utf-8"),
        )
        command_runner = MagicMock(
            return_value=SimpleNamespace(
                returncode=0,
                stdout=json.dumps(payload) + "\n",
                stderr="",
            )
        )
        transport = MagicMock()
        transport.schema_verify_command.return_value = [
            "ssh",
            "station-four",
            "secure-content-maintenance",
            "--operation",
            "schema_verify",
        ]
        _verify_live_canonical_private_schema_attestation(
            binding,
            repo_root=Path(__file__).resolve().parents[3],
            transport=transport,
            command_runner=command_runner,
        )
        transport.schema_verify_command.assert_called_once_with(
            payload,
            budget_seconds=120,
        )
        self.assertEqual(
            payload,
            json.loads(command_runner.call_args.kwargs["input"]),
        )

        command_runner.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps({**payload, "attestation_digest": "2" * 64})
            + "\n",
            stderr="",
        )
        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _verify_live_canonical_private_schema_attestation(
                binding,
                repo_root=Path(__file__).resolve().parents[3],
                transport=transport,
                command_runner=command_runner,
            )
        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_client_payload_uses_live_snapshot_and_storage_inode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "storage"
            storage.mkdir()
            client = SimpleNamespace(
                spec=SimpleNamespace(
                    runtime="native-tauri",
                    storage_root=storage,
                )
            )
            snapshot = {
                "actorPtidSha256": "3" * 64,
                "bootIdentitySha256": "4" * 64,
                "sessionGeneration": 2,
            }

            payload = _client_payload("desktop-alice", "alice", client, snapshot)

            self.assertEqual(_storage_identity(storage), payload["storage_identity_digest"])
            self.assertEqual(snapshot["bootIdentitySha256"], payload["boot_identity"])
            self.assertEqual(2, payload["session_generation"])

    def test_restart_lease_is_held_exclusively(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with _restart_lease(
                root,
                request_id="restart-request",
                client_id="desktop-bob",
            ) as first:
                self.assertIn("restart-request", first[0])
                with self.assertRaisesRegex(
                    RuntimeOwnerBlocked,
                    "lease is unavailable",
                ):
                    with _restart_lease(
                        root,
                        request_id="competing-request",
                        client_id="desktop-bob",
                    ):
                        pass


if __name__ == "__main__":
    unittest.main()
