from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import pkgutil
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import FrameType
from typing import Any, Callable, Iterator, Mapping, Optional, Sequence


SCHEMA_VERSION = 1
RESULT_KIND = "peers-touch-development-result"
VERIFICATION_CLASS = "FUNCTIONAL_CHECK"
RUNTIMES = frozenset({"source-only", "service", "desktop", "mobile", "browser"})
SCENARIO_PACKAGE = "tooling.development.secure_content.scenarios"
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$", re.IGNORECASE)
ACTIVE_DECLARATION_STATE = "ACTIVE"
RESULT_RESERVED_FIELDS = frozenset(
    {
        "schemaVersion",
        "kind",
        "workItemId",
        "journeyId",
        "scenarioId",
        "runtime",
        "verificationClass",
        "result",
        "workspaceId",
        "branch",
        "sourceCommit",
        "sessionId",
        "declarationId",
        "declarationDigest",
        "runtimeBindingDigest",
        "profile",
        "clients",
        "startedAt",
        "durationMs",
        "commandDigest",
        "checks",
        "artifactRefs",
        "firstFailure",
    }
)


class RunnerError(RuntimeError):
    pass


class ScenarioFailed(RunnerError):
    def __init__(self, message: str, result_path: Path):
        super().__init__(message)
        self.result_path = result_path


class ScenarioBudgetExceeded(RunnerError):
    pass


@dataclass(frozen=True)
class ScenarioDefinition:
    scenario_id: str
    journey_id: str
    work_item_id: str
    runtimes: frozenset[str]
    evidence_path: Path
    execute: Callable[["ScenarioContext"], Mapping[str, Any]]


@dataclass
class ScenarioContext:
    repo_root: Path
    runtime: str
    profile: Optional[str]
    clients: tuple[str, ...]
    budget_seconds: int
    started_monotonic: float
    checks: list[dict[str, Any]] = field(default_factory=list)

    def remaining_seconds(self) -> float:
        remaining = self.budget_seconds - (
            time.monotonic() - self.started_monotonic
        )
        if remaining <= 0:
            raise ScenarioBudgetExceeded("scenario budget exhausted")
        return remaining

    def run_check(
        self,
        check_id: str,
        command: Sequence[str],
        *,
        cwd: Path,
    ) -> dict[str, Any]:
        _require_identifier(check_id, "check id")
        if not command or any(not isinstance(value, str) or not value for value in command):
            raise RunnerError(f"{check_id} command must contain non-empty strings")
        remaining = self.remaining_seconds()
        started = time.monotonic()
        try:
            process = subprocess.run(
                list(command),
                cwd=cwd,
                check=False,
                capture_output=True,
                text=True,
                timeout=remaining,
            )
        except subprocess.TimeoutExpired as error:
            self.checks.append(
                {
                    "id": check_id,
                    "command": list(command),
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "exitCode": None,
                    "result": "FAIL",
                }
            )
            raise ScenarioBudgetExceeded(
                f"{check_id} exceeded the scenario budget"
            ) from error
        record = {
            "id": check_id,
            "command": list(command),
            "durationMs": int((time.monotonic() - started) * 1000),
            "exitCode": process.returncode,
            "result": "PASS" if process.returncode == 0 else "FAIL",
        }
        self.checks.append(record)
        if process.returncode != 0:
            raise RunnerError(
                f"{check_id} failed with exit code {process.returncode}"
            )
        return record


CommandRunner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]


def _require_identifier(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or not IDENTIFIER.fullmatch(value)
    ):
        raise RunnerError(f"{field} has an invalid identifier")
    return value


def _canonical_scenario_id(value: str) -> str:
    if not isinstance(value, str):
        raise RunnerError("scenario id must be a string")
    normalized = value.strip().replace("_", "-")
    if (
        not normalized
        or normalized != normalized.lower()
        or any(part == "" for part in normalized.split("-"))
        or any(not part.replace(".", "").isalnum() for part in normalized.split("-"))
    ):
        raise RunnerError(f"invalid scenario id: {value!r}")
    return normalized


def _validate_definition(value: Any, module_name: str) -> ScenarioDefinition:
    required = (
        "scenario_id",
        "journey_id",
        "work_item_id",
        "runtimes",
        "evidence_path",
        "execute",
    )
    if any(not hasattr(value, field_name) for field_name in required):
        raise RunnerError(f"{module_name} does not export a complete SCENARIO definition")
    scenario_id = _canonical_scenario_id(value.scenario_id)
    expected_module = scenario_id.replace("-", "_")
    if module_name.rsplit(".", 1)[-1] != expected_module:
        raise RunnerError(
            f"scenario module {module_name} must match id {scenario_id!r}"
        )
    runtimes = frozenset(value.runtimes)
    if not runtimes or not runtimes.issubset(RUNTIMES):
        raise RunnerError(f"scenario {scenario_id} declares unsupported runtimes")
    evidence_path = Path(value.evidence_path)
    if (
        evidence_path.is_absolute()
        or ".." in evidence_path.parts
        or evidence_path.name != "result.json"
    ):
        raise RunnerError(f"scenario {scenario_id} has an invalid evidence path")
    if not callable(value.execute):
        raise RunnerError(f"scenario {scenario_id} execute is not callable")
    return ScenarioDefinition(
        scenario_id=scenario_id,
        journey_id=_require_identifier(value.journey_id, "journey id"),
        work_item_id=_require_identifier(value.work_item_id, "work item id"),
        runtimes=runtimes,
        evidence_path=evidence_path,
        execute=value.execute,
    )


def discover_scenarios() -> dict[str, ScenarioDefinition]:
    package = importlib.import_module(SCENARIO_PACKAGE)
    discovered: dict[str, ScenarioDefinition] = {}
    for module_info in sorted(
        pkgutil.iter_modules(package.__path__),
        key=lambda item: item.name,
    ):
        if module_info.name.startswith("_") or module_info.name.startswith("test_"):
            continue
        module_name = f"{SCENARIO_PACKAGE}.{module_info.name}"
        module = importlib.import_module(module_name)
        if not hasattr(module, "SCENARIO"):
            raise RunnerError(f"{module_name} does not export SCENARIO")
        scenario = _validate_definition(module.SCENARIO, module_name)
        if scenario.scenario_id in discovered:
            raise RunnerError(f"duplicate scenario id: {scenario.scenario_id}")
        discovered[scenario.scenario_id] = scenario
    return discovered


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )


def _decode_json_output(
    process: subprocess.CompletedProcess[str],
    action: str,
) -> Any:
    if process.returncode != 0:
        diagnostic = (process.stderr or process.stdout).strip()
        if len(diagnostic) > 2000:
            diagnostic = diagnostic[-2000:]
        raise RunnerError(
            f"{action} failed with exit code {process.returncode}: {diagnostic}"
        )
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RunnerError(f"{action} returned invalid JSON") from error


def _workspace_identity(
    repo_root: Path,
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, str]:
    process = command_runner(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        repo_root,
    )
    identity = _decode_json_output(process, "worktree binding capture")
    if not isinstance(identity, dict):
        raise RunnerError("worktree verifier returned a non-object identity")
    for field_name in ("root", "workspaceId", "branch", "head"):
        if not isinstance(identity.get(field_name), str) or not identity[field_name]:
            raise RunnerError(f"worktree identity is missing {field_name}")
    if Path(identity["root"]).resolve() != repo_root.resolve():
        raise RunnerError("worktree identity root differs from the runner repository")
    return identity


def _validate_active_declaration(
    value: Any,
    *,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise RunnerError("Development declaration is not an object")
    expected = {
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceHead": identity["head"],
        "state": ACTIVE_DECLARATION_STATE,
    }
    for field_name, expected_value in expected.items():
        if value.get(field_name) != expected_value:
            raise RunnerError(
                f"Development declaration {field_name} does not match "
                f"scenario/workspace identity"
            )
    for field_name in ("sessionId", "declarationId"):
        _require_identifier(value.get(field_name), f"declaration {field_name}")
    expected_declaration_id = (
        f"{scenario.work_item_id}-{identity['workspaceId']}"
    )
    if value["declarationId"] != expected_declaration_id:
        raise RunnerError("Development declaration id is not canonical")
    digest = value.get("declarationDigest")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise RunnerError("Development declaration digest is invalid")
    return value


def _active_scenario_declaration(
    *,
    repo_root: Path,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, Any]:
    status = _decode_json_output(
        command_runner(["make", "dev-status"], repo_root),
        "dev-status",
    )
    if not isinstance(status, dict):
        raise RunnerError("dev-status did not return an object")
    declarations = status.get("declarations")
    if not isinstance(declarations, list):
        raise RunnerError("dev-status did not return a declaration list")
    if status.get("workspaceId") != identity["workspaceId"]:
        raise RunnerError("dev-status workspace differs from the runner workspace")

    matches = [
        declaration
        for declaration in declarations
        if isinstance(declaration, dict)
        and declaration.get("workspaceId") == identity["workspaceId"]
        and declaration.get("journeyId") == scenario.journey_id
        and declaration.get("state") == ACTIVE_DECLARATION_STATE
    ]
    if len(matches) != 1:
        raise RunnerError(
            "expected exactly one active current-workspace declaration "
            f"for Journey {scenario.journey_id}, found {len(matches)}"
        )
    selected = _validate_active_declaration(
        matches[0],
        scenario=scenario,
        identity=identity,
    )

    checked = _decode_json_output(
        command_runner(
            [
                "make",
                "dev-check",
                f"WORK_ITEM={scenario.work_item_id}",
                f"SESSION={selected['sessionId']}",
            ],
            repo_root,
        ),
        "dev-check",
    )
    validated = _validate_active_declaration(
        checked,
        scenario=scenario,
        identity=identity,
    )
    _assert_declared_source_clean(
        declaration=validated,
        repo_root=repo_root,
        command_runner=command_runner,
    )
    return validated


def _assert_declared_source_clean(
    *,
    declaration: Mapping[str, Any],
    repo_root: Path,
    command_runner: CommandRunner,
) -> None:
    claims = declaration.get("sourceClaims")
    if not isinstance(claims, list) or not claims:
        raise RunnerError("Development declaration has no source claims")
    for claim in claims:
        if not isinstance(claim, dict):
            raise RunnerError("Development declaration has an invalid source claim")
        path_prefix = claim.get("pathPrefix")
        if not isinstance(path_prefix, str) or not path_prefix:
            raise RunnerError("Development declaration has an invalid source claim")
    process = command_runner(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        repo_root,
    )
    if process.returncode != 0:
        raise RunnerError("cannot verify declared source cleanliness")
    if process.stdout.strip():
        raise RunnerError(
            "declared source differs from sourceCommit; checkpoint before "
            "FUNCTIONAL_CHECK"
        )


def _default_result_root(workspace_id: str) -> Path:
    return (
        Path.home()
        / ".peers-touch/dev/workspaces"
        / workspace_id
        / "development/secure-content"
    )


def _assert_external_result_path(repo_root: Path, result_root: Path) -> None:
    resolved_repo = repo_root.resolve()
    resolved_result = result_root.resolve()
    if resolved_result == resolved_repo or resolved_repo in resolved_result.parents:
        raise RunnerError("Development result path must be outside the repository")


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


def _command_digest(
    *,
    scenario_id: str,
    runtime: str,
    profile: Optional[str],
    clients: Sequence[str],
    budget_seconds: int,
) -> str:
    payload = json.dumps(
        {
            "budgetSeconds": budget_seconds,
            "clients": list(clients),
            "profile": profile,
            "runtime": runtime,
            "scenarioId": scenario_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _runtime_binding_digest(
    *,
    declaration_digest: str,
    source_commit: str,
    runtime: str,
    profile: Optional[str],
    clients: Sequence[str],
    checks: Sequence[Mapping[str, Any]],
) -> str:
    check_commands = [
        {
            "id": check.get("id"),
            "commandDigest": hashlib.sha256(
                json.dumps(
                    check.get("command", []),
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
        }
        for check in checks
    ]
    payload = json.dumps(
        {
            "clients": list(clients),
            "declarationDigest": declaration_digest,
            "profile": profile,
            "runtime": runtime,
            "sourceCommit": source_commit,
            "checks": check_commands,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _failure_summary(
    error: Exception,
    checks: Sequence[Mapping[str, Any]],
) -> str:
    if isinstance(error, ScenarioBudgetExceeded):
        return "scenario exceeded the declared budget"
    if checks and checks[-1].get("result") == "FAIL":
        return (
            f"{checks[-1].get('id', 'scenario check')} failed with exit code "
            f"{checks[-1].get('exitCode')}"
        )
    return f"{type(error).__name__}: scenario execution failed"


def _write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


@contextmanager
def _scenario_budget(seconds: float) -> Iterator[None]:
    if (
        threading.current_thread() is not threading.main_thread()
        or not hasattr(signal, "SIGALRM")
        or not hasattr(signal, "setitimer")
    ):
        yield
        return

    def handle_timeout(_signum: int, _frame: Optional[FrameType]) -> None:
        raise ScenarioBudgetExceeded("scenario exceeded the declared budget")

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, handle_timeout)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    started = time.monotonic()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            elapsed = time.monotonic() - started
            restored = max(0.000001, previous_timer[0] - elapsed)
            signal.setitimer(signal.ITIMER_REAL, restored, previous_timer[1])


def _validated_detail(value: Any) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise RunnerError("scenario execute must return a mapping")
    collisions = sorted(RESULT_RESERVED_FIELDS.intersection(value))
    if collisions:
        raise RunnerError(
            "scenario detail cannot replace runner-owned fields: "
            + ", ".join(collisions)
        )
    return value


def execute_scenario(
    *,
    runtime: str,
    scenario_id: str,
    budget_seconds: int,
    repo_root: Path,
    profile: Optional[str] = None,
    clients: Sequence[str] = (),
    result_root: Optional[Path] = None,
    registry: Optional[Mapping[str, ScenarioDefinition]] = None,
    workspace_identity: Optional[Mapping[str, str]] = None,
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, Any]:
    normalized_scenario = _canonical_scenario_id(scenario_id)
    if runtime not in RUNTIMES:
        raise RunnerError(f"unsupported runtime: {runtime}")
    if budget_seconds <= 0:
        raise RunnerError("budget-seconds must be positive")
    if registry is None:
        registry = discover_scenarios()
    scenario = registry.get(normalized_scenario)
    if scenario is None:
        raise RunnerError(f"unknown scenario: {normalized_scenario}")
    if runtime not in scenario.runtimes:
        raise RunnerError(
            f"scenario {normalized_scenario} does not support runtime {runtime}"
        )

    identity = workspace_identity or _workspace_identity(repo_root, command_runner)
    for field_name in ("workspaceId", "branch", "head"):
        if not isinstance(identity.get(field_name), str) or not identity[field_name]:
            raise RunnerError(f"worktree identity is missing {field_name}")
    declaration = _active_scenario_declaration(
        repo_root=repo_root,
        scenario=scenario,
        identity=identity,
        command_runner=command_runner,
    )
    output_root = (
        result_root.resolve()
        if result_root is not None
        else _default_result_root(identity["workspaceId"]).resolve()
    )
    _assert_external_result_path(repo_root, output_root)
    output_path = output_root / scenario.evidence_path

    started_at = _timestamp()
    started_monotonic = time.monotonic()
    context = ScenarioContext(
        repo_root=repo_root,
        runtime=runtime,
        profile=profile,
        clients=tuple(clients),
        budget_seconds=budget_seconds,
        started_monotonic=started_monotonic,
    )
    failure: Optional[str] = None
    detail: Mapping[str, Any] = {}
    failure_kind = "PRODUCT_ASSERTION_FAILED"
    try:
        with _scenario_budget(context.remaining_seconds()):
            detail = _validated_detail(scenario.execute(context))
        context.remaining_seconds()
    except ScenarioBudgetExceeded as error:
        failure = _failure_summary(error, context.checks)
        failure_kind = "TIMEOUT"
    except Exception as error:
        failure = _failure_summary(error, context.checks)

    command_digest = _command_digest(
        scenario_id=scenario.scenario_id,
        runtime=runtime,
        profile=profile,
        clients=clients,
        budget_seconds=budget_seconds,
    )
    result: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "scenarioId": scenario.scenario_id,
        "runtime": runtime,
        "verificationClass": VERIFICATION_CLASS,
        "result": "FAIL" if failure else "PASS",
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceCommit": identity["head"],
        "sessionId": declaration["sessionId"],
        "declarationId": declaration["declarationId"],
        "declarationDigest": declaration["declarationDigest"],
        "runtimeBindingDigest": _runtime_binding_digest(
            declaration_digest=declaration["declarationDigest"],
            source_commit=identity["head"],
            runtime=runtime,
            profile=profile,
            clients=clients,
            checks=context.checks,
        ),
        "profile": profile,
        "clients": list(clients),
        "startedAt": started_at,
        "durationMs": int((time.monotonic() - started_monotonic) * 1000),
        "commandDigest": command_digest,
        "checks": context.checks,
        "artifactRefs": [str(output_path)],
    }
    result.update(detail)
    if failure:
        result["firstFailure"] = {
            "kind": failure_kind,
            "stage": "FUNCTIONAL_RUNNING",
            "owner": "source",
            "summary": failure,
            "retryable": False,
        }
    _write_json_atomic(output_path, result)
    if failure:
        raise ScenarioFailed(failure, output_path)
    return result


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Secure Content Development Journey")
    parser.add_argument("--runtime", required=True, choices=sorted(RUNTIMES))
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--profile")
    parser.add_argument("--clients", default="")
    parser.add_argument("--budget-seconds", required=True, type=int)
    parser.add_argument("--result-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    clients = tuple(value.strip() for value in args.clients.split(",") if value.strip())
    try:
        result = execute_scenario(
            runtime=args.runtime,
            scenario_id=args.scenario,
            budget_seconds=args.budget_seconds,
            repo_root=_repo_root(),
            profile=args.profile,
            clients=clients,
            result_root=args.result_root,
        )
    except ScenarioFailed as error:
        print(
            json.dumps(
                {
                    "status": "FAILED",
                    "message": str(error),
                    "resultPath": str(error.result_path),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except RunnerError as error:
        print(
            json.dumps(
                {"status": "BLOCKED", "message": str(error)},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
