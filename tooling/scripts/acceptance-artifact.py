#!/usr/bin/env python3
"""Inspect and clean Acceptance Evidence Store artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    EvidenceStore,
    current_artifact_path,
    resolve_artifact_root,
)
from tooling.acceptance.core.errors import EvidenceError


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("root")

    latest = subparsers.add_parser("latest")
    latest.add_argument("--gate", required=True)
    latest.add_argument("--role", required=True)

    cat = subparsers.add_parser("cat")
    cat.add_argument("--gate", required=True)
    cat.add_argument("--role", required=True)

    current = subparsers.add_parser("current")
    current.add_argument("--path", required=True)

    cleanup = subparsers.add_parser("delete-run")
    cleanup.add_argument("--gate", required=True)
    cleanup.add_argument("--run", required=True)

    args = parser.parse_args()
    try:
        if args.command == "root":
            print(resolve_artifact_root(repo_root=REPO_ROOT))
            return 0
        if args.command == "current":
            print(
                current_artifact_path(
                    args.path,
                    repo_root=REPO_ROOT,
                )
            )
            return 0

        store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        if args.command == "delete-run":
            store.delete_run(args.gate, args.run)
            print(json.dumps({"gateId": args.gate, "runId": args.run, "deleted": True}))
            return 0

        reference = store.latest_artifact_ref(args.gate, args.role)
        path = store.resolve(reference)
        if args.command == "latest":
            print(path)
        elif args.command == "cat":
            sys.stdout.buffer.write(path.read_bytes())
        return 0
    except EvidenceError as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
