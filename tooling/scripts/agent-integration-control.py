#!/usr/bin/env python3
"""Atomic control plane for worktree projections and conversation hooks."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


LIVE_DECLARATION_STATES = {"DECLARED", "ACTIVE", "RELEASING"}
LOCK_TIMEOUT_SECONDS = 10
PLUGIN_NAME = "pt-ew-plugin"
TRAE_HOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "Stop",
)
CURSOR_HOOK_EVENTS = (
    ("sessionStart", "sessionStart"),
    ("beforeSubmitPrompt", "beforeSubmitPrompt"),
    ("preToolUse", "preToolUse"),
    ("stop", "stop"),
)
TRAE_CALLBACK_PROOF = {
    "status": "PASS",
    "hostEvent": "PreToolUse",
    "permissionDecision": "deny",
    "code": "TOOL_INTENT_UNSUPPORTED",
}
WORKFLOW_KERNEL_FILES = (
    "tooling/scripts/architecture/module-governance.mjs",
    "tooling/scripts/local-dev/workflow-action-store.mjs",
    "tooling/scripts/local-dev/workflow-anchor.mjs",
    "tooling/scripts/local-dev/workflow-binding-projection.mjs",
    "tooling/scripts/local-dev/workflow-binding-store.mjs",
    "tooling/scripts/local-dev/workflow-binding.mjs",
    "tooling/scripts/local-dev/workflow-host-adapters.mjs",
    "tooling/scripts/local-dev/workflow-kernel.mjs",
    "tooling/scripts/local-dev/workflow-state-inspector.mjs",
    "tooling/scripts/local-dev/workflow-tool-intent.mjs",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install",))
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", required=True, choices=("trae", "cursor", "codex"))
    parser.add_argument("--workspace")
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


def read_workspace_descriptor(path: Path) -> tuple[Path, tuple[Path, ...]]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
    descriptor = path.resolve(strict=True)
    try:
        value = json.loads(descriptor.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID") from error
    folders = value.get("folders") if isinstance(value, dict) else None
    if not isinstance(folders, list) or not folders:
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
    roots: list[Path] = []
    for folder in folders:
        folder_path = (
            folder
            if isinstance(folder, str)
            else folder.get("path")
            if isinstance(folder, dict)
            else None
        )
        if not isinstance(folder_path, str) or not folder_path.strip():
            raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
        try:
            candidate = (descriptor.parent / folder_path).resolve(strict=True)
        except FileNotFoundError:
            continue
        except OSError as error:
            raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID") from error
        if not candidate.is_dir():
            continue
        if candidate not in roots:
            roots.append(candidate)
    if not roots:
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
    return descriptor, tuple(roots)


def resolve_trae_workspace(
    root: Path,
    requested: str | None = None,
) -> tuple[Path | None, tuple[Path, ...], Path]:
    explicit = requested or os.environ.get("PT_TRAE_WORKSPACE_FILE", "").strip()
    if explicit:
        descriptor, roots = read_workspace_descriptor(Path(explicit))
    else:
        matches: list[tuple[Path, tuple[Path, ...]]] = []
        for candidate in sorted(root.parent.glob("*.code-workspace")):
            try:
                descriptor, roots = read_workspace_descriptor(candidate)
            except RuntimeError:
                continue
            if root in roots:
                matches.append((descriptor, roots))
        if len(matches) > 1:
            raise RuntimeError("TRAE_WORKSPACE_SELECTION_AMBIGUOUS")
        if not matches:
            return None, (root,), root
        descriptor, roots = matches[0]
    if root not in roots:
        raise RuntimeError("TRAE_WORKSPACE_ROOT_MISMATCH")
    return descriptor, roots, roots[0]


def canonical_integration_catalog(
    root: Path,
) -> tuple[list[Path], Path, dict[str, object]]:
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
                    "path": candidate.relative_to(root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    if not sources:
        raise RuntimeError(f"canonical project Skills are missing: {source_root}")
    plugin = root / "tooling" / "plugins" / PLUGIN_NAME
    required_plugin_files = (
        plugin / ".codex-plugin" / "plugin.json",
        plugin / "hooks.json",
        plugin / "scripts" / "hook-entry.mjs",
    )
    if plugin.is_symlink() or not plugin.is_dir():
        raise RuntimeError(f"CANONICAL_PLUGIN_SOURCE_INVALID: {plugin}")
    if plugin.resolve(strict=True).parent != root / "tooling" / "plugins":
        raise RuntimeError(
            f"CANONICAL_PLUGIN_SOURCE_INVALID: {plugin} escapes tooling/plugins"
        )
    for candidate in sorted(plugin.rglob("*")):
        if candidate.is_symlink():
            raise RuntimeError(
                f"CANONICAL_PLUGIN_SOURCE_INVALID: {candidate} is a symlink"
            )
        if candidate.is_file():
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    if any(not candidate.is_file() for candidate in required_plugin_files):
        raise RuntimeError(
            f"CANONICAL_PLUGIN_SOURCE_INVALID: required files are missing under {plugin}"
        )
    for relative in WORKFLOW_KERNEL_FILES:
        source = root / relative
        if source.is_symlink() or not source.is_file():
            raise RuntimeError(f"CANONICAL_WORKFLOW_KERNEL_INVALID: {source}")
        content = source.read_bytes()
        entries.append(
            {
                "path": relative,
                "mode": source.stat().st_mode & 0o777,
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
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
            "tooling/plugins",
            *WORKFLOW_KERNEL_FILES,
        ],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return sources, plugin, {
        "integrationDigest": hashlib.sha256(serialized).hexdigest(),
        "integrationEntryCount": len(entries),
        "integrationGitState": "CLEAN" if not status else "DIRTY",
        "integrationStatusDigest": hashlib.sha256(status).hexdigest(),
    }


def receipt_path(workspace_id: str) -> Path:
    return (
        machine_root()
        / "workspaces"
        / workspace_id
        / "workflow"
        / "agent-integration.json"
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
                "PT_AGENT_INTEGRATION_LOCK_TIMEOUT_SECONDS",
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
                raise RuntimeError(
                    "cannot establish agent integration lock process identity"
                )
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


def inspect_workflow_liveness(
    root: Path,
    now: datetime,
) -> dict[str, object]:
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            (
                "import { pathToFileURL } from 'node:url';"
                "const [bindingPath, actionPath, machineRoot, now] = "
                "process.argv.slice(-4);"
                "try {"
                "const binding = await import(pathToFileURL(bindingPath));"
                "const action = await import(pathToFileURL(actionPath));"
                "const actions = action.inspectWorkflowActionLiveness({"
                "machineRoot, now"
                "});"
                "actions.liveReceipts = actions.liveReceipts.map((receipt) => ({"
                "...receipt,"
                "actorProjection: binding.readWorkflowProjectionByActor("
                "receipt.actor, { machineRoot, now }"
                ")"
                "}));"
                "console.log(JSON.stringify({"
                "bindings: binding.inspectWorkflowBindingLiveness({"
                "machineRoot, now"
                "}),"
                "actions"
                "}));"
                "} catch (error) {"
                "console.error(error?.code ?? error?.message ?? String(error));"
                "process.exit(2);"
                "}"
            ),
            str(root / "tooling/scripts/local-dev/workflow-binding-store.mjs"),
            str(root / "tooling/scripts/local-dev/workflow-action-store.mjs"),
            str(machine_root()),
            now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
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
            or "WORKFLOW_MACHINE_STATE_INVALID"
        )
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("WORKFLOW_MACHINE_STATE_INVALID") from error
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("bindings"), dict)
        or not isinstance(value.get("actions"), dict)
    ):
        raise RuntimeError("WORKFLOW_MACHINE_STATE_INVALID")
    return value


def claim_installer_action_grant(
    root: Path,
    receipt: dict[str, object],
    now: datetime,
) -> None:
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            (
                "import fs from 'node:fs';"
                "import { pathToFileURL } from 'node:url';"
                "const [actionPath, machineRoot, now] = process.argv.slice(-3);"
                "try {"
                "const action = await import(pathToFileURL(actionPath));"
                "const receipt = JSON.parse(fs.readFileSync(0, 'utf8'));"
                "action.claimWorkflowActionGrant(receipt, { machineRoot, now });"
                "} catch (error) {"
                "console.error(error?.code ?? error?.message ?? String(error));"
                "process.exit(2);"
                "}"
            ),
            "claim-workflow-action-grant",
            str(root / "tooling/scripts/local-dev/workflow-action-store.mjs"),
            str(machine_root()),
            now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        ],
        cwd=root,
        input=json.dumps(receipt),
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "WORKFLOW_ACTION_GRANT_UNAVAILABLE"
        )


def authorize_installation(root: Path, current_workspace_id: str) -> bool:
    now = datetime.now(timezone.utc)
    ledger = validated_work_ledger(root)
    live_declarations = [
        item
        for item in ledger.get("declarations", {}).values()
        if isinstance(item, dict)
        and item.get("state") in LIVE_DECLARATION_STATES
        and (
            timestamp(item.get("expiresAt")) is None
            or timestamp(item.get("expiresAt")) > now
        )
    ]
    purge_legacy_state = not live_declarations

    liveness = inspect_workflow_liveness(root, now)
    live_assignments = liveness["bindings"].get("liveAssignments")
    live_actions = liveness["actions"].get("liveReceipts")
    active_action_locks = liveness["actions"].get("activeLocks")
    if (
        not isinstance(live_assignments, list)
        or not isinstance(live_actions, list)
        or not isinstance(active_action_locks, list)
    ):
        raise RuntimeError("WORKFLOW_MACHINE_STATE_INVALID")
    if live_assignments:
        raise RuntimeError("GLOBAL_WORKFLOW_NOT_IDLE: live child assignment")
    if active_action_locks:
        raise RuntimeError("GLOBAL_WORKFLOW_NOT_IDLE: active workflow action lock")

    non_installer = [
        receipt
        for receipt in live_actions
        if not (
            receipt.get("operation") == {
                "family": "OWNER_CONTROL",
                "label": "skills",
                "targetRef": None,
            }
            and isinstance(receipt.get("actor"), dict)
            and receipt["actor"].get("role") == "OWNER"
            and isinstance(receipt.get("actorProjection"), dict)
            and receipt["actorProjection"].get("role") == "OWNER"
            and receipt["actorProjection"].get("released") is False
            and receipt["actorProjection"].get("executionRoot")
            == str(root.resolve(strict=True))
            and isinstance(receipt.get("binding"), dict)
            and receipt["binding"].get("workspaceId") == current_workspace_id
        )
    ]
    if non_installer or len(live_actions) > 1:
        raise RuntimeError("GLOBAL_WORKFLOW_NOT_IDLE: live workflow action")
    if len(live_actions) == 0 and live_declarations:
        return False
    if len(live_actions) != 1:
        raise RuntimeError("WORKFLOW_ACTION_GRANT_UNAVAILABLE")
    exact_receipt = {
        key: value
        for key, value in live_actions[0].items()
        if key != "actorProjection"
    }
    claim_installer_action_grant(root, exact_receipt, now)
    return purge_legacy_state


def purge_legacy_binding_state() -> None:
    root = machine_root().resolve()
    targets = [root / "conversations"]
    workspaces = root / "workspaces"
    if workspaces.exists():
        targets.extend(workspaces.glob("*/workflow/actions"))
    existing: list[Path] = []
    for target in targets:
        if not target.exists() and not target.is_symlink():
            continue
        if target.is_symlink() or target.resolve().parent == target.resolve():
            raise RuntimeError("LEGACY_BINDING_RESET_INVALID")
        if os.path.commonpath((str(root), str(target.resolve()))) != str(root):
            raise RuntimeError("LEGACY_BINDING_RESET_INVALID")
        if hasattr(os, "getuid") and target.stat().st_uid != os.getuid():
            raise RuntimeError("LEGACY_BINDING_RESET_INVALID")
        existing.append(target)
    for target in existing:
        shutil.rmtree(target)


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
    print(f"retired existing project integration: {destination}")


def canonical_trae_hook_entry(
    root: Path,
    event: str,
    workspace: Path | None = None,
) -> dict[str, object]:
    script = (
        root
        / "tooling"
        / "plugins"
        / PLUGIN_NAME
        / "scripts"
        / "hook-entry.mjs"
    ).resolve(strict=True)
    entry: dict[str, object] = {
        "hooks": [
            {
                "type": "command",
                "command": (
                    f'node "{script}" --host trae --event {event}'
                    + (
                        f' --workspace "{workspace.resolve(strict=True)}"'
                        if workspace is not None
                        else ""
                    )
                ),
                "timeout": 5,
            }
        ]
    }
    if event == "PreToolUse":
        entry["matcher"] = "*"
    return entry


def is_managed_trae_hook_entry(value: object) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get("hooks"), list):
        return False
    return any(
        isinstance(item, dict)
        and PLUGIN_NAME in str(item.get("command") or "")
        and "hook-entry.mjs" in str(item.get("command") or "")
        for item in value["hooks"]
    )


def planned_trae_hooks(
    root: Path,
    target_root: Path,
    workspace: Path | None = None,
    *,
    install: bool = True,
) -> dict[str, object]:
    hooks_file = target_root / "hooks.json"
    if hooks_file.is_symlink():
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {hooks_file} is a symlink"
        )
    if hooks_file.exists():
        try:
            value = json.loads(hooks_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("TRAE_HOOKS_INVALID") from error
    else:
        value = {"hooks": {}}
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("hooks"), dict)
    ):
        raise RuntimeError("TRAE_HOOKS_INVALID")
    output = json.loads(json.dumps(value))
    for event in TRAE_HOOK_EVENTS:
        existing = output["hooks"].get(event, [])
        if not isinstance(existing, list):
            raise RuntimeError("TRAE_HOOKS_INVALID")
        retained = [
            item for item in existing if not is_managed_trae_hook_entry(item)
        ]
        if install:
            output["hooks"][event] = retained + [
                canonical_trae_hook_entry(root, event, workspace)
            ]
        elif len(retained) != len(existing):
            if retained:
                output["hooks"][event] = retained
            else:
                output["hooks"].pop(event, None)
    return output


def installed_trae_pre_tool_invocation(
    root: Path,
    target_root: Path,
    workspace: Path | None = None,
) -> tuple[list[str], int]:
    hooks_file = target_root / "hooks.json"
    try:
        value = json.loads(hooks_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("TRAE_HOOK_PROBE_PROJECTION_INVALID") from error
    hooks = value.get("hooks") if isinstance(value, dict) else None
    entries = hooks.get("PreToolUse") if isinstance(hooks, dict) else None
    expected = canonical_trae_hook_entry(root, "PreToolUse", workspace)
    managed = (
        [entry for entry in entries if is_managed_trae_hook_entry(entry)]
        if isinstance(entries, list)
        else []
    )
    if managed != [expected]:
        raise RuntimeError("TRAE_HOOK_PROBE_PROJECTION_INVALID")
    timeout = expected["hooks"][0]["timeout"]
    if not isinstance(timeout, int):
        raise RuntimeError("TRAE_HOOK_PROBE_PROJECTION_INVALID")
    script = (
        root
        / "tooling"
        / "plugins"
        / PLUGIN_NAME
        / "scripts"
        / "hook-entry.mjs"
    ).resolve(strict=True)
    command = [
        "node",
        str(script),
        "--host",
        "trae",
        "--event",
        "PreToolUse",
    ]
    if workspace is not None:
        command.extend(["--workspace", str(workspace.resolve(strict=True))])
    return command, timeout


def probe_installed_trae_hook(
    root: Path,
    target_root: Path,
    workspace: Path | None = None,
) -> dict[str, object]:
    command, timeout = installed_trae_pre_tool_invocation(
        root,
        target_root,
        workspace,
    )
    with tempfile.TemporaryDirectory(prefix="pt-trae-hook-probe-") as temporary:
        probe_root = Path(temporary)
        home = probe_root / "home"
        machine = probe_root / "machine"
        home.mkdir(mode=0o700)
        machine.mkdir(mode=0o700)
        environment = {
            **os.environ,
            "HOME": str(home),
            "USERPROFILE": str(home),
            "PT_MACHINE_DEV_ROOT": str(machine),
        }
        payload = {
            "chat_session_id": f"pt-install-probe-{os.urandom(16).hex()}",
            "session_id": f"pt-install-probe-{os.urandom(16).hex()}",
            "task_root": str(root),
            "repo_working_dir": str(root),
            "tool_name": "pt_install_probe",
            "tool_input": {},
        }
        try:
            completed = subprocess.run(
                command,
                cwd=target_root,
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=environment,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("TRAE_HOOK_PROBE_TIMEOUT") from error
        if completed.returncode != 0:
            raise RuntimeError(
                "TRAE_HOOK_PROBE_COMMAND_FAILED: "
                f"exit={completed.returncode}"
            )
        try:
            response = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("TRAE_HOOK_PROBE_RESPONSE_INVALID") from error
        output = (
            response.get("hookSpecificOutput")
            if isinstance(response, dict)
            else None
        )
        reason = (
            output.get("permissionDecisionReason")
            if isinstance(output, dict)
            else None
        )
        supported = (
            isinstance(output, dict)
            and output.get("hookEventName") == "PreToolUse"
            and output.get("permissionDecision") == "deny"
            and isinstance(reason, str)
            and reason.startswith("TOOL_INTENT_UNSUPPORTED:")
        )
        bindings = list(
            machine.glob("bindings/owners/trae/*/owner-binding.json")
        )
        if not supported:
            raise RuntimeError("TRAE_HOOK_PROBE_RESPONSE_UNSUPPORTED")
        if len(bindings) != 1:
            raise RuntimeError("TRAE_HOOK_PROBE_BINDING_INVALID")
        try:
            binding = json.loads(bindings[0].read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("TRAE_HOOK_PROBE_BINDING_INVALID") from error
        if (
            not isinstance(binding, dict)
            or binding.get("host") != "trae"
            or binding.get("role") != "OWNER"
            or binding.get("executionRoot") != str(root.resolve(strict=True))
        ):
            raise RuntimeError("TRAE_HOOK_PROBE_BINDING_INVALID")
    return dict(TRAE_CALLBACK_PROOF)


def managed_cursor_hook(root: Path, host_event: str) -> dict[str, object]:
    script = (
        root
        / "tooling"
        / "plugins"
        / PLUGIN_NAME
        / "scripts"
        / "hook-entry.mjs"
    ).resolve(strict=True)
    hook: dict[str, object] = {
        "command": (
            f'node "{script}" --host cursor --event {host_event}'
        ),
        "timeout": 5,
        "failClosed": True,
    }
    if host_event == "preToolUse":
        hook["matcher"] = "*"
    if host_event == "stop":
        hook["loop_limit"] = 8
    return hook


def is_managed_cursor_hook(value: object) -> bool:
    return (
        isinstance(value, dict)
        and PLUGIN_NAME in str(value.get("command") or "")
        and "hook-entry.mjs" in str(value.get("command") or "")
    )


def planned_cursor_hooks(root: Path, target_root: Path) -> dict[str, object]:
    hooks_file = target_root / "hooks.json"
    if hooks_file.is_symlink():
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {hooks_file} is a symlink"
        )
    if hooks_file.exists():
        try:
            value = json.loads(hooks_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("CURSOR_HOOKS_INVALID") from error
    else:
        value = {"version": 1, "hooks": {}}
    if (
        not isinstance(value, dict)
        or value.get("version") != 1
        or not isinstance(value.get("hooks"), dict)
    ):
        raise RuntimeError("CURSOR_HOOKS_INVALID")
    output = json.loads(json.dumps(value))
    for cursor_event, host_event in CURSOR_HOOK_EVENTS:
        existing = output["hooks"].get(cursor_event, [])
        if not isinstance(existing, list):
            raise RuntimeError("CURSOR_HOOKS_INVALID")
        output["hooks"][cursor_event] = [
            item for item in existing if not is_managed_cursor_hook(item)
        ] + [managed_cursor_hook(root, host_event)]
    return output


def install_codex_plugin(plugin: Path, target_root: Path) -> None:
    plugins_root = target_root / "plugins"
    if plugins_root.is_symlink():
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {plugins_root} is a symlink"
        )
    plugins_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if plugins_root.resolve(strict=True).parent != target_root:
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {plugins_root} leaves its host root"
        )
    destination = plugins_root / PLUGIN_NAME
    retire(destination, target_root / "retired-project-plugins")
    destination.symlink_to(plugin.resolve(strict=True), target_is_directory=True)


def write_installation_receipt(
    workspace_id: str,
    branch: str,
    head: str,
    host: str,
    state: str,
    catalog: dict[str, object],
    callback_proof: dict[str, object],
) -> None:
    installed_at = (
        datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        if state == "INSTALLED"
        else None
    )
    write_receipt(
        receipt_path(workspace_id),
        {
            "kind": "peers-touch-agent-integration",
            "state": state,
            "workspaceId": workspace_id,
            "branch": branch,
            "sourceHead": head,
            "host": host,
            "installedAt": installed_at,
            "callbackProof": callback_proof,
            **catalog,
        },
    )


def install(
    root: Path,
    host: str,
    workspace_id: str,
    branch: str,
    head: str,
    workspace_file: str | None = None,
) -> None:
    sources, plugin, catalog = canonical_integration_catalog(root)
    target_root = host_root(root, host)
    trae_workspace: Path | None = None
    trae_hook_targets: list[tuple[Path, dict[str, object]]] = []
    trae_bootstrap_root = target_root
    if host == "trae":
        trae_workspace, workspace_roots, bootstrap_root = resolve_trae_workspace(
            root,
            workspace_file,
        )
        trae_bootstrap_root = host_root(bootstrap_root, "trae")
        for workspace_root in workspace_roots:
            candidate = workspace_root / ".trae"
            if workspace_root != bootstrap_root and not candidate.exists():
                continue
            hook_root = host_root(workspace_root, "trae")
            trae_hook_targets.append(
                (
                    hook_root / "hooks.json",
                    planned_trae_hooks(
                        root,
                        hook_root,
                        trae_workspace,
                        install=workspace_root == bootstrap_root,
                    ),
                )
            )
    cursor_hooks = (
        planned_cursor_hooks(root, target_root)
        if host == "cursor"
        else None
    )
    purge_legacy_state = authorize_installation(root, workspace_id)
    write_installation_receipt(
        workspace_id,
        branch,
        head,
        host,
        "INSTALLING",
        catalog,
        {"status": "PENDING"},
    )
    skills_root = target_root / "skills"
    try:
        if purge_legacy_state:
            purge_legacy_binding_state()
        else:
            print(
                "preserved inert legacy workflow history while "
                "Development declarations are live"
            )
        if skills_root.is_symlink():
            skills_root.unlink()
        skills_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if skills_root.resolve(strict=True).parent != target_root:
            raise RuntimeError(
                f"HOST_PROJECTION_ESCAPE: {skills_root} leaves its host root"
            )
        retired_root = target_root / "retired-project-skills"
        retire(skills_root / "pt-trae-goal-orchestrator", retired_root)
        for source in sources:
            destination = skills_root / source.name
            retire(destination, retired_root)
            destination.symlink_to(
                source.resolve(strict=True),
                target_is_directory=True,
            )
        if host == "codex":
            install_codex_plugin(plugin, target_root)
        elif host == "trae":
            for hooks_file, hooks in trae_hook_targets:
                write_receipt(hooks_file, hooks)
        elif host == "cursor":
            write_receipt(target_root / "hooks.json", cursor_hooks)
        callback_proof = (
            probe_installed_trae_hook(
                root,
                trae_bootstrap_root,
                trae_workspace,
            )
            if host == "trae"
            else {"status": "NOT_APPLICABLE"}
        )
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        write_installation_receipt(
            workspace_id,
            branch,
            head,
            host,
            "BLOCKED",
            catalog,
            {"status": "BLOCKED", "code": str(error)},
        )
        raise
    write_installation_receipt(
        workspace_id,
        branch,
        head,
        host,
        "INSTALLED",
        catalog,
        callback_proof,
    )
    print(f"linked {len(sources)} project pt-* skills under {skills_root}")
    if host in {"codex", "cursor", "trae"}:
        print(f"installed {PLUGIN_NAME} integration for {host}")
    print(
        json.dumps(
            {
                "status": "INSTALLED",
                "path": str(receipt_path(workspace_id)),
            }
        )
    )


def main() -> int:
    options = parse_args()
    root = Path(os.path.realpath(os.path.abspath(options.root)))
    workspace_id, branch, head = identity(root)
    try:
        with WorkLedgerLock():
            install(
                root,
                options.host,
                workspace_id,
                branch,
                head,
                options.workspace,
            )
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "BLOCKED", "code": str(error)}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
