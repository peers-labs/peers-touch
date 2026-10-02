#!/usr/bin/env python3
"""Classify Agent-module changes without scheduling or executing work."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_POLICY = SKILL_ROOT / "impact-policy.json"
DEFAULT_REPLAY = SKILL_ROOT / "fixtures" / "mca-p04-replay.json"
PROOF_PRECEDENCE = {
    "REUSE_CANDIDATE": 0,
    "REUSE_ALLOWED": 1,
    "REPROVE_REQUIRED": 2,
    "POLICY_REQUIRED": 3,
}


class ImpactError(RuntimeError):
    pass


def load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ImpactError(f"cannot load {path}: {error}") from error
    if not isinstance(value, dict):
        raise ImpactError(f"{path} must contain a JSON object")
    return value


def validate_string_list(
    value: Any,
    field: str,
    *,
    allow_empty: bool = True,
) -> list[str]:
    if (
        not isinstance(value, list)
        or any(not isinstance(item, str) or not item for item in value)
        or len(value) != len(set(value))
        or (not allow_empty and not value)
    ):
        raise ImpactError(f"{field} must be a valid unique string list")
    return value


def validate_policy(policy: dict[str, Any]) -> None:
    if (
        policy.get("kind")
        != "peers-touch-agent-development-impact-policy"
        or policy.get("schemaVersion") != 1
    ):
        raise ImpactError("unsupported Agent impact policy identity")
    impact_classes = set(
        validate_string_list(
            policy.get("impactClasses"),
            "impactClasses",
            allow_empty=False,
        )
    )
    product_classes = set(
        validate_string_list(
            policy.get("productImpactClasses"),
            "productImpactClasses",
            allow_empty=False,
        )
    )
    if not product_classes.issubset(impact_classes):
        raise ImpactError("productImpactClasses must be declared impact classes")
    validate_string_list(
        policy.get("proofIdentityDimensions"),
        "proofIdentityDimensions",
        allow_empty=False,
    )
    if not isinstance(policy.get("moduleId"), str) or not policy["moduleId"]:
        raise ImpactError("moduleId must be a non-empty string")
    validate_string_list(
        policy.get("moduleDependencies"),
        "moduleDependencies",
    )
    if policy.get("gitHeadRole") != "AUDIT_ONLY":
        raise ImpactError("gitHeadRole must remain AUDIT_ONLY")

    decisions = policy.get("classDecisions")
    if not isinstance(decisions, dict) or set(decisions) != impact_classes:
        raise ImpactError("classDecisions must cover every impact class exactly")
    for impact_class, decision in decisions.items():
        if not isinstance(decision, dict):
            raise ImpactError(f"class decision {impact_class!r} must be an object")
        for field in (
            "focusedCheckSelectors",
            "targetSelectors",
            "journeySelectors",
            "gateSelectors",
            "proofDimensionsExpectedToChange",
        ):
            validate_string_list(
                decision.get(field),
                f"classDecisions.{impact_class}.{field}",
            )
        if not isinstance(decision.get("resourceRequirements"), list):
            raise ImpactError(
                f"classDecisions.{impact_class}.resourceRequirements "
                "must be an array"
            )
        if decision.get("proofDefault") not in PROOF_PRECEDENCE:
            raise ImpactError(
                f"class decision {impact_class!r} has invalid proofDefault"
            )

    rules = policy.get("pathRules")
    if not isinstance(rules, list) or not rules:
        raise ImpactError("pathRules must be a non-empty list")
    rule_ids: list[str] = []
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("id"), str):
            raise ImpactError("each path rule must have a string id")
        rule_ids.append(rule["id"])
        validate_string_list(
            rule.get("patterns"),
            f"pathRules.{rule['id']}.patterns",
            allow_empty=False,
        )
        if rule.get("impactClass") not in impact_classes:
            raise ImpactError(
                f"path rule {rule['id']!r} uses an unknown impactClass"
            )
        for field in (
            "addTargetSelectors",
            "replaceProofDimensionsExpectedToChange",
            "proofDimensionsToRefresh",
        ):
            if field in rule:
                validate_string_list(
                    rule[field],
                    f"pathRules.{rule['id']}.{field}",
                )
        if (
            "requiresSeparateTaskFromProduct" in rule
            and not isinstance(rule["requiresSeparateTaskFromProduct"], bool)
        ):
            raise ImpactError(
                f"path rule {rule['id']!r} has a non-boolean split policy"
            )
    if len(rule_ids) != len(set(rule_ids)):
        raise ImpactError("path rule ids must be unique")
    ownership_rule_ids = set(
        validate_string_list(
            policy.get("ownershipRuleIds"),
            "ownershipRuleIds",
            allow_empty=False,
        )
    )
    unknown_ownership_rules = sorted(ownership_rule_ids - set(rule_ids))
    if unknown_ownership_rules:
        raise ImpactError(
            "ownershipRuleIds reference unknown path rules: "
            f"{unknown_ownership_rules}"
        )

    failure = policy.get("failureSignals")
    if not isinstance(failure, dict):
        raise ImpactError("failureSignals must be an object")
    allowed_values = validate_string_list(
        failure.get("allowedValues"),
        "failureSignals.allowedValues",
        allow_empty=False,
    )
    if "FAIL" not in allowed_values:
        raise ImpactError("failureSignals.allowedValues must include FAIL")
    checks = failure.get("orderedChecks")
    if not isinstance(checks, list) or not checks:
        raise ImpactError("failureSignals.orderedChecks must be non-empty")
    if any(
        not isinstance(item, dict)
        or not isinstance(item.get("signal"), str)
        or item.get("value") not in allowed_values
        or not isinstance(item.get("classification"), str)
        or not item["classification"]
        for item in checks
    ):
        raise ImpactError("failureSignals.orderedChecks contains an invalid rule")
    if len({item["signal"] for item in checks}) != len(checks):
        raise ImpactError("failure signal names must be unique")
    classifications = [item["classification"] for item in checks]
    if len(classifications) != len(set(classifications)):
        raise ImpactError("failure classifications must be unique")


def canonical_path(value: str) -> str:
    candidate = value.strip()
    path = PurePosixPath(candidate)
    if (
        not candidate
        or candidate != value
        or path.is_absolute()
        or path.as_posix() != candidate
        or ".." in path.parts
        or "\\" in candidate
    ):
        raise ImpactError(
            f"changed path must be canonical and repository-relative: {value!r}"
        )
    return candidate


def git_changed_paths(diff_range: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", diff_range, "--"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ImpactError(
            f"cannot inspect git range {diff_range!r}: {completed.stderr.strip()}"
        )
    paths = {
        canonical_path(line)
        for line in completed.stdout.splitlines()
        if line.strip()
    }
    if diff_range == "HEAD":
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        paths.update(
            canonical_path(line)
            for line in untracked.stdout.splitlines()
            if line.strip()
        )
    return sorted(paths)


def commit_paths(commit: str) -> list[str]:
    completed = subprocess.run(
        ["git", "show", "--format=", "--name-only", commit],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ImpactError(
            f"cannot inspect commit {commit!r}: {completed.stderr.strip()}"
        )
    return sorted(
        {
            canonical_path(line)
            for line in completed.stdout.splitlines()
            if line.strip()
        }
    )


def commit_subject(commit: str) -> str:
    completed = subprocess.run(
        ["git", "show", "-s", "--format=%s", commit],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ImpactError(
            f"cannot inspect commit {commit!r}: {completed.stderr.strip()}"
        )
    return completed.stdout.strip()


def matching_rule(path: str, policy: dict[str, Any]) -> dict[str, Any] | None:
    for rule in policy["pathRules"]:
        if any(
            fnmatch.fnmatchcase(path, pattern)
            for pattern in rule.get("patterns", [])
        ):
            return rule
    return None


def nested_value(value: dict[str, Any], dotted_path: str) -> Any:
    current: Any = value
    for part in dotted_path.split("."):
        if not isinstance(current, dict) or part not in current:
            raise ImpactError(
                f"proof fingerprint is missing required dimension {dotted_path!r}"
            )
        current = current[part]
    return current


def validate_fingerprint(
    value: dict[str, Any],
    policy: dict[str, Any],
) -> None:
    for dimension in policy["proofIdentityDimensions"]:
        nested_value(value, dimension)
    component_digests = value["affectedComponentDigests"]
    if not isinstance(component_digests, dict) or not component_digests:
        raise ImpactError(
            "affectedComponentDigests must be a non-empty JSON object"
        )


def stronger_proof_action(left: str, right: str) -> str:
    return (
        left
        if PROOF_PRECEDENCE[left] >= PROOF_PRECEDENCE[right]
        else right
    )


def digest_value(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def proof_comparison(
    *,
    policy: dict[str, Any],
    default_action: str,
    expected_changes: list[str],
    before: dict[str, Any] | None,
    current: dict[str, Any] | None,
) -> dict[str, Any]:
    if (before is None) != (current is None):
        raise ImpactError(
            "--before-proof and --current-proof must be supplied together"
        )
    if before is None or current is None:
        return {
            "action": default_action,
            "authorization": (
                "PENDING_FINGERPRINT"
                if default_action == "REUSE_CANDIDATE"
                else "NOT_REUSABLE"
            ),
            "mismatchedDimensions": [],
            "staleDimensions": [],
        }

    validate_fingerprint(before, policy)
    validate_fingerprint(current, policy)
    mismatched = [
        dimension
        for dimension in policy["proofIdentityDimensions"]
        if nested_value(before, dimension) != nested_value(current, dimension)
    ]
    stale = [
        dimension
        for dimension in expected_changes
        if nested_value(before, dimension) == nested_value(current, dimension)
    ]
    if stale:
        return {
            "action": "POLICY_REQUIRED",
            "authorization": "DENIED",
            "failureClassification": "EVIDENCE_INTEGRITY",
            "mismatchedDimensions": mismatched,
            "staleDimensions": stale,
        }
    if mismatched:
        return {
            "action": "REPROVE_REQUIRED",
            "authorization": "NOT_REUSABLE",
            "mismatchedDimensions": mismatched,
            "staleDimensions": [],
        }
    return {
        "action": "REUSE_ALLOWED",
        "authorization": "AUTHORIZED",
        "mismatchedDimensions": [],
        "staleDimensions": [],
    }


def classify_paths(
    paths: list[str],
    *,
    policy: dict[str, Any],
    before: dict[str, Any] | None = None,
    current: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not paths:
        raise ImpactError("at least one changed path is required")
    normalized_paths = sorted({canonical_path(path) for path in paths})

    classes: set[str] = set()
    checks: set[str] = set()
    targets: set[str] = set()
    journeys: set[str] = set()
    gates: set[str] = set()
    resource_requirements: dict[str, dict[str, Any]] = {}
    expected_changes: set[str] = set()
    refresh_dimensions: set[str] = set()
    separate_owner_rules: set[str] = set()
    decisions: list[dict[str, Any]] = []
    matched_rule_ids: set[str] = set()
    unclassified: list[str] = []
    default_action = "REUSE_CANDIDATE"

    class_decisions = policy["classDecisions"]
    for path in normalized_paths:
        rule = matching_rule(path, policy)
        if rule is None:
            unclassified.append(path)
            continue
        impact_class = rule["impactClass"]
        if impact_class not in class_decisions:
            raise ImpactError(
                f"path rule {rule['id']!r} uses unknown class {impact_class!r}"
            )
        class_decision = class_decisions[impact_class]
        matched_rule_ids.add(rule["id"])
        classes.add(impact_class)
        checks.update(class_decision["focusedCheckSelectors"])
        targets.update(class_decision["targetSelectors"])
        targets.update(rule.get("addTargetSelectors", []))
        journeys.update(class_decision["journeySelectors"])
        gates.update(class_decision["gateSelectors"])
        for requirement in class_decision["resourceRequirements"]:
            requirement_id = requirement.get("requirementId")
            if not isinstance(requirement_id, str) or not requirement_id:
                raise ImpactError(
                    f"class decision {impact_class!r} has an invalid "
                    "resource requirement"
                )
            previous = resource_requirements.get(requirement_id)
            if previous is not None and previous != requirement:
                raise ImpactError(
                    f"resource requirement {requirement_id!r} conflicts"
                )
            resource_requirements[requirement_id] = requirement
        dimensions = rule.get(
            "replaceProofDimensionsExpectedToChange",
            class_decision["proofDimensionsExpectedToChange"],
        )
        expected_changes.update(dimensions)
        refresh_dimensions.update(rule.get("proofDimensionsToRefresh", []))
        if rule.get(
            "requiresSeparateTaskFromProduct",
            class_decision.get("requiresSeparateTaskFromProduct", False),
        ):
            separate_owner_rules.add(rule["id"])
        default_action = stronger_proof_action(
            default_action,
            class_decision["proofDefault"],
        )
        decisions.append(
            {
                "path": path,
                "ruleId": rule["id"],
                "impactClass": impact_class,
            }
        )

    owns_change = bool(
        matched_rule_ids.intersection(policy["ownershipRuleIds"])
    )
    if unclassified:
        evidence = {
            "action": "POLICY_REQUIRED",
            "authorization": "DENIED",
            "failureClassification": "EVIDENCE_INTEGRITY",
            "mismatchedDimensions": [],
            "staleDimensions": [],
        }
        state = "POLICY_REQUIRED"
    elif not owns_change:
        evidence = {
            "action": "POLICY_REQUIRED",
            "authorization": "DENIED",
            "failureClassification": "WORKFLOW_DEFECT",
            "mismatchedDimensions": [],
            "staleDimensions": [],
        }
        state = "NOT_APPLICABLE"
        classes.clear()
        checks.clear()
        targets.clear()
        journeys.clear()
        gates.clear()
        resource_requirements.clear()
    else:
        evidence = proof_comparison(
            policy=policy,
            default_action=default_action,
            expected_changes=sorted(expected_changes),
            before=before,
            current=current,
        )
        state = (
            "POLICY_REQUIRED"
            if evidence["action"] == "POLICY_REQUIRED"
            else "DECIDED"
        )

    product_classes = set(policy["productImpactClasses"])
    ownership_split_required = (
        bool(separate_owner_rules)
        and owns_change
        and bool(product_classes.intersection(classes))
    )
    if state == "DECIDED" and ownership_split_required:
        state = "OWNERSHIP_SPLIT_REQUIRED"

    formal_gate_required = evidence["action"] == "REPROVE_REQUIRED"
    result = {
        "kind": "peers-touch-module-impact",
        "schemaVersion": 1,
        "moduleId": policy["moduleId"],
        "state": state,
        "changedPaths": normalized_paths,
        "changeKinds": sorted(classes),
        "moduleDependencies": policy["moduleDependencies"],
        "requirements": {
            "focusedCheckSelectors": sorted(checks),
            "targetSelectors": sorted(targets),
            "journeySelectors": sorted(journeys),
            "gateSelectors": sorted(gates),
            "resourceRequirements": [
                resource_requirements[key]
                for key in sorted(resource_requirements)
            ],
        },
        "classification": {
            "pathDecisions": decisions,
            "unclassifiedPaths": sorted(unclassified),
            "preReview": True,
            "sourceFreezeBeforeFormalGate": formal_gate_required,
            "formalGateRequired": formal_gate_required,
            "ownershipSplitRequired": ownership_split_required,
            "separateOwnerRuleIds": sorted(separate_owner_rules),
            "deliveryReadyRequires": "completionReviewReceipt=PASS",
        },
        "proof": {
            **evidence,
            "identityDimensions": policy["proofIdentityDimensions"],
            "dimensionsExpectedToChange": sorted(expected_changes),
            "dimensionsToRefresh": sorted(refresh_dimensions),
            "gitHeadRole": policy["gitHeadRole"],
        },
    }
    result["classification"]["impactDigest"] = digest_value(result)
    return result


def classify_failure(
    signals: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    allowed = set(policy["failureSignals"]["allowedValues"])
    required = {
        item["signal"]
        for item in policy["failureSignals"]["orderedChecks"]
    }
    unknown = sorted(set(signals) - required)
    missing = sorted(required - set(signals))
    if unknown or missing:
        raise ImpactError(
            f"failure signals do not match policy: missing={missing}, unknown={unknown}"
        )
    for name, value in signals.items():
        if value not in allowed:
            raise ImpactError(
                f"failure signal {name!r} must be one of {sorted(allowed)}"
            )
    classification = None
    trigger = None
    for item in policy["failureSignals"]["orderedChecks"]:
        if signals[item["signal"]] == item["value"]:
            classification = item["classification"]
            trigger = item["signal"]
            break
    return {
        "kind": "peers-touch-agent-failure-decision",
        "schemaVersion": 1,
        "state": "CLASSIFIED" if classification else "NO_FAILURE",
        "classification": classification,
        "triggerSignal": trigger,
        "signals": signals,
    }


def expected_projection(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "impactClasses": result["changeKinds"],
        "targetSelectors": result["requirements"]["targetSelectors"],
        "formalGateRequired": result["classification"]["formalGateRequired"],
        "proofAction": result["proof"]["action"],
        "ownershipSplitRequired": result["classification"][
            "ownershipSplitRequired"
        ],
    }


def replay_fixture(
    fixture: dict[str, Any],
    *,
    policy: dict[str, Any],
    verify_git: bool,
) -> dict[str, Any]:
    cases = fixture.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ImpactError("replay fixture must contain non-empty cases")
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for case in cases:
        commit = case["commit"]
        fixture_paths = sorted(case["changedPaths"])
        if verify_git:
            actual_paths = commit_paths(commit)
            actual_subject = commit_subject(commit)
            if actual_paths != fixture_paths or actual_subject != case["subject"]:
                failures.append(
                    {
                        "commit": commit,
                        "reason": "FIXTURE_GIT_DRIFT",
                        "expectedPaths": fixture_paths,
                        "actualPaths": actual_paths,
                        "expectedSubject": case["subject"],
                        "actualSubject": actual_subject,
                    }
                )
                continue
        decision = classify_paths(fixture_paths, policy=policy)
        expected = case["expected"]
        projection = expected_projection(decision)
        actual = {key: projection[key] for key in expected}
        state = "PASS" if actual == expected else "FAIL"
        result = {
            "commit": commit,
            "state": state,
            "expected": expected,
            "actual": actual,
        }
        results.append(result)
        if state == "FAIL":
            failures.append(result)
    return {
        "kind": "peers-touch-agent-impact-replay",
        "schemaVersion": 1,
        "state": "PASS" if not failures else "FAIL",
        "caseCount": len(cases),
        "verifiedGitHistory": verify_git,
        "results": results,
        "failures": failures,
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    root.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    root.add_argument("--pretty", action="store_true")
    commands = root.add_subparsers(dest="command", required=True)

    impact = commands.add_parser("impact")
    impact.add_argument("--changed-file", action="append", default=[])
    impact.add_argument("--git-range")
    impact.add_argument("--before-proof", type=Path)
    impact.add_argument("--current-proof", type=Path)

    failure = commands.add_parser("failure")
    failure.add_argument("--signals", type=Path, required=True)

    replay = commands.add_parser("replay")
    replay.add_argument("--fixture", type=Path, default=DEFAULT_REPLAY)
    replay.add_argument("--verify-git", action="store_true")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        policy = load_object(args.policy)
        validate_policy(policy)
        if args.command == "impact":
            if bool(args.changed_file) == bool(args.git_range):
                raise ImpactError(
                    "supply exactly one of --changed-file or --git-range"
                )
            paths = (
                sorted({canonical_path(path) for path in args.changed_file})
                if args.changed_file
                else git_changed_paths(args.git_range)
            )
            before = (
                load_object(args.before_proof) if args.before_proof else None
            )
            current = (
                load_object(args.current_proof) if args.current_proof else None
            )
            result = classify_paths(
                paths,
                policy=policy,
                before=before,
                current=current,
            )
        elif args.command == "failure":
            result = classify_failure(load_object(args.signals), policy)
        else:
            result = replay_fixture(
                load_object(args.fixture),
                policy=policy,
                verify_git=args.verify_git,
            )
    except (ImpactError, KeyError, TypeError) as error:
        print(f"agent impact: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            result,
            indent=2 if args.pretty else None,
            sort_keys=True,
        )
    )
    return (
        0
        if result["state"]
        not in {"FAIL", "POLICY_REQUIRED", "OWNERSHIP_SPLIT_REQUIRED"}
        else 2
    )


if __name__ == "__main__":
    raise SystemExit(main())
