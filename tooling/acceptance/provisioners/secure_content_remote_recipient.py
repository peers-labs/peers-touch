"""Actor Identity-owned W8 remote-recipient fixture provisioning."""

from __future__ import annotations

import hashlib
import os
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from tooling.acceptance.core.errors import EphemeralCapabilityBlocked
from tooling.acceptance.core.launch_context import (
    EphemeralCapabilityHandler,
    EphemeralGateClient,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)
from tooling.acceptance.fixtures.secure_content_w7 import canonical_digest


REMOTE_RECIPIENT_CAPABILITY = "remote-private-recipient"
REMOTE_RECIPIENT_OPERATION = "resolve"
REMOTE_RECIPIENT_OWNER = "actor-identity-provisioner"
REMOTE_RECIPIENT_PROFILE = "fiveArm"
REMOTE_RECIPIENT_SERVICE = "station-five-arm"
FIXTURE_MANIFEST_KIND = "secure-content-fixture-manifest"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _required_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"W8 remote recipient {field} is missing")
    return value.strip()


class RemoteRecipientCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        *,
        opaque_id: str,
        identity_projection: Mapping[str, object],
        expected_identity_digest: str,
        runtime_manifest_digests: frozenset[str],
    ) -> None:
        if (
            not runtime_manifest_digests
            or any(
                len(digest) != 64
                or any(
                    character not in "0123456789abcdef"
                    for character in digest
                )
                for digest in runtime_manifest_digests
            )
        ):
            raise ValueError("W8 remote recipient manifest binding is invalid")
        if canonical_digest(identity_projection) != expected_identity_digest:
            raise ValueError("W8 remote recipient identity digest is invalid")
        self._opaque_id = opaque_id
        self._identity_projection: dict[str, object] | None = dict(
            identity_projection
        )
        self._expected_identity_digest = expected_identity_digest
        self._runtime_manifest_digests = runtime_manifest_digests
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (REMOTE_RECIPIENT_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if (
            self._closed
            or self._identity_projection is None
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W8 remote recipient owner is unavailable",
                resource=f"fixture:{REMOTE_RECIPIENT_CAPABILITY}",
            )
        if (
            operation != REMOTE_RECIPIENT_OPERATION
            or set(payload)
            != {
                "actionPayload",
                "expectedIdentityDigest",
                "handleId",
                "runtimeManifestDigest",
            }
            or payload.get("handleId") != self._opaque_id
            or payload.get("expectedIdentityDigest")
            != self._expected_identity_digest
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W8 remote recipient handle does not match",
                resource=f"fixture:{REMOTE_RECIPIENT_CAPABILITY}",
            )
        runtime_manifest_digest = payload.get("runtimeManifestDigest")
        action_payload = payload.get("actionPayload")
        if (
            not isinstance(runtime_manifest_digest, str)
            or runtime_manifest_digest not in self._runtime_manifest_digests
            or not isinstance(action_payload, Mapping)
            or action_payload
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W8 remote recipient action binding is invalid",
                resource=f"fixture:{REMOTE_RECIPIENT_CAPABILITY}",
            )
        outcome = {
            **self._identity_projection,
            "fixtureIdentityDigest": self._expected_identity_digest,
        }
        acknowledgement: dict[str, object] = {
            "schemaVersion": 1,
            "capability": REMOTE_RECIPIENT_CAPABILITY,
            "operation": operation,
            "handleId": self._opaque_id,
            "expectedIdentityDigest": self._expected_identity_digest,
            "runtimeManifestDigest": runtime_manifest_digest,
            "outcome": outcome,
        }
        acknowledgement["acknowledgementDigest"] = canonical_digest(
            acknowledgement
        )
        return acknowledgement

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        projected = dict(response)
        if projected.get("status") != "OK":
            return projected
        result = projected.get("result")
        if (
            operation != REMOTE_RECIPIENT_OPERATION
            or not isinstance(result, Mapping)
            or set(result)
            != {
                "schemaVersion",
                "capability",
                "operation",
                "handleId",
                "expectedIdentityDigest",
                "runtimeManifestDigest",
                "outcome",
                "acknowledgementDigest",
            }
        ):
            raise ValueError(
                "W8 remote recipient acknowledgement has an invalid shape"
            )
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        self._identity_projection = None
        self._runtime_manifest_digests = frozenset()
        self._closed = True
        return time.monotonic() < deadline_monotonic

    def close(self) -> EphemeralHandlerCleanup:
        self._identity_projection = None
        self._runtime_manifest_digests = frozenset()
        self._closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class W8RemoteRecipientFixtureOwner:
    def __init__(
        self,
        *,
        source_checkpoint: str,
        run_id: str,
        actor_ptid: str,
        home_station_peer_id: str,
        federation_id: str,
    ) -> None:
        self.source_checkpoint = source_checkpoint
        self.run_id = run_id
        self._identity_projection: dict[str, object] | None = {
            "actorPtid": actor_ptid,
            "homeStationPeerIdSha256": _sha256(home_station_peer_id),
            "federationId": federation_id,
            "federationIdSha256": _sha256(federation_id),
            "profileId": REMOTE_RECIPIENT_PROFILE,
            "serviceId": REMOTE_RECIPIENT_SERVICE,
        }
        self.expected_identity_digest = canonical_digest(
            self._identity_projection
        )
        self.opaque_id = self._opaque_id()

    def _opaque_id(self) -> str:
        return (
            f"w8-{REMOTE_RECIPIENT_CAPABILITY}-"
            f"{_sha256(f'{self.run_id}:{self.expected_identity_digest}')[:20]}"
        )

    def bind_remote_group(
        self,
        prepare: Callable[[str, str], str],
    ) -> str:
        projection = self._identity_projection
        if projection is None:
            raise ValueError("W8 remote recipient fixture is already consumed")
        if "remoteGroupUlid" in projection:
            raise ValueError("W8 remote recipient Group is already bound")
        actor_ptid = _required_text(projection.get("actorPtid"), "Actor PTID")
        federation_id = _required_text(
            projection.get("federationId"),
            "Federation ID",
        )
        remote_group_ulid = _required_text(
            prepare(actor_ptid, federation_id),
            "remote Group ULID",
        )
        projection["remoteGroupUlid"] = remote_group_ulid
        self.expected_identity_digest = canonical_digest(projection)
        self.opaque_id = self._opaque_id()
        return remote_group_ulid

    def manifest(self) -> dict[str, object]:
        if self._identity_projection is None:
            raise ValueError("W8 remote recipient fixture is already consumed")
        if "remoteGroupUlid" not in self._identity_projection:
            raise ValueError("W8 remote recipient Group is not bound")
        payload: dict[str, object] = {
            "schema_version": 1,
            "kind": FIXTURE_MANIFEST_KIND,
            "fixture_set_id": "secure-content-w8-audience",
            "source_checkpoint": self.source_checkpoint,
            "handles": [
                {
                    "kind": f"{REMOTE_RECIPIENT_CAPABILITY}-fixture",
                    "opaque_id": self.opaque_id,
                    "owner": REMOTE_RECIPIENT_OWNER,
                    "capability": REMOTE_RECIPIENT_CAPABILITY,
                    "expected_identity_digest": self.expected_identity_digest,
                }
            ],
        }
        payload["manifest_digest"] = canonical_digest(payload)
        return payload

    def open_action_channel(
        self,
        *,
        workspace_id: str,
        gate_id: str,
        runtime_manifest_digests: Sequence[str],
    ) -> tuple[EphemeralGateLaunchContext, EphemeralGateClient]:
        projection = self._identity_projection
        if projection is None:
            raise ValueError("W8 remote recipient action channel is consumed")
        if "remoteGroupUlid" not in projection:
            raise ValueError("W8 remote recipient Group is not bound")
        context = EphemeralGateLaunchContext(
            required_capabilities=(REMOTE_RECIPIENT_CAPABILITY,),
            request_timeout_seconds=120.0,
            quiesce_timeout_seconds=30.0,
        )
        context.register_capability(
            REMOTE_RECIPIENT_CAPABILITY,
            RemoteRecipientCapabilityHandler(
                opaque_id=self.opaque_id,
                identity_projection=projection,
                expected_identity_digest=self.expected_identity_digest,
                runtime_manifest_digests=frozenset(runtime_manifest_digests),
            ),
        )
        context.seal(
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        binding = context.bind_child()
        child_descriptor = os.dup(binding.pass_fds[0])
        context.activate()
        binding.close_parent_copy()
        client = EphemeralGateClient(
            child_descriptor,
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        self._identity_projection = None
        return context, client


class RemotePrivateRecipientProvisioner:
    """Bind one fiveArm Actor without exposing its PTID upstream."""

    def __init__(
        self,
        *,
        source_checkpoint: str,
        run_id: str,
        station_url: str,
        password: str,
        account_registrar: Callable[..., str],
        existing_account: str | None = None,
    ) -> None:
        self._source_checkpoint = source_checkpoint
        self._run_id = run_id
        self._account = existing_account or account_registrar(
            station_url,
            role="remote_recipient",
            suffix=_sha256(
                f"{run_id}:{REMOTE_RECIPIENT_CAPABILITY}"
            )[:10],
            password=password,
        )
        self._bound = False

    @property
    def account(self) -> str:
        return self._account

    def bind_identity(
        self,
        *,
        primary_client: Any,
        remote_client: Any,
        identity_reader: Callable[[Any, str], Mapping[str, Any]],
        authority_reader: Callable[[Any, str], Mapping[str, Any]],
        federation_action: Callable[
            [Any, str, Mapping[str, object]],
            Mapping[str, Any],
        ],
    ) -> W8RemoteRecipientFixtureOwner:
        if self._bound:
            raise ValueError("W8 remote recipient identity is already bound")
        actor = identity_reader(remote_client, "federatedActorIdentity")
        primary_authority = authority_reader(
            primary_client,
            "federationJoinAuthority",
        )
        actor_ptid = _required_text(actor.get("actorPtid"), "Actor PTID")
        federated_handle = _required_text(
            actor.get("federatedHandle"),
            "federated handle",
        )
        primary_home_station = _required_text(
            primary_authority.get("homeStationPeerId"),
            "primary Home Station",
        )
        federation_id = _required_text(
            primary_authority.get("federationId"),
            "primary Federation",
        )
        federation_endpoint = _required_text(
            primary_authority.get("federationEndpoint"),
            "primary Federation endpoint",
        )
        remote_home_station = _required_text(
            actor.get("homeStationPeerId"),
            "fiveArm Home Station",
        )
        if remote_home_station == primary_home_station:
            raise ValueError(
                "W8 remote recipient resolved to the primary Home Station"
            )

        membership_payload = {"federationId": federation_id}
        primary_members = federation_action(
            primary_client,
            "federationMemberStations",
            membership_payload,
        )
        primary_member_ids = primary_members.get("stationPeerIds")
        if (
            not isinstance(primary_member_ids, Sequence)
            or isinstance(primary_member_ids, (str, bytes))
            or primary_home_station not in primary_member_ids
        ):
            raise ValueError(
                "W8 primary Federation membership is incomplete"
            )
        if remote_home_station not in primary_member_ids:
            joined = federation_action(
                remote_client,
                "joinAcceptanceFederation",
                {
                    "federationEndpoint": federation_endpoint,
                    "federationId": federation_id,
                },
            )
            if (
                joined.get("federationId") != federation_id
                or joined.get("status") != "active"
            ):
                raise ValueError(
                    "W8 fiveArm Station did not join the primary Federation"
                )

        expected_member_ids = {
            primary_home_station,
            remote_home_station,
        }
        for client, label in (
            (primary_client, "primary"),
            (remote_client, "fiveArm"),
        ):
            membership = federation_action(
                client,
                "federationMemberStations",
                membership_payload,
            )
            station_peer_ids = membership.get("stationPeerIds")
            if (
                not isinstance(station_peer_ids, Sequence)
                or isinstance(station_peer_ids, (str, bytes))
                or not expected_member_ids.issubset(station_peer_ids)
            ):
                raise ValueError(
                    f"W8 {label} shared Federation projection is incomplete"
                )

        resolved = federation_action(
            primary_client,
            "resolveFederatedActorIdentity",
            {
                "federatedHandle": federated_handle,
                "federationId": federation_id,
            },
        )
        if (
            _required_text(resolved.get("actorPtid"), "resolved Actor PTID")
            != actor_ptid
            or _required_text(
                resolved.get("federatedHandle"),
                "resolved federated handle",
            )
            != federated_handle
            or _required_text(
                resolved.get("homeStationPeerId"),
                "resolved Home Station",
            )
            != remote_home_station
        ):
            raise ValueError(
                "W8 remote recipient resolution does not match "
                "the fiveArm Actor identity"
            )
        owner = W8RemoteRecipientFixtureOwner(
            source_checkpoint=self._source_checkpoint,
            run_id=self._run_id,
            actor_ptid=actor_ptid,
            home_station_peer_id=remote_home_station,
            federation_id=federation_id,
        )
        self._bound = True
        self._account = ""
        return owner
