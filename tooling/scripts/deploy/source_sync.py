#!/usr/bin/env python3
"""CLI for role-neutral remote Git source synchronization."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.core.lease import (
    RemoteGitSourceLease,
    RemoteGitSourceLeaseUnavailable,
)
from tooling.acceptance.core.source_sync import (
    RemoteSourceSynchronizer,
    SourceSyncRequest,
)


def _source_lease(
    request: SourceSyncRequest,
    owner: str,
) -> RemoteGitSourceLease:
    return RemoteGitSourceLease(
        request.environment_name,
        owner,
        host=request.host,
        user=request.user,
        deploy_path=request.deploy_path,
        port=request.ssh_port,
        known_hosts_file=request.known_hosts_file,
        remote_platform=request.remote_platform,
    )


def _inherited_machine_lease_fds(
    environment: dict[str, str],
) -> tuple[int, ...]:
    raw_fd = environment.get("PT_MACHINE_LEASE_FD", "").strip()
    if not raw_fd:
        return ()
    try:
        lease_fd = int(raw_fd)
        if lease_fd < 3:
            raise ValueError
        os.fstat(lease_fd)
    except (OSError, ValueError) as error:
        raise ProvisioningError(
            "source-sync inherited machine lease file descriptor is invalid"
        ) from error
    return (lease_fd,)


def _run_follow_up(
    command: list[str],
    *,
    environment: dict[str, str],
) -> int:
    return subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=environment,
        check=False,
        close_fds=True,
        pass_fds=_inherited_machine_lease_fds(environment),
    ).returncode


def main() -> int:
    arguments = sys.argv[1:]
    command: list[str] = []
    if "--" in arguments:
        separator = arguments.index("--")
        command = arguments[separator + 1 :]
        arguments = arguments[:separator]

    parser = argparse.ArgumentParser(
        description="Synchronize one exact Git commit to a remote deployment worktree"
    )
    parser.add_argument("environment")
    parser.add_argument("--branch", default="")
    parser.add_argument("--environment-file", type=Path)
    parser.add_argument("--source-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--require-clean", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(arguments)

    environments_dir = Path(
        os.environ.get(
            "PT_DEPLOY_ENVS_DIR",
            str(REPO_ROOT / ".local" / "deploy" / "envs"),
        )
    ).expanduser()
    central_environment_path = Path(
        os.environ.get(
            "PT_GIT_SERVER_ENV",
            str(REPO_ROOT / ".local" / "deploy" / "git-server.env"),
        )
    ).expanduser()
    try:
        request = SourceSyncRequest.from_env_files(
            args.environment,
            source_root=args.source_root,
            environments_dir=environments_dir,
            central_environment_path=central_environment_path,
            environment_path=args.environment_file,
            branch=args.branch,
            require_clean=args.require_clean,
        )
        if command:
            RemoteSourceSynchronizer(request).preflight()
            source_lease_owner = f"source-sync:{request.environment_name}"
            lease = _source_lease(
                request,
                source_lease_owner,
            )
            with lease:
                result = RemoteSourceSynchronizer(
                    request,
                    source_lease_held=True,
                    source_lease_owner=source_lease_owner,
                ).sync()
                _write_result(result.to_dict(), as_json=args.json)
                environment = os.environ.copy()
                environment["PT_SOURCE_LEASE_HELD"] = "1"
                return _run_follow_up(
                    command,
                    environment=environment,
                )
        result = RemoteSourceSynchronizer(request).sync()
    except (
        OSError,
        ValueError,
        ProvisioningError,
        RemoteGitSourceLeaseUnavailable,
        RuntimeError,
    ) as error:
        sys.stderr.write(f"[ERROR] source-sync failed: {error}\n")
        return 1

    _write_result(result.to_dict(), as_json=args.json)
    return 0


def _write_result(payload: dict[str, object], *, as_json: bool) -> None:
    if as_json:
        sys.stdout.write(json.dumps(payload, sort_keys=True) + "\n")
    else:
        sys.stdout.write(
            "[OK] Source synchronized: "
            f"{payload['environmentName']} "
            f"{payload['remoteCommit']} "
            f"({payload['sourceMode']})\n"
        )
    sys.stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
