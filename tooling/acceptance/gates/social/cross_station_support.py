"""Shared fail-closed support for the CSS-09 Social Gate lane."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shlex
import subprocess
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    ProvisioningError,
    RuntimeReuseContract,
    validate_suite_runtime_report,
)
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore, source_identity
from tooling.acceptance.core.execution_graph import prerequisite_results
from tooling.development.secure_content.prepared_native import CLIENT_BINDINGS


REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE_ARTIFACT_KIND = "social-cross-station-suite-result"
SUITE_SCHEMA_VERSION = 1
SCENARIO_IDS = (
    "AS17",
    "AS18",
    "AS19",
    "AS20",
    "AS21",
    "AS22",
    "AS23",
    "AS24",
    "same-station-regression",
)
SERVICE_IDS = ("station-four", "station-five-arm")
LAUNCHED_CLIENTS = ("alice", "bob", "bob2")
FIXTURE_ONLY_CLIENTS = ("eve",)
SUITE_RESULT_FIELDS = frozenset(
    {
        "artifactKind",
        "schemaVersion",
        "status",
        "proofState",
        "controlCommit",
        "sourceCommit",
        "workspaceId",
        "worktreeSetDigest",
        "runId",
        "fixtureEpoch",
        "source",
        "provisioningRunId",
        "schemaInventory",
        "runtimeManifest",
        "scenarioResults",
        "suiteRuntimeReport",
        "suiteRuntimeReportDigest",
        "supportingArtifacts",
        "resourceReuse",
        "cleanup",
        "resultDigest",
    }
)
SUITE_RUNTIME_MANIFEST_FIELDS = frozenset(
    {
        "artifactKind",
        "schemaVersion",
        "state",
        "cleanupState",
        "runId",
        "provisioningRunId",
        "workspaceId",
        "sourceCommit",
        "controlCommit",
        "worktreeSetDigest",
        "profileBindings",
        "serviceRuntimeIdentityDigests",
        "clientBindings",
        "fixtureEpoch",
        "scenarioManifestDigests",
        "suiteRuntimeReportDigest",
    }
)
EXPECTED_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "focused-social-suite",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 3,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
COMMIT = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
WORKSPACE_ID = re.compile(r"^[0-9a-f]{16}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
NODE_TEST_OUTPUT_PATTERN = r"^(?:# Subtest:|ℹ tests [1-9][0-9]*)"


@dataclass(frozen=True)
class SourceCommand:
    """One fixed source command and its evidence requirements."""

    name: str
    argv: tuple[str, ...]
    cwd: str = "."
    timeout_seconds: int = 600
    required_output_pattern: str = ""


@dataclass(frozen=True)
class ValidatedSuiteResult:
    """Validated immutable CSS-09 result and its attached files."""

    path: Path
    payload: dict[str, Any]
    suite_runtime_path: Path
    suite_runtime_report: dict[str, Any]
    supporting_artifacts: tuple[Path, ...]
    producer_manifest: dict[str, Any] | None = None
    result_ref: dict[str, Any] | None = None


def canonical_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def run_source_commands(
    gate: AcceptanceGate,
    commands: Sequence[SourceCommand],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> list[dict[str, object]]:
    """Run fixed source commands and attach a log before judging each result."""

    invoke = subprocess.run if runner is None else runner
    results: list[dict[str, object]] = []
    for command in commands:
        if (
            not IDENTIFIER.fullmatch(command.name)
            or not command.argv
            or command.timeout_seconds <= 0
        ):
            raise GateError(f"invalid source command declaration: {command.name!r}")
        cwd = (REPO_ROOT / command.cwd).resolve()
        try:
            cwd.relative_to(REPO_ROOT.resolve())
        except ValueError as error:
            raise GateError(
                f"source command {command.name!r} escapes the repository"
            ) from error
        if not cwd.is_dir():
            raise GateError(
                f"source command {command.name!r} cwd is unavailable: {command.cwd}"
            )

        returncode = -1
        stdout = ""
        stderr = ""
        failure: str | None = None
        try:
            completed = invoke(
                list(command.argv),
                cwd=cwd,
                text=True,
                capture_output=True,
                timeout=command.timeout_seconds,
                check=False,
            )
            returncode = completed.returncode
            stdout = _text(completed.stdout)
            stderr = _text(completed.stderr)
        except subprocess.TimeoutExpired as error:
            stdout = _text(error.stdout)
            stderr = _text(error.stderr)
            failure = (
                f"timed out after {command.timeout_seconds} seconds"
            )
        except OSError as error:
            failure = f"could not start: {error}"

        combined = stdout + stderr
        searchable_output = ANSI_ESCAPE.sub("", combined)
        if failure is None and returncode != 0:
            failure = f"exited with status {returncode}"
        if (
            failure is None
            and command.required_output_pattern
            and re.search(
                command.required_output_pattern,
                searchable_output,
                flags=re.MULTILINE,
            )
            is None
        ):
            failure = "did not execute any required focused test"

        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=f"social-{command.name}-",
            suffix=".log",
            delete=False,
        ) as output:
            output.write(f"$ {shlex.join(command.argv)}\n")
            output.write(f"cwd: {command.cwd}\n")
            output.write(f"returncode: {returncode}\n")
            if failure:
                output.write(f"failure: {failure}\n")
            output.write("\n[stdout]\n")
            output.write(stdout)
            output.write("\n[stderr]\n")
            output.write(stderr)
            log_path = Path(output.name)
        try:
            gate.report.add_evidence_file(f"{command.name}-log", log_path)
        finally:
            log_path.unlink(missing_ok=True)

        if failure:
            detail = combined[-4000:].strip()
            suffix = f": {detail}" if detail else ""
            raise GateError(
                f"source command {command.name!r} {failure}{suffix}"
            )
        gate.assert_condition(
            command.name,
            True,
            f"completed in {command.cwd}",
        )
        results.append(
            {
                "name": command.name,
                "argv": list(command.argv),
                "cwd": command.cwd,
                "returncode": returncode,
            }
        )
    return results


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(f"{label} is not valid JSON: {path}") from error
    if not isinstance(payload, dict):
        raise GateError(f"{label} must contain a JSON object")
    return payload


def _require_string(
    value: object,
    label: str,
    *,
    pattern: re.Pattern[str] | None = None,
) -> str:
    if not isinstance(value, str) or not value:
        raise GateError(f"{label} must be a non-empty string")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise GateError(f"{label} has an invalid format")
    return value


def _first_string(
    value: Mapping[str, Any],
    names: Sequence[str],
) -> str:
    for name in names:
        candidate = value.get(name)
        if isinstance(candidate, str) and candidate:
            return candidate
    return ""


def _validate_embedded_runtime_manifest(
    manifest: object,
    *,
    source_commit: str,
    control_commit: str,
    workspace: str,
    worktree_set_digest: str,
    run_id: str,
    provisioning_run_id: str,
    fixture_epoch: str,
    suite_runtime_report_digest: str,
) -> dict[str, Any]:
    if (
        not isinstance(manifest, Mapping)
        or set(manifest) != SUITE_RUNTIME_MANIFEST_FIELDS
        or manifest.get("artifactKind")
        != "social-cross-station-suite-runtime-manifest"
        or manifest.get("schemaVersion") != 1
        or manifest.get("state") != "FIXTURE_READY"
        or manifest.get("cleanupState") != "CLEANED"
    ):
        raise GateError("CSS-09 runtime manifest must be a non-empty object")

    expected_identity = {
        "runId": run_id,
        "provisioningRunId": provisioning_run_id,
        "workspaceId": workspace,
        "sourceCommit": source_commit,
        "controlCommit": control_commit,
        "worktreeSetDigest": worktree_set_digest,
        "fixtureEpoch": fixture_epoch,
        "suiteRuntimeReportDigest": suite_runtime_report_digest,
    }
    if any(manifest.get(key) != value for key, value in expected_identity.items()):
        raise GateError("CSS-09 runtime source/run identity is inconsistent")
    profiles = manifest.get("profileBindings")
    if (not isinstance(profiles, Mapping) or len(profiles) != 2
        or set(profiles.values()) != set(SERVICE_IDS)
        or any(not isinstance(profile, str) or not profile for profile in profiles)):
        raise GateError("CSS-09 runtime profile bindings are incomplete")
    role_profiles = {role: profile for profile, role in profiles.items()}
    service_identities = manifest.get("serviceRuntimeIdentityDigests")
    if (
        not isinstance(service_identities, Mapping)
        or set(service_identities) != set(SERVICE_IDS)
        or any(
            SHA256.fullmatch(str(digest)) is None
            for digest in service_identities.values()
        )
    ):
        raise GateError("CSS-09 runtime service identities are invalid")

    client_bindings = manifest.get("clientBindings")
    if (
        not isinstance(client_bindings, Sequence)
        or isinstance(client_bindings, (str, bytes))
    ):
        raise GateError("CSS-09 runtime client bindings are missing")
    expected_clients = {
        client_id: {
            "clientId": client_id,
            "actorRole": actor,
            "profileId": role_profiles[service_id],
            "serviceId": service_id,
            "launched": client_id in LAUNCHED_CLIENTS,
        }
        for client_id, (actor, service_id) in CLIENT_BINDINGS.items()
    }
    actual_clients = {
        str(binding.get("clientId") or ""): dict(binding)
        for binding in client_bindings
        if isinstance(binding, Mapping)
    }
    if (
        len(actual_clients) != len(client_bindings)
        or actual_clients != expected_clients
    ):
        raise GateError("CSS-09 runtime client identities/bindings are invalid")

    scenario_manifest_digests = manifest.get("scenarioManifestDigests")
    if (
        not isinstance(scenario_manifest_digests, Mapping)
        or set(scenario_manifest_digests) != {"initial", "replacement"}
        or any(
            SHA256.fullmatch(str(digest)) is None
            for digest in scenario_manifest_digests.values()
        )
    ):
        raise GateError("CSS-09 runtime manifest lineage is incomplete")
    return dict(manifest)


def _validate_resource_reuse(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError("CSS-09 resource reuse evidence is missing")
    integer_fields = {
        "provisioningRuns": 1,
        "clientLaunches": 3,
        "stationBuilds": 0,
        "stationDeployments": 0,
        "desktopBuilds": 0,
        "newAccountRegistrations": 0,
    }
    for field, expected in integer_fields.items():
        actual = value.get(field)
        if isinstance(actual, bool) or actual != expected:
            raise GateError(
                f"CSS-09 resource reuse {field} must equal {expected}"
            )
    concurrent = value.get("maxConcurrentNativeClients")
    if (
        isinstance(concurrent, bool)
        or not isinstance(concurrent, int)
        or concurrent < 1
        or concurrent > 2
    ):
        raise GateError(
            "CSS-09 resource reuse exceeds two concurrent Native clients"
        )
    replacements = value.get("clientReplacements")
    fixture_only = value.get("fixtureOnlyClients")
    if replacements != ["bob2"]:
        raise GateError("CSS-09 Bob2 must be the sole client replacement")
    if fixture_only != ["eve"]:
        raise GateError("CSS-09 Eve must remain fixture-only")
    return dict(value)


def _artifact_path_value(value: object, label: str) -> tuple[str, Mapping[str, Any]]:
    if isinstance(value, str):
        return _require_string(value, label), {}
    if isinstance(value, Mapping):
        return _require_string(value.get("path"), f"{label}.path"), value
    raise GateError(f"{label} must be a path string or artifact reference")


def _resolve_artifact(
    value: object,
    *,
    label: str,
    result_path: Path,
    artifact_root: Path,
) -> tuple[Path, set[str]]:
    raw_path, reference = _artifact_path_value(value, label)
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = result_path.parent / candidate
    if candidate.is_symlink() or not candidate.is_file():
        raise GateError(f"{label} is unavailable: {candidate}")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(artifact_root.resolve())
    except ValueError as error:
        raise GateError(f"{label} escapes the CSS-09 artifact root") from error
    expected_digest = reference.get("sha256")
    if expected_digest is not None:
        actual_digest = hashlib.sha256(resolved.read_bytes()).hexdigest()
        if (
            not isinstance(expected_digest, str)
            or SHA256.fullmatch(expected_digest) is None
            or not hmac.compare_digest(expected_digest, actual_digest)
        ):
            raise GateError(f"{label} digest is invalid")
    aliases = {
        raw_path,
        str(resolved),
    }
    for key in ("id", "ref", "role"):
        alias = reference.get(key)
        if isinstance(alias, str) and alias:
            aliases.add(alias)
    return resolved, aliases


def _is_receiver_evidence(path: Path, reference: str, scenario_id: str) -> bool:
    if "receiver" in reference.lower():
        return True
    if path.suffix.lower() != ".json":
        return False
    payload = _load_json(path, f"supporting artifact for {scenario_id}")
    declared_scenario = _first_string(
        payload,
        ("scenarioId", "scenario_id"),
    )
    if declared_scenario and declared_scenario != scenario_id:
        return False
    kind = _first_string(payload, ("artifactKind", "kind")).lower()
    return (
        "receiver" in kind
        or payload.get("receiverVisible") is True
        or bool(_first_string(payload, ("receiverClientId", "receiver_client_id")))
        or isinstance(payload.get("receiver"), Mapping)
    )


def _validate_schema_inventory(payload: Mapping[str, Any], *, repo_root: Path) -> None:
    from tooling.development.secure_content import runtime_manifest
    from tooling.development.secure_content.runtime_schema import RUNTIME_TARGETS
    store = EvidenceStore.from_environment(repo_root=repo_root, worktree=repo_root)
    inventory_ref = ArtifactRef.from_dict(payload["schemaInventory"])
    if (
        inventory_ref.gate_id != "social-cross-station-native-e2e"
        or inventory_ref.run_id != payload["runId"]
        or inventory_ref.workspace_id != payload["workspaceId"]
    ):
        raise GateError("private Social schema inventory belongs to another run")
    inventory = store.read_json(inventory_ref)
    if (
        inventory.get("artifactKind") != "private-social-schema-inventory"
        or inventory.get("runId") != payload["provisioningRunId"]
        or inventory.get("sourceCommit") != payload["sourceCommit"]
        or inventory.get("workspaceId") != payload["workspaceId"]
        or set(inventory.get("services", {})) != set(SERVICE_IDS)
    ):
        raise GateError("private Social schema inventory source/epoch is invalid")
    for role, entry in inventory["services"].items():
        target = RUNTIME_TARGETS.get(entry["profileId"])
        service_ref = ArtifactRef.from_dict(entry["serviceAttestationRef"])
        service = store.read_json(service_ref)
        if (
            target is None or entry["physicalServiceId"] != target.service_id
            or entry["deploymentEnvironment"] != target.deployment_environment
            or service_ref.gate_id != inventory_ref.gate_id
            or service_ref.run_id != inventory_ref.run_id
            or service_ref.workspace_id != inventory_ref.workspace_id
            or service.get("serviceId") != role
            or service.get("commit") != payload["sourceCommit"]
            or service.get("workspaceDigest") != "clean"
            or service.get("deploymentEnvironment") != target.deployment_environment
            or hashlib.sha256(str(service.get("runtimeIdentity", "")).encode()).hexdigest()
            != payload["runtimeManifest"]["serviceRuntimeIdentityDigests"][role]
            or payload["runtimeManifest"]["profileBindings"].get(entry["profileId"]) != role
        ):
            raise GateError("private Social schema physical owner or Station changed")
        raw = entry["attestationRef"]
        ref = ArtifactRef.from_dict({
            **inventory_ref.to_dict(), "path": raw["path"], "sha256": raw["sha256"],
        })
        binding = runtime_manifest.load_canonical_private_schema_attestation(
            store.resolve(ref), repo_root=repo_root,
            source_commit=payload["sourceCommit"], workspace_id=payload["workspaceId"],
            service_id=target.service_id, profile_id=target.profile_id,
            deployment_environment=target.deployment_environment,
            station_runtime_identity=service["runtimeIdentity"],
            service_attestation_digest=runtime_manifest.schema_service_attestation_binding_digest(
                target.service_id, {
                    "kind": service["serviceKind"],
                    "deployment_environment": service["deploymentEnvironment"],
                    "schema_attestation_endpoint": service["endpoint"],
                    "live_commit": service["commit"],
                    "protocol_digest": service["protocolDigest"],
                    "runtime_identity": service["runtimeIdentity"],
                },
            ),
        )
        if not binding.provenance_files:
            raise GateError("private Social schema has no reset provenance")


def validate_suite_result(
    payload: Mapping[str, Any],
    *,
    result_path: Path,
    artifact_root: Path,
    repo_root: Path,
    expected_workspace: str,
    expected_source: Mapping[str, Any],
    expected_run_id: str,
) -> ValidatedSuiteResult:
    if set(payload) != SUITE_RESULT_FIELDS:
        raise GateError("CSS-09 suite result has unknown or missing fields")
    if (
        payload.get("artifactKind") != SUITE_ARTIFACT_KIND
        or payload.get("schemaVersion") != SUITE_SCHEMA_VERSION
        or payload.get("status") != "FUNCTIONAL_PASS"
        or payload.get("proofState") != "UNPROVEN"
    ):
        raise GateError("CSS-09 suite result identity/status is invalid")

    declared_digest = _require_string(
        payload.get("resultDigest"),
        "CSS-09 resultDigest",
        pattern=SHA256,
    )
    unsigned = dict(payload)
    unsigned.pop("resultDigest")
    if not hmac.compare_digest(declared_digest, canonical_digest(unsigned)):
        raise GateError("CSS-09 suite result digest does not match its payload")

    declared_control = _require_string(
        payload.get("controlCommit"),
        "CSS-09 controlCommit",
        pattern=COMMIT,
    )
    source_commit = _require_string(
        payload.get("sourceCommit"),
        "CSS-09 sourceCommit",
        pattern=COMMIT,
    )
    declared_workspace = _require_string(
        payload.get("workspaceId"),
        "CSS-09 workspaceId",
        pattern=WORKSPACE_ID,
    )
    worktree_set_digest = _require_string(
        payload.get("worktreeSetDigest"),
        "CSS-09 worktreeSetDigest",
        pattern=SHA256,
    )
    run_id = _require_string(payload.get("runId"), "CSS-09 runId")
    fixture_epoch = _require_string(
        payload.get("fixtureEpoch"),
        "CSS-09 fixtureEpoch",
    )
    provisioning_run_id = _require_string(payload.get("provisioningRunId"), "Suite provisioning run")
    if declared_workspace != expected_workspace:
        raise GateError("CSS-09 suite result workspace identity is stale")
    if (
        payload.get("source") != dict(expected_source)
        or source_commit != expected_source["commit"] or declared_control != source_commit
        or worktree_set_digest != canonical_digest(expected_source)
        or run_id != expected_run_id or fixture_epoch != provisioning_run_id
    ):
        raise GateError("private Social Suite source/run/epoch is stale")

    suite_digest = _require_string(
        payload.get("suiteRuntimeReportDigest"),
        "CSS-09 suiteRuntimeReportDigest",
        pattern=SHA256,
    )
    _validate_embedded_runtime_manifest(
        payload.get("runtimeManifest"),
        source_commit=source_commit,
        control_commit=declared_control,
        workspace=declared_workspace,
        worktree_set_digest=worktree_set_digest,
        run_id=run_id,
        provisioning_run_id=provisioning_run_id,
        fixture_epoch=fixture_epoch,
        suite_runtime_report_digest=suite_digest,
    )
    resource_reuse = _validate_resource_reuse(payload.get("resourceReuse"))
    cleanup = payload.get("cleanup")
    if not isinstance(cleanup, Mapping) or cleanup.get("status") != "CLEANED":
        raise GateError("CSS-09 suite cleanup is not complete")

    suite_runtime_path, _ = _resolve_artifact(
        payload.get("suiteRuntimeReport"),
        label="CSS-09 Suite Runtime report",
        result_path=result_path,
        artifact_root=artifact_root,
    )
    suite_runtime_payload = _load_json(
        suite_runtime_path,
        "CSS-09 Suite Runtime report",
    )
    try:
        suite_runtime_report = validate_suite_runtime_report(
            suite_runtime_payload,
            expected_contract=EXPECTED_RUNTIME_REUSE,
        )
    except ProvisioningError as error:
        raise GateError(f"CSS-09 Suite Runtime report is invalid: {error}") from error
    if (
        suite_runtime_report.get("reportDigest") != suite_digest
        or suite_runtime_report.get("sourceDigest") != source_commit
        or suite_runtime_report.get("suiteRuntimeId") != run_id
        or suite_runtime_report.get("fixtureEpoch") != fixture_epoch
        or suite_runtime_report["metrics"].get("provisioningRuns")
        != resource_reuse["provisioningRuns"]
        or suite_runtime_report["metrics"].get("clientLaunches")
        != resource_reuse["clientLaunches"]
    ):
        raise GateError("CSS-09 Suite Runtime identity/metrics are inconsistent")

    supporting = payload.get("supportingArtifacts")
    if (
        not isinstance(supporting, Sequence)
        or isinstance(supporting, (str, bytes))
        or not supporting
    ):
        raise GateError("CSS-09 supportingArtifacts must be a non-empty array")
    supporting_paths: list[Path] = []
    for index, reference in enumerate(supporting, start=1):
        path, _ = _resolve_artifact(
            reference,
            label=f"CSS-09 supporting artifact {index}",
            result_path=result_path,
            artifact_root=artifact_root,
        )
        supporting_paths.append(path)
    supporting_set = set(supporting_paths)

    _validate_schema_inventory(payload, repo_root=repo_root)

    scenario_results = payload.get("scenarioResults")
    if (
        not isinstance(scenario_results, Mapping)
        or set(scenario_results) != set(SCENARIO_IDS)
    ):
        raise GateError("CSS-09 scenario result set is incomplete")
    for scenario_id in SCENARIO_IDS:
        result = scenario_results[scenario_id]
        if not isinstance(result, Mapping) or result.get("status") != "PASS":
            raise GateError(f"CSS-09 scenario {scenario_id} did not pass")
        refs = result.get("evidenceRefs")
        if (
            not isinstance(refs, Sequence)
            or isinstance(refs, (str, bytes))
            or not refs
        ):
            raise GateError(
                f"CSS-09 scenario {scenario_id} has no evidence references"
            )
        resolved_refs: list[tuple[str, Path]] = []
        for index, reference in enumerate(refs, start=1):
            raw_path, _ = _artifact_path_value(
                reference,
                f"CSS-09 {scenario_id} evidence reference {index}",
            )
            path, _ = _resolve_artifact(
                reference,
                label=f"CSS-09 {scenario_id} evidence reference {index}",
                result_path=result_path,
                artifact_root=artifact_root,
            )
            if path not in supporting_set:
                raise GateError(
                    f"CSS-09 scenario {scenario_id} references unknown evidence"
                )
            resolved_refs.append((raw_path, path))
        if not any(
            _is_receiver_evidence(path, reference, scenario_id)
            for reference, path in resolved_refs
        ):
            raise GateError(
                f"CSS-09 scenario {scenario_id} lacks receiver-visible evidence"
            )

    return ValidatedSuiteResult(
        path=result_path,
        payload=dict(payload),
        suite_runtime_path=suite_runtime_path,
        suite_runtime_report=suite_runtime_report,
        supporting_artifacts=tuple(supporting_paths),
    )


def load_suite_result(
    repo_root: Path = REPO_ROOT,
    *,
    consumer_gate_id: str,
    execution_policy: str,
) -> ValidatedSuiteResult:
    """Read the original producer selected by this execution graph, never history."""
    from dataclasses import replace
    def unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise GateError("private Social prerequisite contains duplicate fields")
            value[key] = item
        return value
    try:
        refs = json.loads(os.environ.get("PT_ACCEPTANCE_PREREQUISITE_PROOFS", "[]"),
                          object_pairs_hook=unique_fields)
        envelope = json.loads(os.environ.get("PT_ACCEPTANCE_CURRENT_RESULTS", "{}"),
                              object_pairs_hook=unique_fields)
    except json.JSONDecodeError as error:
        raise GateError("private Social prerequisite context is invalid") from error
    field = "developmentManifest" if execution_policy == "development" else "runManifest"
    producer = "social-cross-station-native-e2e"
    if (
        execution_policy not in {"development", "acceptance"}
        or consumer_gate_id not in {"social-private-desktop-e2e", "social-cross-station-desktop-functional"}
        or not isinstance(refs, list) or len(refs) != 1
        or not isinstance(refs[0], dict) or set(refs[0]) != {"gateId", field}
        or refs[0]["gateId"] != producer
        or not isinstance(envelope, dict) or set(envelope) != {"source", "results"}
        or not isinstance(envelope["results"], list)
    ):
        raise GateError("private Social requires its exact current prerequisite")
    source = source_identity(repo_root)
    if envelope["source"] != source:
        raise GateError("private Social prerequisite source is stale")
    ids = [result.get("id") for result in envelope["results"] if isinstance(result, dict)]
    if len(ids) != len(envelope["results"]) or len(ids) != len(set(ids)):
        raise GateError("private Social prerequisite results contain repeated identities")
    store = EvidenceStore.from_environment(repo_root=repo_root, worktree=repo_root)
    verified, missing = prerequisite_results(
        {"id": consumer_gate_id, "dependsOn": [producer]}, envelope["results"], source, store,
        execution_policy=execution_policy,
    )
    if missing or verified != refs:
        raise GateError("private Social prerequisite differs from current Runner results")
    manifest_ref = ArtifactRef.from_dict(refs[0][field])
    manifest = store.read_run_manifest(
        manifest_ref, manifest_sha256=manifest_ref.sha256, expected_gate_id=producer,
    )
    report_ref = manifest["result"].get("sourceArtifact")
    if report_ref not in manifest["artifacts"].values():
        raise GateError("private Social producer report is outside the original inventory")
    report = store.read_json(ArtifactRef.from_dict(report_ref))
    result_ref = report.get("evidence", {}).get("suite-result")
    if result_ref not in manifest["artifacts"].values():
        raise GateError("private Social Suite result is outside the original inventory")
    ref = ArtifactRef.from_dict(result_ref)
    path = store.resolve(ref)
    result = validate_suite_result(
        store.read_json(ref), result_path=path,
        artifact_root=store.resolve(manifest_ref).parent, repo_root=repo_root,
        expected_workspace=store.workspace_id, expected_source=source,
        expected_run_id=manifest_ref.run_id,
    )
    inventory_paths = {store.resolve(ArtifactRef.from_dict(item))
                       for item in manifest["artifacts"].values()}
    if not {result.suite_runtime_path, *result.supporting_artifacts} <= inventory_paths:
        raise GateError("private Social supporting evidence is outside the original inventory")
    return replace(result, producer_manifest=refs[0], result_ref=ref.to_dict())


def attach_suite_evidence(
    gate: AcceptanceGate,
    result: ValidatedSuiteResult,
) -> None:
    if result.producer_manifest is not None:
        gate.report.runtime["privateSocialProducer"] = {
            "originalManifest": result.producer_manifest,
            "originalSuiteResult": result.result_ref,
        }
        return
    gate.report.add_evidence_file("suite-result", result.path)
    gate.report.add_evidence_file(
        "suite-runtime",
        result.suite_runtime_path,
    )
    for index, path in enumerate(result.supporting_artifacts, start=1):
        gate.report.add_evidence_file(f"suite-supporting-{index}", path)
