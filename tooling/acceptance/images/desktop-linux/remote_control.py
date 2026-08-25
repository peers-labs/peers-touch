#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import errno
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_COMMIT = re.compile(r"^[0-9a-f]{40,64}$")
_ENVIRONMENT_NAME = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
_ADAPTER_OPERATIONS = frozenset(
    {
        "activate_process",
        "capture_screenshot",
        "focused_control",
        "mouse_button_down",
        "post_key",
        "post_mouse",
        "read_clipboard",
        "window_stack_at_point",
        "write_clipboard",
    }
)
_ADAPTER_SCRIPT = """
import base64
import json
import pathlib
import sys

from tooling.acceptance.drivers.native.base import MouseAction, NativeKey, NativeModifier
from tooling.acceptance.drivers.native.linux_x11 import LinuxX11NativeDesktopAdapter

operation = sys.argv[1]
payload = json.loads(base64.b64decode(sys.argv[2]).decode("utf-8"))
adapter = LinuxX11NativeDesktopAdapter(payload["display"])
if operation == "activate_process":
    adapter.activate_process(int(payload["processId"]))
    result = {}
elif operation == "post_mouse":
    adapter.post_mouse(
        tuple(MouseAction(value) for value in payload["actions"]),
        tuple(float(value) for value in payload["point"]),
    )
    result = {}
elif operation == "post_key":
    adapter.post_key(
        NativeKey(payload["key"]),
        modifiers=tuple(NativeModifier(value) for value in payload["modifiers"]),
        text=str(payload.get("text") or ""),
        private_source=bool(payload.get("privateSource")),
    )
    result = {}
elif operation == "focused_control":
    result = adapter.focused_control(int(payload["processId"])).to_dict()
elif operation == "window_stack_at_point":
    result = adapter.window_stack_at_point(
        tuple(float(value) for value in payload["point"])
    ).to_dict()
elif operation == "mouse_button_down":
    result = {"down": adapter.mouse_button_down()}
elif operation == "capture_screenshot":
    path = pathlib.Path("/workspace/run/adapter-screenshot.png")
    adapter.capture_screenshot(path)
    result = {"content": base64.b64encode(path.read_bytes()).decode("ascii")}
    path.unlink(missing_ok=True)
elif operation == "read_clipboard":
    result = {"content": base64.b64encode(adapter.read_clipboard()).decode("ascii")}
elif operation == "write_clipboard":
    adapter.write_clipboard(base64.b64decode(payload["content"]))
    result = {}
else:
    raise ValueError(f"unsupported adapter operation: {operation}")
sys.stdout.write(json.dumps(result, sort_keys=True))
""".strip()


def _runtime_root(value: str) -> Path:
    relative = Path(value)
    if not value or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("runtime root must be relative to the remote home")
    root = (Path.home() / relative).resolve()
    home = Path.home().resolve()
    if root != home and home not in root.parents:
        raise ValueError("runtime root escapes the remote home")
    return root


def _slug(value: str, name: str) -> str:
    if not _SLUG.fullmatch(value):
        raise ValueError(f"{name} must be a slug")
    return value


def _relative_path(value: str, name: str) -> str:
    path = Path(value)
    if not value or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{name} must be relative to the remote home")
    return path.as_posix()


def _commit(value: str) -> str:
    if not _COMMIT.fullmatch(value):
        raise ValueError("source commit must be a hexadecimal object id")
    return value


def _read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def _port(value: int, name: str) -> int:
    if value < 1024 or value > 65535:
        raise ValueError(f"{name} must be between 1024 and 65535")
    return value


def _actor_environment(raw: str) -> dict[str, str]:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("actor environment must be an object")
    environment: dict[str, str] = {}
    for name, value in payload.items():
        if not isinstance(name, str) or not _ENVIRONMENT_NAME.fullmatch(name):
            raise ValueError("actor environment contains an invalid name")
        if not isinstance(value, str) or "\x00" in value:
            raise ValueError(f"actor environment {name} must be a string")
        environment[name] = value
    return environment


def _owned_lease(
    root: Path,
    *,
    cell_id: str,
    run_id: str,
    container_name: str,
) -> tuple[Path, dict[str, object]]:
    lease_path = root / cell_id / "lease" / "lease.json"
    lease = _read_json(lease_path)
    if (
        lease.get("runId") != run_id
        or lease.get("containerName") != container_name
    ):
        raise RuntimeError("runtime-cell lease ownership mismatch")
    return lease_path, lease


def _container_command(
    container_name: str,
    *arguments: str,
    timeout: float = 30,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ("docker", "exec", container_name, *arguments),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f"runtime-cell container command failed: "
            f"{detail[-4000:] or f'exit {completed.returncode}'}"
        )
    return completed


def _actor_record(
    lease: dict[str, object],
    actor: str,
) -> dict[str, object] | None:
    actors = lease.get("actors")
    if not isinstance(actors, list):
        return None
    return next(
        (
            item
            for item in actors
            if isinstance(item, dict) and item.get("actor") == actor
        ),
        None,
    )


def _wait_actor_port(
    container_name: str,
    process_id: int,
    port: int,
    deadline: float,
) -> None:
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            alive = subprocess.run(
                ("docker", "exec", container_name, "kill", "-0", str(process_id)),
                capture_output=True,
                check=False,
            )
            if alive.returncode != 0:
                raise RuntimeError(
                    f"runtime-cell actor process {process_id} exited before "
                    f"port {port} became ready"
                )
            time.sleep(0.1)
    raise RuntimeError(f"runtime-cell actor port {port} readiness timed out")


def _stop_actor_record(
    container_name: str,
    run_root: Path,
    record: dict[str, object],
) -> dict[str, object]:
    actor = _slug(str(record.get("actor") or ""), "actor")
    process_id = int(record.get("processId") or 0)
    if process_id > 0:
        subprocess.run(
            (
                "docker",
                "exec",
                container_name,
                "/bin/bash",
                "-lc",
                f"kill -TERM -- -{process_id}",
            ),
            capture_output=True,
            check=False,
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            alive = subprocess.run(
                (
                    "docker",
                    "exec",
                    container_name,
                    "/bin/bash",
                    "-lc",
                    f"kill -0 -- -{process_id}",
                ),
                capture_output=True,
                check=False,
            )
            if alive.returncode != 0:
                break
            time.sleep(0.05)
        else:
            subprocess.run(
                (
                    "docker",
                    "exec",
                    container_name,
                    "/bin/bash",
                    "-lc",
                    f"kill -KILL -- -{process_id}",
                ),
                capture_output=True,
                check=False,
            )
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                final_probe = subprocess.run(
                    (
                        "docker",
                        "exec",
                        container_name,
                        "/bin/bash",
                        "-lc",
                        f"kill -0 -- -{process_id}",
                    ),
                    capture_output=True,
                    check=False,
                )
                if final_probe.returncode != 0:
                    break
                time.sleep(0.05)
            else:
                raise RuntimeError(
                    f"runtime-cell actor process {process_id} remains active"
                )
    actor_root = run_root / "actors" / actor
    log_path = actor_root / "app.log"
    log_content = (
        base64.b64encode(log_path.read_bytes()).decode("ascii")
        if log_path.is_file()
        else ""
    )
    _remove_tree(actor_root)
    return {
        "actor": actor,
        "processId": process_id,
        "logContent": log_content,
        "stopped": True,
    }


def _docker_inspect(container_name: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ("docker", "inspect", container_name),
        capture_output=True,
        text=True,
        check=False,
    )


def _container_is_absent(inspected: subprocess.CompletedProcess[str]) -> bool:
    detail = (inspected.stderr or inspected.stdout).lower()
    return inspected.returncode != 0 and (
        "no such object" in detail or "no such container" in detail
    )


def _docker_remove(container_name: str) -> None:
    before = _docker_inspect(container_name)
    if _container_is_absent(before):
        return
    if before.returncode != 0:
        detail = before.stderr.strip() or before.stdout.strip()
        raise RuntimeError(
            f"runtime-cell container inspection failed for {container_name}: "
            f"{detail[-2000:]}"
        )
    removed = subprocess.run(
        ("docker", "rm", "--force", container_name),
        capture_output=True,
        text=True,
        check=False,
    )
    if removed.returncode != 0:
        detail = removed.stderr.strip() or removed.stdout.strip()
        raise RuntimeError(
            f"runtime-cell container cleanup failed for {container_name}: "
            f"{detail[-2000:] or f'exit {removed.returncode}'}"
        )
    after = _docker_inspect(container_name)
    if not _container_is_absent(after):
        detail = after.stderr.strip() or after.stdout.strip()
        raise RuntimeError(
            f"runtime-cell container remains after cleanup for {container_name}: "
            f"{detail[-2000:] or 'container still exists'}"
        )


def _assert_ports_released(ports: tuple[int, ...]) -> None:
    active: list[int] = []
    for port in ports:
        for host in ("127.0.0.1", "::1"):
            try:
                with socket.create_connection((host, port), timeout=0.2):
                    active.append(port)
                    break
            except OSError:
                continue
    if active:
        raise RuntimeError(
            f"runtime-cell ports remain active after cleanup: {active}"
        )


def _remove_tree(path: Path) -> None:
    deadline = time.monotonic() + 3
    while path.exists():
        try:
            shutil.rmtree(path)
        except OSError as error:
            if (
                error.errno not in {errno.EBUSY, errno.ENOTEMPTY}
                or time.monotonic() >= deadline
            ):
                raise RuntimeError(
                    f"runtime-cell storage cleanup failed for {path}: {error}"
                ) from error
            time.sleep(0.05)
    if path.exists():
        raise RuntimeError(
            f"runtime-cell storage remains after cleanup: {path}"
        )


def _clean_source(source_path: str, source_commit: str) -> None:
    if not source_path or not source_commit:
        return
    relative = Path(_relative_path(source_path, "lease source path"))
    source = Path.home() / relative
    for command in (
        ("git", "-C", str(source), "reset", "--hard", source_commit),
        ("git", "-C", str(source), "clean", "-ffdqx"),
    ):
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(
                f"runtime-cell source cleanup failed: {detail[-2000:]}"
            )


def _stop_reaper(lease: dict[str, object]) -> None:
    try:
        pid = int(lease.get("reaperPid") or 0)
    except (TypeError, ValueError):
        return
    if pid <= 0 or pid == os.getpid():
        return
    try:
        command = (Path("/proc") / str(pid) / "cmdline").read_bytes()
    except OSError:
        return
    run_id = str(lease.get("runId") or "").encode()
    container_name = str(lease.get("containerName") or "").encode()
    if (
        b"remote_control.py" not in command
        or b"reap" not in command
        or not run_id
        or run_id not in command
        or not container_name
        or container_name not in command
    ):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    os.kill(pid, signal.SIGKILL)


def _spawn_reaper(
    control_path: Path,
    *,
    runtime_root: str,
    cell_id: str,
    run_id: str,
    container_name: str,
    expires_at: int,
) -> int:
    process = subprocess.Popen(
        (
            sys.executable,
            str(control_path),
            "reap",
            "--runtime-root",
            runtime_root,
            "--cell-id",
            cell_id,
            "--run-id",
            run_id,
            "--container-name",
            container_name,
            "--expires-at",
            str(expires_at),
        ),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return process.pid


def _cleanup_owned_run(
    cell_root: Path,
    *,
    run_id: str,
    container_name: str,
    stop_reaper: bool,
) -> bool:
    lease_dir = cell_root / "lease"
    lease_path = lease_dir / "lease.json"
    lease = _read_json(lease_path)
    if lease.get("runId") != run_id:
        return False
    owned_container = str(lease.get("containerName") or "")
    if owned_container != container_name:
        raise RuntimeError("runtime-cell container ownership mismatch")
    if stop_reaper:
        _stop_reaper(lease)
    failures: list[str] = []
    run_root = cell_root / "runs" / run_id
    actors = lease.get("actors")
    if isinstance(actors, list):
        for actor in reversed(actors):
            if not isinstance(actor, dict):
                continue
            try:
                _stop_actor_record(owned_container, run_root, actor)
            except (OSError, RuntimeError, ValueError) as error:
                failures.append(
                    f"actor {actor.get('actor', '<unknown>')}: {error}"
                )
    for name in (
        owned_container,
        str(lease.get("buildContainerName") or ""),
    ):
        if not name:
            continue
        try:
            _docker_remove(name)
        except RuntimeError as error:
            failures.append(str(error))
    try:
        _clean_source(
            str(lease.get("sourcePath") or ""),
            str(lease.get("sourceCommit") or ""),
        )
    except RuntimeError as error:
        failures.append(str(error))
    try:
        _assert_ports_released(
            tuple(
                int(port)
                for port in lease.get("ports", ())
                if int(port) > 0
            )
        )
    except (TypeError, ValueError, RuntimeError) as error:
        failures.append(str(error))
    if failures:
        lease["cleanupState"] = "CLEANUP_FAILED"
        lease["cleanupErrors"] = failures
        _write_json(lease_path, lease)
        raise RuntimeError("; ".join(failures))
    try:
        _remove_tree(run_root)
    except (OSError, RuntimeError) as error:
        lease["cleanupState"] = "CLEANUP_FAILED"
        lease["cleanupErrors"] = [
            f"runtime-cell run storage cleanup failed: {error}"
        ]
        _write_json(lease_path, lease)
        raise RuntimeError("; ".join(lease["cleanupErrors"])) from error
    try:
        _remove_tree(lease_dir)
    except (OSError, RuntimeError) as error:
        if lease_path.exists():
            lease["cleanupState"] = "CLEANUP_FAILED"
            lease["cleanupErrors"] = [
                f"runtime-cell lease cleanup failed: {error}"
            ]
            _write_json(lease_path, lease)
        raise RuntimeError(
            f"runtime-cell lease cleanup failed: {error}"
        ) from error
    return True


def acquire(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    run_id = _slug(args.run_id, "run id")
    container_name = _slug(args.container_name, "container name")
    build_container_name = _slug(
        args.build_container_name,
        "build container name",
    )
    cell_root = root / cell_id
    lease_dir = cell_root / "lease"
    lease_path = lease_dir / "lease.json"

    ports = (
        args.webdriver_port,
        args.gateway_port,
        args.observer_port,
    )
    if any(port < 1 or port > 65535 for port in ports):
        raise ValueError("runtime-cell ports must be between 1 and 65535")
    if len(set(ports)) != len(ports):
        raise ValueError("runtime-cell ports must be distinct")

    cell_root.mkdir(parents=True, exist_ok=True)
    try:
        lease_dir.mkdir()
    except FileExistsError:
        existing = _read_json(lease_path)
        expires_at = int(existing.get("expiresAtEpoch") or 0)
        existing_run = str(existing.get("runId") or "")
        existing_container = str(existing.get("containerName") or container_name)
        if expires_at > int(time.time()) or not existing_run:
            sys.stderr.write(
                "runtime cell lease is active or has invalid ownership metadata\n"
            )
            return 73
        _cleanup_owned_run(
            cell_root,
            run_id=existing_run,
            container_name=existing_container,
            stop_reaper=True,
        )
        lease_dir.mkdir()

    run_root = cell_root / "runs" / run_id
    run_root.mkdir(parents=True)
    control_path = run_root / "remote_control.py"
    shutil.copy2(Path(__file__).resolve(), control_path)
    os.chmod(control_path, 0o700)
    lease = {
        "cellId": cell_id,
        "runId": run_id,
        "containerName": container_name,
        "buildContainerName": build_container_name,
        "sourcePath": _relative_path(args.source_path, "source path"),
        "sourceCommit": _commit(args.source_commit),
        "expiresAtEpoch": args.expires_at,
        "reaperPid": 0,
        "ports": list(ports),
        "actors": [],
        "cleanupState": "REGISTERED",
    }
    _write_json(lease_path, lease)
    try:
        lease["reaperPid"] = _spawn_reaper(
            control_path,
            runtime_root=args.runtime_root,
            cell_id=cell_id,
            run_id=run_id,
            container_name=container_name,
            expires_at=args.expires_at,
        )
    except OSError:
        shutil.rmtree(run_root, ignore_errors=True)
        shutil.rmtree(lease_dir, ignore_errors=True)
        raise
    _write_json(lease_path, lease)
    sys.stdout.write(
        json.dumps(
            {
                "cellRoot": str(cell_root),
                "runRoot": str(run_root),
                "controlPath": str(control_path),
                "lease": lease,
            },
            sort_keys=True,
        )
        + "\n"
    )
    return 0


def start_reaper(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    run_id = _slug(args.run_id, "run id")
    container_name = _slug(args.container_name, "container name")
    lease_path = root / cell_id / "lease" / "lease.json"
    lease = _read_json(lease_path)
    if lease.get("runId") != run_id:
        sys.stderr.write("runtime cell lease ownership changed before reaper start\n")
        return 74

    existing_pid = int(lease.get("reaperPid") or 0)
    if existing_pid > 0 and (Path("/proc") / str(existing_pid)).exists():
        sys.stdout.write(json.dumps({"reaperPid": existing_pid}) + "\n")
        return 0
    process_id = _spawn_reaper(
        Path(__file__).resolve(),
        runtime_root=args.runtime_root,
        cell_id=cell_id,
        run_id=run_id,
        container_name=container_name,
        expires_at=args.expires_at,
    )
    lease["reaperPid"] = process_id
    _write_json(lease_path, lease)
    sys.stdout.write(json.dumps({"reaperPid": process_id}) + "\n")
    return 0


def reap(args: argparse.Namespace) -> int:
    delay = max(0, args.expires_at - int(time.time()))
    time.sleep(delay)
    root = _runtime_root(args.runtime_root)
    cell_root = root / _slug(args.cell_id, "cell id")
    _cleanup_owned_run(
        cell_root,
        run_id=_slug(args.run_id, "run id"),
        container_name=_slug(args.container_name, "container name"),
        stop_reaper=False,
    )
    return 0


def stop(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_root = root / _slug(args.cell_id, "cell id")
    stopped = _cleanup_owned_run(
        cell_root,
        run_id=_slug(args.run_id, "run id"),
        container_name=_slug(args.container_name, "container name"),
        stop_reaper=True,
    )
    sys.stdout.write(json.dumps({"stopped": stopped}) + "\n")
    return 0 if stopped else 75


def status(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    lease = _read_json(root / cell_id / "lease" / "lease.json")
    if not lease:
        sys.stdout.write(json.dumps({"cellId": cell_id, "state": "CLEANED"}) + "\n")
        return 0
    container_name = str(lease.get("containerName") or "")
    inspected = subprocess.run(
        ("docker", "inspect", "--format", "{{.State.Status}}", container_name),
        capture_output=True,
        text=True,
        check=False,
    )
    sys.stdout.write(
        json.dumps(
            {
                "cellId": cell_id,
                "state": (
                    "CLEANUP_FAILED"
                    if lease.get("cleanupState") == "CLEANUP_FAILED"
                    else "LEASED"
                ),
                "runId": lease.get("runId"),
                "expiresAtEpoch": lease.get("expiresAtEpoch"),
                "container": inspected.stdout.strip() or "missing",
                "cleanupState": lease.get("cleanupState"),
                "cleanupErrors": lease.get("cleanupErrors", []),
                "actors": lease.get("actors", []),
            },
            sort_keys=True,
        )
        + "\n"
    )
    return 0


def actor_start(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    run_id = _slug(args.run_id, "run id")
    container_name = _slug(args.container_name, "container name")
    actor = _slug(args.actor, "actor")
    profile = _slug(args.profile, "profile")
    webdriver_port = _port(args.webdriver_port, "WebDriver port")
    gateway_port = _port(args.gateway_port, "gateway port")
    if webdriver_port == gateway_port:
        raise ValueError("actor WebDriver and gateway ports must be distinct")
    environment = _actor_environment(args.environment_json)
    lease_path, lease = _owned_lease(
        root,
        cell_id=cell_id,
        run_id=run_id,
        container_name=container_name,
    )
    existing = _actor_record(lease, actor)
    if existing is not None:
        sys.stdout.write(json.dumps(existing, sort_keys=True) + "\n")
        return 0
    actors = lease.get("actors")
    if not isinstance(actors, list):
        raise RuntimeError("runtime-cell actor registry is invalid")
    allocated_ports = {
        int(port)
        for item in actors
        if isinstance(item, dict)
        for port in (
            item.get("webdriverPort"),
            item.get("gatewayPort"),
        )
        if int(port or 0) > 0
    }
    requested_ports = {webdriver_port, gateway_port}
    if allocated_ports & requested_ports:
        raise RuntimeError("runtime-cell actor ports are already allocated")

    cell_root = root / cell_id
    run_root = cell_root / "runs" / run_id
    actor_root = run_root / "actors" / actor
    container_actor_root = f"/workspace/run/actors/{actor}"
    _container_command(
        container_name,
        "mkdir",
        "-p",
        f"{container_actor_root}/home",
        f"{container_actor_root}/runtime",
        f"{container_actor_root}/storage",
    )
    launch = [
        "docker",
        "exec",
        "--detach",
        "--env",
        f"DISPLAY={args.display}",
        "--env",
        f"TAURI_WEBDRIVER_PORT={webdriver_port}",
        "--env",
        f"PT_GATEWAY_PORT={gateway_port}",
        "--env",
        f"PT_PROFILE={profile}",
        "--env",
        f"PEERS_STORAGE_ROOT={container_actor_root}/storage",
        "--env",
        f"HOME={container_actor_root}/home",
        "--env",
        f"XDG_RUNTIME_DIR={container_actor_root}/runtime",
        "--env",
        f"PT_ACTOR_ROOT={container_actor_root}",
    ]
    for name, value in sorted(environment.items()):
        launch.extend(("--env", f"{name}={value}"))
    launch.extend(
        (
            container_name,
            "/bin/bash",
            "-lc",
            (
                "set -euo pipefail; "
                "export DBUS_SESSION_BUS_ADDRESS="
                "\"$(sed -n '1p' /workspace/run/dbus.state)\"; "
                "setsid \"$PT_CELL_APP_BINARY\" "
                ">\"$PT_ACTOR_ROOT/app.log\" 2>&1 & "
                "actor_pid=$!; "
                "printf '%s\\n' \"$actor_pid\" > \"$PT_ACTOR_ROOT/app.pid\"; "
                "wait \"$actor_pid\""
            ),
        )
    )
    completed = subprocess.run(
        tuple(launch),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        _remove_tree(actor_root)
        raise RuntimeError(
            f"runtime-cell actor {actor} launch failed: {detail[-4000:]}"
        )
    try:
        deadline = time.monotonic() + args.timeout
        pid_path = actor_root / "app.pid"
        while time.monotonic() < deadline and not pid_path.is_file():
            time.sleep(0.05)
        process_id = int(pid_path.read_text(encoding="utf-8").strip())
        _wait_actor_port(
            container_name,
            process_id,
            webdriver_port,
            deadline,
        )
        _wait_actor_port(
            container_name,
            process_id,
            gateway_port,
            deadline,
        )
    except (OSError, RuntimeError, ValueError):
        if pid_path.is_file():
            _stop_actor_record(
                container_name,
                run_root,
                {"actor": actor, "processId": pid_path.read_text().strip()},
            )
        else:
            _remove_tree(actor_root)
        raise
    record: dict[str, object] = {
        "actor": actor,
        "processId": process_id,
        "webdriverPort": webdriver_port,
        "gatewayPort": gateway_port,
        "profile": profile,
        "storageRoot": f"{container_actor_root}/storage",
        "logPath": f"{container_actor_root}/app.log",
    }
    actors.append(record)
    lease["actors"] = actors
    lease["ports"] = [
        *lease.get("ports", []),
        webdriver_port,
        gateway_port,
    ]
    _write_json(lease_path, lease)
    sys.stdout.write(json.dumps(record, sort_keys=True) + "\n")
    return 0


def actor_stop(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    run_id = _slug(args.run_id, "run id")
    container_name = _slug(args.container_name, "container name")
    actor = _slug(args.actor, "actor")
    lease_path, lease = _owned_lease(
        root,
        cell_id=cell_id,
        run_id=run_id,
        container_name=container_name,
    )
    record = _actor_record(lease, actor)
    if record is None:
        sys.stdout.write(
            json.dumps(
                {"actor": actor, "alreadyStopped": True, "stopped": False},
                sort_keys=True,
            )
            + "\n"
        )
        return 0
    result = _stop_actor_record(
        container_name,
        root / cell_id / "runs" / run_id,
        record,
    )
    stopped_ports = {
        int(record.get("webdriverPort") or 0),
        int(record.get("gatewayPort") or 0),
    }
    _assert_ports_released(
        tuple(port for port in stopped_ports if port > 0)
    )
    actors = [
        item
        for item in lease.get("actors", [])
        if isinstance(item, dict) and item.get("actor") != actor
    ]
    lease["actors"] = actors
    lease["ports"] = [
        port
        for port in lease.get("ports", [])
        if int(port) not in stopped_ports
    ]
    _write_json(lease_path, lease)
    sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
    return 0


def adapter(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cell_id = _slug(args.cell_id, "cell id")
    run_id = _slug(args.run_id, "run id")
    container_name = _slug(args.container_name, "container name")
    _owned_lease(
        root,
        cell_id=cell_id,
        run_id=run_id,
        container_name=container_name,
    )
    if args.operation not in _ADAPTER_OPERATIONS:
        raise ValueError("unsupported remote Native adapter operation")
    payload = base64.b64decode(args.payload).decode("utf-8")
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise ValueError("remote Native adapter payload must be an object")
    encoded = base64.b64encode(
        json.dumps(parsed, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    dbus = _container_command(
        container_name,
        "sed",
        "-n",
        "1p",
        "/workspace/run/dbus.state",
        timeout=args.timeout,
    ).stdout.strip()
    if not dbus:
        raise RuntimeError(
            "runtime-cell D-Bus session address is unavailable"
        )
    completed = _container_command(
        container_name,
        "env",
        f"DBUS_SESSION_BUS_ADDRESS={dbus}",
        "NO_AT_BRIDGE=0",
        "PYTHONPATH=/workspace/source",
        "python3",
        "-c",
        _ADAPTER_SCRIPT,
        args.operation,
        encoded,
        timeout=args.timeout,
    )
    sys.stdout.write(completed.stdout)
    return 0


def _cache_entry_stats(path: Path) -> tuple[float, int]:
    descendants = (
        tuple(path.rglob("*"))
        if path.is_dir() and not path.is_symlink()
        else ()
    )
    entries = (path, *descendants)
    latest_mtime = max(entry.lstat().st_mtime for entry in entries)
    file_count = sum(
        entry.is_file() or entry.is_symlink()
        for entry in entries
    )
    return latest_mtime, file_count


def prune(args: argparse.Namespace) -> int:
    root = _runtime_root(args.runtime_root)
    cache_root = _runtime_root(args.cache_root)
    cutoff = time.time() - args.retention_days * 86400
    removed: list[str] = []
    for cell_root in root.iterdir() if root.is_dir() else ():
        runs_root = cell_root / "runs"
        active_run_id = str(
            _read_json(cell_root / "lease" / "lease.json").get("runId")
            or ""
        )
        for run_root in runs_root.iterdir() if runs_root.is_dir() else ():
            if (
                run_root.name == active_run_id
                or run_root.stat().st_mtime >= cutoff
            ):
                continue
            _remove_tree(run_root)
            removed.append(run_root.name)
    removed_cache_entries: list[str] = []
    removed_cache_files = 0
    for path in cache_root.iterdir() if cache_root.is_dir() else ():
        if path.lstat().st_mtime >= cutoff:
            continue
        latest_mtime, file_count = _cache_entry_stats(path)
        if latest_mtime >= cutoff:
            continue
        if path.is_dir() and not path.is_symlink():
            _remove_tree(path)
        else:
            path.unlink()
        removed_cache_entries.append(path.name)
        removed_cache_files += file_count
    sys.stdout.write(
        json.dumps(
            {
                "removedRunIds": sorted(removed),
                "removedCacheEntries": sorted(removed_cache_entries),
                "removedCacheFiles": removed_cache_files,
            }
        )
        + "\n"
    )
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Remote Linux runtime-cell control")
    subparsers = result.add_subparsers(dest="command", required=True)

    for name in ("acquire", "start-reaper", "reap", "stop"):
        command = subparsers.add_parser(name)
        command.add_argument("--runtime-root", required=True)
        command.add_argument("--cell-id", required=True)
        command.add_argument("--run-id", required=True)
        command.add_argument("--container-name", required=True)
        if name in ("acquire", "start-reaper", "reap"):
            command.add_argument("--expires-at", type=int, required=True)
        if name == "acquire":
            command.add_argument("--build-container-name", required=True)
            command.add_argument("--source-path", required=True)
            command.add_argument("--source-commit", required=True)
            command.add_argument("--webdriver-port", type=int, required=True)
            command.add_argument("--gateway-port", type=int, required=True)
            command.add_argument("--observer-port", type=int, required=True)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--runtime-root", required=True)
    status_parser.add_argument("--cell-id", required=True)

    for name in ("actor-start", "actor-stop"):
        command = subparsers.add_parser(name)
        command.add_argument("--runtime-root", required=True)
        command.add_argument("--cell-id", required=True)
        command.add_argument("--run-id", required=True)
        command.add_argument("--container-name", required=True)
        command.add_argument("--actor", required=True)
        if name == "actor-start":
            command.add_argument("--display", required=True)
            command.add_argument("--webdriver-port", type=int, required=True)
            command.add_argument("--gateway-port", type=int, required=True)
            command.add_argument("--profile", required=True)
            command.add_argument("--environment-json", required=True)
            command.add_argument("--timeout", type=float, default=30)

    adapter_parser = subparsers.add_parser("adapter")
    adapter_parser.add_argument("--runtime-root", required=True)
    adapter_parser.add_argument("--cell-id", required=True)
    adapter_parser.add_argument("--run-id", required=True)
    adapter_parser.add_argument("--container-name", required=True)
    adapter_parser.add_argument("--operation", required=True)
    adapter_parser.add_argument("--payload", required=True)
    adapter_parser.add_argument("--timeout", type=float, default=30)

    prune_parser = subparsers.add_parser("prune")
    prune_parser.add_argument("--runtime-root", required=True)
    prune_parser.add_argument("--cache-root", required=True)
    prune_parser.add_argument("--retention-days", type=int, required=True)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        return {
            "acquire": acquire,
            "start-reaper": start_reaper,
            "reap": reap,
            "stop": stop,
            "status": status,
            "actor-start": actor_start,
            "actor-stop": actor_stop,
            "adapter": adapter,
            "prune": prune,
        }[args.command](args)
    except (
        OSError,
        RuntimeError,
        ValueError,
        subprocess.SubprocessError,
    ) as error:
        sys.stderr.write(f"remote runtime-cell control failed: {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
