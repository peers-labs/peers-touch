from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Optional, Sequence

import yaml


IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$", re.IGNORECASE)
REPO_PATH_PART = re.compile(
    r"^(?:[a-z0-9][a-z0-9._-]*|\.[a-z0-9][a-z0-9._-]*)$",
    re.IGNORECASE,
)
WORKSTREAM_ID = re.compile(r"^W(?:0R|0|[1-9][0-9]*)(?:[A-Z](?:-[A-Z]+)?)?$")
WORK_CLASSES = {"product-behavior", "infrastructure", "refactor", "documentation"}
SOURCE_MODES = {"shared-read", "exclusive-write"}
RUNTIME_MODES = {"shared", "exclusive"}
RUNTIME_KINDS = {
    "profile",
    "local.slot",
    "station.connect",
    "station.deploy",
    "station.reset",
    "client.storage",
    "fixture",
}
AUTHORIZATION_VALUES = {"allowed", "denied"}
LIVE_MUTATION_STATES = {"DECLARED", "ACTIVE"}

TOP_LEVEL_KEYS = {"planRef", "items"}
ITEM_KEYS = {
    "id",
    "workClass",
    "planRef",
    "taskId",
    "workstreamId",
    "productRefs",
    "architectureRefs",
    "journeyIds",
    "scope",
    "resources",
    "authorization",
}
SCOPE_KEYS = {"include", "exclude"}
RESOURCE_KEYS = {"sourceClaims", "runtimeClaims"}
SOURCE_CLAIM_KEYS = {"pathPrefix", "mode"}
RUNTIME_CLAIM_KEYS = {"kind", "resourceId", "mode"}
AUTHORIZATION_KEYS = {"checkpoint", "delivery", "runtime", "history"}
CHECKPOINT_KEYS = {"localCommit", "amend"}
DELIVERY_KEYS = {"push", "pullRequest"}
RUNTIME_AUTHORIZATION_KEYS = {"deployProfiles", "destructiveResetScopes"}
HISTORY_KEYS = {"rewrite"}

DEFAULT_MANIFEST = Path(
    "docs/architecture/secure-content/execution-plans/"
    "20260913-secure-content-work-items.yaml"
)


class ManifestError(ValueError):
    pass


class LedgerReadbackError(RuntimeError):
    pass


class CommandError(RuntimeError):
    pass


class StrictSafeLoader(yaml.SafeLoader):
    pass


def _construct_unique_mapping(
    loader: StrictSafeLoader,
    node: yaml.nodes.MappingNode,
    deep: bool = False,
) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ManifestError(f"duplicate field: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


@dataclass(frozen=True)
class WorkItemProjection:
    work_item_id: str
    workstream_id: str
    journey_id: Optional[str]
    work_class: str
    plan_ref: str
    task_id: str
    source_claim_arguments: tuple[str, ...]
    runtime_claim_arguments: tuple[str, ...]
    authorization: Mapping[str, Any]

    @property
    def purpose(self) -> str:
        return (
            f"Execute {self.work_item_id} ({self.workstream_id}) "
            "from the approved Secure Content plan"
        )


CommandRunner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]


def _require_exact_mapping(
    value: Any,
    *,
    field: str,
    keys: set[str],
) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{field} must be a mapping")
    actual = set(value)
    missing = sorted(keys - actual)
    unknown = sorted(actual - keys)
    if missing or unknown:
        raise ManifestError(
            f"{field} schema mismatch: missing={missing}, unknown={unknown}"
        )
    return value


def _require_text(value: Any, field: str, *, max_length: int = 1024) -> str:
    if not isinstance(value, str) or value == "" or value != value.strip():
        raise ManifestError(f"{field} must be a canonical non-empty string")
    if len(value) > max_length or "\0" in value or ";" in value:
        raise ManifestError(f"{field} is invalid")
    return value


def _require_identifier(value: Any, field: str) -> str:
    text = _require_text(value, field, max_length=128)
    if not IDENTIFIER.fullmatch(text):
        raise ManifestError(f"{field} has an invalid identifier")
    return text


def _require_string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ManifestError(f"{field} must be a list")
    result = [_require_text(item, f"{field}[]") for item in value]
    if len(result) != len(set(result)):
        raise ManifestError(f"{field} contains duplicates")
    return result


def _canonical_repo_path(value: Any, field: str) -> str:
    text = _require_text(value, field).replace("\\", "/")
    path = PurePosixPath(text)
    if path.is_absolute() or ".." in path.parts or text.startswith("./"):
        raise ManifestError(f"{field} must be repository-relative")
    normalized = path.as_posix().rstrip("/")
    if normalized in {"", "."} or any(
        not REPO_PATH_PART.fullmatch(part) for part in path.parts
    ):
        raise ManifestError(f"{field} must name a repository path")
    return normalized


def _validate_authorization(value: Any, field: str) -> Mapping[str, Any]:
    authorization = _require_exact_mapping(
        value,
        field=field,
        keys=AUTHORIZATION_KEYS,
    )
    checkpoint = _require_exact_mapping(
        authorization["checkpoint"],
        field=f"{field}.checkpoint",
        keys=CHECKPOINT_KEYS,
    )
    delivery = _require_exact_mapping(
        authorization["delivery"],
        field=f"{field}.delivery",
        keys=DELIVERY_KEYS,
    )
    runtime = _require_exact_mapping(
        authorization["runtime"],
        field=f"{field}.runtime",
        keys=RUNTIME_AUTHORIZATION_KEYS,
    )
    history = _require_exact_mapping(
        authorization["history"],
        field=f"{field}.history",
        keys=HISTORY_KEYS,
    )
    for owner, child_field, fields in (
        (checkpoint, "checkpoint", CHECKPOINT_KEYS),
        (delivery, "delivery", DELIVERY_KEYS),
        (history, "history", HISTORY_KEYS),
    ):
        for key in fields:
            if owner[key] not in AUTHORIZATION_VALUES:
                raise ManifestError(
                    f"{field}.{child_field}.{key} must be allowed or denied"
                )
    _require_string_list(runtime["deployProfiles"], f"{field}.runtime.deployProfiles")
    _require_string_list(
        runtime["destructiveResetScopes"],
        f"{field}.runtime.destructiveResetScopes",
    )
    return authorization


def _path_is_in_scope(path: str, includes: Sequence[str]) -> bool:
    return any(path == prefix or path.startswith(prefix + "/") for prefix in includes)


def _validate_item(
    raw: Any,
    *,
    top_plan_ref: str,
    enforce_execution_authorization: bool,
) -> WorkItemProjection:
    item = _require_exact_mapping(raw, field="item", keys=ITEM_KEYS)

    work_item_id = _require_identifier(item["id"], "item.id")
    if work_item_id != work_item_id.lower():
        raise ManifestError("item.id must use the lowercase project convention")
    workstream_id = _require_text(item["workstreamId"], "item.workstreamId", max_length=16)
    if not WORKSTREAM_ID.fullmatch(workstream_id):
        raise ManifestError("item.workstreamId is invalid")
    task_id = _require_identifier(item["taskId"], "item.taskId")
    work_class = _require_text(item["workClass"], "item.workClass", max_length=32)
    if work_class not in WORK_CLASSES:
        raise ManifestError(f"unsupported work class: {work_class}")
    plan_ref = _canonical_repo_path(item["planRef"], "item.planRef")
    if plan_ref != top_plan_ref:
        raise ManifestError("item.planRef differs from the manifest planRef")

    for field in ("productRefs", "architectureRefs", "journeyIds"):
        for value in _require_string_list(item[field], f"item.{field}"):
            _require_identifier(value, f"item.{field}[]")

    scope = _require_exact_mapping(item["scope"], field="item.scope", keys=SCOPE_KEYS)
    includes = [
        _canonical_repo_path(path, "item.scope.include[]")
        for path in _require_string_list(scope["include"], "item.scope.include")
    ]
    if not includes:
        raise ManifestError("item.scope.include must not be empty")
    _require_string_list(scope["exclude"], "item.scope.exclude")

    resources = _require_exact_mapping(
        item["resources"],
        field="item.resources",
        keys=RESOURCE_KEYS,
    )
    source_claims = resources["sourceClaims"]
    runtime_claims = resources["runtimeClaims"]
    if not isinstance(source_claims, list) or not source_claims:
        raise ManifestError("item.resources.sourceClaims must be a non-empty list")
    if not isinstance(runtime_claims, list):
        raise ManifestError("item.resources.runtimeClaims must be a list")

    source_by_path: dict[str, str] = {}
    for index, raw_claim in enumerate(source_claims):
        claim = _require_exact_mapping(
            raw_claim,
            field=f"item.resources.sourceClaims[{index}]",
            keys=SOURCE_CLAIM_KEYS,
        )
        mode = _require_text(claim["mode"], "source claim mode", max_length=32)
        if mode not in SOURCE_MODES:
            raise ManifestError(f"unsupported source claim mode: {mode}")
        path = _canonical_repo_path(claim["pathPrefix"], "source claim pathPrefix")
        if mode == "exclusive-write" and not _path_is_in_scope(path, includes):
            raise ManifestError(f"source claim is outside item.scope.include: {path}")
        current_mode = source_by_path.get(path)
        if current_mode is None or mode == "exclusive-write":
            source_by_path[path] = mode

    runtime_by_key: dict[tuple[str, str], str] = {}
    profile_ids: set[str] = set()
    reset_ids: set[str] = set()
    for index, raw_claim in enumerate(runtime_claims):
        claim = _require_exact_mapping(
            raw_claim,
            field=f"item.resources.runtimeClaims[{index}]",
            keys=RUNTIME_CLAIM_KEYS,
        )
        kind = _require_text(claim["kind"], "runtime claim kind", max_length=64)
        resource_id = _require_identifier(
            claim["resourceId"],
            "runtime claim resourceId",
        )
        mode = _require_text(claim["mode"], "runtime claim mode", max_length=32)
        if kind not in RUNTIME_KINDS:
            raise ManifestError(f"unsupported runtime kind: {kind}")
        if mode not in RUNTIME_MODES:
            raise ManifestError(f"unsupported runtime mode: {mode}")
        key = (kind, resource_id)
        current_mode = runtime_by_key.get(key)
        if current_mode is None or mode == "exclusive":
            runtime_by_key[key] = mode
        if kind == "profile":
            profile_ids.add(resource_id)
        if kind == "station.reset":
            reset_ids.add(resource_id)

    authorization = _validate_authorization(item["authorization"], "item.authorization")
    deploy_profiles = set(authorization["runtime"]["deployProfiles"])
    if not deploy_profiles.issubset(profile_ids):
        raise ManifestError("deployProfiles must name declared profile resources")
    reset_scopes = set(authorization["runtime"]["destructiveResetScopes"])
    if reset_scopes and reset_scopes != reset_ids:
        raise ManifestError(
            "destructiveResetScopes must exactly match station.reset resources"
        )
    if enforce_execution_authorization and reset_ids != reset_scopes:
        raise ManifestError(
            "station.reset intent is denied until destructiveResetScopes exactly authorize it"
        )

    return WorkItemProjection(
        work_item_id=work_item_id,
        workstream_id=workstream_id,
        journey_id=None,
        work_class=work_class,
        plan_ref=plan_ref,
        task_id=task_id,
        source_claim_arguments=tuple(
            f"{mode}:{path}"
            for path, mode in sorted(source_by_path.items())
        ),
        runtime_claim_arguments=tuple(
            f"{mode}:{kind}:{resource_id}"
            for (kind, resource_id), mode in sorted(runtime_by_key.items())
        ),
        authorization=authorization,
    )


def load_projection(
    manifest_path: Path,
    *,
    workstream: str,
    journey: Optional[str],
    repo_root: Path,
) -> WorkItemProjection:
    try:
        raw = yaml.load(manifest_path.read_text(encoding="utf-8"), Loader=StrictSafeLoader)
    except (OSError, yaml.YAMLError) as error:
        raise ManifestError(f"cannot read work-item manifest: {error}") from error
    manifest = _require_exact_mapping(raw, field="manifest", keys=TOP_LEVEL_KEYS)
    plan_ref = _canonical_repo_path(manifest["planRef"], "manifest.planRef")
    if not (repo_root / plan_ref).is_file():
        raise ManifestError(f"manifest.planRef does not exist: {plan_ref}")
    if not isinstance(manifest["items"], list) or not manifest["items"]:
        raise ManifestError("manifest.items must be a non-empty list")

    projections: list[WorkItemProjection] = []
    raw_by_workstream: dict[str, Mapping[str, Any]] = {}
    item_ids: set[str] = set()
    for raw_item in manifest["items"]:
        projection = _validate_item(
            raw_item,
            top_plan_ref=plan_ref,
            enforce_execution_authorization=False,
        )
        if projection.work_item_id in item_ids:
            raise ManifestError(f"duplicate work item id: {projection.work_item_id}")
        if projection.workstream_id in raw_by_workstream:
            raise ManifestError(f"duplicate workstream id: {projection.workstream_id}")
        item_ids.add(projection.work_item_id)
        raw_by_workstream[projection.workstream_id] = raw_item
        projections.append(projection)

    if workstream not in raw_by_workstream:
        raise ManifestError(f"unknown workstream: {workstream}")
    projection = _validate_item(
        raw_by_workstream[workstream],
        top_plan_ref=plan_ref,
        enforce_execution_authorization=True,
    )
    journey_ids = raw_by_workstream[workstream]["journeyIds"]
    if journey is None and journey_ids:
        raise ManifestError("a declared --journey is required for this workstream")
    if journey is not None:
        _require_identifier(journey, "journey")
        if journey not in journey_ids:
            raise ManifestError(
                f"journey {journey!r} is not declared by workstream {workstream}"
            )

    return WorkItemProjection(
        work_item_id=projection.work_item_id,
        workstream_id=projection.workstream_id,
        journey_id=journey,
        work_class=projection.work_class,
        plan_ref=projection.plan_ref,
        task_id=projection.task_id,
        source_claim_arguments=projection.source_claim_arguments,
        runtime_claim_arguments=projection.runtime_claim_arguments,
        authorization=projection.authorization,
    )


def _run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )


def _decode_json_output(process: subprocess.CompletedProcess[str], action: str) -> Any:
    if process.returncode != 0:
        diagnostic = (process.stderr or process.stdout).strip()
        if len(diagnostic) > 2000:
            diagnostic = diagnostic[-2000:]
        raise CommandError(
            f"{action} failed with exit code {process.returncode}: "
            f"{diagnostic}"
        )
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise CommandError(f"{action} returned invalid JSON") from error


def _resolve_default_owner(
    repo_root: Path,
    command_runner: CommandRunner,
) -> str:
    process = command_runner(["git", "config", "user.email"], repo_root)
    if process.returncode != 0:
        raise CommandError("cannot resolve the Development work owner")
    try:
        return _require_text(
            process.stdout.strip(),
            "owner",
            max_length=256,
        )
    except ManifestError as error:
        raise CommandError("Development work owner is not configured") from error


def _canonical_source_claims(projection: WorkItemProjection) -> list[dict[str, str]]:
    claims = []
    for value in projection.source_claim_arguments:
        mode, path_prefix = value.split(":", 1)
        claims.append({"pathPrefix": path_prefix, "mode": mode})
    return sorted(claims, key=lambda claim: claim["pathPrefix"])


def _canonical_runtime_claims(projection: WorkItemProjection) -> list[dict[str, str]]:
    claims = []
    for value in projection.runtime_claim_arguments:
        mode, kind, resource_id = value.split(":", 2)
        claims.append({"kind": kind, "resourceId": resource_id, "mode": mode})
    return sorted(claims, key=lambda claim: f"{claim['kind']}:{claim['resourceId']}")


def _normalized_readback_claims(
    value: Any,
    *,
    keys: set[str],
    sort_fields: tuple[str, ...],
) -> Optional[list[dict[str, str]]]:
    if not isinstance(value, list):
        return None
    normalized: list[dict[str, str]] = []
    for claim in value:
        if (
            not isinstance(claim, dict)
            or set(claim) != keys
            or any(not isinstance(claim[key], str) for key in keys)
        ):
            return None
        normalized.append({key: claim[key] for key in keys})
    return sorted(
        normalized,
        key=lambda claim: tuple(claim[field] for field in sort_fields),
    )


def _validate_readback(
    declaration: Any,
    projection: WorkItemProjection,
    *,
    session: Optional[str],
) -> Mapping[str, Any]:
    if not isinstance(declaration, dict):
        raise LedgerReadbackError("ledger declaration is not an object")
    expected = {
        "workItemId": projection.work_item_id,
        "journeyId": projection.journey_id,
        "planPath": projection.plan_ref,
        "taskId": projection.task_id,
        "purpose": projection.purpose,
    }
    for field, value in expected.items():
        if declaration.get(field) != value:
            raise LedgerReadbackError(
                f"ledger readback differs from YAML for {field}"
            )
    source_claims = _normalized_readback_claims(
        declaration.get("sourceClaims"),
        keys=SOURCE_CLAIM_KEYS,
        sort_fields=("pathPrefix", "mode"),
    )
    if source_claims != _canonical_source_claims(projection):
        raise LedgerReadbackError("ledger readback differs from YAML for sourceClaims")
    runtime_claims = _normalized_readback_claims(
        declaration.get("runtimeClaims"),
        keys=RUNTIME_CLAIM_KEYS,
        sort_fields=("kind", "resourceId", "mode"),
    )
    if runtime_claims != _canonical_runtime_claims(projection):
        raise LedgerReadbackError("ledger readback differs from YAML for runtimeClaims")
    if session is not None and declaration.get("sessionId") != session:
        raise LedgerReadbackError("ledger readback differs from requested session")
    if declaration.get("state") not in LIVE_MUTATION_STATES:
        raise LedgerReadbackError("ledger readback is not live after mutation")
    workspace_id = declaration.get("workspaceId")
    if not isinstance(workspace_id, str) or not re.fullmatch(
        r"[0-9a-f]{16}",
        workspace_id,
    ):
        raise LedgerReadbackError("ledger readback has an invalid workspace id")
    if declaration.get("declarationId") != (
        f"{projection.work_item_id}-{workspace_id}"
    ):
        raise LedgerReadbackError("ledger readback has a non-canonical declaration id")
    if not isinstance(declaration.get("branch"), str) or not declaration["branch"]:
        raise LedgerReadbackError("ledger readback has an invalid branch")
    if not isinstance(declaration.get("sourceHead"), str) or not re.fullmatch(
        r"[0-9a-f]{40,64}",
        declaration["sourceHead"],
    ):
        raise LedgerReadbackError("ledger readback has an invalid source head")
    digest = declaration.get("declarationDigest")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise LedgerReadbackError("ledger readback has an invalid declaration digest")
    return declaration


def execute_projection(
    action: str,
    projection: WorkItemProjection,
    *,
    repo_root: Path,
    session: Optional[str] = None,
    owner: Optional[str] = None,
    expires_minutes: int = 480,
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, Any]:
    if action not in {"start", "update"}:
        raise ManifestError("action must be start or update")
    if expires_minutes < 1 or expires_minutes > 1440:
        raise ManifestError("expires_minutes must be within 1..1440")
    resolved_owner = owner
    if action == "start" and resolved_owner is None:
        resolved_owner = _resolve_default_owner(repo_root, command_runner)

    command = [
        "node",
        "tooling/scripts/local-dev/dev-work.mjs",
        action,
        "--work-item",
        projection.work_item_id,
        "--plan",
        projection.plan_ref,
        "--task",
        projection.task_id,
        "--purpose",
        projection.purpose,
        "--source-claims",
        ";".join(projection.source_claim_arguments),
        "--runtime-claims",
        ";".join(projection.runtime_claim_arguments),
        "--expires-minutes",
        str(expires_minutes),
    ]
    if projection.journey_id is not None:
        command.extend(("--journey", projection.journey_id))
    if session is not None:
        command.extend(("--session", _require_identifier(session, "session")))
    if resolved_owner is not None:
        command.extend(
            ("--owner", _require_text(resolved_owner, "owner", max_length=256))
        )

    mutation = command_runner(command, repo_root)
    mutation_declaration = _decode_json_output(mutation, f"development {action}")

    status = command_runner(
        [
            "node",
            "tooling/scripts/local-dev/dev-work.mjs",
            "status",
            "--work-item",
            projection.work_item_id,
        ],
        repo_root,
    )
    status_payload = _decode_json_output(status, "dev-status")
    declarations = status_payload.get("declarations") if isinstance(status_payload, dict) else None
    if not isinstance(declarations, list) or len(declarations) != 1:
        raise LedgerReadbackError("ledger readback did not return exactly one declaration")
    if status_payload.get("workspaceId") != declarations[0].get("workspaceId"):
        raise LedgerReadbackError("ledger readback workspace id is inconsistent")
    declaration = _validate_readback(
        declarations[0],
        projection,
        session=session,
    )
    mutation_readback = _validate_readback(
        mutation_declaration,
        projection,
        session=session,
    )
    if mutation_readback.get("declarationDigest") != declaration["declarationDigest"]:
        raise LedgerReadbackError("mutation output digest differs from ledger readback")
    return declaration


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Project Secure Content work items into the Development ledger")
    parser.add_argument("action", choices=("start", "update"))
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--workstream", required=True)
    parser.add_argument("--journey")
    parser.add_argument("--session")
    parser.add_argument("--owner")
    parser.add_argument("--expires-minutes", type=int, default=480)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    root = _repo_root()
    manifest = args.manifest
    if not manifest.is_absolute():
        manifest = root / manifest
    try:
        projection = load_projection(
            manifest,
            workstream=args.workstream,
            journey=args.journey,
            repo_root=root,
        )
        declaration = execute_projection(
            args.action,
            projection,
            repo_root=root,
            session=args.session,
            owner=args.owner,
            expires_minutes=args.expires_minutes,
        )
    except (ManifestError, LedgerReadbackError, CommandError) as error:
        print(
            json.dumps(
                {"status": "BLOCKED", "error": type(error).__name__, "message": str(error)},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(declaration, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
