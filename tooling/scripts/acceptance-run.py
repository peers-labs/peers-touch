#!/usr/bin/env python3
"""Run acceptance gates from the current plan or explicit gate ids."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

RUN_ARTIFACT_KIND = "acceptance-run"
RESULT_ARTIFACT_KIND = "acceptance-gate-result"
AGGREGATE_SOURCE_ENV = "PT_ACCEPTANCE_AGGREGATE_SOURCE"
RESULT_TRACEABILITY_FIELDS = (
    "sourceArtifact",
    "sourceArtifactKind",
    "sourcePhase",
    "sourceBom",
    "sourceSpec",
    "sourceGate",
)
CONTEXT_GATE_INHERITED_ENV_KEYS = (
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATH",
    "PATHEXT",
    "PYTHONHOME",
    "PYTHONIOENCODING",
    "PYTHONPATH",
    "PYTHONUTF8",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "WINDIR",
)


def source_identity_drift(
    expected: dict[str, str],
    observed: dict[str, str],
) -> dict[str, dict[str, str]] | None:
    if observed == expected:
        return None
    return {
        "expected": expected,
        "observed": observed,
    }


@contextlib.contextmanager
def run_environment(environment: dict[str, str]):
    keys = (
        "PT_ACCEPTANCE_ARTIFACT_ROOT",
        "PT_ACCEPTANCE_WORKSPACE_ID",
        "PT_ACCEPTANCE_GATE_ID",
        "PT_ACCEPTANCE_RUN_ID",
        "PT_ACCEPTANCE_REDACTION_VALUES",
        "PT_ACCEPTANCE_RUNTIME_CELL",
        AGGREGATE_SOURCE_ENV,
    )
    previous = {key: os.environ.get(key) for key in keys}
    for key in keys:
        if key in environment:
            os.environ[key] = environment[key]
        else:
            os.environ.pop(key, None)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def context_gate_subprocess_environment(
    gate_run: Any,
    source: Mapping[str, str],
) -> dict[str, str]:
    inherited = {
        key: source[key]
        for key in CONTEXT_GATE_INHERITED_ENV_KEYS
        if source.get(key)
    }
    environment = gate_run.subprocess_environment(inherited)
    environment.pop("PT_ACCEPTANCE_REDACTION_VALUES", None)
    return environment


def environment_provisioner(environment_id: str) -> Any | None:
    from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
    from tooling.acceptance.provisioners import get_provisioner

    contract_path = ENVIRONMENTS_DIR / f"{environment_id}.yaml"
    if not contract_path.exists():
        return None
    return get_provisioner(EnvironmentContract.from_yaml(contract_path))


def provision_environment(
    environment_id: str,
    gate_id: str,
    provisioner: Any | None = None,
) -> tuple[Any | None, dict[str, Any] | None, Path | None]:
    if environment_id == "local":
        return None, None, None

    from tooling.acceptance.core import (
        ENVIRONMENTS_DIR,
        blocked_manifest,
        current_artifact_ref,
        write_current_artifact,
        new_manifest,
    )

    contract_path = ENVIRONMENTS_DIR / f"{environment_id}.yaml"
    if not contract_path.exists():
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip() or "unknown"
        base = new_manifest(
            environment_id=environment_id,
            gate_id=gate_id,
            requested_profile="unknown",
            resolved_profile="unknown",
            slot=0,
            commit=commit,
            worktree=str(REPO_ROOT),
        )
        manifest = blocked_manifest(
            base,
            reason=(
                f"Environment {environment_id!r} has no provisioning contract "
                f"at {contract_path}"
            ),
            resource=f"environment-contract:{environment_id}",
        )
        manifest_path = write_current_artifact(
            "runtime/environment-manifest.json",
            (
                json.dumps(manifest.to_dict(), indent=2, sort_keys=True) + "\n"
            ).encode("utf-8"),
            repo_root=REPO_ROOT,
        )
        manifest_dict = manifest.to_dict()
        manifest_dict["_manifest_ref"] = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=REPO_ROOT,
        ).to_dict()
        return None, manifest_dict, manifest_path

    provisioner = provisioner or environment_provisioner(environment_id)
    if provisioner is None:
        raise RuntimeError(
            f"environment provisioner is unavailable: {environment_id}"
        )
    manifest = provisioner.provision(gate_id)
    manifest_dict = manifest.to_dict()
    manifest_path = provisioner.write_manifest()
    manifest_dict["_manifest_ref"] = current_artifact_ref(
        "runtime/environment-manifest.json",
        repo_root=REPO_ROOT,
    ).to_dict()
    return provisioner, manifest_dict, manifest_path


def credential_values(provisioner: Any | None) -> tuple[str, ...]:
    """Use the values resolved by the active provisioner instance."""
    if provisioner is None:
        return ()
    values = provisioner.resolved_credential_values
    if not isinstance(values, tuple) or any(
        not isinstance(value, str) for value in values
    ):
        raise TypeError(
            "provisioner resolved_credential_values must be tuple[str, ...]"
        )
    return values


def redact_runtime_text(
    text: str,
    secret_values: tuple[str, ...],
) -> str:
    from tooling.acceptance.core.redaction import redact_text_with_values

    return redact_text_with_values(text, secret_values)


def redact_runtime_value(
    value: Any,
    secret_values: tuple[str, ...],
) -> tuple[Any, bool]:
    from tooling.acceptance.core.redaction import redact_value

    leaked = False
    credential_values = tuple(
        secret for secret in secret_values if len(secret) >= 4
    )

    def visit(item: Any) -> Any:
        nonlocal leaked
        if isinstance(item, str):
            if any(secret in item for secret in credential_values):
                leaked = True
            return redact_runtime_text(item, secret_values)
        if isinstance(item, dict):
            return {key: visit(nested) for key, nested in item.items()}
        if isinstance(item, list):
            return [visit(nested) for nested in item]
        if isinstance(item, tuple):
            return tuple(visit(nested) for nested in item)
        return item

    return redact_value(visit(value)), leaked


def audit_runtime_artifacts(
    run_dir: Path,
    secret_values: tuple[str, ...],
) -> list[str]:
    from tooling.acceptance.core.redaction import (
        redact_artifact_bytes,
        redact_text_with_values,
    )

    leaked_paths: list[str] = []
    for path in list(run_dir.rglob("*")):
        relative = path.relative_to(run_dir)
        if (
            not path.is_file()
            or relative == Path(".active.lock")
        ):
            continue
        relative_path = relative.as_posix()
        current = run_dir
        has_symlink = False
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                has_symlink = True
                break
        if has_symlink:
            leaked_paths.append(relative_path)
            continue
        if (
            redact_text_with_values(relative_path, secret_values)
            != relative_path
        ):
            leaked_paths.append(relative_path)
            continue
        try:
            raw_bytes = path.read_bytes()
        except OSError:
            leaked_paths.append(relative_path)
            continue
        _, redacted = redact_artifact_bytes(raw_bytes, secret_values)
        if redacted:
            leaked_paths.append(relative_path)
    return sorted(set(leaked_paths))


def finalize_runtime_log(
    gate_run: Any,
    gate_id: str,
    output_text: str,
    secret_values: tuple[str, ...],
) -> tuple[Any, list[str], list[str]]:
    reject_unresolved_secret_artifacts(
        gate_run,
        audit_runtime_artifacts(gate_run.run_dir, secret_values),
    )
    redacted_output = redact_runtime_text(output_text, secret_values)
    redacted_paths: list[str] = []
    log_path = f"logs/{gate_id}.log"
    log_ref = gate_run.write_bytes(
        log_path,
        redacted_output.encode("utf-8"),
        media_type="text/plain",
        role="log",
    )
    if redacted_output != output_text:
        redacted_paths.append(log_path)
    leaked_paths = audit_runtime_artifacts(
        gate_run.run_dir,
        secret_values,
    )
    reject_unresolved_secret_artifacts(gate_run, leaked_paths)
    return (
        log_ref,
        sorted(set(redacted_paths)),
        sorted(set(leaked_paths)),
    )


def reject_unresolved_secret_artifacts(
    gate_run: Any,
    leaked_paths: list[str],
) -> list[str]:
    from tooling.acceptance.core import EvidenceConflict

    unresolved = sorted(set(leaked_paths))
    if not unresolved:
        return []
    gate_run.discard()
    raise EvidenceConflict(
        "resolved credentials bypassed the immutable artifact writer: "
        + ", ".join(unresolved)
    )


def persist_provisioner_cleanup_result(
    *,
    gate_run: Any,
    gate_id: str,
    environment: str,
    provisioner_id: str,
    cleanup_status: str,
    completed_resources: tuple[str, ...],
    cleanup_error: str,
    secret_values: tuple[str, ...],
    environment_cleanup_status: str = "not-required",
    environment_cleanup_error: str = "",
    runtime_cell: str = "",
    runtime_cell_cleanup_status: str = "not-required",
    runtime_cell_cleanup: dict[str, Any] | None = None,
    runtime_cell_cleanup_error: str = "",
    launch_context_quiesce_status: str = "not-required",
    launch_context_close_status: str = "not-required",
    launch_context_cleanup: dict[str, Any] | None = None,
    launch_context_cleanup_error: str = "",
    gate_process_cleanup_status: str = "not-required",
    gate_process_cleanup_error: str = "",
) -> dict[str, Any]:
    payload = {
        "artifactKind": "acceptance-provisioner-cleanup-result",
        "gateId": gate_id,
        "environment": environment,
        "provisioner": provisioner_id,
        "status": cleanup_status,
        "completionStatus": (
            "DONE" if cleanup_status == "passed" else "PARTIAL"
        ),
        "proofStatus": (
            "PROVEN" if cleanup_status == "passed" else "UNPROVEN"
        ),
        "completedResources": list(completed_resources),
        "error": cleanup_error,
        "environmentCleanupStatus": environment_cleanup_status,
        "environmentCleanupError": environment_cleanup_error,
        "runtimeCell": runtime_cell or None,
        "runtimeCellCleanupStatus": runtime_cell_cleanup_status,
        "runtimeCellCleanup": runtime_cell_cleanup,
        "runtimeCellCleanupError": runtime_cell_cleanup_error,
        "launchContextQuiesceStatus": launch_context_quiesce_status,
        "launchContextCloseStatus": launch_context_close_status,
        "launchContextCleanup": launch_context_cleanup,
        "launchContextCleanupError": launch_context_cleanup_error,
        "gateProcessCleanupStatus": gate_process_cleanup_status,
        "gateProcessCleanupError": gate_process_cleanup_error,
    }
    redacted_payload, _ = redact_runtime_value(payload, secret_values)
    return gate_run.write_json(
        "reports/provisioner-cleanup.json",
        redacted_payload,
        role="provisioner-cleanup",
    ).to_dict()


def provision_runtime_cell(
    *,
    cell_id: str,
    gate_id: str,
    gate_run: Any,
) -> tuple[Any, dict[str, Any], Path]:
    from tooling.acceptance.provisioners import get_runtime_cell_lifecycle

    lifecycle = get_runtime_cell_lifecycle(cell_id)
    acquired = False
    try:
        manifest = lifecycle.ready(gate_id)
        acquired = True
        payload = manifest.to_dict()
        manifest_ref = gate_run.write_json(
            "runtime/runtime-cell-manifest.json",
            payload,
            role="runtime-cell-manifest",
        )
        payload["_manifest_ref"] = manifest_ref.to_dict()
        return lifecycle, payload, gate_run.store.resolve(manifest_ref)
    except BaseException as error:
        if acquired:
            try:
                lifecycle.stop()
            except Exception as cleanup_error:
                from tooling.acceptance.core import ProvisioningError

                raise ProvisioningError(
                    f"runtime-cell provisioning failed ({error}); "
                    f"cleanup also failed: {cleanup_error}"
                ) from error
        raise


def provisioning_failure_result(
    *,
    gate_id: str,
    command: str,
    environment: str,
    tier: str,
    error: Exception,
    duration_seconds: float,
) -> dict[str, Any]:
    from tooling.acceptance.core import BlockedError
    from tooling.acceptance.core.redaction import redact_text

    blocked = isinstance(error, BlockedError)
    result = {
        "id": gate_id,
        "command": command,
        "environment": environment,
        "tier": tier,
        "status": "blocked" if blocked else "failed",
        "exit_code": None,
        "duration_seconds": duration_seconds,
        "completionStatus": "BLOCKED" if blocked else "PARTIAL",
        "proofStatus": "UNPROVEN",
        "reason": redact_text(str(error)),
        "errorType": type(error).__name__,
        "sourceArtifact": "tooling/acceptance/gates.yaml",
        "sourceArtifactKind": "acceptance-gate-catalog",
        "sourcePhase": "Runtime Provisioning",
        "sourceBom": ["WS2", "WS6"],
        "sourceSpec": ["D-07", "D-08"],
        "sourceGate": (
            "Provisioner errors must fail structurally before product Gate "
            "execution"
        ),
    }
    if blocked:
        result["blockedReason"] = error.reason
        result["blockedResource"] = error.resource
    return result


def runtime_cell_failure_result(
    *,
    gate_id: str,
    command: str,
    environment: str,
    tier: str,
    runtime_cell: str,
    error: Exception,
    duration_seconds: float,
) -> dict[str, Any]:
    from tooling.acceptance.core import BlockedError
    from tooling.acceptance.core.redaction import redact_text

    blocked = isinstance(error, BlockedError)
    result = {
        "id": gate_id,
        "command": command,
        "environment": environment,
        "runtimeCell": runtime_cell,
        "tier": tier,
        "status": "blocked" if blocked else "failed",
        "exit_code": None,
        "duration_seconds": duration_seconds,
        "completionStatus": "BLOCKED" if blocked else "PARTIAL",
        "proofStatus": "UNPROVEN",
        "reason": redact_text(str(error)),
        "errorType": type(error).__name__,
        "sourceArtifact": "tooling/acceptance/runtime-cells",
        "sourceArtifactKind": "acceptance-runtime-cell-contract",
        "sourcePhase": "Runtime Cell Provisioning",
        "sourceBom": ["NDR-W1"],
        "sourceSpec": ["D-13", "D-14"],
        "sourceGate": (
            "selected runtime cell must reach LEASED before product Gate "
            "execution"
        ),
    }
    if blocked:
        result["blockedReason"] = redact_text(str(error))
        result["blockedResource"] = f"runtime-cell:{runtime_cell}"
    return result


def ephemeral_launch_failure_result(
    *,
    gate_id: str,
    command: str,
    environment: str,
    tier: str,
    error: Exception,
    duration_seconds: float,
) -> dict[str, Any]:
    from tooling.acceptance.core import (
        BlockedError,
        EphemeralLaunchCleanupFailed,
        EphemeralLaunchError,
    )
    from tooling.acceptance.core.redaction import redact_text

    cleanup_failed = isinstance(error, EphemeralLaunchCleanupFailed)
    blocked = isinstance(error, (BlockedError, EphemeralLaunchError)) and not cleanup_failed
    result = {
        "id": gate_id,
        "command": command,
        "environment": environment,
        "tier": tier,
        "status": "blocked" if blocked else "failed",
        "exit_code": None,
        "duration_seconds": duration_seconds,
        "completionStatus": "BLOCKED" if blocked else "PARTIAL",
        "proofStatus": "UNPROVEN",
        "reason": redact_text(str(error)),
        "errorType": type(error).__name__,
        "sourceArtifact": "tooling/acceptance/gates.yaml",
        "sourceArtifactKind": "acceptance-gate-catalog",
        "sourcePhase": (
            "Ephemeral Gate Launch Cleanup"
            if cleanup_failed
            else "Ephemeral Gate Launch"
        ),
        "sourceBom": ["EGLC-W3"],
        "sourceSpec": ["D-18"],
        "sourceGate": (
            "Context-enabled Gates must bind an exact run-scoped capability "
            "channel before product Gate execution"
        ),
    }
    if cleanup_failed:
        result["cleanupStatus"] = "failed"
        result["cleanupError"] = redact_text(str(error))
        result["launchContextCleanup"] = ephemeral_cleanup_payload(
            getattr(error, "result", None)
        )
    elif isinstance(error, BlockedError):
        result["blockedReason"] = redact_text(error.reason)
        result["blockedResource"] = redact_text(error.resource)
    elif blocked:
        result["blockedReason"] = redact_text(str(error))
        result["blockedResource"] = f"ephemeral-launch-context:{gate_id}"
    return result


def ephemeral_cleanup_payload(value: Any) -> dict[str, Any] | None:
    from tooling.acceptance.core import EphemeralCleanupResult

    if not isinstance(value, EphemeralCleanupResult):
        return None
    return {
        "descriptorsClosed": value.descriptors_closed,
        "brokerStopped": value.broker_stopped,
        "handlersClosed": value.handlers_closed,
        "secretsZeroized": value.secrets_zeroized,
        "quarantinedCapabilities": list(value.quarantined_capabilities),
        "errors": list(value.errors),
    }


def load_plan(
    path: Path | None,
    store: Any,
) -> tuple[dict[str, Any], Any]:
    if path is not None:
        if not path.is_file():
            raise SystemExit(f"acceptance plan {str(path)!r} does not exist")
        return json.loads(path.read_text(encoding="utf-8")), str(path)
    try:
        reference = store.latest_artifact_ref("acceptance-plan", "plan")
    except Exception:
        subprocess.run(
            ["python3", "tooling/scripts/acceptance-plan.py"],
            cwd=REPO_ROOT,
            check=True,
            env={
                **os.environ,
                "PT_ACCEPTANCE_ARTIFACT_ROOT": str(store.root),
            },
        )
        reference = store.latest_artifact_ref("acceptance-plan", "plan")
    return store.read_json(reference), reference.to_dict()


def load_gate_definitions(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")).get("gates", {})


def gate_launch_fields(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    has_command = "command" in definition
    has_argv = "argv" in definition
    if has_command == has_argv:
        raise SystemExit(
            f"{gate_id}: gate must define exactly one of command or argv"
        )
    if has_command:
        command = definition["command"]
        if not isinstance(command, str) or not command.strip():
            raise SystemExit(f"{gate_id}: gate command must be a non-empty string")
        launch: dict[str, Any] = {"command": command}
    else:
        argv = definition["argv"]
        if (
            not isinstance(argv, list)
            or not argv
            or any(not isinstance(argument, str) or not argument for argument in argv)
        ):
            raise SystemExit(
                f"{gate_id}: gate argv must be a non-empty list of non-empty strings"
            )
        launch = {"argv": list(argv)}

    capabilities = definition.get("ephemeralCapabilities")
    if capabilities is not None:
        if (
            not isinstance(capabilities, list)
            or not capabilities
            or any(
                not isinstance(capability, str) or not capability
                for capability in capabilities
            )
            or len(set(capabilities)) != len(capabilities)
        ):
            raise SystemExit(
                f"{gate_id}: ephemeralCapabilities must be a unique, non-empty "
                "list of non-empty strings"
            )
        if not has_argv:
            raise SystemExit(f"{gate_id}: ephemeralCapabilities requires argv")
        if not is_supported_context_argv(argv):
            raise SystemExit(
                f"{gate_id}: ephemeralCapabilities requires a Python module, "
                "script, or -c argv"
            )
        launch["ephemeralCapabilities"] = list(capabilities)
    return launch


def is_supported_context_argv(argv: list[str]) -> bool:
    if len(argv) < 2 or not re.fullmatch(
        r"python(?:\d+(?:\.\d+)*)?",
        Path(argv[0]).name,
    ):
        return False
    if argv[1] == "-m":
        return len(argv) >= 3 and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", argv[2])
        )
    if argv[1] == "-c":
        return len(argv) >= 3
    return not argv[1].startswith("-") and Path(argv[1]).suffix == ".py"


def gate_from_definition(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": gate_id,
        **gate_launch_fields(gate_id, definition),
        "timeout_seconds": definition.get("timeout_seconds", 600),
        "environment": definition.get("environment", "local"),
        "provisioner": definition.get("provisioner", ""),
        "requiredRuntimeCells": definition.get("requiredRuntimeCells", []),
        "tier": definition.get("tier", "local-evidence"),
        "description": definition.get("description", ""),
        "required_by": ["manual"],
    }


def gate_launch_display(gate: dict[str, Any]) -> str:
    if "command" in gate:
        return str(gate["command"])
    return json.dumps(gate["argv"], ensure_ascii=False)


def prepare_gate_launch_context(
    *,
    gate: dict[str, Any],
    gate_run: Any,
    provisioner: Any,
    manifest: dict[str, Any] | None,
) -> tuple[Any, str]:
    from tooling.acceptance.core import (
        BlockedError,
        EphemeralGateLaunchContext,
        EphemeralLaunchContextInvalid,
    )

    required_capabilities = tuple(gate.get("ephemeralCapabilities", ()))
    if not required_capabilities:
        raise EphemeralLaunchContextInvalid(
            "launch context preparation requires capabilities",
            operation="prepare",
        )
    gate_id = str(gate["id"])
    if provisioner is None or manifest is None:
        raise BlockedError(
            reason=(
                f"Gate {gate_id!r} requires ephemeral capabilities but has no "
                "ready Environment Provisioner"
            ),
            resource=f"ephemeral-capabilities:{gate_id}",
        )
    provisioning_run_id = manifest.get("runId")
    if not isinstance(provisioning_run_id, str) or not provisioning_run_id:
        raise BlockedError(
            reason=(
                f"Gate {gate_id!r} cannot bind ephemeral capabilities without "
                "a provisioning run identity"
            ),
            resource=f"provisioning-run:{gate_id}",
        )
    context = provisioner.create_gate_launch_context(
        gate_id=gate_id,
        evidence_run_id=gate_run.run_id,
        provisioning_run_id=provisioning_run_id,
        required_capabilities=required_capabilities,
    )
    if not isinstance(context, EphemeralGateLaunchContext):
        raise BlockedError(
            reason=(
                f"Environment {provisioner.environment_id!r} did not create "
                f"the required launch context for Gate {gate_id!r}"
            ),
            resource=f"ephemeral-capabilities:{gate_id}",
        )
    return context, provisioning_run_id


def plan_gate_from_entry(entry: Any, definitions: dict[str, Any]) -> dict[str, Any]:
    if isinstance(entry, str):
        if entry not in definitions:
            raise SystemExit(f"gate {entry!r} is missing from gate definitions")
        return gate_from_definition(entry, definitions[entry])
    if not isinstance(entry, dict):
        raise SystemExit(f"plan selected_gates entry must be a gate id string or object: {entry!r}")
    gate_id = entry.get("id")
    if not isinstance(gate_id, str) or not gate_id:
        raise SystemExit(f"plan selected_gates object is missing id: {entry!r}")
    if gate_id not in definitions:
        raise SystemExit(f"gate {gate_id!r} is missing from gate definitions")
    gate = gate_from_definition(gate_id, definitions[gate_id])
    for field in (
        "command",
        "argv",
        "ephemeralCapabilities",
    ):
        if field in entry and entry[field] != gate.get(field):
            raise SystemExit(
                f"plan gate {gate_id!r} has stale or conflicting {field}"
            )
    if "timeout_seconds" in entry:
        gate["timeout_seconds"] = entry["timeout_seconds"]
    if "required_by" in entry:
        gate["required_by"] = entry["required_by"]
    return gate


def selected_gates_from_plan(plan: dict[str, Any], definitions: dict[str, Any]) -> list[dict[str, Any]]:
    return [plan_gate_from_entry(entry, definitions) for entry in plan.get("selected_gates", [])]


def resolve_requested_gates(
    plan: dict[str, Any],
    definitions: dict[str, Any],
    requested_gate_ids: list[str],
) -> list[dict[str, Any]]:
    if not requested_gate_ids:
        return selected_gates_from_plan(plan, definitions)
    resolved: list[dict[str, Any]] = []
    for gate_id in requested_gate_ids:
        if gate_id not in definitions:
            raise SystemExit(f"gate {gate_id!r} is missing from gate definitions")
        resolved.append(gate_from_definition(gate_id, definitions[gate_id]))
    return resolved


def filter_gates_by_tier(gates: list[dict[str, Any]], tiers: list[str]) -> list[dict[str, Any]]:
    if not tiers:
        return gates
    selected = set(tiers)
    return [gate for gate in gates if gate.get("tier", "local-evidence") in selected]


def select_runtime_cell(
    gate: dict[str, Any],
    requested_cell: str,
) -> str:
    from tooling.acceptance.core import parse_required_runtime_cells

    gate_id = str(gate.get("id") or "")
    try:
        required_cells = parse_required_runtime_cells(
            gate_id,
            gate.get("requiredRuntimeCells"),
        )
    except Exception as error:
        raise SystemExit(str(error)) from error
    selected = requested_cell.strip()
    if required_cells:
        if not selected:
            raise SystemExit(
                f"gate {gate_id!r} requires explicit --runtime-cell; "
                f"choose one of {required_cells}"
            )
        if selected not in required_cells:
            raise SystemExit(
                f"gate {gate_id!r} does not declare runtime cell "
                f"{selected!r}; expected one of {required_cells}"
            )
        return selected
    return ""


def load_json_artifact(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def evidence_summary_from_artifact(path: Any, artifact: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {"path": path}
    if not isinstance(artifact, dict):
        summary["jsonValueType"] = "array" if isinstance(artifact, list) else type(artifact).__name__
        if isinstance(artifact, list):
            summary["itemCount"] = len(artifact)
        return summary
    for key in (
        "artifactKind",
        "status",
        "completionStatus",
        "proofStatus",
        "gateId",
        "phase",
        "bom",
        "spec",
        "gate",
        "reason",
        "failedStep",
        "sampleEmissionAllowed",
    ):
        if key in artifact:
            summary[key] = artifact[key]
    details = artifact.get("details", artifact.get("evidenceDetails"))
    if isinstance(details, list):
        summary["details"] = details
        summary["evidenceDetails"] = details
    issue_breakdown = artifact.get("issue_breakdown", artifact.get("issueBreakdown"))
    if isinstance(issue_breakdown, list):
        summary["issue_breakdown"] = issue_breakdown
        summary["issueBreakdown"] = issue_breakdown
    review_commands = artifact.get("recommended_review_commands", artifact.get("recommendedReviewCommands"))
    if isinstance(review_commands, list):
        summary["recommended_review_commands"] = review_commands
        summary["recommendedReviewCommands"] = review_commands
    return summary


def reason_from_issue_breakdown(summary: dict[str, Any]) -> str | None:
    issues = summary.get("issue_breakdown", summary.get("issueBreakdown"))
    if not isinstance(issues, list):
        return None
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        reason = issue.get("summary")
        if isinstance(reason, str) and reason:
            return reason
    return None


def enrich_result_with_run_artifacts(
    result: dict[str, Any],
    run: Any,
) -> dict[str, Any]:
    artifacts: list[dict[str, Any]] = []
    for reference in run.collect_existing_artifacts().values():
        path = run.store.resolve(reference)
        if path.suffix.lower() != ".json":
            continue
        artifact = load_json_artifact(path)
        if artifact is None:
            continue
        artifacts.append(
            evidence_summary_from_artifact(reference.to_dict(), artifact)
        )
    if not artifacts:
        return result
    enriched = dict(result)
    enriched["evidenceArtifacts"] = artifacts
    primary = next(
        (
            artifact
            for artifact in artifacts
            if artifact.get("artifactKind")
            == "acceptance-gate-evidence-report"
            and artifact.get("gateId") == result.get("id")
        ),
        None,
    )
    if primary is None and result.get("tier") == "env-evidence":
        enriched.setdefault(
            "reason",
            str(
                result.get("blockedReason")
                or "Gate exited without a canonical acceptance evidence report"
            ),
        )
        return enriched
    if primary is None:
        primary = next(
            (
                artifact
                for artifact in artifacts
                if any(
                    key in artifact
                    for key in (
                        "artifactKind",
                        "status",
                        "completionStatus",
                        "proofStatus",
                    )
                )
            ),
            artifacts[0],
        )
    traceability_artifact = next(
        (
            artifact
            for artifact in artifacts
            if all(key in artifact for key in ("phase", "bom", "spec", "gate"))
        ),
        primary,
    )
    enriched["sourceArtifact"] = primary.get("path")
    for source_key, target_key in (
        ("artifactKind", "sourceArtifactKind"),
        ("status", "evidenceStatus"),
        ("completionStatus", "completionStatus"),
        ("proofStatus", "proofStatus"),
        ("gateId", "evidenceGateId"),
        ("phase", "phase"),
        ("bom", "bom"),
        ("spec", "spec"),
        ("gate", "gate"),
        ("reason", "reason"),
        ("failedStep", "failedStep"),
        ("sampleEmissionAllowed", "sampleEmissionAllowed"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for source_key, target_key in (
        ("phase", "sourcePhase"),
        ("bom", "sourceBom"),
        ("spec", "sourceSpec"),
        ("gate", "sourceGate"),
    ):
        if source_key in traceability_artifact:
            enriched[target_key] = traceability_artifact[source_key]
    for key in (
        "details",
        "evidenceDetails",
        "issue_breakdown",
        "issueBreakdown",
        "recommended_review_commands",
        "recommendedReviewCommands",
    ):
        if key in primary:
            enriched[key] = primary[key]
    if not enriched.get("reason"):
        issue_reason = reason_from_issue_breakdown(primary)
        if issue_reason:
            enriched["reason"] = issue_reason
    return enriched


def dedupe_review_commands(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    seen: set[str] = set()
    for result in results:
        source_commands = result.get("recommended_review_commands", result.get("recommendedReviewCommands"))
        if not isinstance(source_commands, list):
            continue
        for command in source_commands:
            if not isinstance(command, dict):
                continue
            purpose = command.get("purpose")
            command_text = command.get("command")
            if not isinstance(purpose, str) or not isinstance(command_text, str):
                continue
            key = command_text
            if key in seen:
                continue
            seen.add(key)
            commands.append({"purpose": purpose, "command": command_text})
    return commands


def result_is_incomplete(result: dict[str, Any]) -> bool:
    if result.get("status") not in {"passed", "dry-run"}:
        return True
    if result.get("completionStatus") == "PARTIAL":
        return True
    return result.get("proofStatus") == "UNPROVEN"


def result_traceability(result: dict[str, Any]) -> dict[str, Any]:
    required_fields = list(RESULT_TRACEABILITY_FIELDS)
    if result.get("cleanupStatus") in {"passed", "failed"}:
        required_fields.append("cleanupArtifact")
    missing = [key for key in required_fields if key not in result]
    requires_traceability = (
        result_is_incomplete(result)
        or result.get("tier") == "env-evidence"
    )
    if not missing:
        status = "complete"
        reason = (
            "result preserves source artifact Phase/BOM/Spec/Gate "
            "traceability"
        )
        if "cleanupArtifact" in required_fields:
            reason += " and immutable provisioner cleanup evidence"
    elif requires_traceability:
        status = "missing"
        reason = (
            "environment or incomplete acceptance result is missing source "
            "artifact Phase/BOM/Spec/Gate traceability"
        )
    else:
        status = "not-required"
        reason = "passed static/local gate does not emit a source evidence artifact"
    trace: dict[str, Any] = {
        "status": status,
        "missingFields": missing,
        "reason": reason,
    }
    for key in required_fields:
        if key in result:
            trace[key] = result[key]
    return trace


def standardize_result(
    result: dict[str, Any],
    plan_path: Any,
    *,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    standardized = dict(result)
    gate_id = str(standardized.get("id") or "unknown")
    status = str(standardized.get("status") or "")
    standardized.setdefault("artifactKind", RESULT_ARTIFACT_KIND)
    standardized.setdefault(
        "artifactPath",
        standardized.get("log")
        or standardized.get("sourceArtifact")
        or {"plan": plan_path, "resultGateId": gate_id},
    )
    standardized.setdefault("sampleEmissionAllowed", False)
    environment_proof = standardized.get("tier") == "env-evidence"
    evidence_status = str(standardized.get("evidenceStatus") or "").lower()
    runtime_manifest = standardized.get("manifest")
    traceability = result_traceability(standardized)
    environment_evidence_valid = (
        not environment_proof
        or (
            bool(standardized.get("sourceArtifact"))
            and standardized.get("sourceArtifactKind")
            == "acceptance-gate-evidence-report"
            and standardized.get("evidenceGateId") == gate_id
            and evidence_status in {"pass", "passed"}
            and isinstance(runtime_manifest, dict)
            and runtime_manifest.get("state") == "FIXTURE_READY"
            and bool(runtime_manifest.get("runId"))
            and traceability.get("status") == "complete"
        )
    )
    if status == "passed" and environment_evidence_valid:
        standardized.setdefault("completionStatus", "DONE")
        standardized.setdefault("proofStatus", "PROVEN")
    elif status not in {"dry-run", "blocked"}:
        if status == "passed" and environment_proof:
            standardized["completionStatus"] = "PARTIAL"
            standardized["proofStatus"] = "UNPROVEN"
            standardized.setdefault(
                "reason",
                "environment Gate passed without complete typed runtime evidence",
            )
        else:
            standardized["completionStatus"] = "PARTIAL"
            standardized["proofStatus"] = "UNPROVEN"
    if candidate_mode:
        declared_proof = standardized.get("proofStatus")
        if status == "passed" and declared_proof != "UNPROVEN":
            standardized["proofStatus"] = "CANDIDATE"
        elif declared_proof == "PROVEN":
            standardized["proofStatus"] = "UNPROVEN"
    standardized["traceability"] = traceability
    return standardized


def finalize_gate_result(
    result: dict[str, Any],
    gate_run: Any,
    plan_path: Any,
    runtime: dict[str, Any] | None = None,
    runtime_cell: str | None = None,
    secret_values: tuple[str, ...] = (),
    candidate_mode: bool = False,
) -> dict[str, Any]:
    from tooling.acceptance.core import canonical_secret_scan

    redacted_result, result_leaked = redact_runtime_value(
        result,
        secret_values,
    )
    redacted_runtime, runtime_leaked = redact_runtime_value(
        runtime or {},
        secret_values,
    )
    if runtime_cell:
        redacted_result["runtimeCell"] = runtime_cell
    leaked_fields = [
        field
        for field, leaked in (
            ("run-result", result_leaked),
            ("runtime-manifest", runtime_leaked),
        )
        if leaked
    ]
    secret_scan = result.get("secretScan")
    if secret_scan is None:
        canonical_scan = {
            "status": "passed",
            "scannedHighEntropyValues": 0,
            "scannedCredentialValues": 0,
            "redactedArtifacts": [],
        }
    else:
        canonical_scan = canonical_secret_scan(
            secret_scan,
            secret_values,
        )
    existing_scan_failed = canonical_scan["status"] != "passed"
    existing_scanned_high_entropy = canonical_scan[
        "scannedHighEntropyValues"
    ]
    existing_scanned_credentials = canonical_scan[
        "scannedCredentialValues"
    ]
    redacted_artifacts = list(canonical_scan["redactedArtifacts"])
    redacted_result["secretScan"] = {
        "status": (
            "failed"
            if existing_scan_failed or leaked_fields
            else "passed"
        ),
        "scannedHighEntropyValues": max(
            existing_scanned_high_entropy,
            len(tuple(value for value in secret_values if len(value) >= 16)),
        ),
        "scannedCredentialValues": max(
            existing_scanned_credentials,
            len(tuple(value for value in secret_values if value)),
        ),
        "redactedArtifacts": sorted(
            set(redacted_artifacts + leaked_fields)
        ),
    }
    if existing_scan_failed or leaked_fields:
        redacted_result["status"] = "failed"
        redacted_result["completionStatus"] = "PARTIAL"
        redacted_result["proofStatus"] = "UNPROVEN"
        redacted_result.setdefault(
            "reason",
            (
                "resolved credentials reached final Gate metadata"
                if leaked_fields
                else "resolved credentials reached a Gate artifact"
            ),
        )

    standardized = standardize_result(
        redacted_result,
        plan_path,
        candidate_mode=candidate_mode,
    )
    gate_run.finalize(result=standardized, runtime=redacted_runtime)
    gate_run.publish_latest(runtime_cell=runtime_cell)
    return standardized


def run_issue_breakdown(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for result in results:
        if not result_is_incomplete(result):
            continue
        gate_id = str(result.get("id") or "unknown")
        source_artifact = result.get("sourceArtifact")
        source_artifact_kind = result.get("sourceArtifactKind")
        source_details = result.get("details", result.get("evidenceDetails"))
        source_trace = {
            key: result[key]
            for key in ("sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
            if key in result
        }
        source_issues = result.get("issue_breakdown", result.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if not isinstance(issue, dict):
                    continue
                run_issue = {
                    "category": str(issue.get("category") or f"acceptance-gate:{gate_id}"),
                    "failedStep": str(issue.get("failedStep") or gate_id),
                    "status": str(issue.get("status") or result.get("evidenceStatus") or "diagnostic incomplete"),
                    "completionStatus": str(issue.get("completionStatus") or result.get("completionStatus") or "PARTIAL"),
                    "proofStatus": str(issue.get("proofStatus") or result.get("proofStatus") or "UNPROVEN"),
                    "sampleEmissionAllowed": issue.get("sampleEmissionAllowed")
                    if isinstance(issue.get("sampleEmissionAllowed"), bool)
                    else result.get("sampleEmissionAllowed") is True,
                    "summary": str(issue.get("summary") or result.get("reason") or "acceptance gate failed"),
                    "proofImpact": str(
                        issue.get("proofImpact")
                        or "Acceptance run remains PARTIAL/UNPROVEN until this gate passes."
                    ),
                    "acceptanceGateId": gate_id,
                }
                if isinstance(source_artifact, (str, dict)):
                    run_issue["sourceArtifact"] = source_artifact
                if isinstance(source_artifact_kind, str):
                    run_issue["sourceArtifactKind"] = source_artifact_kind
                run_issue.update(source_trace)
                if isinstance(source_details, list):
                    run_issue["details"] = source_details
                    run_issue["evidenceDetails"] = source_details
                issues.append(run_issue)
            continue
        run_issue = {
            "category": f"acceptance-gate:{gate_id}",
            "failedStep": gate_id,
            "status": str(result.get("evidenceStatus") or "diagnostic incomplete"),
            "completionStatus": str(result.get("completionStatus") or "PARTIAL"),
            "proofStatus": str(result.get("proofStatus") or "UNPROVEN"),
            "sampleEmissionAllowed": result.get("sampleEmissionAllowed") is True,
            "summary": str(result.get("reason") or "acceptance gate remains incomplete without source diagnostics"),
            "proofImpact": "Acceptance run remains PARTIAL/UNPROVEN until this gate emits proven source evidence.",
            "acceptanceGateId": gate_id,
        }
        if isinstance(source_artifact, (str, dict)):
            run_issue["sourceArtifact"] = source_artifact
        if isinstance(source_artifact_kind, str):
            run_issue["sourceArtifactKind"] = source_artifact_kind
        run_issue.update(source_trace)
        if isinstance(source_details, list):
            run_issue["details"] = source_details
            run_issue["evidenceDetails"] = source_details
        issues.append(run_issue)
    return issues


def unique_ordered(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    seen: set[str] = set()
    for value in values:
        key = json.dumps(value, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def aggregate_source_values(results: list[dict[str, Any]], key: str) -> list[Any]:
    values: list[Any] = []
    for result in results:
        value = result.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            values.extend(value)
        else:
            values.append(value)
    return unique_ordered(values)


def missing_result_traceability_count(results: list[dict[str, Any]]) -> int:
    return sum(
        1
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    )


def result_traceability_state(
    results: list[dict[str, Any]],
    *,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    missing = [
        {
            "acceptanceGateId": result.get("id"),
            "artifactKind": result.get("artifactKind"),
            "artifactPath": result.get("artifactPath"),
            **result.get("traceability", {}),
        }
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    ]
    status = (
        "pass"
        if results and not missing
        else "diagnostic incomplete"
    )
    return {
        "artifactKind": "acceptance-run-result-traceability-state",
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": (
            "CANDIDATE" if candidate_mode else "PROVEN"
        )
        if status == "pass"
        else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "missingTraceabilityCount": len(missing),
        "missingTraceability": missing,
    }


def build_run_report(
    plan_path: Any,
    results: list[dict[str, Any]],
    *,
    source: Mapping[str, str] | None = None,
    candidate_mode: bool = False,
) -> dict[str, Any]:
    results = [
        standardize_result(
            result,
            plan_path,
            candidate_mode=candidate_mode,
        )
        for result in results
    ]
    blocked = [result for result in results if result.get("status") == "blocked"]
    failed = [result for result in results if result.get("status") not in {"passed", "dry-run", "blocked"}]
    dry_run = [result for result in results if result.get("status") == "dry-run"]
    partial = [result for result in results if result.get("completionStatus") == "PARTIAL"]
    unproven = [result for result in results if result.get("proofStatus") == "UNPROVEN"]
    incomplete = [result for result in results if result_is_incomplete(result)]
    passed_but_unproven = [
        result for result in results if result.get("status") == "passed" and result.get("proofStatus") == "UNPROVEN"
    ]
    missing_traceability = missing_result_traceability_count(results)
    sample_emission_allowed = (
        bool(results)
        and not failed
        and not blocked
        and not dry_run
        and not partial
        and not unproven
        and not incomplete
        and missing_traceability == 0
    )
    report_complete = bool(results) and not incomplete and not dry_run
    report: dict[str, Any] = {
        "artifactKind": RUN_ARTIFACT_KIND,
        "plan": plan_path,
        "sourceArtifact": plan_path,
        "summary": {
            "total": len(results),
            "passed": len([result for result in results if result.get("status") == "passed"]),
            "failed": len(failed),
            "blocked": len(blocked),
            "dryRun": len(dry_run),
            "partial": len(partial),
            "unproven": len(unproven),
            "incomplete": len(incomplete),
            "passedButUnproven": len(passed_but_unproven),
            "missingResultTraceability": missing_traceability,
            "sampleEmissionAllowed": sample_emission_allowed,
        },
        "completionStatus": (
            "BLOCKED"
            if blocked
            else ("DONE" if report_complete else "PARTIAL")
        ),
        "proofStatus": (
            ("CANDIDATE" if candidate_mode else "PROVEN")
            if report_complete
            and not failed
            and not blocked
            and not unproven
            else "UNPROVEN"
        ),
        "sampleEmissionAllowed": sample_emission_allowed,
        "resultTraceabilityState": result_traceability_state(
            results,
            candidate_mode=candidate_mode,
        ),
        "results": results,
    }
    if source is not None:
        report["source"] = dict(source)
    source_phases = aggregate_source_values(results, "sourcePhase")
    source_bom = aggregate_source_values(results, "sourceBom")
    source_spec = aggregate_source_values(results, "sourceSpec")
    source_gates = aggregate_source_values(results, "sourceGate")
    if source_phases:
        report["sourcePhases"] = source_phases
    if source_bom:
        report["sourceBom"] = source_bom
    if source_spec:
        report["sourceSpec"] = source_spec
    if source_gates:
        report["sourceGates"] = source_gates
    if incomplete:
        issue_breakdown = run_issue_breakdown(results)
        review_commands = dedupe_review_commands(results)
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
        if review_commands:
            report["recommended_review_commands"] = review_commands
            report["recommendedReviewCommands"] = review_commands
    return report


def render_markdown(report: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Acceptance Run",
            "",
            f"- Completion: `{report.get('completionStatus', 'UNKNOWN')}`",
            f"- Proof: `{report.get('proofStatus', 'UNKNOWN')}`",
            f"- Sample emission allowed: `{report.get('sampleEmissionAllowed', False)}`",
            "- Summary: "
            + json.dumps(report.get("summary", {}), ensure_ascii=False, sort_keys=True),
            "",
            "## Results",
            "",
            "| Gate | Status | Completion | Proof | Source kind |",
            "| --- | --- | --- | --- | --- |",
            *[
                "| {id} | {status} | {completion} | {proof} | {source_kind} |".format(
                    id=result.get("id", ""),
                    status=result.get("status", ""),
                    completion=result.get("completionStatus", ""),
                    proof=result.get("proofStatus", ""),
                    source_kind=result.get("sourceArtifactKind", ""),
                )
                for result in report.get("results", [])
                if isinstance(result, dict)
            ],
            "",
        ]
    )


def write_run_report(output: Path, report: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")


def acceptance_exit_code(
    report: dict[str, Any],
    *,
    candidate_mode: bool = False,
) -> int:
    if report.get("completionStatus") == "BLOCKED":
        return 2
    if report.get("completionStatus") != "DONE":
        return 1
    expected_proof = "CANDIDATE" if candidate_mode else "PROVEN"
    if report.get("proofStatus") != expected_proof:
        return 1
    if not candidate_mode and report.get("sampleEmissionAllowed") is not True:
        return 1
    return 0


def main() -> int:
    from tooling.acceptance.core import (
        EvidenceConflict,
        EvidenceError,
        EvidenceStore,
        source_identity,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--gate", action="append", default=[])
    parser.add_argument("--tier", action="append", default=[])
    parser.add_argument("--runtime-cell")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        plan, plan_source = load_plan(
            Path(args.plan) if args.plan else None,
            store,
        )
        aggregate_source = source_identity(REPO_ROOT)
        aggregate_run = store.begin_run(
            "acceptance-run",
            source=aggregate_source,
        )
    except EvidenceError as error:
        print(
            f"Acceptance evidence initialization failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1

    definitions = load_gate_definitions(Path(args.gates))
    gates = resolve_requested_gates(plan, definitions, args.gate)
    gates = filter_gates_by_tier(gates, args.tier)

    results: list[dict[str, Any]] = []
    print("Acceptance Run")
    print("==============")
    if args.tier:
        print(f"tiers: {', '.join(args.tier)}")
    if not gates:
        print("[SKIP] no selected gates")

    active_gate_run = None
    try:
        for gate in gates:
            gate_id = gate["id"]
            command = gate_launch_display(gate)
            timeout = int(gate.get("timeout_seconds") or 600)
            environment = gate.get("environment", "local")
            tier = gate.get("tier", "local-evidence")
            runtime_cell = select_runtime_cell(
                gate,
                str(args.runtime_cell or ""),
            )
            print(f"[RUN] {gate_id} [{tier}/{environment}]: {command}")
            started = time.time()

            if args.dry_run:
                results.append(
                    {
                        "id": gate_id,
                        "command": command,
                        "environment": environment,
                        "runtimeCell": runtime_cell or None,
                        "tier": tier,
                        "status": "dry-run",
                        "duration_seconds": 0,
                    }
                )
                continue

            gate_source = source_identity(REPO_ROOT)
            source_drift = source_identity_drift(
                aggregate_source,
                gate_source,
            )
            gate_run = store.begin_run(gate_id, source=gate_source)
            active_gate_run = gate_run
            gate_env = gate_run.subprocess_environment(os.environ.copy())
            gate_env[AGGREGATE_SOURCE_ENV] = json.dumps(
                aggregate_source,
                sort_keys=True,
            )
            if runtime_cell:
                gate_env["PT_ACCEPTANCE_RUNTIME_CELL"] = runtime_cell
            provisioner = None
            manifest = None
            manifest_path = None
            runtime_cell_lifecycle = None
            runtime_cell_manifest = None
            runtime_cell_manifest_path = None
            runtime_secrets: tuple[str, ...] = ()
            output_text = ""
            exit_code: int | None = None
            timed_out = False
            cleanup_status = "not-required"
            cleanup_completed_resources: tuple[str, ...] = ()
            cleanup_error = ""
            environment_cleanup_status = "not-required"
            environment_cleanup_error = ""
            runtime_cell_cleanup_status = "not-required"
            runtime_cell_cleanup: dict[str, Any] | None = None
            runtime_cell_cleanup_error = ""
            launch_context = None
            launch_binding = None
            launch_context_quiesce_status = "not-required"
            launch_context_close_status = "not-required"
            launch_context_cleanup: dict[str, Any] | None = None
            launch_context_cleanup_error = ""
            gate_process_cleanup_status = "not-required"
            gate_process_cleanup_error = ""
            resource_cleanup_allowed = True
            cleanup_artifact: dict[str, Any] | None = None
            result: dict[str, Any] | None = None
            provisioner_id = str(gate.get("provisioner") or "")
            if source_drift is not None:
                output_text = (
                    "Acceptance source drifted before Gate execution; "
                    "the Gate was not started.\n"
                )
                result = {
                    "id": gate_id,
                    "command": command,
                    "environment": environment,
                    "runtimeCell": runtime_cell or None,
                    "tier": tier,
                    "status": "failed",
                    "exit_code": None,
                    "duration_seconds": 0,
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False,
                    "reason": "aggregate source drift before Gate execution",
                    "sourceDrift": source_drift,
                }
            try:
                if result is None and provisioner_id:
                    if provisioner_id != environment:
                        raise SystemExit(
                            f"gate {gate_id!r} provisioner {provisioner_id!r} "
                            f"does not match environment {environment!r}"
                        )
                    print(f"[PROVISION] {provisioner_id}")
                    try:
                        preparation_error: Exception | None = None
                        with run_environment(gate_env):
                            provisioner = environment_provisioner(provisioner_id)
                            provisioner.bind_evidence_run(gate_run)
                            try:
                                provisioner.prepare_credentials()
                            except Exception as error:
                                preparation_error = error
                        runtime_secrets = credential_values(provisioner)
                        gate_run.configure_redaction(runtime_secrets)
                        gate_env = gate_run.subprocess_environment(gate_env)
                        if preparation_error is not None:
                            raise preparation_error
                        with run_environment(gate_env):
                            provisioner, manifest, manifest_path = provision_environment(
                                provisioner_id,
                                gate_id,
                                provisioner,
                            )
                    except EvidenceError:
                        raise
                    except Exception as error:
                        output_text = f"Provisioning failed: {type(error).__name__}: {error}\n"
                        result = provisioning_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            error=error,
                            duration_seconds=round(time.time() - started, 3),
                        )
                    if result is None and manifest and manifest.get("state") == "BLOCKED":
                        reason = manifest.get("blockedReason", "unknown")
                        resource = manifest.get("blockedResource", "")
                        output_text = f"BLOCKED: {reason} resource={resource}\n"
                        result = {
                            "id": gate_id,
                            "command": command,
                            "environment": environment,
                            "tier": tier,
                            "status": "blocked",
                            "exit_code": None,
                            "duration_seconds": round(time.time() - started, 3),
                            "blockedReason": reason,
                            "blockedResource": resource,
                            "manifest": manifest,
                            "completionStatus": "BLOCKED",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifact": manifest.get("_manifest_ref", {}),
                            "sourceArtifactKind": "acceptance-runtime-manifest",
                            "sourcePhase": "Runtime Provisioning",
                            "sourceBom": ["WS2", "WS6"],
                            "sourceSpec": ["D-07", "D-08"],
                            "sourceGate": (
                                "Environment must reach FIXTURE_READY before "
                                "product Gate execution"
                            ),
                        }
                    if result is None and manifest:
                        print(
                            f"[PROVISIONED] {environment} "
                            f"state={manifest.get('state')}"
                        )

                if result is None and runtime_cell:
                    print(f"[CELL PROVISION] {runtime_cell}")
                    try:
                        with run_environment(gate_env):
                            (
                                runtime_cell_lifecycle,
                                runtime_cell_manifest,
                                runtime_cell_manifest_path,
                            ) = provision_runtime_cell(
                                cell_id=runtime_cell,
                                gate_id=gate_id,
                                gate_run=gate_run,
                            )
                    except EvidenceError:
                        raise
                    except Exception as error:
                        output_text = (
                            "Runtime-cell provisioning failed: "
                            f"{type(error).__name__}: {error}\n"
                        )
                        result = runtime_cell_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            runtime_cell=runtime_cell,
                            error=error,
                            duration_seconds=round(time.time() - started, 3),
                        )
                    if result is None and runtime_cell_manifest:
                        print(
                            f"[CELL PROVISIONED] {runtime_cell} "
                            f"state={runtime_cell_manifest.get('state')}"
                        )

                if result is None and gate.get("ephemeralCapabilities"):
                    try:
                        (
                            launch_context,
                            provisioning_run_id,
                        ) = prepare_gate_launch_context(
                            gate=gate,
                            gate_run=gate_run,
                            provisioner=provisioner,
                            manifest=manifest,
                        )
                        launch_context.seal(
                            workspace_id=gate_run.store.workspace_id,
                            gate_id=gate_id,
                            evidence_run_id=gate_run.run_id,
                            provisioning_run_id=provisioning_run_id,
                        )
                        launch_binding = launch_context.bind_child()
                        launch_context.activate()
                    except Exception as error:
                        output_text = (
                            "Ephemeral launch preparation failed: "
                            f"{type(error).__name__}: {error}\n"
                        )
                        result = ephemeral_launch_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            error=error,
                            duration_seconds=round(time.time() - started, 3),
                        )

                if result is None:
                    if gate.get("ephemeralCapabilities"):
                        gate_env = context_gate_subprocess_environment(
                            gate_run,
                            os.environ,
                        )
                    else:
                        gate_env = gate_run.subprocess_environment(
                            os.environ.copy()
                        )
                    gate_env[AGGREGATE_SOURCE_ENV] = json.dumps(
                        aggregate_source,
                        sort_keys=True,
                    )
                    gate_env["PT_ACCEPTANCE_CURRENT_RESULTS"] = json.dumps(
                        {
                            "source": aggregate_run.source,
                            "results": results,
                        },
                        ensure_ascii=False,
                    )
                    if manifest_path is not None:
                        gate_env["PT_ACCEPTANCE_RUNTIME_MANIFEST"] = str(
                            manifest_path
                        )
                    if runtime_cell:
                        gate_env["PT_ACCEPTANCE_RUNTIME_CELL"] = runtime_cell
                    if runtime_cell_manifest_path is not None:
                        gate_env["PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST"] = str(
                            runtime_cell_manifest_path
                        )
                    try:
                        if "argv" in gate:
                            from tooling.acceptance.core import (
                                GateLaunchSpec,
                                GateProcessLauncher,
                            )

                            completed = GateProcessLauncher(
                                cwd=str(REPO_ROOT),
                                environment=gate_env,
                            ).run(
                                GateLaunchSpec(
                                    argv=tuple(gate["argv"]),
                                    timeout_seconds=timeout,
                                    required_capabilities=tuple(
                                        gate.get("ephemeralCapabilities", ())
                                    ),
                                ),
                                launch_binding,
                            )
                            gate_process_cleanup_status = "passed"
                        else:
                            completed = subprocess.run(
                                command,
                                shell=True,
                                text=True,
                                capture_output=True,
                                timeout=timeout,
                                env=gate_env,
                                cwd=REPO_ROOT,
                            )
                        output_text = completed.stdout + completed.stderr
                        exit_code = completed.returncode
                    except subprocess.TimeoutExpired as error:
                        timed_out = True
                        stdout = error.stdout or ""
                        stderr = error.stderr or ""
                        output_text = (
                            stdout.decode() if isinstance(stdout, bytes) else stdout
                        ) + (
                            stderr.decode() if isinstance(stderr, bytes) else stderr
                        )
                        output_text += f"\nGate timed out after {timeout} seconds\n"
                    except Exception as error:
                        from tooling.acceptance.core import (
                            EphemeralLaunchCleanupFailed,
                            EphemeralLaunchError,
                            EphemeralLaunchTimeout,
                        )

                        if not isinstance(error, EphemeralLaunchError):
                            raise
                        timed_out = isinstance(error, EphemeralLaunchTimeout)
                        if isinstance(error, EphemeralLaunchCleanupFailed):
                            gate_process_cleanup_status = "failed"
                            gate_process_cleanup_error = str(error)
                        elif timed_out:
                            gate_process_cleanup_status = "passed"
                        output_text = (
                            f"Ephemeral Gate launch failed: "
                            f"{type(error).__name__}: {error}\n"
                        )
                        result = ephemeral_launch_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            error=error,
                            duration_seconds=round(time.time() - started, 3),
                        )
            finally:
                if launch_context is not None:
                    try:
                        launch_context.quiesce()
                        launch_context_quiesce_status = "passed"
                    except Exception as error:
                        launch_context_quiesce_status = "failed"
                        launch_context_cleanup_error = str(error)
                        launch_context_cleanup = ephemeral_cleanup_payload(
                            getattr(error, "result", None)
                        )
                        resource_cleanup_allowed = bool(
                            launch_context_cleanup
                            and launch_context_cleanup.get(
                                "quarantinedCapabilities"
                            )
                        )
                        output_text += (
                            "\nLaunch-context quiesce failed: "
                            f"{error}\n"
                        )
                if (
                    runtime_cell_lifecycle is not None
                    and resource_cleanup_allowed
                ):
                    try:
                        with run_environment(gate_env):
                            runtime_cell_cleanup = (
                                runtime_cell_lifecycle.stop()
                            )
                        runtime_cell_cleanup_status = "passed"
                    except Exception as error:
                        runtime_cell_cleanup_status = "failed"
                        runtime_cell_cleanup_error = str(error)
                        output_text += (
                            "\nRuntime-cell cleanup failed: "
                            f"{error}\n"
                        )
                elif runtime_cell_lifecycle is not None:
                    runtime_cell_cleanup_status = (
                        "deferred-unfenced-authority"
                    )
                    runtime_cell_cleanup_error = (
                        "runtime-cell cleanup deferred because launch-context "
                        "authority was not fenced"
                    )
                if provisioner is not None and resource_cleanup_allowed:
                    try:
                        with run_environment(gate_run.subprocess_environment(os.environ.copy())):
                            cleanup_completed_resources = provisioner.cleanup()
                        environment_cleanup_status = "passed"
                    except Exception as error:
                        environment_cleanup_status = "failed"
                        environment_cleanup_error = str(error)
                        output_text += f"\nProvisioning cleanup failed: {error}\n"
                elif provisioner is not None:
                    environment_cleanup_status = (
                        "deferred-unfenced-authority"
                    )
                    environment_cleanup_error = (
                        "Provisioner cleanup deferred because launch-context "
                        "authority was not fenced"
                    )
                if (
                    launch_context is not None
                    and (
                        launch_context_quiesce_status == "passed"
                        or resource_cleanup_allowed
                    )
                ):
                    channel_error = launch_context.channel_error
                    blocked_error = launch_context.blocked_error
                    try:
                        close_result = launch_context.close()
                        launch_context_cleanup = ephemeral_cleanup_payload(
                            close_result
                        )
                        launch_context_close_status = "passed"
                    except Exception as error:
                        launch_context_close_status = "failed"
                        launch_context_cleanup = ephemeral_cleanup_payload(
                            getattr(error, "result", None)
                        )
                        if launch_context_cleanup_error:
                            launch_context_cleanup_error += f"; {error}"
                        else:
                            launch_context_cleanup_error = str(error)
                        output_text += (
                            "\nLaunch-context close failed: "
                            f"{error}\n"
                        )
                    terminal_error = channel_error or blocked_error
                    if terminal_error is not None:
                        result = ephemeral_launch_failure_result(
                            gate_id=gate_id,
                            command=command,
                            environment=environment,
                            tier=tier,
                            error=terminal_error,
                            duration_seconds=round(time.time() - started, 3),
                        )
                        terminal_errors = tuple(
                            candidate
                            for candidate in (channel_error, blocked_error)
                            if candidate is not None
                        )
                        result["launchContextTerminalErrors"] = [
                            {
                                "code": error.code,
                                "type": type(error).__name__,
                            }
                            for error in terminal_errors
                        ]
                cleanup_failures = tuple(
                    error
                    for error in (
                        gate_process_cleanup_error,
                        launch_context_cleanup_error,
                        runtime_cell_cleanup_error,
                        environment_cleanup_error,
                    )
                    if error
                )
                if cleanup_failures:
                    cleanup_status = "failed"
                    cleanup_error = "; ".join(cleanup_failures)
                elif (
                    gate_process_cleanup_status == "passed"
                    or launch_context_close_status == "passed"
                    or launch_context_quiesce_status == "passed"
                    or runtime_cell_cleanup_status == "passed"
                    or environment_cleanup_status == "passed"
                ):
                    cleanup_status = "passed"

            if (
                provisioner is not None
                or runtime_cell_lifecycle is not None
                or launch_context is not None
                or gate_process_cleanup_status != "not-required"
            ):
                cleanup_artifact = persist_provisioner_cleanup_result(
                    gate_run=gate_run,
                    gate_id=gate_id,
                    environment=environment,
                    provisioner_id=provisioner_id,
                    cleanup_status=cleanup_status,
                    completed_resources=cleanup_completed_resources,
                    cleanup_error=cleanup_error,
                    secret_values=runtime_secrets,
                    environment_cleanup_status=environment_cleanup_status,
                    environment_cleanup_error=environment_cleanup_error,
                    runtime_cell=runtime_cell,
                    runtime_cell_cleanup_status=runtime_cell_cleanup_status,
                    runtime_cell_cleanup=runtime_cell_cleanup,
                    runtime_cell_cleanup_error=runtime_cell_cleanup_error,
                    launch_context_quiesce_status=(
                        launch_context_quiesce_status
                    ),
                    launch_context_close_status=launch_context_close_status,
                    launch_context_cleanup=launch_context_cleanup,
                    launch_context_cleanup_error=launch_context_cleanup_error,
                    gate_process_cleanup_status=gate_process_cleanup_status,
                    gate_process_cleanup_error=gate_process_cleanup_error,
                )

            source_drift_after = source_identity_drift(
                aggregate_source,
                source_identity(REPO_ROOT),
            )
            if source_drift_after is not None:
                source_drift = source_drift or source_drift_after
                output_text += (
                    "\nAcceptance source drifted during aggregate execution; "
                    "the Gate cannot contribute exact-source proof.\n"
                )

            (
                log_ref,
                redacted_artifacts,
                leaked_artifacts,
            ) = finalize_runtime_log(
                gate_run,
                gate_id,
                output_text,
                runtime_secrets,
            )
            redacted_artifacts = sorted(
                set(redacted_artifacts) | set(gate_run.redacted_artifacts)
            )
            duration = round(time.time() - started, 3)
            if result is None:
                status = (
                    "passed"
                    if exit_code == 0 and cleanup_status != "failed"
                    else "failed"
                )
                result = {
                    "id": gate_id,
                    "command": command,
                    "environment": environment,
                    "runtimeCell": runtime_cell or None,
                    "tier": tier,
                    "status": status,
                    "exit_code": exit_code,
                    "duration_seconds": duration,
                    "log": log_ref.to_dict(),
                    "timedOut": timed_out,
                    "cleanupStatus": cleanup_status,
                    "secretScan": {
                        "status": "passed",
                        "scannedHighEntropyValues": len(
                            tuple(
                                value
                                for value in runtime_secrets
                                if len(value) >= 16
                            )
                        ),
                        "scannedCredentialValues": len(
                            tuple(
                                value
                                for value in runtime_secrets
                                if value
                            )
                        ),
                        "redactedArtifacts": redacted_artifacts,
                    },
                }
                if manifest:
                    result["manifest"] = manifest
                if runtime_cell_manifest:
                    result["runtimeCellManifest"] = runtime_cell_manifest
                if redacted_artifacts:
                    result["redactedArtifacts"] = redacted_artifacts
            else:
                result["log"] = log_ref.to_dict()
                result["cleanupStatus"] = cleanup_status
                if runtime_cell_manifest:
                    result["runtimeCellManifest"] = runtime_cell_manifest
            if cleanup_artifact is not None:
                result["cleanupArtifact"] = cleanup_artifact
            if cleanup_error:
                result["cleanupError"] = cleanup_error
                result["status"] = "failed"
                result["completionStatus"] = "PARTIAL"
                result["proofStatus"] = "UNPROVEN"
                if gate_process_cleanup_error:
                    result["errorType"] = "EphemeralLaunchCleanupFailed"
                    result["sourcePhase"] = "Gate Process Cleanup"
                elif launch_context_cleanup_error:
                    result["errorType"] = "EphemeralLaunchCleanupFailed"
                    result["sourcePhase"] = "Ephemeral Gate Launch Cleanup"
                    result["launchContextCleanup"] = launch_context_cleanup

            if source_drift is not None:
                result["sourceDrift"] = source_drift
                result["status"] = "failed"
                result["completionStatus"] = "PARTIAL"
                result["proofStatus"] = "UNPROVEN"
                result["sampleEmissionAllowed"] = False

            result = enrich_result_with_run_artifacts(result, gate_run)
            finalized_runtime = dict(manifest or {})
            if runtime_cell_manifest:
                finalized_runtime["runtimeCellManifest"] = (
                    runtime_cell_manifest
                )
            result = finalize_gate_result(
                result,
                gate_run,
                plan_source,
                finalized_runtime,
                runtime_cell or None,
                runtime_secrets,
            )
            result["runManifest"] = gate_run.manifest_ref.to_dict()
            gate_run.close()
            active_gate_run = None
            results.append(result)
            print(
                f"[{str(result.get('status')).upper()}] {gate_id} "
                f"duration={duration}s run={gate_run.run_id}"
            )

        report = build_run_report(
            plan_source,
            results,
            source=aggregate_source,
        )
        run_ref = aggregate_run.write_json(
            "reports/run.json",
            report,
            role="run",
        )
        aggregate_run.write_bytes(
            "reports/run.md",
            render_markdown(report).encode("utf-8"),
            media_type="text/markdown",
            role="run-markdown",
        )
        aggregate_run.finalize(
            result={
                "status": (
                    "passed" if acceptance_exit_code(report) == 0 else "failed"
                ),
                "completionStatus": report.get("completionStatus"),
                "proofStatus": report.get("proofStatus"),
            },
            runtime={"plan": plan_source},
        )
        aggregate_run.publish_latest()
        print(f"run: {json.dumps(run_ref.to_dict(), sort_keys=True)}")
        return acceptance_exit_code(report)
    except EvidenceError as error:
        print(
            f"Acceptance evidence failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1
    finally:
        if active_gate_run is not None:
            active_gate_run.close()
        aggregate_run.close()


if __name__ == "__main__":
    raise SystemExit(main())
