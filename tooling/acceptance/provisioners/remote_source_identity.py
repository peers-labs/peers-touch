"""SSH-backed deployment source identity adapter for environment Provisioners."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shlex
import ssl
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core.attestation import (
    PROTOCOL_SOURCE_PATHS,
    commits_match,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_deployment_environment_path,
)
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.acceptance.transports.ssh import SshTarget, SshTransport, SshTunnel
from tooling.scripts.deploy.windows_runtime import (
    WindowsRuntimeConfig,
    execute as execute_windows_runtime,
)


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


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


def resolve_windows_service_version(
    deploy_environment: str,
) -> dict[str, Any]:
    transport, _ = _reviewed_remote_transport(deploy_environment)
    if transport.target.remote_platform != RemotePlatform.WINDOWS:
        raise BlockedError(
            reason=(
                f"Deployment {deploy_environment!r} is not a Windows "
                "native runtime"
            ),
            resource=f"runtime-status:{deploy_environment}",
        )
    environment_path = resolve_deployment_environment_path(deploy_environment)
    config = WindowsRuntimeConfig.load(
        deploy_environment,
        environment_path,
    )
    try:
        status = execute_windows_runtime("status", config, branch="")
    except (OSError, ProvisioningError, RuntimeError) as error:
        raise BlockedError(
            reason=(
                f"Cannot inspect attached {config.role} runtime "
                f"{deploy_environment}: {error}"
            ),
            resource=f"runtime-status:{deploy_environment}",
        ) from error

    deployment = status.get("manifest")
    process_ids = status.get("processIds")
    if (
        status.get("artifactKind") != "windows-native-runtime-status"
        or status.get("environmentName") != deploy_environment
        or status.get("role") != config.role
        or status.get("taskName") != config.task_name
        or status.get("taskRegistered") is not True
        or status.get("healthy") is not True
        or status.get("sourceClean") is not True
        or not isinstance(process_ids, list)
        or not process_ids
        or any(
            isinstance(process_id, bool)
            or not isinstance(process_id, int)
            or process_id <= 0
            for process_id in process_ids
        )
        or not isinstance(deployment, Mapping)
    ):
        raise BlockedError(
            reason=(
                f"Attached {config.role} runtime status is incomplete or "
                "unhealthy"
            ),
            resource=f"runtime-status:{deploy_environment}",
        )

    status_commit = str(status.get("sourceCommit") or "")
    deployment_commit = str(deployment.get("sourceCommit") or "")
    binary_sha256 = str(deployment.get("binarySha256") or "").lower()
    binary_sha256 = binary_sha256.removeprefix("sha256:")
    if (
        not commits_match(status_commit, deployment_commit)
        or not _SHA256.fullmatch(binary_sha256)
        or deployment.get("sourceClean") is not True
        or deployment.get("role") != config.role
        or deployment.get("taskName") != config.task_name
    ):
        raise BlockedError(
            reason=(
                f"Attached {config.role} runtime identity is inconsistent"
            ),
            resource=f"runtime-status:{deploy_environment}",
        )
    return {
        "build_commit": status_commit,
        "build_time": str(deployment.get("deployedAt") or ""),
        "service_id": f"windows-task:{config.task_name}",
    }


def resolve_windows_relay_trust_anchor(
    deploy_environment: str,
) -> tuple[bytes, str]:
    transport, _ = _reviewed_remote_transport(deploy_environment)
    if transport.target.remote_platform != RemotePlatform.WINDOWS:
        raise BlockedError(
            reason=(
                f"Deployment {deploy_environment!r} is not a Windows "
                "native runtime"
            ),
            resource=f"runtime-trust:{deploy_environment}",
        )
    environment_path = resolve_deployment_environment_path(deploy_environment)
    config = WindowsRuntimeConfig.load(
        deploy_environment,
        environment_path,
    )
    if config.role != "relay":
        raise BlockedError(
            reason=f"Deployment {deploy_environment!r} is not a Relay runtime",
            resource=f"runtime-trust:{deploy_environment}",
        )
    try:
        status = execute_windows_runtime("status", config, branch="")
        deployment = status.get("manifest")
        certificate_path = (
            str(deployment.get("tlsCaCertificatePath") or "")
            if isinstance(deployment, Mapping)
            else ""
        )
        expected_digest = (
            str(deployment.get("tlsCaCertificateSha256") or "").lower()
            if isinstance(deployment, Mapping)
            else ""
        )
        if not certificate_path or not expected_digest:
            raise ValueError("Relay runtime manifest has no TLS trust anchor")
        completed = transport.run_argv(
            [
                "python",
                "-c",
                (
                    "import base64,pathlib,sys;"
                    "sys.stdout.write(base64.b64encode("
                    "pathlib.Path(sys.argv[1]).read_bytes()).decode('ascii'))"
                ),
                certificate_path,
            ],
            timeout=30,
            check=False,
        )
        certificate = base64.b64decode(
            completed.stdout.strip(),
            validate=True,
        )
        ssl.PEM_cert_to_DER_cert(certificate.decode("ascii"))
    except (
        OSError,
        ProvisioningError,
        RuntimeError,
        ValueError,
        UnicodeError,
    ) as error:
        raise BlockedError(
            reason=(
                f"Cannot load Relay trust anchor from "
                f"{deploy_environment!r}: {error}"
            ),
            resource=f"runtime-trust:{deploy_environment}",
        ) from error
    digest = "sha256:" + hashlib.sha256(certificate).hexdigest()
    if completed.returncode != 0 or digest != expected_digest:
        raise BlockedError(
            reason=(
                f"Relay trust anchor from {deploy_environment!r} "
                "does not match its runtime manifest"
            ),
            resource=f"runtime-trust:{deploy_environment}",
        )
    return certificate, digest


def _windows_source_identity_script() -> str:
    protocol_pathspecs = repr(list(PROTOCOL_SOURCE_PATHS))
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
