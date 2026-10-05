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
    load_runtime_manifest,
    validate_suite_runtime_report,
    workspace_id,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
SUITE_ARTIFACT_ROOT_ENV = "PT_SOCIAL_CROSS_STATION_ARTIFACT_ROOT"
ACCEPTANCE_RUNTIME_MANIFEST_ENV = "PT_ACCEPTANCE_RUNTIME_MANIFEST"
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
CLIENT_BINDINGS = {
    "alice": ("alice", "station-four"),
    "bob": ("bob", "station-five-arm"),
    "eve": ("eve", "station-five-arm"),
    "bob2": ("bob", "station-five-arm"),
}
LAUNCHED_CLIENTS = ("alice", "bob", "bob2")
FIXTURE_ONLY_CLIENTS = ("eve",)
ALLOWED_POST_RESULT_PREFIXES = (
    "docs/architecture/cross-station-social/",
    "tooling/acceptance/",
    "tooling/development/secure_content/",
)
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
        "activation",
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


def current_control_commit(repo_root: Path = REPO_ROOT) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=repo_root,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    commit = completed.stdout.strip()
    if completed.returncode != 0 or COMMIT.fullmatch(commit) is None:
        raise GateError("cannot resolve the current CSS-09 control HEAD")
    return commit


def suite_artifact_root(
    repo_root: Path = REPO_ROOT,
    *,
    environment: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> Path:
    current_environment = os.environ if environment is None else environment
    override = current_environment.get(SUITE_ARTIFACT_ROOT_ENV, "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (
        (Path.home() if home is None else home)
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / workspace_id(repo_root)
    ).resolve()


def discover_suite_result(
    repo_root: Path = REPO_ROOT,
    *,
    artifact_root: Path | None = None,
    control_commit: str | None = None,
    environment: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> tuple[Path, Path, str, str]:
    resolved_control = control_commit or current_control_commit(repo_root)
    if COMMIT.fullmatch(resolved_control) is None:
        raise GateError("CSS-09 control commit must be a lowercase 40-hex SHA")
    resolved_workspace = workspace_id(repo_root)
    root = (
        artifact_root.resolve()
        if artifact_root is not None
        else suite_artifact_root(
            repo_root,
            environment=environment,
            home=home,
        )
    )
    generation_root = (
        root / "development" / "secure-content" / "CSS-09"
    )
    exact_result = (
        generation_root / resolved_control / "suite" / "result.json"
    )
    if exact_result.is_file() and not exact_result.is_symlink():
        return exact_result, root, resolved_control, resolved_workspace

    candidates: list[tuple[int, Path]] = []
    if generation_root.is_dir():
        for generation in generation_root.iterdir():
            result_path = generation / "suite" / "result.json"
            if (
                COMMIT.fullmatch(generation.name) is None
                or result_path.is_symlink()
                or not result_path.is_file()
                or not _git_is_ancestor(
                    repo_root,
                    generation.name,
                    resolved_control,
                )
            ):
                continue
            candidates.append(
                (
                    _git_commit_distance(
                        repo_root,
                        generation.name,
                        resolved_control,
                    ),
                    result_path,
                )
            )
    if not candidates:
        raise GateError(
            "current-control CSS-09 suite result is unavailable: "
            f"{exact_result}"
        )
    candidates.sort(key=lambda item: (item[0], str(item[1])))
    return candidates[0][1], root, resolved_control, resolved_workspace


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


def _validate_activation(
    activation: object,
) -> dict[str, Any]:
    if (
        not isinstance(activation, Mapping)
        or set(activation) != {"aggregatePath", "resultDigest", "profiles"}
        or not isinstance(activation.get("aggregatePath"), str)
        or not activation["aggregatePath"]
        or SHA256.fullmatch(str(activation.get("resultDigest") or "")) is None
        or activation.get("profiles") != ["four", "fiveArm"]
    ):
        raise GateError("CSS-09 activation evidence is invalid")
    return dict(activation)


def _validate_activation_artifact(
    activation: Mapping[str, Any],
    path: Path,
    *,
    source_commit: str,
    workspace: str,
) -> dict[str, Any]:
    payload = _load_json(path, "CSS-09 activation aggregate")
    unsigned = dict(payload)
    digest = unsigned.pop("result_digest", None)
    expected = {
        "schema_version": 1,
        "kind": "secure-content-schema-activation-aggregate",
        "workstream_id": "CSS-W-ACTIVATION",
        "task_id": "CSS-08A-schema-activation",
        "generation_id": source_commit,
        "source_commit": source_commit,
        "workspace_id": workspace,
        "reset_intent": "SCHEMA_ACTIVATION",
        "profiles": ["four", "fiveArm"],
        "status": "PASS",
        "claim": "CANONICAL_SCHEMA_ACTIVE_ONLY",
    }
    if any(payload.get(key) != value for key, value in expected.items()):
        raise GateError("CSS-09 activation aggregate identity is invalid")
    if (
        not isinstance(digest, str)
        or digest != activation["resultDigest"]
        or not hmac.compare_digest(digest, canonical_digest(unsigned))
    ):
        raise GateError("CSS-09 activation aggregate digest is invalid")
    children = payload.get("children")
    if (
        not isinstance(children, list)
        or [
            child.get("profile_id")
            for child in children
            if isinstance(child, Mapping)
        ]
        != ["four", "fiveArm"]
    ):
        raise GateError("CSS-09 activation aggregate children are incomplete")
    return payload


def _normalized_client_id(value: str) -> str:
    prefix = "cross-station-social-"
    return value[len(prefix) :] if value.startswith(prefix) else value


def _runtime_clients(value: object) -> dict[str, Mapping[str, Any]]:
    if isinstance(value, Mapping):
        clients = {
            _normalized_client_id(str(client_id)): client
            for client_id, client in value.items()
            if isinstance(client, Mapping)
        }
        if len(clients) != len(value):
            raise GateError("CSS-09 runtime clients must contain only objects")
        return clients
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        clients: dict[str, Mapping[str, Any]] = {}
        for client in value:
            if not isinstance(client, Mapping):
                raise GateError(
                    "CSS-09 runtime clients must contain only objects"
                )
            client_id = _normalized_client_id(
                _first_string(client, ("id", "clientId", "client_id"))
            )
            if not client_id or client_id in clients:
                raise GateError("CSS-09 runtime client identity is invalid")
            clients[client_id] = client
        return clients
    raise GateError("CSS-09 runtime manifest clients are missing")


def _binding_service_id(client: Mapping[str, Any]) -> str:
    bindings = client.get("service_bindings")
    if not isinstance(bindings, Mapping):
        bindings = client.get("serviceBindings")
    station = bindings.get("station") if isinstance(bindings, Mapping) else None
    if not isinstance(station, Mapping):
        return ""
    return _first_string(station, ("service_id", "serviceId"))


def _validate_embedded_runtime_manifest(
    manifest: object,
    *,
    source_commit: str,
    control_commit: str,
    workspace: str,
    worktree_set_digest: str,
    run_id: str,
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
        "workspaceId": workspace,
        "sourceCommit": source_commit,
        "controlCommit": control_commit,
        "worktreeSetDigest": worktree_set_digest,
        "fixtureEpoch": fixture_epoch,
        "suiteRuntimeReportDigest": suite_runtime_report_digest,
    }
    if any(manifest.get(key) != value for key, value in expected_identity.items()):
        raise GateError("CSS-09 runtime source/run identity is inconsistent")
    if manifest.get("profileBindings") != {
        "four": "station-four",
        "fiveArm": "station-five-arm",
    }:
        raise GateError("CSS-09 runtime profile bindings are incomplete")
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
        f"cross-station-social-{client_id}": {
            "clientId": f"cross-station-social-{client_id}",
            "actorRole": actor,
            "profileId": (
                "four" if service_id == "station-four" else "fiveArm"
            ),
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
    replacements = [
        _normalized_client_id(str(item))
        for item in value.get("clientReplacements", [])
    ]
    fixture_only = [
        _normalized_client_id(str(item))
        for item in value.get("fixtureOnlyClients", [])
    ]
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


def _git_is_ancestor(
    repo_root: Path,
    ancestor: str,
    descendant: str,
) -> bool:
    completed = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        cwd=repo_root,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    if completed.returncode in {0, 1}:
        return completed.returncode == 0
    raise GateError("cannot validate the CSS-09 Git commit lineage")


def _git_commit_distance(
    repo_root: Path,
    ancestor: str,
    descendant: str,
) -> int:
    completed = subprocess.run(
        ["git", "rev-list", "--count", f"{ancestor}..{descendant}"],
        cwd=repo_root,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    value = completed.stdout.strip()
    if completed.returncode != 0 or not value.isdigit():
        raise GateError("cannot measure the CSS-09 control commit lineage")
    return int(value)


def _require_source_ancestor(
    repo_root: Path,
    source_commit: str,
    result_control_commit: str,
) -> None:
    if not _git_is_ancestor(
        repo_root,
        source_commit,
        result_control_commit,
    ):
        raise GateError(
            "CSS-09 activated source commit is not an ancestor of "
            "the result control commit"
        )
    _require_allowed_commit_delta(
        repo_root,
        source_commit,
        result_control_commit,
        label="post-activation",
    )


def _require_allowed_commit_delta(
    repo_root: Path,
    base_commit: str,
    head_commit: str,
    *,
    label: str,
) -> None:
    changed = subprocess.run(
        [
            "git",
            "diff",
            "--name-only",
            "--diff-filter=ACDMRTUXB",
            f"{base_commit}..{head_commit}",
        ],
        cwd=repo_root,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if changed.returncode != 0:
        raise GateError(f"cannot inspect CSS-09 {label} changes")
    disallowed = sorted(
        path
        for path in changed.stdout.splitlines()
        if path
        and not any(
            path.startswith(prefix)
            for prefix in ALLOWED_POST_RESULT_PREFIXES
        )
    )
    if disallowed:
        raise GateError(
            f"CSS-09 {label} has disallowed changes: "
            + ", ".join(disallowed)
        )


def _require_allowed_control_lineage(
    repo_root: Path,
    result_control_commit: str,
    current_head: str,
) -> None:
    if result_control_commit == current_head:
        return
    if not _git_is_ancestor(repo_root, result_control_commit, current_head):
        raise GateError(
            "CSS-09 result control commit is not an ancestor of current HEAD"
        )
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=repo_root,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    if status.returncode != 0:
        raise GateError("cannot validate CSS-09 current worktree cleanliness")
    if status.stdout.strip():
        raise GateError(
            "CSS-09 descendant control HEAD requires a clean worktree"
        )
    _require_allowed_commit_delta(
        repo_root,
        result_control_commit,
        current_head,
        label="post-result control lineage",
    )


def validate_suite_result(
    payload: Mapping[str, Any],
    *,
    result_path: Path,
    artifact_root: Path,
    repo_root: Path,
    control_commit: str,
    expected_workspace: str,
    require_ancestor: bool = True,
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
    expected_result_generation = result_path.parent.parent.name
    if expected_result_generation != declared_control:
        raise GateError(
            "CSS-09 suite result path does not match its control commit"
        )
    if declared_workspace != expected_workspace:
        raise GateError("CSS-09 suite result workspace identity is stale")
    if require_ancestor:
        _require_source_ancestor(repo_root, source_commit, declared_control)
        _require_allowed_control_lineage(
            repo_root,
            declared_control,
            control_commit,
        )

    suite_digest = _require_string(
        payload.get("suiteRuntimeReportDigest"),
        "CSS-09 suiteRuntimeReportDigest",
        pattern=SHA256,
    )
    activation = _validate_activation(payload.get("activation"))
    _validate_embedded_runtime_manifest(
        payload.get("runtimeManifest"),
        source_commit=source_commit,
        control_commit=declared_control,
        workspace=declared_workspace,
        worktree_set_digest=worktree_set_digest,
        run_id=run_id,
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

    activation_path, _ = _resolve_artifact(
        activation["aggregatePath"],
        label="CSS-09 activation aggregate",
        result_path=result_path,
        artifact_root=artifact_root,
    )
    if activation_path not in supporting_set:
        raise GateError(
            "CSS-09 activation aggregate is absent from supporting artifacts"
        )
    _validate_activation_artifact(
        activation,
        activation_path,
        source_commit=source_commit,
        workspace=declared_workspace,
    )

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
    artifact_root: Path | None = None,
    control_commit: str | None = None,
    environment: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> ValidatedSuiteResult:
    result_path, root, resolved_control, resolved_workspace = (
        discover_suite_result(
            repo_root,
            artifact_root=artifact_root,
            control_commit=control_commit,
            environment=environment,
            home=home,
        )
    )
    payload = _load_json(result_path, "CSS-09 suite result")
    return validate_suite_result(
        payload,
        result_path=result_path,
        artifact_root=root,
        repo_root=repo_root,
        control_commit=resolved_control,
        expected_workspace=resolved_workspace,
    )


def attach_suite_evidence(
    gate: AcceptanceGate,
    result: ValidatedSuiteResult,
) -> None:
    gate.report.add_evidence_file("suite-result", result.path)
    gate.report.add_evidence_file(
        "suite-runtime",
        result.suite_runtime_path,
    )
    for index, path in enumerate(result.supporting_artifacts, start=1):
        gate.report.add_evidence_file(f"suite-supporting-{index}", path)


def validate_acceptance_runtime_manifest(
    path: Path,
    *,
    gate_id: str = "social-cross-station-native-e2e",
) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise GateError(f"Acceptance Runtime Manifest is unavailable: {path}")
    try:
        manifest = load_runtime_manifest(path, gate_id)
    except ProvisioningError as error:
        raise GateError(f"Acceptance Runtime Manifest is invalid: {error}") from error
    if manifest.get("environmentId") != "cross-station-social-native":
        raise GateError(
            "Acceptance Runtime Manifest has the wrong environment"
        )
    profile = manifest.get("profile")
    if (
        not isinstance(profile, Mapping)
        or profile.get("resolvedName") != "four"
        or profile.get("slot") != 13
    ):
        raise GateError(
            "Acceptance Runtime Manifest is not bound to profile four slot 13"
        )
    services = manifest.get("services")
    if not isinstance(services, Mapping) or set(services) != set(SERVICE_IDS):
        raise GateError(
            "Acceptance Runtime Manifest service topology is incomplete"
        )
    for service_id in SERVICE_IDS:
        service = services[service_id]
        if (
            not isinstance(service, Mapping)
            or service.get("kind") != "station"
            or COMMIT.fullmatch(str(service.get("liveCommit") or "")) is None
            or not service.get("runtimeIdentity")
        ):
            raise GateError(
                f"Acceptance Runtime Manifest service {service_id} is invalid"
            )

    clients = _runtime_clients(manifest.get("clients"))
    if set(clients) != set(CLIENT_BINDINGS):
        raise GateError(
            "Acceptance Runtime Manifest client topology is incomplete"
        )
    for client_id, (actor, service_id) in CLIENT_BINDINGS.items():
        client = clients[client_id]
        if (
            _first_string(client, ("actor",)) != actor
            or _first_string(client, ("runtime",)) != "native-tauri"
            or _binding_service_id(client) != service_id
        ):
            raise GateError(
                f"Acceptance Runtime Manifest client {client_id} is misbound"
            )
    return manifest


def optional_acceptance_runtime_manifest(
    *,
    environment: Mapping[str, str] | None = None,
) -> tuple[Path, dict[str, Any]] | None:
    current_environment = os.environ if environment is None else environment
    raw_path = current_environment.get(
        ACCEPTANCE_RUNTIME_MANIFEST_ENV,
        "",
    ).strip()
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    return path, validate_acceptance_runtime_manifest(path)
