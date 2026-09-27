#!/usr/bin/env python3
"""Generate fail-closed P0a Station frontend telemetry route capability evidence."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    inspect_command,
    latest_artifact,
    replace_resolved_artifact_paths,
)


PRODUCER_GATE_ID = "desktop-telemetry-route-probe-gate"
DEFAULT_OUTPUT = "reports/desktop-telemetry-route-probe.json"
DEFAULT_STATION = "http://10.37.246.80:18080"
ARTIFACT_KIND = "desktop-telemetry-route-probe"
RUNTIME_CLOSURE_ARTIFACT_KIND = "desktop-telemetry-runtime-closure-gate"
PHASE = "P0a-4/P0a-5/P0a-6/P0c-5"
BOM = ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
SPEC = ["SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
GATE = "Station frontend telemetry ingest/query/rollup routes must be available before Gateway upload, Station query, and Dev mirror proof can pass"
RUNTIME_CLOSURE_PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
RUNTIME_CLOSURE_BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
RUNTIME_CLOSURE_SPEC = ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
RUNTIME_CLOSURE_GATE = (
    "P0a Station runtime proof must use a managed Station+Postgres dependency closure before "
    "Gateway upload, route probe, query, rollup, mirror, or runtime sample emission can be trusted"
)
INGEST_PATH = "/telemetry/frontend/events/batch"
QUERY_PATH = "/telemetry/frontend/events/query"
ROLLUP_PATH = "/telemetry/frontend/rollups/query"
APP_META_VERSION_PATH = "/app-meta/version"
DEBUG_HANDLERS_PATH = "/debug/list-all-handlers"
LOCAL_STATION_MAIN = Path("apps/station/app/main.go")
LOCAL_FRONTEND_TELEMETRY_SUBSERVER = Path("apps/station/app/subserver/frontend_telemetry/subserver.go")
LOCAL_FRONTEND_TELEMETRY_HANDLER = Path("apps/station/app/subserver/frontend_telemetry/handler.go")
LOCAL_FRONTEND_TELEMETRY_STORE = Path("apps/station/app/subserver/frontend_telemetry/store.go")
LOCAL_STATION_ROUTE_CONTRACT_SOURCE_PATHS = [LOCAL_STATION_MAIN, LOCAL_FRONTEND_TELEMETRY_SUBSERVER]
LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS = [
    LOCAL_STATION_MAIN,
    LOCAL_FRONTEND_TELEMETRY_SUBSERVER,
    LOCAL_FRONTEND_TELEMETRY_HANDLER,
    LOCAL_FRONTEND_TELEMETRY_STORE,
]
LOCAL_STATION_ROUTE_SOURCE_PATHS = LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS
REQUIRED_LOCAL_ROUTE_TOKENS = [INGEST_PATH, QUERY_PATH, ROLLUP_PATH]
REQUIRED_ROUTE_CONTRACTS = [
    {"name": "frontend-telemetry-ingest", "path": INGEST_PATH, "method": "POST"},
    {"name": "frontend-telemetry-query", "path": QUERY_PATH, "method": "POST"},
    {"name": "frontend-telemetry-rollup-query", "path": ROLLUP_PATH, "method": "POST"},
]
UNKNOWN_RUNTIME_IDENTITY_VALUES = {"", "unknown", "UNKNOWN", "Unknown", None}


class GateError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def station_get_probe(station: str, path: str, timeout: float) -> dict[str, Any]:
    url = station.rstrip("/") + path
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            try:
                parsed: Any = json.loads(body) if body else {}
            except json.JSONDecodeError:
                parsed = body[:500]
            return {"path": path, "status": response.status, "body": parsed}
    except urllib.error.HTTPError as exc:
        return {"path": path, "status": exc.code, "body": exc.read().decode("utf-8", errors="replace")[:500]}
    except urllib.error.URLError as exc:
        return {"path": path, "status": "unreachable", "body": str(exc.reason)}
    except (TimeoutError, socket.timeout) as exc:
        return {"path": path, "status": "timeout", "body": str(exc)}


def station_post_probe(station: str, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    url = station.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return {"path": path, "status": response.status, "body": response.read().decode("utf-8")[:200]}
    except urllib.error.HTTPError as exc:
        return {"path": path, "status": exc.code, "body": exc.read().decode("utf-8", errors="replace")[:200]}
    except urllib.error.URLError as exc:
        raise GateError(f"Station {path} route probe failed: {exc.reason}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise GateError(f"Station {path} route probe timed out: {exc}") from exc


def read_json_if_present(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except OSError as exc:
        return None, str(exc)
    except json.JSONDecodeError as exc:
        return None, str(exc)


def runtime_closure_evidence(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    report, error = read_json_if_present(path)
    if report is None:
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "sourceArtifactKind": RUNTIME_CLOSURE_ARTIFACT_KIND,
            "sourcePhase": RUNTIME_CLOSURE_PHASE,
            "sourceBom": RUNTIME_CLOSURE_BOM,
            "sourceSpec": RUNTIME_CLOSURE_SPEC,
            "sourceGate": RUNTIME_CLOSURE_GATE,
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sampleEmissionAllowed": False,
            "managedRuntimeClosure": None,
            "reason": f"runtime closure artifact is missing or invalid: {error}",
            "details": ["runtime closure artifact is missing or invalid"],
        }
    details: list[str] = []
    if report.get("artifactKind") != RUNTIME_CLOSURE_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if report.get("phase") != RUNTIME_CLOSURE_PHASE:
        details.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in RUNTIME_CLOSURE_BOM):
        details.append("missing required runtime-closure BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in RUNTIME_CLOSURE_SPEC):
        details.append("missing required runtime-closure Spec binding")
    if report.get("completionStatus") != "DONE":
        details.append("runtime closure completionStatus is not DONE")
    if report.get("proofStatus") != "PROVEN":
        details.append("runtime closure proofStatus is not PROVEN")
    if report.get("sampleEmissionAllowed") is not True:
        details.append("runtime closure sampleEmissionAllowed is not true")
    summary = report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    return {
        "path": str(path),
        "sourceArtifact": str(path),
        "sourceArtifactKind": report.get("artifactKind"),
        "sourcePhase": report.get("phase"),
        "sourceBom": report.get("bom", []),
        "sourceSpec": report.get("spec", []),
        "sourceGate": report.get("gate"),
        "status": "pass" if not details else "diagnostic incomplete",
        "completionStatus": "DONE" if not details else "PARTIAL",
        "proofStatus": "PROVEN" if not details else "UNPROVEN",
        "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and not details,
        "managedRuntimeClosure": report.get("managedRuntimeClosure"),
        "localRuntimeClosureProofStatus": summary.get("localRuntimeClosureProofStatus"),
        "composeRuntimeClosureProofStatus": summary.get("composeRuntimeClosureProofStatus"),
        "dockerDaemonProofStatus": summary.get("dockerDaemonProofStatus"),
        "failedCheckCount": summary.get("failedCheckCount"),
          "checkReasons": summary.get("checkReasons") or {},
          "failedCheckReasons": summary.get("failedCheckReasons") or {},
          "localRuntimeClosure": summary.get("localRuntimeClosure") or {},
          "composeRuntimeClosure": summary.get("composeRuntimeClosure") or {},
        "reason": "runtime closure permits route proof trust"
        if not details
        else "runtime closure does not permit trusted route proof",
        "details": details,
    }


def runtime_closure_allows_route_trust(runtime_closure: dict[str, Any] | None) -> bool:
    if runtime_closure is None:
        return False
    return runtime_closure.get("proofStatus") == "PROVEN" and runtime_closure.get("sampleEmissionAllowed") is True


def route_trust_blocked_proofs(
    *,
    source_artifact: str,
    local_deployment: dict[str, Any],
    target_runtime: dict[str, Any],
    runtime_closure: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    prerequisites = [
        {
            "step": "runtime.closure",
            "proofStatus": (runtime_closure or {}).get("proofStatus"),
            "sampleEmissionAllowed": (runtime_closure or {}).get("sampleEmissionAllowed"),
            "blockedByStep": "runtime.closure",
            "reason": "managed Station+Postgres runtime closure must be PROVEN before route proof is trusted",
        },
        {
            "step": "local-source.deployable-head",
            "proofStatus": local_deployment.get("proofStatus"),
            "sampleEmissionAllowed": local_deployment.get("proofStatus") == "PROVEN",
            "blockedByStep": "local-source.deployable-head",
            "reason": local_deployment.get("reason")
            or "deployable HEAD source must prove frontend telemetry route contracts",
        },
        {
            "step": "local-source.head-route-contracts",
            "proofStatus": local_deployment.get("headRouteContractProofStatus"),
            "sampleEmissionAllowed": local_deployment.get("headRouteContractProofStatus") == "PROVEN",
            "blockedByStep": "local-source.head-route-contracts",
            "reason": "HEAD route contracts must include frontend telemetry ingest/query/rollup routes",
        },
        {
            "step": "target-runtime.identity",
            "proofStatus": target_runtime.get("identityProofStatus"),
            "sampleEmissionAllowed": target_runtime.get("identityProofStatus") == "PROVEN",
            "blockedByStep": "target-runtime.identity",
            "reason": (target_runtime.get("identity") or {}).get("reason")
            or "target Station runtime identity must prove stable deployment fields",
        },
        {
            "step": "target-runtime.route-contracts",
            "proofStatus": target_runtime.get("routeContractProofStatus"),
            "sampleEmissionAllowed": target_runtime.get("routeContractProofStatus") == "PROVEN",
            "blockedByStep": "target-runtime.route-contracts",
            "reason": "target Station runtime handler table must prove frontend telemetry route contracts",
        },
    ]
    blocked: list[dict[str, Any]] = []
    for prerequisite in prerequisites:
        if prerequisite["proofStatus"] == "PROVEN" and prerequisite["sampleEmissionAllowed"] is True:
            continue
        blocked.append(
            {
                "step": prerequisite["step"],
                "status": "blocked",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "blockedByStep": prerequisite["blockedByStep"],
                "reason": prerequisite["reason"],
                "sourceArtifact": source_artifact,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
            }
        )
    return blocked


def local_source_route_evidence(repo_root: Path) -> dict[str, Any]:
    main_path = repo_root / LOCAL_STATION_MAIN
    subserver_path = repo_root / LOCAL_FRONTEND_TELEMETRY_SUBSERVER
    evidence: dict[str, Any] = {
        "sourceKind": "local-station-source-route-registration",
        "repoRoot": str(repo_root),
        "mainPath": str(LOCAL_STATION_MAIN),
        "subserverPath": str(LOCAL_FRONTEND_TELEMETRY_SUBSERVER),
        "requiredRoutes": REQUIRED_LOCAL_ROUTE_TOKENS,
        "requiredRouteContracts": REQUIRED_ROUTE_CONTRACTS,
        "mainFilePresent": main_path.exists(),
        "subserverFilePresent": subserver_path.exists(),
        "registeredSubserver": False,
        "registeredRoutes": [],
        "missingRoutes": REQUIRED_LOCAL_ROUTE_TOKENS,
        "registeredRouteContracts": [],
        "missingRouteContracts": REQUIRED_ROUTE_CONTRACTS,
        "status": "diagnostic incomplete",
        "proofStatus": "UNPROVEN",
        "reason": "local Station source route registration has not been proven",
    }
    try:
        main_text = main_path.read_text(encoding="utf-8") if main_path.exists() else ""
        subserver_text = subserver_path.read_text(encoding="utf-8") if subserver_path.exists() else ""
    except OSError as exc:
        evidence["reason"] = f"failed to read local Station source route files: {exc}"
        return evidence

    registered_subserver = (
        "frontendtelemetry.NewFrontendTelemetrySubServer" in main_text
        and 'server.WithSubServer("frontend_telemetry"' in main_text
    )
    registered_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route in subserver_text]
    missing_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route not in registered_routes]
    registered_route_contracts = [
        contract
        for contract in REQUIRED_ROUTE_CONTRACTS
        if f'"{contract["name"]}"' in subserver_text
        and f'"{contract["path"]}"' in subserver_text
        and f'server.{contract["method"]}' in subserver_text
    ]
    registered_contract_paths = {contract["path"] for contract in registered_route_contracts}
    missing_route_contracts = [
        contract for contract in REQUIRED_ROUTE_CONTRACTS if contract["path"] not in registered_contract_paths
    ]
    evidence.update(
        {
            "registeredSubserver": registered_subserver,
            "registeredRoutes": registered_routes,
            "missingRoutes": missing_routes,
            "registeredRouteContracts": registered_route_contracts,
            "missingRouteContracts": missing_route_contracts,
            "routeContractStatus": "pass" if registered_subserver and not missing_route_contracts else "diagnostic incomplete",
            "routeContractProofStatus": "PROVEN" if registered_subserver and not missing_route_contracts else "UNPROVEN",
            "status": "pass" if registered_subserver and not missing_routes and not missing_route_contracts else "diagnostic incomplete",
            "proofStatus": "PROVEN" if registered_subserver and not missing_routes and not missing_route_contracts else "UNPROVEN",
            "reason": "local Station source registers frontend telemetry subserver and required route contracts"
            if registered_subserver and not missing_routes and not missing_route_contracts
            else "local Station source route registration is incomplete",
        }
    )
    return evidence


def git_output(repo_root: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def git_head_file_text(repo_root: Path, path: Path) -> tuple[str | None, str | None]:
    result = git_output(repo_root, ["show", f"HEAD:{path.as_posix()}"])
    if result.returncode == 0:
        return result.stdout, None
    return None, result.stderr.strip() or result.stdout.strip() or f"{path.as_posix()} is not present in HEAD"


def git_status_for_paths(repo_root: Path, paths: list[Path]) -> list[dict[str, str]]:
    result = git_output(repo_root, ["status", "--porcelain=v1", "--", *[path.as_posix() for path in paths]])
    if result.returncode != 0:
        return [{"path": path.as_posix(), "status": "unknown"} for path in paths]
    records: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        status = line[:2]
        path = line[3:] if len(line) > 3 else ""
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        records.append({"path": path, "status": status})
    return records


def route_contracts_from_source_text(main_text: str, subserver_text: str) -> dict[str, Any]:
    registered_subserver = (
        "frontendtelemetry.NewFrontendTelemetrySubServer" in main_text
        and 'server.WithSubServer("frontend_telemetry"' in main_text
    )
    registered_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route in subserver_text]
    missing_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route not in registered_routes]
    registered_route_contracts = [
        contract
        for contract in REQUIRED_ROUTE_CONTRACTS
        if f'"{contract["name"]}"' in subserver_text
        and f'"{contract["path"]}"' in subserver_text
        and f'server.{contract["method"]}' in subserver_text
    ]
    registered_contract_paths = {contract["path"] for contract in registered_route_contracts}
    missing_route_contracts = [
        contract for contract in REQUIRED_ROUTE_CONTRACTS if contract["path"] not in registered_contract_paths
    ]
    return {
        "registeredSubserver": registered_subserver,
        "registeredRoutes": registered_routes,
        "missingRoutes": missing_routes,
        "registeredRouteContracts": registered_route_contracts,
        "missingRouteContracts": missing_route_contracts,
    }


def local_source_deployment_evidence(repo_root: Path) -> dict[str, Any]:
    main_text, main_error = git_head_file_text(repo_root, LOCAL_STATION_MAIN)
    subserver_text, subserver_error = git_head_file_text(repo_root, LOCAL_FRONTEND_TELEMETRY_SUBSERVER)
    implementation_head_errors: list[dict[str, str | None]] = []
    for path in (LOCAL_FRONTEND_TELEMETRY_HANDLER, LOCAL_FRONTEND_TELEMETRY_STORE):
        _, error = git_head_file_text(repo_root, path)
        if error:
            implementation_head_errors.append({"path": path.as_posix(), "error": error})
    head_contracts = route_contracts_from_source_text(main_text or "", subserver_text or "")
    status_records = git_status_for_paths(repo_root, LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS)
    dirty_paths = [record for record in status_records if record.get("status", "").strip()]
    head_errors = [
        {"path": LOCAL_STATION_MAIN.as_posix(), "error": main_error},
        {"path": LOCAL_FRONTEND_TELEMETRY_SUBSERVER.as_posix(), "error": subserver_error},
    ]
    head_errors = [item for item in head_errors if item.get("error")]
    head_errors.extend(implementation_head_errors)
    head_route_contract_proven = (
        head_contracts["registeredSubserver"]
        and not head_contracts["missingRoutes"]
        and not head_contracts["missingRouteContracts"]
    )
    head_source_files_proven = not head_errors
    deployable = head_route_contract_proven and head_source_files_proven and not dirty_paths
    return {
        "sourceKind": "local-station-deployable-source-route-registration",
        "repoRoot": str(repo_root),
        "sourceRevision": "HEAD",
        "paths": [path.as_posix() for path in LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS],
        "routeContractSourcePaths": [path.as_posix() for path in LOCAL_STATION_ROUTE_CONTRACT_SOURCE_PATHS],
        "deployableSourcePaths": [path.as_posix() for path in LOCAL_STATION_DEPLOYABLE_SOURCE_PATHS],
        "headFileErrors": head_errors,
        "headSourceFileStatus": "pass" if head_source_files_proven else "diagnostic incomplete",
        "headSourceFileProofStatus": "PROVEN" if head_source_files_proven else "UNPROVEN",
        "headRegisteredSubserver": head_contracts["registeredSubserver"],
        "headRegisteredRoutes": head_contracts["registeredRoutes"],
        "headMissingRoutes": head_contracts["missingRoutes"],
        "headRegisteredRouteContracts": head_contracts["registeredRouteContracts"],
        "headMissingRouteContracts": head_contracts["missingRouteContracts"],
        "headRouteContractStatus": "pass" if head_route_contract_proven else "diagnostic incomplete",
        "headRouteContractProofStatus": "PROVEN" if head_route_contract_proven else "UNPROVEN",
        "workingTreeStatusRecords": status_records,
        "dirtyRelevantPaths": dirty_paths,
        "status": "pass" if deployable else "diagnostic incomplete",
        "proofStatus": "PROVEN" if deployable else "UNPROVEN",
        "reason": "HEAD contains deployable frontend telemetry route contracts and related source paths are clean"
        if deployable
        else "frontend telemetry route contracts are not proven in deployable HEAD source or related paths are dirty/untracked",
    }


def handler_paths_from_response(response_body: Any) -> list[str]:
    if isinstance(response_body, dict):
        handlers = response_body.get("handlers")
    elif isinstance(response_body, list):
        handlers = response_body
    else:
        handlers = []
    if not isinstance(handlers, list):
        return []
    paths: list[str] = []
    for handler in handlers:
        if not isinstance(handler, dict):
            continue
        path = handler.get("Path", handler.get("path"))
        if isinstance(path, str) and path:
            paths.append(path)
    return paths


def handler_records_from_response(response_body: Any) -> list[dict[str, Any]]:
    if isinstance(response_body, dict):
        handlers = response_body.get("handlers")
    elif isinstance(response_body, list):
        handlers = response_body
    else:
        handlers = []
    if not isinstance(handlers, list):
        return []
    records: list[dict[str, Any]] = []
    for handler in handlers:
        if not isinstance(handler, dict):
            continue
        path = handler.get("Path", handler.get("path"))
        method = handler.get("Method", handler.get("method"))
        name = handler.get("Name", handler.get("name"))
        if isinstance(path, str) and path:
            records.append(
                {
                    "name": name if isinstance(name, str) else None,
                    "path": path,
                    "method": method if isinstance(method, str) else None,
                }
            )
    return records


def matched_route_contracts(handler_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for contract in REQUIRED_ROUTE_CONTRACTS:
        record = next(
            (
                handler
                for handler in handler_records
                if handler.get("path") == contract["path"] and handler.get("method") == contract["method"]
            ),
            None,
        )
        if record:
            matches.append(
                {
                    "expected": contract,
                    "actual": record,
                }
            )
    return matches


def target_runtime_version_fingerprint(version_body: Any) -> dict[str, Any]:
    version = version_body.get("data") if isinstance(version_body, dict) and isinstance(version_body.get("data"), dict) else version_body
    if not isinstance(version, dict):
        return {
            "service": None,
            "buildCommit": None,
            "buildLabel": None,
            "buildTime": None,
            "goVersion": None,
        }
    return {
        "service": version.get("service") or version.get("Service"),
        "buildCommit": version.get("build_commit") or version.get("buildCommit") or version.get("commit") or version.get("gitCommit"),
        "buildLabel": version.get("build_label") or version.get("buildLabel") or version.get("label"),
        "buildTime": version.get("build_time") or version.get("buildTime"),
        "goVersion": version.get("go_version") or version.get("goVersion"),
    }


def target_runtime_identity_evidence(version_fingerprint: dict[str, Any]) -> dict[str, Any]:
    missing = [
        field
        for field in ("service", "buildCommit", "buildTime")
        if version_fingerprint.get(field) in UNKNOWN_RUNTIME_IDENTITY_VALUES
    ]
    weak = [
        field
        for field in ("buildLabel",)
        if version_fingerprint.get(field) in UNKNOWN_RUNTIME_IDENTITY_VALUES
    ]
    status = "pass" if not missing else "diagnostic incomplete"
    return {
        "status": status,
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "requiredFields": ["service", "buildCommit", "buildTime"],
        "weakFields": weak,
        "missingFields": missing,
        "reason": "target Station runtime version identity has service, build commit, and build time"
        if status == "pass"
        else "target Station runtime version identity is missing stable deployment fields",
    }


def target_station_runtime_evidence(station: str, timeout: float) -> dict[str, Any]:
    version_probe = station_get_probe(station, APP_META_VERSION_PATH, timeout)
    handlers_probe = station_get_probe(station, DEBUG_HANDLERS_PATH, timeout)
    handler_records = handler_records_from_response(handlers_probe.get("body"))
    handler_paths = [record["path"] for record in handler_records]
    registered_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route in handler_paths]
    missing_routes = [route for route in REQUIRED_LOCAL_ROUTE_TOKENS if route not in registered_routes]
    matched_contracts = matched_route_contracts(handler_records)
    matched_contract_paths = {match["expected"]["path"] for match in matched_contracts}
    missing_contracts = [
        contract for contract in REQUIRED_ROUTE_CONTRACTS if contract["path"] not in matched_contract_paths
    ]
    handler_table_proven = handlers_probe.get("status") == 200
    version_proven = version_probe.get("status") == 200
    version_fingerprint = target_runtime_version_fingerprint(version_probe.get("body"))
    identity = target_runtime_identity_evidence(version_fingerprint)
    return {
        "sourceKind": "target-station-runtime-route-fingerprint",
        "station": station,
        "versionEndpoint": APP_META_VERSION_PATH,
        "handlerEndpoint": DEBUG_HANDLERS_PATH,
        "versionStatus": "pass" if version_proven else "diagnostic incomplete",
        "versionProofStatus": "PROVEN" if version_proven else "UNPROVEN",
        "version": version_probe.get("body"),
        "versionFingerprint": version_fingerprint,
        "identityStatus": identity["status"],
        "identityProofStatus": identity["proofStatus"],
        "identity": identity,
        "handlerTableStatus": "pass" if handler_table_proven else "diagnostic incomplete",
        "handlerTableProofStatus": "PROVEN" if handler_table_proven else "UNPROVEN",
        "handlerCount": len(handler_paths),
        "requiredRouteContracts": REQUIRED_ROUTE_CONTRACTS,
        "matchedRouteContracts": matched_contracts,
        "missingRouteContracts": missing_contracts,
        "routeContractStatus": "pass" if handler_table_proven and not missing_contracts else "diagnostic incomplete",
        "routeContractProofStatus": "PROVEN" if handler_table_proven and not missing_contracts else "UNPROVEN",
        "registeredTelemetryRoutes": registered_routes,
        "missingTelemetryRoutes": missing_routes,
        "routeRegistrationStatus": "pass" if handler_table_proven and not missing_routes else "diagnostic incomplete",
        "routeRegistrationProofStatus": "PROVEN" if handler_table_proven else "UNPROVEN",
        "status": "pass" if version_proven and handler_table_proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if version_proven and handler_table_proven else "UNPROVEN",
        "reason": "target Station runtime handler table contains all frontend telemetry routes"
        if handler_table_proven and not missing_routes
        else "target Station runtime handler table does not prove all frontend telemetry routes",
        "probes": {
            "version": version_probe,
            "handlers": handlers_probe,
        },
    }


def probe_routes(station: str, timeout: float) -> list[dict[str, Any]]:
    probes = [
        station_post_probe(station, INGEST_PATH, {"events": []}, timeout),
        station_post_probe(station, QUERY_PATH, {"limit": 1}, timeout),
        station_post_probe(station, ROLLUP_PATH, {"limit": 1}, timeout),
    ]
    for probe in probes:
        path = str(probe.get("path") or "unknown")
        status = int(probe.get("status") or 0)
        body = str(probe.get("body") or "")
        if status == 404:
            raise GateError(f"Station telemetry route missing path={path} status=404 body={body}")
        if status in {200, 400, 401, 403}:
            continue
        raise GateError(f"Station telemetry route probe failed path={path} status={status} body={body}")
    return probes


def recommended_review_commands(station: str) -> list[dict[str, str]]:
    return [
        {
            "purpose": "Inspect the latest route probe artifact.",
            "command": inspect_command(PRODUCER_GATE_ID, "report"),
        },
        {
            "purpose": "Prove managed Station+Postgres runtime closure before trusting route proof.",
            "command": "python3 tooling/scripts/desktop-telemetry-runtime-closure-gate.py",
        },
        {
            "purpose": "Verify that the local Station build registers the frontend telemetry routes expected by P0a.",
            "command": "rg -n 'frontend_telemetry|/telemetry/frontend/events/batch|/telemetry/frontend/events/query|/telemetry/frontend/rollups/query' apps/station/app/main.go apps/station/app/subserver/frontend_telemetry",
        },
        {
            "purpose": "Run the Station route capability probe against the selected Station.",
            "command": f"python3 tooling/scripts/desktop-telemetry-route-probe.py --station {station}",
        },
        {
            "purpose": "Inspect selected Station runtime handler registration for frontend telemetry routes.",
            "command": f"curl -fsS {station.rstrip('/')}{DEBUG_HANDLERS_PATH} | jq '.handlers[] | select(.Path | contains(\"/telemetry/frontend\"))'",
        },
        {
            "purpose": "Inspect selected Station runtime version metadata.",
            "command": f"curl -fsS {station.rstrip('/')}{APP_META_VERSION_PATH}",
        },
        {
            "purpose": "Run the live Gateway -> Station telemetry gate after route capability passes.",
            "command": f"python3 tooling/scripts/desktop-telemetry-live-gate.py --station {station}",
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def classify_failure(failed_step: str, error: str) -> dict[str, Any]:
    category = "station-telemetry-route-missing" if "status=404" in error else "station-telemetry-route-probe"
    return {
        "category": category,
        "failedStep": failed_step,
        "status": "fail",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "summary": "Station telemetry route capability probe did not prove ingest/query/rollup routes are available.",
        "proofImpact": "P0a upload, Station ingest, raw/rollup query, and Dev mirror proof remain PARTIAL/UNPROVEN.",
    }


def issue_breakdown(
    failed_step: str,
    error: str,
    details: list[dict[str, Any]],
    review_commands: list[dict[str, str]],
    source_artifact: str,
    local_source: dict[str, Any],
    local_deployment: dict[str, Any],
    target_runtime: dict[str, Any],
    runtime_closure: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    issue = classify_failure(failed_step, error)
    runtime_routes_missing = bool(target_runtime.get("missingTelemetryRoutes")) and (
        target_runtime.get("handlerTableProofStatus") == "PROVEN"
    )
    environment_classification = (
        "target-station-handler-missing-while-local-source-registers-routes"
        if failed_step == "station.telemetry_routes"
        and issue.get("category") == "station-telemetry-route-missing"
        and local_source.get("proofStatus") == "PROVEN"
        and runtime_routes_missing
        else
        "target-station-route-missing-while-local-source-registers-routes"
        if failed_step == "station.telemetry_routes"
        and issue.get("category") == "station-telemetry-route-missing"
        and local_source.get("proofStatus") == "PROVEN"
        else "target-station-route-unproven"
    )
    issue.update(
        {
            "sourceArtifact": source_artifact,
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
            "details": details,
            "evidenceDetails": details,
            "environmentClassification": environment_classification,
            "localSourceRouteEvidence": local_source,
            "localSourceDeploymentEvidence": local_deployment,
            "targetRuntimeRouteEvidence": target_runtime,
            "runtimeClosureEvidence": runtime_closure,
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }
    )
    return [issue]


def route_probe_summary(
    *,
    station: str,
    local_source: dict[str, Any],
    local_deployment: dict[str, Any],
    target_runtime: dict[str, Any],
    runtime_closure: dict[str, Any] | None,
    steps: list[dict[str, Any]],
    status: str,
    route_proof_trusted: bool,
    route_trust_blocked_proofs: list[dict[str, Any]],
    failed_step: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    routes_step = next((step for step in steps if step.get("name") == "station.telemetry_routes"), None)
    routes_detail = routes_step.get("detail") if isinstance(routes_step, dict) else None
    routes = routes_detail.get("routes") if isinstance(routes_detail, dict) else None
    if not isinstance(routes, list):
        routes = []
    environment_classification = (
        "target-station-handler-missing-while-local-source-registers-routes"
        if failed_step == "station.telemetry_routes"
        and error
        and "status=404" in error
        and local_source.get("proofStatus") == "PROVEN"
        and target_runtime.get("handlerTableProofStatus") == "PROVEN"
        and target_runtime.get("missingTelemetryRoutes")
        else
        "target-station-route-missing-while-local-source-registers-routes"
        if failed_step == "station.telemetry_routes"
        and error
        and "status=404" in error
        and local_source.get("proofStatus") == "PROVEN"
        else "target-station-routes-available"
        if status == "pass"
        else "target-station-route-unproven"
    )
    target_route_contract_summary = route_contract_summary(
        target_runtime.get("requiredRouteContracts") or REQUIRED_ROUTE_CONTRACTS,
        target_runtime.get("matchedRouteContracts") or [],
        target_runtime.get("missingRouteContracts") or [],
    )
    return {
        "station": station,
        "status": status,
        "anonymousProbeStatus": routes_step.get("status") if isinstance(routes_step, dict) else "not-run",
        "routeProbeStatus": routes_step.get("status") if isinstance(routes_step, dict) else "not-run",
        "requiredRouteCount": len(REQUIRED_LOCAL_ROUTE_TOKENS),
        "requiredRoutes": REQUIRED_LOCAL_ROUTE_TOKENS,
        "requiredRouteContracts": REQUIRED_ROUTE_CONTRACTS,
        "probedRouteCount": len(routes),
        "probedRoutes": [route.get("path") for route in routes if isinstance(route, dict) and route.get("path")],
        "localSourceStatus": local_source.get("status"),
        "localSourceProofStatus": local_source.get("proofStatus"),
        "localSourceRegisteredRouteCount": len(local_source.get("registeredRoutes") or []),
        "localSourceMissingRouteCount": len(local_source.get("missingRoutes") or []),
        "localSourceRouteContractStatus": local_source.get("routeContractStatus"),
        "localSourceRouteContractProofStatus": local_source.get("routeContractProofStatus"),
        "localSourceRegisteredRouteContractCount": len(local_source.get("registeredRouteContracts") or []),
        "localSourceMissingRouteContractCount": len(local_source.get("missingRouteContracts") or []),
        "localSourceDeploymentStatus": local_deployment.get("status"),
        "localSourceDeploymentProofStatus": local_deployment.get("proofStatus"),
        "localSourceDeploymentReason": local_deployment.get("reason"),
        "localSourceHeadRouteContractStatus": local_deployment.get("headRouteContractStatus"),
        "localSourceHeadRouteContractProofStatus": local_deployment.get("headRouteContractProofStatus"),
        "localSourceHeadRegisteredRouteContractCount": len(local_deployment.get("headRegisteredRouteContracts") or []),
        "localSourceHeadMissingRouteContractCount": len(local_deployment.get("headMissingRouteContracts") or []),
        "localSourceDirtyRelevantPathCount": len(local_deployment.get("dirtyRelevantPaths") or []),
        "localSourceDirtyRelevantPaths": local_deployment.get("dirtyRelevantPaths") or [],
        "targetRuntimeStatus": target_runtime.get("status"),
        "targetRuntimeProofStatus": target_runtime.get("proofStatus"),
        "targetRuntimeVersionStatus": target_runtime.get("versionStatus"),
        "targetRuntimeVersionProofStatus": target_runtime.get("versionProofStatus"),
        "targetRuntimeVersion": target_runtime.get("version"),
        "targetRuntimeVersionFingerprint": target_runtime.get("versionFingerprint"),
        "targetRuntimeIdentityStatus": target_runtime.get("identityStatus"),
        "targetRuntimeIdentityProofStatus": target_runtime.get("identityProofStatus"),
        "targetRuntimeIdentity": target_runtime.get("identity"),
        "targetRuntimeHandlerTableStatus": target_runtime.get("handlerTableStatus"),
        "targetRuntimeHandlerCount": target_runtime.get("handlerCount"),
        "targetRuntimeRouteContractStatus": target_runtime.get("routeContractStatus"),
        "targetRuntimeRouteContractProofStatus": target_runtime.get("routeContractProofStatus"),
        "targetRuntimeMatchedRouteContractCount": len(target_runtime.get("matchedRouteContracts") or []),
        "targetRuntimeMissingRouteContractCount": len(target_runtime.get("missingRouteContracts") or []),
        "targetRuntimeMissingRouteContracts": target_runtime.get("missingRouteContracts") or [],
        "targetRuntimeRouteContractSummary": target_route_contract_summary,
        "targetRuntimeRegisteredRouteCount": len(target_runtime.get("registeredTelemetryRoutes") or []),
        "targetRuntimeMissingRouteCount": len(target_runtime.get("missingTelemetryRoutes") or []),
        "targetRuntimeMissingRoutes": target_runtime.get("missingTelemetryRoutes") or [],
        "runtimeClosureStatus": (runtime_closure or {}).get("status"),
        "runtimeClosureProofStatus": (runtime_closure or {}).get("proofStatus"),
        "runtimeClosureSampleEmissionAllowed": (runtime_closure or {}).get("sampleEmissionAllowed"),
        "runtimeClosureManagedRuntime": (runtime_closure or {}).get("managedRuntimeClosure"),
        "runtimeClosureLocalProofStatus": (runtime_closure or {}).get("localRuntimeClosureProofStatus"),
        "runtimeClosureComposeProofStatus": (runtime_closure or {}).get("composeRuntimeClosureProofStatus"),
        "runtimeClosureDockerDaemonProofStatus": (runtime_closure or {}).get("dockerDaemonProofStatus"),
        "runtimeClosureFailedCheckCount": (runtime_closure or {}).get("failedCheckCount"),
          "runtimeClosureCheckReasons": (runtime_closure or {}).get("checkReasons") or {},
          "runtimeClosureFailedCheckReasons": (runtime_closure or {}).get("failedCheckReasons") or {},
          "runtimeClosureLocalRuntimeClosure": (runtime_closure or {}).get("localRuntimeClosure") or {},
          "runtimeClosureComposeRuntimeClosure": (runtime_closure or {}).get("composeRuntimeClosure") or {},
        "routeProofTrusted": route_proof_trusted,
          "routeTrustBlockedProofs": route_trust_blocked_proofs,
          "routeTrustBlockedProofCount": len(route_trust_blocked_proofs),
        "failedStep": failed_step,
        "error": error,
        "environmentClassification": environment_classification,
        "sampleEmissionAllowed": route_proof_trusted,
    }


def route_contract_summary(
    required_contracts: list[dict[str, Any]],
    matched_contracts: list[dict[str, Any]],
    missing_contracts: list[dict[str, Any]],
) -> list[dict[str, str]]:
    matched_paths = {
        match.get("expected", {}).get("path")
        for match in matched_contracts
        if isinstance(match, dict) and isinstance(match.get("expected"), dict)
    }
    missing_paths = {contract.get("path") for contract in missing_contracts if isinstance(contract, dict)}
    summary: list[dict[str, str]] = []
    for contract in required_contracts:
        if not isinstance(contract, dict):
            continue
        path = str(contract.get("path") or "")
        status = "matched" if path in matched_paths else "missing" if path in missing_paths else "unproven"
        summary.append(
            {
                "name": str(contract.get("name") or ""),
                "path": path,
                "method": str(contract.get("method") or ""),
                "status": status,
            }
        )
    return summary


def build_report(
    station: str,
    timeout: float,
    output: str = DEFAULT_OUTPUT,
    repo_root: Path | None = None,
    runtime_closure_report: Path | None = None,
) -> dict[str, Any]:
    local_source = local_source_route_evidence((repo_root or Path.cwd()).resolve())
    local_deployment = local_source_deployment_evidence((repo_root or Path.cwd()).resolve())
    runtime_closure = runtime_closure_evidence(runtime_closure_report)
    target_runtime = target_station_runtime_evidence(station, timeout)
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "generatedAt": utc_now(),
        "station": station,
        "status": "unknown",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "localSourceRouteEvidence": local_source,
        "localSourceDeploymentEvidence": local_deployment,
        "targetRuntimeRouteEvidence": target_runtime,
        "runtimeClosureEvidence": runtime_closure,
        "steps": [],
    }
    review_commands = recommended_review_commands(station)
    try:
        probes = probe_routes(station, timeout)
        report["steps"].append({"name": "station.telemetry_routes", "status": "pass", "detail": {"routes": probes}})
        route_trust_proofs = route_trust_blocked_proofs(
            source_artifact=output,
            local_deployment=local_deployment,
            target_runtime=target_runtime,
            runtime_closure=runtime_closure,
        )
        route_proof_trusted = not route_trust_proofs
        report["status"] = "pass" if route_proof_trusted else "diagnostic incomplete"
        report["completionStatus"] = "DONE" if route_proof_trusted else "PARTIAL"
        report["proofStatus"] = "PROVEN" if route_proof_trusted else "UNPROVEN"
        report["sampleEmissionAllowed"] = route_proof_trusted
        report["routeProofTrusted"] = route_proof_trusted
        report["routeTrustBlockedProofs"] = route_trust_proofs
        report["routeTrustBlockedProofCount"] = len(route_trust_proofs)
        if not route_proof_trusted:
            report["failedStep"] = route_trust_proofs[0]["step"]
            report["reason"] = "Station telemetry routes responded, but route trust prerequisites are not all PROVEN"
        report["details"] = []
        route_trust_issues = [] if route_proof_trusted else [
            {
                "category": "route-trust-prerequisite-unproven",
                "failedStep": report["failedStep"],
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sampleEmissionAllowed": False,
                "summary": "Station telemetry routes responded, but route proof is not trusted because route trust prerequisites are UNPROVEN.",
                "proofImpact": "P0a route proof remains PARTIAL/UNPROVEN; Gateway upload, Station query, rollup, and Dev mirror proof cannot be trusted.",
                "sourceArtifact": output,
                "sourceArtifactKind": ARTIFACT_KIND,
                "sourcePhase": PHASE,
                "sourceBom": BOM,
                "sourceSpec": SPEC,
                "sourceGate": GATE,
                "runtimeClosureEvidence": runtime_closure,
                "routeTrustBlockedProofs": route_trust_proofs,
                "recommended_review_commands": review_commands,
                "recommendedReviewCommands": review_commands,
            }
        ]
        report["issue_breakdown"] = route_trust_issues
        report["issueBreakdown"] = route_trust_issues
        report["recommended_review_commands"] = review_commands
        report["recommendedReviewCommands"] = review_commands
        report["summary"] = route_probe_summary(
            station=station,
            local_source=local_source,
            local_deployment=local_deployment,
            target_runtime=target_runtime,
            runtime_closure=runtime_closure,
            steps=report["steps"],
            status=report["status"],
            route_proof_trusted=route_proof_trusted,
            route_trust_blocked_proofs=route_trust_proofs,
            failed_step=report.get("failedStep"),
            error=report.get("reason"),
        )
        return report
    except GateError as exc:
        failed_step = "station.telemetry_routes"
        error = str(exc)
        details = [{"step": failed_step, "status": "fail", "error": error}]
        report["status"] = "fail"
        report["failedStep"] = failed_step
        report["reason"] = f"{failed_step} failed: {error}"
        report["steps"].append({"name": failed_step, "status": "fail", "detail": {"error": error}})
        route_trust_proofs = route_trust_blocked_proofs(
            source_artifact=output,
            local_deployment=local_deployment,
            target_runtime=target_runtime,
            runtime_closure=runtime_closure,
        )
        report["routeProofTrusted"] = False
        report["routeTrustBlockedProofs"] = route_trust_proofs
        report["routeTrustBlockedProofCount"] = len(route_trust_proofs)
        issues = issue_breakdown(
            failed_step,
            error,
            details,
            review_commands,
            output,
            local_source,
            local_deployment,
            target_runtime,
            runtime_closure,
        )
        if issues:
            issues[0]["routeTrustBlockedProofs"] = route_trust_proofs
        report["details"] = details
        report["issue_breakdown"] = issues
        report["issueBreakdown"] = issues
        report["recommended_review_commands"] = review_commands
        report["recommendedReviewCommands"] = review_commands
        report["summary"] = route_probe_summary(
            station=station,
            local_source=local_source,
            local_deployment=local_deployment,
            target_runtime=target_runtime,
            runtime_closure=runtime_closure,
            steps=report["steps"],
            status=report["status"],
            route_proof_trusted=False,
            route_trust_blocked_proofs=route_trust_proofs,
            failed_step=failed_step,
            error=error,
        )
        return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def format_markdown_list(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return ""
    return ",".join(str(value) for value in values)


def format_route_contracts(contracts: Any) -> str:
    if not isinstance(contracts, list) or not contracts:
        return ""
    values: list[str] = []
    for contract in contracts:
        if not isinstance(contract, dict):
            continue
        method = contract.get("method")
        path = contract.get("path")
        if isinstance(method, str) and isinstance(path, str):
            values.append(f"{method} {path}")
    return ",".join(values)


def render_markdown(report: dict[str, Any]) -> str:
    summary = report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    local_source = report.get("localSourceRouteEvidence")
    if not isinstance(local_source, dict):
        local_source = {}
    local_deployment = report.get("localSourceDeploymentEvidence")
    if not isinstance(local_deployment, dict):
        local_deployment = {}
    target_runtime = report.get("targetRuntimeRouteEvidence")
    if not isinstance(target_runtime, dict):
        target_runtime = {}
    route_trust_blocked_proofs = report.get("routeTrustBlockedProofs")
    if not isinstance(route_trust_blocked_proofs, list):
        route_trust_blocked_proofs = summary.get("routeTrustBlockedProofs")
    if not isinstance(route_trust_blocked_proofs, list):
        route_trust_blocked_proofs = []
    return "\n".join(
        [
            "# Desktop Telemetry Route Probe",
            "",
            f"- Artifact kind: `{report.get('artifactKind')}`",
            f"- Status: `{report.get('status')}`",
            f"- Completion: `{report.get('completionStatus')}`",
            f"- Proof: `{report.get('proofStatus')}`",
            f"- Sample emission allowed: `{report.get('sampleEmissionAllowed')}`",
            f"- Phase: `{report.get('phase')}`",
            f"- BOM: `{format_markdown_list(report.get('bom'))}`",
            f"- Spec: `{format_markdown_list(report.get('spec'))}`",
            f"- Gate: `{report.get('gate')}`",
            f"- Source kind: `{report.get('sourceArtifactKind')}`",
            f"- Source phase: `{report.get('sourcePhase')}`",
            f"- Source BOM: `{format_markdown_list(report.get('sourceBom'))}`",
            f"- Source Spec: `{format_markdown_list(report.get('sourceSpec'))}`",
            f"- Source Gate: `{report.get('sourceGate')}`",
            f"- Station: `{report.get('station')}`",
            f"- Failed step: `{report.get('failedStep')}`",
            f"- Environment classification: `{summary.get('environmentClassification')}`",
            f"- Route proof trusted: `{summary.get('routeProofTrusted')}`",
              f"- Route trust blocked proof count: `{summary.get('routeTrustBlockedProofCount')}`",
            "",
            "## Route Summary",
            "",
            f"- Required routes: `{format_markdown_list(summary.get('requiredRoutes'))}`",
            f"- Required route contracts: `{format_route_contracts(summary.get('requiredRouteContracts'))}`",
            f"- Probed routes: `{format_markdown_list(summary.get('probedRoutes'))}`",
            f"- Local source routes: `{summary.get('localSourceRegisteredRouteCount')}/{summary.get('requiredRouteCount')}`",
            f"- Local source missing routes: `{summary.get('localSourceMissingRouteCount')}`",
            f"- Local source route contracts: `{summary.get('localSourceRegisteredRouteContractCount')}/{summary.get('requiredRouteCount')}`",
            f"- Local source route contract proof: `{summary.get('localSourceRouteContractProofStatus')}`",
            f"- Local deployable source proof: `{summary.get('localSourceDeploymentProofStatus')}`",
            f"- Local deployable HEAD route contract proof: `{summary.get('localSourceHeadRouteContractProofStatus')}`",
            f"- Local deployable dirty relevant paths: `{summary.get('localSourceDirtyRelevantPathCount')}`",
            f"- Target runtime routes: `{summary.get('targetRuntimeRegisteredRouteCount')}/{summary.get('requiredRouteCount')}`",
            f"- Target runtime missing routes: `{format_markdown_list(summary.get('targetRuntimeMissingRoutes'))}`",
            f"- Target runtime route contracts: `{summary.get('targetRuntimeMatchedRouteContractCount')}/{summary.get('requiredRouteCount')}`",
            f"- Target runtime route contract proof: `{summary.get('targetRuntimeRouteContractProofStatus')}`",
            f"- Target runtime missing route contracts: `{format_route_contracts(summary.get('targetRuntimeMissingRouteContracts'))}`",
            f"- Target runtime handler count: `{summary.get('targetRuntimeHandlerCount')}`",
            f"- Target runtime handler table: `{summary.get('targetRuntimeHandlerTableStatus')}`",
              "",
              "## Route Trust Prerequisites",
              "",
              *[
                  "- `{step}` status=`{status}` proof=`{proof}` blockedBy=`{blocked_by}` sourceArtifact=`{artifact}`".format(
                      step=proof.get("step"),
                      status=proof.get("status"),
                      proof=proof.get("proofStatus"),
                      blocked_by=proof.get("blockedByStep"),
                      artifact=proof.get("sourceArtifact"),
                  )
                  for proof in route_trust_blocked_proofs
                  if isinstance(proof, dict)
              ],
            "",
            "## Runtime Closure State",
            "",
            f"- Runtime closure status: `{summary.get('runtimeClosureStatus')}`",
            f"- Runtime closure proof: `{summary.get('runtimeClosureProofStatus')}`",
            f"- Runtime closure sample emission allowed: `{summary.get('runtimeClosureSampleEmissionAllowed')}`",
            f"- Runtime closure managed runtime: `{summary.get('runtimeClosureManagedRuntime')}`",
            f"- Runtime closure local proof: `{summary.get('runtimeClosureLocalProofStatus')}`",
            f"- Runtime closure compose proof: `{summary.get('runtimeClosureComposeProofStatus')}`",
            f"- Runtime closure Docker daemon proof: `{summary.get('runtimeClosureDockerDaemonProofStatus')}`",
            f"- Runtime closure failed check count: `{summary.get('runtimeClosureFailedCheckCount')}`",
              f"- Runtime closure failed check reasons: `{json.dumps(summary.get('runtimeClosureFailedCheckReasons') or {}, sort_keys=True, ensure_ascii=False)}`",
              f"- Runtime closure local closure proof: `{(summary.get('runtimeClosureLocalRuntimeClosure') or {}).get('proofStatus')}`",
              f"- Runtime closure compose closure proof: `{(summary.get('runtimeClosureComposeRuntimeClosure') or {}).get('proofStatus')}`",
            "",
            "## Local Source Evidence",
            "",
            f"- Source kind: `{local_source.get('sourceKind')}`",
            f"- Status: `{local_source.get('status')}`",
            f"- Proof: `{local_source.get('proofStatus')}`",
            f"- Registered subserver: `{local_source.get('registeredSubserver')}`",
            f"- Registered routes: `{format_markdown_list(local_source.get('registeredRoutes'))}`",
            f"- Missing routes: `{format_markdown_list(local_source.get('missingRoutes'))}`",
            f"- Route contract proof: `{local_source.get('routeContractProofStatus')}`",
            f"- Registered route contracts: `{format_route_contracts(local_source.get('registeredRouteContracts'))}`",
            f"- Missing route contracts: `{format_route_contracts(local_source.get('missingRouteContracts'))}`",
            "",
            "## Local Deployable Source Evidence",
            "",
            f"- Source kind: `{local_deployment.get('sourceKind')}`",
            f"- Status: `{local_deployment.get('status')}`",
            f"- Proof: `{local_deployment.get('proofStatus')}`",
            f"- Reason: `{local_deployment.get('reason')}`",
            f"- Source revision: `{local_deployment.get('sourceRevision')}`",
            f"- HEAD route contract proof: `{local_deployment.get('headRouteContractProofStatus')}`",
            f"- HEAD registered route contracts: `{format_route_contracts(local_deployment.get('headRegisteredRouteContracts'))}`",
            f"- HEAD missing route contracts: `{format_route_contracts(local_deployment.get('headMissingRouteContracts'))}`",
            f"- Dirty relevant paths: `{format_markdown_list([item.get('path') for item in local_deployment.get('dirtyRelevantPaths', []) if isinstance(item, dict)])}`",
            f"- HEAD file errors: `{format_markdown_list([item.get('path') for item in local_deployment.get('headFileErrors', []) if isinstance(item, dict)])}`",
            "",
            "## Target Runtime Evidence",
            "",
            f"- Source kind: `{target_runtime.get('sourceKind')}`",
            f"- Status: `{target_runtime.get('status')}`",
            f"- Proof: `{target_runtime.get('proofStatus')}`",
            f"- Version status: `{target_runtime.get('versionStatus')}`",
            f"- Version proof: `{target_runtime.get('versionProofStatus')}`",
            f"- Version service: `{(target_runtime.get('versionFingerprint') or {}).get('service')}`",
            f"- Version build commit: `{(target_runtime.get('versionFingerprint') or {}).get('buildCommit')}`",
            f"- Version build label: `{(target_runtime.get('versionFingerprint') or {}).get('buildLabel')}`",
            f"- Version build time: `{(target_runtime.get('versionFingerprint') or {}).get('buildTime')}`",
            f"- Version Go: `{(target_runtime.get('versionFingerprint') or {}).get('goVersion')}`",
            f"- Identity status: `{target_runtime.get('identityStatus')}`",
            f"- Identity proof: `{target_runtime.get('identityProofStatus')}`",
            f"- Identity missing fields: `{format_markdown_list((target_runtime.get('identity') or {}).get('missingFields'))}`",
            f"- Handler table proof: `{target_runtime.get('handlerTableProofStatus')}`",
            f"- Handler count: `{target_runtime.get('handlerCount')}`",
            f"- Route contract proof: `{target_runtime.get('routeContractProofStatus')}`",
            f"- Matched route contracts: `{format_route_contracts([match.get('expected') for match in target_runtime.get('matchedRouteContracts', []) if isinstance(match, dict)])}`",
            f"- Missing route contracts: `{format_route_contracts(target_runtime.get('missingRouteContracts'))}`",
            f"- Registered telemetry routes: `{format_markdown_list(target_runtime.get('registeredTelemetryRoutes'))}`",
            f"- Missing telemetry routes: `{format_markdown_list(target_runtime.get('missingTelemetryRoutes'))}`",
            f"- Route registration status: `{target_runtime.get('routeRegistrationStatus')}`",
            "",
            "## Recommended Review Commands",
            "",
            *[
                f"- `{item.get('command')}`"
                for item in report.get("recommendedReviewCommands", [])
                if isinstance(item, dict) and item.get("command")
            ],
            "",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--station", default=os.environ.get("PT_STATION_URL", DEFAULT_STATION))
    parser.add_argument("--timeout", type=float, default=2.0)
    parser.add_argument("--output")
    parser.add_argument(
        "--runtime-closure-report",
    )
    args = parser.parse_args()
    runtime_closure_ref = None
    resolved_refs: dict[Path, dict[str, Any]] = {}
    if not args.runtime_closure_report:
        resolved_path, runtime_closure_ref = latest_artifact(
            "desktop-telemetry-runtime-closure-gate",
            "report",
        )
        args.runtime_closure_report = str(resolved_path)
        resolved_refs[resolved_path] = runtime_closure_ref

    output_path = explicit_output_path(args.output) if args.output else None
    logical_output = str(output_path) if output_path is not None else DEFAULT_OUTPUT
    report = build_report(
        args.station,
        args.timeout,
        logical_output,
        runtime_closure_report=Path(args.runtime_closure_report),
    )
    if runtime_closure_ref is not None:
        report["runtimeClosureArtifactRef"] = runtime_closure_ref
    report = replace_resolved_artifact_paths(report, resolved_refs)
    if output_path is not None:
        write_report(output_path, report)
        md_path = output_path.with_suffix(".md")
        md_path.write_text(render_markdown(report), encoding="utf-8")
        display_output = str(output_path)
        display_markdown = str(md_path)
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            session.write_json(DEFAULT_OUTPUT, report, role="report")
            session.write_bytes(
                str(Path(DEFAULT_OUTPUT).with_suffix(".md")),
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_output = DEFAULT_OUTPUT
        display_markdown = str(Path(DEFAULT_OUTPUT).with_suffix(".md"))
    print(f"desktop telemetry route probe: {display_output}")
    print(f"desktop telemetry route probe: {display_markdown}")
    print(f"status: {report['status']}")
    return 0 if report["proofStatus"] == "PROVEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())
