"""SSH-backed deployment source identity adapter for environment Provisioners."""

from __future__ import annotations

import shlex

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


def resolve_remote_source_identity(
    deploy_environment: str,
) -> tuple[str, str, str]:
    environment_path = (
        REPO_ROOT / ".local" / "deploy" / "envs" / f"{deploy_environment}.env"
    )
    if not environment_path.is_file():
        raise BlockedError(
            reason=f"Deployment environment is missing: {environment_path}",
            resource=f"deployment-source:{deploy_environment}",
        )
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

    digest_script = (
        "import hashlib,pathlib,subprocess;"
        "r=pathlib.Path('.').resolve();"
        "raw=subprocess.check_output(['git','ls-files','-z','--',"
        "':(glob)model/domain/**/*.proto',"
        "':(glob)apps/desktop/src/gen/proto/**/*.ts',"
        "':(glob)apps/station/**/*.pb.go'],cwd=r);"
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
