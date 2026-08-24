#!/usr/bin/env python3
from __future__ import annotations

import argparse
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
    if not path.exists():
        return
    shutil.rmtree(path)
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
        _remove_tree(cell_root / "runs" / run_id)
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
            },
            sort_keys=True,
        )
        + "\n"
    )
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
