#!/usr/bin/env python3
"""Run acceptance gates from the current plan or explicit gate ids."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

RUN_ARTIFACT_KIND = "acceptance-run"
RESULT_ARTIFACT_KIND = "acceptance-gate-result"
AGENT_V2_SCHEMA_ROOT = REPO_ROOT / "tooling/acceptance/schemas/agent-v2"
AGGREGATE_SOURCE_ENV = "PT_ACCEPTANCE_AGGREGATE_SOURCE"
PREREQUISITE_PROOFS_ENV = "PT_ACCEPTANCE_PREREQUISITE_PROOFS"
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
    "PYTHONDONTWRITEBYTECODE",
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
DEVELOPMENT_WORK_ITEM_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


from tooling.acceptance.core.execution_budget import (
    ExecutionBudgetError,
    ExecutionBudgetPolicy,
    ExecutionDeadline,
    GateTimeLimits,
    GateExecution,
    execute_stage,
    freeze_scope,
    stopped_results,
    digest,
)
from tooling.acceptance.core.execution_graph import (
    compile_graph, efficiency_report, prerequisite_results, request_dispatch_order,
)
from tooling.acceptance.core.e2e_preflight import (
    PREFLIGHT_ENV, prepare_e2e, preflight_binding, require_ready,
    revalidate_preflight, validate_e2e_definition,
)
from tooling.acceptance.core.execution_identity import (
    gate_execution_identity as input_execution_identity, inherited_gate_environment,
    InputIdentityCleanupFailed, InputIdentityError, InputIdentityProbeFailed,
    observe_gate_inputs, validate_execution_inputs,
)
from tooling.acceptance.core.execution_session import ExecutionSession
from tooling.acceptance.core.input_artifacts import (
    capture_input_artifacts, original_input_artifacts, validate_input_artifacts,
)
from tooling.acceptance.core.scope_ownership import load_scope_catalog
from tooling.acceptance.core.operation_observer import runner_operation_stream
from tooling.acceptance.core.proof import read_gate_proof, require_report_proof


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def current_result_proof_envelope(
    source: Mapping[str, str],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    proof_fields = (
        "id",
        "artifactKind",
        "status",
        "completionStatus",
        "proofStatus",
        "cleanupStatus",
        "developmentRunId",
        "runManifest",
        "developmentManifest",
    )
    return {
        "source": dict(source),
        "results": [
            {
                field: result[field]
                for field in proof_fields
                if field in result
            }
            for result in results
        ],
    }


def execution_context_digest(args: argparse.Namespace, plan_source: Any) -> str:
    """Global candidate identity; each declared Gate separately binds its inputs."""
    return digest({
        "plan": plan_source,
        "executionPolicy": args.execution_policy,
        "runtimeCell": args.runtime_cell,
        "runtimeCellBindings": args.runtime_cell_binding,
        "stationProfiles": args.station_profile,
        "serviceProfiles": args.service_profile,
        "stopOnFailure": args.stop_on_failure,
    })


def gate_execution_identity(
    gate: Mapping[str, Any], graph: Mapping[str, Any], policy: Any, context: str,
    *, probe_context: Mapping[str, Any] | None = None,
    execution: GateExecution | None = None,
    stage: str = "execution-inputs", phase: str = "work",
    input_artifacts: Mapping[str, Any] | None = None,
    input_artifacts_ref: Any = None, store: Any = None,
) -> dict[str, Any]:
    observation = observe_gate_inputs(
        gate, os.environ, repo_root=REPO_ROOT,
        context={
            **(probe_context or {}), "gate": dict(gate), "contextDigest": context,
            "inputArtifacts": input_artifacts, "observationStage": stage,
        },
        execution=execution, stage=stage, phase=phase,
        artifact_root=store.root if store is not None else None,
    )
    identity = input_execution_identity(
        gate, graph, policy, context, os.environ, observation=observation,
    )
    identity["inputArtifacts"] = (
        input_artifacts_ref.to_dict() if input_artifacts_ref is not None else None
    )
    return identity


def revalidate_session_results(
    gates: list[dict[str, Any]], prior_report: Mapping[str, Any],
    source: Mapping[str, str], graph: Mapping[str, Any], policy: Any,
    context: str, store: Any,
    probe_context: Mapping[str, Any] | None = None,
    execution: GateExecution | None = None,
    current_results: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Read original producer proof and current authority; invalid proof returns to work."""
    from tooling.acceptance.core import ArtifactRef, EvidenceError

    by_id = {item["id"]: item for item in prior_report["results"]}
    reused: list[dict[str, Any]] = []
    validation: list[dict[str, Any]] = []
    verified = list(current_results or [])
    verified_ids = {
        item["id"] for item in verified
        if all(item.get(key) == value for key, value in (
            ("status", "passed"), ("completionStatus", "DONE"), ("proofStatus", "PROVEN"),
        )) and item.get("cleanupStatus") in {"passed", "not-required"}
        and item.get("runManifest")
    }
    for gate in gates:
        gate_id = gate["id"]
        started = time.monotonic()
        original = by_id.get(gate_id, {})
        reason = "original completion is unproven"
        accepted = False
        owner_failure = None
        if "executionInputs" not in gate:
            reason = "current runtime/provider/oracle/action-plan identity is not injected"
        elif not set(graph["dependencies"][gate_id]) <= verified_ids:
            reason = "required producer has no current verified proof"
        elif all(original.get(key) == value for key, value in (
            ("status", "passed"), ("completionStatus", "DONE"), ("proofStatus", "PROVEN"),
        )):
            try:
                ref = ArtifactRef.from_dict(original["runManifest"])
                manifest = read_gate_proof(
                    store, gate_id, source, result=original,
                    gate_definition=gate, require_latest=True,
                    runtime_cell=original.get("runtimeCell"),
                )
                proof_identity = store.read_json(ArtifactRef.from_dict(
                    manifest["artifacts"]["execution-identity"],
                ))
                sealed_result = manifest["result"]
                expected_prerequisites, unproven = prerequisite_results(
                    gate, verified, source, store,
                )
                if (
                    unproven
                    or sealed_result.get("prerequisiteProofs", []) != expected_prerequisites
                ):
                    raise ExecutionBudgetError("original proof or current authority changed")
                inputs_ref, inputs = execute_stage(
                    execution, "original-input-artifacts", original_input_artifacts,
                    gate, manifest, store,
                )
                identity = gate_execution_identity(
                    gate, graph, policy, context, probe_context=probe_context,
                    execution=execution, stage="original-input-validation",
                    input_artifacts=inputs, input_artifacts_ref=inputs_ref, store=store,
                )
                if not identity["reuseEligible"] or proof_identity != identity:
                    raise InputIdentityError("current closed inputs do not match original proof")
                reused.append({
                    **sealed_result,
                    "runManifest": ref.to_dict(),
                    "executionDisposition": "REUSED_ORIGINAL",
                    "originRunId": ref.run_id,
                })
                verified.append(reused[-1])
                verified_ids.add(gate_id)
                accepted, reason = True, "complete current-source original producer verified"
            except InputIdentityProbeFailed as error:
                reason = "original input owner did not complete; actual launch diagnostic retained"
                owner_failure = error.failure
            except (EvidenceError, ExecutionBudgetError, KeyError, TypeError, ValueError, OSError):
                reason = "original inventory, proof, input identity or authority is invalid"
        validation.append({
            "gateId": gate_id, "disposition": "REUSED_ORIGINAL" if accepted else "PENDING",
            "reason": reason, "durationSeconds": round(time.monotonic() - started, 6),
            "originRunId": reused[-1]["originRunId"] if accepted else None,
            **({"inputOwnerFailure": owner_failure} if owner_failure is not None else {}),
        })
    return reused, validation


def read_session_manifest(store: Any, reference: Any) -> tuple[ExecutionSession, dict[str, Any]]:
    """Only same-store DURABLE run inventory supplies a session and its original report."""
    from tooling.acceptance.core import ArtifactRef

    manifest = store.read_run_manifest(reference, manifest_sha256=reference.sha256)
    session_ref = ArtifactRef.from_dict(manifest["artifacts"]["execution-session"])
    session = ExecutionSession.restore(store.read_json(session_ref))
    report_ref = ArtifactRef.from_dict(session.requests[-1]["report"])
    if (
        session_ref.path != "reports/session.json"
        or report_ref.to_dict() != manifest["artifacts"].get("run")
        or (report_ref.workspace_id, report_ref.gate_id, report_ref.run_id)
        != (reference.workspace_id, reference.gate_id, reference.run_id)
    ):
        raise ExecutionBudgetError("execution session and run inventory identity mismatch")
    report = store.read_json(report_ref)
    session.request_results(session.requests[-1], report)
    graph_ref = ArtifactRef.from_dict(report["executionGraph"]["artifact"])
    original_graph = store.read_json(graph_ref)
    from tooling.acceptance.core.execution_graph import ExecutionGraph

    ExecutionGraph(original_graph).validate()
    if original_graph["digest"] != session.graph_digest:
        raise ExecutionBudgetError("original session graph mismatch")
    return session, report


def publish_initialization_stop(
    store: Any, gates: list[dict[str, Any]], source: Mapping[str, str],
    graph: Mapping[str, Any], plan_source: Any, planning: GateExecution,
    policy: ExecutionBudgetPolicy, error: BaseException,
) -> Any:
    """Initialization cancellation owns no product run, but retains the full obligation."""
    from tooling.acceptance.core.execution_budget import deadline

    with deadline(5, ExecutionDeadline("stop-record", "publish", "publish")):
        if isinstance(store, SimpleNamespace):
            from tooling.acceptance.core import EvidenceStore

            store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
        with store.begin_run("acceptance-execution-stop", source=source) as diagnostic:
            stop = {
                "artifactKind": "acceptance-execution-stop",
                "reason": (
                    "OWNER_INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "EXECUTION_BUDGET_STOP"
                ),
                "gateId": planning.report()["gateId"], "cost": planning.report(),
                "source": dict(source), "policyDigest": policy.identity,
                "dispatchedGateIds": [], "unexecutedGateIds": [gate["id"] for gate in gates],
                "resourceCleanup": "not-required",
                "proofStatus": "UNPROVEN", "failure": type(error).__name__,
            }
            stop_ref = diagnostic.write_json("reports/stop.json", stop, role="execution-stop")
            graph_ref = diagnostic.write_json("reports/graph.json", graph, role="execution-graph")
            report = build_run_report(
                plan_source, stopped_results(gates, set(), stop), source=source,
            )
            report["terminalObservation"] = stop_ref.to_dict()
            report["executionGraph"] = {"artifact": graph_ref.to_dict(), "digest": graph["digest"]}
            report["executionBudget"] = {
                "policyDigest": policy.identity, "planning": planning.report(),
                "stop": stop, "gates": [], "selectedGateCount": len(gates), "dispatchedGateCount": 0,
            }
            run_ref = diagnostic.write_json("reports/run.json", report, role="run")
            diagnostic.finalize(result={
                "status": "failed", "completionStatus": "PARTIAL", "proofStatus": "UNPROVEN",
            })
            diagnostic.publish_latest()
            print(f"execution-stop: {json.dumps(stop_ref.to_dict(), sort_keys=True)}")
            print(f"run: {json.dumps(run_ref.to_dict(), sort_keys=True)}")
            return diagnostic.manifest_ref


def development_artifact_root(work_item: str, workspace: str) -> Path:
    if not DEVELOPMENT_WORK_ITEM_PATTERN.fullmatch(work_item):
        raise SystemExit("--work-item must be a valid development work item ID")
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    if override and not Path(override).is_absolute():
        raise SystemExit("PT_MACHINE_DEV_ROOT must be absolute")
    machine_root = (
        Path(override)
        if override
        else Path(os.environ.get("HOME") or Path.home()) / ".peers-touch" / "dev"
    )
    return (
        machine_root
        / "workspaces"
        / workspace
        / "workflow"
        / work_item
        / "artifacts"
    )


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_agent_v2_contract() -> dict[str, Any]:
    return json.loads(
        (AGENT_V2_SCHEMA_ROOT / "contract.json").read_text(encoding="utf-8")
    )


def schema_descriptor(
    contract: dict[str, Any],
    schema_name: str,
) -> dict[str, Any]:
    definition = contract["schemas"][schema_name]
    schema_path = AGENT_V2_SCHEMA_ROOT / definition["file"]
    return {
        "id": definition["id"],
        "version": definition["version"],
        "sha256": sha256_file(schema_path),
    }


def matrix_identity(contract: dict[str, Any]) -> dict[str, Any]:
    matrix = dict(contract["matrix"])
    source_path = REPO_ROOT / matrix.pop("source")
    if not source_path.is_file() or sha256_file(source_path) != matrix["sha256"]:
        raise RuntimeError("reviewed Agent V2 runtime matrix hash mismatch")
    return matrix


def write_explicit_json(path_value: str, value: dict[str, Any]) -> None:
    from tooling.acceptance.core import validate_external_output_path

    path = validate_external_output_path(path_value, repo_root=REPO_ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def emit_agent_v2_candidate_metadata(
    gate_run: Any,
    gate_id: str,
    source: dict[str, Any],
) -> None:
    contract = load_agent_v2_contract()
    gate_contract = contract["gates"].get(gate_id)
    if gate_contract is None:
        raise RuntimeError(f"{gate_id}: missing Agent V2 proof contract")
    matrix = matrix_identity(contract)
    source_schema = schema_descriptor(contract, "source-identity")
    runner_schema = schema_descriptor(contract, "runner-attestation")
    gate_run.write_json(
        "proof/source-identity.json",
        {
            "artifactKind": "agent-v2-source-identity",
            "schema": source_schema,
            "role": "source-identity",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "sourceIdentity": source,
            "runtimeMatrix": matrix,
        },
        role="source-identity",
        redact=False,
    )
    gate_run.write_json(
        "proof/runner-attestation.json",
        {
            "artifactKind": "agent-v2-runner-attestation",
            "schema": runner_schema,
            "role": "runner-attestation",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "producer": {
                "kind": "runner",
                "processId": os.getpid(),
                "invocationId": secrets.token_hex(16),
            },
            "candidateOnly": True,
            "attestedAt": utc_now(),
        },
        role="runner-attestation",
        redact=False,
    )
    role_schemas: dict[str, Any] = {}
    for role in gate_contract["roles"]:
        schema_name = role if role in contract["schemas"] else "evidence-role"
        role_schemas[role] = schema_descriptor(contract, schema_name)
    report_schema = schema_descriptor(contract, "role-schema-report")
    gate_run.write_json(
        "proof/role-schema-report.json",
        {
            "artifactKind": "agent-v2-role-schema-report",
            "schema": report_schema,
            "role": "role-schema-report",
            "gateId": gate_id,
            "runId": gate_run.run_id,
            "schemas": role_schemas,
        },
        role="role-schema-report",
        redact=False,
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
        "PT_ACCEPTANCE_SSH_CONNECTIONS",
        AGGREGATE_SOURCE_ENV,
        "PT_MACHINE_LEASE_FD",
        "PT_MACHINE_LEASE_ID",
        "PT_MACHINE_LEASE_KIND",
        "PT_MACHINE_LEASE_RESOURCE_ID",
        "PT_MACHINE_LEASE_RESET_SCOPE",
        "PT_MACHINE_LEASE_WORKSPACE_ID",
        "PT_MACHINE_LEASE_SOURCE_BRANCH",
        "PT_MACHINE_LEASE_SOURCE_HEAD",
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


def environment_provisioner(
    environment_id: str,
    *,
    station_profiles: Mapping[str, str] | None = None,
    service_profiles: Mapping[str, str] | None = None,
    catalog_bindings: bool = False,
) -> Any | None:
    from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
    from tooling.acceptance.provisioners import get_provisioner

    contract_path = ENVIRONMENTS_DIR / f"{environment_id}.yaml"
    if not contract_path.exists():
        return None
    contract = EnvironmentContract.from_yaml(contract_path)
    service_ids = set(contract.services)
    return get_provisioner(
        contract,
        station_profiles={
            service_id: profile
            for service_id, profile in (station_profiles or {}).items()
            if service_id in service_ids
        },
        service_profiles={
            service_id: profile
            for service_id, profile in (service_profiles or {}).items()
            if service_id in service_ids
        },
        **({"catalog_bindings": True} if catalog_bindings else {}),
    )


def parse_station_profile_bindings(values: list[str]) -> dict[str, str]:
    bindings: dict[str, str] = {}
    for value in values:
        service_id, separator, profile_name = value.partition("=")
        service_id = service_id.strip()
        profile_name = profile_name.strip()
        if not separator or not service_id or not profile_name:
            raise SystemExit(
                "--station-profile must use SERVICE_ID=PROFILE"
            )
        if service_id in bindings:
            raise SystemExit(
                f"--station-profile repeats service {service_id!r}"
            )
        bindings[service_id] = profile_name
    return bindings


def parse_service_profile_bindings(values: list[str]) -> dict[str, str]:
    bindings: dict[str, str] = {}
    for value in values:
        service_id, separator, profile_name = value.partition("=")
        service_id = service_id.strip()
        profile_name = profile_name.strip()
        if not separator or not service_id or not profile_name:
            raise SystemExit(
                "--service-profile must use SERVICE_ID=PROFILE"
            )
        if service_id in bindings:
            raise SystemExit(
                f"--service-profile repeats service {service_id!r}"
            )
        bindings[service_id] = profile_name
    return bindings


def parse_runtime_cell_bindings(values: list[str]) -> dict[str, str]:
    bindings: dict[str, str] = {}
    for value in values:
        gate_id, separator, cell_id = value.partition("=")
        gate_id = gate_id.strip()
        cell_id = cell_id.strip()
        if not separator or not gate_id or not cell_id:
            raise SystemExit(
                "--runtime-cell-binding must use GATE_ID=RUNTIME_CELL"
            )
        if gate_id in bindings:
            raise SystemExit(
                f"--runtime-cell-binding repeats Gate {gate_id!r}"
            )
        bindings[gate_id] = cell_id
    return bindings


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
    provisioning_process_cleanup: dict[str, Any] | None = None,
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
        "provisioningProcessCleanup": provisioning_process_cleanup,
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
    provisioner: Any = None,
    artifact_kind: str = "acceptance-binary",
) -> tuple[Any, dict[str, Any], Path]:
    from tooling.acceptance.provisioners import get_runtime_cell_lifecycle

    lifecycle = get_runtime_cell_lifecycle(cell_id, provisioner=provisioner)
    acquired = False
    try:
        manifest = lifecycle.ready(
            gate_id,
            artifact_kind=artifact_kind,
        )
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


def runtime_cell_subprocess_environment(
    manifest: dict[str, Any] | None,
) -> dict[str, str]:
    if manifest is None:
        return {}
    adapter = manifest.get("nativeAdapter")
    if not isinstance(adapter, dict):
        raise RuntimeError("runtime cell manifest has no native adapter")
    input_mode = str(adapter.get("inputMode") or "").strip()
    isolation_by_mode = {
        "semantic-nonintrusive": "shared-user-session",
        "exclusive-native-input": "isolated-gui-session",
    }
    isolation = isolation_by_mode.get(input_mode)
    if isolation is None:
        raise RuntimeError(
            f"runtime cell manifest has invalid input mode {input_mode!r}"
        )
    return {
        "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": input_mode,
        "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": isolation,
    }


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
        if error.diagnostic is not None:
            result["diagnostic"] = error.diagnostic.to_dict()
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
        result["blockedResource"] = error.resource
        if error.diagnostic is not None:
            result["diagnostic"] = error.diagnostic.to_dict()
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
        if error.diagnostic is not None:
            result["diagnostic"] = error.diagnostic.to_dict()
    elif blocked:
        result["blockedReason"] = redact_text(str(error))
        result["blockedResource"] = (
            getattr(error, "resource", "") or f"ephemeral-launch-context:{gate_id}"
        )
        diagnostic = getattr(error, "diagnostic", None)
        if diagnostic is not None:
            diagnostic.require_resource(result["blockedResource"])
            result["diagnostic"] = diagnostic.to_dict()
    errno_name = getattr(error, "errno_name", "")
    resource_category = getattr(error, "resource_category", "")
    if errno_name:
        result["spawnErrno"] = errno_name
    if resource_category:
        result["spawnResourceCategory"] = resource_category
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


def provisioning_process_cleanup_failure(error: Exception, stage: str) -> dict[str, Any] | None:
    from tooling.acceptance.core import EphemeralLaunchCleanupFailed
    from tooling.acceptance.core.redaction import redact_text

    if not isinstance(error, EphemeralLaunchCleanupFailed):
        return None
    return {
        "status": "failed", "stage": stage, "errorType": type(error).__name__,
        "operation": error.operation, "error": redact_text(str(error)),
        "cleanup": ephemeral_cleanup_payload(error.result),
    }


def load_plan(
    path: Path | None,
    store: Any,
    execution_mode: str = "closure",
    execution_plan_path: Path | None = None,
) -> tuple[dict[str, Any], Any]:
    if path is not None:
        if not path.is_file():
            raise SystemExit(f"acceptance plan {str(path)!r} does not exist")
        return json.loads(path.read_text(encoding="utf-8")), str(path)
    command = [
        sys.executable,
        "tooling/scripts/acceptance-plan.py",
    ]
    if execution_plan_path is None:
        command.append("--active-plan")
    else:
        command.extend(["--execution-plan", str(execution_plan_path)])
    if execution_mode == "completion":
        command.append("--completion")
    elif execution_mode == "full":
        command.append("--full")
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as temporary:
        projection_path = Path(temporary.name)
    command.extend(["--output", str(projection_path)])
    try:
        generated = subprocess.run(
            command,
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
            env={
                **os.environ,
                "PT_ACCEPTANCE_ARTIFACT_ROOT": str(store.root),
            },
        )
        if generated.returncode != 0:
            detail = generated.stderr.strip() or generated.stdout.strip()
            raise SystemExit(
                "active execution plan projection failed with exit code "
                f"{generated.returncode}: {detail}"
            )
        plan = json.loads(projection_path.read_text(encoding="utf-8"))
    finally:
        projection_path.unlink(missing_ok=True)
    source = plan.get("execution", {}).get("formalPlan")
    if not isinstance(source, str) or not source:
        raise SystemExit("active execution plan projection has no formal plan")
    return plan, source


def load_gate_definitions(path: Path) -> dict[str, Any]:
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ExecutionBudgetError(f"duplicate catalog field: {key}")
            value[key] = item
        return value
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs).get("gates", {})


def gate_launch_fields(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    if "judgment" in definition:
        if definition["judgment"] != "all-prerequisites" or "command" in definition or "argv" in definition:
            raise SystemExit(f"{gate_id}: invalid prerequisite judgment")
        return {"judgment": definition["judgment"]}
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
    validate_execution_inputs(gate_id, definition)
    validate_e2e_definition(gate_id, definition)
    gate = {
        "id": gate_id,
        **gate_launch_fields(gate_id, definition),
        "timeout_seconds": definition.get("timeout_seconds", 600),
        "environment": definition.get("environment", "local"),
        "provisioner": definition.get("provisioner", ""),
        "requiredRuntimeCells": definition.get("requiredRuntimeCells", []),
        "tier": definition.get("tier", "local-evidence"),
        "description": definition.get("description", ""),
        "dependsOn": definition.get("dependsOn", []),
        "required_by": ["manual"],
    }
    if "executionInputs" in definition:
        gate["executionInputs"] = definition["executionInputs"]
    if "e2e" in definition:
        gate["e2e"] = definition["e2e"]
    artifact_kind = definition.get("runtimeCellArtifact")
    if artifact_kind is not None:
        if artifact_kind not in ("acceptance-binary", "installed-appimage"):
            raise SystemExit(
                f"{gate_id}: runtimeCellArtifact must be acceptance-binary "
                "or installed-appimage"
            )
        if not gate["requiredRuntimeCells"]:
            raise SystemExit(
                f"{gate_id}: runtimeCellArtifact requires requiredRuntimeCells"
            )
        gate["runtimeCellArtifact"] = artifact_kind
    return gate


def gate_launch_display(gate: dict[str, Any]) -> str:
    if "judgment" in gate:
        return "judge immutable prerequisite proofs"
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
        "runtimeCellArtifact",
        "dependsOn",
        "judgment",
        "executionInputs",
        "e2e",
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


def record_failure_observation(result: dict[str, Any], run: Any) -> dict[str, Any]:
    """Give preparation/deadline causes an immutable observation in this Gate."""
    if not result_is_incomplete(result) or not result.get("reason"):
        return result
    if isinstance(result.get("sourceArtifact"), dict):
        # Already produced by this Gate's Runtime Manifest or command report.
        if result["sourceArtifact"] in [
            ref.to_dict() for ref in run.collect_existing_artifacts().values()
        ]:
            return result
    observation = {
        key: value for key, value in result.items()
        if key not in {"sourceArtifact", "sourceArtifactKind"}
    }
    observation.update(
        artifactKind="acceptance-execution-failure-observation",
        gateId=result["id"],
        gate=result.get("sourceGate", result["id"]),
        phase=result.get("sourcePhase", "Gate Execution"),
        bom=result.get("sourceBom", ["acceptance-execution"]),
        spec=result.get("sourceSpec", ["execution-budget"]),
    )
    ref = run.write_json(
        "reports/execution-failure.json", observation,
        role="execution-failure-observation",
    )
    return {
        **result,
        "sourceArtifact": ref.to_dict(),
        "sourceArtifactKind": observation["artifactKind"],
        "sourcePhase": observation["phase"],
    }


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
        "blockedReason",
        "blockedResource",
        "error",
        "error_type",
        "failedStep",
        "sampleEmissionAllowed",
        "assertions",
        "diagnostic",
    ):
        if key in artifact:
            summary[key] = artifact[key]
    if isinstance(artifact.get("manifest"), dict):
        summary["manifest"] = artifact["manifest"]
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
    # An explicit same-run failure observation owns the cause. A successful
    # cleanup artifact must never replace it or supply the failure's status.
    primary = next(
        (artifact for artifact in artifacts
         if artifact["path"] == result.get("sourceArtifact")),
        None,
    )
    primary = primary or next(
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
    if primary is None and not result_is_incomplete(result):
        return enriched
    if primary is None:
        primary = next(
            (
                artifact
                for artifact in artifacts
                if artifact.get("gateId", result.get("id")) == result.get("id")
                and (
                    artifact.get("status") in {"FAIL", "FAILED", "BLOCKED", "failed", "blocked"}
                    or artifact.get("completionStatus") in {"PARTIAL", "BLOCKED"}
                    and all(key in artifact for key in ("phase", "bom", "spec", "gate"))
                )
            ),
            None,
        )
    if primary is None:
        return enriched
    traceability_artifact = primary if all(
        key in primary for key in ("phase", "bom", "spec", "gate")
    ) else next(
        (
            artifact
            for artifact in artifacts
            if all(key in artifact for key in ("phase", "bom", "spec", "gate"))
        ),
        primary,
    )
    enriched["sourceArtifact"] = primary.get("path")
    if "diagnostic" in primary:
        from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic

        try:
            diagnostic = ResourceDiagnostic.from_dict(primary["diagnostic"])
            diagnostic.require_resource(
                primary.get("blockedResource") or result.get("blockedResource") or ""
            )
        except (TypeError, ValueError):
            enriched["diagnosticError"] = "producer resource diagnostic is invalid"
            enriched.pop("diagnostic", None)
        else:
            bound = diagnostic.to_dict()
            for check in bound["resourceChecks"]:
                check["evidenceArtifact"] = primary["path"]
            enriched["diagnostic"] = bound
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
        ("manifest", "manifest"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for key in ("blockedReason", "blockedResource"):
        if key in primary:
            enriched[key] = primary[key]
    if (
        result.get("exit_code") == 2
        and result.get("cleanupStatus") != "failed"
        and not result.get("timedOut")
        and "sourceDrift" not in result
        and primary.get("status") == "BLOCKED"
        and primary.get("completionStatus") == "BLOCKED"
        and primary.get("proofStatus") == "UNPROVEN"
        and primary.get("sampleEmissionAllowed") is False
    ):
        enriched["status"] = "blocked"
        enriched["completionStatus"] = "BLOCKED"
        enriched["proofStatus"] = "UNPROVEN"
        enriched["sampleEmissionAllowed"] = False
        enriched.setdefault(
            "blockedReason",
            str(primary.get("reason") or primary.get("error") or "BLOCKED"),
        )
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
    if (
        primary.get("artifactKind") == "acceptance-gate-evidence-report"
        and primary.get("status") in {"PASS", "passed"}
    ):
        from tooling.acceptance.core.errors import EvidenceError

        try:
            require_report_proof(primary, result["id"])
        except EvidenceError as error:
            enriched.update(
                status="failed", completionStatus="PARTIAL", proofStatus="UNPROVEN",
                sampleEmissionAllowed=False, reason=str(error),
            )
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
    execution_policy: str = "acceptance",
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
    if execution_policy == "development":
        declared_completion = standardized.get("completionStatus")
        declared_proof = standardized.get("proofStatus")
        declared_incomplete = (
            declared_completion in {"PARTIAL", "BLOCKED"}
            or declared_proof == "UNPROVEN"
        )
        standardized["artifactKind"] = "development-functional-result"
        if status == "blocked":
            standardized["completionStatus"] = "BLOCKED"
            standardized["proofStatus"] = "UNPROVEN"
        elif (
            status == "passed"
            and environment_evidence_valid
            and not declared_incomplete
        ):
            standardized["completionStatus"] = "DONE"
            standardized["proofStatus"] = "NOT_APPLICABLE"
        else:
            standardized["completionStatus"] = "PARTIAL"
            standardized["proofStatus"] = "UNPROVEN"
            if status == "passed" and environment_proof:
                standardized.setdefault(
                    "reason",
                    "development runtime result lacks complete typed runtime evidence",
                )
        standardized["sampleEmissionAllowed"] = False
        standardized["verificationClass"] = "FUNCTIONAL_CHECK"
        standardized["traceability"] = traceability
        return standardized
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


def prepare_gate_result(
    result: dict[str, Any],
    plan_path: Any,
    runtime: dict[str, Any] | None = None,
    runtime_cell: str | None = None,
    secret_values: tuple[str, ...] = (),
    *,
    candidate_mode: bool = False,
    execution_policy: str = "acceptance",
) -> tuple[dict[str, Any], dict[str, Any]]:
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
        redacted_result["proofStatus"] = (
            "NOT_APPLICABLE"
            if execution_policy == "development"
            else "UNPROVEN"
        )
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
        execution_policy=execution_policy,
    )
    return standardized, redacted_runtime


def finalize_gate_result(
    result: dict[str, Any],
    gate_run: Any,
    plan_path: Any,
    runtime: dict[str, Any] | None = None,
    runtime_cell: str | None = None,
    secret_values: tuple[str, ...] = (),
    candidate_mode: bool = False,
) -> dict[str, Any]:
    standardized, redacted_runtime = prepare_gate_result(
        result,
        plan_path,
        runtime,
        runtime_cell,
        secret_values,
        candidate_mode=candidate_mode,
    )
    gate_run.finalize(result=standardized, runtime=redacted_runtime)
    gate_run.publish_latest(runtime_cell=runtime_cell)
    return standardized


def record_development_result(
    result: dict[str, Any],
    gate_run: Any,
    plan_path: Any,
    work_item: str,
    runtime: dict[str, Any] | None = None,
    runtime_cell: str | None = None,
    secret_values: tuple[str, ...] = (),
) -> dict[str, Any]:
    standardized, redacted_runtime = prepare_gate_result(
        result,
        plan_path,
        runtime,
        runtime_cell,
        secret_values,
        execution_policy="development",
    )
    reference = gate_run.write_json(
        "development/result.json",
        standardized,
        role="development-result",
    )
    gate_run.finalize(
        result={
            **standardized,
            "developmentArtifact": reference.to_dict(),
            "workItemId": work_item,
        },
        runtime=redacted_runtime,
    )
    standardized["developmentArtifact"] = reference.to_dict()
    standardized["developmentManifest"] = gate_run.manifest_ref.to_dict()
    standardized["developmentRunId"] = gate_run.run_id
    return standardized


def finalize_development_run(
    report: dict[str, Any],
    aggregate_run: Any,
    report_reference: Any,
    plan: dict[str, Any],
    plan_source: Any,
    work_item: str,
    journey_id: str,
) -> Any:
    from tooling.acceptance.core import EvidenceManifestInvalid, source_identity

    execution = plan.get("execution")
    if not isinstance(execution, dict):
        raise EvidenceManifestInvalid(
            "development execution requires formal Plan context"
        )
    gate_manifests = [
        result.get("developmentManifest")
        for result in report.get("results", [])
        if isinstance(result, dict)
    ]
    gate_ids = [
        result.get("id")
        for result in report.get("results", [])
        if isinstance(result, dict)
    ]
    if (
        not gate_ids
        or any(not isinstance(value, str) or not value for value in gate_ids)
        or any(not isinstance(value, dict) for value in gate_manifests)
        or len(gate_manifests) != len(gate_ids)
    ):
        raise EvidenceManifestInvalid(
            "development run is missing Gate manifests"
        )
    final_source = source_identity(REPO_ROOT)
    if final_source != report.get("source"):
        raise EvidenceManifestInvalid(
            "development source changed during aggregate finalization"
        )
    context_reference = aggregate_run.write_json(
        "development/manifest.json",
        {
            "artifactKind": "development-run-manifest",
            "schemaVersion": 2,
            "state": "DURABLE",
            "workspaceId": report_reference.workspace_id,
            "gateId": report_reference.gate_id,
            "runId": report_reference.run_id,
            "workItemId": work_item,
            "planId": execution.get("planId"),
            "planPath": execution.get("formalPlan"),
            "taskId": execution.get("currentTaskId"),
            "closureId": execution.get("closure"),
            "journeyId": journey_id,
            "gateIds": gate_ids,
            "gateManifests": gate_manifests,
            "source": final_source,
            "result": report_reference.to_dict(),
            "createdAt": utc_now(),
        },
        role="development-run-manifest",
    )
    aggregate_run.finalize(
        result={
            "status": (
                "passed" if development_exit_code(report) == 0 else "failed"
            ),
            "completionStatus": report.get("completionStatus"),
            "proofStatus": report.get("proofStatus"),
            "workItemId": work_item,
            "journeyId": journey_id,
        },
        runtime={
            "plan": plan_source,
            "execution": execution,
            "developmentManifest": context_reference.to_dict(),
        },
    )
    return aggregate_run.manifest_ref


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
    execution_policy: str = "acceptance",
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
            "NOT_APPLICABLE"
            if execution_policy == "development"
            else ("CANDIDATE" if candidate_mode else "PROVEN")
        )
        if status == "pass"
        else (
            "NOT_APPLICABLE"
            if execution_policy == "development"
            else "UNPROVEN"
        ),
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
    execution_policy: str = "acceptance",
) -> dict[str, Any]:
    results = [
        standardize_result(
            result,
            plan_path,
            candidate_mode=candidate_mode,
            execution_policy=execution_policy,
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
    if execution_policy == "development":
        sample_emission_allowed = False
    report_complete = bool(results) and not incomplete and not dry_run
    report: dict[str, Any] = {
        "artifactKind": (
            "development-functional-run"
            if execution_policy == "development"
            else RUN_ARTIFACT_KIND
        ),
        "executionPolicy": execution_policy,
        "plan": plan_path,
        "sourceArtifact": plan_path,
        "source": dict(source) if source is not None else {},
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
            (
                "NOT_APPLICABLE"
                if execution_policy == "development"
                else ("CANDIDATE" if candidate_mode else "PROVEN")
            )
            if report_complete
            and not failed
            and not blocked
            and not unproven
            else "UNPROVEN"
        ),
        "sampleEmissionAllowed": (
            False if execution_policy == "development" else sample_emission_allowed
        ),
        "resultTraceabilityState": result_traceability_state(
            results,
            candidate_mode=candidate_mode,
            execution_policy=execution_policy,
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


def development_exit_code(report: dict[str, Any]) -> int:
    if report.get("completionStatus") == "BLOCKED":
        return 2
    if report.get("completionStatus") != "DONE":
        return 1
    return 0


def candidate_artifacts_required(
    result: dict[str, Any],
    *,
    candidate_mode: bool,
) -> bool:
    return candidate_mode and result.get("status") == "passed"


def main() -> int:
    request_started = time.monotonic()
    from tooling.acceptance.core import (
        EvidenceConflict,
        EvidenceError,
        EvidenceStore,
        new_run_id,
        source_identity,
        validate_run_id,
        workspace_id,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--execution-plan")
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--gate", action="append", default=[])
    parser.add_argument("--all-gates", action="store_true")
    parser.add_argument("--exclude-domain", action="append", default=[])
    parser.add_argument("--exclude-gate", action="append", default=[])
    parser.add_argument("--execution-budget", help="explicit lifecycle budget JSON")
    parser.add_argument("--resume-session", help="original DURABLE session manifest ArtifactRef JSON")
    parser.add_argument(
        "--prior-session-manifest",
        help="prior manifest ArtifactRef JSON for a fresh policy session",
    )
    parser.add_argument("--repair-record", help="qualified repair with immutable validation refs")
    parser.add_argument("--stop-on-failure", action="store_true")
    parser.add_argument("--tier", action="append", default=[])
    execution_mode = parser.add_mutually_exclusive_group()
    execution_mode.add_argument("--completion", action="store_true")
    execution_mode.add_argument("--full", action="store_true")
    parser.add_argument("--runtime-cell")
    parser.add_argument(
        "--runtime-cell-binding",
        action="append",
        default=[],
        metavar="GATE_ID=RUNTIME_CELL",
    )
    parser.add_argument(
        "--execution-policy",
        choices=("acceptance", "development"),
        default="acceptance",
    )
    parser.add_argument("--run-id")
    parser.add_argument("--allocate-run-id", action="store_true")
    parser.add_argument("--work-item")
    parser.add_argument("--development-journey-id")
    parser.add_argument("--development-manifest-out")
    parser.add_argument(
        "--station-profile",
        action="append",
        default=[],
        metavar="SERVICE_ID=PROFILE",
    )
    parser.add_argument(
        "--service-profile",
        action="append",
        default=[],
        metavar="SERVICE_ID=PROFILE",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--candidate-ref-out")
    parser.add_argument("--candidate-manifest-sha-out")
    args = parser.parse_args()
    if (args.repair_record and not args.resume_session) or (
        args.resume_session and (not args.execution_budget or args.dry_run)
    ):
        raise SystemExit("session resume requires budget and an original durable manifest")
    if (args.resume_session or args.prior_session_manifest) and args.execution_policy != "acceptance":
        raise SystemExit("durable execution continuation requires Acceptance policy")
    if args.prior_session_manifest and (
        args.resume_session or args.repair_record or not args.execution_budget or args.dry_run
    ):
        raise SystemExit("policy lineage requires a fresh bounded execution session")
    if args.all_gates and (
        args.plan or args.execution_plan or args.gate or args.tier
        or args.completion or args.full or args.run_id or args.allocate_run_id
    ):
        raise SystemExit("--all-gates requires a catalog scope without other selectors")
    if (args.exclude_domain or args.exclude_gate) and not args.all_gates:
        raise SystemExit("scope exclusions require --all-gates")
    if args.all_gates and not args.execution_budget and not args.dry_run:
        raise SystemExit("--all-gates execution requires an explicit --execution-budget")
    policy = (
        ExecutionBudgetPolicy(json.loads(Path(args.execution_budget).read_text()))
        if args.execution_budget else None
    )
    if policy is not None:
        # The invoked interpreter is the selected toolchain. Preserve its
        # executable path (including venv identity), never resolve a symlink
        # into a different Python environment or silently fall back.
        interpreter = os.environ.get("PT_ACCEPTANCE_PYTHON") or sys.executable
        os.environ["PT_ACCEPTANCE_PYTHON"] = interpreter
        os.environ["PT_ARCHITECTURE_PYTHON"] = interpreter
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        os.environ["PATH"] = str(Path(interpreter).parent) + os.pathsep + os.environ.get("PATH", "")
    request_deadline = request_started + (
        policy.request_seconds if policy else float("inf")
    )
    planning = (
        GateExecution(
            "control-plane",
            GateTimeLimits(1, 1, work_seconds=policy.planning_seconds),
            request_deadline,
        ) if policy else None
    )
    scope = None
    publication = None
    if args.allocate_run_id:
        if any(
            (
                args.plan,
                args.execution_plan,
                args.gate,
                args.tier,
                args.completion,
                args.full,
                args.runtime_cell,
                args.runtime_cell_binding,
                args.station_profile,
                args.dry_run,
                args.candidate_ref_out,
                args.candidate_manifest_sha_out,
                args.run_id,
                args.work_item,
                args.development_journey_id,
                args.development_manifest_out,
            )
        ):
            raise SystemExit("--allocate-run-id cannot be combined with execution options")
        print(json.dumps({"runId": new_run_id()}, sort_keys=True))
        return 0
    if args.plan and args.execution_plan:
        raise SystemExit("--plan and --execution-plan are mutually exclusive")
    if (args.completion or args.full) and (args.plan or args.gate):
        raise SystemExit(
            "--completion/--full use the active formal plan and cannot be "
            "combined with --plan or --gate"
        )
    selected_execution_mode = (
        "completion" if args.completion else "full" if args.full else "closure"
    )
    station_profiles = parse_station_profile_bindings(args.station_profile)
    service_profiles = parse_service_profile_bindings(args.service_profile)
    runtime_cell_bindings = parse_runtime_cell_bindings(
        args.runtime_cell_binding
    )
    if args.runtime_cell and runtime_cell_bindings:
        raise SystemExit(
            "--runtime-cell and --runtime-cell-binding are mutually exclusive"
        )
    candidate_mode = bool(
        args.candidate_ref_out or args.candidate_manifest_sha_out
    )
    if candidate_mode and not (
        args.candidate_ref_out and args.candidate_manifest_sha_out
    ):
        raise SystemExit(
            "candidate handoff requires both --candidate-ref-out and "
            "--candidate-manifest-sha-out"
        )
    if candidate_mode and (args.dry_run or len(args.gate) != 1):
        raise SystemExit(
            "candidate handoff requires exactly one --gate and forbids --dry-run"
        )
    if args.execution_policy == "development":
        if not args.work_item:
            raise SystemExit("development execution requires --work-item")
        if (
            args.completion
            or args.full
            or candidate_mode
            or args.run_id
        ):
            raise SystemExit(
                "development execution forbids completion/full, "
                "candidate handoff, and formal --run-id"
            )
        if args.development_manifest_out or args.development_journey_id:
            if (
                not args.development_manifest_out
                or not args.development_journey_id
                or not args.execution_plan
                or args.plan
                or args.gate
                or args.tier
            ):
                raise SystemExit(
                    "Development Session commit requires "
                    "--development-manifest-out, --development-journey-id, "
                    "and one formal --execution-plan closure; it forbids "
                    "--plan, --gate, and --tier"
                )
    elif (
        args.work_item
        or args.development_journey_id
        or args.development_manifest_out
    ):
        raise SystemExit(
            "development result options are valid only for development execution"
        )
    if args.run_id:
        try:
            validate_run_id(args.run_id)
        except EvidenceError as error:
            raise SystemExit(str(error)) from error
        if (
            len(args.gate) != 1
            or args.plan
            or args.execution_plan
            or args.completion
            or args.full
            or args.dry_run
        ):
            raise SystemExit(
                "--run-id requires one explicit formal --gate invocation"
            )
    request_claim = None
    session_terminal_ref = None
    prior_manifest_ref = None
    reuse_validation: list[dict[str, Any]] = []
    context_identity = None
    aggregate_source = None
    session_validation = None
    preparation_owner = planning
    try:
        # Planning only needs an external path, not an allocated Evidence Store.
        store = SimpleNamespace(root=Path(tempfile.gettempdir()))
        if (args.gate or args.all_gates) and not args.plan and not args.execution_plan:
            plan = {"selected_gates": []}
            plan_source = {
                "artifactKind": "acceptance-manual-selection",
                "gateIds": list(args.gate),
            }
        else:
            plan, plan_source = execute_stage(
                planning, "plan", load_plan,
                Path(args.plan) if args.plan else None,
                store,
                selected_execution_mode,
                Path(args.execution_plan) if args.execution_plan else None,
            )
        definitions = execute_stage(
            planning, "catalog", load_gate_definitions, Path(args.gates)
        )
        if policy is not None and set(policy.gates) - set(definitions):
            raise ExecutionBudgetError("time limits reference unknown catalog Gates")
        if args.all_gates:
            scope_catalog = execute_stage(
                planning, "ownership-catalog", load_scope_catalog, Path(args.gates).parent,
            )
            scope = execute_stage(
                planning, "scope", freeze_scope,
                definitions, scope_catalog["capabilities"],
                excluded_domains=args.exclude_domain,
                excluded_gates=args.exclude_gate,
                features=scope_catalog["features"],
                domains=scope_catalog["domains"],
                rules=scope_catalog["rules"],
            )
            plan_source = scope
            args.gate = scope["dispatchGateIds"]
        gates = resolve_requested_gates(plan, definitions, args.gate)
        gates = filter_gates_by_tier(gates, args.tier)
        selected_by_id = {gate["id"]: gate for gate in gates}
        graph = execute_stage(
            planning, "execution-graph", compile_graph, definitions,
            list(selected_by_id),
            excluded_ids=tuple(
                item["gateId"] for item in scope["decisions"] if not item["included"]
            ) if scope else (),
        )
        gates = [
            selected_by_id.get(gate_id) or gate_from_definition(gate_id, definitions[gate_id])
            for gate_id in graph["dispatchGateIds"]
        ]
        selected_gate_ids = {gate["id"] for gate in gates}
        unknown_runtime_bindings = (
            set(runtime_cell_bindings) - selected_gate_ids
        )
        if unknown_runtime_bindings:
            raise SystemExit(
                "--runtime-cell-binding references unselected Gate(s): "
                + ", ".join(sorted(unknown_runtime_bindings))
            )
        for gate in gates:
            bound_cell = runtime_cell_bindings.get(gate["id"])
            if bound_cell is not None and (
                select_runtime_cell(gate, bound_cell) != bound_cell
            ):
                raise SystemExit(
                    f"gate {gate['id']!r} does not declare runtime cells"
                )
        if candidate_mode and len(gates) != 1:
            raise ExecutionBudgetError("candidate handoff cannot expand prerequisite scope")
        if not gates:
            raise EvidenceError(
                "selected Acceptance scope contains no executable Gates"
            )
        aggregate_source = execute_stage(
            planning, "source-snapshot", source_identity, REPO_ROOT
        )
        e2e_preflight = execute_stage(
            planning, "e2e-preflight", prepare_e2e, definitions, graph, aggregate_source,
            repo_root=REPO_ROOT, catalog_path=Path(args.gates),
            execution_policy=args.execution_policy,
        )
        if args.dry_run:
            preview = {
                "artifactKind": "acceptance-execution-preview",
                "executionPolicy": args.execution_policy, "executionGraph": graph,
                "e2ePreflight": e2e_preflight, "proofStatus": "UNPROVEN",
                "gates": [
                    {**{key: gate.get(key) for key in (
                        "id", "command", "argv", "environment", "provisioner",
                        "tier", "timeout_seconds",
                    )}, "status": "dry-run", "runtimeCell": select_runtime_cell(
                        gate, runtime_cell_bindings.get(gate["id"], str(args.runtime_cell or "")),
                    ) or None}
                    for gate in gates
                ],
            }
            print("preview: " + json.dumps(preview, sort_keys=True))
            if planning is not None:
                planning.finish()
            return 0 if e2e_preflight["ready"] else 2
        print("e2e-preflight: " + json.dumps(e2e_preflight, sort_keys=True))
        require_ready(e2e_preflight)
        if args.execution_policy == "development":
            store = execute_stage(
                planning, "evidence-store", EvidenceStore,
                development_artifact_root(str(args.work_item), workspace_id(REPO_ROOT)),
                worktree=REPO_ROOT,
            )
        else:
            store = execute_stage(
                planning, "evidence-store", EvidenceStore.from_environment,
                repo_root=REPO_ROOT, worktree=REPO_ROOT,
            )
        session = None
        if policy is not None and not args.dry_run:
            from tooling.acceptance.core import ArtifactRef

            session = ExecutionSession(graph["dispatchGateIds"], policy.identity)
            prior_report = None
            if args.resume_session:
                prior_manifest_ref = ArtifactRef.from_dict(
                    json.loads(Path(args.resume_session).read_text())
                )
                session, prior_report = execute_stage(
                    planning, "session-manifest", read_session_manifest, store, prior_manifest_ref,
                )
            if args.prior_session_manifest:
                lineage_manifest_ref = ArtifactRef.from_dict(
                    json.loads(Path(args.prior_session_manifest).read_text())
                )
                prior_manifest = execute_stage(
                    planning, "prior-session-manifest", store.read_run_manifest,
                    lineage_manifest_ref, manifest_sha256=lineage_manifest_ref.sha256,
                )
                prior_ref = ArtifactRef.from_dict(
                    prior_manifest.get("artifacts", {}).get("execution-session")
                )
                prior_value = execute_stage(
                    planning, "prior-session-evidence", store.read_json, prior_ref,
                )
                session = ExecutionSession.from_prior(
                    graph["dispatchGateIds"], policy.identity, prior_value,
                    manifest_ref=lineage_manifest_ref.to_dict(),
                    session_ref=prior_ref.to_dict(),
                )
            request_claim = execute_stage(
                planning, "session-lock", store.execution_request, session.session_id,
            )
            if prior_manifest_ref is not None:
                session, prior_report = execute_stage(
                    planning, "locked-session-manifest", read_session_manifest, store, prior_manifest_ref,
                )
            aggregate_source = execute_stage(
                planning, "locked-source-snapshot", source_identity, REPO_ROOT,
            )
            execute_stage(
                planning, "locked-e2e-preflight", revalidate_preflight,
                e2e_preflight, aggregate_source, repo_root=REPO_ROOT,
            )
            context_identity = execution_context_digest(args, plan_source)
            probe_context = {
                "source": aggregate_source,
                "runtimeCell": args.runtime_cell,
                "runtimeCellBindings": runtime_cell_bindings,
                "stationProfiles": station_profiles,
                "serviceProfiles": service_profiles,
                "catalogBindings": args.all_gates,
            }
            if (
                set(session.required_gate_ids) != set(graph["dispatchGateIds"])
                or len(session.required_gate_ids) != len(graph["dispatchGateIds"])
                or session.policy_digest != policy.identity
            ):
                raise ExecutionBudgetError("request must preserve full scope and budget")
            if args.repair_record:
                repair = json.loads(Path(args.repair_record).read_text())
                for ref in repair.get("validation_refs", []):
                    execute_stage(planning, "repair-evidence", store.resolve, ArtifactRef.from_dict(ref))
                session.repair(**repair)
            elif session.state == "PAUSED_REPAIR_REQUIRED":
                raise ExecutionBudgetError("original stop requires qualified owner repair")
            planning.finish()
            session_validation = GateExecution(
                "session-validation", policy.lifecycle, request_deadline,
            )
            preparation_owner = session_validation
            dispatch_history = execute_stage(
                preparation_owner, "dispatch-history", session.dispatch_history,
                store, aggregate_source,
                graph_digest=graph["digest"], context_digest=context_identity,
            )
            reuse_candidates = {"results": []}
            if (
                prior_report is not None
                and session.state == "PAUSED_REQUEST_EXHAUSTED"
                and session.current_source == aggregate_source
                and session.graph_digest == graph["digest"]
                and session.context_digest == context_identity
            ):
                reuse_candidates = {"results": dispatch_history}
            dispatch_order = request_dispatch_order(
                graph, set(), dispatch_history,
            )
            session.begin(
                aggregate_source,
                dispatch_order,
                graph_digest=graph["digest"], context_digest=context_identity,
            )
            execute_stage(
                preparation_owner, "consume-session-request", request_claim.consume,
                len(session.requests), prior_manifest_ref,
            )
        aggregate_run = execute_stage(
            preparation_owner, "aggregate-initialize", store.begin_run,
            (
                "development-run"
                if args.execution_policy == "development"
                else "acceptance-run"
            ),
            source=aggregate_source,
        )
    except (EvidenceError, ExecutionBudgetError, ExecutionDeadline, KeyboardInterrupt, KeyError, ValueError, TypeError, OSError) as error:
        if (
            isinstance(error, (ExecutionDeadline, KeyboardInterrupt))
            and policy is not None and "graph" in locals() and not args.dry_run
        ):
            try:
                publish_initialization_stop(
                    store, gates, aggregate_source or {}, graph, plan_source, preparation_owner, policy, error,
                )
            except (Exception, ExecutionDeadline):
                print("Initialization stopped; durable stop-record publication failed", file=sys.stderr)
        if request_claim is not None:
            request_claim.close()
        print(
            f"Acceptance evidence initialization failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1

    results: list[dict[str, Any]] = []
    execution_reports: list[dict[str, Any]] = []
    started_gate_ids: set[str] = set()
    execution_stop = None
    print(
        "Development Functional Run"
        if args.execution_policy == "development"
        else "Acceptance Run"
    )
    print("==========================")
    execution = plan.get("execution")
    if isinstance(execution, dict):
        print(f"formal_plan: {execution.get('formalPlan', '')}")
        print(f"closure: {execution.get('closure') or 'complete'}")
        print(f"mode: {execution.get('mode', '')}")
    if args.tier:
        print(f"tiers: {', '.join(args.tier)}")
    print(
        "timeout_budget_seconds: "
        + str(sum(int(gate.get("timeout_seconds") or 600) for gate in gates))
    )
    if not gates:
        print("[SKIP] no selected gates")

    active_gate_run = None
    execution = None
    candidate_manifest_ref = None
    graph_ref = None
    try:
        graph_ref = execute_stage(
            preparation_owner, "graph-persist", aggregate_run.write_json,
            "reports/graph.json", graph, role="execution-graph",
        )
        preflight_ref = execute_stage(
            preparation_owner, "e2e-preflight-persist", aggregate_run.write_json,
            "reports/e2e-preflight.json", e2e_preflight, role="e2e-preflight",
        )
        if scope is not None:
            scope_ref = execute_stage(
                preparation_owner, "scope-persist", aggregate_run.write_json,
                "reports/scope.json", scope, role="execution-scope", phase="publish",
            )
            plan_source = {
                "artifactKind": "acceptance-execution-scope-reference",
                "scope": scope_ref.to_dict(),
                "scopeDigest": scope["digest"],
            }
        if planning is not None:
            planning.finish()
        if session_validation is not None:
            session_validation.finish()
        gate_by_id = {gate["id"]: gate for gate in gates}
        request_gates = (
            [gate_by_id[gate_id] for gate_id in session.requests[-1]["dispatchGateIds"]]
            if session is not None else gates
        )
        for gate in request_gates:
            gate_id = gate["id"]
            command = gate_launch_display(gate)
            timeout = int(gate.get("timeout_seconds") or 600)
            environment = gate.get("environment", "local")
            tier = gate.get("tier", "local-evidence")
            runtime_cell = select_runtime_cell(
                gate,
                runtime_cell_bindings.get(
                    gate_id,
                    str(args.runtime_cell or ""),
                ),
            )
            print(f"[RUN] {gate_id} [{tier}/{environment}]: {command}")
            started = time.time()
            execution = (
                GateExecution(gate_id, policy.for_gate(gate), request_deadline)
                if policy else None
            )

            try:
                gate_source = execute_stage(
                    execution, "source-snapshot", source_identity, REPO_ROOT
                )
                if any(item["disposition"] != "NOT_DECLARED" for item in e2e_preflight["gates"]):
                    execute_stage(
                        execution, "e2e-preflight-revalidate", revalidate_preflight,
                        e2e_preflight, gate_source, repo_root=REPO_ROOT,
                    )
                if session is not None and gate_source == aggregate_source:
                    entry_results, entry_validation = execute_stage(
                        execution, "original-completion-validation", revalidate_session_results,
                        [gate], reuse_candidates, aggregate_source, graph, policy,
                        context_identity, store, probe_context, execution,
                        current_results=results,
                    )
                    reuse_validation.extend(entry_validation)
                    if entry_results:
                        gate_source = execute_stage(
                            execution, "reuse-source-readback", source_identity, REPO_ROOT,
                        )
                        if gate_source == aggregate_source:
                            session.record_reuse(entry_results[0])
                            execution.finish()
                            entry_validation[0]["cost"] = execution.report()
                            results.extend(entry_results)
                            print(f"[REUSED_ORIGINAL] {gate_id}")
                            continue
                        entry_validation[0].update(
                            disposition="PENDING", reason="source drift during original proof validation",
                            originRunId=None,
                        )
            except ExecutionDeadline:
                # Source capture and read-only validation acquire no Gate run.
                # A cancelled probe must confirm cleanup before normal exhaustion.
                if execution.limit_disposition() != "REQUEST_PREEMPTED":
                    raise
                execution.finish()
                cost = execution.report()
                execution_reports.append(cost)
                execution_stop = {
                    "gateId": gate_id,
                    "reason": "EXECUTION_BUDGET_STOP",
                    "cost": cost,
                    "source": aggregate_source,
                    "policyDigest": policy.identity,
                    "resumePolicy": "new bounded request; revalidate original proof and remaining scope",
                }
                remaining_results = stopped_results(
                    gates, {item["id"] for item in results}, execution_stop,
                )
                for pending in remaining_results:
                    if pending["id"] == gate_id:
                        pending["cleanupStatus"] = (
                            "passed" if any(
                                span["phase"] == "cleanup" and span["status"] == "completed"
                                for span in cost["spans"]
                            ) else "not-required"
                        )
                        pending["limitDisposition"] = cost["limitDisposition"]
                        pending["timeoutAttribution"] = cost["attribution"]
                results.extend(remaining_results)
                break
            source_drift = source_identity_drift(
                aggregate_source,
                gate_source,
            )
            gate_run = execute_stage(
                execution, "gate-initialize", store.begin_run,
                gate_id,
                source=gate_source,
                run_id=args.run_id,
            )
            active_gate_run = gate_run
            started_gate_ids.add(gate_id)
            gate_input_identity = None
            gate_input_artifacts = None
            gate_input_artifacts_ref = None
            input_identity_error = None
            input_owner_failure = None
            gate_env = gate_run.subprocess_environment(inherited_gate_environment(gate, os.environ))
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
            authority_environment: dict[str, str] = {}
            output_text = ""
            exit_code: int | None = None
            owner_interrupted = False
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
            provisioning_process_cleanup = None
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
            prerequisite_refs, unproven_dependencies = execute_stage(
                execution, "prerequisite-proof", prerequisite_results,
                gate, results, aggregate_source, store,
                execution_policy=args.execution_policy,
            )
            if result is None and unproven_dependencies:
                output_text = "Required prerequisite proof is unavailable.\n"
                judgment = {
                    "artifactKind": "acceptance-prerequisite-judgment",
                    "gateId": gate_id,
                    "gate": gate_id,
                    "status": "BLOCKED",
                    "completionStatus": "BLOCKED",
                    "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False,
                    "phase": "Prerequisite Proof",
                    "bom": ["acceptance-execution"],
                    "spec": ["dependsOn"],
                    "reason": "Required prerequisite proof is unavailable",
                    "blockedReason": "PREREQUISITE_UNPROVEN",
                    "requiredGateIds": unproven_dependencies,
                    "prerequisiteProofs": prerequisite_refs,
                }
                judgment_ref = execute_stage(
                    execution,
                    "prerequisite-judgment",
                    gate_run.write_json,
                    "reports/prerequisite-judgment.json",
                    judgment,
                    role="prerequisite-judgment",
                )
                result = {
                    "id": gate_id, "tier": tier, "environment": environment,
                    "status": "blocked", "completionStatus": "BLOCKED",
                    "proofStatus": "UNPROVEN", "blockedReason": "PREREQUISITE_UNPROVEN",
                    "requiredGateIds": unproven_dependencies,
                    "duration_seconds": 0, "exit_code": None,
                    "sourceArtifact": judgment_ref.to_dict(),
                    "sourceArtifactKind": "acceptance-prerequisite-judgment",
                    "sourcePhase": "Prerequisite Proof",
                    "sourceBom": ["acceptance-execution"],
                    "sourceSpec": ["dependsOn"],
                    "sourceGate": gate_id,
                }
            elif result is None and "judgment" in gate:
                result = {
                    "artifactKind": "acceptance-gate-judgment",
                    "id": gate_id, "tier": tier, "environment": environment,
                    "status": "passed", "completionStatus": "DONE", "proofStatus": "PROVEN",
                    "duration_seconds": 0, "exit_code": None,
                    "prerequisiteProofs": prerequisite_refs,
                    "sampleEmissionAllowed": False,
                }
                judgment_ref = execute_stage(
                    execution, "prerequisite-judgment", gate_run.write_json,
                    "reports/judgment.json", result, role="prerequisite-judgment",
                )
                result["sourceArtifact"] = judgment_ref.to_dict()
                result["sourceArtifactKind"] = "acceptance-gate-judgment"
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
                            provisioner = execute_stage(
                                execution, "environment-resolve", environment_provisioner,
                                provisioner_id,
                                station_profiles=station_profiles,
                                service_profiles=service_profiles,
                                catalog_bindings=args.all_gates,
                            )
                            provisioner.bind_evidence_run(gate_run)
                            authority_environment = execute_stage(
                                execution, "fixture-authority",
                                provisioner.prepare_fixture_authority,
                                budget_seconds=(
                                    execution.remaining("cleanup")
                                    if execution is not None
                                    else float(gate.get("timeout", 300))
                                ),
                            )
                            gate_env.update(authority_environment)
                            try:
                                with run_environment(gate_env):
                                    execute_stage(
                                        execution, "credentials", provisioner.prepare_credentials
                                    )
                            except Exception as error:
                                preparation_error = error
                        runtime_secrets = credential_values(provisioner)
                        gate_run.configure_redaction(runtime_secrets)
                        gate_env = gate_run.subprocess_environment(gate_env)
                        if preparation_error is not None:
                            raise preparation_error
                        with run_environment(gate_env):
                            with provisioner.remote_source_context():
                                try:
                                    provisioner, manifest, manifest_path = execute_stage(
                                        execution, "provision", provision_environment,
                                        provisioner_id,
                                        gate_id,
                                        provisioner,
                                    )
                                finally:
                                    gate_env.update(provisioner.remote_source_environment)
                    except EvidenceError:
                        raise
                    except Exception as error:
                        provisioning_process_cleanup = provisioning_process_cleanup_failure(
                            error, "environment-provisioning",
                        )
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
                        if "diagnostic" in manifest:
                            result["diagnostic"] = manifest["diagnostic"]
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
                            ) = execute_stage(
                                execution, "runtime-cell", provision_runtime_cell,
                                cell_id=runtime_cell,
                                gate_id=gate_id,
                                gate_run=gate_run,
                                provisioner=provisioner,
                                artifact_kind=str(
                                    gate.get("runtimeCellArtifact")
                                    or "acceptance-binary"
                                ),
                            )
                    except EvidenceError:
                        raise
                    except Exception as error:
                        provisioning_process_cleanup = provisioning_process_cleanup_failure(
                            error, "runtime-cell-provisioning",
                        )
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
                        ) = execute_stage(
                            execution, "launch-context", prepare_gate_launch_context,
                            gate=gate,
                            gate_run=gate_run,
                            provisioner=provisioner,
                            manifest=manifest,
                        )
                        execute_stage(
                            execution, "launch-seal", launch_context.seal,
                            workspace_id=gate_run.store.workspace_id,
                            gate_id=gate_id,
                            evidence_run_id=gate_run.run_id,
                            provisioning_run_id=provisioning_run_id,
                        )
                        launch_binding = execute_stage(
                            execution, "launch-bind", launch_context.bind_child
                        )
                        execute_stage(execution, "launch-activate", launch_context.activate)
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
                    if "e2e" in gate:
                        execute_stage(
                            execution, "e2e-before-command", revalidate_preflight,
                            e2e_preflight,
                            execute_stage(execution, "e2e-command-source", source_identity, REPO_ROOT),
                            repo_root=REPO_ROOT,
                        )
                    if gate.get("ephemeralCapabilities"):
                        gate_env = context_gate_subprocess_environment(
                            gate_run,
                            os.environ,
                        )
                    else:
                        gate_env = gate_run.subprocess_environment(
                            inherited_gate_environment(gate, os.environ)
                        )
                        gate_env.update(authority_environment)
                        if provisioner is not None:
                            gate_env.update(provisioner.remote_source_environment)
                    gate_env[AGGREGATE_SOURCE_ENV] = json.dumps(
                        aggregate_source,
                        sort_keys=True,
                    )
                    gate_env[PREREQUISITE_PROOFS_ENV] = json.dumps(
                        prerequisite_refs,
                        ensure_ascii=True,
                        separators=(",", ":"),
                    )
                    if "e2e" in gate:
                        gate_env[PREFLIGHT_ENV] = preflight_binding(e2e_preflight)
                    gate_env["PT_ACCEPTANCE_CURRENT_RESULTS"] = json.dumps(
                        current_result_proof_envelope(
                            aggregate_run.source,
                            results,
                        ),
                        ensure_ascii=True,
                        separators=(",", ":"),
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
                    gate_env.update(
                        runtime_cell_subprocess_environment(
                            runtime_cell_manifest
                        )
                    )
                    if session is not None:
                        try:
                            gate_input_artifacts = execute_stage(
                                execution, "input-artifacts-capture", capture_input_artifacts,
                                gate, gate_run, {
                                    "environment": manifest, "runtimeCell": runtime_cell_manifest,
                                }, prerequisite_refs,
                            )
                            gate_input_artifacts_ref = execute_stage(
                                execution, "input-artifacts-persist", gate_run.write_json,
                                "proof/input-artifacts.json", gate_input_artifacts,
                                role="input-artifacts",
                            )
                            gate_input_identity = gate_execution_identity(
                                gate, graph, policy, context_identity,
                                probe_context=probe_context, execution=execution,
                                input_artifacts=gate_input_artifacts,
                                input_artifacts_ref=gate_input_artifacts_ref, store=store,
                            )
                        except InputIdentityCleanupFailed as error:
                            gate_process_cleanup_status = "failed"
                            gate_process_cleanup_error = str(error)
                            result = ephemeral_launch_failure_result(
                                gate_id=gate_id, command=command, environment=environment,
                                tier=tier, error=error,
                                duration_seconds=round(time.time() - started, 3),
                            )
                        except InputIdentityError as error:
                            input_identity_error = str(error)
                            if isinstance(error, InputIdentityProbeFailed):
                                input_owner_failure = error.failure
                            result = {
                                "id": gate_id, "command": command, "environment": environment,
                                "tier": tier, "status": "blocked", "completionStatus": "BLOCKED",
                                "proofStatus": "UNPROVEN", "sampleEmissionAllowed": False,
                                "blockedReason": "INPUT_IDENTITY_UNPROVEN",
                                "reason": input_identity_error,
                                "sourcePhase": "Gate Input Owner",
                                "exit_code": None, "duration_seconds": round(time.time() - started, 3),
                            }
                if result is None:
                    try:
                        inherited_fds: tuple[int, ...] = ()
                        if (
                            not gate.get("ephemeralCapabilities")
                            and gate_env.get("PT_MACHINE_LEASE_KIND") == "station.reset"
                        ):
                            from tooling.acceptance.core.reset_authority import (
                                require_station_reset_authority,
                            )

                            with run_environment(gate_env):
                                execute_stage(
                                    execution, "fixture-launch-authority",
                                    require_station_reset_authority,
                                    gate_env["PT_MACHINE_LEASE_RESET_SCOPE"],
                                )
                            inherited_fds = (int(gate_env["PT_MACHINE_LEASE_FD"]),)
                        if "argv" in gate or execution is not None or inherited_fds:
                            from tooling.acceptance.core import (
                                GateLaunchSpec,
                                GateProcessLauncher,
                            )

                            launcher = GateProcessLauncher(
                                cwd=str(REPO_ROOT),
                                environment=gate_env,
                                termination_timeout_seconds=(
                                    min(1, execution.budget.cleanup_seconds / 4)
                                    if execution else 5
                                ),
                                pass_fds=inherited_fds,
                            )

                            def capture_gate_output(stdout: str, stderr: str) -> None:
                                nonlocal output_text, gate_process_cleanup_status
                                output_text = stdout + stderr
                                gate_process_cleanup_status = "passed"

                            completed = launcher.run(
                                GateLaunchSpec(
                                    argv=(
                                        tuple(gate["argv"]) if "argv" in gate
                                        else ("sh", "-c", command)
                                    ),
                                    timeout_seconds=timeout,
                                    required_capabilities=tuple(
                                        gate.get("ephemeralCapabilities", ())
                                    ),
                                ),
                                launch_binding,
                                capture_output=capture_gate_output,
                                **({
                                    "work_scope": lambda: execution.stage(
                                        "command", timeout_seconds=timeout,
                                    ),
                                    "cleanup_scope": lambda: execution.stage(
                                        "command-process-cleanup", phase="cleanup",
                                    ),
                                } if execution is not None else {}),
                            )
                            gate_process_cleanup_status = "passed"
                        else:
                            completed = subprocess.run(
                                command,
                                shell=True,
                                text=True,
                                encoding="utf-8",
                                errors="replace",
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
                            stdout.decode("utf-8", errors="replace")
                            if isinstance(stdout, bytes)
                            else stdout
                        ) + (
                            stderr.decode("utf-8", errors="replace")
                            if isinstance(stderr, bytes)
                            else stderr
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
                        if timed_out and execution is not None:
                            execution.overrun = execution.overrun or {
                                "stage": "command", "phase": "work"
                            }
                            cause = error.__cause__
                            if isinstance(cause, subprocess.TimeoutExpired):
                                stdout = cause.stdout or b""
                                stderr = cause.stderr or b""
                                output_text += (
                                    stdout.decode("utf-8", errors="replace")
                                    if isinstance(stdout, bytes) else stdout
                                ) + (
                                    stderr.decode("utf-8", errors="replace")
                                    if isinstance(stderr, bytes) else stderr
                                )
                        if isinstance(error, EphemeralLaunchCleanupFailed):
                            gate_process_cleanup_status = "failed"
                            gate_process_cleanup_error = str(error)
                        elif timed_out:
                            gate_process_cleanup_status = "passed"
                        output_text += (
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
                        if execution is not None and not gate.get("ephemeralCapabilities"):
                            result.update({
                                "status": "failed",
                                "completionStatus": "PARTIAL",
                                "proofStatus": "UNPROVEN",
                                "sourcePhase": "Gate Command",
                                "sourceBom": ["acceptance-execution"],
                                "sourceSpec": ["execution-budget"],
                                "sourceGate": "Selected Gate command must terminate within its lifecycle budget",
                            })
            except KeyboardInterrupt:
                owner_interrupted = True
                output_text += "\nGate interrupted by owner (SIGINT)\n"
                result = {
                    "id": gate_id,
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "reason": "OWNER_INTERRUPTED",
                    "errorType": "KeyboardInterrupt",
                    "timedOut": False,
                    "sampleEmissionAllowed": False,
                    "sourcePhase": "Gate Owner Cancellation",
                }
            except ExecutionDeadline as error:
                timed_out = True
                output_text += f"\n{error}\n"
                administrative = (
                    error.phase == "work"
                    and [item.get("kind") for item in error.constraints] == ["request-work"]
                )
                result = {
                    "id": gate_id,
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "reason": "finite request quota exhausted; Gate completion remains unproven"
                    if administrative else str(error),
                    "timedOut": True,
                    "sampleEmissionAllowed": False,
                    "sourcePhase": f"Gate {error.phase}: {error.stage}",
                }
                from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic

                diagnostic = getattr(error, "diagnostic", None)
                resource = getattr(error, "resource", "") or f"gate-budget:{gate_id}"
                if diagnostic is None:
                    diagnostic = ResourceDiagnostic(
                        owner="tooling/acceptance/core/execution_budget.py",
                        recovery_action=(
                            "Revalidate original proof and restart incomplete work in a new bounded request"
                            if administrative else
                            f"Diagnose the recorded {error.stage} stage at its owner; "
                            "repair and qualify it, then refreeze the unchanged scope "
                            "and policy. Do not increase the budget."
                        ),
                        resource_checks=[{
                            "resource": resource,
                            "expected": execution.budget.to_dict(),
                            "state": "OBSERVED",
                            "observed": execution.report(),
                        }],
                    )
                result["blockedResource"] = resource
                result["diagnostic"] = diagnostic.to_dict()
            finally:
                if execution is not None:
                    execution.enter_phase("cleanup")
                if launch_context is not None:
                    try:
                        execute_stage(
                            execution, "launch-quiesce", launch_context.quiesce,
                            phase="cleanup",
                        )
                        launch_context_quiesce_status = "passed"
                    except (Exception, ExecutionDeadline) as error:
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
                                execute_stage(
                                    execution, "runtime-cell-stop", runtime_cell_lifecycle.stop,
                                    phase="cleanup",
                                )
                            )
                        runtime_cell_cleanup_status = "passed"
                    except (Exception, ExecutionDeadline) as error:
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
                        with run_environment(gate_run.subprocess_environment(gate_env)):
                            cleanup_completed_resources = execute_stage(
                                execution, "environment-cleanup", provisioner.cleanup,
                                phase="cleanup",
                            )
                        environment_cleanup_status = "passed"
                    except (Exception, ExecutionDeadline) as error:
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
                        close_result = execute_stage(
                            execution, "launch-close", launch_context.close,
                            phase="cleanup",
                        )
                        launch_context_cleanup = ephemeral_cleanup_payload(
                            close_result
                        )
                        launch_context_close_status = "passed"
                    except (Exception, ExecutionDeadline) as error:
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
                        provisioning_process_cleanup["error"] if provisioning_process_cleanup else "",
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
                or provisioning_process_cleanup is not None
            ):
                cleanup_artifact = execute_stage(
                    execution, "cleanup-artifact", persist_provisioner_cleanup_result,
                    phase="publish",
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
                    provisioning_process_cleanup=provisioning_process_cleanup,
                )

            source_drift_after = source_identity_drift(
                aggregate_source,
                execute_stage(
                    execution, "source-revalidate", source_identity, REPO_ROOT,
                    phase="publish",
                ),
            )
            if source_drift_after is not None:
                source_drift = source_drift or source_drift_after
                output_text += (
                    "\nAcceptance source drifted during aggregate execution; "
                    "the Gate cannot contribute exact-source proof.\n"
                )
            if (
                gate_input_identity is not None
                and gate_input_identity["reuseEligible"]
                and (exit_code == 0 or (result or {}).get("status") == "passed")
                and source_drift is None
                and cleanup_status != "failed"
            ):
                try:
                    input_inventory = execute_stage(
                        execution, "input-inventory-revalidate", gate_run.collect_existing_artifacts,
                        phase="publish",
                    )
                    execute_stage(
                        execution, "input-artifacts-revalidate", validate_input_artifacts,
                        gate, gate_input_artifacts, store, input_inventory,
                        prerequisite_refs, phase="publish",
                    )
                    current_inputs = gate_execution_identity(
                        gate, graph, policy, context_identity,
                        probe_context=probe_context, execution=execution,
                        stage="input-revalidate", phase="publish",
                        input_artifacts=gate_input_artifacts,
                        input_artifacts_ref=gate_input_artifacts_ref, store=store,
                    )
                    if current_inputs != gate_input_identity:
                        input_identity_error = "Gate inputs changed during execution"
                except InputIdentityError as error:
                    input_identity_error = str(error)
                    if isinstance(error, InputIdentityProbeFailed):
                        input_owner_failure = error.failure
                except InputIdentityCleanupFailed as error:
                    cleanup_status = "failed"
                    cleanup_error = gate_process_cleanup_error = str(error)
                    gate_process_cleanup_status = "failed"
                    result = ephemeral_launch_failure_result(
                        gate_id=gate_id, command=command, environment=environment,
                        tier=tier, error=error,
                        duration_seconds=round(time.time() - started, 3),
                    )
                    cleanup_artifact = execute_stage(
                        execution, "input-owner-cleanup-artifact", gate_run.write_json,
                        "cleanup/input-owner.json", {
                            "artifactKind": "acceptance-input-owner-cleanup",
                            "gateId": gate_id, "ownerId": error.owner_id,
                            "status": "failed", "errorType": type(error).__name__,
                            "cleanup": ephemeral_cleanup_payload(error.result),
                        }, role="input-owner-cleanup", phase="publish",
                    ).to_dict()
            if session is not None:
                execute_stage(
                    execution, "execution-identity", gate_run.write_json,
                    "proof/execution-identity.json",
                    gate_input_identity or input_execution_identity(
                        gate, graph, policy, context_identity, os.environ,
                    ),
                    role="execution-identity", phase="publish",
                )

            (
                log_ref,
                redacted_artifacts,
                leaked_artifacts,
            ) = execute_stage(
                execution, "evidence-scan", finalize_runtime_log,
                gate_run,
                gate_id,
                output_text,
                runtime_secrets,
                phase="publish",
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
                result.pop("diagnostic", None)
                for field in ("blockedReason", "blockedResource", "sourceArtifact"):
                    result.pop(field, None)
                result["reason"] = cleanup_error
                result["cleanupError"] = cleanup_error
                result["status"] = "failed"
                result["completionStatus"] = "PARTIAL"
                result["proofStatus"] = "UNPROVEN"
                result["sourcePhase"] = "Gate Resource Cleanup"
                if provisioning_process_cleanup:
                    result["errorType"] = provisioning_process_cleanup["errorType"]
                    result["sourcePhase"] = "Provisioning Process Cleanup"
                elif gate_process_cleanup_error:
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
            if input_identity_error is not None:
                result.update({
                    "status": "failed", "completionStatus": "PARTIAL", "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False, "reason": input_identity_error,
                    "inputIdentityStatus": "UNPROVEN",
                })
                if input_owner_failure is not None:
                    result["inputOwnerFailure"] = execute_stage(
                        execution, "input-owner-failure-artifact", gate_run.write_json,
                        "reports/input-owner-failure.json", input_owner_failure,
                        role="input-owner-failure", phase="publish",
                    ).to_dict()
                    result["errorType"] = input_owner_failure["errorType"]
            result["prerequisiteProofs"] = prerequisite_refs
            if execution is not None:
                result["limitDisposition"] = execution.limit_disposition()
                result["timeoutAttribution"] = execution.report()["attribution"]

            result = execute_stage(
                execution, "failure-observation", record_failure_observation,
                result, gate_run, phase="publish",
            )
            result = execute_stage(
                execution, "evidence-read", enrich_result_with_run_artifacts,
                result, gate_run, phase="publish",
            )
            if candidate_artifacts_required(
                result,
                candidate_mode=candidate_mode,
            ):
                contract = load_agent_v2_contract()
                emit_agent_v2_candidate_metadata(
                    gate_run,
                    gate_id,
                    source_identity(REPO_ROOT),
                )
                artifacts = gate_run.collect_existing_artifacts()
                missing_roles = sorted(
                    set(contract["gates"][gate_id]["roles"])
                    - set(artifacts)
                )
                if missing_roles:
                    result["status"] = "failed"
                    result["completionStatus"] = "PARTIAL"
                    result["proofStatus"] = "UNPROVEN"
                    result["reason"] = (
                        "candidate is missing mandatory artifact roles: "
                        + ", ".join(missing_roles)
                    )
            finalized_runtime = dict(manifest or {})
            if runtime_cell_manifest:
                finalized_runtime["runtimeCellManifest"] = (
                    runtime_cell_manifest
                )
            if args.execution_policy == "development":
                result = execute_stage(
                    execution, "result-finalize", record_development_result,
                    result,
                    gate_run,
                    plan_source,
                    str(args.work_item),
                    finalized_runtime,
                    runtime_cell or None,
                    runtime_secrets,
                    phase="publish",
                )
            else:
                result = execute_stage(
                    execution, "result-finalize", finalize_gate_result,
                    result,
                    gate_run,
                    plan_source,
                    finalized_runtime,
                    runtime_cell or None,
                    runtime_secrets,
                    candidate_mode=candidate_mode,
                    phase="publish",
                )
                result["runManifest"] = gate_run.manifest_ref.to_dict()
                if candidate_mode and result.get("status") == "passed":
                    candidate_manifest_ref = gate_run.manifest_ref
            gate_run.close()
            active_gate_run = None
            results.append(result)
            if execution is not None:
                cost = execution.report()
                execution_reports.append(cost)
                execute_stage(
                    execution, "cost-persist", aggregate_run.write_json,
                    f"reports/execution/{gate_id}.json", {
                        **cost,
                        "measurementBoundary": "before-cost-publication",
                        "terminalCostOwner": "aggregate executionBudget.gates or execution-stop",
                    },
                    role=f"execution-cost:{gate_id}",
                    phase="publish",
                )
                execution.finish()
                cost = execution.report()
                execution_reports[-1] = cost
                if owner_interrupted:
                    execution_stop = {
                        "gateId": gate_id,
                        "reason": "OWNER_INTERRUPTED",
                        "cost": cost,
                        "source": aggregate_source,
                        "policyDigest": policy.identity,
                        "resumePolicy": "inspect recorded cleanup and qualify before a new attempt",
                    }
                elif cost["state"] == "OVER_BUDGET":
                    execution_stop = {
                        "gateId": gate_id,
                        "reason": "EXECUTION_BUDGET_STOP",
                        "cost": cost,
                        "source": aggregate_source,
                        "policyDigest": policy.identity,
                        "resumePolicy": "new attempt; revalidate source, scope and owned resources",
                    }
                elif source_drift is not None:
                    execution_stop = {
                        "gateId": gate_id,
                        "reason": "SOURCE_IDENTITY_STOP",
                        "cost": cost,
                        "source": aggregate_source,
                        "sourceDrift": source_drift,
                        "policyDigest": policy.identity,
                        "resumePolicy": "freeze the current source before a new attempt",
                    }
                elif result.get("cleanupStatus") == "failed" or (
                    args.stop_on_failure and result_is_incomplete(result)
                ):
                    execution_stop = {
                        "gateId": gate_id,
                        "reason": "EXECUTION_FAILURE_STOP",
                        "cost": cost,
                        "source": aggregate_source,
                        "policyDigest": policy.identity,
                        "resumePolicy": "diagnose and repair before a new attempt",
                    }
            elif owner_interrupted or result.get("cleanupStatus") == "failed":
                execution_stop = {
                    "gateId": gate_id,
                    "reason": "OWNER_INTERRUPTED" if owner_interrupted else "EXECUTION_FAILURE_STOP",
                    "source": aggregate_source,
                    "resumePolicy": "inspect recorded cleanup and qualify before a new attempt",
                }
            print(
                f"[{str(result.get('status')).upper()}] {gate_id} "
                f"duration={duration}s run={gate_run.run_id}"
            )
            if execution_stop is not None:
                results.extend(stopped_results(
                    gates, {item["id"] for item in results}, execution_stop
                ))
                break

        by_id = {item["id"]: item for item in results}
        results = [by_id[gate["id"]] for gate in gates]
        report = build_run_report(
            plan_source,
            results,
            candidate_mode=candidate_mode,
            source=aggregate_source,
            execution_policy=args.execution_policy,
        )
        report["executionGraph"] = {
            "artifact": graph_ref.to_dict(), "digest": graph["digest"],
            "efficiency": efficiency_report(graph, execution_reports),
        }
        report["e2ePreflight"] = {
            "artifact": preflight_ref.to_dict(), "digest": e2e_preflight["digest"],
            "proofStatus": "UNPROVEN",
        }
        if policy is not None:
            report["executionBudget"] = {
                "policyDigest": policy.identity,
                "requestDurationSeconds": round(time.monotonic() - request_started, 6),
                "measurementBoundary": "before-aggregate-publication; terminal wall cost is emitted after handle cleanup",
                "planning": planning.report(),
                "validation": session_validation.report() if session_validation else None,
                "gates": execution_reports,
                "stop": execution_stop,
                "selectedGateCount": len(gates),
                "dispatchedGateCount": len(started_gate_ids),
            }
        if session is not None:
            report["executionSession"] = {
                "sessionId": session.session_id,
                "request": len(session.requests),
                "requiredGateIds": list(session.required_gate_ids),
                "dispatchGateIds": list(session.requests[-1]["dispatchGateIds"]),
                "validatedGateIds": list(session.requests[-1]["validatedGateIds"]),
                "validation": reuse_validation,
                "priorManifest": prior_manifest_ref.to_dict() if prior_manifest_ref else None,
                "historicalRequests": [
                    {"request": item["request"], "report": item["report"]}
                    for item in session.requests[:-1]
                ],
            }
        publication = (
            GateExecution(
                "aggregate-publication", GateTimeLimits(1, 1, work_seconds=18),
                time.monotonic() + 20,
            ) if policy else None
        )
        run_ref = execute_stage(
            publication, "report-json", aggregate_run.write_json,
            "reports/run.json",
            report,
            role="run",
        )
        if session is not None:
            session.observe(report, run_ref.to_dict())
            session_ref = execute_stage(
                publication, "session-ledger", aggregate_run.write_json,
                "reports/session.json", session.report(), role="execution-session",
            )
            print(f"execution-session: {json.dumps(session_ref.to_dict(), sort_keys=True)}")
        execute_stage(
            publication, "report-markdown", aggregate_run.write_bytes,
            "reports/run.md",
            render_markdown(report).encode("utf-8"),
            media_type="text/markdown",
            role="run-markdown",
        )
        development_manifest_ref = None
        if args.execution_policy == "acceptance":
            execute_stage(
                publication, "aggregate-finalize", aggregate_run.finalize,
                result={
                    "status": (
                        "passed"
                        if acceptance_exit_code(
                            report,
                            candidate_mode=candidate_mode,
                        )
                        == 0
                        else "failed"
                    ),
                    "completionStatus": report.get("completionStatus"),
                    "proofStatus": report.get("proofStatus"),
                },
                runtime={"plan": plan_source},
            )
            execute_stage(publication, "aggregate-publish", aggregate_run.publish_latest)
            session_terminal_ref = aggregate_run.manifest_ref
            if session is not None:
                print(f"execution-session-manifest: {json.dumps(session_terminal_ref.to_dict(), sort_keys=True)}")
        elif args.development_manifest_out:
            development_manifest_ref = finalize_development_run(
                report,
                aggregate_run,
                run_ref,
                plan,
                plan_source,
                str(args.work_item),
                str(args.development_journey_id),
            )
        else:
            aggregate_run.finalize(
                result={
                    "status": (
                        "passed"
                        if development_exit_code(report) == 0
                        else "failed"
                    ),
                    "completionStatus": report.get("completionStatus"),
                    "proofStatus": report.get("proofStatus"),
                    "workItemId": str(args.work_item),
                },
                runtime={"plan": plan_source},
            )
        print(f"run: {json.dumps(run_ref.to_dict(), sort_keys=True)}")
        exit_code = (
            development_exit_code(report)
            if args.execution_policy == "development"
            else acceptance_exit_code(
                report,
                candidate_mode=candidate_mode,
            )
        )
        if execution_stop is not None:
            exit_code = exit_code or 1
        if candidate_mode:
            if exit_code != 0 or candidate_manifest_ref is None:
                return exit_code or 1
            write_explicit_json(
                args.candidate_ref_out,
                candidate_manifest_ref.to_dict(),
            )
            from tooling.acceptance.core import validate_external_output_path

            sha_path = validate_external_output_path(
                args.candidate_manifest_sha_out,
                repo_root=REPO_ROOT,
            )
            sha_path.parent.mkdir(parents=True, exist_ok=True)
            sha_path.write_text(
                candidate_manifest_ref.sha256 + "\n",
                encoding="utf-8",
            )
        if (
            args.execution_policy == "development"
            and development_manifest_ref is not None
        ):
            write_explicit_json(
                str(args.development_manifest_out),
                development_manifest_ref.to_dict(),
            )
        return exit_code
    except (ExecutionDeadline, ExecutionBudgetError, InputIdentityCleanupFailed, KeyboardInterrupt) as error:
        if policy is None:
            print(f"Acceptance execution failed: {type(error).__name__}: {error}", file=sys.stderr)
            return 1
        failed_execution = (
            publication if isinstance(publication, GateExecution)
            else execution if isinstance(execution, GateExecution) else preparation_owner
        )
        cost = failed_execution.report()
        dispatched_ids = started_gate_ids
        stop = {
            "artifactKind": "acceptance-execution-stop",
            "reason": (
                "INPUT_OWNER_CLEANUP_STOP" if isinstance(error, InputIdentityCleanupFailed) else
                "OWNER_INTERRUPTED" if isinstance(error, KeyboardInterrupt) else
                "EXECUTION_BUDGET_STOP"
                if isinstance(error, ExecutionDeadline) or cost["overrun"]
                else "EXECUTION_POLICY_STOP"
            ),
            "gateId": cost["gateId"],
            "cost": cost,
            "source": aggregate_source,
            "scopeDigest": scope["digest"] if scope else None,
            "policyDigest": policy.identity if policy else None,
            "dispatchedGateIds": sorted(dispatched_ids),
            "recordedGateResultIds": [
                item["id"] for item in results if item["id"] in dispatched_ids
            ],
            "unexecutedGateIds": [
                gate["id"] for gate in gates
                if gate["id"] not in dispatched_ids
            ],
            "firstOverrun": execution_stop,
            "proofStatus": "UNPROVEN",
            "resourceCleanup": "UNPROVEN; inspect current run before resuming",
            "failure": type(error).__name__,
        }
        if isinstance(error, InputIdentityCleanupFailed):
            stop.update(
                resourceCleanup="failed",
                inputOwner={"gateId": error.gate_id, "ownerId": error.owner_id},
                inputOwnerCleanup=ephemeral_cleanup_payload(error.result),
            )
        interrupted_results = list(results)
        recorded_ids = {item["id"] for item in results}
        if cost["gateId"] in dispatched_ids - recorded_ids:
            interrupted_results.append({
                "id": cost["gateId"],
                "status": "failed",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "duration_seconds": cost["durationSeconds"],
                "reason": "execution interrupted before result publication",
                "errorType": type(error).__name__,
                "timedOut": isinstance(error, ExecutionDeadline),
                "sampleEmissionAllowed": False,
            })
        terminal_results = interrupted_results + stopped_results(
            gates, {item["id"] for item in interrupted_results}, stop,
        )
        if isinstance(error, InputIdentityCleanupFailed):
            for result in terminal_results:
                if result["id"] == error.gate_id:
                    result.update(
                        status="failed", completionStatus="PARTIAL", proofStatus="UNPROVEN",
                        cleanupStatus="failed", reason="input owner process cleanup failed",
                        errorType=type(error).__name__,
                    )
        # A publication failure must not mutate an already sealed Gate run.
        # The independent diagnostic is supporting evidence, never product proof.
        from tooling.acceptance.core.execution_budget import deadline
        try:
            with deadline(5, ExecutionDeadline("stop-record", "publish", "publish")):
                diagnostic = store.begin_run("acceptance-execution-stop", source=aggregate_source)
                try:
                    ref = diagnostic.write_json("reports/stop.json", stop, role="execution-stop")
                    report = build_run_report(
                        plan_source, terminal_results,
                        candidate_mode=candidate_mode,
                        source=aggregate_source,
                        execution_policy=args.execution_policy,
                    )
                    report.update(
                        completionStatus="PARTIAL",
                        proofStatus="UNPROVEN",
                        sampleEmissionAllowed=False,
                    )
                    report["terminalObservation"] = ref.to_dict()
                    report["executionBudget"] = {
                        "policyDigest": policy.identity,
                        "requestDurationSeconds": round(time.monotonic() - request_started, 6),
                        "measurementBoundary": "before-stop-publication; terminal wall cost is emitted after handle cleanup",
                        "planning": planning.report(),
                        "validation": session_validation.report() if session_validation else None,
                        "gates": [
                            *[item for item in execution_reports if item["gateId"] != cost["gateId"]],
                            *([cost] if cost["gateId"] in dispatched_ids else []),
                        ],
                        "stop": stop,
                        "selectedGateCount": len(gates),
                        "dispatchedGateCount": len(dispatched_ids),
                    }
                    if graph_ref is not None:
                        report["executionGraph"] = {
                            "artifact": graph_ref.to_dict(), "digest": graph["digest"],
                            "efficiency": efficiency_report(graph, report["executionBudget"]["gates"]),
                        }
                    run_ref = diagnostic.write_json("reports/run.json", report, role="run")
                    diagnostic_session_ref = None
                    if session is not None and session.state == "RUNNING":
                        session.observe(report, run_ref.to_dict())
                        diagnostic_session_ref = diagnostic.write_json(
                            "reports/session.json", session.report(), role="execution-session",
                        )
                    diagnostic.finalize(result={
                        "status": "failed", "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                    })
                    diagnostic.publish_latest()
                    session_terminal_ref = diagnostic.manifest_ref
                    if diagnostic_session_ref is not None:
                        print(f"execution-session-manifest: {json.dumps(session_terminal_ref.to_dict(), sort_keys=True)}")
                    print(f"execution-stop: {json.dumps(ref.to_dict(), sort_keys=True)}")
                    print(f"run: {json.dumps(run_ref.to_dict(), sort_keys=True)}")
                finally:
                    diagnostic.close()
        except (Exception, ExecutionDeadline):
            print("Execution stopped; durable stop-record publication failed", file=sys.stderr)
        return 1
    except EvidenceError as error:
        print(
            f"Acceptance evidence failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1
    finally:
        if policy is not None:
            from tooling.acceptance.core.execution_budget import deadline
            if publication is not None:
                publication.finish()
            handle_cleanup_status = "passed"
            session_commit_status = "not-required"
            handles_closed = False
            try:
                with deadline(2, ExecutionDeadline("handles", "close", "cleanup")):
                    if active_gate_run is not None:
                        active_gate_run.close()
                    aggregate_run.close()
                    handles_closed = True
                    if request_claim is not None and session_terminal_ref is not None:
                        session_commit_status = "failed"
                        store.read_run_manifest(
                            session_terminal_ref, manifest_sha256=session_terminal_ref.sha256,
                        )
                        request_claim.complete(session_terminal_ref)
                        session_commit_status = "passed"
            except ExecutionDeadline:
                if not handles_closed:
                    handle_cleanup_status = "failed"
                print("Evidence handle cleanup or session commit exceeded the reserved tail", file=sys.stderr)
            except EvidenceError as error:
                if handles_closed:
                    session_commit_status = "failed"
                else:
                    handle_cleanup_status = "failed"
                print(f"Execution session terminal commit failed: {type(error).__name__}", file=sys.stderr)
            finally:
                if request_claim is not None:
                    request_claim.close()
            print("execution-wall-cost: " + json.dumps({
                "runId": getattr(aggregate_run, "run_id", None),
                "requestDurationSeconds": round(time.monotonic() - request_started, 6),
                "requestWorkLimitSeconds": policy.request_seconds,
                "measurementBoundary": "after-terminal-publication-and-handle-cleanup-attempt",
                "handleCleanupStatus": handle_cleanup_status,
                "sessionCommitStatus": session_commit_status,
                "aggregatePublication": publication.report() if publication is not None else None,
                "performanceStatus": "UNPROVEN",
                "productProof": "runner-owned",
            }, sort_keys=True), file=sys.stderr)
            if handle_cleanup_status == "failed" or session_commit_status == "failed":
                return 1
        else:
            if active_gate_run is not None:
                active_gate_run.close()
            aggregate_run.close()


if __name__ == "__main__":
    with runner_operation_stream():
        raise SystemExit(main())
