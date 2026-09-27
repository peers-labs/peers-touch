#!/usr/bin/env python3
"""Aggregate immutable Secure Content Development child results."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from tooling.development.secure_content import schema_activation
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)


PLAN_ID = "SECURE-CONTENT-HARD-CUT-20260913"
RESULT_KIND = "peers-touch-development-result"
AGGREGATE_KIND = "secure-content-development-result-aggregate"
SHA256_LENGTH = 64


class AggregateError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ChildSpec:
    runtime: str
    work_item_id: str
    journey_id: str
    profiles: frozenset[str]
    clients: frozenset[str]


@dataclass(frozen=True)
class AggregateSpec:
    task_id: str
    variants: Mapping[str, ChildSpec | None]


SPECS: Mapping[str, AggregateSpec] = {
    "W7": AggregateSpec(
        task_id="W7",
        variants={
            "desktop": ChildSpec(
                "desktop",
                "secure-content-w7",
                "sc-dj-desktop-pilot",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-desktop-alice",
                        "secure-content-desktop-bob",
                        "secure-content-desktop-eve",
                    }
                ),
            ),
            "browser": ChildSpec(
                "browser",
                "secure-content-w7",
                "sc-dj-browser-private-boundary",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-browser-authenticated",
                        "secure-content-browser-anonymous",
                    }
                ),
            ),
        },
    ),
    "W8": AggregateSpec(
        task_id="W8",
        variants={
            "audience": ChildSpec(
                "desktop",
                "secure-content-w8",
                "sc-dj-social-expansion",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-desktop-alice",
                        "secure-content-desktop-bob",
                        "secure-content-desktop-eve",
                    }
                ),
            ),
            "comment": ChildSpec(
                "desktop",
                "secure-content-w8",
                "sc-dj-social-expansion",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-desktop-alice",
                        "secure-content-desktop-bob",
                        "secure-content-desktop-eve",
                    }
                ),
            ),
        },
    ),
    "W9": AggregateSpec(
        task_id="W9",
        variants={
            "ios": ChildSpec(
                "mobile",
                "secure-content-w9",
                "sc-dj-mobile-matrix",
                frozenset({"four"}),
                frozenset({"ios_alice", "ios_bob", "ios_eve"}),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w9",
                "sc-dj-mobile-matrix",
                frozenset({"four"}),
                frozenset({"android_alice", "android_bob", "android_eve"}),
            ),
            "cross-platform": ChildSpec(
                "mobile",
                "secure-content-w9",
                "sc-dj-mobile-matrix",
                frozenset({"four"}),
                frozenset(
                    {
                        "ios_alice",
                        "ios_bob",
                        "android_alice",
                        "android_bob",
                    }
                ),
            ),
        },
    ),
    "W2": AggregateSpec(
        task_id="W2",
        variants={
            "desktop": ChildSpec(
                "desktop",
                "secure-content-w2b-desktop",
                "sc-dj-chat-attachment-atomic",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "four-alice",
                        "four-bob",
                        "fiveArm-alice",
                        "fiveArm-bob",
                    }
                ),
            ),
            "ios": ChildSpec(
                "mobile",
                "secure-content-w2b-mobile",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"ios_alice", "ios_bob"}),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w2b-mobile",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"android_alice", "android_bob"}),
            ),
        },
    ),
    "W10": AggregateSpec(
        task_id="W10",
        variants={
            "desktop": ChildSpec(
                "desktop",
                "secure-content-w10",
                "sc-dj-chat-revalidation",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "four-alice",
                        "four-bob",
                        "fiveArm-alice",
                        "fiveArm-bob",
                    }
                ),
            ),
            "ios": ChildSpec(
                "mobile",
                "secure-content-w10",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"ios_alice", "ios_bob"}),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w10",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"android_alice", "android_bob"}),
            ),
        },
    ),
    "W11": AggregateSpec(
        task_id="W11",
        variants={
            "desktop": ChildSpec(
                "desktop",
                "secure-content-w11",
                "sc-dj-hardcut-regression",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-hardcut-four-alice",
                        "secure-content-hardcut-four-bob",
                        "secure-content-hardcut-four-eve",
                    }
                ),
            ),
            "browser": ChildSpec(
                "browser",
                "secure-content-w11",
                "sc-dj-browser-private-boundary",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-browser-authenticated",
                        "secure-content-browser-anonymous",
                    }
                ),
            ),
            "ios": ChildSpec(
                "mobile",
                "secure-content-w11",
                "sc-dj-hardcut-mobile-regression",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-hardcut-ios-alice",
                        "secure-content-hardcut-ios-bob",
                        "secure-content-hardcut-ios-eve",
                    }
                ),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w11",
                "sc-dj-hardcut-mobile-regression",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-hardcut-android-alice",
                        "secure-content-hardcut-android-bob",
                        "secure-content-hardcut-android-eve",
                    }
                ),
            ),
            "chat-desktop": ChildSpec(
                "desktop",
                "secure-content-w11",
                "sc-dj-chat-revalidation",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "four-alice",
                        "four-bob",
                        "fiveArm-alice",
                        "fiveArm-bob",
                    }
                ),
            ),
            "chat-ios": ChildSpec(
                "mobile",
                "secure-content-w11",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-hardcut-ios-alice",
                        "secure-content-hardcut-ios-bob",
                    }
                ),
            ),
            "chat-android": ChildSpec(
                "mobile",
                "secure-content-w11",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-hardcut-android-alice",
                        "secure-content-hardcut-android-bob",
                    }
                ),
            ),
        },
    ),
    "W12": AggregateSpec(
        task_id="W12",
        variants={
            "final-cut-four": None,
            "final-cut-five-arm": None,
            "desktop": ChildSpec(
                "desktop",
                "secure-content-w12",
                "sc-dj-final-desktop",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-desktop-alice",
                        "secure-content-desktop-bob",
                        "secure-content-desktop-eve",
                    }
                ),
            ),
            "browser": ChildSpec(
                "browser",
                "secure-content-w12",
                "sc-dj-browser-private-boundary",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-browser-authenticated",
                        "secure-content-browser-anonymous",
                    }
                ),
            ),
            "ios": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-final-mobile",
                frozenset({"four"}),
                frozenset({"ios_alice", "ios_bob", "ios_eve"}),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-final-mobile",
                frozenset({"four"}),
                frozenset({"android_alice", "android_bob", "android_eve"}),
            ),
            "chat-desktop": ChildSpec(
                "desktop",
                "secure-content-w12",
                "sc-dj-chat-revalidation",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "four-alice",
                        "four-bob",
                        "fiveArm-alice",
                        "fiveArm-bob",
                    }
                ),
            ),
            "chat-ios": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"ios_alice", "ios_bob"}),
            ),
            "chat-android": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"android_alice", "android_bob"}),
            ),
        },
    ),
}


IdentityLoader = Callable[[], Mapping[str, str]]


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == SHA256_LENGTH
        and all(character in "0123456789abcdef" for character in value)
    )


def _artifact_ref(root: Path, path: Path) -> dict[str, str]:
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _validate_digest(
    result: Mapping[str, Any],
    field: str,
    *,
    label: str,
) -> str:
    content = dict(result)
    digest = content.pop(field, None)
    if (
        not _is_sha256(digest)
        or not hmac.compare_digest(
            str(digest),
            schema_activation.canonical_digest(content),
        )
    ):
        raise AggregateError("CHILD_RESULT_INVALID", f"{label} digest is invalid")
    return str(digest)


def _load_identity(repo_root: Path) -> Mapping[str, str]:
    completed = subprocess.run(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AggregateError(
            "WORKTREE_IDENTITY_UNAVAILABLE",
            "cannot capture the current worktree identity",
        )
    try:
        identity = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise AggregateError(
            "WORKTREE_IDENTITY_UNAVAILABLE",
            "worktree verifier returned invalid JSON",
        ) from error
    if not isinstance(identity, dict):
        raise AggregateError(
            "WORKTREE_IDENTITY_UNAVAILABLE",
            "worktree verifier returned an invalid identity",
        )
    return identity


class ResultAggregateOwner:
    def __init__(
        self,
        *,
        repo_root: Path,
        result_root: Path | None = None,
        identity_loader: IdentityLoader | None = None,
    ) -> None:
        self.repo_root = repo_root.resolve(strict=True)
        identity = dict((identity_loader or (lambda: _load_identity(self.repo_root)))())
        for field in ("workspaceId", "head"):
            if not isinstance(identity.get(field), str) or not identity[field]:
                raise AggregateError(
                    "WORKTREE_IDENTITY_UNAVAILABLE",
                    f"worktree identity is missing {field}",
                )
        self.identity = identity
        self.result_root = (
            result_root.resolve()
            if result_root is not None
            else (
                Path.home()
                / ".peers-touch"
                / "dev"
                / "workspaces"
                / identity["workspaceId"]
                / "development"
                / "secure-content"
            ).resolve()
        )
        if (
            self.result_root == self.repo_root
            or self.repo_root in self.result_root.parents
        ):
            raise AggregateError(
                "RESULT_ROOT_INVALID",
                "Development result root must be outside the repository",
            )
        if identity_loader is None:
            try:
                identity = resolve_runtime_source_identity(
                    repo_root=self.repo_root,
                    result_root=self.result_root,
                    control_identity=identity,
                )
            except SourceProjectionError as error:
                raise AggregateError(
                    "SOURCE_IDENTITY_MISMATCH",
                    str(error),
                ) from error
        self.identity = identity

    def aggregate(
        self,
        *,
        workstream: str,
        required: Sequence[str],
        generation_id: str | None = None,
    ) -> Mapping[str, Any]:
        spec = SPECS.get(workstream)
        if spec is None:
            raise AggregateError(
                "AGGREGATE_SCOPE_INVALID",
                f"unsupported workstream {workstream!r}",
            )
        expected_variants = tuple(spec.variants)
        requested = tuple(required)
        if len(set(requested)) != len(requested):
            raise AggregateError(
                "AGGREGATE_SCOPE_INVALID",
                "required variants contain duplicates",
            )
        if set(requested) != set(expected_variants):
            raise AggregateError(
                "AGGREGATE_SCOPE_INVALID",
                (
                    f"{workstream} requires exactly "
                    + ",".join(expected_variants)
                ),
            )
        generation = generation_id or self.identity["head"]
        if generation != self.identity["head"]:
            raise AggregateError(
                "SOURCE_IDENTITY_MISMATCH",
                "aggregate generation differs from the exact worktree HEAD",
            )

        children: list[dict[str, Any]] = []
        for variant in expected_variants:
            child_spec = spec.variants[variant]
            if child_spec is None:
                path, result, digest = self._load_final_cut_child(
                    generation=generation,
                    variant=variant,
                )
                child_kind = str(result["kind"])
            else:
                path, result, digest = self._load_product_child(
                    workstream=workstream,
                    generation=generation,
                    variant=variant,
                    spec=child_spec,
                )
                child_kind = RESULT_KIND
            children.append(
                {
                    "variantId": variant,
                    "childKind": child_kind,
                    "resultRef": _artifact_ref(self.result_root, path),
                    "resultDigest": digest,
                }
            )

        output = (
            self.result_root
            / workstream
            / ("aggregate" if workstream == "W12" else generation)
            / (generation if workstream == "W12" else "aggregate")
            / "result.json"
        )
        result: dict[str, Any] = {
            "kind": AGGREGATE_KIND,
            "planId": PLAN_ID,
            "taskId": spec.task_id,
            "workstreamId": workstream,
            "generationId": generation,
            "sourceCommit": self.identity.get("controlHead", generation),
            "runtimeSourceCommit": generation,
            "controlHead": self.identity.get("controlHead", generation),
            "sourceTransitionCount": self.identity.get("transitionCount", 0),
            "sourceProjectionDigest": self.identity.get(
                "transitionDigest",
                schema_activation.canonical_digest(
                    {
                        "runtimeSourceCommit": generation,
                        "controlHead": generation,
                        "transitions": [],
                    }
                ),
            ),
            "workspaceId": self.identity["workspaceId"],
            "requiredVariants": list(expected_variants),
            "children": children,
            "verificationClass": "FUNCTIONAL_CHECK",
            "result": "PASS",
            "proofState": "UNPROVEN",
            "claim": "FUNCTIONAL_PASS",
            "completedAt": _timestamp(),
        }
        result["resultDigest"] = schema_activation.canonical_digest(result)
        schema_activation.write_immutable_json(output, result)
        return result

    def _load_product_child(
        self,
        *,
        workstream: str,
        generation: str,
        variant: str,
        spec: ChildSpec,
    ) -> tuple[Path, Mapping[str, Any], str]:
        base = (
            self.result_root
            / workstream
            / ("product" if workstream == "W12" else "")
            / generation
            / variant
        )
        paths = sorted(base.glob("*/result.json"))
        if len(paths) != 1:
            raise AggregateError(
                "RESULT_SET_INCOMPLETE",
                (
                    f"{workstream}/{variant} requires exactly one child "
                    f"result, found {len(paths)}"
                ),
            )
        path = paths[0]
        result = schema_activation.read_json_artifact(
            path,
            f"{workstream}/{variant} child result",
        )
        expected = {
            "kind": RESULT_KIND,
            "taskId": workstream,
            "workstreamId": workstream,
            "generationId": generation,
            "variantId": variant,
            "runId": path.parent.name,
            "workItemId": spec.work_item_id,
            "journeyId": spec.journey_id,
            "runtime": spec.runtime,
            "verificationClass": "FUNCTIONAL_CHECK",
            "result": "PASS",
            "proofState": "UNPROVEN",
            "workspaceId": self.identity["workspaceId"],
            "sourceCommit": generation,
        }
        for field, expected_value in expected.items():
            if result.get(field) != expected_value:
                raise AggregateError(
                    "CHILD_RESULT_INVALID",
                    f"{workstream}/{variant} has invalid {field}",
                )
        if (
            frozenset(result.get("profiles", ())) != spec.profiles
            or frozenset(result.get("clients", ())) != spec.clients
            or not _is_sha256(result.get("runtimeManifestDigest"))
            or not _is_sha256(result.get("fixtureManifestDigest"))
            or not isinstance(result.get("serviceIds"), list)
            or not result["serviceIds"]
            or "firstFailure" in result
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} runtime binding is invalid",
            )
        digest = _validate_digest(
            result,
            "resultDigest",
            label=f"{workstream}/{variant} child result",
        )
        return path, result, digest

    def _load_final_cut_child(
        self,
        *,
        generation: str,
        variant: str,
    ) -> tuple[Path, Mapping[str, Any], str]:
        profile = "four" if variant == "final-cut-four" else "fiveArm"
        workstream = "W12F-FOUR" if profile == "four" else "W12F-FIVEARM"
        paths = sorted(
            (
                self.result_root
                / "W12"
                / "final-cut"
                / generation
                / profile
            ).glob("*/result.json")
        )
        if len(paths) != 1:
            raise AggregateError(
                "RESULT_SET_INCOMPLETE",
                (
                    f"W12/{variant} requires exactly one final-cut result, "
                    f"found {len(paths)}"
                ),
            )
        path = paths[0]
        result = schema_activation.read_json_artifact(
            path,
            f"W12/{variant} final-cut result",
        )
        expected = {
            "kind": schema_activation.PROFILE_RESULT_KIND,
            "workstream_id": workstream,
            "task_id": "W12",
            "generation_id": generation,
            "source_commit": generation,
            "workspace_id": self.identity["workspaceId"],
            "profile_id": profile,
            "reset_intent": "FINAL_CUT",
            "journal_state": "COMPLETE",
            "status": "PASS",
            "claim": "FINAL_RESET_COMPLETE_ONLY",
        }
        for field, expected_value in expected.items():
            if result.get(field) != expected_value:
                raise AggregateError(
                    "CHILD_RESULT_INVALID",
                    f"W12/{variant} has invalid {field}",
                )
        digest = _validate_digest(
            result,
            "result_digest",
            label=f"W12/{variant} final-cut result",
        )
        return path, result, digest


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggregate Secure Content Development child results",
    )
    parser.add_argument("--workstream", required=True, choices=tuple(SPECS))
    parser.add_argument("--required", required=True)
    parser.add_argument("--generation-id")
    parser.add_argument("--result-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parse_args(argv)
    owner = ResultAggregateOwner(
        repo_root=Path(__file__).resolve().parents[3],
        result_root=arguments.result_root,
    )
    try:
        result = owner.aggregate(
            workstream=arguments.workstream,
            required=tuple(
                item.strip()
                for item in arguments.required.split(",")
                if item.strip()
            ),
            generation_id=arguments.generation_id,
        )
    except (
        AggregateError,
        schema_activation.SchemaActivationError,
        OSError,
        subprocess.SubprocessError,
    ) as error:
        code = error.code if isinstance(error, AggregateError) else "AGGREGATE_IO_FAILED"
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "proofState": "UNPROVEN",
                    "code": code,
                    "message": str(error),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
