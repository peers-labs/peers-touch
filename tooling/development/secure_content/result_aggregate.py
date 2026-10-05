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

from tooling.acceptance.core.errors import SuiteRuntimeError
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    validate_suite_runtime_report,
)
from tooling.development.secure_content import schema_activation
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)


PLAN_ID = "SECURE-CONTENT-HARD-CUT-20260913"
RESULT_KIND = "peers-touch-development-result"
AGGREGATE_KIND = "secure-content-development-result-aggregate"
SHA256_LENGTH = 64
FINAL_CUT_VARIANTS = {
    "final-cut-four": ("four", "W12F-FOUR", "station-four"),
    "final-cut-five-arm": (
        "fiveArm",
        "W12F-FIVEARM",
        "station-five-arm",
    ),
}
FINAL_CUT_PROFILES = frozenset(
    profile for profile, _, _ in FINAL_CUT_VARIANTS.values()
)
PRODUCT_FINAL_CUT_BINDING_FIELDS = frozenset(
    {
        "resultDigest",
        "resetId",
        "schemaAttestationDigest",
        "stationRuntimeIdentity",
    }
)
MANIFEST_FINAL_CUT_BINDING_FIELDS = frozenset(
    {
        "result_digest",
        "reset_id",
        "schema_attestation_digest",
        "station_runtime_identity",
    }
)
W12_SUITE_RUNTIME_CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w12-functional",
        "scenarioIds": [
            "desktop",
            "ios",
            "android",
            "chat-desktop",
            "chat-ios",
            "chat-android",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 13,
        "minWarmReuseRate": 0.83,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)


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
    allows_owner_continuation: bool = False
    required_service_ids: frozenset[str] = frozenset()
    required_fixture_owners: Mapping[str, str] | None = None


@dataclass(frozen=True)
class AggregateSpec:
    task_id: str
    variants: Mapping[str, ChildSpec | None]


@dataclass(frozen=True)
class FinalCutBinding:
    result_digest: str
    reset_id: str
    schema_attestation_digest: str
    station_runtime_identity: str
    completed_at: datetime

    def product_payload(self) -> dict[str, str]:
        return {
            "resultDigest": self.result_digest,
            "resetId": self.reset_id,
            "schemaAttestationDigest": self.schema_attestation_digest,
            "stationRuntimeIdentity": self.station_runtime_identity,
        }

    def manifest_payload(self) -> dict[str, str]:
        return {
            "result_digest": self.result_digest,
            "reset_id": self.reset_id,
            "schema_attestation_digest": self.schema_attestation_digest,
            "station_runtime_identity": self.station_runtime_identity,
        }


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
                allows_owner_continuation=True,
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
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-desktop-alice",
                        "secure-content-desktop-bob",
                        "secure-content-desktop-eve",
                        "secure-content-desktop-remote-recipient",
                    }
                ),
                required_service_ids=frozenset(
                    {"station-four", "station-five-arm"}
                ),
                required_fixture_owners={
                    "remote-private-recipient": "actor-identity-provisioner",
                },
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
                required_service_ids=frozenset({"station-four"}),
            ),
            "subtype": ChildSpec(
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
                required_service_ids=frozenset({"station-four"}),
            ),
            "object": ChildSpec(
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
                required_service_ids=frozenset({"station-four"}),
            ),
            "delete-block": ChildSpec(
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
                required_service_ids=frozenset({"station-four"}),
            ),
            "bounds": ChildSpec(
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
                required_service_ids=frozenset({"station-four"}),
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
                "secure-content-w2",
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
                "secure-content-w2",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset({"ios_alice", "ios_bob"}),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w2",
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
                        "secure-content-hardcut-ios-remote_bob",
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
                        "secure-content-hardcut-android-remote_bob",
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
            "ios": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-final-mobile",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-ios-alice",
                        "secure-content-ios-bob",
                        "secure-content-ios-eve",
                    }
                ),
            ),
            "android": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-final-mobile",
                frozenset({"four"}),
                frozenset(
                    {
                        "secure-content-android-alice",
                        "secure-content-android-bob",
                        "secure-content-android-eve",
                    }
                ),
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
                frozenset(
                    {
                        "secure-content-ios-alice",
                        "secure-content-ios-remote_bob",
                    }
                ),
            ),
            "chat-android": ChildSpec(
                "mobile",
                "secure-content-w12",
                "sc-dj-chat-attachment-mobile",
                frozenset({"four", "fiveArm"}),
                frozenset(
                    {
                        "secure-content-android-alice",
                        "secure-content-android-remote_bob",
                    }
                ),
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


def _parse_timestamp(value: Any, *, label: str) -> datetime:
    if not isinstance(value, str) or not value or value != value.strip():
        raise AggregateError("CHILD_RESULT_INVALID", f"{label} is invalid")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise AggregateError(
            "CHILD_RESULT_INVALID",
            f"{label} is invalid",
        ) from error
    if parsed.tzinfo is None:
        raise AggregateError("CHILD_RESULT_INVALID", f"{label} is invalid")
    return parsed.astimezone(timezone.utc)


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

        final_cut_children: dict[
            str,
            tuple[Path, Mapping[str, Any], str],
        ] = {}
        final_cut_bindings: dict[str, FinalCutBinding] = {}
        if workstream == "W12":
            for variant, child_spec in spec.variants.items():
                if child_spec is not None:
                    continue
                child = self._load_final_cut_child(
                    generation=generation,
                    variant=variant,
                )
                final_cut_children[variant] = child
                profile, _, _ = FINAL_CUT_VARIANTS[variant]
                final_cut_bindings[profile] = self._final_cut_binding(
                    generation=generation,
                    variant=variant,
                    result=child[1],
                    result_digest=child[2],
                )

        children: list[dict[str, Any]] = []
        post_cut_epoch_id: str | None = None
        suite_runtime_id: str | None = None
        suite_result_digests: dict[str, str] = {}
        for variant in expected_variants:
            child_spec = spec.variants[variant]
            if child_spec is None:
                path, result, digest = final_cut_children.get(variant) or (
                    self._load_final_cut_child(
                        generation=generation,
                        variant=variant,
                    )
                )
                child_kind = str(result["kind"])
            else:
                path, result, digest = self._load_product_child(
                    workstream=workstream,
                    generation=generation,
                    variant=variant,
                    spec=child_spec,
                    final_cut_bindings=final_cut_bindings,
                )
                child_kind = RESULT_KIND
                if workstream == "W12":
                    child_epoch = str(result["postCutEpochId"])
                    if post_cut_epoch_id is None:
                        post_cut_epoch_id = child_epoch
                    elif child_epoch != post_cut_epoch_id:
                        raise AggregateError(
                            "CHILD_RESULT_INVALID",
                            "W12 product children do not share postCutEpochId",
                        )
                    child_suite_runtime_id = str(result["runId"])
                    if suite_runtime_id is None:
                        suite_runtime_id = child_suite_runtime_id
                    elif child_suite_runtime_id != suite_runtime_id:
                        raise AggregateError(
                            "CHILD_RESULT_INVALID",
                            "W12 product children do not share suiteRuntimeId",
                        )
                    suite_result_digests[variant] = digest
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
        if workstream == "W12":
            if post_cut_epoch_id is None or suite_runtime_id is None:
                raise AggregateError(
                    "RESULT_SET_INCOMPLETE",
                    "W12 product children have no Suite Runtime binding",
                )
            suite_report_path, suite_report = (
                self._load_w12_suite_runtime_report(
                    generation=generation,
                    suite_runtime_id=suite_runtime_id,
                    post_cut_epoch_id=post_cut_epoch_id,
                    result_digests=suite_result_digests,
                )
            )
            result["postCutEpochId"] = post_cut_epoch_id
            result["finalCutBindings"] = {
                profile: binding.product_payload()
                for profile, binding in final_cut_bindings.items()
            }
            result["suiteRuntime"] = {
                "suiteRuntimeId": suite_runtime_id,
                "fixtureEpoch": post_cut_epoch_id,
                "reportDigest": suite_report["reportDigest"],
                "reportRef": _artifact_ref(
                    self.result_root,
                    suite_report_path,
                ),
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
        final_cut_bindings: Mapping[str, FinalCutBinding],
    ) -> tuple[Path, Mapping[str, Any], str]:
        base = (
            self.result_root
            / workstream
            / ("product" if workstream == "W12" else "")
            / generation
            / variant
        )
        paths = sorted(base.glob("*/result.json"))
        if len(paths) == 1:
            path = paths[0]
            result = schema_activation.read_json_artifact(
                path,
                f"{workstream}/{variant} child result",
            )
        elif spec.allows_owner_continuation:
            path, result = self._load_owner_continuation_child(
                paths=paths,
                workstream=workstream,
                generation=generation,
                variant=variant,
                spec=spec,
            )
        else:
            raise AggregateError(
                "RESULT_SET_INCOMPLETE",
                (
                    f"{workstream}/{variant} requires exactly one child "
                    f"result, found {len(paths)}"
                ),
            )
        manifest = self._validate_product_child_identity(
            result=result,
            path=path,
            workstream=workstream,
            generation=generation,
            variant=variant,
            spec=spec,
            expected_result="PASS",
        )
        if workstream == "W12":
            self._validate_w12_product_causality(
                result=result,
                manifest=manifest,
                variant=variant,
                final_cut_bindings=final_cut_bindings,
            )
        if "firstFailure" in result:
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

    def _validate_product_child_identity(
        self,
        *,
        result: Mapping[str, Any],
        path: Path,
        workstream: str,
        generation: str,
        variant: str,
        spec: ChildSpec,
        expected_result: str,
    ) -> Mapping[str, Any]:
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
            "result": expected_result,
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
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} runtime binding is invalid",
            )
        manifest = self._load_runtime_manifest(
            result,
            label=f"{workstream}/{variant}",
        )
        self._validate_runtime_manifest_binding(
            result=result,
            manifest=manifest,
            manifest_path=Path(str(result["runtimeManifestRef"])).resolve(),
            generation=generation,
            label=f"{workstream}/{variant}",
            spec=spec,
        )
        return manifest

    def _validate_w12_product_causality(
        self,
        *,
        result: Mapping[str, Any],
        manifest: Mapping[str, Any],
        variant: str,
        final_cut_bindings: Mapping[str, FinalCutBinding],
    ) -> None:
        expected_profiles = set(FINAL_CUT_PROFILES)
        product_bindings = result.get("finalCutBindings")
        manifest_bindings = manifest.get("final_cut_bindings")
        if (
            not isinstance(product_bindings, Mapping)
            or set(product_bindings) != expected_profiles
            or not isinstance(manifest_bindings, Mapping)
            or set(manifest_bindings) != expected_profiles
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} final-cut binding is invalid",
            )
        for profile in sorted(expected_profiles):
            expected = final_cut_bindings.get(profile)
            product_binding = product_bindings.get(profile)
            manifest_binding = manifest_bindings.get(profile)
            if (
                expected is None
                or not isinstance(product_binding, Mapping)
                or set(product_binding) != PRODUCT_FINAL_CUT_BINDING_FIELDS
                or dict(product_binding) != expected.product_payload()
                or not isinstance(manifest_binding, Mapping)
                or set(manifest_binding) != MANIFEST_FINAL_CUT_BINDING_FIELDS
                or dict(manifest_binding) != expected.manifest_payload()
            ):
                raise AggregateError(
                    "CHILD_RESULT_INVALID",
                    f"W12/{variant} final-cut binding is invalid",
                )

        post_cut_epoch_id = result.get("postCutEpochId")
        if (
            not isinstance(post_cut_epoch_id, str)
            or not post_cut_epoch_id
            or post_cut_epoch_id != post_cut_epoch_id.strip()
            or manifest.get("post_cut_epoch_id") != post_cut_epoch_id
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} postCutEpochId is invalid",
            )
        product_started_at = _parse_timestamp(
            result.get("startedAt"),
            label=f"W12/{variant} startedAt",
        )
        if any(
            binding.completed_at >= product_started_at
            for binding in final_cut_bindings.values()
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                (
                    f"W12/{variant} final-cut completion must precede "
                    "product child start"
                ),
            )

    def _load_w12_suite_runtime_report(
        self,
        *,
        generation: str,
        suite_runtime_id: str,
        post_cut_epoch_id: str,
        result_digests: Mapping[str, str],
    ) -> tuple[Path, Mapping[str, Any]]:
        if (
            not suite_runtime_id
            or suite_runtime_id != suite_runtime_id.strip()
            or Path(suite_runtime_id).name != suite_runtime_id
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                "W12 suiteRuntimeId is invalid",
            )
        path = (
            self.result_root
            / "runtime-owner"
            / suite_runtime_id
            / "suite-runtime.json"
        )
        if path.is_symlink():
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                "W12 Suite Runtime report path is invalid",
            )
        try:
            resolved = path.resolve(strict=True)
            if self.result_root not in resolved.parents:
                raise AggregateError(
                    "CHILD_RESULT_INVALID",
                    "W12 Suite Runtime report escapes the result root",
                )
            report = schema_activation.read_json_artifact(
                resolved,
                "W12 Suite Runtime report",
            )
            validated = validate_suite_runtime_report(
                dict(report),
                expected_contract=W12_SUITE_RUNTIME_CONTRACT,
            )
        except (
            OSError,
            SuiteRuntimeError,
            schema_activation.SchemaActivationError,
        ) as error:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                "W12 Suite Runtime report is invalid",
            ) from error
        if (
            validated.get("suiteRuntimeId") != suite_runtime_id
            or validated.get("sourceDigest") != generation
            or validated.get("fixtureEpoch") != post_cut_epoch_id
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                "W12 Suite Runtime report binding is invalid",
            )
        expected_observations = sorted(
            (
                scenario_id,
                f"scenario-result:{result_digest}",
            )
            for scenario_id, result_digest in result_digests.items()
        )
        observed_observations = sorted(
            (
                str(event.get("scenarioId")),
                str(event.get("resourceId")),
            )
            for event in validated["events"]
            if event.get("action") == "supporting-observation"
            and str(event.get("resourceId")).startswith("scenario-result:")
        )
        if observed_observations != expected_observations:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                "W12 Suite Runtime report child bindings are invalid",
            )
        return resolved, validated

    def _validate_runtime_manifest_binding(
        self,
        *,
        result: Mapping[str, Any],
        manifest: Mapping[str, Any],
        manifest_path: Path,
        generation: str,
        label: str,
        spec: ChildSpec,
    ) -> None:
        source = manifest.get("source")
        services = manifest.get("services")
        clients = manifest.get("clients")
        if (
            not isinstance(source, Mapping)
            or source.get("commit") != generation
            or not isinstance(services, Mapping)
            or set(services) != set(result.get("serviceIds", ()))
            or (
                spec.required_service_ids
                and set(services) != set(spec.required_service_ids)
            )
            or not isinstance(clients, list)
            or {
                str(client.get("id"))
                for client in clients
                if isinstance(client, Mapping)
            }
            != set(spec.clients)
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest service/client binding is invalid",
            )

        fixture_ref = manifest.get("fixture_manifest_ref")
        fixture_digest = manifest.get("fixture_manifest_digest")
        if (
            not isinstance(fixture_ref, Mapping)
            or not isinstance(fixture_ref.get("path"), str)
            or not _is_sha256(fixture_ref.get("sha256"))
            or not _is_sha256(fixture_digest)
            or fixture_digest != result.get("fixtureManifestDigest")
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} fixture manifest binding is invalid",
            )
        fixture_candidate = (
            manifest_path.parent / str(fixture_ref["path"])
        )
        if fixture_candidate.is_symlink():
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} fixture manifest path is invalid",
            )
        try:
            fixture_path = fixture_candidate.resolve(strict=True)
            if manifest_path.parent not in fixture_path.parents:
                raise AggregateError(
                    "CHILD_RESULT_INVALID",
                    f"{label} fixture manifest path is invalid",
                )
            fixture_raw = fixture_path.read_bytes()
        except OSError as error:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} fixture manifest is unavailable",
            ) from error
        fixture = schema_activation.read_json_artifact(
            fixture_path,
            f"{label} fixture manifest",
        )
        unsigned_fixture = dict(fixture)
        persisted_fixture_digest = unsigned_fixture.pop(
            "manifest_digest",
            None,
        )
        if (
            hashlib.sha256(fixture_raw).hexdigest() != fixture_ref["sha256"]
            or persisted_fixture_digest != fixture_digest
            or persisted_fixture_digest
            != schema_activation.canonical_digest(unsigned_fixture)
            or fixture.get("source_checkpoint") != generation
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} fixture manifest identity is invalid",
            )

        expected_owners = dict(spec.required_fixture_owners or {})
        observed_owners = {
            str(handle.get("capability")): str(handle.get("owner"))
            for handle in fixture.get("handles", ())
            if isinstance(handle, Mapping)
        }
        if any(
            observed_owners.get(capability) != owner
            for capability, owner in expected_owners.items()
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} fixture owner binding is invalid",
            )

    def _load_runtime_manifest(
        self,
        result: Mapping[str, Any],
        *,
        label: str,
    ) -> Mapping[str, Any]:
        reference = result.get("runtimeManifestRef")
        if not isinstance(reference, str) or not Path(reference).is_absolute():
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest reference is invalid",
            )
        path = Path(reference)
        if path.is_symlink():
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest must not be a symbolic link",
            )
        try:
            resolved = path.resolve(strict=True)
        except OSError as error:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest is unavailable",
            ) from error
        if self.result_root not in resolved.parents:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest escapes the result root",
            )
        manifest = schema_activation.read_json_artifact(
            resolved,
            f"{label} runtime manifest",
        )
        digest = manifest.get("manifest_digest")
        unsigned = dict(manifest)
        unsigned.pop("manifest_digest", None)
        if (
            not _is_sha256(digest)
            or digest != result.get("runtimeManifestDigest")
            or not hmac.compare_digest(
                str(digest),
                schema_activation.canonical_digest(unsigned),
            )
            or manifest.get("run_id") != result.get("runId")
            or manifest.get("journey_id") != result.get("journeyId")
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{label} runtime manifest identity is invalid",
            )
        return manifest

    def _load_owner_continuation_child(
        self,
        *,
        paths: Sequence[Path],
        workstream: str,
        generation: str,
        variant: str,
        spec: ChildSpec,
    ) -> tuple[Path, Mapping[str, Any]]:
        if len(paths) != 2:
            raise AggregateError(
                "RESULT_SET_INCOMPLETE",
                (
                    f"{workstream}/{variant} requires one terminal child or "
                    "one blocked predecessor plus one passing continuation, "
                    f"found {len(paths)}"
                ),
            )
        candidates = [
            (
                path,
                schema_activation.read_json_artifact(
                    path,
                    f"{workstream}/{variant} continuation result",
                ),
            )
            for path in paths
        ]
        passed = [
            candidate
            for candidate in candidates
            if candidate[1].get("result") == "PASS"
        ]
        blocked = [
            candidate
            for candidate in candidates
            if candidate[1].get("result") == "BLOCKED"
        ]
        if len(passed) != 1 or len(blocked) != 1:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} continuation result set is ambiguous",
            )
        parent_path, parent = blocked[0]
        child_path, child = passed[0]
        self._validate_product_child_identity(
            result=parent,
            path=parent_path,
            workstream=workstream,
            generation=generation,
            variant=variant,
            spec=spec,
            expected_result="BLOCKED",
        )
        first_failure = parent.get("firstFailure")
        if (
            not isinstance(first_failure, Mapping)
            or first_failure.get("kind") != "BLOCKED_RUNTIME_ACTION_REQUIRED"
            or first_failure.get("retryable") is not True
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} predecessor is not a restart boundary",
            )
        _validate_digest(
            parent,
            "resultDigest",
            label=f"{workstream}/{variant} predecessor result",
        )
        parent_manifest = self._load_runtime_manifest(
            parent,
            label=f"{workstream}/{variant} predecessor",
        )
        child_manifest = self._load_runtime_manifest(
            child,
            label=f"{workstream}/{variant} continuation",
        )
        continuation = child_manifest.get("continuation")
        if not isinstance(continuation, Mapping):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} continuation lineage is missing",
            )
        restart_request_id = continuation.get("restart_request_id")
        if not isinstance(restart_request_id, str) or not restart_request_id:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} continuation lineage is invalid",
            )
        parent_run_id = parent.get("runId")
        expected_child_run_id = (
            f"{parent_run_id}-c-"
            + hashlib.sha256(
                f"{parent_run_id}:{restart_request_id}".encode("utf-8")
            ).hexdigest()[:12]
        )
        if (
            parent_manifest.get("continuation") is not None
            or continuation.get("parent_manifest_digest")
            != parent_manifest.get("manifest_digest")
            or child.get("runId") != expected_child_run_id
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"{workstream}/{variant} continuation lineage is invalid",
            )
        return child_path, child

    def _load_final_cut_child(
        self,
        *,
        generation: str,
        variant: str,
    ) -> tuple[Path, Mapping[str, Any], str]:
        try:
            profile, workstream, _ = FINAL_CUT_VARIANTS[variant]
        except KeyError as error:
            raise AggregateError(
                "AGGREGATE_SCOPE_INVALID",
                f"unsupported W12 final-cut variant {variant!r}",
            ) from error
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
        if result.get("reset_id") != path.parent.name:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} has invalid reset_id",
            )
        digest = _validate_digest(
            result,
            "result_digest",
            label=f"W12/{variant} final-cut result",
        )
        return path, result, digest

    def _final_cut_binding(
        self,
        *,
        generation: str,
        variant: str,
        result: Mapping[str, Any],
        result_digest: str,
    ) -> FinalCutBinding:
        profile, _, station_service_id = FINAL_CUT_VARIANTS[variant]
        reset_id = result.get("reset_id")
        schema_digest = result.get("schema_attestation_digest")
        if (
            not isinstance(reset_id, str)
            or not reset_id
            or reset_id != reset_id.strip()
            or not _is_sha256(schema_digest)
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} final-cut binding is invalid",
            )
        try:
            attestation_path, attestation = (
                schema_activation.read_referenced_artifact(
                    self.result_root,
                    result.get("schema_attestation_ref"),
                    f"W12/{variant} final-cut schema attestation",
                )
            )
        except (schema_activation.SchemaActivationError, OSError) as error:
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} final-cut schema attestation is invalid",
            ) from error
        attestation_content = dict(attestation)
        attestation_digest = attestation_content.pop(
            "attestation_digest",
            None,
        )
        station_runtime_identity = attestation.get(
            "station_runtime_identity"
        )
        expected_attestation = {
            "source_commit": generation,
            "workspace_id": self.identity["workspaceId"],
            "profile_id": profile,
            "station_service_id": station_service_id,
            "reset_intent": "FINAL_CUT",
        }
        expected_attestation_path = (
            self.result_root
            / "W12"
            / "final-cut"
            / generation
            / profile
            / reset_id
            / schema_activation.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
        )
        if (
            attestation_path != expected_attestation_path
            or any(
                attestation.get(field) != expected_value
                for field, expected_value in expected_attestation.items()
            )
            or attestation_digest != schema_digest
            or not hmac.compare_digest(
                str(attestation_digest),
                schema_activation.canonical_digest(attestation_content),
            )
            or not isinstance(station_runtime_identity, str)
            or not station_runtime_identity
            or station_runtime_identity != station_runtime_identity.strip()
        ):
            raise AggregateError(
                "CHILD_RESULT_INVALID",
                f"W12/{variant} final-cut schema attestation is invalid",
            )
        return FinalCutBinding(
            result_digest=result_digest,
            reset_id=reset_id,
            schema_attestation_digest=str(schema_digest),
            station_runtime_identity=station_runtime_identity,
            completed_at=_parse_timestamp(
                result.get("completed_at"),
                label=f"W12/{variant} completed_at",
            ),
        )


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
