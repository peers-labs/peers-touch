#!/usr/bin/env python3

import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid


LEASE_FIELDS = {
    "leaseId",
    "resourceKind",
    "resourceId",
    "workspaceId",
    "ownerPid",
    "ownerProcessStart",
    "acquiredAt",
    "expiresAt",
}


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def isoformat(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def process_start_identity(pid):
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    value = result.stdout.strip()
    return value or None


def process_is_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False


def read_metadata(handle):
    handle.seek(0)
    raw = handle.read().strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {"invalid": True, "raw": raw[:512]}
    if not isinstance(value, dict) or set(value) != LEASE_FIELDS:
        return {"invalid": True, "raw": raw[:512]}
    return value


def write_metadata(handle, value):
    handle.seek(0)
    handle.truncate()
    if value is not None:
        json.dump(value, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())


def error_code(resource_kind):
    if resource_kind == "local.slot":
        return "LOCAL_SLOT_CONFLICT"
    return "STATION_CAPABILITY_CONFLICT"


def emit_error(code, message, detail=None):
    payload = {"status": "BLOCKED", "code": code, "message": message}
    if detail:
        payload["detail"] = detail
    print(json.dumps(payload, sort_keys=True), file=sys.stderr)


def terminate_process_group(child, grace_seconds=2.0):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + grace_seconds
    while child.poll() is None and time.monotonic() < deadline:
        time.sleep(0.05)
    if child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class MachineLeaseError(RuntimeError):
    def __init__(self, code, message, detail=None):
        super().__init__(message)
        self.code = code
        self.detail = detail


class MachineLease:
    """One canonical OS lock, usable by a parent runtime or the CLI owner."""

    def __init__(self, request, validation_command, *, reset_scope=None):
        self.request = request
        self.validation_command = validation_command
        self.reset_scope = reset_scope
        self.handle = None
        self.metadata = None
        self.deadline = None

    def acquire(self):
        if self.handle is not None:
            raise RuntimeError("machine lease is already acquired")
        if (
            not isinstance(self.validation_command, list)
            or not self.validation_command
            or any(
                not isinstance(value, str) or not value
                for value in self.validation_command
            )
        ):
            raise MachineLeaseError(
                "INVALID_ARGUMENT", "lease validation must be a non-empty argv array"
            )
        lease_file = Path(self.request["leaseFile"])
        lease_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lease_file.touch(mode=0o600, exist_ok=True)
        handle = lease_file.open("r+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            owner = read_metadata(handle)
            handle.close()
            raise MachineLeaseError(
                error_code(self.request["resourceKind"]),
                "runtime resource is held by another process",
                {"leaseFile": str(lease_file), "owner": owner},
            )
        self.handle = handle
        try:
            self.deadline = time.monotonic() + self.request["budgetSeconds"]
            process_start = process_start_identity(os.getpid())
            if not process_start:
                raise MachineLeaseError(
                    "RUNTIME_IDENTITY_MISMATCH",
                    "cannot establish lease-holder process identity",
                )
            acquired_at = utc_now()
            self.metadata = {
                "leaseId": str(uuid.uuid4()),
                "resourceKind": self.request["resourceKind"],
                "resourceId": self.request["resourceId"],
                "workspaceId": self.request["workspaceId"],
                "ownerPid": os.getpid(),
                "ownerProcessStart": process_start,
                "acquiredAt": isoformat(acquired_at),
                "expiresAt": isoformat(
                    acquired_at
                    + datetime.timedelta(seconds=self.request["budgetSeconds"])
                ),
            }
            write_metadata(handle, self.metadata)
            validation = subprocess.run(
                self.validation_command,
                check=False,
                capture_output=True,
                text=True,
                timeout=max(0.001, self.deadline - time.monotonic()),
            )
            if validation.returncode != 0:
                raise MachineLeaseError(
                    "RUNTIME_IDENTITY_MISMATCH",
                    "runtime binding changed before lease acquisition completed",
                    {"validationExitCode": validation.returncode},
                )
            return self
        except BaseException:
            self.release()
            raise

    @property
    def environment(self):
        if self.handle is None or self.metadata is None:
            raise RuntimeError("machine lease is not acquired")
        values = {
            "PT_MACHINE_LEASE_FD": str(self.handle.fileno()),
            "PT_MACHINE_LEASE_ID": self.metadata["leaseId"],
            "PT_MACHINE_LEASE_KIND": self.request["resourceKind"],
            "PT_MACHINE_LEASE_RESOURCE_ID": self.request["resourceId"],
            "PT_MACHINE_LEASE_WORKSPACE_ID": self.request["workspaceId"],
            "PT_MACHINE_LEASE_SOURCE_BRANCH": self.request["source"]["branch"],
            "PT_MACHINE_LEASE_SOURCE_HEAD": self.request["source"]["head"],
        }
        if self.reset_scope:
            values["PT_MACHINE_LEASE_RESET_SCOPE"] = self.reset_scope
        return values

    def release(self):
        if self.handle is None:
            return
        handle, self.handle = self.handle, None
        try:
            write_metadata(handle, None)
        finally:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            finally:
                handle.close()
                self.metadata = None


def run_with_lease(args):
    if not args.command:
        emit_error("INVALID_ARGUMENT", "lease command is required")
        return 2
    try:
        validation_command = json.loads(args.validation_command_json)
        lease = MachineLease(
            {
                "leaseFile": args.lease_file,
                "resourceKind": args.resource_kind,
                "resourceId": args.resource_id,
                "workspaceId": args.workspace_id,
                "budgetSeconds": args.budget_seconds,
                "source": {"branch": args.expected_branch, "head": args.expected_head},
            },
            validation_command,
            reset_scope=args.reset_scope,
        ).acquire()
    except subprocess.TimeoutExpired:
        emit_error("LEASE_BUDGET_EXCEEDED", "lease validation exceeded its budget")
        return 124
    except (json.JSONDecodeError, MachineLeaseError) as error:
        emit_error(
            getattr(error, "code", "INVALID_ARGUMENT"),
            str(error),
            getattr(error, "detail", None),
        )
        return 2

    received_signal = None
    child = None
    previous_handlers = {}
    try:

        def forward_signal(signum, _frame):
            nonlocal received_signal
            received_signal = signum
            if child is not None:
                terminate_process_group(child)

        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            previous_handlers[signum] = signal.signal(signum, forward_signal)

        try:
            child_environment = os.environ.copy()
            child_environment.update(lease.environment)
            child = subprocess.Popen(
                args.command,
                start_new_session=True,
                pass_fds=(lease.handle.fileno(),),
                env=child_environment,
            )
            deadline = lease.deadline
            while child.poll() is None:
                if received_signal is not None:
                    terminate_process_group(child)
                    break
                if time.monotonic() >= deadline:
                    terminate_process_group(child)
                    emit_error(
                        "LEASE_BUDGET_EXCEEDED",
                        "runtime command exceeded its lease budget",
                        {
                            "resourceKind": args.resource_kind,
                            "resourceId": args.resource_id,
                            "budgetSeconds": args.budget_seconds,
                        },
                    )
                    return 124
                time.sleep(0.05)
            if received_signal is not None:
                return 128 + received_signal
            return child.returncode
        finally:
            if child is not None and child.poll() is None:
                terminate_process_group(child)
            for signum, previous in previous_handlers.items():
                signal.signal(signum, previous)
    finally:
        lease.release()


def validate_active_metadata(metadata):
    if not isinstance(metadata, dict) or set(metadata) != LEASE_FIELDS:
        return "lease metadata schema is invalid"
    pid = metadata.get("ownerPid")
    process_start = metadata.get("ownerProcessStart")
    if not isinstance(pid, int) or pid <= 0 or not isinstance(process_start, str):
        return "lease process identity is invalid"
    actual_start = process_start_identity(pid) if process_is_alive(pid) else None
    if actual_start != process_start:
        return "OS-held lease owner does not match metadata process identity"
    return None


def verify_held_lease(args):
    try:
        lease_fd = int(args.lease_fd)
        inherited_stat = os.fstat(lease_fd)
        path_stat = os.stat(args.lease_file)
    except (OSError, ValueError):
        emit_error(
            "RUNTIME_IDENTITY_MISMATCH",
            "lease file descriptor is unavailable",
        )
        return 2
    if (
        inherited_stat.st_dev != path_stat.st_dev
        or inherited_stat.st_ino != path_stat.st_ino
    ):
        emit_error(
            "RUNTIME_IDENTITY_MISMATCH",
            "lease file descriptor does not match the canonical lease file",
        )
        return 2

    with os.fdopen(os.dup(lease_fd), "r", encoding="utf-8") as handle:
        metadata = read_metadata(handle)
    invalid = validate_active_metadata(metadata)
    if invalid:
        emit_error("RUNTIME_IDENTITY_MISMATCH", invalid)
        return 2
    expected = {
        "leaseId": args.lease_id,
        "resourceKind": args.resource_kind,
        "resourceId": args.resource_id,
        "workspaceId": args.workspace_id,
    }
    if any(metadata.get(key) != value for key, value in expected.items()):
        emit_error(
            "RUNTIME_IDENTITY_MISMATCH",
            "inherited lease metadata does not match the requested resource",
        )
        return 2

    with open(args.lease_file, "r+", encoding="utf-8") as probe:
        try:
            fcntl.flock(probe.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            fcntl.flock(probe.fileno(), fcntl.LOCK_UN)
            emit_error(
                "RUNTIME_IDENTITY_MISMATCH",
                "inherited file descriptor does not hold the canonical lease",
            )
            return 2

    print(
        json.dumps(
            {
                "status": "HELD",
                "leaseId": metadata["leaseId"],
                "resourceKind": metadata["resourceKind"],
                "resourceId": metadata["resourceId"],
                "workspaceId": metadata["workspaceId"],
            },
            sort_keys=True,
        )
    )
    return 0


def inspect_leases(args):
    lease_root = Path(args.lease_root)
    active = []
    stale = []
    if not lease_root.exists():
        print(json.dumps({"activeLeases": active, "staleMetadata": stale}))
        return 0

    for lease_file in sorted(lease_root.glob("*.lock")):
        with lease_file.open("r+", encoding="utf-8") as handle:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                metadata = read_metadata(handle)
                invalid = validate_active_metadata(metadata)
                if invalid:
                    emit_error(
                        "RUNTIME_IDENTITY_MISMATCH",
                        invalid,
                        {"leaseFile": str(lease_file), "metadata": metadata},
                    )
                    return 2
                active.append(metadata)
                continue

            try:
                metadata = read_metadata(handle)
                if metadata is not None:
                    stale.append(
                        {
                            "leaseFile": str(lease_file),
                            "metadata": metadata,
                            "reason": "metadata exists without an OS-held lock",
                        }
                    )
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    print(
        json.dumps(
            {"activeLeases": active, "staleMetadata": stale},
            sort_keys=True,
        )
    )
    return 0


def parser():
    value = argparse.ArgumentParser()
    commands = value.add_subparsers(dest="action", required=True)

    run = commands.add_parser("run")
    run.add_argument("--lease-file", required=True)
    run.add_argument("--resource-kind", required=True)
    run.add_argument("--resource-id", required=True)
    run.add_argument("--workspace-id", required=True)
    run.add_argument("--budget-seconds", required=True, type=int)
    run.add_argument("--expected-branch", required=True)
    run.add_argument("--expected-head", required=True)
    run.add_argument("--validation-command-json", required=True)
    run.add_argument("--reset-scope")
    run.add_argument("command", nargs=argparse.REMAINDER)

    status = commands.add_parser("status")
    status.add_argument("--lease-root", required=True)

    verify = commands.add_parser("verify-held")
    verify.add_argument("--lease-file", required=True)
    verify.add_argument("--lease-fd", required=True)
    verify.add_argument("--lease-id", required=True)
    verify.add_argument("--resource-kind", required=True)
    verify.add_argument("--resource-id", required=True)
    verify.add_argument("--workspace-id", required=True)
    return value


def main():
    args = parser().parse_args()
    if args.action == "run":
        if args.command and args.command[0] == "--":
            args.command = args.command[1:]
        return run_with_lease(args)
    if args.action == "verify-held":
        return verify_held_lease(args)
    return inspect_leases(args)


if __name__ == "__main__":
    raise SystemExit(main())
