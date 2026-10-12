"""Durable evidence publishing for three-client foreground product Journeys."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import subprocess
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import ArtifactSession, source_identity


REPO_ROOT = Path(__file__).resolve().parents[4]
RESULT_KIND = "peers-touch-three-client-product-journey-result"
PREFLIGHT_KIND = "peers-touch-three-client-journey-preflight"
REQUIRED_CLIENT_IDS = frozenset(
    {"android-alice", "desktop-bob", "ios-coral"}
)


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid JSON: {error}") from error


def _required_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validated_file_ref(
    value: object,
    *,
    evidence_dir: Path,
    label: str,
) -> dict[str, Any]:
    reference = _required_mapping(value, label)
    file_path = Path(_required_text(reference.get("path"), f"{label}.path"))
    if not file_path.is_absolute():
        file_path = evidence_dir / file_path
    resolved = file_path.resolve()
    try:
        relative = resolved.relative_to(evidence_dir)
    except ValueError as error:
        raise ValueError(f"{label} escapes the evidence directory") from error
    if not resolved.is_file():
        raise ValueError(f"{label} file is missing")
    expected = _required_text(reference.get("sha256"), f"{label}.sha256")
    actual = _sha256(resolved)
    if actual != expected:
        raise ValueError(f"{label} sha256 does not match")
    return {
        "localPath": resolved,
        "relativePath": relative.as_posix(),
        "sha256": actual,
    }


def _validate_source(
    value: object,
    *,
    current_source: Mapping[str, Any],
    repo_root: Path,
    label: str,
) -> None:
    source = _required_mapping(value, label)
    if source.get("head") != current_source.get("commit"):
        raise ValueError(f"{label} commit does not match current source")
    if source.get("dirty") is not False:
        raise ValueError(f"{label} is not clean exact source")
    worktree = Path(_required_text(source.get("worktree"), f"{label}.worktree"))
    if worktree.resolve() != repo_root.resolve():
        raise ValueError(f"{label} worktree does not match")


def validate_journey_evidence(
    evidence_dir: Path,
    phase: str,
    *,
    repo_root: Path = REPO_ROOT,
    current_source: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    root = evidence_dir.resolve()
    if not root.is_dir():
        raise ValueError("three-client evidence directory is missing")
    source = dict(current_source or source_identity(repo_root))
    result = _required_mapping(
        _read_json(root / "result.json", "three-client result"),
        "three-client result",
    )
    preflight = _required_mapping(
        _read_json(root / "preflight.json", "three-client preflight"),
        "three-client preflight",
    )
    trace = _read_json(root / "interaction-trace.json", "interaction trace")
    suite_runtime = _required_mapping(
        _read_json(root / "suite-runtime.json", "Suite Runtime report"),
        "Suite Runtime report",
    )
    suite_input = _required_mapping(
        _read_json(root / "suite-runtime-input.json", "Suite Runtime input"),
        "Suite Runtime input",
    )

    if (
        result.get("kind") != RESULT_KIND
        or result.get("phase") != phase
        or result.get("status") != "PASS"
    ):
        raise ValueError("three-client result identity or status is invalid")
    if (
        preflight.get("kind") != PREFLIGHT_KIND
        or preflight.get("phase") != phase
        or preflight.get("status") != "READY"
    ):
        raise ValueError("three-client preflight identity or status is invalid")
    _validate_source(
        result.get("source"),
        current_source=source,
        repo_root=repo_root,
        label="result.source",
    )
    _validate_source(
        preflight.get("source"),
        current_source=source,
        repo_root=repo_root,
        label="preflight.source",
    )
    if (
        suite_runtime.get("result") != "PASS"
        or suite_runtime.get("proofState") != "SUPPORTING"
        or suite_input.get("sourceDigest") != source.get("commit")
    ):
        raise ValueError("Suite Runtime result is not current supporting proof")
    if not isinstance(trace, list) or not trace or result.get("interactionTrace") != trace:
        raise ValueError("interaction trace is missing or diverges from result")

    preflight_clients = preflight.get("clients")
    if not isinstance(preflight_clients, list):
        raise ValueError("preflight clients are missing")
    client_ids = {
        _required_text(client.get("clientId"), "preflight client id")
        for client in preflight_clients
        if isinstance(client, Mapping)
    }
    if client_ids != REQUIRED_CLIENT_IDS:
        raise ValueError("preflight does not contain the required three clients")

    files: dict[str, dict[str, Any]] = {}
    durable_preflight_clients = []
    for client in preflight_clients:
        owner = _required_mapping(client, "preflight client")
        projected = {
            "clientId": owner["clientId"],
            "foreground": owner.get("foreground"),
            "evidence": {},
        }
        for evidence_kind in ("screenshot", "source"):
            file_ref = _validated_file_ref(
                owner.get(evidence_kind),
                evidence_dir=root,
                label=f"preflight.{owner['clientId']}.{evidence_kind}",
            )
            files[file_ref["relativePath"]] = file_ref
            projected["evidence"][evidence_kind] = file_ref["relativePath"]
        durable_preflight_clients.append(projected)

    steps = []
    for index, row in enumerate(trace, start=1):
        step = _required_mapping(row, f"trace[{index - 1}]")
        if step.get("sequence") != index or step.get("status") != "PASS":
            raise ValueError("interaction trace sequence or status is invalid")
        client_id = _required_text(step.get("clientId"), "trace clientId")
        if client_id not in REQUIRED_CLIENT_IDS:
            raise ValueError("interaction trace contains an unknown client")
        evidence = _required_mapping(step.get("evidence"), "trace evidence")
        projected_evidence: dict[str, Any] = {}
        for evidence_kind in ("screenshot", "source", "state"):
            file_ref = _validated_file_ref(
                evidence.get(evidence_kind),
                evidence_dir=root,
                label=f"trace[{index - 1}].{evidence_kind}",
            )
            files[file_ref["relativePath"]] = file_ref
            projected_evidence[evidence_kind] = {
                "relativePath": file_ref["relativePath"],
                **(
                    {"value": evidence[evidence_kind].get("value")}
                    if evidence_kind == "state"
                    and isinstance(evidence[evidence_kind], Mapping)
                    else {}
                ),
            }
        steps.append(
            {
                "sequence": index,
                "clientId": client_id,
                "stepId": _required_text(step.get("stepId"), "trace stepId"),
                "status": "PASS",
                "startedAt": step.get("startedAt"),
                "completedAt": step.get("completedAt"),
                "result": step.get("result"),
                "evidence": projected_evidence,
            }
        )

    return {
        "source": source,
        "phase": phase,
        "stationUrl": result.get("stationUrl"),
        "scenarioIds": result.get("scenarioIds"),
        "suiteRuntime": dict(suite_runtime),
        "suiteRuntimeInput": dict(suite_input),
        "preflightClients": durable_preflight_clients,
        "steps": steps,
        "files": files,
    }


def _media_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _active_work(repo_root: Path) -> Mapping[str, Any]:
    output = subprocess.check_output(
        ["make", "active-work-status"],
        cwd=repo_root,
        text=True,
    )
    value = _required_mapping(json.loads(output), "active-work status")
    return _required_mapping(value.get("activeWork"), "active-work")


def publish_journey_evidence(
    evidence_dir: Path,
    phase: str,
    *,
    repo_root: Path = REPO_ROOT,
) -> dict[str, Any]:
    validated = validate_journey_evidence(
        evidence_dir,
        phase,
        repo_root=repo_root,
    )
    active_work = _active_work(repo_root)
    gate_id = f"mobile-three-client-{phase}-foreground-functional"
    with ArtifactSession(
        repo_root=repo_root,
        gate_id=gate_id,
        source=validated["source"],
    ) as artifacts:
        durable_files = {}
        for relative, file_ref in sorted(validated["files"].items()):
            artifact = artifacts.write_bytes(
                f"three-client/{phase}/raw/{relative}",
                file_ref["localPath"].read_bytes(),
                media_type=_media_type(file_ref["localPath"]),
            )
            durable_files[relative] = artifact.to_dict()

        def durable_evidence(owner: Mapping[str, Any]) -> dict[str, Any]:
            projected = dict(owner)
            evidence = {}
            for evidence_kind, reference in owner["evidence"].items():
                relative = (
                    reference
                    if isinstance(reference, str)
                    else reference["relativePath"]
                )
                evidence[evidence_kind] = {
                    "artifact": durable_files[relative],
                    **(
                        {"value": reference.get("value")}
                        if isinstance(reference, Mapping)
                        and "value" in reference
                        else {}
                    ),
                }
            projected["evidence"] = evidence
            return projected

        report = {
            "artifactKind": "three-client-foreground-functional-evidence",
            "schemaVersion": 1,
            "gateId": gate_id,
            "phase": phase,
            "status": "PASS",
            "proofState": "SUPPORTING",
            "source": validated["source"],
            "workItemId": active_work.get("workItemId"),
            "taskId": active_work.get("currentTaskId"),
            "journeyId": active_work.get("journeyId"),
            "stationUrl": validated["stationUrl"],
            "scenarioIds": validated["scenarioIds"],
            "clients": sorted(REQUIRED_CLIENT_IDS),
            "preflightClients": [
                durable_evidence(client)
                for client in validated["preflightClients"]
            ],
            "interactionTrace": [
                durable_evidence(step)
                for step in validated["steps"]
            ],
            "suiteRuntime": validated["suiteRuntime"],
            "claimBoundary": {
                "proves": [
                    "exact-source foreground product interaction on Android Alice, Desktop Bob, and iOS Coral",
                    "declared phase UI actions and receiver-visible assertions",
                    "durable screenshots, rendered source, UI state, and Suite Runtime lifecycle",
                ],
                "doesNotProve": [
                    "formal Acceptance",
                    "cross-Station or Relay behavior",
                    "physical-device behavior",
                    "Mobile inventory row visual review",
                ],
            },
        }
        report_ref = artifacts.write_json(
            f"three-client/{phase}/result.json",
            report,
            role="three-client-foreground-result",
        )
        suite_ref = artifacts.write_json(
            f"three-client/{phase}/suite-runtime.json",
            validated["suiteRuntime"],
            role="suite-runtime",
        )
        suite_input_ref = artifacts.write_json(
            f"three-client/{phase}/suite-runtime-input.json",
            validated["suiteRuntimeInput"],
            role="suite-runtime-input",
        )
        manifest_ref = artifacts.complete(
            status="passed",
            completion_status="DONE",
            proof_status="SUPPORTING",
            runtime={
                "clients": sorted(REQUIRED_CLIENT_IDS),
                "phase": phase,
                "suiteRuntime": suite_ref.to_dict(),
            },
        )
    return {
        "artifactKind": "three-client-foreground-functional-publication",
        "gateId": gate_id,
        "report": report_ref.to_dict(),
        "suiteRuntime": suite_ref.to_dict(),
        "suiteRuntimeInput": suite_input_ref.to_dict(),
        "manifest": manifest_ref.to_dict() if manifest_ref else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--phase", required=True)
    args = parser.parse_args()
    result = publish_journey_evidence(
        Path(args.evidence_dir),
        args.phase.strip(),
    )
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
