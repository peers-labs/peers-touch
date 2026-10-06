"""SSH-backed deployment source identity adapter for environment Provisioners."""

from __future__ import annotations

import json
import shlex

from tooling.acceptance.core.attestation import PROTOCOL_SOURCE_PATHS
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_deployment_environment_path,
)
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.acceptance.transports.ssh import SshTarget, SshTransport, SshTunnel


def _reviewed_remote_transport(
    deploy_environment: str,
) -> tuple[SshTransport, dict[str, str]]:
    environment_path = resolve_deployment_environment_path(deploy_environment)
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
        remote_platform = RemotePlatform(
            environment.get(
                "PT_DEPLOY_PLATFORM",
                RemotePlatform.POSIX.value,
            ).strip().lower()
        )
        target = SshTarget(
            host=host,
            user=user,
            port=int(environment.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=known_hosts_file,
            remote_platform=remote_platform,
        )
        transport = SshTransport(target, connect_timeout=10)
    except (ProvisioningError, ValueError) as error:
        raise BlockedError(
            reason=f"SSH contract is invalid: {error}",
            resource=f"deployment-source:{deploy_environment}",
        ) from error
    return transport, environment


def reviewed_remote_transport(
    deploy_environment: str,
) -> tuple[SshTransport, dict[str, str]]:
    return _reviewed_remote_transport(deploy_environment)


def open_reviewed_remote_tunnel(
    deploy_environment: str,
    *,
    remote_host: str = "127.0.0.1",
    remote_port: int,
    local_port: int | None = None,
    timeout: float = 10,
) -> SshTunnel:
    transport, _environment = _reviewed_remote_transport(deploy_environment)
    try:
        return transport.start_local_forward(
            remote_host=remote_host,
            remote_port=remote_port,
            local_port=local_port,
            timeout=timeout,
        )
    except ProvisioningError as error:
        raise BlockedError(
            reason=f"Cannot open deployment tunnel {deploy_environment}: {error}",
            resource=f"deployment-tunnel:{deploy_environment}",
        ) from error


def _windows_source_identity_script() -> str:
    protocol_pathspecs = repr(list(PROTOCOL_SOURCE_PATHS))
    return (
        "import hashlib,json,pathlib,subprocess,sys;"
        "r=(pathlib.Path.home()/sys.argv[1]).resolve();"
        "commit=subprocess.check_output("
        "['git','rev-parse','HEAD'],cwd=r,text=True).strip();"
        "status=subprocess.check_output("
        "['git','status','--porcelain'],cwd=r,text=True);"
        "dirty=any(line.strip()!='?? .bare.git/' "
        "for line in status.splitlines() if line.strip());"
        "raw=subprocess.check_output("
        f"['git','ls-files','-z','--']+{protocol_pathspecs},cwd=r);"
        "p=[x.decode() for x in raw.split(b'\\0') if x];"
        "h=hashlib.sha256();"
        "[(h.update(x.replace('\\\\','/').encode()),h.update(b'\\0'),"
        "h.update(subprocess.check_output("
        "['git','show','HEAD:'+x.replace('\\\\','/')],cwd=r)),"
        "h.update(b'\\0')) for x in sorted(p,key=lambda x:x.replace('\\\\','/'))];"
        "print(json.dumps([commit,'dirty' if dirty else 'clean',"
        "h.hexdigest()]))"
    )


def resolve_remote_source_identity(
    deploy_environment: str,
) -> tuple[str, str, str]:
    transport, environment = _reviewed_remote_transport(deploy_environment)
    deploy_path = environment.get("PT_DEPLOY_PATH", "")

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
    if transport.target.remote_platform == RemotePlatform.WINDOWS:
        completed = transport.run_argv(
            ["python", "-c", _windows_source_identity_script(), deploy_path],
            timeout=30,
            check=False,
        )
        try:
            values = json.loads(completed.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as error:
            values = []
            parse_error: Exception | None = error
        else:
            parse_error = None
        if (
            completed.returncode == 0
            and isinstance(values, list)
            and len(values) == 3
            and all(isinstance(value, str) and value for value in values)
        ):
            return values[0], values[1], values[2]
        detail = (
            completed.stderr.strip()
            or completed.stdout.strip()
            or str(parse_error or "no output")
        )
        raise BlockedError(
            reason=(
                f"Cannot attest deployment {deploy_environment}: {detail}"
            ),
            resource=f"deployment-source:{deploy_environment}",
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
