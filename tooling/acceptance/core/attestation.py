from __future__ import annotations

import hashlib
import json
import shlex
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from ._paths import REPO_ROOT
from .errors import BlockedError, ProvisioningError
from .evidence_store import (
    current_artifact_ref,
    write_current_artifact,
)
from .provisioning import StationAttestation, utc_now


WORKSPACE_DIGEST_EXCLUDED_PATHS = frozenset(
    {"docs/architecture/acceptance-framework/coverage-report.md"}
)


def commits_match(actual: str, expected: str) -> bool:
    return (
        len(actual) >= 7
        and len(expected) >= 7
        and (actual.startswith(expected) or expected.startswith(actual))
    )


def source_proto_digest(root: Path) -> str:
    completed = subprocess.run(
        [
            "git",
            "ls-files",
            "-z",
            "--",
            "model/domain",
            "apps/desktop/src/gen/proto",
            "apps/station",
        ],
        cwd=root,
        capture_output=True,
        check=True,
    )
    paths = [
        root / relative.decode()
        for relative in completed.stdout.split(b"\0")
        if relative
        and (
            relative.endswith(b".proto")
            or relative.endswith(b"_pb.ts")
            or relative.endswith(b".pb.go")
        )
    ]
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix().encode()
        digest.update(relative)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def source_workspace_digest(root: Path) -> str:
    excluded_pathspecs = [
        f":(exclude){path}"
        for path in sorted(WORKSPACE_DIGEST_EXCLUDED_PATHS)
    ]
    diff = subprocess.run(
        ["git", "diff", "--binary", "HEAD", "--", ".", *excluded_pathspecs],
        cwd=root,
        capture_output=True,
        check=True,
    ).stdout
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=root,
        capture_output=True,
        check=True,
    ).stdout.split(b"\0")
    paths = sorted(
        path
        for path in untracked
        if path and path.decode() not in WORKSPACE_DIGEST_EXCLUDED_PATHS
    )
    if not diff and not paths:
        return "clean"

    digest = hashlib.sha256()
    digest.update(diff)
    for raw_path in paths:
        path = root / raw_path.decode()
        digest.update(raw_path)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def read_station_version(station_url: str) -> dict[str, Any]:
    url = f"{station_url.rstrip('/')}/app-meta/version"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        TimeoutError,
        json.JSONDecodeError,
    ) as error:
        raise BlockedError(
            reason=f"Station runtime identity is unavailable at {url}: {error}",
            resource=f"station-identity:{url}",
        ) from error
    data = payload.get("data") if isinstance(payload, dict) else None
    version = data if isinstance(data, dict) else payload
    if not isinstance(version, dict):
        raise BlockedError(
            reason=f"Station runtime identity at {url} is not a JSON object",
            resource=f"station-identity:{url}",
        )
    return version


def _load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _remote_source_identity(deploy_environment: str) -> tuple[str, str, str]:
    # Import lazily to preserve the core -> transport dependency boundary during
    # package initialization; the SSH transport itself imports core error types.
    from ..transports import SshTarget, SshTransport

    environment_path = (
        REPO_ROOT / ".local" / "deploy" / "envs" / f"{deploy_environment}.env"
    )
    if not environment_path.is_file():
        raise BlockedError(
            reason=f"Station deployment environment is missing: {environment_path}",
            resource=f"station-deployment:{deploy_environment}",
        )
    environment = _load_env(environment_path)
    host = environment.get("PT_DEPLOY_HOST", "")
    user = environment.get("PT_DEPLOY_USER", "")
    deploy_path = environment.get("PT_DEPLOY_PATH", "")
    if not host or not user or not deploy_path:
        raise BlockedError(
            reason=(
                f"Station deployment environment {deploy_environment} must define "
                "PT_DEPLOY_HOST, PT_DEPLOY_USER, and PT_DEPLOY_PATH"
            ),
            resource=f"station-deployment:{deploy_environment}",
        )

    try:
        target = SshTarget(
            host=host,
            user=user,
            port=int(environment.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=environment.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ),
        )
    except (ValueError, ProvisioningError) as error:
        raise BlockedError(
            reason=(
                f"Station deployment SSH contract is invalid for "
                f"{deploy_environment}: {error}"
            ),
            resource=f"station-deployment:{deploy_environment}",
        ) from error

    digest_script = (
        "import hashlib,pathlib;"
        "r=pathlib.Path('.').resolve();"
        "p=list((r/'model/domain').rglob('*.proto'))+"
        "list((r/'apps/desktop/src/gen/proto').rglob('*.ts'))+"
        "list((r/'apps/station').rglob('*.pb.go'));"
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
    completed = SshTransport(target).run_argv(
        ["sh", "-lc", remote_command],
        timeout=30,
        check=False,
    )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if completed.returncode != 0 or len(lines) < 3:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no output"
        raise BlockedError(
            reason=(
                f"Cannot attest Station deployment {deploy_environment}: {detail}"
            ),
            resource=f"station-deployment:{deploy_environment}",
        )
    return lines[-3], lines[-2], lines[-1]


def _local_source_identity() -> tuple[str, str, str]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return commit, "clean" if not status else "dirty", source_proto_digest(REPO_ROOT)


def produce_station_attestation(
    *,
    environment_id: str,
    run_id: str,
    station_url: str,
    profile_env: dict[str, str],
) -> StationAttestation:
    version = read_station_version(station_url)
    live_commit = str(version.get("build_commit") or "")
    build_time = str(version.get("build_time") or "")
    if live_commit.lower() in {"", "unknown"}:
        raise BlockedError(
            reason=(
                f"Station at {station_url} does not expose a stable build_commit"
            ),
            resource=f"station-identity:{station_url}",
        )

    mode = profile_env.get("PT_STATION_MODE", "local")
    deploy_environment = profile_env.get("PT_STATION_DEPLOY_ENV", "")
    if mode == "remote":
        if not deploy_environment:
            raise BlockedError(
                reason="Remote Station profile is missing PT_STATION_DEPLOY_ENV",
                resource="profile:PT_STATION_DEPLOY_ENV",
            )
        deployed_commit, workspace_digest, proto_digest = _remote_source_identity(
            deploy_environment
        )
    else:
        deployed_commit, workspace_digest, proto_digest = _local_source_identity()

    if not commits_match(live_commit, deployed_commit):
        raise BlockedError(
            reason=(
                f"Live Station commit {live_commit} does not match deployment "
                f"commit {deployed_commit}"
            ),
            resource=f"station-attestation:{station_url}",
        )
    if workspace_digest != "clean":
        raise BlockedError(
            reason="Station deployment workspace is dirty",
            resource=f"station-attestation:{station_url}",
        )

    produced_at = utc_now()
    payload = StationAttestation(
        environment_id=environment_id,
        url=station_url.rstrip("/"),
        live_commit=deployed_commit,
        workspace_digest=workspace_digest,
        proto_digest=proto_digest,
        artifact_ref={},
        produced_at=produced_at,
        build_time=build_time,
    ).to_dict()
    relative_path = "runtime/station-attestation.json"
    try:
        write_current_artifact(
            relative_path,
            (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8"),
            repo_root=REPO_ROOT,
        )
        artifact_ref = current_artifact_ref(
            relative_path,
            repo_root=REPO_ROOT,
            media_type="application/json",
        )
    except ProvisioningError:
        raise
    return StationAttestation(
        environment_id=environment_id,
        url=station_url.rstrip("/"),
        live_commit=deployed_commit,
        workspace_digest=workspace_digest,
        proto_digest=proto_digest,
        artifact_ref=artifact_ref.to_dict(),
        produced_at=produced_at,
        build_time=build_time,
    )
