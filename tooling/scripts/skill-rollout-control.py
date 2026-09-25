#!/usr/bin/env python3
"""Atomic, machine-local control plane for project Skill rollout."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


LIVE_DECLARATION_STATES = {"DECLARED", "ACTIVE", "RELEASING"}
LOCK_TIMEOUT_SECONDS = 10
SESSION_ENV = {
    "trae": ("ICUBE_CODEMAIN_SESSION", "PT_AGENT_SESSION_ID"),
    "cursor": ("CURSOR_SESSION_ID", "CURSOR_TRACE_ID", "PT_AGENT_SESSION_ID"),
    "codex": ("CODEX_THREAD_ID", "CODEX_SESSION_ID", "PT_AGENT_SESSION_ID"),
}
RECEIPT_KEYS = {
    "kind",
    "state",
    "workspaceId",
    "branch",
    "sourceHead",
    "host",
    "installedAt",
    "installedSessionHash",
    "acknowledgedAt",
    "ackSessionHash",
    "catalogDigest",
    "catalogEntryCount",
    "catalogGitState",
    "catalogStatusDigest",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "ack"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", required=True, choices=("trae", "cursor", "codex"))
    return parser.parse_args()


def machine_root() -> Path:
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    return Path(override) if override else Path.home() / ".peers-touch" / "dev"


def identity(root: Path) -> tuple[str, str, str]:
    canonical = root.resolve(strict=True)
    workspace_id = hashlib.sha256(str(canonical).encode()).hexdigest()[:16]
    branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not branch or not head:
        raise RuntimeError("worktree identity is incomplete")
    return workspace_id, branch, head


def host_session_hash(host: str) -> str:
    values = {
        os.environ.get(name, "").strip()
        for name in SESSION_ENV[host]
        if os.environ.get(name, "").strip()
    }
    if len(values) > 1:
        raise RuntimeError("HOST_SESSION_ID_AMBIGUOUS")
    if values:
        value = next(iter(values))
        return hashlib.sha256(f"{host}\0{value}".encode()).hexdigest()
    raise RuntimeError(
        "HOST_SESSION_ID_UNAVAILABLE: set PT_AGENT_SESSION_ID or use a "
        f"{host} host that exposes a stable session identifier"
    )


def canonical_skill_catalog(
    root: Path,
) -> tuple[list[Path], dict[str, object]]:
    source_root = root / "tooling" / "skills"
    if (
        source_root.is_symlink()
        or not source_root.is_dir()
        or source_root.resolve(strict=True) != root / "tooling" / "skills"
    ):
        raise RuntimeError(
            f"CANONICAL_SKILL_SOURCE_INVALID: {source_root} is not worktree-local"
        )
    sources: list[Path] = []
    entries: list[dict[str, object]] = []
    for item in sorted(source_root.glob("pt-*")):
        if item.is_symlink():
            raise RuntimeError(
                f"CANONICAL_SKILL_SOURCE_INVALID: {item} is a symlink"
            )
        skill_file = item / "SKILL.md"
        if not item.is_dir() or not skill_file.is_file():
            continue
        if skill_file.is_symlink() or item.resolve(strict=True).parent != source_root:
            raise RuntimeError(
                f"CANONICAL_SKILL_SOURCE_INVALID: {item} escapes tooling/skills"
            )
        sources.append(item)
        for candidate in sorted(item.rglob("*")):
            if candidate.is_symlink():
                raise RuntimeError(
                    f"CANONICAL_SKILL_SOURCE_INVALID: {candidate} is a symlink"
                )
            if not candidate.is_file():
                continue
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(source_root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    if not sources:
        raise RuntimeError(f"canonical project Skills are missing: {source_root}")
    serialized = json.dumps(
        entries,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    status = subprocess.run(
        [
            "git",
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            "tooling/skills",
        ],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return sources, {
        "catalogDigest": hashlib.sha256(serialized).hexdigest(),
        "catalogEntryCount": len(entries),
        "catalogGitState": "CLEAN" if not status else "DIRTY",
        "catalogStatusDigest": hashlib.sha256(status).hexdigest(),
    }


def receipt_path(workspace_id: str) -> Path:
    return (
        machine_root()
        / "workspaces"
        / workspace_id
        / "workflow"
        / "skill-rollout.json"
    )


def process_start_identity(pid: int) -> str | None:
    command = (
        [
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            (
                f"(Get-Process -Id {pid} -ErrorAction Stop)."
                'StartTime.ToUniversalTime().ToString("o")'
            ),
        ]
        if os.name == "nt"
        else ["ps", "-o", "lstart=", "-p", str(pid)]
    )
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    value = completed.stdout.strip()
    return value or None


def atomic_move_no_replace(source: Path, destination: Path) -> bool:
    try:
        if os.sys.platform == "win32":
            function = ctypes.WinDLL(
                "kernel32",
                use_last_error=True,
            ).MoveFileExW
            function.argtypes = [
                ctypes.c_wchar_p,
                ctypes.c_wchar_p,
                ctypes.c_uint,
            ]
            function.restype = ctypes.c_int
            result = function(str(source), str(destination), 0x00000008)
            if result == 0:
                error_number = ctypes.get_last_error()
                if error_number in {80, 183}:
                    return False
                if error_number in {2, 3}:
                    return False
                raise OSError(error_number, os.strerror(error_number))
            return True
        elif os.sys.platform == "darwin":
            libc = ctypes.CDLL(None, use_errno=True)
            function = libc.renamex_np
            function.argtypes = [
                ctypes.c_char_p,
                ctypes.c_char_p,
                ctypes.c_uint,
            ]
            function.restype = ctypes.c_int
            result = function(
                os.fsencode(source),
                os.fsencode(destination),
                0x00000004,
            )
        elif os.sys.platform.startswith("linux"):
            libc = ctypes.CDLL(None, use_errno=True)
            function = libc.renameat2
            function.argtypes = [
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_int,
                ctypes.c_char_p,
                ctypes.c_uint,
            ]
            function.restype = ctypes.c_int
            result = function(
                -100,
                os.fsencode(source),
                -100,
                os.fsencode(destination),
                0x00000001,
            )
        else:
            raise OSError(
                errno.ENOTSUP,
                "atomic rename primitive is unavailable",
            )
    except AttributeError as error:
        raise RuntimeError("MACHINE_WORK_LEDGER_LOCK_INVALID") from error
    if result == 0:
        return True
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOENT}:
        return False
    raise OSError(error_number, os.strerror(error_number))


class WorkLedgerLock:
    def __init__(self) -> None:
        self.path = machine_root() / "work.lock"
        self.recovery_path = Path(f"{self.path}.recovery")
        self.metadata: dict[str, object] | None = None

    def _recovery_metadata(self) -> dict[str, object] | None:
        try:
            value = json.loads(self.recovery_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        if (
            not isinstance(value, dict)
            or set(value)
            != {"pid", "processStart", "createdAt", "lockDev", "lockIno"}
            or not isinstance(value.get("pid"), int)
            or int(value["pid"]) <= 0
            or not isinstance(value.get("processStart"), str)
            or not value["processStart"]
            or timestamp(value.get("createdAt")) is None
            or not isinstance(value.get("lockDev"), int)
            or int(value["lockDev"]) < 0
            or not isinstance(value.get("lockIno"), int)
            or int(value["lockIno"]) < 0
        ):
            raise RuntimeError("MACHINE_WORK_LEDGER_LOCK_INVALID")
        return value

    def _clear_stale_recovery(self) -> bool:
        value = self._recovery_metadata()
        if value is None:
            return True
        actual_start = process_start_identity(int(value["pid"]))
        if actual_start == value["processStart"]:
            return False
        return self._capture_owned_file(
            self.recovery_path,
            value,
            "recovery claim",
        )

    def _capture_owned_file(
        self,
        source: Path,
        expected: dict[str, object] | None,
        label: str,
    ) -> bool:
        if expected is None:
            return False
        capture = source.with_name(
            f"{source.name}.capture.{os.getpid()}.{os.urandom(16).hex()}"
        )
        if not atomic_move_no_replace(source, capture):
            return False
        try:
            captured = json.loads(capture.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            if not atomic_move_no_replace(capture, source):
                raise RuntimeError(
                    f"{label} changed during atomic capture"
                ) from error
            raise RuntimeError(
                f"{label} metadata is invalid"
            ) from error
        if captured != expected:
            if not atomic_move_no_replace(capture, source):
                raise RuntimeError(f"{label} changed during atomic capture")
            return False
        capture.unlink()
        return True

    def _remove_owned_lock(self) -> bool:
        return self._capture_owned_file(
            self.path,
            self.metadata,
            "work ledger lock",
        )

    def __enter__(self) -> "WorkLedgerLock":
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        timeout = float(
            os.environ.get(
                "PT_SKILL_ROLLOUT_LOCK_TIMEOUT_SECONDS",
                str(LOCK_TIMEOUT_SECONDS),
            )
        )
        deadline = time.monotonic() + timeout
        while True:
            if self.recovery_path.exists():
                if self._clear_stale_recovery():
                    continue
                if time.monotonic() >= deadline:
                    raise RuntimeError("MACHINE_WORK_LEDGER_LOCKED")
                time.sleep(0.05)
                continue
            process_start = process_start_identity(os.getpid())
            if process_start is None:
                raise RuntimeError("cannot establish rollout lock process identity")
            metadata = {
                "pid": os.getpid(),
                "processStart": process_start,
                "createdAt": datetime.now(timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            }
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=".work.lock.tmp-",
                dir=self.path.parent,
            )
            temporary = Path(temporary_name)
            try:
                if hasattr(os, "fchmod"):
                    os.fchmod(descriptor, 0o600)
                os.write(descriptor, (json.dumps(metadata) + "\n").encode())
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            try:
                os.link(temporary, self.path)
                self.metadata = metadata
                if self.recovery_path.exists():
                    if not self._remove_owned_lock():
                        raise RuntimeError("work ledger lock ownership changed")
                    self.metadata = None
                    continue
                return self
            except FileExistsError:
                # The Development ledger owner is the only component allowed
                # to recover its stale lock. Rollout never removes a lock it
                # did not create, which prevents dual-owner stale-lock races.
                if time.monotonic() >= deadline:
                    raise RuntimeError("MACHINE_WORK_LEDGER_LOCKED")
                time.sleep(0.05)
            finally:
                temporary.unlink(missing_ok=True)

    def __exit__(self, *_: object) -> None:
        if self.metadata is None:
            return
        if not self._remove_owned_lock():
            raise RuntimeError("work ledger lock ownership changed")


def validated_work_ledger(root: Path) -> dict[str, object]:
    ledger = machine_root() / "work.json"
    if not ledger.is_file():
        return {"declarations": {}}
    validator = root / "tooling/scripts/local-dev/dev-work-ledger.mjs"
    if not validator.is_file():
        raise RuntimeError("MACHINE_WORK_LEDGER_VALIDATOR_MISSING")
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            (
                "import { pathToFileURL } from 'node:url';"
                "const [modulePath, ledgerPath] = process.argv.slice(-2);"
                "const owner = await import(pathToFileURL(modulePath));"
                "console.log(JSON.stringify(owner.readLedger(ledgerPath)));"
            ),
            str(validator),
            str(ledger),
        ],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "MACHINE_WORK_LEDGER_INVALID"
        )
    value = json.loads(completed.stdout)
    if not isinstance(value, dict) or not isinstance(
        value.get("declarations"), dict
    ):
        raise RuntimeError("MACHINE_WORK_LEDGER_INVALID")
    return value


def active_declaration(
    root: Path,
    workspace_id: str,
) -> dict[str, object] | None:
    value = validated_work_ledger(root)
    candidates = [
        item
        for item in value.get("declarations", {}).values()
        if isinstance(item, dict)
        and item.get("workspaceId") == workspace_id
        and item.get("state") in LIVE_DECLARATION_STATES
    ]
    return max(candidates, key=lambda item: item.get("heartbeatAt", "")) if candidates else None


def write_receipt(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.tmp-",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        os.write(
            descriptor,
            (json.dumps(value, indent=2, sort_keys=True) + "\n").encode(),
        )
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def is_digest(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def require_no_live_declaration(root: Path, workspace_id: str) -> None:
    active = active_declaration(root, workspace_id)
    if active is None:
        return
    raise RuntimeError(
        "ACTIVE_ACTION_IN_FLIGHT: "
        f"{active.get('workItemId')} is {active.get('state')}"
    )


def host_root(root: Path, host: str) -> Path:
    candidate = root / (".agents" if host == "codex" else f".{host}")
    if candidate.is_symlink():
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {candidate} is a symlink")
    candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
    if candidate.resolve(strict=True).parent != root:
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {candidate} leaves the worktree")
    return candidate


def retire(path: Path, retired_root: Path) -> None:
    if path.is_symlink():
        path.unlink()
        return
    if not path.exists():
        return
    if retired_root.is_symlink():
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {retired_root} is a symlink"
        )
    retired_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if retired_root.resolve(strict=True).parent != retired_root.parent:
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {retired_root} leaves its host root"
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    destination = retired_root / f"{path.name}.{stamp}"
    path.rename(destination)
    print(f"retired existing project skill: {destination}")


def install(root: Path, host: str, workspace_id: str, branch: str, head: str) -> None:
    installing_session = host_session_hash(host)
    sources, catalog = canonical_skill_catalog(root)
    target_root = host_root(root, host)
    skills_root = target_root / "skills"
    if skills_root.is_symlink():
        skills_root.unlink()
    skills_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if skills_root.resolve(strict=True).parent != target_root:
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {skills_root} leaves its host root")
    retired_root = target_root / "retired-project-skills"
    retire(skills_root / "pt-trae-goal-orchestrator", retired_root)
    for source in sources:
        destination = skills_root / source.name
        retire(destination, retired_root)
        destination.symlink_to(source.resolve(strict=True), target_is_directory=True)
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    write_receipt(
        receipt_path(workspace_id),
        {
            "kind": "peers-touch-skill-rollout",
            "state": "ROLLOUT_RESTART_REQUIRED",
            "workspaceId": workspace_id,
            "branch": branch,
            "sourceHead": head,
            "host": host,
            "installedAt": now,
            "installedSessionHash": installing_session,
            "acknowledgedAt": None,
            "ackSessionHash": None,
            **catalog,
        },
    )
    print(f"linked {len(sources)} project pt-* skills under {skills_root}")
    print(json.dumps({"status": "ROLLOUT_RESTART_REQUIRED"}))


def acknowledge(
    root: Path,
    host: str,
    workspace_id: str,
    branch: str,
    head: str,
) -> None:
    receipt = receipt_path(workspace_id)
    if not receipt.is_file():
        raise RuntimeError("ROLLOUT_RECEIPT_MISSING")
    value = json.loads(receipt.read_text(encoding="utf-8"))
    current_session = host_session_hash(host)
    _, catalog = canonical_skill_catalog(root)
    installed_at = timestamp(value.get("installedAt"))
    installed_session = value.get("installedSessionHash")
    if (
        set(value) != RECEIPT_KEYS
        or value.get("kind") != "peers-touch-skill-rollout"
        or value.get("state") != "ROLLOUT_RESTART_REQUIRED"
        or value.get("workspaceId") != workspace_id
        or value.get("branch") != branch
        or value.get("sourceHead") != head
        or value.get("host") != host
        or installed_at is None
        or not is_digest(installed_session)
        or value.get("acknowledgedAt") is not None
        or value.get("ackSessionHash") is not None
        or any(value.get(key) != expected for key, expected in catalog.items())
    ):
        raise RuntimeError("ROLLOUT_ACK_MISMATCH")
    if installed_session == current_session:
        raise RuntimeError("ROLLOUT_RESTART_NOT_OBSERVED")
    value["state"] = "ACKNOWLEDGED"
    value["acknowledgedAt"] = datetime.now(timezone.utc).isoformat(
        timespec="milliseconds"
    )
    value["ackSessionHash"] = current_session
    write_receipt(receipt, value)
    print(json.dumps({"status": "PASS", "path": str(receipt)}))


def main() -> int:
    options = parse_args()
    root = Path(os.path.realpath(os.path.abspath(options.root)))
    workspace_id, branch, head = identity(root)
    try:
        with WorkLedgerLock():
            require_no_live_declaration(root, workspace_id)
            if options.action == "install":
                install(root, options.host, workspace_id, branch, head)
            else:
                acknowledge(root, options.host, workspace_id, branch, head)
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "BLOCKED", "code": str(error)}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
