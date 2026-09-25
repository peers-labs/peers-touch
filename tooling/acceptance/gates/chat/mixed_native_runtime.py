from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    ActorRuntime,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    call_async_harness,
    load_runtime_manifest,
    require_runtime_client_service,
)
from tooling.acceptance.drivers.native.runtime import (
    LocalMacOSRuntimeBinding,
    NativeLaunchOptions,
)
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    commits_match,
    is_native_tauri_url,
    read_station_version,
    verify_runtime_fixture_ready,
    wait_for_peer_key_bundle,
)
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorRuntimeBinding,
)


ENVIRONMENT_ID = "chat-mixed-native"
STATION_ACCESS_ENVIRONMENT_ID = "station-access-native"
STATION_ACCESS_GATE_IDS = frozenset(
    {
        "station-access-auth-e2e",
        "station-access-scope-isolation-e2e",
    }
)
DESKTOP_RUNTIME = "native-tauri"
MOBILE_RUNTIME = "tauri-ios-simulator"
POLL_INTERVAL_SECONDS = 0.25
MOBILE_WRITE_REVOKED_ERROR_KEY = "mobile.recovery.writeRevocation.body"
MOBILE_WRITE_ADMISSION_STABLE_SECONDS = 1.25
MOBILE_WRITE_ACTIONS = frozenset({
    "messaging.createDirect",
    "messaging.createGroup",
    "messaging.send",
    "messaging.interact",
    "messaging.read",
    "messaging.typing",
})


# #region debug-point A-D:mobile-admission-state
def _report_mobile_admission_debug(
    hypothesis_id: str,
    location: str,
    data: Mapping[str, Any],
) -> None:
    env_path = REPO_ROOT / ".dbg" / "mobile-admission-stuck.env"
    if not env_path.exists():
        return
    config = dict(
        line.split("=", 1)
        for line in env_path.read_text(encoding="utf-8").splitlines()
        if "=" in line
    )
    payload = json.dumps({
        "sessionId": config.get("DEBUG_SESSION_ID", "mobile-admission-stuck"),
        "runId": config.get("DEBUG_RUN_ID", "pre-fix"),
        "hypothesisId": hypothesis_id,
        "location": location,
        "msg": "[DEBUG] Mobile lifecycle admission state",
        "data": data,
        "ts": int(time.time() * 1000),
    }).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                config.get("DEBUG_SERVER_URL", "http://127.0.0.1:7777/event"),
                data=payload,
                headers={"Content-Type": "application/json"},
            ),
            timeout=2,
        ).read()
    except Exception:
        pass
# #endregion


@dataclass(frozen=True)
class MixedClientIdentity:
    client_id: str
    actor: str
    runtime: str
    station_service_id: str
    station_peer_id: str
    ptid: str
    account_ref: str
    federation_id: str
    device_id: str


def load_mixed_runtime_manifest(
    gate_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not raw_path:
        raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    manifest = load_runtime_manifest(Path(raw_path), gate_id)
    environment_id = (
        STATION_ACCESS_ENVIRONMENT_ID
        if gate_id in STATION_ACCESS_GATE_IDS
        else ENVIRONMENT_ID
    )
    if manifest.get("environmentId") != environment_id:
        raise GateError(
            f"Mixed native Gate requires the {environment_id} environment"
        )
    actor_ref = manifest.get("actorManifest")
    if not isinstance(actor_ref, dict):
        raise GateError("Mixed Chat runtime actorManifest is required")
    actor_manifest = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    ).read_json(ArtifactRef.from_dict(actor_ref))
    actor_manifest_kind = (
        "station-access-native-actor-manifest"
        if gate_id in STATION_ACCESS_GATE_IDS
        else "chat-mixed-native-actor-manifest"
    )
    if actor_manifest.get("artifactKind") != actor_manifest_kind:
        raise GateError("Mixed Chat actor manifest has an invalid artifact kind")
    if gate_id in STATION_ACCESS_GATE_IDS:
        reset = actor_manifest.get("reset")
        stations = actor_manifest.get("stations")
        if (
            manifest.get("state") != "FIXTURE_READY"
            or not isinstance(reset, Mapping)
            or reset.get("authorized") is not False
            or reset.get("targetVerified") is not False
            or not isinstance(stations, Mapping)
            or not stations
            or any(
                not isinstance(station, Mapping)
                or station.get("existingActorsVerified") is not True
                for station in stations.values()
            )
        ):
            raise GateError(
                "Station Access existing-actor fixture is not verified"
            )
    else:
        verify_runtime_fixture_ready(manifest, actor_manifest)
    return manifest, actor_manifest


class MixedNativeRuntime:
    def __init__(
        self,
        *,
        gate_id: str,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        desktop_binding: LocalMacOSRuntimeBinding | None = None,
        mobile_binding: MobileSimulatorRuntimeBinding | None = None,
    ) -> None:
        expected_environment = (
            STATION_ACCESS_ENVIRONMENT_ID
            if gate_id in STATION_ACCESS_GATE_IDS
            else ENVIRONMENT_ID
        )
        if manifest.get("environmentId") != expected_environment:
            raise GateError("Mixed runtime manifest has the wrong environment")
        self.gate_id = gate_id
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.desktop_binding = desktop_binding or LocalMacOSRuntimeBinding()
        self.desktop_binding.set_runtime_manifest(manifest)
        self.mobile_binding = mobile_binding or (
            MobileSimulatorRuntimeBinding.from_environment(gate_id=gate_id)
        )
        self.client_specs = {
            str(client.get("id")): dict(client)
            for client in manifest.get("clients", [])
            if isinstance(client, Mapping)
        }
        self.desktop_sessions: dict[str, TauriSession] = {}
        self.desktop_instances: list[TauriSession] = []
        self.desktop_lifecycles = NativeClientLifecycleLedger()
        self.mobile_clients: list[str] = []
        self.identities: dict[str, MixedClientIdentity] = {}
        self.access_evidence: dict[str, dict[str, Any]] = {}

    @classmethod
    def from_environment(cls, gate_id: str) -> "MixedNativeRuntime":
        manifest, actor_manifest = load_mixed_runtime_manifest(gate_id)
        return cls(
            gate_id=gate_id,
            manifest=manifest,
            actor_manifest=actor_manifest,
        )

    def start_client(
        self,
        client_id: str,
        *,
        window_slot: int,
        window_count: int,
    ) -> MixedClientIdentity:
        spec = self._client_spec(client_id)
        runtime = str(spec.get("runtime") or "")
        expected = self._actor_for_client(client_id)
        if runtime == DESKTOP_RUNTIME:
            identity = self._start_desktop(
                client_id,
                expected,
                window_slot=window_slot,
                window_count=window_count,
            )
        elif runtime == MOBILE_RUNTIME:
            identity = self._start_mobile(client_id, expected)
        else:
            raise GateError(
                f"Mixed client {client_id!r} has unsupported runtime {runtime!r}"
            )
        self.identities[client_id] = identity
        return identity

    def _desktop_identity_action(
        self,
        session: TauriSession,
        action: str,
        payload: Mapping[str, Any] | None = None,
        *,
        timeout: float = 45.0,
    ) -> Any:
        if self.gate_id in STATION_ACCESS_GATE_IDS:
            return call_async_harness(
                session,
                action,
                dict(payload or {}),
                namespace="stationAccess",
                script_timeout=timeout,
            )
        return async_harness(
            session,
            action,
            dict(payload or {}),
            timeout=timeout,
        )

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
        *,
        timeout: float = 45.0,
    ) -> Any:
        spec = self._client_spec(client_id)
        if spec.get("runtime") == DESKTOP_RUNTIME:
            session = self.desktop_sessions.get(client_id)
            if session is None:
                raise GateError(f"Desktop client {client_id!r} is not active")
            value = async_harness(
                session,
                action,
                dict(payload or {}),
                timeout=timeout,
            )
        elif spec.get("runtime") == MOBILE_RUNTIME:
            if client_id not in self.mobile_clients:
                raise GateError(f"Mobile client {client_id!r} is not active")
            action_payload = dict(payload or {})
            if action in MOBILE_WRITE_ACTIONS:
                self._wait_for_mobile_write_admission(
                    client_id,
                    timeout_seconds=timeout,
                )
            try:
                value = self.mobile_binding.call_action(
                    client_id,
                    action,
                    action_payload,
                )
            except GateError as error:
                if (
                    action not in MOBILE_WRITE_ACTIONS
                    or MOBILE_WRITE_REVOKED_ERROR_KEY not in str(error)
                ):
                    raise
                self._wait_for_mobile_write_admission(
                    client_id,
                    timeout_seconds=timeout,
                    force_reconcile=True,
                )
                value = self.mobile_binding.call_action(
                    client_id,
                    action,
                    action_payload,
                )
        else:
            raise GateError(f"Mixed client {client_id!r} has no action adapter")
        return self._project_client_result(value)

    def _wait_for_mobile_write_admission(
        self,
        client_id: str,
        *,
        timeout_seconds: float,
        force_reconcile: bool = False,
    ) -> Mapping[str, Any]:
        initial = self._mapping(
            self.mobile_binding.call_action(
                client_id,
                "recovery.snapshot",
                {},
            ),
            f"{client_id} recovery snapshot",
        )
        # #region debug-point B-D:admission-wait-entry
        if (
            (REPO_ROOT / ".dbg" / "mobile-admission-stuck.env").exists()
            and type(self.mobile_binding).__module__ != "unittest.mock"
        ):
            _report_mobile_admission_debug(
                "B,C,D",
                "mixed_native_runtime.py:_wait_for_mobile_write_admission:entry",
                {
                    "clientId": client_id,
                    "recovery": initial,
                },
            )
        # #endregion
        if self._mobile_write_admission_open(initial) and not force_reconcile:
            return initial

        reconcile_result = self.mobile_binding.call_action(
            client_id,
            "social.reconcile",
            {},
        )
        # #region debug-point B-D:forced-reconcile
        if (
            (REPO_ROOT / ".dbg" / "mobile-admission-stuck.env").exists()
            and type(self.mobile_binding).__module__ != "unittest.mock"
        ):
            try:
                _report_mobile_admission_debug(
                    "B,C,D",
                    "mixed_native_runtime.py:_wait_for_mobile_write_admission:reconciled",
                    {
                        "clientId": client_id,
                        "social": reconcile_result,
                        "recovery": self.call_action(client_id, "recovery.snapshot", {}),
                    },
                )
            except Exception as error:
                _report_mobile_admission_debug(
                    "B,C,D",
                    "mixed_native_runtime.py:_wait_for_mobile_write_admission:reconcile-error",
                    {"clientId": client_id, "instrumentationError": str(error)},
                )
        # #endregion

        stable_since: float | None = None

        def settled_admission() -> Mapping[str, Any] | None:
            nonlocal stable_since
            snapshot = self.mobile_binding.call_action(
                client_id,
                "recovery.snapshot",
                {},
            )
            if not isinstance(snapshot, Mapping):
                stable_since = None
                return None
            if not self._mobile_write_admission_open(snapshot):
                stable_since = None
                return None
            now = time.monotonic()
            if stable_since is None:
                stable_since = now
            if now - stable_since < MOBILE_WRITE_ADMISSION_STABLE_SECONDS:
                return None
            return snapshot

        return self.wait_until(
            settled_admission,
            (
                f"{client_id} Mobile write admission to reopen after "
                f"{compact_json(initial)}"
            ),
            timeout_seconds=timeout_seconds,
        )

    @staticmethod
    def _mobile_write_admission_open(snapshot: Mapping[str, Any]) -> bool:
        write_admission = snapshot.get("writeAdmission")
        states = snapshot.get("states")
        has_pending_reconcile = (
            isinstance(states, list)
            and any(
                isinstance(state, Mapping)
                and state.get("kind") == "event-overflow-reconcile"
                for state in states
            )
        )
        return (
            snapshot.get("isWriteBlocked") is False
            and isinstance(write_admission, Mapping)
            and write_admission.get("open") is True
            and not has_pending_reconcile
        )

    def actor_runtime(self, client_id: str) -> ActorRuntime:
        spec = self._client_spec(client_id)
        if spec.get("runtime") == DESKTOP_RUNTIME:
            session = self.desktop_sessions[client_id]
            return ActorRuntime(
                name=client_id,
                runtime="desktop-macos-native",
                port=session.port,
                gateway_port=session.gateway_port,
                profile=session.profile,
                storage_root=session.storage_root,
                pid=session.process_id,
            )
        return ActorRuntime(
            name=client_id,
            runtime=MOBILE_RUNTIME,
            profile=str(spec.get("profile") or client_id),
            storage_root=str(spec.get("storage_root") or ""),
        )

    def desktop_session(self, client_id: str) -> TauriSession | None:
        return self.desktop_sessions.get(client_id)

    def source_identity(self) -> dict[str, Any]:
        source = self.manifest.get("source")
        if not isinstance(source, Mapping):
            raise GateError("Mixed runtime source identity is missing")
        source_commit = str(source.get("commit") or "")
        if not source_commit or source.get("workspaceDigest") != "clean":
            raise GateError("Mixed runtime source must be a clean commit")
        services = self.manifest.get("services")
        if not isinstance(services, Mapping) or not services:
            raise GateError("Mixed runtime service attestations are missing")
        station_live: dict[str, Any] = {}
        for service_id, service in services.items():
            if not isinstance(service, Mapping):
                raise GateError(
                    f"Mixed runtime service {service_id!r} is invalid"
                )
            endpoint = str(service.get("endpoint") or "")
            live = read_station_version(endpoint)
            if (
                service.get("kind") != "station"
                or service.get("workspaceDigest") != "clean"
                or not commits_match(
                    str(service.get("liveCommit") or ""),
                    source_commit,
                )
                or not commits_match(
                    str(live.get("build_commit") or ""),
                    source_commit,
                )
            ):
                raise GateError(
                    f"Mixed runtime Station {service_id!r} source mismatch"
                )
            station_live[str(service_id)] = live
        binary = self.desktop_binding.binary_identity()
        runtime_cell = self.desktop_binding.runtime_identity()
        if (
            binary.get("sourceCommit") != source_commit
            or runtime_cell.get("gateId") != self.gate_id
            or runtime_cell.get("cellId") != "desktop-macos-native"
        ):
            raise GateError("Mixed runtime Desktop binary identity mismatch")
        return {
            "orchestrator": dict(source),
            "stations": {
                str(key): dict(value)
                for key, value in services.items()
                if isinstance(value, Mapping)
            },
            "stationLive": station_live,
            "desktopRuntimeCell": runtime_cell,
            "desktopBinary": binary,
            "mobileRuntimeCell": "ios-simulator",
        }

    def reconnect_client(
        self,
        client_id: str,
        *,
        timeout_seconds: float = 60.0,
    ) -> None:
        spec = self._client_spec(client_id)
        if spec.get("runtime") == DESKTOP_RUNTIME:
            self.call_action(client_id, "disconnectRealtime", {}, timeout=15)
            self.call_action(client_id, "reconnectRealtime", {}, timeout=30)
            return
        self.call_action(client_id, "lifecycle.suspend", {})
        self.call_action(client_id, "lifecycle.resume", {})
        self._wait_for_mobile_active_identity(
            client_id,
            operation="reconnect",
            timeout_seconds=timeout_seconds,
        )

    def restart_client(
        self,
        client_id: str,
        *,
        timeout_seconds: float = 60.0,
    ) -> None:
        spec = self._client_spec(client_id)
        if spec.get("runtime") == DESKTOP_RUNTIME:
            self.call_action(client_id, "disconnectRealtime", {}, timeout=15)
            self.call_action(client_id, "reconnectRealtime", {}, timeout=30)
            return
        response = self.call_action(client_id, "lifecycle.restart", {})
        if response != {"requested": True, "scope": "webview"}:
            raise GateError(
                f"Mobile client {client_id!r} restart was not acknowledged"
            )
        self._wait_for_mobile_active_identity(
            client_id,
            operation="restart",
            timeout_seconds=timeout_seconds,
        )

    def restart_desktop_session(
        self,
        client_id: str,
        *,
        window_slot: int,
        window_count: int,
        timeout_seconds: float = 60.0,
    ) -> dict[str, Any]:
        spec = self._client_spec(client_id)
        if spec.get("runtime") != DESKTOP_RUNTIME:
            raise GateError(
                f"Mixed client {client_id!r} is not a Desktop runtime"
            )
        predecessor = self.desktop_sessions.get(client_id)
        identity = self.identities.get(client_id)
        if predecessor is None or identity is None:
            raise GateError(
                f"Desktop client {client_id!r} is not active"
            )

        self.desktop_lifecycles.stop_preserving_session(predecessor)
        successor = self.desktop_binding.create_bound_session(
            client_id,
            NativeLaunchOptions(
                window_slot=window_slot,
                window_count=window_count,
            ),
        )
        self.desktop_instances.append(successor)
        self.desktop_lifecycles.register(successor, identity.ptid)
        self.desktop_lifecycles.transfer_preserved_session(
            predecessor,
            successor,
        )
        self.desktop_lifecycles.mark_live(successor)
        self.desktop_sessions[client_id] = successor

        state = self.wait_until(
            lambda: (
                candidate
                if (
                    isinstance(
                        candidate := self._desktop_identity_action(
                            successor,
                            "identityState",
                            {},
                            timeout=10,
                        ),
                        Mapping,
                    )
                    and candidate.get("authenticated") is True
                    and candidate.get("actorPtid") == identity.ptid
                )
                else None
            ),
            f"{client_id} restored Desktop identity",
            timeout_seconds=timeout_seconds,
        )
        self.desktop_lifecycles.mark_authenticated(successor)
        restored = self._identity_with_device(
            client_id,
            self._actor_for_client(client_id),
            runtime="desktop-macos-native",
        )
        if restored != identity:
            raise GateError(
                f"Desktop client {client_id!r} scope changed across restart"
            )
        return {
            "identity": dict(state),
            "stationPeerId": restored.station_peer_id,
            "actorPtid": restored.ptid,
            "deviceIdentityDigest": restored.device_id,
        }

    def access_snapshot(self, client_id: str) -> dict[str, Any]:
        evidence = self.access_evidence.get(client_id)
        if evidence is None:
            raise GateError(
                f"Mixed client {client_id!r} has no Access evidence"
            )
        return json.loads(json.dumps(evidence))

    def scope_snapshot(self, client_id: str) -> dict[str, Any]:
        identity = self.identities.get(client_id)
        if identity is None:
            raise GateError(
                f"Mixed client {client_id!r} has no active identity"
            )
        if self._is_desktop(client_id):
            if self.gate_id in STATION_ACCESS_GATE_IDS:
                scope = self._mapping(
                    self._desktop_identity_action(
                        self.desktop_sessions[client_id],
                        "scopeState",
                        {"actorPtid": identity.ptid},
                        timeout=10,
                    ),
                    "Desktop Station Access scope",
                )
                return {
                    "phase": scope.get("phase"),
                    "authenticated": scope.get("authenticated"),
                    "stationPeerId": scope.get("stationPeerId"),
                    "actorPtid": scope.get("actorPtid"),
                    "deviceIdentityDigest": self._identity_digest(
                        scope.get("deviceId")
                    ),
                }
            state = self._mapping(
                self.call_action(client_id, "identityState", {}),
                "Desktop identity state",
            )
            device = self._mapping(
                self.call_action(client_id, "getRealtimeDevice", {}),
                "Desktop realtime device",
            )
            return {
                "phase": state.get("phase"),
                "authenticated": state.get("authenticated"),
                "stationPeerId": identity.station_peer_id,
                "actorPtid": state.get("actorPtid"),
                "deviceIdentityDigest": (
                    device.get("deviceIdentityDigest")
                    or self._identity_digest(device.get("deviceId"))
                ),
            }
        scope = self._mapping(
            self.call_action(client_id, "lifecycle.scope.read", {}),
            "Mobile lifecycle scope",
        )
        device: dict[str, Any] = {}
        if (
            scope.get("activeActorPtid") is not None
            and self.gate_id not in STATION_ACCESS_GATE_IDS
        ):
            device = self._mapping(
                self.call_action(client_id, "getRealtimeDevice", {}),
                "Mobile realtime device",
            )
        return {
            "phase": scope.get("phase"),
            "launchState": scope.get("launchState"),
            "generation": scope.get("generation"),
            "stationPeerId": scope.get("activeStationPeerId"),
            "runtimeStationPeerId": scope.get("runtimeStationPeerId"),
            "actorPtid": scope.get("activeActorPtid"),
            "deviceIdentityDigest": (
                scope.get("deviceIdentityDigest")
                if self.gate_id in STATION_ACCESS_GATE_IDS
                else device.get("deviceIdentityDigest")
            ),
        }

    def _wait_for_mobile_active_identity(
        self,
        client_id: str,
        *,
        operation: str,
        timeout_seconds: float,
    ) -> None:
        identity = self.identities[client_id]
        self.wait_until(
            lambda: (
                scope
                if (
                    isinstance(
                        scope := self.call_action(
                            client_id,
                            "lifecycle.scope.read",
                            {},
                        ),
                        Mapping,
                    )
                    and scope.get("phase") == "ACTIVE"
                    and scope.get("activeActorPtid") == identity.ptid
                    and scope.get("activeStationPeerId")
                    == identity.station_peer_id
                )
                else None
            ),
            f"{client_id} authenticated after {operation}",
            timeout_seconds=timeout_seconds,
        )

    def create_direct(
        self,
        sender_id: str,
        receiver_id: str,
        *,
        timeout_seconds: float,
    ) -> str:
        sender = self.identities[sender_id]
        receiver = self.identities[receiver_id]
        if sender.federation_id != receiver.federation_id:
            raise GateError("Mixed clients do not share one Federation")
        if self._is_desktop(sender_id):
            wait_for_peer_key_bundle(
                self.desktop_sessions[sender_id],
                receiver.ptid,
                receiver.station_peer_id,
                timeout=timeout_seconds,
            )
            created = self.call_action(
                sender_id,
                "createDirectConversation",
                {
                    "peerPtid": receiver.ptid,
                    "federationId": sender.federation_id,
                },
            )
        else:
            created = self.call_action(
                sender_id,
                "messaging.createDirect",
                {
                    "peerPtid": receiver.ptid,
                    "federationId": sender.federation_id,
                },
            )
        conversation_id = self._required_text(
            self._mapping(created, "Direct creation").get("conversationId"),
            "Direct conversation ID",
        )
        self.wait_for_conversation(
            receiver_id,
            conversation_id,
            kind="direct",
            timeout_seconds=timeout_seconds,
        )
        return conversation_id

    def create_group(
        self,
        owner_id: str,
        member_ids: tuple[str, ...],
        *,
        name: str,
        timeout_seconds: float,
    ) -> str:
        owner = self.identities[owner_id]
        member_ptids = [
            self.identities[client_id].ptid for client_id in member_ids
        ]
        if any(
            self.identities[client_id].federation_id != owner.federation_id
            for client_id in member_ids
        ):
            raise GateError("Mixed Group clients do not share one Federation")
        if self._is_desktop(owner_id):
            created = self.call_action(
                owner_id,
                "createGroup",
                {
                    "name": name,
                    "federationId": owner.federation_id,
                    "memberPtids": member_ptids,
                },
            )
            group_id = self._required_text(
                self._mapping(created, "Group creation").get("groupUlid"),
                "Group conversation ID",
            )
        else:
            requested_id = secrets.token_hex(13)
            created = self.call_action(
                owner_id,
                "messaging.createGroup",
                {
                    "conversationId": requested_id,
                    "name": name,
                    "memberPtids": [owner.ptid, *member_ptids],
                    "federationId": owner.federation_id,
                },
            )
            group_id = self._required_text(
                self._mapping(created, "Group creation").get("conversationId"),
                "Group conversation ID",
            )
            if group_id != requested_id:
                raise GateError("Mobile Group creation changed conversation ID")
        for client_id in (owner_id, *member_ids):
            self.wait_for_conversation(
                client_id,
                group_id,
                kind="group",
                timeout_seconds=timeout_seconds,
            )
        return group_id

    def send_message(
        self,
        client_id: str,
        conversation_id: str,
        plaintext: str,
        *,
        kind: str,
        attachment_stage_ids: tuple[str, ...] = (),
    ) -> str:
        if self._is_desktop(client_id):
            sent = self.call_action(
                client_id,
                "sendInteractionMessage",
                {
                    "conversationId": conversation_id,
                    "kind": "friend" if kind == "direct" else "group",
                    "content": plaintext,
                },
            )
        else:
            payload: dict[str, Any] = {
                "conversationId": conversation_id,
                "plaintext": plaintext,
            }
            if attachment_stage_ids:
                payload["attachmentStageIds"] = list(attachment_stage_ids)
            sent = self.call_action(
                client_id,
                "messaging.send",
                payload,
            )
        return self._required_text(
            self._mapping(sent, "Message send").get("messageId"),
            "Message ID",
        )

    def message_projection(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
        *,
        kind: str,
    ) -> dict[str, Any] | None:
        if self._is_desktop(client_id):
            raw = self.call_action(
                client_id,
                "interactionProjection",
                {
                    "conversationId": conversation_id,
                    "kind": "friend" if kind == "direct" else "group",
                    "messageId": message_id,
                },
            )
            if not isinstance(raw, Mapping):
                return None
            value = dict(raw)
            value["plaintext"] = value.get("content")
            value["eventSequence"] = value.get("sequence")
            value["reactions"] = [
                {
                    **dict(reaction),
                    "reaction": reaction.get("reaction") or reaction.get("emoji"),
                }
                for reaction in value.get("reactions", ())
                if isinstance(reaction, Mapping)
            ]
            return value
        projection = self._mobile_projection(
            client_id,
            conversation_id=conversation_id,
        )
        messages = projection.get("messages")
        candidates = (
            messages.get(conversation_id)
            if isinstance(messages, Mapping)
            else None
        )
        return next(
            (
                dict(value)
                for value in candidates or ()
                if isinstance(value, Mapping)
                and value.get("messageId") == message_id
            ),
            None,
        )

    def message_occurrences(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
        *,
        kind: str,
    ) -> int:
        if self._is_desktop(client_id):
            result = self.call_action(
                client_id,
                "engineMessages",
                {
                    "actorPtid": self.identities[client_id].ptid,
                    "conversationId": conversation_id,
                },
            )
            messages = (
                result.get("messages")
                if isinstance(result, Mapping)
                else None
            )
        else:
            projection = self._mobile_projection(
                client_id,
                conversation_id=conversation_id,
            )
            raw_messages = projection.get("messages")
            messages = (
                raw_messages.get(conversation_id)
                if isinstance(raw_messages, Mapping)
                else None
            )
        return sum(
            1
            for value in messages or ()
            if isinstance(value, Mapping)
            and (
                value.get("messageId") == message_id
                or value.get("message_id") == message_id
                or value.get("messageUlid") == message_id
            )
        )

    def wait_for_message(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
        predicate: Callable[[Mapping[str, Any]], bool],
        *,
        kind: str,
        timeout_seconds: float,
        description: str,
    ) -> dict[str, Any]:
        value = self.wait_until(
            lambda: (
                message
                if (
                    isinstance(
                        message := self.message_projection(
                            client_id,
                            conversation_id,
                            message_id,
                            kind=kind,
                        ),
                        Mapping,
                    )
                    and predicate(message)
                )
                else None
            ),
            description,
            timeout_seconds=timeout_seconds,
        )
        return dict(value)

    def wait_for_conversation(
        self,
        client_id: str,
        conversation_id: str,
        *,
        kind: str,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        if self._is_desktop(client_id):
            action = "syncFriendSession" if kind == "direct" else "syncGroup"
            key = "sessionUlid" if kind == "direct" else "groupUlid"
            value = self.wait_until(
                lambda: self.call_action(
                    client_id,
                    action,
                    {key: conversation_id},
                ),
                f"{client_id} {kind} conversation",
                timeout_seconds=timeout_seconds,
            )
            return self._mapping(value, f"{client_id} conversation")

        expected_kind = 1 if kind == "direct" else 2
        value = self.wait_until(
            lambda: next(
                (
                    dict(candidate)
                    for candidate in self._mobile_projection(
                        client_id,
                        conversation_id=conversation_id,
                    ).get("conversations", ())
                    if isinstance(candidate, Mapping)
                    and candidate.get("conversationId") == conversation_id
                    and candidate.get("kind") == expected_kind
                    and candidate.get("active") is True
                ),
                None,
            ),
            f"{client_id} {kind} conversation",
            timeout_seconds=timeout_seconds,
        )
        return dict(value)

    def conversation_snapshot(
        self,
        client_id: str,
        conversation_id: str,
        *,
        kind: str,
    ) -> dict[str, Any] | None:
        if self._is_desktop(client_id):
            action = "syncFriendSession" if kind == "direct" else "syncGroup"
            key = "sessionUlid" if kind == "direct" else "groupUlid"
            value = self.call_action(
                client_id,
                action,
                {key: conversation_id},
            )
            return dict(value) if isinstance(value, Mapping) else None
        expected_kind = 1 if kind == "direct" else 2
        return next(
            (
                dict(candidate)
                for candidate in self._mobile_projection(
                    client_id,
                    conversation_id=conversation_id,
                ).get("conversations", ())
                if isinstance(candidate, Mapping)
                and candidate.get("conversationId") == conversation_id
                and candidate.get("kind") == expected_kind
            ),
            None,
        )

    def submit_read(
        self,
        client_id: str,
        conversation_id: str,
        sequence: int,
        *,
        kind: str,
    ) -> None:
        if self._is_desktop(client_id):
            self.call_action(
                client_id,
                "submitReadCursor",
                {
                    "conversationId": conversation_id,
                    "kind": "friend" if kind == "direct" else "group",
                    "lastReadSequence": sequence,
                },
            )
            return
        self.call_action(
            client_id,
            "messaging.read",
            {
                "conversationId": conversation_id,
                "lastReadSequence": sequence,
            },
        )

    def submit_typing(
        self,
        client_id: str,
        conversation_id: str,
        is_typing: bool,
    ) -> None:
        if self._is_desktop(client_id):
            self.call_action(
                client_id,
                "submitTyping",
                {
                    "conversationId": conversation_id,
                    "typing": is_typing,
                },
            )
            return
        self.call_action(
            client_id,
            "messaging.typing",
            {
                "conversationId": conversation_id,
                "isTyping": is_typing,
            },
        )

    def typing_visible(
        self,
        client_id: str,
        conversation_id: str,
        actor_ptid: str,
    ) -> bool:
        if self._is_desktop(client_id):
            value = self.call_action(
                client_id,
                "typingProjection",
                {"conversationId": conversation_id},
            )
            projection = self._mapping(value, "Desktop typing projection")
            peers = projection.get("peers")
        else:
            self.call_action(client_id, "social.reconcile", {})
            projection = self._mapping(
                self.call_action(
                    client_id,
                    "social.projection.read",
                    {},
                ),
                "Mobile Social projection",
            )
            typing_peers = projection.get("typingPeers")
            peers = (
                typing_peers.get(conversation_id)
                if isinstance(typing_peers, Mapping)
                else None
            )
        entry = peers.get(actor_ptid) if isinstance(peers, Mapping) else None
        return isinstance(entry, Mapping) and entry.get("typing") is True

    def interact(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
        *,
        kind: str,
        interaction: str,
        plaintext: str = "",
        reaction: str = "",
        remove: bool = False,
    ) -> Mapping[str, Any]:
        if self._is_desktop(client_id):
            if interaction == "edit":
                action = "editInteractionMessage"
                payload = {
                    "conversationId": conversation_id,
                    "kind": "friend" if kind == "direct" else "group",
                    "messageId": message_id,
                    "plaintext": plaintext,
                }
            else:
                action = "submitMetadataInteraction"
                payload = {
                    "conversationId": conversation_id,
                    "kind": "friend" if kind == "direct" else "group",
                    "messageId": message_id,
                    "interaction": interaction,
                    "reaction": reaction,
                    "remove": remove,
                }
        else:
            action = "messaging.interact"
            payload = {
                "conversationId": conversation_id,
                "messageId": message_id,
                "kind": interaction,
                "remove": remove,
            }
            if plaintext:
                payload["plaintext"] = plaintext
            if reaction:
                payload["reaction"] = reaction
        return self._mapping(
            self.call_action(client_id, action, payload),
            f"{client_id} {interaction}",
        )

    def stage_attachment(
        self,
        client_id: str,
        *,
        filename: str,
        mime_type: str,
        bytes_base64: str,
        sha256: str,
    ) -> dict[str, Any]:
        if self._is_desktop(client_id):
            raise GateError("Desktop attachment staging is not exposed")
        return self._mapping(
            self.call_action(
                client_id,
                "messaging.attachment.stage",
                {
                    "filename": filename,
                    "mimeType": mime_type,
                    "bytesBase64": bytes_base64,
                    "sha256": sha256,
                },
            ),
            "Mobile attachment stage",
        )

    def open_attachment(
        self,
        client_id: str,
        attachment_id: str,
    ) -> Mapping[str, Any]:
        if self._is_desktop(client_id):
            action = "openAttachment"
            payload = {
                "actorPtid": self.identities[client_id].ptid,
                "attachmentId": attachment_id,
            }
        else:
            action = "messaging.attachment.open"
            payload = {"attachmentId": attachment_id}
        return self._mapping(
            self.call_action(client_id, action, payload),
            f"{client_id} attachment open",
        )

    def set_mobile_suspended(self, client_id: str, suspended: bool) -> None:
        if self._is_desktop(client_id):
            raise GateError("Desktop suspension uses a different lifecycle")
        action = "lifecycle.suspend" if suspended else "lifecycle.resume"
        transition = self.call_action(client_id, action, {})
        # #region debug-point A-D:lifecycle-transition
        if (
            (REPO_ROOT / ".dbg" / "mobile-admission-stuck.env").exists()
            and type(self.mobile_binding).__module__ != "unittest.mock"
        ):
            _report_mobile_admission_debug(
                "A,C",
                "mixed_native_runtime.py:set_mobile_suspended:transition",
                {
                    "clientId": client_id,
                    "requestedSuspended": suspended,
                    "transition": transition,
                },
            )
            try:
                _report_mobile_admission_debug(
                    "B,D",
                    "mixed_native_runtime.py:set_mobile_suspended:recovery",
                    {
                        "clientId": client_id,
                        "requestedSuspended": suspended,
                        "recovery": self.call_action(client_id, "recovery.snapshot", {}),
                    },
                )
            except Exception as error:
                _report_mobile_admission_debug(
                    "B,D",
                    "mixed_native_runtime.py:set_mobile_suspended:recovery-error",
                    {"clientId": client_id, "instrumentationError": str(error)},
                )
        # #endregion

    def remove_group_member(
        self,
        owner_id: str,
        group_id: str,
        member_ptid: str,
    ) -> None:
        if not self._is_desktop(owner_id):
            raise GateError("Mixed Group membership owner must be Desktop")
        self.call_action(
            owner_id,
            "removeGroupMember",
            {"groupUlid": group_id, "memberPtid": member_ptid},
        )

    def add_group_member(
        self,
        owner_id: str,
        group_id: str,
        member_ptid: str,
    ) -> None:
        if not self._is_desktop(owner_id):
            raise GateError("Mixed Group membership owner must be Desktop")
        self.call_action(
            owner_id,
            "inviteToGroup",
            {"groupUlid": group_id, "memberPtids": [member_ptid]},
        )

    def revoke_current_device(self, client_id: str) -> Mapping[str, Any]:
        if not self._is_desktop(client_id):
            raise GateError("Current mixed Gate revokes the Desktop endpoint")
        result = self._mapping(
            self.call_action(client_id, "revokeCurrentDevice", {}),
            "Desktop device revoke",
        )
        self.desktop_lifecycles.mark_device_revoked(
            self.desktop_sessions[client_id]
        )
        return result

    def cleanup(
        self,
        *,
        save_desktop_log: Callable[[TauriSession, str], Any] | None = None,
    ) -> dict[str, Any]:
        errors: list[dict[str, str]] = []
        for client_id in reversed(tuple(self.mobile_clients)):
            try:
                self.call_action(client_id, "cleanup", {})
            except Exception as error:
                errors.append(
                    {
                        "resource": f"mobile-session:{client_id}",
                        "error": str(error),
                    }
                )
        try:
            self.mobile_binding.close()
        except Exception as error:
            errors.append(
                {
                    "resource": "mobile-runtime-binding",
                    "error": str(error),
                }
            )
        self.mobile_clients.clear()

        for client_id, session in reversed(
            tuple(self.desktop_sessions.items())
        ):
            errors.extend(self.desktop_lifecycles.release(session))
            if save_desktop_log is not None and not save_desktop_log(
                session,
                client_id,
            ):
                errors.append(
                    {
                        "resource": f"desktop-log:{client_id}",
                        "error": "Desktop client log was not exported",
                    }
                )
        desktop_specs = {
            client_id: self.client_specs[client_id]
            for client_id in self.desktop_sessions
        }
        try:
            desktop_cleanup = self.desktop_binding.finalize_cleanup(
                self.desktop_instances,
                desktop_specs,
            )
        except Exception as error:
            desktop_cleanup = {
                "portsReleased": False,
                "processesReleased": False,
                "storageReleased": False,
                "logsReleased": False,
                "cleanupErrors": [
                    {
                        "resource": "desktop-runtime-binding",
                        "error": str(error),
                    }
                ],
            }
        raw_desktop_errors = desktop_cleanup.get("cleanupErrors")
        if isinstance(raw_desktop_errors, list):
            errors.extend(
                dict(value)
                for value in raw_desktop_errors
                if isinstance(value, Mapping)
            )
        return {
            "mobileSessionsReleased": not self.mobile_clients,
            "desktop": desktop_cleanup,
            "cleanupErrors": errors,
        }

    @staticmethod
    def wait_until(
        predicate: Callable[[], Any],
        description: str,
        *,
        timeout_seconds: float,
    ) -> Any:
        deadline = time.monotonic() + timeout_seconds
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                value = predicate()
                if value:
                    return value
            except Exception as error:
                last_error = error
            time.sleep(POLL_INTERVAL_SECONDS)
        suffix = f"; last error: {last_error}" if last_error else ""
        raise GateError(f"timed out waiting for {description}{suffix}")

    def _start_desktop(
        self,
        client_id: str,
        expected: Mapping[str, Any],
        *,
        window_slot: int,
        window_count: int,
    ) -> MixedClientIdentity:
        session = self.desktop_binding.create_bound_session(
            client_id,
            NativeLaunchOptions(
                window_slot=window_slot,
                window_count=window_count,
            ),
        )
        _, station_service = require_runtime_client_service(
            self.manifest,
            client_id,
            "station",
        )
        station_url = self._required_text(
            station_service.get("endpoint"),
            f"{client_id} Station endpoint",
        ).rstrip("/")
        expected_station_peer_id = self._required_text(
            station_service.get("runtimeIdentity"),
            f"{client_id} Station identity",
        )
        station_binding = self._mapping(
            call_async_harness(
                session,
                "configureStation",
                {"stationUrl": station_url},
                namespace="stationAccess",
                script_timeout=30,
            ),
            "Desktop Station binding",
        )
        if (
            station_binding.get("configured") is not True
            or station_binding.get("activeUrl") != station_url
            or station_binding.get("boundUrl") != station_url
            or station_binding.get("bindingPhase") != "access_gate"
            or station_binding.get("activeStationPeerId")
            != expected_station_peer_id
        ):
            raise GateError(
                f"{client_id} did not verify the configured Station"
            )
        pre_authentication = self._mapping(
            self._desktop_identity_action(
                session,
                "identityState",
                {},
                timeout=10,
            ),
            "Desktop pre-authentication identity state",
        )
        access_evidence = getattr(self, "access_evidence", None)
        if access_evidence is None:
            access_evidence = {}
            self.access_evidence = access_evidence
        access_evidence[client_id] = {
            "stationBinding": station_binding,
            "preAuthentication": pre_authentication,
            "bindingProofRefs": list(self.desktop_binding.proof_refs()),
        }
        expected_ptid = str(expected.get("ptid") or "")
        self.desktop_instances.append(session)
        self.desktop_lifecycles.register(session, expected_ptid)
        self.desktop_lifecycles.mark_live(session)
        account_ref = str(expected.get("accountRef") or "")
        login = self._desktop_identity_action(
            session,
            "loginWithPassword",
            {
                "account": account_ref.removeprefix("station-account:"),
                "password": DEV_ACCOUNT_PASSWORD,
            },
            timeout=30,
        )
        if not isinstance(login, Mapping) or login.get("authenticated") is not True:
            raise GateError(f"{client_id} login did not authenticate")
        bound_station = self._mapping(
            call_async_harness(
                session,
                "bindingState",
                {},
                namespace="stationAccess",
                script_timeout=10,
            ),
            "Desktop authenticated Station binding",
        )
        if (
            bound_station.get("phase") != "bound"
            or str(bound_station.get("bound_url") or "").rstrip("/")
            != station_url
        ):
            raise GateError(
                f"{client_id} Station binding did not complete after access grant"
            )
        access_evidence[client_id]["postAuthentication"] = bound_station
        self.desktop_lifecycles.mark_authenticated(session)
        if self.gate_id in STATION_ACCESS_GATE_IDS:
            ptid = str(login.get("actorPtid") or "")
        else:
            hydrated = async_harness(
                session,
                "hydrateActiveActor",
                {},
                timeout=30,
            )
            ptid = str(
                hydrated.get("actorPtid")
                if isinstance(hydrated, Mapping)
                else ""
            )
        if ptid != expected_ptid:
            raise GateError(
                f"{client_id} actor mismatch: expected={expected_ptid} actual={ptid}"
            )
        if not is_native_tauri_url(session.get_current_url()):
            raise GateError(f"{client_id} is not a native Tauri client")
        self.desktop_sessions[client_id] = session
        return self._identity_with_device(
            client_id,
            expected,
            runtime="desktop-macos-native",
        )

    def _start_mobile(
        self,
        client_id: str,
        expected: Mapping[str, Any],
    ) -> MixedClientIdentity:
        activation = self.mobile_binding.create_bound_session(client_id)
        authentication = self.mobile_binding.authenticate_fixture_actor(
            client_id
        )
        raw_pre_authentication = authentication.get(
            "preAuthenticationScope"
        )
        access_evidence = getattr(self, "access_evidence", None)
        if access_evidence is None:
            access_evidence = {}
            self.access_evidence = access_evidence
        raw_binding_proofs = getattr(activation, "binding_proofs", {})
        access_evidence[client_id] = {
            "preAuthentication": (
                dict(raw_pre_authentication)
                if isinstance(raw_pre_authentication, Mapping)
                else {}
            ),
            "bindingProofRefs": [
                proof.to_dict()
                for proof in raw_binding_proofs.values()
            ],
        }
        raw_login = authentication.get("login")
        login = dict(raw_login) if isinstance(raw_login, Mapping) else {}
        raw_session = login.get("session")
        session = dict(raw_session) if isinstance(raw_session, Mapping) else {}
        expected_ptid = str(expected.get("ptid") or "")
        if session.get("actorPtid") != expected_ptid:
            raise GateError(
                f"{client_id} actor mismatch after Mobile authentication"
            )
        if (
            activation.scope.get("activeStationPeerId")
            != str(expected.get("homeStationPeerId") or "")
        ):
            raise GateError(
                f"{client_id} Mobile binding selected the wrong Station"
            )
        self.mobile_clients.append(client_id)
        restart = self.call_action(client_id, "lifecycle.restart", {})
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError(
                f"{client_id} post-login restart was not acknowledged"
            )
        self.wait_until(
            lambda: (
                scope
                if (
                    isinstance(
                        scope := self.call_action(
                            client_id,
                            "lifecycle.scope.read",
                            {},
                        ),
                        Mapping,
                    )
                    and scope.get("phase") == "ACTIVE"
                    and scope.get("activeActorPtid") == expected_ptid
                    and scope.get("activeStationPeerId")
                    == str(expected.get("homeStationPeerId") or "")
                )
                else None
            ),
            f"{client_id} authenticated runtime",
            timeout_seconds=60.0,
        )

        if self.gate_id in STATION_ACCESS_GATE_IDS:
            return self._identity_with_device(
                client_id,
                expected,
                runtime=MOBILE_RUNTIME,
            )

        def reconcile_messaging_identity() -> MixedClientIdentity:
            self.call_action(client_id, "messaging.reconcile", {})
            return self._identity_with_device(
                client_id,
                expected,
                runtime=MOBILE_RUNTIME,
            )

        return self.wait_until(
            reconcile_messaging_identity,
            f"{client_id} active messaging endpoint",
            timeout_seconds=60.0,
        )

    def _identity_with_device(
        self,
        client_id: str,
        expected: Mapping[str, Any],
        *,
        runtime: str,
    ) -> MixedClientIdentity:
        expected_ptid = str(expected.get("ptid") or "")
        if (
            self.gate_id in STATION_ACCESS_GATE_IDS
            and runtime == MOBILE_RUNTIME
        ):
            device = self._mapping(
                self.call_action(client_id, "lifecycle.scope.read", {}),
                f"{client_id} Station Access scope",
            )
            device_id = str(device.get("deviceIdentityDigest") or "")
            device_active = (
                device.get("phase") == "ACTIVE"
                and device.get("activeStationPeerId")
                == str(expected.get("homeStationPeerId") or "")
            )
        elif (
            self.gate_id in STATION_ACCESS_GATE_IDS
            and self._is_desktop(client_id)
        ):
            device = self._mapping(
                self._desktop_identity_action(
                    self.desktop_sessions[client_id],
                    "scopeState",
                    {"actorPtid": expected_ptid},
                    timeout=10,
                ),
                f"{client_id} Station Access scope",
            )
            device_id = self._identity_digest(device.get("deviceId"))
            device_active = (
                device.get("authenticated") is True
                and device.get("bindingPhase") == "bound"
            )
        else:
            device = self.call_action(client_id, "getRealtimeDevice", {})
            if not isinstance(device, Mapping):
                raise GateError(f"{client_id} device projection is invalid")
            device_id = str(
                device.get("deviceIdentityDigest")
                or self._identity_digest(device.get("deviceId"))
            )
            device_active = device.get("active") is True
        if (
            not device_active
            or str(device.get("actorPtid") or "") != expected_ptid
            or not device_id
        ):
            raise GateError(f"{client_id} messaging endpoint is not active")
        spec = self._client_spec(client_id)
        service_id, service = require_runtime_client_service(
            self.manifest,
            client_id,
            "station",
        )
        return MixedClientIdentity(
            client_id=client_id,
            actor=str(spec.get("actor") or ""),
            runtime=runtime,
            station_service_id=service_id,
            station_peer_id=str(service.get("runtimeIdentity") or ""),
            ptid=expected_ptid,
            account_ref=str(expected.get("accountRef") or ""),
            federation_id=str(expected.get("federationId") or ""),
            device_id=device_id,
        )

    def _client_spec(self, client_id: str) -> dict[str, Any]:
        spec = self.client_specs.get(client_id)
        if spec is None:
            raise GateError(f"Mixed runtime client {client_id!r} is missing")
        return spec

    def _mobile_projection(
        self,
        client_id: str,
        *,
        conversation_id: str = "",
    ) -> dict[str, Any]:
        self.call_action(client_id, "messaging.reconcile", {})
        return self._mapping(
            self.call_action(
                client_id,
                "messaging.projection.read",
                (
                    {"conversationId": conversation_id}
                    if conversation_id
                    else {}
                ),
            ),
            f"{client_id} Messaging projection",
        )

    def _is_desktop(self, client_id: str) -> bool:
        return self._client_spec(client_id).get("runtime") == DESKTOP_RUNTIME

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must return an object")
        return dict(value)

    @staticmethod
    def _required_text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be a non-empty string")
        return value

    def _actor_for_client(self, client_id: str) -> dict[str, Any]:
        spec = self._client_spec(client_id)
        actor = str(spec.get("actor") or "")
        service_id, service = require_runtime_client_service(
            self.manifest,
            client_id,
            "station",
        )
        stations = self.actor_manifest.get("stations")
        station = (
            stations.get(service_id)
            if isinstance(stations, Mapping)
            else None
        )
        actors = station.get("actors") if isinstance(station, Mapping) else None
        match = next(
            (
                dict(value)
                for value in actors or ()
                if isinstance(value, Mapping) and value.get("role") == actor
            ),
            None,
        )
        if match is None:
            raise GateError(
                f"Mixed runtime actor {actor!r} is missing on {service_id!r}"
            )
        if match.get("homeStationPeerId") != service.get("runtimeIdentity"):
            raise GateError(
                f"Mixed runtime actor {actor!r} has the wrong Home Station"
            )
        return match

    @classmethod
    def _project_client_result(cls, value: object) -> object:
        if isinstance(value, Mapping):
            projected: dict[str, object] = {}
            for key, item in value.items():
                normalized = "".join(
                    character
                    for character in str(key).lower()
                    if character.isalnum()
                )
                if normalized == "deviceid":
                    projected["deviceIdentityDigest"] = cls._identity_digest(
                        item
                    )
                elif normalized == "winningdeviceid":
                    projected["winningDeviceIdentityDigest"] = (
                        cls._identity_digest(item)
                    )
                else:
                    projected[str(key)] = cls._project_client_result(item)
            return projected
        if isinstance(value, (list, tuple)):
            return [cls._project_client_result(item) for item in value]
        return value

    @staticmethod
    def _identity_digest(value: object) -> str:
        raw = str(value or "")
        if not raw:
            return ""
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compact_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))
