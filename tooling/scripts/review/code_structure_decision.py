#!/usr/bin/env python3
"""Record and verify source-bound code-structure review decisions."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (  # noqa: E402
    ArtifactSession,
    EvidenceStore,
    source_identity,
)
from tooling.acceptance.core.errors import (  # noqa: E402
    EvidenceError,
    EvidenceManifestInvalid,
)


ARTIFACT_KIND = "code-structure-review-decision"
PREPARATION_KIND = "code-structure-review-preparation"
SCHEMA_VERSION = 2
GATE_ID = "code-structure-review"
ARTIFACT_ROLE = "decision"
RULE_IDS = tuple(f"STRUCT-{index:02d}" for index in range(1, 10))
VERDICTS = {"PASS", "PASS_WITH_SUGGESTIONS", "REFACTOR_REQUIRED"}
INPUT_KEYS = {"findings"}
FINDING_KEYS = {
    "findingId",
    "primaryRuleId",
    "relatedRuleIds",
    "blocking",
    "location",
    "observedStructure",
    "consequence",
    "correction",
    "exception",
}
LOCATION_KEYS = {"path", "lineStart", "lineEnd"}
RECORD_KEYS = {
    "artifactKind",
    "schemaVersion",
    "target",
    "rubricHash",
    "verdict",
    "findings",
    "blockingRuleIds",
    "suggestionRuleIds",
    "signalsReviewed",
    "coverage",
    "exceptionsApplied",
}
RUBRIC_FILES = (
    "tooling/skills/pt-code-structure-review/SKILL.md",
    "tooling/skills/pt-code-structure-review/references/rubric.md",
    "tooling/skills/pt-code-structure-review/references/examples.md",
    "tooling/review-fixtures/code-structure/cases.json",
)


class DecisionInvalid(ValueError):
    """Raised when a structural review decision violates its schema."""


def _require_exact_keys(
    value: object,
    expected: set[str],
    field: str,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != expected:
        raise DecisionInvalid(
            f"{field} must contain exactly: {', '.join(sorted(expected))}"
        )
    return value


def _require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DecisionInvalid(f"{field} must be a non-empty string")
    return value


def _require_rule_ids(value: object, field: str) -> list[str]:
    if (
        not isinstance(value, list)
        or any(not isinstance(item, str) or item not in RULE_IDS for item in value)
        or len(set(value)) != len(value)
    ):
        raise DecisionInvalid(f"{field} must contain unique stable rule IDs")
    return list(value)


def changed_paths(repo_root: Path, diff_range: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", diff_range, "--"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = {line for line in completed.stdout.splitlines() if line}
    if diff_range == "HEAD":
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        paths.update(line for line in untracked.stdout.splitlines() if line)
    return sorted(paths)


def _resolve_commit(repo_root: Path, revision: str) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", f"{revision}^{{commit}}"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def resolve_range(repo_root: Path, diff_range: str) -> tuple[str, str]:
    current = _resolve_commit(repo_root, "HEAD")
    if diff_range == "HEAD":
        return current, current
    if "..." in diff_range:
        left, right = diff_range.split("...", 1)
        head = _resolve_commit(repo_root, right)
        merge_base = subprocess.run(
            ["git", "merge-base", left, right],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        return merge_base, head
    if ".." in diff_range:
        left, right = diff_range.split("..", 1)
        return _resolve_commit(repo_root, left), _resolve_commit(repo_root, right)
    return _resolve_commit(repo_root, diff_range), current


def reviewable_source_paths(repo_root: Path, paths: list[str]) -> list[str]:
    return [
        item["path"]
        for item in classify_source_paths(repo_root, paths)
        if item["status"] == "REVIEW"
    ]


def classify_source_paths(
    repo_root: Path,
    paths: list[str],
) -> list[dict[str, str]]:
    classifier = (
        repo_root
        / "tooling"
        / "skills"
        / "pt-code-structure-review"
        / "scripts"
        / "structure-signals.mjs"
    )
    completed = subprocess.run(
        [
            "node",
            str(classifier),
            "--classify-stdin",
            "--format",
            "json",
        ],
        cwd=repo_root,
        input="\n".join(paths) + ("\n" if paths else ""),
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)
    files = result.get("files")
    if not isinstance(files, list):
        raise DecisionInvalid("source classifier returned an invalid result")
    return files


def structure_signals(
    repo_root: Path,
    paths: list[str],
) -> list[dict[str, Any]]:
    analyzer = (
        repo_root
        / "tooling"
        / "skills"
        / "pt-code-structure-review"
        / "scripts"
        / "structure-signals.mjs"
    )
    completed = subprocess.run(
        ["node", str(analyzer), "--files-stdin", "--format", "json"],
        cwd=repo_root,
        input="\n".join(paths) + ("\n" if paths else ""),
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)
    signals = result.get("signals")
    if not isinstance(signals, list):
        raise DecisionInvalid("structure signal analyzer returned an invalid result")
    return signals


def structure_signal_keys(repo_root: Path, paths: list[str]) -> list[str]:
    return sorted(
        f"{item['code']}@{item['path']}"
        for item in structure_signals(repo_root, paths)
    )


def rubric_hash(repo_root: Path) -> str:
    digest = hashlib.sha256()
    for relative in RUBRIC_FILES:
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update((repo_root / relative).read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _normalize_repo_path(repo_root: Path, requested: str) -> str:
    raw = Path(requested)
    if raw.is_absolute() or ".." in raw.parts:
        raise DecisionInvalid("--path must be repository-relative")
    candidate = (repo_root / raw).resolve()
    try:
        relative = candidate.relative_to(repo_root.resolve())
    except ValueError as error:
        raise DecisionInvalid("--path escapes the repository") from error
    if not candidate.exists():
        raise DecisionInvalid(f"review path does not exist: {requested}")
    normalized = relative.as_posix()
    return normalized if normalized else "."


def path_scope_paths(
    repo_root: Path,
    requested: str,
    depth: int | None,
) -> tuple[str, list[str]]:
    normalized = _normalize_repo_path(repo_root, requested)
    selected = repo_root if normalized == "." else repo_root / normalized
    if selected.is_file():
        if depth is not None:
            raise DecisionInvalid("--depth is only valid when --path is a directory")
        return normalized, [normalized]
    if depth is not None and depth < 1:
        raise DecisionInvalid("--depth must be at least 1")

    completed = subprocess.run(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            normalized,
        ],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    files = sorted(
        {
            line
            for line in completed.stdout.splitlines()
            if line and (repo_root / line).is_file()
        }
    )
    if depth is None:
        return normalized, files
    prefix = Path() if normalized == "." else Path(normalized)
    return normalized, [
        item
        for item in files
        if len(Path(item).relative_to(prefix).parts) <= depth
    ]


def resolve_pr(
    repo_root: Path,
    requested: str,
) -> tuple[dict[str, Any], str]:
    try:
        completed = subprocess.run(
            [
                "gh",
                "pr",
                "view",
                requested,
                "--json",
                "baseRefOid,headRefOid,number,url",
            ],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise DecisionInvalid("--pr requires the GitHub CLI (gh)") from error
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "GitHub CLI could not resolve the PR"
        raise DecisionInvalid(f"unable to resolve --pr {requested}: {detail}")
    data = json.loads(completed.stdout)
    base = _require_text(data.get("baseRefOid"), "PR baseRefOid")
    head = _require_text(data.get("headRefOid"), "PR headRefOid")
    number = data.get("number")
    if not isinstance(number, int) or isinstance(number, bool):
        raise DecisionInvalid("PR number must be an integer")
    url = _require_text(data.get("url"), "PR url")
    diff_range = f"{base}...{head}"
    return {
        "kind": "pr",
        "requested": requested,
        "number": number,
        "url": url,
        "range": diff_range,
    }, diff_range


def resolve_review_target(
    repo_root: Path,
    selector: Mapping[str, Any],
    paths: list[str] | None = None,
) -> dict[str, Any]:
    kind = selector.get("kind")
    allow_dirty = False
    if kind == "range":
        diff_range = _require_text(selector.get("range"), "selector.range")
        descriptor = {"kind": "range", "range": diff_range}
        all_paths = changed_paths(repo_root, diff_range) if paths is None else paths
        allow_dirty = diff_range == "HEAD"
    elif kind == "path":
        requested = _require_text(selector.get("path"), "selector.path")
        depth = selector.get("depth")
        if depth is not None and (
            not isinstance(depth, int) or isinstance(depth, bool)
        ):
            raise DecisionInvalid("selector.depth must be an integer or null")
        normalized, all_paths = path_scope_paths(repo_root, requested, depth)
        descriptor = {"kind": "path", "path": normalized, "depth": depth}
        diff_range = "HEAD"
        allow_dirty = True
    elif kind == "pr":
        requested = _require_text(selector.get("pr"), "selector.pr")
        descriptor, diff_range = resolve_pr(repo_root, requested)
        all_paths = changed_paths(repo_root, diff_range)
    else:
        raise DecisionInvalid("review selector kind must be range, path, or pr")

    base_commit, head_commit = resolve_range(repo_root, diff_range)
    source = source_identity(repo_root)
    if head_commit != source["commit"]:
        raise DecisionInvalid(
            "review target head must match the checked-out source commit"
        )
    if not allow_dirty and source["workspaceDigest"] != "clean":
        raise DecisionInvalid(
            "an explicit range or PR review requires a clean workspace"
        )
    scoped_files = classify_source_paths(repo_root, all_paths)
    reviewed_files = [
        item["path"] for item in scoped_files if item["status"] == "REVIEW"
    ]
    target: dict[str, Any] = {
        "selector": descriptor,
        "baseCommit": base_commit,
        "headCommit": head_commit,
        "source": source,
        "scopeFiles": scoped_files,
        "reviewedFiles": reviewed_files,
    }
    encoded = json.dumps(
        target,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    target["scopeId"] = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    return target


def review_target(
    repo_root: Path,
    diff_range: str,
    paths: list[str] | None = None,
) -> dict[str, Any]:
    return resolve_review_target(
        repo_root,
        {"kind": "range", "range": diff_range},
        paths,
    )


def normalize_findings(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise DecisionInvalid("findings must be an array")

    findings: list[dict[str, Any]] = []
    finding_ids: set[str] = set()
    for index, raw_finding in enumerate(value):
        finding = _require_exact_keys(
            raw_finding,
            FINDING_KEYS,
            f"findings[{index}]",
        )
        finding_id = _require_text(
            finding["findingId"],
            f"findings[{index}].findingId",
        )
        if finding_id in finding_ids:
            raise DecisionInvalid(f"duplicate findingId: {finding_id}")
        finding_ids.add(finding_id)

        primary = finding["primaryRuleId"]
        if primary not in RULE_IDS:
            raise DecisionInvalid(
                f"findings[{index}].primaryRuleId must be a stable rule ID"
            )
        related = _require_rule_ids(
            finding["relatedRuleIds"],
            f"findings[{index}].relatedRuleIds",
        )
        if primary in related:
            raise DecisionInvalid(
                f"findings[{index}] cannot repeat its primary rule as related"
            )
        if not isinstance(finding["blocking"], bool):
            raise DecisionInvalid(f"findings[{index}].blocking must be boolean")

        location = _require_exact_keys(
            finding["location"],
            LOCATION_KEYS,
            f"findings[{index}].location",
        )
        _require_text(location["path"], f"findings[{index}].location.path")
        line_start = location["lineStart"]
        line_end = location["lineEnd"]
        if (
            not isinstance(line_start, int)
            or isinstance(line_start, bool)
            or not isinstance(line_end, int)
            or isinstance(line_end, bool)
            or line_start < 1
            or line_end < line_start
        ):
            raise DecisionInvalid(
                f"findings[{index}].location must contain a valid line range"
            )

        for field in (
            "observedStructure",
            "consequence",
            "correction",
            "exception",
        ):
            _require_text(finding[field], f"findings[{index}].{field}")
        findings.append(dict(finding))
    return findings


def build_coverage(
    target: Mapping[str, Any],
    findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    scoped_files = target.get("scopeFiles")
    if not isinstance(scoped_files, list):
        raise DecisionInvalid("target.scopeFiles must be an array")
    finding_ids_by_path: dict[str, list[str]] = {}
    for finding in findings:
        path = finding["location"]["path"]
        finding_ids_by_path.setdefault(path, []).append(finding["findingId"])

    coverage: list[dict[str, Any]] = []
    for index, item in enumerate(scoped_files):
        classification = _require_exact_keys(
            item,
            {"path", "status", "reason"},
            f"target.scopeFiles[{index}]",
        )
        path = _require_text(
            classification["path"],
            f"target.scopeFiles[{index}].path",
        )
        status = classification["status"]
        reason = _require_text(
            classification["reason"],
            f"target.scopeFiles[{index}].reason",
        )
        finding_ids = sorted(finding_ids_by_path.get(path, []))
        if status == "REVIEW":
            coverage.append(
                {
                    "path": path,
                    "status": "FINDING" if finding_ids else "PASS",
                    "reason": (
                        "findings-recorded"
                        if finding_ids
                        else "reviewed-no-finding"
                    ),
                    "findingIds": finding_ids,
                }
            )
        elif status == "SKIPPED":
            if finding_ids:
                raise DecisionInvalid(
                    f"findings cannot point to skipped file: {path}"
                )
            coverage.append(
                {
                    "path": path,
                    "status": "SKIPPED",
                    "reason": reason,
                    "findingIds": [],
                }
            )
        else:
            raise DecisionInvalid(
                f"target.scopeFiles[{index}].status is invalid"
            )
    return coverage


def build_decision(
    payload: object,
    *,
    target: Mapping[str, Any],
    rubric_digest: str,
    signals: list[str] | None = None,
) -> dict[str, Any]:
    raw = _require_exact_keys(payload, INPUT_KEYS, "decision input")
    findings = normalize_findings(raw["findings"])
    reviewed_files = target.get("reviewedFiles")
    if not isinstance(reviewed_files, list):
        raise DecisionInvalid("target.reviewedFiles must be an array")
    for finding in findings:
        if finding["location"]["path"] not in reviewed_files:
            raise DecisionInvalid(
                f"{finding['findingId']} points outside reviewedFiles"
            )
    if signals is None:
        signals = []
    if (
        any(not isinstance(item, str) or not item.strip() for item in signals)
        or len(set(signals)) != len(signals)
    ):
        raise DecisionInvalid(
            "signalsReviewed must contain unique non-empty strings"
        )

    blocking = sorted(
        {
            finding["primaryRuleId"]
            for finding in findings
            if finding["blocking"]
        }
    )
    suggestions = sorted(
        {
            finding["primaryRuleId"]
            for finding in findings
            if not finding["blocking"]
        }
    )
    exceptions = sorted(
        {
            finding["exception"]
            for finding in findings
            if finding["exception"] != "none"
        }
    )
    verdict = (
        "REFACTOR_REQUIRED"
        if blocking
        else "PASS_WITH_SUGGESTIONS"
        if suggestions
        else "PASS"
    )
    return {
        "artifactKind": ARTIFACT_KIND,
        "schemaVersion": SCHEMA_VERSION,
        "target": dict(target),
        "rubricHash": rubric_digest,
        "verdict": verdict,
        "findings": findings,
        "blockingRuleIds": blocking,
        "suggestionRuleIds": suggestions,
        "signalsReviewed": sorted(signals),
        "coverage": build_coverage(target, findings),
        "exceptionsApplied": exceptions,
    }


def validate_decision(
    value: object,
    *,
    expected_target: Mapping[str, Any],
    expected_rubric_hash: str,
    expected_signal_keys: list[str] | None = None,
) -> dict[str, Any]:
    record = _require_exact_keys(value, RECORD_KEYS, "decision record")
    if record["artifactKind"] != ARTIFACT_KIND:
        raise DecisionInvalid("decision record has an invalid artifactKind")
    if record["schemaVersion"] != SCHEMA_VERSION:
        raise DecisionInvalid("decision record has an unsupported schemaVersion")
    if record["target"] != expected_target:
        raise DecisionInvalid("decision record target is stale")
    if record["rubricHash"] != expected_rubric_hash:
        raise DecisionInvalid("decision record rubricHash is stale")
    if record["verdict"] not in VERDICTS:
        raise DecisionInvalid("decision record has an invalid verdict")

    rebuilt = build_decision(
        {"findings": record["findings"]},
        target=expected_target,
        rubric_digest=expected_rubric_hash,
        signals=(
            expected_signal_keys
            if expected_signal_keys is not None
            else record["signalsReviewed"]
        ),
    )
    if (
        expected_signal_keys is not None
        and sorted(record["signalsReviewed"]) != sorted(expected_signal_keys)
    ):
        raise DecisionInvalid(
            "decision record does not account for every current advisory signal"
        )
    if dict(record) != rebuilt:
        raise DecisionInvalid(
            "decision record derived fields disagree with its findings"
        )
    return rebuilt


def collect_latest_decision(
    *,
    repo_root: Path,
    store: EvidenceStore,
    diff_range: str,
    paths: list[str],
) -> dict[str, Any]:
    return collect_latest_decision_for_target(
        repo_root=repo_root,
        store=store,
        selector={"kind": "range", "range": diff_range},
        paths=paths,
    )


def collect_latest_decision_for_target(
    *,
    repo_root: Path,
    store: EvidenceStore,
    selector: Mapping[str, Any],
    paths: list[str] | None = None,
) -> dict[str, Any]:
    target = resolve_review_target(repo_root, selector, paths)
    expected_signals = structure_signal_keys(
        repo_root,
        target["reviewedFiles"],
    )
    required = bool(target["reviewedFiles"])
    if not required:
        return {
            "required": False,
            "status": "NOT_REQUIRED",
            "decision": None,
            "artifactRef": None,
            "error": None,
        }

    try:
        reference = store.latest_artifact_ref(GATE_ID, ARTIFACT_ROLE)
    except EvidenceError as error:
        missing_message = f"latest pointer is unavailable for {GATE_ID}"
        status = (
            "MISSING"
            if isinstance(error, EvidenceManifestInvalid)
            and str(error) == missing_message
            else "INVALID"
        )
        return {
            "required": True,
            "status": status,
            "decision": None,
            "artifactRef": None,
            "error": f"{type(error).__name__}: {error}",
        }

    try:
        raw = store.read_json(reference)
        decision = validate_decision(
            raw,
            expected_target=target,
            expected_rubric_hash=rubric_hash(repo_root),
            expected_signal_keys=expected_signals,
        )
    except (EvidenceError, DecisionInvalid, OSError, json.JSONDecodeError) as error:
        status = "INVALID"
        if isinstance(error, DecisionInvalid) and "stale" in str(error):
            status = "STALE"
        return {
            "required": True,
            "status": status,
            "decision": None,
            "artifactRef": None,
            "error": f"{type(error).__name__}: {error}",
        }

    return {
        "required": True,
        "status": decision["verdict"],
        "decision": decision,
        "artifactRef": reference.to_dict(),
        "error": None,
    }


def record_decision(
    repo_root: Path,
    diff_range: str,
    payload: object,
) -> dict[str, Any]:
    return record_decision_for_target(
        repo_root,
        {"kind": "range", "range": diff_range},
        payload,
    )


def record_decision_for_target(
    repo_root: Path,
    selector: Mapping[str, Any],
    payload: object,
) -> dict[str, Any]:
    target = resolve_review_target(repo_root, selector)
    if not target["reviewedFiles"]:
        raise DecisionInvalid("review target has no authored source files")
    expected_signals = structure_signal_keys(
        repo_root,
        target["reviewedFiles"],
    )
    decision = build_decision(
        payload,
        target=target,
        rubric_digest=rubric_hash(repo_root),
        signals=expected_signals,
    )
    with ArtifactSession(
        repo_root=repo_root,
        gate_id=GATE_ID,
        source=target["source"],
    ) as session:
        session.write_json(
            "reports/code-structure-decision.json",
            decision,
            role=ARTIFACT_ROLE,
        )
        session.complete(
            status="passed",
            completion_status="DONE",
            proof_status="PROVEN",
        )
    return decision


def prepare_review(
    repo_root: Path,
    selector: Mapping[str, Any],
) -> dict[str, Any]:
    target = resolve_review_target(repo_root, selector)
    signals = structure_signals(repo_root, target["reviewedFiles"])
    skipped = [
        item for item in target["scopeFiles"] if item["status"] == "SKIPPED"
    ]
    return {
        "artifactKind": PREPARATION_KIND,
        "schemaVersion": SCHEMA_VERSION,
        "scopeId": target["scopeId"],
        "target": target,
        "rubricHash": rubric_hash(repo_root),
        "signals": signals,
        "summary": {
            "scopeFileCount": len(target["scopeFiles"]),
            "reviewedFileCount": len(target["reviewedFiles"]),
            "skippedFileCount": len(skipped),
            "signalCount": len(signals),
        },
    }


def verification_exit_code(result: Mapping[str, Any]) -> int:
    if not result["required"]:
        return 0
    if result["status"] == "MISSING":
        return 2
    if result["status"] == "REFACTOR_REQUIRED":
        return 3
    if result["status"] in {"STALE", "INVALID"}:
        return 1
    return 0


def add_target_arguments(parser: argparse.ArgumentParser) -> None:
    target = parser.add_mutually_exclusive_group()
    target.add_argument(
        "--range",
        dest="diff_range",
        help="Git diff range; defaults to HEAD",
    )
    target.add_argument(
        "--path",
        dest="review_path",
        help="Repository-relative file or directory",
    )
    target.add_argument(
        "--pr",
        dest="pull_request",
        help="GitHub pull request number or URL",
    )
    parser.add_argument(
        "--depth",
        type=int,
        help="Maximum file depth below --path; 1 means direct files only",
    )


def selector_from_arguments(args: argparse.Namespace) -> dict[str, Any]:
    if args.depth is not None and args.review_path is None:
        raise DecisionInvalid("--depth requires --path")
    if args.review_path is not None:
        return {
            "kind": "path",
            "path": args.review_path,
            "depth": args.depth,
        }
    if args.pull_request is not None:
        return {"kind": "pr", "pr": args.pull_request}
    return {
        "kind": "range",
        "range": args.diff_range or "HEAD",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare, record, and verify source-bound code-structure reviews"
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare")
    add_target_arguments(prepare)

    record = subparsers.add_parser("record")
    add_target_arguments(record)
    record.add_argument(
        "--decision",
        default="-",
        help="JSON findings payload path, or - for stdin",
    )

    verify = subparsers.add_parser("verify")
    add_target_arguments(verify)

    args = parser.parse_args()
    try:
        selector = selector_from_arguments(args)
        if args.command == "prepare":
            result = prepare_review(REPO_ROOT, selector)
        elif args.command == "record":
            if args.decision == "-":
                payload = json.load(sys.stdin)
            else:
                payload = json.loads(
                    Path(args.decision).read_text(encoding="utf-8")
                )
            result = record_decision_for_target(REPO_ROOT, selector, payload)
        else:
            store = EvidenceStore.from_environment(
                repo_root=REPO_ROOT,
                worktree=REPO_ROOT,
            )
            result = collect_latest_decision_for_target(
                repo_root=REPO_ROOT,
                store=store,
                selector=selector,
            )
            exit_code = verification_exit_code(result)
            if exit_code in {2, 3}:
                print(json.dumps(result, indent=2, sort_keys=True))
                return exit_code
            if exit_code == 1:
                raise DecisionInvalid(result["error"] or result["status"])
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (
        DecisionInvalid,
        EvidenceError,
        OSError,
        json.JSONDecodeError,
        subprocess.CalledProcessError,
    ) as error:
        print(
            f"[CODE_STRUCTURE_DECISION_INVALID] {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
