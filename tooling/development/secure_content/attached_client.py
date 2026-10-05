from __future__ import annotations

import hmac
import json
import os
import time
import warnings
from pathlib import Path
from typing import Any, Mapping

from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.remote.webdriver import WebDriver

from tooling.acceptance.core.harness import call_async_harness, harness_ready
from tooling.acceptance.core.redaction import redact_text
from tooling.development.secure_content import runtime_manifest
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
)


def reconcile_private_moment_publish(
    client: AttachedProductClient,
    method: str,
    *,
    label: str,
    max_attempts: int = 3,
    retry_delay_seconds: float = 0.25,
) -> Mapping[str, Any]:
    if max_attempts < 1:
        raise RunnerError(f"{label} retry budget is invalid")
    for attempt in range(1, max_attempts + 1):
        result = client.call(method)
        if not isinstance(result, Mapping):
            raise RunnerError(f"{label} result is invalid")
        if result.get("state") != "UNKNOWN_COMMIT":
            return result
        if attempt < max_attempts:
            time.sleep(
                min(
                    retry_delay_seconds,
                    client.context.remaining_seconds(),
                )
            )
    raise RunnerError(
        f"{label} remained UNKNOWN_COMMIT after {max_attempts} attempts"
    )


class _AttachedRemoteWebDriver(webdriver.Remote):
    def __init__(
        self,
        *,
        command_executor: str,
        session_id: str,
    ) -> None:
        self._attached_session_id = session_id
        super().__init__(
            command_executor=command_executor,
            options=ArgOptions(),
        )

    def start_session(self, capabilities: Mapping[str, Any]) -> None:
        del capabilities
        self.session_id = self._attached_session_id
        self.caps = {}

    def detach(self) -> None:
        try:
            close = getattr(self.command_executor, "close", None)
            if callable(close):
                close()
        finally:
            self.session_id = None

    def quit(self) -> None:
        self.detach()


class AttachedProductClient:
    def __init__(
        self,
        context: ScenarioContext,
        client_id: str,
        *,
        namespace: str = "moments",
    ) -> None:
        manifest = context.require_runtime_manifest()
        self.context = context
        self.client_id = client_id
        self.client = manifest.client(client_id)
        self.namespace = namespace
        self._driver: _AttachedRemoteWebDriver | None = None

    @property
    def actor(self) -> str:
        value = self.client.get("actor_role")
        if not isinstance(value, str) or not value:
            raise RunnerError(
                f"runtime manifest client {self.client_id!r} actor is missing"
            )
        return value

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            raise RunnerError(f"runtime client {self.client_id!r} is not attached")
        return self._driver

    def connect(self) -> "AttachedProductClient":
        if self._driver is not None:
            return self
        attachment = self.client["automation_attachment_ref"]
        command_executor = str(attachment["endpoint"])
        session_id = str(attachment["session_id"])
        timeout = min(30.0, self.context.remaining_seconds())
        try:
            self._driver = _AttachedRemoteWebDriver(
                command_executor=command_executor,
                session_id=session_id,
            )
            if self._driver.session_id != session_id:
                raise RunnerError(
                    f"runtime client {self.client_id!r} attached the wrong "
                    "WebDriver session"
                )
            self._driver.set_script_timeout(timeout)
            self._driver.set_page_load_timeout(timeout)
            runtime_kind = self.client["runtime_kind"]
            if runtime_kind in {
                "native-tauri",
                "tauri-ios-simulator",
                "tauri-android-emulator",
            }:
                state = self._driver.execute_script(
                    """
                    return {
                      hasRoot: Boolean(document.querySelector('#root')),
                      hasTauri: typeof window.__TAURI_INTERNALS__ === 'object'
                               || typeof window.__TAURI__ === 'object',
                    };
                    """
                )
                if (
                    not isinstance(state, dict)
                    or state.get("hasRoot") is not True
                    or state.get("hasTauri") is not True
                ):
                    raise RunnerError(
                        f"runtime client {self.client_id!r} is not a ready "
                        "Native Tauri renderer"
                    )
            else:
                raise RunnerError(
                    f"runtime {self.context.runtime!r} cannot attach a product client"
                )
            if not harness_ready(self.driver, self.namespace, timeout=timeout):
                raise RunnerError(
                    f"runtime client {self.client_id!r} did not expose "
                    f"{self.namespace!r} acceptance harness"
                )
            if self._driver.session_id != session_id:
                raise RunnerError(
                    f"runtime client {self.client_id!r} WebDriver session changed "
                    "during attachment"
                )
            self.snapshot()
        except Exception:
            self.close()
            raise
        if self._driver is None:
            raise RunnerError(
                f"runtime client {self.client_id!r} did not attach"
            )
        return self

    def close(self) -> None:
        if self._driver is not None:
            try:
                self._driver.detach()
            except Exception as error:
                warnings.warn(
                    redact_text(f"failed to detach WebDriver transport: {error}"),
                    RuntimeWarning,
                )
            self._driver = None

    def call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        if method == "snapshot":
            return self._raw_call(method, payload)
        self.snapshot()
        try:
            return self._raw_call(method, payload)
        finally:
            self.snapshot()

    def _raw_call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        return call_async_harness(
            self.driver,
            method,
            dict(payload or {}),
            namespace=self.namespace,
            script_timeout=min(45.0, self.context.remaining_seconds()),
        )

    def snapshot(self) -> Mapping[str, Any]:
        value = self._raw_call("snapshot")
        if not isinstance(value, Mapping):
            raise RunnerError(
                f"runtime client {self.client_id!r} returned an invalid snapshot"
            )
        attachment = self.client.get("automation_attachment_ref")
        expected_webdriver_session_id = (
            attachment.get("session_id")
            if isinstance(attachment, Mapping)
            else None
        )
        live_webdriver_session_id = getattr(self.driver, "session_id", None)
        if (
            not isinstance(expected_webdriver_session_id, str)
            or not isinstance(live_webdriver_session_id, str)
            or not hmac.compare_digest(
                live_webdriver_session_id,
                expected_webdriver_session_id,
            )
        ):
            raise RunnerError(
                f"runtime client {self.client_id!r} WebDriver session does not "
                "match the runtime manifest"
            )
        try:
            runtime_manifest.validate_harness_snapshot(
                self.context.require_runtime_manifest(),
                self.client_id,
                value,
                automation_session_id=live_webdriver_session_id,
            )
        except runtime_manifest.RuntimeManifestError as error:
            raise RunnerError(str(error)) from error
        return value

    def reload_renderer(self) -> None:
        self.snapshot()
        self.driver.refresh()
        timeout = min(30.0, self.context.remaining_seconds())
        if not harness_ready(self.driver, self.namespace, timeout=timeout):
            raise RunnerError(
                f"runtime client {self.client_id!r} did not restore "
                f"{self.namespace!r} harness after renderer reload"
            )
        self.snapshot()

    def __enter__(self) -> "AttachedProductClient":
        return self.connect()

    def __exit__(self, *_: object) -> None:
        self.close()


def write_attached_runtime_manifest(
    *,
    manifest_payload: Mapping[str, Any],
    output_path: Path,
    journey_id: str,
    sessions_by_client: Mapping[str, Any],
    automation_refs_by_client: Mapping[str, Mapping[str, Any]],
    repo_root: Path,
    namespace: str = "moments",
    timeout: float = 30.0,
) -> Path:
    target_path = _external_manifest_path(
        output_path,
        repo_root=repo_root,
        must_exist=False,
        label="runtime manifest",
    )
    if not journey_id or journey_id != journey_id.strip():
        raise RunnerError("runtime manifest journey ID is invalid")
    if namespace != "moments":
        raise RunnerError("runtime manifest namespace must be moments")
    if timeout <= 0:
        raise RunnerError("runtime manifest timeout must be positive")
    if "manifest_digest" in manifest_payload:
        raise RunnerError(
            "runtime owner must provide an unpublished manifest payload"
        )
    payload = json.loads(json.dumps(manifest_payload))
    if payload.get("journey_id") != journey_id:
        raise RunnerError("runtime manifest journey_id is invalid")
    clients = payload.get("clients")
    if not isinstance(clients, list) or any(
        not isinstance(client, dict) for client in clients
    ):
        raise RunnerError("runtime manifest clients are invalid")
    client_ids = tuple(str(client.get("id") or "") for client in clients)
    if (
        not client_ids
        or any(not client_id for client_id in client_ids)
        or len(set(client_ids)) != len(client_ids)
        or set(sessions_by_client) != set(client_ids)
        or set(automation_refs_by_client) != set(client_ids)
    ):
        raise RunnerError(
            "runtime sessions and attachment refs must exactly match manifest clients"
        )

    attached_clients: list[dict[str, Any]] = []
    session_ids: set[str] = set()
    for client in clients:
        client_id = str(client["id"])
        session = sessions_by_client[client_id]
        driver = _raw_webdriver(session)
        attachment = dict(automation_refs_by_client[client_id])
        session_id = getattr(driver, "session_id", None)
        if (
            not isinstance(session_id, str)
            or not session_id.strip()
            or session_id != session_id.strip()
            or session_id in session_ids
        ):
            raise RunnerError(
                f"runtime owner supplied an invalid or duplicate WebDriver "
                f"session for {client_id!r}"
            )
        if attachment.get("session_id") != session_id:
            raise RunnerError(
                f"runtime client {client_id!r} attachment does not bind "
                "the owner session"
            )
        if not harness_ready(driver, namespace, timeout=timeout):
            raise RunnerError(
                f"runtime client {client_id!r} did not expose "
                f"{namespace!r} acceptance harness"
            )
        snapshot = call_async_harness(
            driver,
            "snapshot",
            {},
            namespace=namespace,
            script_timeout=timeout,
        )
        if not isinstance(snapshot, Mapping):
            raise RunnerError(
                f"runtime client {client_id!r} returned an invalid harness snapshot"
            )
        if getattr(driver, "session_id", None) != session_id:
            raise RunnerError(
                f"runtime client {client_id!r} WebDriver session changed "
                "during attachment capture"
            )
        expected_platform = {
            "native-tauri": "native",
            "tauri-ios-simulator": "mobile",
            "tauri-android-emulator": "mobile",
        }.get(client.get("runtime_kind"))
        if snapshot.get("platform") != expected_platform:
            raise RunnerError(
                f"runtime client {client_id!r} live platform does not match "
                "the source runtime manifest"
            )
        attached_client = dict(client)
        attached_client["automation_attachment_ref"] = attachment
        source = payload.get("source")
        services = payload.get("services")
        bindings = client.get("service_bindings")
        station_binding = (
            bindings.get("station")
            if isinstance(bindings, Mapping)
            else None
        )
        station = (
            services.get(station_binding.get("service_id"))
            if isinstance(services, Mapping)
            and isinstance(station_binding, Mapping)
            else None
        )
        if not isinstance(source, Mapping) or not isinstance(station, Mapping):
            raise RunnerError(
                f"runtime client {client_id!r} Station identity is invalid"
            )
        try:
            attached_client["harness_identity_digest"] = (
                runtime_manifest.harness_identity_digest(
                    snapshot,
                    client=attached_client,
                    source_commit=str(source.get("commit") or ""),
                    station=station,
                    automation_session_id=session_id,
                )
            )
        except runtime_manifest.RuntimeManifestError as error:
            raise RunnerError(str(error)) from error
        attached_clients.append(attached_client)
        session_ids.add(session_id)

    payload["clients"] = attached_clients
    finalized = runtime_manifest.with_manifest_digest(payload)
    source = finalized.get("source")
    services = finalized.get("services")
    if not isinstance(source, Mapping) or not isinstance(services, Mapping):
        raise RunnerError("runtime manifest source or services are invalid")
    identity = {
        "workspaceId": source.get("workspace_id"),
        "head": source.get("commit"),
        "worktreeSetDigest": source.get("worktree_set_digest"),
    }
    profiles = tuple(
        sorted(
            {
                str(service.get("profile_id"))
                for service in services.values()
                if isinstance(service, Mapping)
            }
        )
    )
    encoded = (
        json.dumps(finalized, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
    )
    try:
        runtime_manifest.validate_runtime_manifest(
            finalized,
            path=target_path,
            raw_bytes=encoded,
            journey_id=journey_id,
            repo_root=repo_root,
            workspace_identity=identity,
            profile_selectors=profiles,
            client_selectors=client_ids,
            runtime=None,
        )
    except runtime_manifest.RuntimeManifestError as error:
        raise RunnerError(str(error)) from error
    _write_private_immutable_json(target_path, finalized)
    return target_path


def _raw_webdriver(session: Any) -> Any:
    driver = getattr(session, "driver", session)
    if driver is session and not hasattr(driver, "execute_async_script"):
        raise RunnerError("runtime owner supplied an invalid WebDriver session")
    return driver


def _external_manifest_path(
    path: Path,
    *,
    repo_root: Path,
    must_exist: bool,
    label: str,
) -> Path:
    if not path.is_absolute() or path.is_symlink():
        raise RunnerError(f"{label} path must be absolute and non-symlinked")
    try:
        resolved = path.resolve(strict=must_exist)
        repository = repo_root.resolve(strict=True)
    except OSError as error:
        raise RunnerError(f"{label} path cannot be resolved: {error}") from error
    if resolved == repository or repository in resolved.parents:
        raise RunnerError(f"{label} must be outside the repository")
    if must_exist and not resolved.is_file():
        raise RunnerError(f"{label} path must name a file")
    if not must_exist and resolved.exists():
        raise RunnerError(f"{label} already exists")
    return resolved


def _write_private_immutable_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (
        json.dumps(dict(payload), indent=2, sort_keys=True).encode("utf-8") + b"\n"
    )
    descriptor: int | None = None
    created = False
    try:
        descriptor = os.open(
            path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
        created = True
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        if created:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                pass
        raise RunnerError(f"write attached runtime manifest: {error}") from error
