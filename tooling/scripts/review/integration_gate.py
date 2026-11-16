#!/usr/bin/env python3
"""Verify one integration immediately before an explicitly requested release."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from integration_review import (
    IntegrationError, require, verify_evidence,
)
from merge_scope import git


def gh_json(*args: str) -> dict:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    require(result.returncode == 0, "GITHUB_UNAVAILABLE", result.stderr.strip())
    return json.loads(result.stdout)


def github_policy(repository: str, branch: str) -> None:
    from urllib.parse import quote
    policy = gh_json("api", f"repos/{repository}/branches/{quote(branch, safe='')}/protection")
    checks = policy.get("required_status_checks") or {}
    contexts = set(checks.get("contexts", [])) | {
        check["context"] for check in checks.get("checks", [])}
    approvals = policy.get("required_pull_request_reviews") or {}
    require("integration-admission" in contexts and checks.get("strict") is True
            and approvals.get("dismiss_stale_reviews") is True
            and approvals.get("required_approving_review_count", 0) >= 1
            and policy.get("enforce_admins", {}).get("enabled") is True,
            "GITHUB_POLICY_NOT_ENFORCED",
            "required integration-admission, strict base updates, stale approval dismissal, "
            "one approval and admin enforcement must be active")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("commit", "fanout", "github-merge"))
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--ours", default="HEAD")
    parser.add_argument("--theirs", required=True)
    parser.add_argument("--candidate", default="index")
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--execute", action="store_true",
                        help="Perform the separately authorized operation; default verifies only")
    parser.add_argument("--message-file", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--target-head")
    parser.add_argument("--repository")
    parser.add_argument("--pr", type=int)
    args = parser.parse_args()
    try:
        root = Path(git(args.repo_root, "rev-parse", "--show-toplevel"))
        plan = verify_evidence(root, args.ours, args.theirs, args.candidate,
                               args.plan, args.results, args.review)
        if args.action == "commit":
            require(git(root, "rev-parse", "HEAD") == plan["source"]["ours"]
                    and git(root, "rev-parse", "MERGE_HEAD") == plan["source"]["theirs"],
                    "STALE_SOURCE", "commit must finalize the reviewed two-parent merge")
            require(args.message_file is not None and args.message_file.is_file(),
                    "MESSAGE_REQUIRED", "--message-file")
            command = ["git", "commit", "-F", str(args.message_file.resolve())]
            cwd = root
        elif args.action == "fanout":
            require(args.target is not None and args.target_head,
                    "TARGET_REQUIRED", "explicit target path and inventoried HEAD")
            target = Path(git(args.target, "rev-parse", "--show-toplevel"))
            require(git(target, "rev-parse", "HEAD") == args.target_head,
                    "CONCURRENT_CHANGE_DETECTED", str(target))
            require(args.target_head in (plan["source"]["ours"], plan["source"]["theirs"]),
                    "UNREVIEWED_TARGET_SOURCE",
                    "prepare a receiver-specific target/final manifest; last-merge proof "
                    "cannot cover older receiving branches")
            require(not git(target, "status", "--porcelain"),
                    "DIRTY_TARGET", str(target))
            final = git(root, "rev-parse", "HEAD")
            require(git(root, "rev-parse", "HEAD^{tree}") == plan["source"]["candidateTree"],
                    "STALE_SOURCE", "relay HEAD differs from reviewed result")
            git(target, "merge-base", "--is-ancestor", args.target_head, final)
            require(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir") ==
                    git(target, "rev-parse", "--path-format=absolute", "--git-common-dir"),
                    "UNRELATED_TARGET", "fanout requires a verified shared repository")
            command, cwd = ["git", "merge", "--ff-only", final], target
        else:
            require(args.repository and args.pr, "PR_REQUIRED", "repository and PR")
            pr = gh_json("pr", "view", str(args.pr), "--repo", args.repository,
                         "--json", "headRefOid,baseRefOid,baseRefName,state,reviewDecision")
            require(pr["state"] == "OPEN" and pr["reviewDecision"] == "APPROVED",
                    "PR_NOT_APPROVED", str(args.pr))
            require(pr["headRefOid"] == plan["source"]["ours"]
                    and pr["baseRefOid"] == plan["source"]["theirs"],
                    "STALE_SOURCE", "live PR parents changed")
            github_policy(args.repository, pr["baseRefName"])
            result = subprocess.run(["gh", "pr", "checks", str(args.pr), "--repo",
                                     args.repository, "--required"], capture_output=True, text=True)
            require(result.returncode == 0, "REQUIRED_CHECKS_NOT_PASSED", result.stdout)
            # GitHub's strict base-update policy closes the race at server merge.
            # --match-head-commit independently fences a concurrent PR update.
            command = ["gh", "pr", "merge", str(args.pr), "--repo", args.repository,
                       "--squash", "--match-head-commit", pr["headRefOid"]]
            cwd = root
        if not args.execute:
            print(json.dumps({"status": "VERIFIED_ONLY", "action": args.action}))
            return 0
        return subprocess.run(command, cwd=cwd).returncode
    except (IntegrationError, OSError, KeyError, TypeError, ValueError) as error:
        print(f"integration-gate: BLOCKED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
