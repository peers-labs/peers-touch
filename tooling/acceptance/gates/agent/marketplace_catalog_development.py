#!/usr/bin/env python3
"""Run the X3 trusted package catalog Development Journey."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import (
    ArtifactSession,
    current_artifact_ref,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.evidence_store import source_identity
from tooling.acceptance.gates.agent.capability_binding_development import (
    resolve_machine_profile,
)
from tooling.acceptance.gates.agent.evaluation_development import (
    _cleanup_client,
    authenticate_client,
    persist_actor_identity,
    seed_actor_identity,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.fixtures.agent_marketplace_catalog_fault_proxy import (
    AgentMarketplaceCatalogFaultProxy,
)
from tooling.acceptance.provisioners.home_station import AGENT_MARKETPLACE_GATE


JOURNEY_ID = "X3-P4-3"
PROFILE = "two"
ACCOUNT = "alice@p.t"


class MarketplaceCatalogError(RuntimeError):
    """The X3 trusted package catalog Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise MarketplaceCatalogError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MarketplaceCatalogError(f"{label} must be an object")
    return value


def evaluate_marketplace_capture(capture: Mapping[str, Any]) -> dict[str, bool]:
    assertions = require_mapping(capture.get("assertions"), "assertions")
    receiver = require_mapping(capture.get("receiver-dom"), "receiver DOM")
    catalog = require_mapping(capture.get("catalog"), "catalog evidence")
    source = require_mapping(catalog.get("source"), "catalog source")
    sync = require_mapping(catalog.get("sync"), "catalog sync")
    negative_transport = require_mapping(
        catalog.get("negativeTransport"),
        "catalog negative transport",
    )
    tampered_sync = require_mapping(
        negative_transport.get("tampered"),
        "tampered catalog sync",
    )
    old_station_sync = require_mapping(
        negative_transport.get("oldStation"),
        "old Station catalog sync",
    )
    catalog_proxy = require_mapping(capture.get("catalog-proxy"), "catalog proxy")
    first_page = require_mapping(catalog.get("firstPage"), "first page")
    second_page = require_mapping(catalog.get("secondPage"), "second page")
    readback = require_mapping(capture.get("target-readback"), "target readback")
    revocation = require_mapping(capture.get("revocation"), "revocation")
    cleanup = require_mapping(capture.get("cleanup"), "cleanup")
    package_policies = catalog.get("packagePolicies")
    require(isinstance(package_policies, list), "package policies must be an array")
    package_types = {
        str(require_mapping(item, "package policy").get("packageType") or "")
        for item in package_policies
    }
    checks = {
        "allHarnessAssertionsPass": bool(assertions)
        and all(value is True for value in assertions.values()),
        "nativeMarketplaceVisible": (
            receiver.get("marketplaceVisible") is True
            and receiver.get("sourceVisible") is True
            and receiver.get("highRiskConfirmationVisible") is True
        ),
        "defaultSourceVerified": (
            source.get("id") == "peers-official"
            and source.get("builtIn") is True
            and source.get("signatureStatus") == "verified"
            and source.get("trustLevel") == "official"
            and source.get("transportKind") == "official_station"
            and not source.get("url")
            and not source.get("branch")
            and not source.get("manifestPath")
            and bool(source.get("publicKeyFingerprint"))
        ),
        "freshSignedSynchronization": (
            sync.get("signatureStatus") == "verified"
            and sync.get("syncState") == "fresh_verified"
            and sync.get("stale") is False
            and not sync.get("error")
        ),
        "officialStationTransportVerified": (
            sync.get("transportKind") == "official_station"
            and sync.get("transportEndpoint")
            == "/sub-agent/agent/package-catalog/official"
            and sync.get("distributionId") == "peers-official-station-v1"
            and len(str(sync.get("envelopeSha256") or "")) == 64
        ),
        "tamperedTransportRejected": (
            tampered_sync.get("stale") is True
            and tampered_sync.get("syncState") == "stale_verified"
            and tampered_sync.get("error")
            == "OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID"
            and tampered_sync.get("catalogRevision") == sync.get("catalogRevision")
        ),
        "oldStationRetainsVerifiedSnapshot": (
            old_station_sync.get("stale") is True
            and old_station_sync.get("syncState") == "stale_verified"
            and old_station_sync.get("error")
            == "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE"
            and old_station_sync.get("catalogRevision") == sync.get("catalogRevision")
        ),
        "catalogFaultProxyObserved": (
            catalog_proxy.get("targetPath")
            == "/sub-agent/agent/package-catalog/official"
            and catalog_proxy.get("requestCount") == 4
            and catalog_proxy.get("actions")
            == ["pass", "tamper", "missing", "pass"]
        ),
        "cursorPaginationVerified": (
            bool(first_page.get("nextCursor"))
            and first_page.get("catalogRevision")
            == second_page.get("catalogRevision")
            and first_page.get("skills") != second_page.get("skills")
        ),
        "realPackageTypesVerified": {"agent", "skill", "mcp"}.issubset(
            package_types
        ),
        "targetAuthoritiesReadBack": all(
            isinstance(readback.get(kind), Mapping)
            and bool(require_mapping(readback[kind], kind))
            for kind in ("agent", "skill", "mcp")
        ),
        "revocationRejected": (
            revocation.get("rejected") is True
            and bool(revocation.get("packageId"))
        ),
        "cleanupComplete": (
            cleanup.get("status") == "clean"
            and cleanup.get("agentRemoved") is True
            and cleanup.get("skillRemoved") is True
            and cleanup.get("mcpRemoved") is True
        ),
    }
    failed = sorted(name for name, passed in checks.items() if not passed)
    if failed:
        raise MarketplaceCatalogError(
            "X3 marketplace facts failed assertions: " + ", ".join(failed)
        )
    return checks


def _client_from_manifest(
    manifest: Mapping[str, Any],
    profile_env: Mapping[str, str],
    *,
    station_url: str,
) -> FoundationRuntimeClient:
    services = manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    clients = manifest.get("clients")
    require(
        isinstance(station, Mapping) and bool(station.get("endpoint")),
        "X3 runtime manifest has no Station endpoint",
    )
    require(
        isinstance(clients, list) and len(clients) == 1,
        "X3 runtime manifest must contain one Native client",
    )
    client = require_mapping(clients[0], "X3 Native client")
    require(
        client.get("actor") == "alice"
        and client.get("runtime") == "native-tauri",
        "X3 client must be isolated Alice native-tauri",
    )
    return FoundationRuntimeClient(
        FoundationClientSpec.from_mapping(client),
        station_url=station_url,
        profile_env=profile_env,
        startup_timeout=900,
    )


def _load_provisioned_runtime_manifest() -> dict[str, Any]:
    manifest_value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    require(bool(manifest_value), "PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    return load_runtime_manifest(
        Path(manifest_value).expanduser().resolve(),
        AGENT_MARKETPLACE_GATE,
    )


def main() -> int:
    started_at = time.monotonic()
    profile_name, _profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "active profile is not Profile two")
    os.environ.update(profile_env)
    os.environ["PT_DEV_PROFILE"] = PROFILE

    client: FoundationRuntimeClient | None = None
    catalog_proxy: AgentMarketplaceCatalogFaultProxy | None = None
    runtime_manifest: dict[str, Any] | None = None
    capture: dict[str, Any] = {}
    failure = ""
    status = "failed"
    runtime_cleanup: dict[str, Any] = {
        "status": "clean",
        "client": None,
        "failures": [],
    }

    with ArtifactSession(repo_root=ROOT, gate_id=AGENT_MARKETPLACE_GATE) as artifacts:
        try:
            runtime_manifest = _load_provisioned_runtime_manifest()
            manifest_profile = require_mapping(
                runtime_manifest.get("profile"),
                "X3 runtime profile",
            )
            require(
                runtime_manifest.get("environmentId") == "home-station",
                "X3 runtime manifest must use home-station",
            )
            require(
                manifest_profile.get("resolvedName") == profile_name
                and manifest_profile.get("slot") == slot,
                "X3 runtime manifest does not match the active profile binding",
            )
            station = require_runtime_service(
                runtime_manifest,
                "station",
                "station",
            )
            station_url = str(station.get("endpoint") or "").rstrip("/")
            require(bool(station_url), "X3 runtime manifest has no Station URL")
            catalog_proxy = AgentMarketplaceCatalogFaultProxy(station_url)
            catalog_proxy.start()
            client = _client_from_manifest(
                runtime_manifest,
                profile_env,
                station_url=catalog_proxy.url,
            )
            reused = seed_actor_identity("alice", client.actor_identity_root, station_url)
            client.start()
            login = authenticate_client(
                client,
                account=ACCOUNT,
                password=profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
            )
            identity = persist_actor_identity(
                "alice",
                client.actor_identity_root,
                station_url,
                str(login["actorId"]),
            )
            result = client.harness(
                "runMarketplaceCatalogDevelopment",
                {"sampleId": f"mca-x3-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}"},
                timeout=600,
            )
            require(isinstance(result, Mapping), "X3 Harness result is invalid")
            capture = {
                **dict(result),
                "identity": {**identity, "reused": reused},
                "catalog-proxy": catalog_proxy.evidence(),
            }
            checks = evaluate_marketplace_capture(capture)
            capture["gateAssertions"] = checks
            status = "passed"
        except Exception as error:  # noqa: BLE001 - preserve first Gate failure.
            failure = str(error)
        finally:
            if client is not None:
                try:
                    log_bytes = (
                        client.log_path.read_bytes()
                        if client.log_path.is_file()
                        else b""
                    )
                    if log_bytes:
                        artifacts.write_bytes(
                            "logs/desktop.log",
                            log_bytes,
                            media_type="text/plain",
                        )
                except Exception as error:  # noqa: BLE001
                    runtime_cleanup["status"] = "failed"
                    runtime_cleanup["failures"].append(f"log capture: {error}")
                try:
                    runtime_cleanup["client"] = _cleanup_client(client)
                    if runtime_cleanup["client"].get("status") != "clean":
                        runtime_cleanup["status"] = "failed"
                except Exception as error:  # noqa: BLE001
                    runtime_cleanup["status"] = "failed"
                    runtime_cleanup["failures"].append(f"client cleanup: {error}")
            if catalog_proxy is not None:
                try:
                    catalog_proxy.stop()
                except Exception as error:  # noqa: BLE001
                    runtime_cleanup["status"] = "failed"
                    runtime_cleanup["failures"].append(
                        f"catalog proxy cleanup: {error}"
                    )
            if runtime_cleanup["status"] != "clean":
                status = "failed"
                failure = failure or "X3 runtime cleanup failed"

        runtime_manifest_ref = (
            current_artifact_ref(
                "runtime/environment-manifest.json",
                repo_root=ROOT,
            ).to_dict()
            if runtime_manifest is not None
            else {}
        )
        report = {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": AGENT_MARKETPLACE_GATE,
            "journey": JOURNEY_ID,
            "status": status,
            "completionStatus": "DONE" if status == "passed" else "FAILED",
            "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
            "phase": "X3 Trusted Package Discovery",
            "bom": ["X3", "P4-3", "MCA-D20", "MCA-D20A"],
            "spec": [
                "tooling/acceptance/features/agent-trusted-package-catalog.yaml",
                "docs/architecture/agent/modern-chat-agent/decisions.md#"
                "mca-d20a-station-distributed-publisher-signed-official-catalog",
            ],
            "gate": (
                "X3 requires a verified default source, signed synchronization, "
                "authenticated Station transport, pagination, native browse/detail, "
                "Agent/Skill/MCP authority readback, revocation, uninstall, and cleanup."
            ),
            "sampleEmissionAllowed": status == "passed",
            "source": source_identity(ROOT),
            "runtimeManifest": runtime_manifest_ref,
            "capture": capture,
            "runtimeCleanup": runtime_cleanup,
            "durationMs": int((time.monotonic() - started_at) * 1000),
            "error": failure,
        }
        role_payloads = {
            "receiver-dom": capture.get("receiver-dom", {}),
            "catalog-source": {
                "catalog": capture.get("catalog", {}),
                "transportProxy": capture.get("catalog-proxy", {}),
            },
            "target-readback": capture.get("target-readback", {}),
            "revocation": capture.get("revocation", {}),
            "cleanup": {
                "product": capture.get("cleanup", {}),
                "runtime": runtime_cleanup,
            },
            "source-identity": {
                "source": report["source"],
                "runtimeManifest": runtime_manifest_ref,
            },
        }
        for role, payload in role_payloads.items():
            artifacts.write_json(
                f"evidence/{role}.json",
                {
                    "artifactKind": f"agent-marketplace-{role}",
                    "status": status,
                    "proofStatus": report["proofStatus"],
                    "evidence": payload,
                },
                role=role,
            )
        artifacts.write_json(
            "reports/agent-marketplace-catalog.json",
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
        print(f"PASS: {AGENT_MARKETPLACE_GATE}")
        return 0
    print(f"FAIL: {AGENT_MARKETPLACE_GATE}: {failure}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
