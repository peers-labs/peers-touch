from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any, Mapping, Protocol, Sequence, cast

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import ClientBindingError, DriverError
from tooling.acceptance.core.provisioning import (
    BindingProofRecord,
    ClientRuntimeIdentity,
    persist_client_binding_observation,
    require_runtime_client_service,
    validate_binding_proof_closure,
)
from tooling.acceptance.core.runtime_cell import RuntimeCellLifecycle
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeKey,
    NativeModifier,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
)
from tooling.acceptance.drivers.tauri import (
    LocalTauriLauncher,
    TauriSession,
    find_app_binary,
)
from tooling.acceptance.drivers.station import StationDriver


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RemoteNativeRuntimeCellLifecycle(RuntimeCellLifecycle, Protocol):
    """Runtime-cell operations required by a remote Native Desktop binding."""

    def validate_binding(
        self,
        gate_id: str,
        source_commit: str,
    ) -> None:
        ...

    def launch_actor(
        self,
        actor: str,
        client_spec: dict[str, Any],
        environment: dict[str, str],
    ) -> Any:
        ...

    def expose_orchestrator_endpoint(
        self,
        endpoint_id: str,
        url: str,
    ) -> dict[str, Any]:
        ...

    def release_endpoint(self, endpoint_id: str) -> dict[str, Any]:
        ...

    def endpoint_cleanup_audit(self) -> dict[str, Any]:
        ...

    def binary_identity(self) -> dict[str, str]:
        ...

    def runtime_identity(self) -> dict[str, Any]:
        ...

    def stage_actor_file(
        self,
        actor: str,
        source: Path,
    ) -> str:
        ...

    def actor_file_sha256(
        self,
        actor: str,
        path: str,
    ) -> str:
        ...

    def clone_actor_storage(
        self,
        source_actor: str,
        target_actor: str,
        relative_path: str,
    ) -> None:
        ...

    def execute_adapter(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        ...

    def actor_cleanup_audit(self) -> dict[str, Any]:
        ...


@dataclass(frozen=True)
class NativeLaunchOptions:
    window_slot: int = 0
    window_count: int = 1
    restore_session: bool = False


@dataclass(frozen=True)
class TransportOverrideHandle:
    _token: str


@dataclass(frozen=True)
class _TransportOverride:
    client_id: str
    binding_role: str
    service_id: str
    endpoint: str
    endpoint_lease_id: str


class NativeDesktopRuntimeBinding(ABC):
    """Injects platform-owned Desktop launch and native-control behavior."""

    def __init__(self) -> None:
        self._generation_counters: dict[str, int] = {}
        self._proof_refs: list[dict[str, Any]] = []
        self._proof_records: list[BindingProofRecord] = []
        self._runtime_manifest: dict[str, Any] | None = None
        self._sessions_by_client: dict[str, TauriSession] = {}
        self._transport_overrides: dict[str, _TransportOverride] = {}

    def set_runtime_manifest(self, manifest: dict[str, Any]) -> None:
        if self._runtime_manifest is not None:
            raise DriverError("Runtime Binding manifest is already set")
        self._runtime_manifest = manifest

    def proof_refs(self) -> tuple[dict[str, Any], ...]:
        return tuple(self._proof_refs)

    def binding_proof_evidence(self) -> dict[str, Any]:
        if self._runtime_manifest is None:
            raise DriverError("Runtime Binding manifest is not set")
        validate_binding_proof_closure(
            self._runtime_manifest,
            allocated_generations=dict(self._generation_counters),
            proofs=tuple(self._proof_records),
        )
        return {
            "proofRefs": list(self._proof_refs),
            "allocatedGenerations": dict(self._generation_counters),
            "proofCount": len(self._proof_records),
        }

    def create_bound_session(
        self,
        client_id: str,
        launch_options: NativeLaunchOptions | None = None,
    ) -> TauriSession:
        if self._runtime_manifest is None:
            raise DriverError(
                "Runtime Binding requires a manifest before create_bound_session"
            )
        options = launch_options or NativeLaunchOptions()
        clients = self._runtime_manifest.get("clients") or []
        client_spec: dict[str, Any] = {}
        for raw_client in clients:
            if isinstance(raw_client, dict) and raw_client.get("id") == client_id:
                client_spec = raw_client
                break
        if not client_spec:
            raise DriverError(
                f"client {client_id!r} not found in runtime manifest"
            )
        required_roles = client_spec.get("required_service_roles")
        if not isinstance(required_roles, list):
            raise DriverError(
                f"client {client_id!r} has no required service roles"
            )
        station_service_id, station_service = require_runtime_client_service(
            self._runtime_manifest,
            client_id,
            "station",
        )
        station_url = str(station_service.get("endpoint") or "")
        if not station_url:
            raise DriverError(
                f"bound service {station_service_id!r} has no endpoint"
            )

        environment = {
            "PT_ACCEPTANCE_WINDOW_SLOT": str(options.window_slot),
            "PT_ACCEPTANCE_WINDOW_COUNT": str(options.window_count),
        }

        session = self._create_session(
            client_spec.get("actor") or client_id,
            client_spec,
            environment,
        )
        generation = self._generation_counters.get(client_id, 0) + 1
        self._generation_counters[client_id] = generation
        try:
            session.start()
            session.wait_for_acceptance_harness(30)
            self._configure_session_station(session, station_url)
            runtime_identity = self._client_runtime_identity(
                client_id,
                generation,
                session,
            )
            for binding_role in required_roles:
                observed_identity = self._observe_live_service_identity(
                    session,
                    client_id=client_id,
                    binding_role=str(binding_role),
                )
                proof, reference = persist_client_binding_observation(
                    self._runtime_manifest,
                    evidence_run_id=os.environ.get(
                        "PT_ACCEPTANCE_RUN_ID",
                        "",
                    ),
                    client_id=client_id,
                    binding_role=str(binding_role),
                    launch_generation=generation,
                    client_runtime_identity=runtime_identity,
                    observed_runtime_identity=observed_identity,
                    proof_mechanism="native-tauri-peer-id-check",
                    registered_mechanisms=frozenset(
                        {"native-tauri-peer-id-check"}
                    ),
                    verifier_id="core-client-binding",
                    verifier_source_digest=_file_sha256(
                        REPO_ROOT
                        / "tooling"
                        / "acceptance"
                        / "core"
                        / "provisioning.py"
                    ),
                )
                self._proof_records.append(proof)
                self._proof_refs.append(reference)
            self._sessions_by_client[client_id] = session
            return session
        except Exception:
            session.stop()
            raise

    def create_transport_override(
        self,
        client_id: str,
        binding_role: str,
        local_endpoint: str,
    ) -> TransportOverrideHandle:
        if self._runtime_manifest is None:
            raise DriverError("Runtime Binding manifest is not set")
        service_id, _ = require_runtime_client_service(
            self._runtime_manifest,
            client_id,
            binding_role,
        )
        endpoint, endpoint_lease_id = self._expose_transport_endpoint(
            local_endpoint
        )
        token = secrets.token_hex(32)
        self._transport_overrides[token] = _TransportOverride(
            client_id=client_id,
            binding_role=binding_role,
            service_id=service_id,
            endpoint=endpoint,
            endpoint_lease_id=endpoint_lease_id,
        )
        return TransportOverrideHandle(token)

    def apply_transport_override(
        self,
        client_id: str,
        binding_role: str,
        handle: TransportOverrideHandle,
    ) -> None:
        override = self._require_transport_override(
            client_id,
            binding_role,
            handle,
        )
        session = self._sessions_by_client.get(client_id)
        if session is None or not session.is_alive():
            raise self._transport_override_error(
                client_id,
                binding_role,
                "bound client session is not live",
            )
        self._configure_session_station(session, override.endpoint)

    def clear_transport_override(
        self,
        client_id: str,
        binding_role: str,
        handle: TransportOverrideHandle,
    ) -> None:
        override = self._require_transport_override(
            client_id,
            binding_role,
            handle,
        )
        if self._runtime_manifest is None:
            raise DriverError("Runtime Binding manifest is not set")
        _, service = require_runtime_client_service(
            self._runtime_manifest,
            client_id,
            binding_role,
        )
        session = self._sessions_by_client.get(client_id)
        if session is not None and session.is_alive():
            self._configure_session_station(
                session,
                str(service.get("endpoint") or ""),
            )
        self._transport_overrides.pop(handle._token, None)
        self._release_transport_endpoint(override.endpoint_lease_id)

    def _require_transport_override(
        self,
        client_id: str,
        binding_role: str,
        handle: TransportOverrideHandle,
    ) -> _TransportOverride:
        if not isinstance(handle, TransportOverrideHandle):
            raise self._transport_override_error(
                client_id,
                binding_role,
                "transport override handle has invalid type",
            )
        override = self._transport_overrides.get(handle._token)
        if override is None:
            raise self._transport_override_error(
                client_id,
                binding_role,
                "transport override handle is unknown or released",
            )
        if self._runtime_manifest is None:
            raise DriverError("Runtime Binding manifest is not set")
        service_id, _ = require_runtime_client_service(
            self._runtime_manifest,
            client_id,
            binding_role,
        )
        if (
            override.client_id != client_id
            or override.binding_role != binding_role
            or override.service_id != service_id
        ):
            raise self._transport_override_error(
                client_id,
                binding_role,
                "transport override scope does not match client binding",
            )
        return override

    @staticmethod
    def _transport_override_error(
        client_id: str,
        binding_role: str,
        detail: str,
    ) -> ClientBindingError:
        return ClientBindingError(
            code="TRANSPORT_OVERRIDE_MISMATCH",
            numeric_code=20107,
            stage="runtime",
            client_id=client_id,
            binding_role=binding_role,
            detail=detail,
            result="BLOCKED",
        )

    @staticmethod
    def _configure_session_station(
        session: TauriSession,
        station_url: str,
    ) -> None:
        if not station_url:
            raise DriverError("Runtime Binding Station endpoint is empty")
        with StationDriver(
            f"http://127.0.0.1:{session.gateway_port}"
        ) as station:
            station.station_add(station_url)
            station.station_set_active(station_url)

    def _observe_live_service_identity(
        self,
        session: TauriSession,
        *,
        client_id: str,
        binding_role: str,
    ) -> str:
        if self._runtime_manifest is None:
            raise DriverError("Runtime Binding manifest is not set")
        _, service = require_runtime_client_service(
            self._runtime_manifest,
            client_id,
            binding_role,
        )
        expected_url = str(service.get("endpoint") or "").rstrip("/")
        deadline = time.monotonic() + 30
        latest: Any = None
        while time.monotonic() < deadline:
            with StationDriver(
                f"http://127.0.0.1:{session.gateway_port}"
            ) as station:
                latest = station.station_list()
            status = latest.get("status") if isinstance(latest, dict) else None
            try:
                state = json.loads(status) if isinstance(status, str) else {}
            except json.JSONDecodeError:
                state = {}
            active_url = str(state.get("active_url") or "").rstrip("/")
            entries = state.get("entries")
            if active_url == expected_url and isinstance(entries, list):
                for entry in entries:
                    if (
                        isinstance(entry, dict)
                        and str(entry.get("url") or "").rstrip("/")
                        == expected_url
                        and entry.get("online") is True
                    ):
                        peer_id = str(
                            entry.get("peer_id")
                            or entry.get("peerId")
                            or ""
                        )
                        if peer_id:
                            return peer_id
            time.sleep(0.1)
        raise ClientBindingError(
            code="BINDING_PROOF_ABSENT",
            numeric_code=20201,
            stage="post-launch",
            client_id=client_id,
            binding_role=binding_role,
            detail=(
                "running client did not expose a live bound Station identity; "
                f"last station_list={latest!r}"
            ),
            result="UNPROVEN",
        )

    def _client_runtime_identity(
        self,
        client_id: str,
        generation: int,
        session: TauriSession,
    ) -> ClientRuntimeIdentity:
        payload = {
            "cellId": self.cell_id,
            "clientId": client_id,
            "launchGeneration": generation,
            "processId": session.process_id,
            "webdriverPort": session.port,
            "gatewayPort": session.gateway_port,
            "profile": session.profile,
            "storageRoot": session.storage_root,
        }
        digest = hashlib.sha256(
            json.dumps(
                payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return ClientRuntimeIdentity(
            runtime="native-tauri",
            instance_id=f"{client_id}-generation-{generation}",
            identity_digest=digest,
        )

    @property
    @abstractmethod
    def cell_id(self) -> str:
        ...

    @property
    @abstractmethod
    def native_adapter(self) -> NativeDesktopAdapter:
        ...

    @abstractmethod
    def _create_session(
        self,
        client_role: str,
        client_spec: Mapping[str, Any],
        environment: Mapping[str, str],
    ) -> TauriSession:
        ...

    @abstractmethod
    def _expose_transport_endpoint(self, url: str) -> tuple[str, str]:
        ...

    @abstractmethod
    def _release_transport_endpoint(self, endpoint_lease_id: str) -> None:
        ...

    @abstractmethod
    def stage_native_file(
        self,
        actor: str,
        source: Path,
    ) -> Path:
        ...

    @abstractmethod
    def native_file_sha256(
        self,
        actor: str,
        path: Path,
    ) -> str:
        ...

    @abstractmethod
    def clone_actor_storage(
        self,
        source_actor: str,
        source_spec: Mapping[str, Any],
        target_actor: str,
        target_spec: Mapping[str, Any],
        relative_path: str,
    ) -> None:
        ...

    @abstractmethod
    def request_cooperative_activation(
        self,
        target: TauriSession,
        sessions: Sequence[TauriSession],
    ) -> bool:
        ...

    @abstractmethod
    def binary_identity(self) -> dict[str, str]:
        ...

    @abstractmethod
    def runtime_identity(self) -> dict[str, Any]:
        ...

    @abstractmethod
    def finalize_cleanup(
        self,
        sessions: Sequence[TauriSession],
        client_specs: Mapping[str, Mapping[str, Any]],
    ) -> dict[str, Any]:
        ...


class RemoteNativeDesktopAdapter(NativeDesktopAdapter):
    def __init__(
        self,
        cell: RemoteNativeRuntimeCellLifecycle,
        platform: str,
    ) -> None:
        self._cell = cell
        self._platform = platform

    @property
    def platform(self) -> str:
        return self._platform

    def activate_process(self, process_id: int) -> None:
        self._execute("activate_process", {"processId": process_id})

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self._execute(
            "post_mouse",
            {
                "actions": [action.value for action in actions],
                "point": list(point),
            },
        )

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        self._execute(
            "post_key",
            {
                "key": key.value,
                "modifiers": [modifier.value for modifier in modifiers],
                "text": text,
                "privateSource": private_source,
            },
        )

    def reveal_file_chooser_location(self) -> None:
        self._execute("reveal_file_chooser_location", {})

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        payload = self._execute(
            "focused_control",
            {"processId": process_id},
        )
        return NativeControlSnapshot(
            kind=str(payload.get("kind") or "unknown"),
            title=str(payload.get("title") or ""),
            value=str(payload.get("value") or ""),
            window_count=int(payload.get("windowCount") or 0),
            dialog_count=int(payload.get("dialogCount") or 0),
            frontmost=bool(payload.get("frontmost")),
            main_window=bool(payload.get("mainWindow")),
            focused_window=bool(payload.get("focusedWindow")),
            actual_frontmost_pid=int(
                payload.get("actualFrontmostPid") or -1
            ),
            platform_role=str(payload.get("platformRole") or ""),
            platform_subrole=str(payload.get("platformSubrole") or ""),
            error=str(payload.get("error") or ""),
        )

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        payload = self._execute(
            "window_stack_at_point",
            {"point": list(point)},
        )
        windows = payload.get("windows")
        if not isinstance(windows, list):
            windows = []
        return NativeWindowStack(
            windows=tuple(
                NativeWindowSnapshot(
                    index=int(window.get("index") or 0),
                    owner_pid=int(window.get("ownerPid") or -1),
                    owner_name=str(window.get("ownerName") or ""),
                    window_name=str(window.get("windowName") or ""),
                    layer=int(window.get("layer") or 0),
                    alpha=float(window.get("alpha") or 0),
                    bounds=NativeWindowBounds(
                        left=float(
                            (window.get("bounds") or {}).get("left") or 0
                        ),
                        top=float(
                            (window.get("bounds") or {}).get("top") or 0
                        ),
                        width=float(
                            (window.get("bounds") or {}).get("width") or 0
                        ),
                        height=float(
                            (window.get("bounds") or {}).get("height") or 0
                        ),
                    ),
                )
                for window in windows
                if isinstance(window, dict)
                and isinstance(window.get("bounds"), dict)
            ),
            error=str(payload.get("error") or ""),
        )

    def content_origin(
        self,
        process_id: int,
    ) -> tuple[float, float]:
        payload = self._execute(
            "content_origin",
            {"processId": process_id},
        )
        return float(payload["x"]), float(payload["y"])

    def mouse_button_down(self) -> bool:
        return bool(self._execute("mouse_button_down", {}).get("down"))

    def capture_screenshot(self, path: Path) -> None:
        content = self._content("capture_screenshot", {})
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        if not content:
            raise DriverError(
                f"remote {self._platform} Native screenshot returned empty content"
            )

    def read_clipboard(self) -> bytes:
        return self._content("read_clipboard", {})

    def write_clipboard(self, value: bytes) -> None:
        self._execute(
            "write_clipboard",
            {"content": base64.b64encode(value).decode("ascii")},
        )

    def _content(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> bytes:
        encoded = self._execute(operation, payload).get("content")
        if not isinstance(encoded, str):
            raise DriverError(
                f"remote {self._platform} Native {operation} omitted content"
            )
        try:
            return base64.b64decode(encoded, validate=True)
        except ValueError as error:
            raise DriverError(
                f"remote {self._platform} Native {operation} returned invalid content"
            ) from error

    def _execute(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            return self._cell.execute_adapter(operation, payload)
        except DriverError:
            raise
        except Exception as error:
            raise DriverError(
                f"remote {self._platform} Native {operation} failed: {error}"
            ) from error


class RemoteNativeDesktopRuntimeBinding(NativeDesktopRuntimeBinding):
    def __init__(
        self,
        cell_id: str,
        adapter_platform: str,
        gate_id: str,
        source_commit: str,
        cell: RemoteNativeRuntimeCellLifecycle | None = None,
    ) -> None:
        super().__init__()
        if cell is None:
            from tooling.acceptance.provisioners import (
                get_runtime_cell_lifecycle,
            )

            cell = cast(
                RemoteNativeRuntimeCellLifecycle,
                get_runtime_cell_lifecycle(cell_id),
            )
        cell.validate_binding(gate_id, source_commit)
        self._cell_id = cell_id
        self._adapter_platform = adapter_platform
        self._cell = cell
        self._native_adapter = RemoteNativeDesktopAdapter(
            cell,
            adapter_platform,
        )
        self._endpoint_ids: list[str] = []

    @property
    def cell_id(self) -> str:
        return self._cell_id

    @property
    def native_adapter(self) -> NativeDesktopAdapter:
        return self._native_adapter

    def _create_session(
        self,
        client_role: str,
        client_spec: Mapping[str, Any],
        environment: Mapping[str, str],
    ) -> TauriSession:
        launcher = self._cell.launch_actor(
            client_role,
            dict(client_spec),
            dict(environment),
        )
        return TauriSession(launcher)

    def _expose_transport_endpoint(self, url: str) -> tuple[str, str]:
        endpoint_id = f"orchestrator-endpoint-{len(self._endpoint_ids) + 1}"
        exposed = self._cell.expose_orchestrator_endpoint(endpoint_id, url)
        exposed_id = str(exposed.get("endpointId") or "")
        exposed_url = str(exposed.get("url") or "")
        if exposed_id != endpoint_id or not exposed_url:
            raise DriverError(
                f"{self.cell_id} returned an invalid endpoint lease"
            )
        self._endpoint_ids.append(endpoint_id)
        return exposed_url, endpoint_id

    def _release_transport_endpoint(self, endpoint_lease_id: str) -> None:
        self._cell.release_endpoint(endpoint_lease_id)
        if endpoint_lease_id in self._endpoint_ids:
            self._endpoint_ids.remove(endpoint_lease_id)

    def stage_native_file(
        self,
        actor: str,
        source: Path,
    ) -> Path:
        staged = self._cell.stage_actor_file(actor, source)
        path = Path(staged)
        is_absolute = (
            PureWindowsPath(staged).is_absolute()
            if self._adapter_platform == "win32"
            else path.is_absolute()
        )
        if not is_absolute:
            raise DriverError(
                f"{self.cell_id} returned a relative staged file path"
            )
        return path

    def native_file_sha256(
        self,
        actor: str,
        path: Path,
    ) -> str:
        return self._cell.actor_file_sha256(actor, str(path))

    def clone_actor_storage(
        self,
        source_actor: str,
        source_spec: Mapping[str, Any],
        target_actor: str,
        target_spec: Mapping[str, Any],
        relative_path: str,
    ) -> None:
        del source_spec, target_spec
        self._cell.clone_actor_storage(
            source_actor,
            target_actor,
            relative_path,
        )

    def request_cooperative_activation(
        self,
        target: TauriSession,
        sessions: Sequence[TauriSession],
    ) -> bool:
        del target, sessions
        return False

    def binary_identity(self) -> dict[str, str]:
        return self._cell.binary_identity()

    def runtime_identity(self) -> dict[str, Any]:
        return self._cell.runtime_identity()

    def finalize_cleanup(
        self,
        sessions: Sequence[TauriSession],
        client_specs: Mapping[str, Mapping[str, Any]],
    ) -> dict[str, Any]:
        del client_specs
        self._transport_overrides.clear()
        self._sessions_by_client.clear()
        endpoint_releases: list[dict[str, Any]] = []
        endpoint_errors: list[dict[str, str]] = []
        for endpoint_id in reversed(self._endpoint_ids):
            try:
                endpoint_releases.append(
                    self._cell.release_endpoint(endpoint_id)
                )
            except Exception as error:
                endpoint_errors.append(
                    {
                        "resource": f"endpoint:{endpoint_id}",
                        "error": str(error),
                    }
                )
        if not endpoint_errors:
            self._endpoint_ids.clear()
        audit = self._cell.actor_cleanup_audit()
        endpoint_audit = self._cell.endpoint_cleanup_audit()
        log_paths = tuple(
            session.log_path
            for session in sessions
            if session.log_path is not None
        )
        cleanup_errors = _remove_paths(log_paths)
        return {
            **audit,
            **endpoint_audit,
            "endpointReleases": endpoint_releases,
            "storageRoots": [
                session.storage_root
                for session in sessions
            ],
            "logs": [str(path) for path in log_paths],
            "logsReleased": (
                not cleanup_errors
                and all(not path.exists() for path in log_paths)
            ),
            "cleanupErrors": [*endpoint_errors, *cleanup_errors],
        }


class LinuxNativeDesktopRuntimeBinding(RemoteNativeDesktopRuntimeBinding):
    def __init__(
        self,
        gate_id: str,
        source_commit: str,
        cell: RemoteNativeRuntimeCellLifecycle | None = None,
    ) -> None:
        super().__init__(
            "desktop-linux-native",
            "linux",
            gate_id,
            source_commit,
            cell,
        )


class WindowsNativeDesktopRuntimeBinding(RemoteNativeDesktopRuntimeBinding):
    def __init__(
        self,
        gate_id: str,
        source_commit: str,
        cell: RemoteNativeRuntimeCellLifecycle | None = None,
    ) -> None:
        super().__init__(
            "desktop-windows-native",
            "win32",
            gate_id,
            source_commit,
            cell,
        )


class LocalMacOSRuntimeBinding(NativeDesktopRuntimeBinding):
    def __init__(self) -> None:
        super().__init__()
        if sys.platform != "darwin":
            raise DriverError(
                "desktop-macos-native requires a macOS orchestrator"
            )
        from tooling.acceptance.drivers.native.macos import (
            MacOSNativeDesktopAdapter,
        )

        self._binary = Path(find_app_binary()).resolve()
        self._native_adapter = MacOSNativeDesktopAdapter()

    @property
    def cell_id(self) -> str:
        return "desktop-macos-native"

    @property
    def native_adapter(self) -> NativeDesktopAdapter:
        return self._native_adapter

    def _create_session(
        self,
        client_role: str,
        client_spec: Mapping[str, Any],
        environment: Mapping[str, str],
    ) -> TauriSession:
        del client_role
        return TauriSession(
            LocalTauriLauncher(
                app_binary=str(self._binary),
                port=int(client_spec["webdriver_port"]),
                gateway_port=int(client_spec["gateway_port"]),
                profile=str(client_spec["profile"]),
                storage_root=str(client_spec["storage_root"]),
                environment=environment,
            )
        )

    def _expose_transport_endpoint(self, url: str) -> tuple[str, str]:
        return url, f"local-direct-{secrets.token_hex(8)}"

    def _release_transport_endpoint(self, endpoint_lease_id: str) -> None:
        del endpoint_lease_id

    def stage_native_file(
        self,
        actor: str,
        source: Path,
    ) -> Path:
        del actor
        resolved = source.expanduser().resolve()
        if not resolved.is_file():
            raise DriverError(
                f"Native file selection source is missing: {resolved}"
            )
        return resolved

    def native_file_sha256(
        self,
        actor: str,
        path: Path,
    ) -> str:
        del actor
        resolved = path.expanduser().resolve()
        if not resolved.is_file():
            raise DriverError(f"Native file is missing: {resolved}")
        return _file_sha256(resolved)

    def clone_actor_storage(
        self,
        source_actor: str,
        source_spec: Mapping[str, Any],
        target_actor: str,
        target_spec: Mapping[str, Any],
        relative_path: str,
    ) -> None:
        del source_actor, target_actor
        relative = Path(relative_path)
        if (
            not relative_path
            or relative.is_absolute()
            or ".." in relative.parts
        ):
            raise DriverError("Native actor storage path must be relative")
        source_root = Path(str(source_spec["storage_root"]))
        target_root = Path(str(target_spec["storage_root"]))
        source = source_root / relative
        if not source.is_dir():
            raise DriverError(
                f"Native actor storage source is missing: {source}"
            )
        if target_root.exists():
            raise DriverError(
                f"Native actor storage target already exists: {target_root}"
            )
        temporary_root = target_root.with_name(
            f".{target_root.name}.clone-{os.getpid()}-{time.time_ns()}"
        )
        temporary = temporary_root / relative
        try:
            temporary.parent.mkdir(parents=True, exist_ok=False)
            shutil.copytree(source, temporary)
            os.replace(temporary_root, target_root)
        except Exception as error:
            try:
                shutil.rmtree(temporary_root)
            except FileNotFoundError:
                pass
            except OSError as cleanup_error:
                raise DriverError(
                    "Native actor storage clone failed and temporary "
                    f"cleanup failed: {cleanup_error}"
                ) from error
            raise DriverError("Native actor storage clone failed") from error

    def request_cooperative_activation(
        self,
        target: TauriSession,
        sessions: Sequence[TauriSession],
    ) -> bool:
        if target.process_id is None:
            raise DriverError(
                "Native activation target process is unavailable"
            )
        source = next(
            (
                session
                for session in sessions
                if session.process_id not in (None, target.process_id)
                and bool(
                    session.driver.execute_script(
                        "return document.hasFocus()"
                    )
                )
            ),
            None,
        )
        if source is None:
            return False
        _invoke_tauri_activation_command(
            source,
            "acceptance_yield_activation",
            {"targetPid": target.process_id},
        )
        _invoke_tauri_activation_command(
            target,
            "acceptance_request_activation",
            {},
        )
        return True

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": str(self._binary),
            "sha256": _file_sha256(self._binary),
            "sourceCommit": subprocess.run(
                ("git", "rev-parse", "HEAD"),
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip(),
        }

    def runtime_identity(self) -> dict[str, Any]:
        from tooling.acceptance.core.evidence_store import (
            source_identity,
        )

        source = source_identity(REPO_ROOT)
        binary = self.binary_identity()
        return {
            "artifactKind": "acceptance-runtime-cell-manifest",
            "cellId": self.cell_id,
            "gateId": os.environ.get("PT_ACCEPTANCE_GATE_ID", ""),
            "runId": os.environ.get("PT_ACCEPTANCE_RUN_ID", ""),
            "state": "LEASED",
            "platform": {
                "os": "macos",
                "isolationKind": "local-process",
            },
            "source": {
                **source,
                "remoteSourceDigest": source["workspaceDigest"],
                "remoteCheckoutClean": (
                    source["workspaceDigest"] == "clean"
                ),
                "binarySha256": binary["sha256"],
            },
        }

    def finalize_cleanup(
        self,
        sessions: Sequence[TauriSession],
        client_specs: Mapping[str, Mapping[str, Any]],
    ) -> dict[str, Any]:
        self._transport_overrides.clear()
        self._sessions_by_client.clear()
        ports = sorted(
            {
                int(spec[field])
                for spec in client_specs.values()
                for field in (
                    "webdriver_port",
                    "gateway_port",
                    "renderer_port",
                )
            }
        )
        process_ids = sorted(
            {
                int(session.process_id)
                for session in sessions
                if session.process_id
            }
        )
        storage_roots = sorted(
            {
                Path(str(spec["storage_root"]))
                for spec in client_specs.values()
            }
        )
        log_paths = tuple(
            session.log_path
            for session in sessions
            if session.log_path is not None
        )
        storage_errors = _remove_paths(storage_roots)
        log_errors = _remove_paths(log_paths)
        return {
            "ports": ports,
            "pids": process_ids,
            "storageRoots": [str(path) for path in storage_roots],
            "storageErrors": storage_errors,
            "cleanupErrors": [*storage_errors, *log_errors],
            "logs": [str(path) for path in log_paths],
            "portsReleased": _wait_for(
                lambda: all(_port_is_free(port) for port in ports),
                timeout=30,
            ),
            "processesReleased": _wait_for(
                lambda: all(_pid_is_stopped(pid) for pid in process_ids),
                timeout=30,
            ),
            "storageReleased": (
                not storage_errors
                and all(not path.exists() for path in storage_roots)
            ),
            "logsReleased": (
                not log_errors
                and all(not path.exists() for path in log_paths)
            ),
        }


def _remove_paths(paths: Sequence[Path]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    for path in paths:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        except OSError as error:
            errors.append({"path": str(path), "error": str(error)})
    return errors


def _invoke_tauri_activation_command(
    session: TauriSession,
    command: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    request_id = f"native-activation-{time.monotonic_ns()}"
    session.driver.execute_script(
        """
        const [command, commandArguments, requestId] = arguments;
        const requests = window.__PT_NATIVE_ACTIVATION_REQUESTS__ ||= {};
        requests[requestId] = { done: false };
        window.__TAURI_INTERNALS__.invoke(
          command,
          commandArguments,
        ).then((result) => {
          requests[requestId] = { done: true, result };
        }).catch((error) => {
          requests[requestId] = {
            done: true,
            result: {
              ok: false,
              error: { message: String(error) },
            },
          };
        });
        """,
        command,
        arguments,
        request_id,
    )
    result: Any = None
    deadline = time.monotonic() + 5
    try:
        while time.monotonic() < deadline:
            result = session.driver.execute_script(
                """
                const request = window.__PT_NATIVE_ACTIVATION_REQUESTS__
                  ?.[arguments[0]];
                return request?.done ? request.result : null;
                """,
                request_id,
            )
            if result is not None:
                break
            time.sleep(0.01)
    finally:
        session.driver.execute_script(
            """
            if (window.__PT_NATIVE_ACTIVATION_REQUESTS__) {
              delete window.__PT_NATIVE_ACTIVATION_REQUESTS__[arguments[0]];
            }
            """,
            request_id,
        )
    if not isinstance(result, dict) or not result.get("ok"):
        raise DriverError(
            f"Native actor {command} failed: "
            f"{result!r}"
        )
    return result


def _wait_for(predicate: Any, *, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return bool(predicate())


def _port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def _pid_is_stopped(pid: int) -> bool:
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def resolve_native_desktop_runtime(
    cell_id: str,
    *,
    gate_id: str,
    source_commit: str,
) -> NativeDesktopRuntimeBinding:
    if cell_id == "desktop-macos-native":
        return LocalMacOSRuntimeBinding()
    if cell_id == "desktop-linux-native":
        return LinuxNativeDesktopRuntimeBinding(
            gate_id,
            source_commit,
        )
    if cell_id == "desktop-windows-native":
        return WindowsNativeDesktopRuntimeBinding(
            gate_id,
            source_commit,
        )
    raise DriverError(f"unknown Native Desktop runtime cell {cell_id!r}")
