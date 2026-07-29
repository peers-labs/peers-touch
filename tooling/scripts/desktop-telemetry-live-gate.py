#!/usr/bin/env python3
"""Live gate for Desktop frontend telemetry Station loop.

This gate proves the P0a path with a synthetic event:

Desktop HTTP Gateway -> Station ingest -> Station raw/rollup query -> Dev mirror.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.246.80:18080"
DEFAULT_ACCOUNT = "b@p.t"
DEFAULT_PASSWORD = "1"
PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
SPEC = ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
GATE = "Desktop Gateway upload, Station ingest, raw/rollup query, and Dev mirror must all pass before live telemetry is proven"
ARTIFACT_KIND = "desktop-telemetry-live-gate"
RUNTIME_CLOSURE_ARTIFACT_KIND = "desktop-telemetry-runtime-closure-gate"
RUNTIME_CLOSURE_PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
RUNTIME_CLOSURE_BOM = ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"]
RUNTIME_CLOSURE_SPEC = ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"]
RUNTIME_CLOSURE_GATE = (
    "P0a Station runtime proof must use a managed Station+Postgres dependency closure before "
    "Gateway upload, route probe, query, rollup, mirror, or runtime sample emission can be trusted"
)
EXPECTED_STEPS = [
    "runtime.closure",
    "preflight.gateway_station",
    "station.create_temp_account",
    "gateway.auth_login",
    "gateway.frontend_telemetry_upload",
    "station.auth_login",
    "station.telemetry_routes",
    "station.raw_query",
    "station.rollup_query",
    "dev_mirror",
]
TEMP_ACCOUNT_PASSWORD_PREFIX = "Telemetry1!"
STATION_LOGIN_DEVICE_TYPE = "telemetry-live-gate"
FRONTEND_TELEMETRY_INGEST_PATH = "/telemetry/frontend/events/batch"
FRONTEND_TELEMETRY_QUERY_PATH = "/telemetry/frontend/events/query"
FRONTEND_TELEMETRY_ROLLUP_PATH = "/telemetry/frontend/rollups/query"
APP_META_VERSION_PATH = "/app-meta/version"
DEBUG_HANDLERS_PATH = "/debug/list-all-handlers"
LOCAL_STATION_MAIN = Path("apps/station/app/main.go")
LOCAL_FRONTEND_TELEMETRY_SUBSERVER = Path("apps/station/app/subserver/frontend_telemetry/subserver.go")
REQUIRED_LOCAL_ROUTE_TOKENS = [
    FRONTEND_TELEMETRY_INGEST_PATH,
    FRONTEND_TELEMETRY_QUERY_PATH,
    FRONTEND_TELEMETRY_ROLLUP_PATH,
]
REQUIRED_ROUTE_CONTRACTS = [
    {"name": "frontend-telemetry-ingest", "path": FRONTEND_TELEMETRY_INGEST_PATH, "method": "POST"},
    {"name": "frontend-telemetry-query", "path": FRONTEND_TELEMETRY_QUERY_PATH, "method": "POST"},
    {"name": "frontend-telemetry-rollup-query", "path": FRONTEND_TELEMETRY_ROLLUP_PATH, "method": "POST"},
]
UNKNOWN_RUNTIME_IDENTITY_VALUES = {"", "unknown", "UNKNOWN", "Unknown", None}


class GateError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def http_json(url: str, payload: dict[str, Any], timeout: float = 10.0) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GateError(f"POST {url} failed status={exc.code} body={body}") from exc
    except urllib.error.URLError as exc:
        raise GateError(f"POST {url} failed: {exc.reason}") from exc


def gateway_command(gateway: str, command: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    envelope = http_json(gateway, {"cmd": command, "args": args or {}})
    if not envelope.get("ok"):
        raise GateError(f"gateway command {command} failed envelope={envelope}")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise GateError(f"gateway command {command} returned non-object data: {envelope}")
    return data


def gateway_status(gateway: str, command: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    data = gateway_command(gateway, command, args)
    status = data.get("status")
    if not isinstance(status, str):
        raise GateError(f"gateway command {command} missing string status: {data}")
    return json.loads(status)


def station_post(station: str, path: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = station.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GateError(f"Station {path} failed status={exc.code} body={body}") from exc
    except urllib.error.URLError as exc:
        raise GateError(f"Station {path} failed: {exc.reason}") from exc


def station_post_probe(station: str, path: str, token: str, payload: dict[str, Any]) -> tuple[int, str]:
    url = station.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise GateError(f"Station {path} route probe failed: {exc.reason}") from exc


def station_get_probe(station: str, path: str, timeout: float = 10.0) -> dict[str, Any]:
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


def station_post_no_auth(station: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = station.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GateError(f"Station {path} failed status={exc.code} body={body}") from exc
    except urllib.error.URLError as exc:
        raise GateError(f"Station {path} failed: {exc.reason}") from exc


def data_or_self(value: dict[str, Any]) -> dict[str, Any]:
    data = value.get("data")
    return data if isinstance(data, dict) else value


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise GateError(f"runtime closure artifact is missing: {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise GateError(f"runtime closure artifact is not valid JSON: {path}: {exc}") from exc


def runtime_closure_evidence(path: Path) -> dict[str, Any]:
    report = read_json(path)
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
    blocked_downstream_proofs = report.get("blockedDownstreamProofs")
    if not isinstance(blocked_downstream_proofs, list):
        blocked_downstream_proofs = summary.get("blockedDownstreamProofs")
    if not isinstance(blocked_downstream_proofs, list):
        blocked_downstream_proofs = []
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
        "blockedDownstreamProofs": [proof for proof in blocked_downstream_proofs if isinstance(proof, dict)],
        "details": details,
        "issueBreakdown": report.get("issueBreakdown", report.get("issue_breakdown", [])),
        "recommendedReviewCommands": report.get("recommendedReviewCommands", report.get("recommended_review_commands", [])),
        "reason": "runtime closure permits live telemetry sample emission"
        if not details
        else "runtime closure does not permit live telemetry sample emission",
    }


def assert_runtime_closure(path: Path) -> dict[str, Any]:
    evidence = runtime_closure_evidence(path)
    if evidence["proofStatus"] != "PROVEN" or evidence["sampleEmissionAllowed"] is not True:
        raise GateError(
            "runtime closure does not allow live sample emission: "
            f"proofStatus={evidence['proofStatus']} sampleEmissionAllowed={evidence['sampleEmissionAllowed']} "
            f"local={evidence.get('localRuntimeClosureProofStatus')} "
            f"compose={evidence.get('composeRuntimeClosureProofStatus')} "
            f"docker={evidence.get('dockerDaemonProofStatus')}"
        )
    return evidence


def actor_token_from_auth(data: dict[str, Any]) -> str:
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    token = tokens.get("access_token")
    if token:
        return str(token)
    raw_token = data.get("token") or data.get("access_token")
    if raw_token:
        return str(raw_token)
    raise GateError(f"auth response missing token fields={sorted(data.keys())}")


def station_login_token(station: str, account: str, password: str) -> str:
    response = data_or_self(
        station_post_no_auth(
            station,
            "/actor/login",
            {"email": account, "password": password, "device_type": STATION_LOGIN_DEVICE_TYPE},
        )
    )
    return actor_token_from_auth(response)


def gateway_stub_status(data: dict[str, Any]) -> dict[str, Any]:
    status = data.get("status")
    if isinstance(status, str):
        try:
            parsed = json.loads(status)
        except json.JSONDecodeError as exc:
            raise GateError(f"gateway command status is not valid JSON: {status}") from exc
        if isinstance(parsed, dict):
            return parsed
    if isinstance(status, dict):
        return status
    return data


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
            matches.append({"expected": contract, "actual": record})
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


def target_station_runtime_evidence(station: str) -> dict[str, Any]:
    version_probe = station_get_probe(station, APP_META_VERSION_PATH)
    handlers_probe = station_get_probe(station, DEBUG_HANDLERS_PATH)
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


def create_temp_account(station: str) -> tuple[str, str]:
    suffix = f"{int(time.time() * 1000)}{secrets.token_hex(3)}"
    name = f"telemetry{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = TEMP_ACCOUNT_PASSWORD_PREFIX + secrets.token_hex(4)
    station_post_no_auth(station, "/actor/sign-up", {"name": name, "email": email, "password": password})
    return email, password


def assert_gateway_station(gateway: str, station: str) -> None:
    status = gateway_status(gateway, "station_list")
    active = str(status.get("active_url") or "").rstrip("/")
    if active != station.rstrip("/"):
        raise GateError(f"gateway active station mismatch got={active or 'empty'} want={station.rstrip('/')}")


def assert_station_telemetry_routes(station: str, token: str) -> dict[str, Any]:
    route_results: list[dict[str, Any]] = []

    ingest_status, ingest_body = station_post_probe(station, FRONTEND_TELEMETRY_INGEST_PATH, token, {"events": []})
    route_results.append({"path": FRONTEND_TELEMETRY_INGEST_PATH, "status": ingest_status, "body": ingest_body[:200]})
    if ingest_status == 404:
        raise GateError(f"Station telemetry route missing path={FRONTEND_TELEMETRY_INGEST_PATH} status=404 body={ingest_body}")
    if ingest_status not in {200, 400}:
        raise GateError(f"Station telemetry ingest route probe failed status={ingest_status} body={ingest_body}")

    for path, payload in [
        (FRONTEND_TELEMETRY_QUERY_PATH, {"limit": 1}),
        (FRONTEND_TELEMETRY_ROLLUP_PATH, {"limit": 1}),
    ]:
        status, body = station_post_probe(station, path, token, payload)
        route_results.append({"path": path, "status": status, "body": body[:200]})
        if status == 404:
            raise GateError(f"Station telemetry route missing path={path} status=404 body={body}")
        if status != 200:
            raise GateError(f"Station telemetry route probe failed path={path} status={status} body={body}")

    return {"routes": route_results}


def build_event(interaction_id: str) -> dict[str, Any]:
    now_ms = time.time() * 1000
    return {
        "id": f"telemetry-live-{int(now_ms)}",
        "schemaVersion": 1,
        "ts": now_ms,
        "kind": "boot.phase",
        "source": "acceptance",
        "module": "desktop-telemetry-live-gate",
        "runtime": "browser-gateway",
        "interactionId": interaction_id,
        "phase": "acceptance",
        "severity": "info",
        "durationMs": 12.0,
        "tags": {"gate": "p0a-live"},
        "data": {"state": "synthetic"},
    }


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def format_markdown_list(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return ""
    return ",".join(str(value) for value in values)


def route_count_pair(registered: Any, missing: Any) -> str:
    if isinstance(registered, int) and isinstance(missing, int):
        return f"{registered}/{registered + missing}"
    return "n/a"


def blocked_dependencies_for_issue(issue: dict[str, Any]) -> list[dict[str, Any]]:
    category = issue.get("category")
    failed_step = issue.get("failedStep")
    if category == "runtime-closure-unproven" and failed_step == "runtime.closure":
        return [
            {
                "blockedStep": "gateway.frontend_telemetry_upload",
                "blockedPhase": "P0a-3",
                "blockedGate": "Desktop Gateway frontend telemetry upload",
                "blockedByStep": "runtime.closure",
                "blockedByPhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                "blockedByGate": RUNTIME_CLOSURE_GATE,
                "blockedByCategory": category,
                "blockedDownstreamSteps": [
                    "preflight.gateway_station",
                    "gateway.auth_login",
                    "station.auth_login",
                    "station.telemetry_routes",
                    "gateway.frontend_telemetry_upload",
                    "station.raw_query",
                    "station.rollup_query",
                    "dev_mirror",
                ],
                "reason": "Live telemetry sample emission cannot start until a managed Station+Postgres runtime closure is proven.",
            }
        ]
    if category in {"station-telemetry-route-missing", "station-telemetry-route-probe"} and failed_step in {
        "station.telemetry_routes",
        "gateway.frontend_telemetry_upload",
    }:
        return [
            {
                "blockedStep": "gateway.frontend_telemetry_upload",
                "blockedPhase": "P0a-3",
                "blockedGate": "Desktop Gateway frontend telemetry upload",
                "blockedByStep": "station.telemetry_routes",
                "blockedByPhase": "P0a-4",
                "blockedByGate": "Station frontend telemetry route availability",
                "blockedByCategory": category,
                "blockedDownstreamSteps": ["station.raw_query", "station.rollup_query", "dev_mirror"],
                "reason": "Gateway upload cannot emit a proven sample until the selected Station runtime proves frontend telemetry ingest/query/rollup routes.",
            }
        ]
    return []


def first_blocked_dependency(report: dict[str, Any]) -> dict[str, Any]:
    issues = report.get("issueBreakdown", report.get("issue_breakdown"))
    if not isinstance(issues, list):
        return {}
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        blocked_by = issue.get("blockedBy")
        if isinstance(blocked_by, list) and blocked_by and isinstance(blocked_by[0], dict):
            return blocked_by[0]
    return {}


def runtime_closure_blocked_downstream_proofs(report: dict[str, Any]) -> list[dict[str, Any]]:
    runtime_closure = report.get("runtimeClosureEvidence")
    if not isinstance(runtime_closure, dict):
        return []
    proofs = runtime_closure.get("blockedDownstreamProofs")
    if not isinstance(proofs, list):
        return []
    return [proof for proof in proofs if isinstance(proof, dict)]


def apply_status_metadata(report: dict[str, Any]) -> dict[str, Any]:
    status = report.get("status")
    proven = status == "pass"
    report["completionStatus"] = "DONE" if proven else "PARTIAL"
    report["proofStatus"] = "PROVEN" if proven else "UNPROVEN"
    report["sampleEmissionAllowed"] = proven
    report["summary"] = live_gate_summary(report)
    return report


def live_gate_summary(report: dict[str, Any]) -> dict[str, Any]:
    steps = report.get("steps")
    if not isinstance(steps, list):
        steps = []
    step_statuses = {
        str(step.get("name")): step.get("status")
        for step in steps
        if isinstance(step, dict) and step.get("name")
    }
    expected_steps = [
        step_name
        for step_name in EXPECTED_STEPS
        if step_name != "station.create_temp_account" or report.get("createTempAccount")
    ]
    passed_steps = [step_name for step_name in expected_steps if step_statuses.get(step_name) == "pass"]
    failed_steps = [step_name for step_name in expected_steps if step_statuses.get(step_name) == "fail"]
    pending_steps = [step_name for step_name in expected_steps if step_name not in step_statuses]
    local_source = report.get("localSourceRouteEvidence")
    if not isinstance(local_source, dict):
        local_source = {}
    target_runtime = report.get("targetRuntimeRouteEvidence")
    if not isinstance(target_runtime, dict):
        target_runtime = {}
    runtime_closure = report.get("runtimeClosureEvidence")
    if not isinstance(runtime_closure, dict):
        runtime_closure = {}
    environment_classification = None
    issues = report.get("issueBreakdown", report.get("issue_breakdown"))
    if isinstance(issues, list):
        for issue in issues:
            if isinstance(issue, dict) and issue.get("environmentClassification"):
                environment_classification = issue.get("environmentClassification")
                break
    blocked_dependency = first_blocked_dependency(report)
    runtime_closure_blockers = runtime_closure_blocked_downstream_proofs(report)
    return {
        "gateway": report.get("gateway"),
        "station": report.get("station"),
        "status": report.get("status"),
        "completionStatus": report.get("completionStatus"),
        "proofStatus": report.get("proofStatus"),
        "sampleEmissionAllowed": report.get("sampleEmissionAllowed"),
        "createTempAccount": bool(report.get("createTempAccount")),
        "expectedStepCount": len(expected_steps),
        "passedStepCount": len(passed_steps),
        "failedStepCount": len(failed_steps),
        "pendingStepCount": len(pending_steps),
        "passedSteps": passed_steps,
        "failedSteps": failed_steps,
        "pendingSteps": pending_steps,
        "failedStep": report.get("failedStep"),
        "error": report.get("error"),
        "environmentClassification": environment_classification,
        "blockedStep": blocked_dependency.get("blockedStep"),
        "blockedPhase": blocked_dependency.get("blockedPhase"),
        "blockedByStep": blocked_dependency.get("blockedByStep"),
        "blockedByPhase": blocked_dependency.get("blockedByPhase"),
        "blockedByGate": blocked_dependency.get("blockedByGate"),
        "blockedDownstreamSteps": blocked_dependency.get("blockedDownstreamSteps") or [],
        "localSourceStatus": local_source.get("status"),
        "localSourceProofStatus": local_source.get("proofStatus"),
        "localSourceRegisteredRouteCount": len(local_source.get("registeredRoutes") or []),
        "localSourceMissingRouteCount": len(local_source.get("missingRoutes") or []),
        "localSourceRouteContractStatus": local_source.get("routeContractStatus"),
        "localSourceRouteContractProofStatus": local_source.get("routeContractProofStatus"),
        "localSourceRegisteredRouteContractCount": len(local_source.get("registeredRouteContracts") or []),
        "localSourceMissingRouteContractCount": len(local_source.get("missingRouteContracts") or []),
        "targetRuntimeStatus": target_runtime.get("status"),
        "targetRuntimeProofStatus": target_runtime.get("proofStatus"),
        "targetRuntimeVersionStatus": target_runtime.get("versionStatus"),
        "targetRuntimeVersionProofStatus": target_runtime.get("versionProofStatus"),
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
        "targetRuntimeRegisteredRouteCount": len(target_runtime.get("registeredTelemetryRoutes") or []),
        "targetRuntimeMissingRouteCount": len(target_runtime.get("missingTelemetryRoutes") or []),
        "targetRuntimeMissingRoutes": target_runtime.get("missingTelemetryRoutes") or [],
        "runtimeClosureStatus": runtime_closure.get("status"),
        "runtimeClosureProofStatus": runtime_closure.get("proofStatus"),
        "runtimeClosureSampleEmissionAllowed": runtime_closure.get("sampleEmissionAllowed"),
        "runtimeClosureManagedRuntime": runtime_closure.get("managedRuntimeClosure"),
        "runtimeClosureLocalProofStatus": runtime_closure.get("localRuntimeClosureProofStatus"),
        "runtimeClosureComposeProofStatus": runtime_closure.get("composeRuntimeClosureProofStatus"),
        "runtimeClosureDockerDaemonProofStatus": runtime_closure.get("dockerDaemonProofStatus"),
        "runtimeClosureFailedCheckCount": runtime_closure.get("failedCheckCount"),
        "runtimeClosureCheckReasons": runtime_closure.get("checkReasons") or {},
        "runtimeClosureFailedCheckReasons": runtime_closure.get("failedCheckReasons") or {},
        "runtimeClosureLocalRuntimeClosure": runtime_closure.get("localRuntimeClosure") or {},
        "runtimeClosureComposeRuntimeClosure": runtime_closure.get("composeRuntimeClosure") or {},
          "runtimeClosureBlockedDownstreamProofs": runtime_closure_blockers,
          "runtimeClosureBlockedDownstreamProofCount": len(runtime_closure_blockers),
        "mirrorPrefix": report.get("mirrorPrefix"),
    }


def render_markdown(report: dict[str, Any]) -> str:
    summary = report.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    return "\n".join(
        [
            "# Desktop Telemetry Live Gate",
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
            f"- Gateway: `{report.get('gateway')}`",
            f"- Station: `{report.get('station')}`",
            f"- Mirror prefix: `{report.get('mirrorPrefix')}`",
            f"- Create temp account: `{report.get('createTempAccount')}`",
            f"- Failed step: `{report.get('failedStep')}`",
            f"- Environment classification: `{summary.get('environmentClassification')}`",
            f"- Blocked step: `{summary.get('blockedStep')}`",
            f"- Blocked phase: `{summary.get('blockedPhase')}`",
            f"- Blocked by step: `{summary.get('blockedByStep')}`",
            f"- Blocked by phase: `{summary.get('blockedByPhase')}`",
            f"- Blocked by gate: `{summary.get('blockedByGate')}`",
            f"- Blocked downstream steps: `{format_markdown_list(summary.get('blockedDownstreamSteps'))}`",
            "",
            "## Step State",
            "",
            f"- Expected step count: `{summary.get('expectedStepCount')}`",
            f"- Passed steps: `{format_markdown_list(summary.get('passedSteps'))}`",
            f"- Failed steps: `{format_markdown_list(summary.get('failedSteps'))}`",
            f"- Pending steps: `{format_markdown_list(summary.get('pendingSteps'))}`",
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
              f"- Runtime closure blocked downstream proof count: `{summary.get('runtimeClosureBlockedDownstreamProofCount')}`",
              f"- Runtime closure blocked downstream proofs: `{json.dumps(summary.get('runtimeClosureBlockedDownstreamProofs') or [], sort_keys=True, ensure_ascii=False)}`",
            "",
            "## Station Route State",
            "",
            f"- Local source routes: `{route_count_pair(summary.get('localSourceRegisteredRouteCount'), summary.get('localSourceMissingRouteCount'))}`",
            f"- Local source proof: `{summary.get('localSourceProofStatus')}`",
            f"- Local source route contracts: `{route_count_pair(summary.get('localSourceRegisteredRouteContractCount'), summary.get('localSourceMissingRouteContractCount'))}`",
            f"- Local source route contract proof: `{summary.get('localSourceRouteContractProofStatus')}`",
            f"- Target runtime routes: `{route_count_pair(summary.get('targetRuntimeRegisteredRouteCount'), summary.get('targetRuntimeMissingRouteCount'))}`",
            f"- Target runtime proof: `{summary.get('targetRuntimeProofStatus')}`",
            f"- Target runtime route contracts: `{route_count_pair(summary.get('targetRuntimeMatchedRouteContractCount'), summary.get('targetRuntimeMissingRouteContractCount'))}`",
            f"- Target runtime route contract proof: `{summary.get('targetRuntimeRouteContractProofStatus')}`",
            f"- Target runtime missing route contracts: `{format_markdown_list([contract.get('method') + ' ' + contract.get('path') for contract in summary.get('targetRuntimeMissingRouteContracts', []) if isinstance(contract, dict) and contract.get('method') and contract.get('path')])}`",
            f"- Target runtime version proof: `{summary.get('targetRuntimeVersionProofStatus')}`",
            f"- Target runtime build commit: `{(summary.get('targetRuntimeVersionFingerprint') or {}).get('buildCommit')}`",
            f"- Target runtime build label: `{(summary.get('targetRuntimeVersionFingerprint') or {}).get('buildLabel')}`",
            f"- Target runtime build time: `{(summary.get('targetRuntimeVersionFingerprint') or {}).get('buildTime')}`",
            f"- Target runtime identity proof: `{summary.get('targetRuntimeIdentityProofStatus')}`",
            f"- Target runtime identity missing fields: `{format_markdown_list((summary.get('targetRuntimeIdentity') or {}).get('missingFields'))}`",
            f"- Target runtime handler count: `{summary.get('targetRuntimeHandlerCount')}`",
            f"- Target runtime handler table: `{summary.get('targetRuntimeHandlerTableStatus')}`",
            f"- Target runtime missing routes: `{format_markdown_list(summary.get('targetRuntimeMissingRoutes'))}`",
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


def next_failed_step(report: dict[str, Any]) -> str:
    passed = {
        step.get("name")
        for step in report.get("steps", [])
        if isinstance(step, dict) and step.get("status") == "pass"
    }
    for step_name in EXPECTED_STEPS:
        if step_name == "station.create_temp_account" and not report.get("createTempAccount"):
            continue
        if step_name not in passed:
            return step_name
    return "unknown"


def classify_failure(failed_step: str, error: str) -> dict[str, Any]:
    if failed_step == "runtime.closure":
        return {
            "category": "runtime-closure-unproven",
            "failedStep": failed_step,
            "summary": "Runtime closure gate did not allow live telemetry sample emission.",
            "proofImpact": "P0a live telemetry loop remains PARTIAL/UNPROVEN; Gateway upload, Station query, rollup, and Dev mirror proof cannot start.",
        }
    if failed_step == "preflight.gateway_station":
        category = "desktop-gateway-preflight"
        if "Connection refused" in error or "Errno 61" in error or "refused" in error:
            summary = "Desktop HTTP Gateway is not reachable, so no live sample can be emitted."
        elif "active station mismatch" in error:
            summary = "Desktop HTTP Gateway is reachable but points at a different Station."
        else:
            summary = "Desktop Gateway/Station preflight did not pass."
        return {
            "category": category,
            "failedStep": failed_step,
            "summary": summary,
            "proofImpact": "P0a live telemetry loop remains PARTIAL/UNPROVEN and sample emission stays disabled.",
        }
    if failed_step == "gateway.auth_login":
        return {
            "category": "gateway-auth",
            "failedStep": failed_step,
            "summary": "Desktop Gateway did not establish an authenticated telemetry upload session.",
            "proofImpact": "Gateway upload proof cannot start.",
        }
    if failed_step == "station.auth_login":
        return {
            "category": "station-auth",
            "failedStep": failed_step,
            "summary": "Station direct login did not return a query token for raw/rollup evidence.",
            "proofImpact": "Station raw/rollup query proof cannot start.",
        }
    if failed_step == "station.telemetry_routes":
        return {
            "category": "station-telemetry-route-missing" if is_station_telemetry_route_missing(error) else "station-telemetry-route-probe",
            "failedStep": failed_step,
            "summary": "Station telemetry route capability probe did not prove ingest/query/rollup routes are available.",
            "proofImpact": "P0a upload, Station ingest, raw/rollup query, and Dev mirror proof remain PARTIAL/UNPROVEN.",
        }
    if failed_step == "station.create_temp_account":
        return {
            "category": "station-temp-account",
            "failedStep": failed_step,
            "summary": "Station did not create a temporary telemetry gate account.",
            "proofImpact": "Gateway auth and Station raw/rollup query proof cannot start.",
        }
    if failed_step == "gateway.frontend_telemetry_upload":
        if is_station_telemetry_route_missing(error):
            return {
                "category": "station-telemetry-route-missing",
                "failedStep": failed_step,
                "summary": "Desktop Gateway reached Station, but the Station runtime returned 404 for the frontend telemetry ingest route.",
                "proofImpact": "P0a upload, Station ingest, raw/rollup query, and Dev mirror proof remain PARTIAL/UNPROVEN.",
            }
        return {
            "category": "gateway-telemetry-upload",
            "failedStep": failed_step,
            "summary": "Desktop Gateway did not accept the synthetic frontend telemetry event.",
            "proofImpact": "P0a upload proof is missing.",
        }
    if failed_step in {"station.raw_query", "station.rollup_query"}:
        return {
            "category": "station-telemetry-query",
            "failedStep": failed_step,
            "summary": "Station did not return the expected persisted telemetry evidence.",
            "proofImpact": "Station-managed sink proof remains unproven.",
        }
    if failed_step == "dev_mirror":
        return {
            "category": "dev-mirror",
            "failedStep": failed_step,
            "summary": "Dev/CI mirror artifact was not produced from the live Station query.",
            "proofImpact": "Local evidence mirror parity remains unproven.",
        }
    return {
        "category": "unknown",
        "failedStep": failed_step,
        "summary": "The live telemetry gate stopped at an unclassified step.",
        "proofImpact": "P0a remains PARTIAL/UNPROVEN.",
    }


def is_station_telemetry_route_missing(error: str) -> bool:
    lowered = error.lower()
    has_404 = "'status': 404" in lowered or '"status":404' in lowered or "status=404" in lowered
    return "404 page not found" in lowered and (
        ("frontend telemetry upload failed" in lowered and has_404)
        or "station telemetry route missing" in lowered
    )


def enrich_issue_with_source(
    issue: dict[str, Any],
    report: dict[str, Any],
    details: list[dict[str, Any]],
    review_commands: list[dict[str, str]],
) -> dict[str, Any]:
    issue["status"] = str(issue.get("status") or report.get("status") or "fail")
    issue["completionStatus"] = str(issue.get("completionStatus") or "PARTIAL")
    issue["proofStatus"] = str(issue.get("proofStatus") or "UNPROVEN")
    issue["sampleEmissionAllowed"] = False
    issue["sourceArtifact"] = str(report.get("output") or "tooling/acceptance/reports/desktop-telemetry-live-gate.json")
    issue["sourceArtifactKind"] = ARTIFACT_KIND
    issue["sourcePhase"] = PHASE
    issue["sourceBom"] = BOM
    issue["sourceSpec"] = SPEC
    issue["sourceGate"] = GATE
    issue["details"] = details
    issue["evidenceDetails"] = details
    local_source = report.get("localSourceRouteEvidence")
    target_runtime = report.get("targetRuntimeRouteEvidence")
    if not isinstance(target_runtime, dict):
        target_runtime = {}
    if (
        isinstance(local_source, dict)
        and issue.get("category") == "station-telemetry-route-missing"
    ):
        issue["localSourceRouteEvidence"] = local_source
        issue["targetRuntimeRouteEvidence"] = target_runtime
        runtime_routes_missing = bool(target_runtime.get("missingTelemetryRoutes")) and (
            target_runtime.get("handlerTableProofStatus") == "PROVEN"
        )
        issue["environmentClassification"] = (
            "target-station-handler-missing-while-local-source-registers-routes"
            if local_source.get("proofStatus") == "PROVEN" and runtime_routes_missing
            else
            "target-station-route-missing-while-local-source-registers-routes"
            if local_source.get("proofStatus") == "PROVEN"
            else "target-station-route-unproven"
        )
    if issue.get("category") == "runtime-closure-unproven":
        runtime_closure = report.get("runtimeClosureEvidence")
        if isinstance(runtime_closure, dict):
            issue["runtimeClosureEvidence"] = runtime_closure
        runtime_closure_blockers = runtime_closure_blocked_downstream_proofs(report)
        if runtime_closure_blockers:
            issue["runtimeClosureBlockedDownstreamProofs"] = runtime_closure_blockers
    blocked_by = blocked_dependencies_for_issue(issue)
    if blocked_by:
        issue["blockedBy"] = blocked_by
    issue["recommended_review_commands"] = review_commands
    issue["recommendedReviewCommands"] = review_commands
    return issue


def recommended_review_commands(report: dict[str, Any], failed_step: str) -> list[dict[str, str]]:
    gateway = str(report.get("gateway") or DEFAULT_GATEWAY)
    station = str(report.get("station") or DEFAULT_STATION)
    live_gate_command = f"python3 tooling/scripts/desktop-telemetry-live-gate.py --gateway {gateway} --station {station}"
    if report.get("createTempAccount"):
        live_gate_command += " --create-temp-account"
    mirror_prefix = report.get("mirrorPrefix")
    if mirror_prefix:
        live_gate_command += f" --mirror-prefix {mirror_prefix}"
    commands = [
        {
            "purpose": "Re-run runtime closure gate before attempting live Desktop telemetry emission.",
            "command": "python3 tooling/scripts/desktop-telemetry-runtime-closure-gate.py",
        },
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Start Station through the project entrypoint if local Station is required.",
            "command": "make station",
        },
        {
            "purpose": "Re-run only the P0a live telemetry gate after runtime prerequisites are available.",
            "command": live_gate_command,
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]
    if failed_step == "preflight.gateway_station":
        commands.insert(
            2,
            {
                "purpose": "Inspect the latest machine-readable preflight failure.",
                "command": "jq '{status,failedStep,reason,issue_breakdown,recommended_review_commands,issueBreakdown,recommendedReviewCommands}' tooling/acceptance/reports/desktop-telemetry-live-gate.json",
            },
        )
    if failed_step in {"station.telemetry_routes", "gateway.frontend_telemetry_upload"}:
        commands.insert(
            3,
            {
                "purpose": "Verify that the local Station build registers the frontend telemetry routes expected by P0a.",
                "command": "rg -n 'frontend_telemetry|/telemetry/frontend/events/batch|/telemetry/frontend/events/query|/telemetry/frontend/rollups/query' apps/station/app/main.go apps/station/app/subserver/frontend_telemetry",
            },
        )
        commands.insert(
            4,
            {
                "purpose": "Inspect selected Station runtime handler registration for frontend telemetry routes.",
                "command": f"curl -fsS {station.rstrip('/')}{DEBUG_HANDLERS_PATH} | jq '.handlers[] | select(.Path | contains(\"/telemetry/frontend\"))'",
            },
        )
        commands.insert(
            5,
            {
                "purpose": "Inspect selected Station runtime version metadata.",
                "command": f"curl -fsS {station.rstrip('/')}{APP_META_VERSION_PATH}",
            },
        )
    return commands


def record_failure(report: dict[str, Any], exc: GateError) -> dict[str, Any]:
    failed_step = next_failed_step(report)
    error = str(exc)
    report["status"] = "baseline preflight failure" if failed_step == "preflight.gateway_station" else "fail"
    report["failedStep"] = failed_step
    report["error"] = error
    report["reason"] = f"{failed_step} failed: {error}"
    if failed_step in {"station.telemetry_routes", "gateway.frontend_telemetry_upload"} and is_station_telemetry_route_missing(error):
        repo_root = Path(str(report.get("repoRoot") or Path.cwd())).resolve()
        report["localSourceRouteEvidence"] = local_source_route_evidence(repo_root)
        report["targetRuntimeRouteEvidence"] = target_station_runtime_evidence(str(report.get("station") or DEFAULT_STATION))
    review_commands = recommended_review_commands(report, failed_step)
    details = [
        {
            "step": failed_step,
            "status": "fail",
            "error": error,
        }
    ]
    runtime_closure = report.get("runtimeClosureEvidence")
    if isinstance(runtime_closure, dict) and failed_step == "runtime.closure":
        details[0]["runtimeClosureEvidence"] = runtime_closure
        runtime_closure_blockers = runtime_closure_blocked_downstream_proofs(report)
        report["runtimeClosureBlockedDownstreamProofs"] = runtime_closure_blockers
        details[0]["runtimeClosureBlockedDownstreamProofs"] = runtime_closure_blockers
    issue_breakdown = [
        enrich_issue_with_source(classify_failure(failed_step, error), report, details, review_commands)
    ]
    report["issue_breakdown"] = issue_breakdown
    report["recommended_review_commands"] = review_commands
    report["issueBreakdown"] = issue_breakdown
    report["recommendedReviewCommands"] = review_commands
    report["details"] = details
    report.setdefault("steps", []).append({"name": failed_step, "status": "fail", "detail": {"error": error}})
    return report


def run_mirror(station: str, token: str, interaction_id: str, output_prefix: str) -> None:
    subprocess.run(
        [
            sys.executable,
            "tooling/scripts/desktop-telemetry-mirror.py",
            "--station-url",
            station,
            "--token",
            token,
            "--interaction-id",
            interaction_id,
            "--output-prefix",
            output_prefix,
        ],
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default=os.environ.get("PT_DESKTOP_GATEWAY_URL", DEFAULT_GATEWAY))
    parser.add_argument("--station", default=os.environ.get("PT_STATION_URL", DEFAULT_STATION))
    parser.add_argument("--account", default=os.environ.get("PT_TEST_ACCOUNT", DEFAULT_ACCOUNT))
    parser.add_argument("--password", default=os.environ.get("PT_TEST_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument(
        "--create-temp-account",
        action="store_true",
        default=os.environ.get("PT_TELEMETRY_GATE_CREATE_ACCOUNT") == "1",
        help="Create a temporary Station account before logging in through Desktop Gateway.",
    )
    parser.add_argument("--output", default="tooling/acceptance/reports/desktop-telemetry-live-gate.json")
    parser.add_argument("--mirror-prefix", default="tooling/acceptance/reports/desktop-performance-latest")
    parser.add_argument(
        "--runtime-closure-report",
        default="tooling/acceptance/reports/desktop-telemetry-runtime-closure-gate.json",
    )
    args = parser.parse_args()

    report: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "artifactKind": ARTIFACT_KIND,
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
        "gateway": args.gateway,
        "station": args.station,
        "status": "unknown",
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "output": args.output,
        "mirrorPrefix": args.mirror_prefix,
        "runtimeClosureReport": args.runtime_closure_report,
        "createTempAccount": bool(args.create_temp_account),
        "steps": [],
    }

    def step(name: str, status: str, detail: Any = None) -> None:
        report["steps"].append({"name": name, "status": status, "detail": detail})

    try:
        runtime_closure = runtime_closure_evidence(Path(args.runtime_closure_report))
        report["runtimeClosureEvidence"] = runtime_closure
        if runtime_closure["proofStatus"] != "PROVEN" or runtime_closure["sampleEmissionAllowed"] is not True:
            raise GateError(
                "runtime closure does not allow live sample emission: "
                f"proofStatus={runtime_closure['proofStatus']} "
                f"sampleEmissionAllowed={runtime_closure['sampleEmissionAllowed']} "
                f"local={runtime_closure.get('localRuntimeClosureProofStatus')} "
                f"compose={runtime_closure.get('composeRuntimeClosureProofStatus')} "
                f"docker={runtime_closure.get('dockerDaemonProofStatus')}"
            )
        step("runtime.closure", "pass", runtime_closure)

        assert_gateway_station(args.gateway, args.station)
        step("preflight.gateway_station", "pass")

        account = args.account
        password = args.password
        if args.create_temp_account:
            account, password = create_temp_account(args.station)
            step("station.create_temp_account", "pass", {"account": account})

        auth = data_or_self(gateway_command(args.gateway, "auth_login", {"account": account, "password": password}))
        if auth.get("status") != "authenticated":
            raise GateError(f"gateway auth did not report authenticated status: {auth}")
        step("gateway.auth_login", "pass", {"actorId": auth.get("actor_id") or auth.get("actorId")})

        interaction_id = f"p0a-live-{int(time.time() * 1000)}"
        event = build_event(interaction_id)
        upload = gateway_command(args.gateway, "frontend_telemetry_upload", {"events": [event]})
        upload_status = gateway_stub_status(upload)
        if not upload_status.get("uploaded"):
            raise GateError(f"telemetry upload did not report uploaded=true: {upload}")
        step("gateway.frontend_telemetry_upload", "pass", upload_status)

        # Direct Station auth is intentionally delayed until Gateway upload is
        # complete. The shared test account has exclusive sessions, so logging
        # in to Station before upload can revoke the Gateway session under test.
        token = station_login_token(args.station, account, password)
        step("station.auth_login", "pass", {"tokenSource": "/actor/login"})

        route_probe = assert_station_telemetry_routes(args.station, token)
        step("station.telemetry_routes", "pass", route_probe)

        raw = data_or_self(station_post(args.station, FRONTEND_TELEMETRY_QUERY_PATH, token, {"interactionId": interaction_id, "limit": 10}))
        events = raw.get("events")
        if not isinstance(events, list) or not any(event.get("interactionId") == interaction_id for event in events if isinstance(event, dict)):
            raise GateError(f"Station raw query did not return interactionId={interaction_id}: {raw}")
        step("station.raw_query", "pass", {"count": len(events), "interactionId": interaction_id})

        rollups = data_or_self(station_post(args.station, FRONTEND_TELEMETRY_ROLLUP_PATH, token, {"module": "desktop-telemetry-live-gate", "limit": 10}))
        if not isinstance(rollups.get("rollups"), list) or not rollups["rollups"]:
            raise GateError(f"Station rollup query did not return telemetry rollups: {rollups}")
        step("station.rollup_query", "pass", {"count": len(rollups["rollups"])})

        run_mirror(args.station, token, interaction_id, args.mirror_prefix)
        step("dev_mirror", "pass", {"prefix": args.mirror_prefix})

        report["status"] = "pass"
        report["interactionId"] = interaction_id
        return 0
    except GateError as exc:
        record_failure(report, exc)
        return 1
    finally:
        apply_status_metadata(report)
        output_path = Path(args.output)
        write_report(output_path, report)
        md_path = output_path.with_suffix(".md")
        md_path.write_text(render_markdown(report), encoding="utf-8")
        print(f"desktop telemetry live gate: {args.output}")
        print(f"desktop telemetry live gate: {md_path}")
        print(f"status: {report['status']}")


if __name__ == "__main__":
    raise SystemExit(main())
