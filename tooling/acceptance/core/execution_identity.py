"""Closed Gate inputs and owner observations; opaque experiments run fresh."""

from __future__ import annotations

import contextlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Mapping

from .errors import EphemeralLaunchCleanupFailed
from .execution_budget import ExecutionBudgetError, ExecutionDeadline, GateExecution, digest


TOOL_ENVIRONMENT_KEYS = frozenset({
    "HOME", "USER", "LOGNAME", "COMSPEC", "LANG", "LC_ALL", "LC_CTYPE",
    "PATH", "PATHEXT", "PYTHONHOME", "PYTHONDONTWRITEBYTECODE",
    "PYTHONIOENCODING", "PYTHONPATH", "PYTHONUTF8", "SYSTEMROOT",
    "TEMP", "TMP", "TMPDIR", "TZ", "WINDIR",
    "PT_ACCEPTANCE_PYTHON", "PT_ARCHITECTURE_PYTHON",
})
RUNNER_INPUT_KEYS = frozenset({
    "PT_ACCEPTANCE_ARTIFACT_ROOT", "PT_ACCEPTANCE_CURRENT_RESULTS",
    "PT_ACCEPTANCE_AGGREGATE_SOURCE", "PT_ACCEPTANCE_PREREQUISITE_PROOFS",
    "PT_ACCEPTANCE_RUN_ID", "PT_ACCEPTANCE_GATE_ID", "PT_ACCEPTANCE_WORKSPACE_ID",
    "PT_ACCEPTANCE_REDACTION_VALUES",
    "PT_ACCEPTANCE_INPUT_CONTEXT",
})
INPUT_AXES = frozenset({"runtime", "provider", "oracle", "actionPlan", "fixture"})


class InputIdentityError(ExecutionBudgetError):
    """An injected owner could not establish its closed current inputs."""


class InputIdentityProbeFailed(InputIdentityError):
    """Retain the actual launch failure and bounded output for its evidence owner."""

    def __init__(
        self, gate_id: str, owner_id: str, error: Exception, output: Mapping[str, str],
        *, argv: tuple[str, ...] | None = None, exit_code: int | None = None,
    ):
        super().__init__(f"{gate_id}: input owner {owner_id} did not complete")
        diagnostic = getattr(error, "diagnostic", None)
        self.failure = {
            "artifactKind": "acceptance-input-owner-failure",
            "gateId": gate_id, "ownerId": owner_id, "errorType": type(error).__name__,
            "diagnostic": diagnostic.to_dict() if diagnostic is not None else None,
            "output": {
                key: value.encode()[-65536:].decode(errors="ignore")
                for key, value in output.items()
            },
            "outputTruncated": any(len(value.encode()) > 65536 for value in output.values()),
            "proofStatus": "supporting-only",
        }
        if argv is not None:
            self.failure["argv"] = list(argv)
        if exit_code is not None:
            self.failure["commandExitCode"] = exit_code


class InputIdentityCleanupFailed(EphemeralLaunchCleanupFailed):
    """Input owner resources remain unqualified; dispatch must stop."""

    def __init__(self, gate_id: str, owner_id: str, error: EphemeralLaunchCleanupFailed):
        super().__init__(
            f"{gate_id}: input owner {owner_id} process cleanup failed",
            operation=error.operation, result=error.result,
        )
        self.gate_id = gate_id
        self.owner_id = owner_id


def validate_execution_inputs(gate_id: str, gate: Mapping[str, Any]) -> None:
    if "executionInputs" not in gate:
        return
    value = gate["executionInputs"]
    if (
        not isinstance(value, dict)
        or set(value) not in ({"environmentKeys"}, {"environmentKeys", "identityProbe"})
        or not isinstance(value["environmentKeys"], list)
        or any(
            not isinstance(key, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key)
            or key in RUNNER_INPUT_KEYS
            for key in value["environmentKeys"]
        )
        or len(set(value["environmentKeys"])) != len(value["environmentKeys"])
        or gate.get("ephemeralCapabilities")
        or (
            "identityProbe" not in value
            and (
                gate.get("environment", "local") != "local"
                or gate.get("provisioner") or gate.get("requiredRuntimeCells")
            )
        )
    ):
        raise ExecutionBudgetError(f"{gate_id}: invalid closed executionInputs")
    if "identityProbe" in value:
        from .execution_budget import positive_seconds

        probe = value["identityProbe"]
        if (
            not isinstance(probe, dict)
            or set(probe) != {"ownerId", "argv", "timeoutSeconds"}
            or not isinstance(probe["ownerId"], str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", probe["ownerId"]) is None
            or not isinstance(probe["argv"], list) or not probe["argv"]
            or len(probe["argv"]) > 128
            or any(not isinstance(arg, str) or not arg or "\0" in arg or len(arg) > 4096
                   for arg in probe["argv"])
        ):
            raise ExecutionBudgetError(f"{gate_id}: invalid input identityProbe")
        positive_seconds(probe["timeoutSeconds"], f"{gate_id}: input probe timeout")


def validate_input_observation(
    gate_id: str, owner_id: str, value: Any,
) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != {"artifactKind", "gateId", "ownerId", "inputs"}
        or value["artifactKind"] != "acceptance-gate-input-observation"
        or value["gateId"] != gate_id or value["ownerId"] != owner_id
        or not isinstance(value["inputs"], dict) or set(value["inputs"]) != INPUT_AXES
        or any(not isinstance(item, str) or re.fullmatch(r"[0-9a-f]{64}", item) is None
               for item in value["inputs"].values())
    ):
        raise InputIdentityError(f"{gate_id}: owner input observation is incomplete or invalid")
    return value


def observe_gate_inputs(
    gate: Mapping[str, Any], environment: Mapping[str, str], *,
    repo_root: Path, context: Mapping[str, Any], execution: GateExecution | None = None,
    stage: str = "execution-inputs", phase: str = "work",
    artifact_root: Path | None = None,
) -> dict[str, Any] | None:
    """The caller owns the current deadline; the existing launcher owns children."""
    from .errors import EphemeralLaunchError
    from .launch_context import GateLaunchSpec, GateProcessLauncher

    validate_execution_inputs(str(gate["id"]), gate)
    probe = gate.get("executionInputs", {}).get("identityProbe")
    if probe is None:
        return None
    child_environment = inherited_gate_environment(gate, environment)
    if artifact_root is not None:
        child_environment["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
    child_environment["PT_ACCEPTANCE_INPUT_CONTEXT"] = json.dumps(
        context, sort_keys=True, separators=(",", ":"),
    )
    interrupted = False
    output: dict[str, str] = {}

    @contextlib.contextmanager
    def work_scope():
        nonlocal interrupted
        try:
            with execution.stage(stage, phase=phase) if execution else contextlib.nullcontext():
                yield
        except BaseException as error:
            interrupted = isinstance(error, (ExecutionDeadline, KeyboardInterrupt))
            raise

    @contextlib.contextmanager
    def cleanup_scope():
        # Successful read-only observation does not end the Gate's work phase.
        # Cancellation uses the same fixed tail as subsequent Gate cleanup.
        cleanup_phase = "cleanup" if interrupted and phase == "work" else phase
        scope = (
            execution.stage(f"{stage}-process-cleanup", phase=cleanup_phase)
            if execution else contextlib.nullcontext()
        )
        try:
            with scope:
                yield
        except (ExecutionDeadline, KeyboardInterrupt) as error:
            raise EphemeralLaunchCleanupFailed(
                "input owner process cleanup was interrupted",
                operation="gate_process",
            ) from error

    try:
        completed = GateProcessLauncher(
            cwd=str(repo_root), environment=child_environment,
            termination_timeout_seconds=(
                min(1, execution.budget.cleanup_seconds / 4) if execution else 1
            ),
        ).run(
            GateLaunchSpec(tuple(probe["argv"]), probe["timeoutSeconds"], ()), None,
            work_scope=work_scope, cleanup_scope=cleanup_scope,
            capture_output=lambda stdout, stderr: output.update(stdout=stdout, stderr=stderr),
        )
    except EphemeralLaunchCleanupFailed as error:
        raise InputIdentityCleanupFailed(gate["id"], probe["ownerId"], error) from error
    except (OSError, EphemeralLaunchError) as error:
        raise InputIdentityProbeFailed(
            gate["id"], probe["ownerId"], error, output, argv=tuple(probe["argv"]),
        ) from error
    try:
        if completed.returncode != 0:
            raise subprocess.CalledProcessError(completed.returncode, probe["argv"])
        if len(completed.stdout.encode()) > 16384:
            raise InputIdentityError("input owner observation exceeds its output limit")

        def unique_pairs(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("duplicate observation field")
                value[key] = item
            return value

        value = json.loads(completed.stdout, object_pairs_hook=unique_pairs)
        return validate_input_observation(str(gate["id"]), probe["ownerId"], value)
    except (ValueError, TypeError, InputIdentityError, subprocess.CalledProcessError) as error:
        raise InputIdentityProbeFailed(
            gate["id"], probe["ownerId"], error,
            {"stdout": completed.stdout, "stderr": completed.stderr},
            argv=tuple(probe["argv"]), exit_code=completed.returncode,
        ) from error


def inherited_gate_environment(
    gate: Mapping[str, Any], environment: Mapping[str, str],
) -> dict[str, str]:
    """Constrain declared children to exactly the inputs whose values are hashed."""
    validate_execution_inputs(str(gate["id"]), gate)
    if "executionInputs" not in gate:
        return dict(environment)
    keys = TOOL_ENVIRONMENT_KEYS | set(gate["executionInputs"]["environmentKeys"])
    return {key: value for key, value in environment.items() if key in keys}


def gate_execution_identity(
    gate: Mapping[str, Any], graph: Mapping[str, Any], policy: Any,
    context: str, environment: Mapping[str, str],
    *, observation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    validate_execution_inputs(str(gate["id"]), gate)
    probe = gate.get("executionInputs", {}).get("identityProbe")
    if observation is not None:
        if probe is None:
            raise InputIdentityError(f"{gate['id']}: undeclared owner input observation")
        validate_input_observation(str(gate["id"]), probe["ownerId"], observation)
    eligible = (
        "executionInputs" in gate
        and (
            probe is not None and observation is not None
            or probe is None and gate.get("tier") in {"ci-structure", "ci-cheap", "local-evidence"}
        )
    )
    return {
        "artifactKind": "acceptance-gate-execution-identity",
        "gateId": gate["id"],
        "definitionDigest": graph["definitionDigests"][gate["id"]],
        "graphDigest": graph["digest"],
        "policyDigest": policy.identity,
        "contextDigest": context,
        "inputDigest": digest(inherited_gate_environment(gate, environment)) if eligible else None,
        "ownerInputs": observation,
        "reuseEligible": eligible,
    }
