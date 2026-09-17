"""SSH-backed deployment source identity adapter for environment Provisioners."""

from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import PROTOCOL_SOURCE_PATHS
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_machine_profile_environment,
)
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


_DEPLOY_ENVIRONMENT_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9._-]{0,127}$",
    re.IGNORECASE,
)


def _git_value(
    env_repo: Path,
    arguments: list[str],
    *,
    operation: str,
    deploy_environment: str,
) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(env_repo), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        raise BlockedError(
            reason=f"Cannot validate deployment environment source: {error}",
            resource=f"deployment-source:{deploy_environment}",
        ) from error
    if completed.returncode != 0:
        detail = (
            completed.stderr.strip()
            or completed.stdout.strip()
            or f"{operation} failed"
        )
        raise BlockedError(
            reason=(
                f"Deployment environment {deploy_environment} failed "
                f"{operation}: {detail}"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )
    return completed.stdout.strip()


def _resolve_deploy_environment_path(deploy_environment: str) -> Path:
    if not isinstance(deploy_environment, str) or not (
        _DEPLOY_ENVIRONMENT_PATTERN.fullmatch(deploy_environment)
    ):
        raise BlockedError(
            reason="Deployment environment has an invalid identifier",
            resource=f"deployment-source:{deploy_environment}",
        )

    _, profile_file, _, _ = resolve_machine_profile_environment(REPO_ROOT)
    if (
        profile_file.name != "profile.env.example"
        or profile_file.parent.parent.name != "peers-touch"
    ):
        raise BlockedError(
            reason=(
                "Machine Dev profile does not identify the canonical "
                "environment repository"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )
    profiles_root = profile_file.parent.parent
    env_repo = profiles_root.parent
    git_root = Path(
        _git_value(
            env_repo,
            ["rev-parse", "--show-toplevel"],
            operation="Git worktree validation",
            deploy_environment=deploy_environment,
        )
    ).resolve()
    if git_root != env_repo:
        raise BlockedError(
            reason=(
                "Machine Dev profile environment repository is not its "
                "Git worktree root"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )

    try:
        matches = sorted(
            candidate
            for profile_directory in profiles_root.iterdir()
            if profile_directory.is_dir()
            and not profile_directory.is_symlink()
            if (
                candidate := (
                    profile_directory
                    / "deploy"
                    / f"{deploy_environment}.env.example"
                )
            ).is_file()
        )
    except OSError as error:
        raise BlockedError(
            reason=f"Cannot resolve deployment environment source: {error}",
            resource=f"deployment-source:{deploy_environment}",
        ) from error
    if len(matches) != 1:
        raise BlockedError(
            reason=(
                f"Deployment environment {deploy_environment} must resolve "
                "to exactly one canonical definition"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )

    environment_path = matches[0].resolve()
    try:
        relative_path = environment_path.relative_to(env_repo).as_posix()
        relative_profile = (
            environment_path.parent.parent.relative_to(env_repo).as_posix()
        )
    except ValueError as error:
        raise BlockedError(
            reason=(
                f"Deployment environment {deploy_environment} resolves "
                "outside the canonical environment repository"
            ),
            resource=f"deployment-source:{deploy_environment}",
        ) from error
    _git_value(
        env_repo,
        ["ls-files", "--error-unmatch", "--", relative_path],
        operation="Git-tracked source validation",
        deploy_environment=deploy_environment,
    )
    changes = _git_value(
        env_repo,
        [
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            relative_profile,
        ],
        operation="clean source validation",
        deploy_environment=deploy_environment,
    )
    if changes:
        raise BlockedError(
            reason=(
                f"Deployment environment {deploy_environment} has dirty or "
                "untracked environment definitions"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )
    return environment_path


def resolve_remote_source_identity(
    deploy_environment: str,
) -> tuple[str, str, str]:
    environment_path = _resolve_deploy_environment_path(deploy_environment)
    environment = load_env_file(environment_path)
    host = environment.get("PT_DEPLOY_HOST", "")
    user = environment.get("PT_DEPLOY_USER", "")
    deploy_path = environment.get("PT_DEPLOY_PATH", "")
    if not host or not user or not deploy_path:
        raise BlockedError(
            reason=(
                f"Deployment environment {deploy_environment} must define "
                "PT_DEPLOY_HOST, PT_DEPLOY_USER, and PT_DEPLOY_PATH"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )

    known_hosts_file = environment.get("PT_DEPLOY_KNOWN_HOSTS_FILE", "")
    try:
        target = SshTarget(
            host=host,
            user=user,
            port=int(environment.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=known_hosts_file,
        )
        transport = SshTransport(target, connect_timeout=10)
    except (ProvisioningError, ValueError) as error:
        raise BlockedError(
            reason=f"SSH contract is invalid: {error}",
            resource=f"deployment-source:{deploy_environment}",
        ) from error

    protocol_pathspecs = repr(list(PROTOCOL_SOURCE_PATHS))
    digest_script = (
        "import hashlib,pathlib,subprocess;"
        "r=pathlib.Path('.').resolve();"
        "raw=subprocess.check_output("
        f"['git','ls-files','-z','--']+{protocol_pathspecs},cwd=r);"
        "p=[r/x.decode() for x in raw.split(b'\\0') if x];"
        "h=hashlib.sha256();"
        "[(h.update(x.relative_to(r).as_posix().encode()),h.update(b'\\0'),"
        "h.update(x.read_bytes()),h.update(b'\\0')) for x in "
        "sorted(p,key=lambda x:x.relative_to(r).as_posix())];"
        "print(h.hexdigest())"
    )
    remote_command = (
        f"cd \"$HOME\"/{shlex.quote(deploy_path)} && "
        "printf '%s\\n' \"$(git rev-parse HEAD)\" && "
        "status=\"$(git status --porcelain | "
        "sed '/^?? \\.bare\\.git\\/$/d')\" && "
        "if test -z \"$status\"; then echo clean; else echo dirty; fi && "
        f"python3 -c {shlex.quote(digest_script)}"
    )
    completed = transport.run_argv(
        ["bash", "-lc", remote_command],
        timeout=30,
        check=False,
    )
    lines = [
        line.strip()
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
    if completed.returncode != 0 or len(lines) < 3:
        detail = (
            completed.stderr.strip()
            or completed.stdout.strip()
            or "no output"
        )
        raise BlockedError(
            reason=(
                f"Cannot attest deployment {deploy_environment}: {detail}"
            ),
            resource=f"deployment-source:{deploy_environment}",
        )
    return lines[-3], lines[-2], lines[-1]
