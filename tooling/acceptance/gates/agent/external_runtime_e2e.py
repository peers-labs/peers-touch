#!/usr/bin/env python3
"""Run the exact-source MCA-P12 external runtime lifecycle."""

from __future__ import annotations

import hashlib
import json
import os
import shlex
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ArtifactSession, load_runtime_manifest
from tooling.acceptance.core.evidence_store import current_artifact_ref, source_identity
from tooling.acceptance.gates.agent.external_runtime_fixture import (
    external_runtime_environment,
    external_runtime_root,
)
from tooling.acceptance.gates.agent.external_runtime_oracle import (
    evaluate_external_runtime_capture,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _build_client_manifest,
)
from tooling.acceptance.gates.agent.home_command_center_candidate import (
    _authenticate,
    resolve_machine_profile,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_EXTERNAL_RUNTIME_GATE,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    reviewed_remote_transport,
)


PROFILE = "two"
JOURNEY_ID = "MCA-J10"


class ExternalRuntimeE2EError(RuntimeError):
    """The P12 external runtime Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExternalRuntimeE2EError(message)


def _mapping(value: Any, label: str) -> dict[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return dict(value)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _fixture(capture: Mapping[str, Any]) -> dict[str, Any]:
    return _mapping(capture.get("fixture"), "P12 fixture")


def _runtime_manifest() -> dict[str, Any]:
    value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    require(bool(value), "PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    return load_runtime_manifest(
        Path(value).expanduser().resolve(),
        AGENT_V2_EXTERNAL_RUNTIME_GATE,
    )


def _station_container_id(deployment_environment: str) -> str:
    transport, environment = reviewed_remote_transport(deployment_environment)
    compose_project = environment.get(
        "PT_ACCEPTANCE_COMPOSE_PROJECT",
        "",
    ).strip()
    require(bool(compose_project), "Station Compose project is missing")
    completed = transport.run_argv(
        [
            "bash",
            "-lc",
            (
                "set -eu; docker ps --quiet "
                f"--filter {shlex.quote(f'label=com.docker.compose.project={compose_project}')} "
                f"--filter {shlex.quote('label=com.docker.compose.service=station')} "
                "| sed -n '1p'"
            ),
        ],
        timeout=30,
        check=False,
    )
    require(
        completed.returncode == 0 and bool(completed.stdout.strip()),
        "P12 could not resolve the Station container",
    )
    return completed.stdout.strip()


def _station_version(station_url: str) -> dict[str, Any]:
    with urllib.request.urlopen(
        f"{station_url.rstrip('/')}/app-meta/version",
        timeout=10,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    require(isinstance(value, Mapping), "Station version response is invalid")
    data = value.get("data")
    return dict(data if isinstance(data, Mapping) else value)


def _restart_external_runtime_station(
    runtime_manifest: Mapping[str, Any],
    profile_env: Mapping[str, str],
) -> dict[str, Any]:
    services = _mapping(runtime_manifest.get("services"), "runtime services")
    station = _mapping(services.get("station"), "Station runtime")
    station_url = str(station.get("endpoint") or "").rstrip("/")
    deployment_environment = str(
        station.get("deploymentEnvironment") or ""
    ).strip()
    run_id = str(runtime_manifest.get("runId") or "")
    require(
        bool(station_url and deployment_environment and run_id),
        "P12 Station restart identity is incomplete",
    )
    before_container = _station_container_id(deployment_environment)
    before_version = _station_version(station_url)
    environment = os.environ.copy()
    environment.update(profile_env)
    environment.update(external_runtime_environment(run_id))
    environment["PT_ACCEPTANCE_ENVIRONMENT"] = "home-station"
    environment["PT_AGENT_CAPABILITY_SCENARIO_CONTROL"] = "1"
    environment["PT_ACCEPTANCE_RUN_ID"] = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        + "-"
        + hashlib.sha256(f"{run_id}:restart".encode("utf-8")).hexdigest()[:32]
    )
    started = time.monotonic()
    completed = subprocess.run(
        ["make", "station"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=1_800,
        check=False,
    )
    require(
        completed.returncode == 0,
        "P12 Station redeployment failed: "
        + (
            completed.stderr.strip()
            or completed.stdout.strip()
            or "no output"
        )[-4_000:],
    )
    after_container = _station_container_id(deployment_environment)
    after_version = _station_version(station_url)
    before_commit = str(before_version.get("build_commit") or "")
    after_commit = str(after_version.get("build_commit") or "")
    require(
        bool(before_commit)
        and before_commit == after_commit
        and before_container != after_container,
        "P12 Station redeployment did not replace the exact-source instance",
    )
    return {
        "stationRestarted": True,
        "beforeContainerIdHash": _hash(before_container),
        "afterContainerIdHash": _hash(after_container),
        "liveCommit": after_commit,
        "durationMs": int((time.monotonic() - started) * 1000),
    }


def _audit_external_runtime(
    runtime_manifest: Mapping[str, Any],
    home_refs: list[str],
) -> dict[str, Any]:
    services = _mapping(runtime_manifest.get("services"), "runtime services")
    station = _mapping(services.get("station"), "Station runtime")
    deployment_environment = str(
        station.get("deploymentEnvironment") or ""
    ).strip()
    require(bool(deployment_environment), "Station deployment identity is missing")
    transport, environment = reviewed_remote_transport(deployment_environment)
    compose_project = environment.get(
        "PT_ACCEPTANCE_COMPOSE_PROJECT",
        "",
    ).strip()
    require(bool(compose_project), "Station Compose project is missing")
    project_filter = shlex.quote(
        f"label=com.docker.compose.project={compose_project}"
    )
    service_filter = shlex.quote(
        "label=com.docker.compose.service=station"
    )
    container = transport.run_argv(
        [
            "bash",
            "-lc",
            (
                "set -eu; docker ps --quiet "
                f"--filter {project_filter} --filter {service_filter} "
                "| sed -n '1p'"
            ),
        ],
        timeout=30,
        check=False,
    )
    container_id = container.stdout.strip()
    require(
        container.returncode == 0 and bool(container_id),
        "P12 audit could not resolve the Station container",
    )
    runtime_root = external_runtime_root(str(runtime_manifest.get("runId") or ""))
    entries: list[dict[str, Any]] = []
    for home_ref in home_refs:
        command = (
            "set -eu; file=\"$1/audit/$2.reset\"; "
            "test -f \"$file\"; "
            "success=\"$(grep -c '^success$' \"$file\" || true)\"; "
            "failed=\"$(grep -c '^failed$' \"$file\" || true)\"; "
            "printf '%s %s\\n' \"$success\" \"$failed\""
        )
        completed = transport.run_argv(
            [
                "docker",
                "exec",
                container_id,
                "/bin/sh",
                "-c",
                command,
                "p12-audit",
                runtime_root,
                home_ref,
            ],
            timeout=30,
            check=False,
        )
        require(
            completed.returncode == 0,
            "P12 adapter audit file is missing",
        )
        parts = completed.stdout.strip().split()
        require(len(parts) == 2, "P12 adapter audit output is invalid")
        entries.append(
            {
                "runtimeHomeRefHash": _hash(home_ref),
                "successCount": int(parts[0]),
                "failureCount": int(parts[1]),
            }
        )
    inventory = transport.run_argv(
        [
            "docker",
            "exec",
            container_id,
            "/bin/sh",
            "-c",
            (
                "set -eu; root=\"$1\"; "
                "homes=\"$(find \"$root\" -mindepth 1 -maxdepth 1 "
                "-type d -name 'runtime-home-*' | wc -l | tr -d ' ')\"; "
                "files=\"$(find \"$root/audit\" -type f -name '*.reset' "
                "2>/dev/null | wc -l | tr -d ' ')\"; "
                "printf '%s %s\\n' \"$homes\" \"$files\""
            ),
            "p12-inventory",
            runtime_root,
        ],
        timeout=30,
        check=False,
    )
    require(inventory.returncode == 0, "P12 runtime inventory failed")
    parts = inventory.stdout.strip().split()
    require(len(parts) == 2, "P12 runtime inventory output is invalid")
    return {
        "entries": entries,
        "runtimeHomeCount": int(parts[0]),
        "unexpectedEntryCount": max(0, int(parts[1]) - len(home_refs)),
    }


def _set_locale(client: FoundationRuntimeClient, locale: str) -> None:
    result = client.harness(
        "setFoundationLocale",
        {"locale": locale},
        timeout=30,
    )
    require(
        isinstance(result, Mapping) and result.get("locale") == locale,
        f"{client.spec.runtime} locale did not converge to {locale}",
    )


def _cleanup_product(
    clients: tuple[FoundationRuntimeClient, ...],
    fixture: Mapping[str, Any],
) -> dict[str, Any]:
    failures: list[str] = []
    for client in clients:
        try:
            result = client.harness(
                "cleanupExternalRuntimeLifecycle",
                {"fixture": dict(fixture)},
                timeout=180,
            )
            if isinstance(result, Mapping) and result.get("status") == "clean":
                return dict(result)
            failures.append(f"{client.spec.runtime}:{result}")
        except Exception as error:
            failures.append(f"{client.spec.runtime}:{error}")
    return {"status": "failed", "failures": failures}


def main() -> int:
    started_at = time.monotonic()
    status = "failed"
    failure = ""
    capture: dict[str, Any] = {}
    pair: FoundationRuntimePair | None = None
    product_cleanup: dict[str, Any] = {
        "status": "not-started",
        "failures": [],
    }
    runtime_cleanup: dict[str, Any] = {
        "status": "not-started",
        "failures": [],
    }
    fixture: dict[str, Any] | None = None

    with ArtifactSession(
        repo_root=ROOT,
        gate_id=AGENT_V2_EXTERNAL_RUNTIME_GATE,
    ) as artifacts:
        try:
            profile_name, _profile_file, _slot, profile_env = (
                resolve_machine_profile()
            )
            require(profile_name == PROFILE, "P12 Gate requires Profile two")
            os.environ.update(profile_env)
            runtime_manifest = _runtime_manifest()
            pair = FoundationRuntimePair.from_manifest(
                _build_client_manifest(runtime_manifest),
                profile_env=profile_env,
                startup_timeout=900,
            )
            pair.start()
            actor_ids = {
                client.spec.runtime: _authenticate(client, profile_env)
                for client in (pair.native, pair.browser)
            }
            require(
                len(set(actor_ids.values())) == 1,
                "P12 Native and Browser clients authenticated different actors",
            )
            _set_locale(pair.native, "en")
            preparation = _mapping(
                pair.native.harness(
                    "prepareExternalRuntimeLifecycle",
                    {"sampleId": artifacts.run_id},
                    timeout=600,
                ),
                "P12 preparation",
            )
            require(
                preparation.get("ok") is True,
                "P12 preparation failed at "
                f"{preparation.get('stage') or 'unknown'}: "
                f"{preparation.get('errorCode') or 'unknown'}; "
                f"cleanup={preparation.get('cleanup')}",
            )
            fixture = _fixture(preparation)
            restart = _restart_external_runtime_station(
                runtime_manifest,
                profile_env,
            )
            pair.native.restart()
            pair.browser.restart()
            for client in (pair.native, pair.browser):
                _authenticate(client, profile_env)
            _set_locale(pair.native, "en")
            restart_turn = _mapping(
                pair.native.harness(
                    "resumeExternalRuntimeAfterRestart",
                    {"fixture": fixture},
                    timeout=180,
                ),
                "P12 restart Turn",
            )
            _set_locale(pair.browser, "zh-CN")
            browser_failure = _mapping(
                pair.browser.harness(
                    "triggerExternalRuntimeResumeUnavailable",
                    {"fixture": fixture},
                    timeout=180,
                ),
                "P12 Browser failure",
            )
            _set_locale(pair.native, "en")
            native_receiver = _mapping(
                pair.native.harness(
                    "observeExternalRuntimeResumeUnavailable",
                    {"fixture": fixture},
                    timeout=120,
                ),
                "P12 Native receiver",
            )
            _set_locale(pair.browser, "zh-CN")
            reset = _mapping(
                pair.browser.harness(
                    "confirmExternalRuntimeReset",
                    {
                        "fixture": fixture,
                        "resetIdempotencyKey": browser_failure[
                            "resetIdempotencyKey"
                        ],
                    },
                    timeout=180,
                ),
                "P12 reset",
            )
            cleanup_retry = _mapping(
                pair.native.harness(
                    "exerciseExternalRuntimeCleanupRetry",
                    {"fixture": fixture},
                    timeout=240,
                ),
                "P12 cleanup retry",
            )
            fresh = _mapping(
                pair.browser.harness(
                    "createFreshExternalRuntimeSession",
                    {"fixture": fixture},
                    timeout=180,
                ),
                "P12 fresh session",
            )
            cancellation = _mapping(
                pair.native.harness(
                    "cancelExternalRuntimeTurn",
                    {"fixture": fixture},
                    timeout=180,
                ),
                "P12 cancellation",
            )
            product_cleanup = _cleanup_product(
                (pair.browser, pair.native),
                fixture,
            )
            capture = {
                "preparation": preparation,
                "restart": {
                    **dict(restart),
                    "stationRestarted": True,
                    "turn": restart_turn,
                },
                "browserFailure": browser_failure,
                "nativeReceiver": native_receiver,
                "reset": reset,
                "cleanupRetry": cleanup_retry,
                "fresh": fresh,
                "cancellation": cancellation,
                "productCleanup": product_cleanup,
            }
            fresh_binding = _mapping(fresh.get("binding"), "fresh binding")
            capture["adapterAudit"] = _audit_external_runtime(
                runtime_manifest,
                [
                    str(fixture["primaryHomeRef"]),
                    str(fixture["secondaryHomeRef"]),
                    str(fresh_binding["runtime_home_ref"]),
                ],
            )
            capture["assertions"] = evaluate_external_runtime_capture(capture)
            status = "passed"
        except Exception as error:  # noqa: BLE001 - persist first Gate failure.
            failure = str(error)
        finally:
            if fixture is not None and product_cleanup.get("status") != "clean":
                product_cleanup = _cleanup_product(
                    tuple(
                        client
                        for client in (
                            pair.browser if pair else None,
                            pair.native if pair else None,
                        )
                        if client is not None
                    ),
                    fixture,
                )
                capture["productCleanup"] = product_cleanup
            if pair is not None:
                try:
                    runtime_cleanup = pair.stop()
                except Exception as error:  # noqa: BLE001
                    runtime_cleanup = {
                        "status": "failed",
                        "failures": [str(error)],
                    }
            if (
                product_cleanup.get("status") != "clean"
                or runtime_cleanup.get("status") != "clean"
            ):
                status = "failed"
                failure = failure or "P12 cleanup did not complete"

        runtime_manifest_ref = (
            current_artifact_ref(
                "runtime/environment-manifest.json",
                repo_root=ROOT,
            ).to_dict()
            if os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST")
            else {}
        )
        report = {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": AGENT_V2_EXTERNAL_RUNTIME_GATE,
            "journey": JOURNEY_ID,
            "status": status,
            "completionStatus": "DONE" if status == "passed" else "FAILED",
            "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
            "phase": "MCA-P12 Stateful External Runtime",
            "bom": ["MCA-P12", "MCA-D29", "BASE-RESUME_UNAVAILABLE"],
            "spec": [
                "tooling/acceptance/features/agent-v2-external-runtime.yaml",
                "docs/architecture/agent/modern-chat-agent/proposals/"
                "20261001-mca-d29-stateful-external-runtime.md",
            ],
            "gate": (
                "P12 requires Station-owned create, resume, restart, explicit "
                "reset, retry, fresh epoch, isolation, and cleanup across "
                "Native and Browser."
            ),
            "sampleEmissionAllowed": status == "passed",
            "source": source_identity(ROOT),
            "runtimeManifest": runtime_manifest_ref,
            "capture": capture,
            "runtimeCleanup": runtime_cleanup,
            "durationMs": int((time.monotonic() - started_at) * 1000),
            "machine": socket.gethostname(),
            "error": failure,
        }
        role_payloads = {
            "receiver-dom": {
                "native": capture.get("nativeReceiver", {}),
                "browser": _mapping(
                    capture.get("browserFailure"),
                    "browser failure",
                ).get("receiver", {})
                if capture.get("browserFailure")
                else {},
            },
            "station-readback": {
                key: capture.get(key, {})
                for key in (
                    "preparation",
                    "restart",
                    "browserFailure",
                    "reset",
                    "cleanupRetry",
                    "fresh",
                    "cancellation",
                )
            },
            "runtime-events": {
                "preparation": capture.get("preparation", {}),
                "restart": capture.get("restart", {}),
                "failure": capture.get("browserFailure", {}),
                "cancellation": capture.get("cancellation", {}),
            },
            "side-effect-count": capture.get("adapterAudit", {}),
            "replay": _mapping(capture.get("reset"), "reset").get(
                "replay",
                {},
            )
            if capture.get("reset")
            else {},
            "cleanup": {
                "product": product_cleanup,
                "runtime": runtime_cleanup,
                "adapter": capture.get("adapterAudit", {}),
            },
        }
        for role, payload in role_payloads.items():
            artifacts.write_json(
                f"evidence/{role}.json",
                {
                    "artifactKind": f"agent-external-runtime-{role}",
                    "status": status,
                    "proofStatus": report["proofStatus"],
                    "evidence": payload,
                },
                role=role,
            )
        artifacts.write_json(
            "reports/agent-v2-external-runtime.json",
            report,
            role="report",
        )
        artifacts.complete(
            status=status,
            completion_status="DONE" if status == "passed" else "FAILED",
            proof_status="PROVEN" if status == "passed" else "UNPROVEN",
            runtime={
                "environment": "home-station",
                "profile": PROFILE,
                "journey": JOURNEY_ID,
            },
        )

    if status == "passed":
        print(f"PASS: {AGENT_V2_EXTERNAL_RUNTIME_GATE}")
        return 0
    print(
        f"FAIL: {AGENT_V2_EXTERNAL_RUNTIME_GATE}: {failure}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
