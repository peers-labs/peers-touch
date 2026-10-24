"""Prepare disposable private Social state through the canonical reset owner."""
from __future__ import annotations

import json
import subprocess
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tooling.development.secure_content.activation_transport import (
    ReviewedSchemaActivationTransport,
)
from tooling.development.secure_content.schema_activation import (
    CROSS_STATION_SOCIAL_PROFILE_TARGETS,
    PROFILE_TARGETS,
    LeaseWrappedSSHMaintenanceBoundary,
    _validate_execution_result,
    canonical_digest,
    validate_reset_manifest,
    write_immutable_json,
)


@dataclass(frozen=True)
class RuntimeSchemaTarget:
    profile_id: str
    service_id: str
    deployment_environment: str
    destructive_scope: str


RUNTIME_TARGETS = {
    **PROFILE_TARGETS,
    **CROSS_STATION_SOCIAL_PROFILE_TARGETS,
    "three": RuntimeSchemaTarget(
        "three", "station-three", "station-three", "station-three-social-private",
    ),
}


def prepare_private_social_runtime(
    repo_root: Path, *, task_id: str, budget_seconds: int = 360,
) -> Path:
    """One Suite reset; Profile capability authorizes it, never a Plan."""
    from tooling.acceptance.core.errors import BlockedError

    try:
        return _prepare(repo_root, task_id=task_id, budget_seconds=budget_seconds)
    except BlockedError:
        raise
    except Exception as error:
        raise BlockedError(
            reason=f"canonical private Social schema preparation failed: {error}",
            resource="secure-content:runtime-schema",
        ) from error


def _prepare(repo_root: Path, *, task_id: str, budget_seconds: int) -> Path:
    from tooling.acceptance.core.errors import BlockedError

    started = time.monotonic()

    def remaining() -> int:
        available = int(budget_seconds - (time.monotonic() - started))
        if available < 30:
            raise RuntimeError("private Social schema preparation budget exhausted")
        return available

    checked = subprocess.run(
        ["make", "env-check"], cwd=repo_root, capture_output=True,
        text=True, timeout=min(30, remaining()), check=True,
    )
    authority = json.loads(checked.stdout)
    binding, profile, source = (
        authority["binding"], authority["profile"], authority["source"],
    )
    target = RUNTIME_TARGETS.get(profile["profile"])
    if target is None or target.deployment_environment != profile["stationDeployEnvironment"]:
        raise BlockedError(
            reason="private Social schema target is not in the reviewed reset allowlist",
            resource="secure-content:runtime-schema",
        )
    if (
        profile["resetPolicy"] != "agent-resettable"
        or "station.reset" not in binding["allowedCapabilities"]
        or profile["sourceState"] != "tracked-clean"
        or profile["stationMode"] != "remote"
        or Path(binding["canonicalRoot"]).resolve() != repo_root.resolve()
    ):
        raise BlockedError(
            reason="private Social preparation requires an exact reviewed resettable Profile",
            resource=target.destructive_scope,
        )
    if subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=repo_root, capture_output=True, text=True, timeout=10, check=True,
    ).stdout.strip():
        raise RuntimeError("private Social preparation requires tracked-clean source")
    reset_id = "runtime-schema-" + uuid.uuid4().hex
    directory = (
        Path(authority["workspaceStateRoot"])
        / "secure-content" / "runtime-schema" / reset_id
    )
    request = {
        "source_commit": source["head"], "workspace_id": binding["workspaceId"],
        "profile_id": target.profile_id, "station_service_id": target.service_id,
        "deployment_environment": target.deployment_environment,
        "destructive_scope": target.destructive_scope,
    }
    declaration = {**request, "task_id": task_id, "reset_id": reset_id}
    request["declaration_digest"] = canonical_digest(declaration)
    write_immutable_json(directory / "declaration.json", declaration)
    transport = ReviewedSchemaActivationTransport(repo_root=repo_root)
    boundary = LeaseWrappedSSHMaintenanceBoundary(
        repo_root=repo_root,
        command_resolver=lambda supplied, budget: transport.maintenance_command(
            supplied, budget_seconds=budget,
        ),
    )

    def payload(identity_field: str, manifest: dict | None = None) -> dict:
        now = datetime.now(timezone.utc)
        value = {
            "schema_version": 1, identity_field: uuid.uuid4().hex,
            "reset_id": reset_id, "reset_intent": "SCHEMA_ACTIVATION",
            "plan_id": "", "task_id": task_id,
            **{key: value for key, value in request.items()
               if key != "station_service_id"},
            "issued_at": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "expires_at": (now + timedelta(seconds=remaining())).isoformat(
                timespec="milliseconds",
            ).replace("+00:00", "Z"),
        }
        field = "request_digest" if manifest is None else "invocation_digest"
        if manifest is not None:
            value["reset_manifest_digest"] = manifest["manifest_digest"]
        value[field] = canonical_digest(value)
        return value

    transport.deploy(request, budget_seconds=remaining())
    with boundary.open(request, budget_seconds=remaining()) as session:
        audit = payload("request_id")
        write_immutable_json(directory / "audit-request.json", audit)
        manifest = dict(session.prepare(audit))
        validate_reset_manifest(
            manifest, target=target, intent="SCHEMA_ACTIVATION",
            generation_id=source["head"], workspace_id=binding["workspaceId"],
            reset_id=reset_id,
        )
        write_immutable_json(directory / "reset-manifest.json", manifest)
        first = payload("invocation_id", manifest)
        write_immutable_json(directory / "first-invocation.json", first)
        response = session.invoke(first)
        write_immutable_json(directory / "first-response.json", response)
        _validate_execution_result(
            response, manifest=manifest, expected_state="OBJECTS_DELETED",
            invocations=(first,), needs_deployment=True, require_attestation=False,
            expected_exact_replay=False,
        )
        try:
            transport.deploy(request, budget_seconds=remaining())
            final = payload("invocation_id", manifest)
            write_immutable_json(directory / "final-invocation.json", final)
            response = session.invoke(final)
            write_immutable_json(directory / "final-response.json", response)
            journal, attestation = _validate_execution_result(
                response, manifest=manifest, expected_state="COMPLETE",
                invocations=(first, final), needs_deployment=False,
                require_attestation=True, expected_exact_replay=False,
            )
        except BaseException as error:
            try:
                transport.requiesce(request, budget_seconds=30)
            except Exception as cleanup_error:
                raise RuntimeError(
                    f"schema activation failed: {error}; "
                    f"Station re-quiescence failed: {cleanup_error}"
                ) from error
            raise
    write_immutable_json(directory / "completed-reset-journal.json", journal)
    return write_immutable_json(
        directory / "canonical-private-schema-attestation.json", attestation,
    )
