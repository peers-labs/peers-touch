#!/usr/bin/env python3
"""Synchronize allowlisted OAuth2 Client values to Vercel without argv leaks."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from preflight import (
    DEFAULT_CATALOG,
    PreflightError,
    build_preflight,
    default_env_file,
    default_repo_root,
)


RunCommand = Callable[..., subprocess.CompletedProcess[str]]
SUPPORTED_VERCEL_CLI_VERSION = "62.1.0"


def resolve_vercel_command(vercel_bin: str) -> list[str]:
    if vercel_bin == "vercel":
        npx = shutil.which("npx")
        if npx is not None:
            return [npx, "--yes", f"vercel@{SUPPORTED_VERCEL_CLI_VERSION}"]
    resolved = shutil.which(vercel_bin)
    if resolved is not None:
        return [resolved]
    raise PreflightError("VERCEL_CLI_UNAVAILABLE", {"binary": vercel_bin})


def verify_vercel_version(
    command_prefix: list[str],
    repo_root: Path,
    runner: RunCommand,
    timeout: float,
) -> str:
    try:
        result = runner(
            [*command_prefix, "--version"],
            text=True,
            cwd=repo_root,
            capture_output=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise PreflightError(
            "VERCEL_CLI_TIMEOUT",
            {"operation": "version", "timeoutSeconds": timeout},
        ) from error
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    match = re.search(r"\b(\d+)\.(\d+)(?:\.(\d+))?", output)
    if result.returncode != 0 or match is None:
        raise PreflightError(
            "VERCEL_CLI_VERSION_UNAVAILABLE",
            {"exitCode": result.returncode},
        )
    version = match.group(0)
    if version != SUPPORTED_VERCEL_CLI_VERSION:
        raise PreflightError(
            "VERCEL_CLI_VERSION_UNSUPPORTED",
            {
                "supportedVersion": SUPPORTED_VERCEL_CLI_VERSION,
                "observedVersion": version,
            },
        )
    return version


def sync_environment(
    repo_root: Path,
    values: dict[str, tuple[str, str]],
    environments: list[str],
    vercel_bin: str,
    dry_run: bool,
    runner: RunCommand = subprocess.run,
    timeout: float = 120,
) -> dict[str, Any]:
    targets = sorted(set(environments))
    if not targets or any(item not in {"preview", "production"} for item in targets):
        raise PreflightError(
            "VERCEL_ENVIRONMENT_INVALID",
            {"allowed": ["preview", "production"]},
        )
    operations = [
        {"name": name, "environment": target, "visibility": visibility}
        for target in targets
        for name, (_, visibility) in sorted(values.items())
    ]
    if dry_run:
        return {
            "status": "PASS",
            "mode": "dry-run",
            "operationCount": len(operations),
            "operations": operations,
        }

    command_prefix = resolve_vercel_command(vercel_bin)
    cli_version = verify_vercel_version(
        command_prefix,
        repo_root,
        runner,
        timeout,
    )

    completed: list[dict[str, str]] = []
    for operation in operations:
        name = operation["name"]
        environment = operation["environment"]
        visibility = operation["visibility"]
        value = values[name][0]
        command = [
            *command_prefix,
            "env",
            "add",
            name,
            environment,
            "--force",
            "--yes",
            "--type",
            visibility,
        ]
        try:
            result = runner(
                command,
                input=value + "\n",
                text=True,
                cwd=repo_root,
                capture_output=True,
                check=False,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise PreflightError(
                "VERCEL_CLI_TIMEOUT",
                {
                    "operation": "env-add",
                    "name": name,
                    "environment": environment,
                    "timeoutSeconds": timeout,
                },
            ) from error
        if result.returncode != 0:
            raise PreflightError(
                "VERCEL_ENV_SYNC_FAILED",
                {
                    "name": name,
                    "environment": environment,
                    "visibility": visibility,
                    "exitCode": result.returncode,
                },
            )
        completed.append(operation)
    return {
        "status": "PASS",
        "mode": "apply",
        "cliVersion": cli_version,
        "operationCount": len(completed),
        "operations": completed,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--repo-root", type=Path, default=default_repo_root())
    result.add_argument("--env-file", type=Path)
    result.add_argument("--base-url", required=True)
    result.add_argument("--return-to", action="append", default=[])
    result.add_argument("--provider", action="append", default=[])
    result.add_argument(
        "--environment",
        action="append",
        default=[],
        help="preview or production; repeat to sync both",
    )
    result.add_argument("--vercel-bin", default="vercel")
    result.add_argument("--timeout", type=float, default=120)
    mode = result.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    return result


def main(argv: Optional[list[str]] = None) -> int:
    args = parser().parse_args(argv)
    repo_root = args.repo_root.resolve()
    env_file = args.env_file or default_env_file(repo_root)
    environments = args.environment or ["preview"]
    try:
        preflight, values = build_preflight(
            repo_root,
            env_file,
            DEFAULT_CATALOG,
            args.base_url,
            args.return_to,
            args.provider,
        )
        if preflight["status"] != "PASS":
            report = preflight
        else:
            report = sync_environment(
                repo_root,
                values,
                environments,
                args.vercel_bin,
                not args.apply,
                timeout=args.timeout,
            )
            report["preflight"] = {
                "providers": preflight["deployment"]["providers"],
                "rootDirectory": preflight["deployment"]["rootDirectory"],
                "stableBaseUrl": preflight["deployment"]["stableBaseUrl"],
                "storageDriver": preflight["deployment"]["storageDriver"],
            }
    except PreflightError as error:
        report = {
            "status": "BLOCKED",
            "code": error.code,
            "detail": error.detail,
        }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
