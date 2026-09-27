#!/usr/bin/env python3
"""Prove a three-participant group audio/video call on Native Desktop."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import json
import os
import random
import time
from typing import Any

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, DriverError, GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    cleanup_preserving_primary_failure,
    commits_match,
    is_native_tauri_url,
    native_runtime_source_identity,
    read_station_version,
    runtime_station_service,
    selected_native_runtime,
    shared_federation_id,
    verify_runtime_fixture_ready,
    wait_until,
)


GATE_ID = "chat-lifecycle-group-live-e2e"
ACTORS = ("alice", "bob", "charlie")
STEP_TIMEOUT = 120.0
REQUIRED_ASSERTIONS = {
    "group_call_native_runtime",
    "group_call_actor_isolation",
    "group_call_room_converged",
    "group_call_audio_media_live",
    "group_call_mute_converged",
    "group_call_audio_released",
    "group_call_video_media_live",
    "group_call_camera_converged",
    "group_call_late_join_converged",
    "group_call_video_released",
}


def _snapshot(client: TauriSession) -> dict[str, Any] | None:
    result = async_harness(client, "groupCallSnapshot", {}, timeout=15)
    if not isinstance(result, dict):
        return None
    snapshot = result.get("snapshot")
    return snapshot if isinstance(snapshot, dict) else None


def _wait_connected(
    client: TauriSession,
    participant_count: int,
) -> dict[str, Any]:
    result = wait_until(
        lambda: (
            snapshot
            if (
                (snapshot := _snapshot(client))
                and snapshot.get("state") == "connected"
                and len(snapshot.get("participants") or []) == participant_count
            )
            else None
        ),
        f"group call connected with {participant_count} participants",
        timeout=STEP_TIMEOUT,
        interval=0.5,
    )
    if not isinstance(result, dict):
        raise GateError("group call snapshot did not converge")
    return result


def _all_connected_with_participant_state(
    clients: dict[str, TauriSession],
    *,
    participant_count: int,
    actor_ptid: str,
    field: str,
    expected: bool,
) -> dict[str, dict[str, Any]] | None:
    snapshots = {
        actor: _snapshot(client)
        for actor, client in clients.items()
    }
    if not all(
        isinstance(snapshot, dict)
        and snapshot.get("state") == "connected"
        and len(snapshot.get("participants") or []) == participant_count
        and any(
            participant.get("actorPtid") == actor_ptid
            and participant.get(field) is expected
            for participant in snapshot.get("participants") or []
        )
        for snapshot in snapshots.values()
    ):
        return None
    return {
        actor: snapshot
        for actor, snapshot in snapshots.items()
        if isinstance(snapshot, dict)
    }


def _surface_media(client: TauriSession) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const surface = document.querySelector('[data-group-call-surface]');
        if (!surface) return null;
        const media = (selector) => Array.from(
          surface.querySelectorAll(selector),
        ).map((element) => {
          const stream = element.srcObject;
          return {
            actorPtid: element.getAttribute('aria-label') || '',
            readyState: Number(element.readyState || 0),
            liveTracks: stream instanceof MediaStream
              ? stream.getTracks()
                .filter((track) => track.readyState === 'live')
                .map((track) => track.kind)
              : [],
          };
        });
        return {
          state: surface.getAttribute('data-group-call-state') || '',
          displayMode:
            surface.getAttribute('data-group-call-display-mode') || '',
          audio: media('[data-group-call-remote-audio]'),
          video: media('[data-group-call-participant] video'),
        };
        """
    )
    return value if isinstance(value, dict) else None


def _has_remote_audio(surface: object, count: int) -> bool:
    if not isinstance(surface, dict):
        return False
    audio = surface.get("audio")
    return isinstance(audio, list) and sum(
        isinstance(item, dict) and "audio" in (item.get("liveTracks") or [])
        for item in audio
    ) >= count


def _has_video(surface: object, count: int) -> bool:
    if not isinstance(surface, dict):
        return False
    video = surface.get("video")
    return isinstance(video, list) and sum(
        isinstance(item, dict) and "video" in (item.get("liveTracks") or [])
        for item in video
    ) >= count


def _all_surfaces_with_media(
    clients: dict[str, TauriSession],
    *,
    video: bool,
) -> dict[str, dict[str, Any]] | None:
    surfaces = {
        actor: _surface_media(clients[actor])
        for actor in ACTORS
    }
    if not all(
        _has_remote_audio(surface, len(ACTORS) - 1)
        and (not video or _has_video(surface, len(ACTORS)))
        for surface in surfaces.values()
    ):
        return None
    return {
        actor: surface
        for actor, surface in surfaces.items()
        if isinstance(surface, dict)
    }


def _media_harness(
    client: TauriSession,
    runtime_binding: NativeDesktopRuntimeBinding,
    method: str,
    payload: dict[str, Any],
    *,
    timeout: float = 45.0,
) -> Any:
    if client.process_id is None:
        raise GateError(f"{method} has no owning Native process")
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            async_harness,
            client,
            method,
            payload,
            timeout,
        )
        while True:
            try:
                return future.result(timeout=0.1)
            except FutureTimeoutError:
                try:
                    runtime_binding.native_adapter.accept_media_capture_permission_to_process(
                        client.process_id
                    )
                except DriverError as permission_error:
                    try:
                        return future.result(timeout=2)
                    except FutureTimeoutError:
                        raise permission_error


class LifecycleGroupLiveGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "CHAT-W05B"
    bom = ("CHAT-G06", "CHAT-UR09")
    spec = ("CHAT-J09", "chat-group-live-lifecycle")
    report_path = None

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__()
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        source = manifest.get("source")
        self.tested_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        self.workspace_digest = str(
            source.get("workspaceDigest") if isinstance(source, dict) else ""
        )
        self.station_url = str(
            runtime_station_service(manifest, "alice").get("endpoint") or ""
        ).rstrip("/")
        self.client_specs = {
            str(client.get("id")): client
            for client in manifest.get("clients", [])
            if isinstance(client, dict)
        }
        self.actor_specs = {
            str(actor.get("role")): actor
            for actor in actor_manifest.get("actors", [])
            if isinstance(actor, dict)
        }
        if set(self.client_specs) != set(ACTORS):
            raise GateError("group call requires Alice, Bob, and Charlie clients")
        if set(self.actor_specs) != set(ACTORS):
            raise GateError("group call requires Alice, Bob, and Charlie actors")
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.steps: list[dict[str, Any]] = []
        self.report.manifest = manifest
        self.report.station_url = self.station_url
        self.report.runtime.update(
            {
                "runtimeCell": runtime_binding.cell_id,
                "journey": "chat-group-live-lifecycle",
                "steps": self.steps,
                "cleanup": {},
            }
        )

    def step(self, name: str, action: Any, client: str = "") -> Any:
        started = time.monotonic()
        try:
            value = action()
        except Exception as error:
            self.steps.append(
                {
                    "step": name,
                    "client": client,
                    "status": "fail",
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "error": str(error),
                }
            )
            raise
        self.steps.append(
            {
                "step": name,
                "client": client,
                "status": "pass",
                "durationMs": int((time.monotonic() - started) * 1000),
            }
        )
        return value

    def start_client(self, actor: str) -> None:
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=ACTORS.index(actor),
                window_count=len(ACTORS),
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = str(self.actor_specs[actor].get("ptid") or "")
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        account_ref = str(self.actor_specs[actor].get("accountRef") or "")
        login = async_harness(
            client,
            "loginWithPassword",
            {
                "account": account_ref.removeprefix("station-account:"),
                "password": DEV_ACCOUNT_PASSWORD,
            },
            timeout=30,
        )
        if not (login or {}).get("authenticated"):
            raise GateError(f"{actor} login did not authenticate")
        self.client_lifecycles.mark_authenticated(client)
        hydration = async_harness(client, "hydrateActiveActor", {}, timeout=30)
        actor_ptid = str((hydration or {}).get("actorPtid") or "")
        if actor_ptid != expected_ptid:
            raise GateError(
                f"{actor} identity mismatch expected={expected_ptid} actual={actor_ptid}"
            )
        device = async_harness(client, "getRealtimeDevice", {})
        device_id = str((device or {}).get("deviceId") or "")
        if not device_id:
            raise GateError(f"{actor} messaging device ID is missing")
        self.clients[actor] = client
        self.ptids[actor] = actor_ptid
        self.device_ids[actor] = device_id
        self.report.add_actor(
            ActorRuntime(
                name=actor,
                runtime=self.runtime_binding.cell_id,
                port=client.port,
                gateway_port=client.gateway_port,
                profile=client.profile,
                storage_root=client.storage_root,
                pid=client.process_id,
            )
        )

    def verify_fixture_ready(self) -> bool:
        verify_runtime_fixture_ready(self.manifest, self.actor_manifest)
        return True

    def source_identity(self, station_live: dict[str, Any]) -> dict[str, Any]:
        identity = native_runtime_source_identity(
            gate_id=self.gate_id,
            manifest=self.manifest,
            runtime_binding=self.runtime_binding,
            station_live=station_live,
        )
        self.report.runtime.update(
            {
                "runtimeCellRunId": identity["runtimeCell"].get("runId"),
                "sourceIdentity": identity,
            }
        )
        return identity

    def cleanup_clients(self) -> dict[str, Any]:
        errors: list[dict[str, str]] = []
        for client in reversed(self.runtime_instances):
            errors.extend(self.client_lifecycles.release(client))
        for actor, client in self.clients.items():
            if not self.save_app_log(client, actor):
                errors.append(
                    {
                        "resource": f"log:{client.profile}",
                        "error": "Native client log was not exported",
                    }
                )
        cleanup = self.runtime_binding.finalize_cleanup(
            self.runtime_instances,
            self.client_specs,
        )
        binding_errors = cleanup.get("cleanupErrors")
        if isinstance(binding_errors, list):
            errors.extend(item for item in binding_errors if isinstance(item, dict))
        cleanup["cleanupErrors"] = errors
        if errors or not all(
            cleanup.get(key)
            for key in (
                "portsReleased",
                "processesReleased",
                "storageReleased",
                "logsReleased",
            )
        ):
            raise GateError(
                f"Native group call cleanup failed: {json.dumps(cleanup, sort_keys=True)}"
            )
        self.report.runtime["cleanup"] = cleanup
        return cleanup

    def wait_mls_readiness(self) -> None:
        for actor in ACTORS:
            wait_until(
                lambda actor=actor: (
                    state
                    if (
                        isinstance(
                            state := async_harness(
                                self.clients[actor],
                                "mlsReadiness",
                                {},
                                timeout=10,
                            ),
                            dict,
                        )
                        and state.get("active") is True
                        and int(state.get("availableKeyPackages") or 0) > 0
                    )
                    else None
                ),
                f"{actor} MLS readiness",
                timeout=STEP_TIMEOUT,
                interval=1,
            )

    def create_group(self) -> str:
        federation_id = shared_federation_id(self.clients, ACTORS)
        result = async_harness(
            self.clients["alice"],
            "createGroup",
            {
                "name": "Group Live Acceptance",
                "federationId": federation_id,
                "memberPtids": [self.ptids["bob"], self.ptids["charlie"]],
            },
            timeout=60,
        )
        group_id = str((result or {}).get("groupUlid") or "")
        if not group_id:
            raise GateError(f"group creation failed: {result}")
        return group_id

    def add_member(self, group_id: str) -> dict[str, Any]:
        projections: dict[str, Any] = {}
        for actor in ACTORS:
            projections[actor] = wait_until(
                lambda actor=actor: (
                    value
                    if (
                        isinstance(
                            value := async_harness(
                                self.clients[actor],
                                "syncGroup",
                                {"groupUlid": group_id},
                                timeout=30,
                            ),
                            dict,
                        )
                        and set(value.get("memberPtids") or [])
                        == set(self.ptids.values())
                    )
                    else None
                ),
                f"{actor} group membership",
                timeout=180,
                interval=1,
            )
        return projections

    def _start_call(
        self,
        actor: str,
        group_id: str,
        media_kind: str,
    ) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        _media_harness(
            self.clients[actor],
            self.runtime_binding,
            "groupCallStart",
            {"groupUlid": group_id, "mediaKind": media_kind},
        )

    def _join_all(
        self,
        group_id: str,
        media_kind: str,
    ) -> dict[str, dict[str, Any]]:
        for actor in ACTORS:
            self._start_call(actor, group_id, media_kind)
        return {
            actor: _wait_connected(self.clients[actor], len(ACTORS))
            for actor in ACTORS
        }

    def _leave_all(self) -> dict[str, dict[str, Any]]:
        released: dict[str, dict[str, Any]] = {}
        for actor in ACTORS:
            result = async_harness(
                self.clients[actor], "groupCallLeave", {}, timeout=15
            )
            snapshot = result.get("snapshot") if isinstance(result, dict) else None
            if not isinstance(snapshot, dict):
                raise GateError(f"{actor} group call leave returned no snapshot")
            released[actor] = snapshot
        return released

    def _set_display_mode(self, actor: str, mode: str) -> None:
        clicked = self.clients[actor].execute_script(
            """
            const target = arguments[0];
            const button = document.querySelector(
              `[data-group-call-display-mode-target="${target}"]`,
            );
            if (!(button instanceof HTMLElement)) return false;
            button.click();
            return true;
            """,
            mode,
        )
        if clicked is not True:
            raise GateError(f"{actor} cannot select group call mode {mode}")

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")

        version = self.step(
            "station.identity",
            lambda: read_station_version(self.station_url),
        )
        live_commit = str(version.get("build_commit") or "")
        if not commits_match(live_commit, self.tested_commit):
            raise GateError(
                "Station/client commit mismatch: "
                f"station={live_commit or 'missing'} client={self.tested_commit}"
            )
        source_identity = self.source_identity(version)
        self.step("fixture.reset", self.verify_fixture_ready)

        order = list(ACTORS)
        random.SystemRandom().shuffle(order)
        cleanup: dict[str, Any] = {}
        group_id = ""
        evidence: dict[str, Any] = {}
        try:
            for actor in order:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )
            self.assert_condition(
                "group_call_native_runtime",
                all(
                    is_native_tauri_url(client.get_current_url())
                    for client in self.clients.values()
                ),
            )
            self.assert_condition(
                "group_call_actor_isolation",
                len(set(self.ptids.values())) == len(ACTORS),
            )
            self.step("mls.readiness", self.wait_mls_readiness)
            group_id = self.step("group.create", self.create_group, "alice")
            projections = self.step(
                "group.visible",
                lambda: self.add_member(group_id),
                "alice",
            )
            if set(projections) != set(ACTORS):
                raise GateError("group is not visible to all call participants")

            audio = self.step(
                "group-call.audio.join",
                lambda: self._join_all(group_id, "audio"),
            )
            room_names = {item.get("roomName") for item in audio.values()}
            self.assert_condition(
                "group_call_room_converged",
                len(room_names) == 1 and "" not in room_names,
                json.dumps(audio, sort_keys=True),
            )
            audio_media = wait_until(
                lambda: _all_surfaces_with_media(
                    self.clients,
                    video=False,
                ),
                "bilateral group audio media",
                timeout=STEP_TIMEOUT,
                interval=0.5,
            )
            self.assert_condition(
                "group_call_audio_media_live",
                bool(audio_media),
                json.dumps(audio_media, sort_keys=True),
            )
            async_harness(
                self.clients["charlie"],
                "groupCallToggleMic",
                {"enabled": False},
                timeout=15,
            )
            muted = wait_until(
                lambda: _all_connected_with_participant_state(
                    self.clients,
                    participant_count=len(ACTORS),
                    actor_ptid=self.ptids["charlie"],
                    field="isMicEnabled",
                    expected=False,
                ),
                "Charlie mute state on all group call participants",
                timeout=STEP_TIMEOUT,
                interval=0.5,
            )
            self.assert_condition(
                "group_call_mute_converged",
                all(
                    any(
                        participant.get("actorPtid") == self.ptids["charlie"]
                        and participant.get("isMicEnabled") is False
                        for participant in snapshot.get("participants") or []
                    )
                    for snapshot in muted.values()
                ),
                json.dumps(muted, sort_keys=True),
            )
            audio_released = self._leave_all()
            self.assert_condition(
                "group_call_audio_released",
                all(item.get("state") == "idle" for item in audio_released.values()),
            )

            video = self.step(
                "group-call.video.join",
                lambda: self._join_all(group_id, "video"),
            )
            for actor in ACTORS:
                self._set_display_mode(actor, "expanded")
            video_media = wait_until(
                lambda: _all_surfaces_with_media(
                    self.clients,
                    video=True,
                ),
                "three-client group video media",
                timeout=STEP_TIMEOUT,
                interval=0.5,
            )
            self.assert_condition(
                "group_call_video_media_live",
                bool(video_media),
                json.dumps(video_media, sort_keys=True),
            )
            async_harness(
                self.clients["bob"],
                "groupCallToggleCamera",
                {"enabled": False},
                timeout=15,
            )
            camera_off = wait_until(
                lambda: _all_connected_with_participant_state(
                    self.clients,
                    participant_count=len(ACTORS),
                    actor_ptid=self.ptids["bob"],
                    field="isCameraEnabled",
                    expected=False,
                ),
                "Bob camera state on all group call participants",
                timeout=STEP_TIMEOUT,
                interval=0.5,
            )
            self.assert_condition(
                "group_call_camera_converged",
                all(
                    any(
                        participant.get("actorPtid") == self.ptids["bob"]
                        and participant.get("isCameraEnabled") is False
                        for participant in snapshot.get("participants") or []
                    )
                    for snapshot in camera_off.values()
                ),
                json.dumps(camera_off, sort_keys=True),
            )
            async_harness(
                self.clients["charlie"], "groupCallLeave", {}, timeout=15
            )
            for actor in ("alice", "bob"):
                _wait_connected(self.clients[actor], len(ACTORS) - 1)
            self._start_call("charlie", group_id, "video")
            late_join = {
                actor: _wait_connected(self.clients[actor], len(ACTORS))
                for actor in ACTORS
            }
            self.assert_condition(
                "group_call_late_join_converged",
                all(len(item.get("participants") or []) == len(ACTORS) for item in late_join.values()),
            )
            video_released = self._leave_all()
            self.assert_condition(
                "group_call_video_released",
                all(item.get("state") == "idle" for item in video_released.values()),
            )
            evidence = {
                "groupId": group_id,
                "audio": audio,
                "audioMedia": audio_media,
                "mute": muted,
                "video": video,
                "videoMedia": video_media,
                "cameraOff": camera_off,
                "lateJoin": late_join,
            }
            self.report.runtime["groupLive"] = evidence
            for actor in ACTORS:
                self.save_screenshot(self.clients[actor], actor)
                self.save_dom(self.clients[actor], actor)
        finally:
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup_clients,
                self.report,
                "Native group live",
            )
            self.report.runtime["steps"] = self.steps

        assertion_names = {item.name for item in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertion_names
        if missing:
            raise GateError(f"group live assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": self.runtime_binding.cell_id,
            "journey": "chat-group-live-lifecycle",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "groupId": group_id,
            "steps": self.steps,
            "cleanup": cleanup,
            "groupLive": evidence,
        }


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecycleGroupLiveGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
