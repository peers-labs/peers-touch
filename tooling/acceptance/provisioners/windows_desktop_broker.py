"""Interactive Windows Desktop process broker for remote Acceptance cells.

The SSH service session cannot own visible windows. This broker uses Task
Scheduler's InteractiveToken logon type to execute actor and adapter workers in
the already logged-on desktop session. All durable state is run-scoped and has
an independent TTL cleanup task so an orchestrator disconnect cannot leak GUI
processes or actor storage.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Any, Callable, Mapping, Sequence


_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_TASK_PREFIX = "PeersTouch-Acceptance"
_WAIT_INTERVAL_SECONDS = 0.1


class BrokerError(RuntimeError):
    """A fail-closed Windows broker lifecycle error."""


@dataclass(frozen=True)
class ScheduledTask:
    name: str
    executable: str
    arguments: tuple[str, ...]
    user_id: str


Runner = Callable[..., subprocess.CompletedProcess[str]]


def _canonical_id(value: object, name: str) -> str:
    normalized = str(value or "").strip()
    if not _IDENTIFIER.fullmatch(normalized):
        raise BrokerError(f"{name} is missing or invalid")
    return normalized


def _windows_path(value: object, name: str) -> str:
    normalized = str(value or "").replace("\\", "/").strip()
    path = PureWindowsPath(normalized)
    if (
        not path.is_absolute()
        or normalized.startswith(("//", "\\\\"))
        or any(part in {"", ".", ".."} for part in path.parts[1:])
    ):
        raise BrokerError(f"{name} must be a drive-absolute Windows path")
    return str(path)


def _port(value: object, name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise BrokerError(f"{name} is invalid") from error
    if parsed < 1024 or parsed > 65535:
        raise BrokerError(f"{name} must be between 1024 and 65535")
    return parsed


def _encoded_powershell(script: str) -> tuple[str, ...]:
    utf8_script = (
        "$utf8=[System.Text.UTF8Encoding]::new($false); "
        "$OutputEncoding=$utf8; "
        "[Console]::OutputEncoding=$utf8; "
        + script
    )
    encoded = base64.b64encode(
        utf8_script.encode("utf-16le")
    ).decode("ascii")
    return (
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoded,
    )


def _ps_literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _powershell_failure_detail(
    completed: subprocess.CompletedProcess[str],
) -> str:
    details: list[str] = []
    marker = "#< CLIXML"
    for output in (completed.stderr, completed.stdout):
        normalized = output.strip()
        if not normalized:
            continue
        marker_index = normalized.find(marker)
        if marker_index < 0:
            details.append(normalized)
            continue

        prefix = normalized[:marker_index].strip()
        if prefix:
            details.append(prefix)
        try:
            root = ElementTree.fromstring(
                normalized[marker_index + len(marker):].strip()
            )
        except ElementTree.ParseError:
            details.append(normalized)
            continue
        details.extend(
            text
            for element in root.iter()
            if element.attrib.get("S", "").lower() == "error"
            and (text := (element.text or "").strip())
        )
    return "\n".join(details) or f"exit code {completed.returncode}"


class InteractiveTaskScheduler:
    """Small argv-only Task Scheduler adapter with strict task ownership."""

    def __init__(
        self,
        *,
        user_id: str,
        runner: Runner = subprocess.run,
    ) -> None:
        self.user_id = user_id.strip()
        if not self.user_id:
            raise BrokerError("interactive desktop user is required")
        self._runner = runner

    def register_interactive(
        self,
        task: ScheduledTask,
        *,
        start_at: datetime | None = None,
    ) -> None:
        if task.user_id != self.user_id:
            raise BrokerError("scheduled task user does not match broker user")
        action_arguments = subprocess.list2cmdline(list(task.arguments))
        trigger = (
            f"$trigger=New-ScheduledTaskTrigger -Once -At "
            f"{_ps_literal(start_at.astimezone().isoformat())}; "
            if start_at is not None
            else "$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date); "
        )
        script = (
            "$ErrorActionPreference='Stop'; "
            f"$action=New-ScheduledTaskAction -Execute "
            f"{_ps_literal(task.executable)} -Argument "
            f"{_ps_literal(action_arguments)}; "
            f"$principal=New-ScheduledTaskPrincipal -UserId "
            f"{_ps_literal(task.user_id)} -LogonType Interactive "
            "-RunLevel Highest; "
            f"{trigger}"
            "$settings=New-ScheduledTaskSettingsSet "
            "-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries "
            "-ExecutionTimeLimit ([TimeSpan]::Zero); "
            f"Register-ScheduledTask -TaskName {_ps_literal(task.name)} "
            "-Action $action -Trigger $trigger -Principal $principal "
            "-Settings $settings -Force | Out-Null"
        )
        self._run(script, "register scheduled task")

    def start(self, task_name: str) -> None:
        self._run(
            "$ErrorActionPreference='Stop'; "
            f"Start-ScheduledTask -TaskName {_ps_literal(task_name)}",
            "start scheduled task",
        )

    def unregister(self, task_name: str) -> None:
        self._run(
            "$ErrorActionPreference='Stop'; "
            f"$task=Get-ScheduledTask -TaskName {_ps_literal(task_name)} "
            "-ErrorAction SilentlyContinue; "
            "if ($null -ne $task) { "
            f"Unregister-ScheduledTask -TaskName {_ps_literal(task_name)} "
            "-Confirm:$false }; exit 0",
            "unregister scheduled task",
        )

    def stop(self, task_name: str) -> None:
        self._run(
            "$ErrorActionPreference='Stop'; "
            f"$task=Get-ScheduledTask -TaskName {_ps_literal(task_name)} "
            "-ErrorAction SilentlyContinue; "
            "if ($null -ne $task -and $task.State -eq 'Running') { "
            f"Stop-ScheduledTask -TaskName {_ps_literal(task_name)} "
            "}; exit 0",
            "stop scheduled task",
        )

    def exists(self, task_name: str) -> bool:
        completed = self._run(
            f"if (Get-ScheduledTask -TaskName {_ps_literal(task_name)} "
            "-ErrorAction SilentlyContinue) { exit 0 } else { exit 3 }",
            "query scheduled task",
            check=False,
        )
        return completed.returncode == 0

    def _run(
        self,
        script: str,
        operation: str,
        *,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        completed = self._runner(
            _encoded_powershell(script),
            capture_output=True,
            encoding="utf-8",
            check=False,
        )
        if check and completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BrokerError(f"{operation} failed: {detail[-4000:]}")
        return completed


class WindowsDesktopBroker:
    """Owns one Windows runtime-cell lease and its interactive workers."""

    def __init__(
        self,
        root: Path,
        *,
        desktop_user: str,
        scheduler: InteractiveTaskScheduler | None = None,
        now: Callable[[], float] = time.time,
    ) -> None:
        self.root = root
        self.desktop_user = desktop_user.strip()
        if not self.desktop_user:
            raise BrokerError("interactive desktop user is required")
        self.scheduler = scheduler or InteractiveTaskScheduler(
            user_id=self.desktop_user
        )
        self._now = now

    @property
    def lease_path(self) -> Path:
        return self.root / "lease.json"

    def acquire(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        run_id = _canonical_id(payload.get("runId"), "run id")
        expires_at = int(payload.get("expiresAtEpoch") or 0)
        if expires_at <= int(self._now()):
            raise BrokerError("lease expiry must be in the future")
        if self.lease_path.exists():
            current = self._read_json(self.lease_path)
            if int(current.get("expiresAtEpoch") or 0) > int(self._now()):
                raise BrokerError(
                    f"runtime cell is leased by {current.get('runId') or 'unknown'}"
                )
            self.cleanup({"runId": current.get("runId"), "expired": True})

        self.root.mkdir(parents=True, exist_ok=True)
        lease = {
            "artifactKind": "windows-desktop-broker-lease",
            "runId": run_id,
            "desktopUser": self.desktop_user,
            "expiresAtEpoch": expires_at,
            "actors": {},
        }
        self._write_json_exclusive(self.lease_path, lease)
        cleanup_task = self._task_name(run_id, "ttl-cleanup")
        broker_path = str(Path(__file__).resolve())
        cleanup_payload = base64.b64encode(
            json.dumps(
                {
                    "operation": "cleanup",
                    "runId": run_id,
                    "expired": True,
                    "root": str(self.root),
                    "desktopUser": self.desktop_user,
                },
                sort_keys=True,
            ).encode("utf-8")
        ).decode("ascii")
        try:
            self.scheduler.register_interactive(
                ScheduledTask(
                    name=cleanup_task,
                    executable=sys.executable,
                    arguments=(broker_path, "--request", cleanup_payload),
                    user_id=self.desktop_user,
                ),
                start_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
            )
        except BaseException:
            self.lease_path.unlink(missing_ok=True)
            raise
        return {
            "runId": run_id,
            "desktopUser": self.desktop_user,
            "expiresAtEpoch": expires_at,
            "cleanupTask": cleanup_task,
        }

    def launch_actor(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        lease = self._require_lease(payload)
        actor = _canonical_id(payload.get("actor"), "actor")
        run_id = str(lease["runId"])
        actors = lease.get("actors")
        if not isinstance(actors, dict):
            raise BrokerError("broker lease actor state is invalid")
        if actor in actors:
            raise BrokerError(f"actor {actor!r} is already registered")

        executable = _windows_path(payload.get("executable"), "executable")
        storage_root = _windows_path(payload.get("storageRoot"), "storage root")
        log_path = _windows_path(payload.get("logPath"), "log path")
        webdriver_port = _port(payload.get("webdriverPort"), "WebDriver port")
        gateway_port = _port(payload.get("gatewayPort"), "Gateway port")
        if webdriver_port == gateway_port:
            raise BrokerError("actor ports must be distinct")
        environment = payload.get("environment") or {}
        arguments = payload.get("arguments") or []
        if not isinstance(environment, dict) or any(
            not isinstance(key, str) or not isinstance(value, str)
            for key, value in environment.items()
        ):
            raise BrokerError("actor environment must contain string entries")
        if not isinstance(arguments, list) or any(
            not isinstance(argument, str) for argument in arguments
        ):
            raise BrokerError("actor arguments must be strings")

        actor_root = self.root / "actors" / run_id / actor
        request_path = actor_root / "launch.json"
        worker_path = actor_root / "worker.ps1"
        state_path = actor_root / "state.json"
        actor_root.mkdir(parents=True, exist_ok=False)
        request = {
            "executable": executable,
            "arguments": arguments,
            "environment": {
                **environment,
                "TAURI_WEBDRIVER_PORT": str(webdriver_port),
                "PT_GATEWAY_PORT": str(gateway_port),
                "PEERS_STORAGE_ROOT": storage_root,
            },
            "storageRoot": storage_root,
            "logPath": log_path,
            "statePath": str(state_path),
        }
        self._write_json(request_path, request)
        worker_path.write_text(self._actor_worker_script(), encoding="utf-8")
        task_name = self._task_name(str(lease["runId"]), f"actor-{actor}")
        task = ScheduledTask(
            name=task_name,
            executable="powershell.exe",
            arguments=(
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(worker_path),
                str(request_path),
            ),
            user_id=self.desktop_user,
        )
        try:
            self.scheduler.register_interactive(task)
            self.scheduler.start(task_name)
            state = self._wait_for_state(state_path, timeout=30)
            process_id = int(state.get("processId") or 0)
            if process_id <= 0 or state.get("status") != "RUNNING":
                raise BrokerError(
                    "interactive actor did not report a process identity: "
                    + json.dumps(state, sort_keys=True)
                )
        except BaseException:
            try:
                self.scheduler.unregister(task_name)
            finally:
                self._remove_tree(actor_root)
            raise

        actors[actor] = {
            "taskName": task_name,
            "processId": process_id,
            "webdriverPort": webdriver_port,
            "gatewayPort": gateway_port,
            "storageRoot": storage_root,
            "logPath": log_path,
            "statePath": str(state_path),
            "profile": str(payload.get("profile") or ""),
        }
        self._write_json(self.lease_path, lease)
        return {"actor": actor, **actors[actor]}

    def actor_status(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        lease = self._require_lease(payload)
        actor = _canonical_id(payload.get("actor"), "actor")
        actor_state = self._actor_state(lease, actor)
        process_id = int(actor_state.get("processId") or 0)
        process_alive = self._process_alive(process_id)
        return {
            "actor": actor,
            **actor_state,
            "processAlive": process_alive,
            "taskExists": self.scheduler.exists(str(actor_state["taskName"])),
            "expired": int(lease["expiresAtEpoch"]) <= int(self._now()),
        }

    def stop_actor(
        self,
        payload: Mapping[str, Any],
        *,
        allow_expired: bool = False,
    ) -> dict[str, Any]:
        lease = self._require_lease(payload, allow_expired=allow_expired)
        actor = _canonical_id(payload.get("actor"), "actor")
        actors = lease.get("actors")
        assert isinstance(actors, dict)
        actor_state = self._actor_state(lease, actor)
        preserve_state = payload.get("preserveState") is True
        process_id = int(actor_state.get("processId") or 0)
        self._stop_process(process_id)
        self.scheduler.stop(str(actor_state["taskName"]))
        self.scheduler.unregister(str(actor_state["taskName"]))
        active_ports = [
            port
            for port in (
                int(actor_state["webdriverPort"]),
                int(actor_state["gatewayPort"]),
            )
            if self._port_listening(port)
        ]
        if active_ports:
            raise BrokerError(
                f"actor ports remain active after process stop: {active_ports}"
            )

        log_path = Path(str(actor_state["logPath"]))
        log_content = b""
        try:
            log_content = log_path.read_bytes()
        except FileNotFoundError:
            pass
        if not preserve_state:
            shutil.rmtree(Path(str(actor_state["storageRoot"])), ignore_errors=True)
        actor_root = self.root / "actors" / str(lease["runId"]) / actor
        self._remove_tree(actor_root)
        actors.pop(actor, None)
        self._write_json(self.lease_path, lease)
        return {
            "actor": actor,
            "processId": process_id,
            "processStopped": not self._process_alive(process_id),
            "storageReleased": (
                preserve_state
                or not Path(str(actor_state["storageRoot"])).exists()
            ),
            "taskReleased": not self.scheduler.exists(
                str(actor_state["taskName"])
            ),
            "portsReleased": not active_ports,
            "logContent": base64.b64encode(log_content).decode("ascii"),
        }

    def execute_adapter(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        lease = self._require_lease(payload)
        operation = _canonical_id(payload.get("adapterOperation"), "adapter operation")
        adapter_payload = payload.get("payload") or {}
        if not isinstance(adapter_payload, dict):
            raise BrokerError("adapter payload must be an object")
        request_id = _canonical_id(
            payload.get("requestId") or f"adapter-{time.time_ns():x}",
            "adapter request id",
        )
        request_root = self.root / "adapter" / request_id
        request_path = request_root / "request.json"
        response_path = request_root / "response.json"
        worker_path = request_root / "worker.py"
        request_root.mkdir(parents=True, exist_ok=False)
        self._write_json(
            request_path,
            {
                "operation": operation,
                "payload": adapter_payload,
                "responsePath": str(response_path),
                "sourceRoot": _windows_path(
                    payload.get("sourceRoot"),
                    "adapter source root",
                ),
            },
        )
        worker_path.write_text(self._adapter_worker_script(), encoding="utf-8")
        task_name = self._task_name(str(lease["runId"]), request_id)
        task = ScheduledTask(
            name=task_name,
            executable=sys.executable,
            arguments=(str(worker_path), str(request_path)),
            user_id=self.desktop_user,
        )
        try:
            self.scheduler.register_interactive(task)
            self.scheduler.start(task_name)
            response = self._wait_for_state(response_path, timeout=30)
            if response.get("status") != "OK":
                raise BrokerError(
                    f"interactive adapter operation failed: "
                    f"{response.get('error') or 'unknown error'}"
                )
            result = response.get("result")
            if not isinstance(result, dict):
                raise BrokerError("interactive adapter result is invalid")
            return result
        finally:
            self.scheduler.unregister(task_name)
            shutil.rmtree(request_root, ignore_errors=True)

    def status(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        lease = self._require_lease(payload)
        actors = lease.get("actors")
        assert isinstance(actors, dict)
        actor_statuses = []
        for actor in sorted(actors):
            actor_statuses.append(
                self.actor_status({**payload, "actor": actor})
            )
        return {
            "runId": lease["runId"],
            "desktopUser": lease["desktopUser"],
            "expiresAtEpoch": lease["expiresAtEpoch"],
            "expired": int(lease["expiresAtEpoch"]) <= int(self._now()),
            "actors": actor_statuses,
        }

    def cleanup(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not self.lease_path.exists():
            return {"clean": True, "alreadyClean": True}
        lease = self._require_lease(payload, allow_expired=True)
        failures: list[str] = []
        actors = lease.get("actors")
        if isinstance(actors, dict):
            for actor in reversed(tuple(actors)):
                try:
                    self.stop_actor(
                        {
                            "runId": lease["runId"],
                            "actor": actor,
                            "preserveState": False,
                        },
                        allow_expired=True,
                    )
                except Exception as error:
                    failures.append(f"actor {actor}: {error}")
        cleanup_task = self._task_name(str(lease["runId"]), "ttl-cleanup")
        try:
            self.scheduler.unregister(cleanup_task)
        except Exception as error:
            failures.append(f"TTL task: {error}")
        if failures:
            raise BrokerError("broker cleanup failed: " + "; ".join(failures))
        self.lease_path.unlink(missing_ok=True)
        self._remove_tree(self.root)
        if self.root.exists():
            raise BrokerError("broker runtime root remains after cleanup")
        return {
            "clean": not self.root.exists(),
            "runId": lease["runId"],
            "expired": payload.get("expired") is True,
        }

    @staticmethod
    def _remove_tree(path: Path) -> None:
        if not path.exists():
            return
        target = path
        if os.name == "nt":
            absolute = str(path.resolve())
            if absolute.startswith("\\\\"):
                absolute = "\\\\?\\UNC\\" + absolute[2:]
            elif not absolute.startswith("\\\\?\\"):
                absolute = "\\\\?\\" + absolute
            target = Path(absolute)
        shutil.rmtree(target)

    def audit(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not self.lease_path.exists():
            return {
                "clean": not self.root.exists(),
                "leaseExists": False,
                "actors": [],
            }
        status = self.status(payload)
        active = [
            actor
            for actor in status["actors"]
            if actor["processAlive"] or actor["taskExists"]
        ]
        return {
            "clean": False,
            "leaseExists": True,
            "expired": status["expired"],
            "actors": active,
        }

    def _require_lease(
        self,
        payload: Mapping[str, Any],
        *,
        allow_expired: bool = False,
    ) -> dict[str, Any]:
        requested_run = _canonical_id(payload.get("runId"), "run id")
        lease = self._read_json(self.lease_path)
        if lease.get("runId") != requested_run:
            raise BrokerError("broker run identity does not match active lease")
        if (
            not allow_expired
            and int(lease.get("expiresAtEpoch") or 0) <= int(self._now())
        ):
            raise BrokerError("broker lease has expired")
        return lease

    @staticmethod
    def _actor_state(
        lease: Mapping[str, Any],
        actor: str,
    ) -> dict[str, Any]:
        actors = lease.get("actors")
        state = actors.get(actor) if isinstance(actors, dict) else None
        if not isinstance(state, dict):
            raise BrokerError(f"actor {actor!r} is not registered")
        return dict(state)

    @staticmethod
    def _process_alive(process_id: int) -> bool:
        if process_id <= 0:
            return False
        completed = subprocess.run(
            _encoded_powershell(
                f"if (Get-Process -Id {process_id} -ErrorAction "
                "SilentlyContinue) { exit 0 } else { exit 3 }"
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        return completed.returncode == 0

    @staticmethod
    def _stop_process(process_id: int) -> None:
        if process_id <= 0:
            return
        completed = subprocess.run(
            _encoded_powershell(
                f"$process=Get-Process -Id {process_id} -ErrorAction "
                "SilentlyContinue; if ($null -ne $process) { "
                f"Stop-Process -Id {process_id} -Force "
                "-ErrorAction SilentlyContinue }"
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        deadline = time.monotonic() + 15
        while WindowsDesktopBroker._process_alive(process_id):
            if time.monotonic() >= deadline:
                detail = _powershell_failure_detail(completed)
                raise BrokerError(
                    "actor process cleanup failed: "
                    f"process {process_id} remains alive; {detail[-4000:]}"
                )
            time.sleep(_WAIT_INTERVAL_SECONDS)

    @staticmethod
    def _port_listening(port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            return False

    @staticmethod
    def _wait_for_state(path: Path, *, timeout: float) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        last_error = ""
        while time.monotonic() < deadline:
            try:
                payload = WindowsDesktopBroker._read_json(path)
            except (FileNotFoundError, BrokerError) as error:
                last_error = str(error)
                time.sleep(_WAIT_INTERVAL_SECONDS)
                continue
            return payload
        raise BrokerError(
            f"interactive scheduled task did not report readiness: {last_error}"
        )

    @staticmethod
    def _task_name(run_id: str, suffix: str) -> str:
        canonical_run = _canonical_id(run_id, "run id")
        canonical_suffix = _canonical_id(suffix, "task suffix")
        return f"{_TASK_PREFIX}-{canonical_run}-{canonical_suffix}"

    @staticmethod
    def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(dict(payload), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)

    @staticmethod
    def _write_json_exclusive(path: Path, payload: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(dict(payload), stream, indent=2, sort_keys=True)
                stream.write("\n")
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            raise
        except (OSError, json.JSONDecodeError) as error:
            raise BrokerError(f"broker state is invalid at {path}: {error}") from error
        if not isinstance(payload, dict):
            raise BrokerError(f"broker state at {path} is not an object")
        return payload

    @staticmethod
    def _actor_worker_script() -> str:
        return r"""
param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -Raw -LiteralPath $RequestPath | ConvertFrom-Json
try {
    foreach ($property in $request.environment.PSObject.Properties) {
        [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
    }
    New-Item -ItemType Directory -Force -Path $request.storageRoot | Out-Null
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($request.logPath)) | Out-Null
    $errorPath = $request.logPath + '.stderr'
    $startProcess = @{
        FilePath = $request.executable
        RedirectStandardOutput = $request.logPath
        RedirectStandardError = $errorPath
        PassThru = $true
    }
    if (@($request.arguments).Count -gt 0) {
        $startProcess.ArgumentList = @($request.arguments)
    }
    $process = Start-Process @startProcess
    @{status='RUNNING'; processId=$process.Id; startedAt=(Get-Date).ToUniversalTime().ToString('o')} |
        ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath $request.statePath
    $process.WaitForExit()
    if (Test-Path -LiteralPath $errorPath) {
        Get-Content -Raw -LiteralPath $errorPath | Add-Content -Encoding UTF8 -LiteralPath $request.logPath
        Remove-Item -Force -LiteralPath $errorPath
    }
    @{status='EXITED'; processId=$process.Id; exitCode=$process.ExitCode; exitedAt=(Get-Date).ToUniversalTime().ToString('o')} |
        ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath $request.statePath
} catch {
    @{status='ERROR'; error=$_.Exception.Message; failedAt=(Get-Date).ToUniversalTime().ToString('o')} |
        ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath $request.statePath
    throw
}
""".strip()

    @staticmethod
    def _adapter_worker_script() -> str:
        return r"""
import base64
import hashlib
import json
import pathlib
import struct
import sys
import time
import zlib

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
response_path = pathlib.Path(request["responsePath"])
try:
    sys.path.insert(0, request["sourceRoot"])

    from tooling.acceptance.drivers.native.base import MouseAction, NativeKey, NativeModifier
    from tooling.acceptance.drivers.native.windows import Win32NativeDesktopAdapter

    operation = request["operation"]
    payload = request["payload"]
    adapter = Win32NativeDesktopAdapter()

    if operation == "activate_process":
        process_id = int(payload["processId"])
        adapter.activate_process(process_id)
        result = adapter.focused_control(process_id).to_dict()
    elif operation == "post_mouse":
        actions = tuple(MouseAction(item) for item in payload["actions"])
        result = adapter.post_mouse(actions, tuple(payload["point"])) or {}
    elif operation == "post_mouse_to_process":
        process_id = int(payload["processId"])
        actions = tuple(MouseAction(item) for item in payload["actions"])
        adapter.activate_process(process_id)
        adapter.post_mouse(actions, tuple(payload["point"]))
        result = adapter.focused_control(process_id).to_dict()
    elif operation == "post_key":
        result = adapter.post_key(
            NativeKey(payload["key"]),
            modifiers=tuple(
                NativeModifier(item) for item in payload.get("modifiers", [])
            ),
            text=str(payload.get("text") or ""),
            private_source=bool(payload.get("privateSource")),
        ) or {}
    elif operation == "post_key_to_process":
        process_id = int(payload["processId"])
        adapter.activate_process(process_id)
        adapter.post_key(
            NativeKey(payload["key"]),
            modifiers=tuple(
                NativeModifier(item) for item in payload.get("modifiers", [])
            ),
            text=str(payload.get("text") or ""),
            private_source=bool(payload.get("privateSource")),
        )
        result = adapter.focused_control(process_id).to_dict()
    elif operation == "post_key_sequence_to_process":
        process_id = int(payload["processId"])
        keys = tuple(NativeKey(item) for item in payload["keys"])
        interval_seconds = float(payload.get("intervalSeconds") or 0)
        if not keys:
            raise ValueError("Native key sequence must not be empty")
        if interval_seconds < 0 or interval_seconds > 1:
            raise ValueError(
                "Native key sequence interval must be between 0 and 1 second"
            )
        adapter.activate_process(process_id)
        for index, key in enumerate(keys):
            adapter.post_key(
                key,
                private_source=bool(payload.get("privateSource")),
            )
            if index + 1 < len(keys) and interval_seconds > 0:
                time.sleep(interval_seconds)
        result = adapter.focused_control(process_id).to_dict()
    elif operation == "reveal_file_chooser_location":
        result = adapter.reveal_file_chooser_location() or {}
    elif operation == "reveal_file_chooser_location_to_process":
        process_id = int(payload["processId"])
        adapter.activate_process(process_id)
        adapter.reveal_file_chooser_location()
        result = adapter.focused_control(process_id).to_dict()
    elif operation == "focused_control":
        result = adapter.focused_control(int(payload["processId"])).to_dict()
    elif operation == "window_stack_at_point":
        result = adapter.window_stack_at_point(tuple(payload["point"])).to_dict()
    elif operation == "content_origin":
        x, y = adapter.content_origin(int(payload["processId"]))
        result = {"x": x, "y": y}
    elif operation == "mouse_button_down":
        result = {"down": adapter.mouse_button_down()}
    elif operation == "probe_screenshot":
        shot = response_path.with_suffix(".bmp")
        adapter.capture_screenshot(shot)
        content = shot.read_bytes()
        if len(content) < 26 or content[:2] != b"BM":
            raise ValueError("Native screenshot is not a valid BMP payload")
        width, height = struct.unpack_from("<ii", content, 18)
        if width <= 0 or height <= 0:
            raise ValueError("Native screenshot geometry is invalid")
        result = {
            "captured": True,
            "byteLength": len(content),
            "content": base64.b64encode(
                zlib.compress(content)
            ).decode("ascii"),
            "contentEncoding": "zlib",
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        shot.unlink(missing_ok=True)
    elif operation == "capture_screenshot":
        shot = response_path.with_suffix(".bmp")
        adapter.capture_screenshot(shot)
        result = {
            "content": base64.b64encode(shot.read_bytes()).decode("ascii")
        }
        shot.unlink(missing_ok=True)
    elif operation == "read_clipboard":
        result = {
            "content": base64.b64encode(
                adapter.read_clipboard()
            ).decode("ascii")
        }
    elif operation == "write_clipboard":
        adapter.write_clipboard(
            base64.b64decode(payload["content"], validate=True)
        )
        result = {}
    else:
        raise ValueError(f"unsupported adapter operation: {operation}")
    response = {"status": "OK", "result": result}
except Exception as error:
    response = {"status": "ERROR", "error": str(error)}

response_path.write_text(
    json.dumps(response, sort_keys=True),
    encoding="utf-8",
)
""".strip()


def dispatch_request(request: Mapping[str, Any]) -> dict[str, Any]:
    root = Path(_windows_path(request.get("root"), "broker root"))
    desktop_user = str(request.get("desktopUser") or "").strip()
    broker = WindowsDesktopBroker(root, desktop_user=desktop_user)
    operation = str(request.get("operation") or "")
    handlers: dict[str, Callable[[Mapping[str, Any]], dict[str, Any]]] = {
        "acquire": broker.acquire,
        "launch-actor": broker.launch_actor,
        "actor-status": broker.actor_status,
        "stop-actor": broker.stop_actor,
        "adapter": broker.execute_adapter,
        "status": broker.status,
        "cleanup": broker.cleanup,
        "audit": broker.audit,
    }
    handler = handlers.get(operation)
    if handler is None:
        raise BrokerError(f"unsupported broker operation: {operation!r}")
    return handler(request)


def _decode_request(value: str) -> dict[str, Any]:
    try:
        payload = json.loads(base64.b64decode(value, validate=True))
    except (ValueError, json.JSONDecodeError) as error:
        raise BrokerError("broker request is not valid base64 JSON") from error
    if not isinstance(payload, dict):
        raise BrokerError("broker request must contain an object")
    return payload


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    try:
        result = dispatch_request(_decode_request(args.request))
    except Exception as error:
        sys.stdout.write(
            json.dumps(
                {"status": "ERROR", "error": str(error)},
                sort_keys=True,
            )
            + "\n"
        )
        return 1
    sys.stdout.write(
        json.dumps({"status": "OK", "result": result}, sort_keys=True) + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
