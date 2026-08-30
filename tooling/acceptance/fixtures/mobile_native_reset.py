from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Protocol

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.evidence_store import (
    ArtifactRef,
    current_artifact_ref,
    write_current_artifact,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import utc_now
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_PASSWORD,
    reset_fixture,
    resolve_actor_identity,
    verify_reset_target,
)
from tooling.acceptance.fixtures.mobile_resource_lease import (
    BaselineRestoreResult,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    GATE_ID,
    validate_contract_payload,
)

ROLES = ("alice", "bob")
EXPECTED_CLIENTS = {
    "alice-ios": ("ios", "alice"),
    "bob-ios": ("ios", "bob"),
    "alice-android": ("android", "alice"),
    "bob-android": ("android", "bob"),
}
SERVICE_CONFIG = {
    "station-primary": (
        "PT_MOBILE_STATION_PRIMARY_URL",
        "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV",
    ),
    "station-secondary": (
        "PT_MOBILE_STATION_SECONDARY_URL",
        "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV",
    ),
}


class StationFixtureCleanup(Protocol):
    run_id: str
    run_handle: Any
    leases: Mapping[str, Mapping[str, Any]]
    lease_refs: Mapping[str, ArtifactRef]
    quarantined: Mapping[str, str]

    def cleanup(self) -> tuple[str, ...]:
        ...


class ResourceLeaseCleanup(Protocol):
    def release(
        self,
        lease: Mapping[str, Any],
        *,
        restore: Callable[[], BaselineRestoreResult],
    ) -> dict[str, Any]:
        ...

    def quarantine(
        self,
        lease: Mapping[str, Any],
        failure_code: str,
    ) -> dict[str, Any]:
        ...

    def terminal_outcome(self, resource_key: str) -> dict[str, Any] | None:
        ...

    def cleanup_correlation_channel(self) -> dict[str, bool]:
        ...


@dataclass(frozen=True)
class MobileNativeCleanupResult:
    resource_outcomes: tuple[dict[str, Any], ...]
    fixture_outcomes: tuple[dict[str, Any], ...]
    post_cleanup_station_proofs: tuple[str, ...]
    correlation_channel_closed: bool
    correlation_key_zeroized: bool


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise BlockedError(
            reason=f"Mobile native Fixture requires {name}",
            resource=f"fixture-environment:{name}",
        )
    return value


def _reference_variable(reference: str, client_id: str, kind: str) -> str:
    if not reference.startswith("env:") or not reference.removeprefix("env:"):
        raise BlockedError(
            reason=(
                f"Mobile native client {client_id!r} requires an env-backed "
                f"{kind} reference"
            ),
            resource=f"fixture-client:{client_id}:{kind}",
        )
    return reference.removeprefix("env:")


def _fixture_clients(client_specs: Iterable[Any]) -> list[dict[str, str]]:
    clients: list[dict[str, str]] = []
    for client in client_specs:
        client_id = str(getattr(client, "id", ""))
        platform = str(getattr(client, "platform", ""))
        actor = str(getattr(client, "actor", ""))
        if EXPECTED_CLIENTS.get(client_id) != (platform, actor):
            raise BlockedError(
                reason=(
                    "Mobile native Fixture requires isolated alice/bob clients "
                    "for both iOS and Android"
                ),
                resource="fixture-clients",
            )
        clients.append(
            {
                "id": client_id,
                "platform": platform,
                "actor": actor,
                "deviceRole": str(getattr(client, "device_role", "")),
                "profile": str(getattr(client, "profile", "")),
                "destinationVariable": _reference_variable(
                    str(getattr(client, "destination_ref", "")),
                    client_id,
                    "destination",
                ),
                "deviceVariable": _reference_variable(
                    str(getattr(client, "device_ref", "")),
                    client_id,
                    "device",
                ),
                "sessionLease": str(getattr(client, "session_lease", "")),
            }
        )
    if (
        len(clients) != 4
        or {client["id"] for client in clients} != set(EXPECTED_CLIENTS)
        or len({client["profile"] for client in clients}) != 4
        or len({client["deviceVariable"] for client in clients}) != 4
    ):
        raise BlockedError(
            reason=(
                "Mobile native Fixture requires four isolated client, profile, "
                "and device assignments"
            ),
            resource="fixture-clients",
        )
    return clients


def prepare_fixture(
    environment_id: str,
    run_id: str,
    client_specs: Iterable[Any] = (),
) -> dict:
    if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
        raise BlockedError(
            reason=(
                "Mobile native actor reset requires MOBILE_ACCEPTANCE_RESET=1"
            ),
            resource="fixture-authorization:MOBILE_ACCEPTANCE_RESET",
        )

    clients = _fixture_clients(client_specs)
    stations: dict[str, dict] = {}
    for service_id, (url_name, deploy_name) in SERVICE_CONFIG.items():
        station_url = _required_environment(url_name)
        deployment_environment = _required_environment(deploy_name)
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(deployment_environment, ROLES)
        actors = [
            resolve_actor_identity(station_url, role, ACTOR_PASSWORD)
            for role in ROLES
        ]
        stations[service_id] = {
            "actors": [
                {
                    "role": actor.role,
                    "accountRef": actor.account_ref,
                    "ptid": actor.ptid,
                    "devicePolicy": actor.device_policy,
                }
                for actor in actors
            ],
            "targetVerified": True,
        }

    payload = {
        "artifactKind": "mobile-native-actor-manifest",
        "fixtureId": "mobile-native-actors",
        "environmentId": environment_id,
        "runId": run_id,
        "createdAt": utc_now(),
        "initialState": "ready",
        "stations": stations,
        "clients": clients,
        "reset": {
            "authorized": True,
            "targetVerified": True,
        },
        "cleanup": {
            "deterministic": True,
            "action": "reset disposable actors and revoke fixture sessions",
        },
    }
    relative_path = "runtime/mobile-actor-manifest.json"
    write_current_artifact(
        relative_path,
        (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8"),
        repo_root=REPO_ROOT,
    )
    return current_artifact_ref(
        relative_path,
        repo_root=REPO_ROOT,
        media_type="application/json",
    ).to_dict()


def cleanup_fixture(
    station_fixture: StationFixtureCleanup | None = None,
    *,
    lease_broker: ResourceLeaseCleanup | None = None,
    browser_leases: Sequence[Mapping[str, Any]] = (),
    physical_device_leases: Sequence[Mapping[str, Any]] = (),
    provider_account_leases: Sequence[Mapping[str, Any]] = (),
    restore_callbacks: Mapping[
        str,
        Callable[[], BaselineRestoreResult],
    ] | None = None,
) -> MobileNativeCleanupResult:
    if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
        raise BlockedError(
            reason=(
                "Mobile native Fixture cleanup requires "
                "MOBILE_ACCEPTANCE_RESET=1"
            ),
            resource="fixture-authorization:MOBILE_ACCEPTANCE_RESET",
        )
    failures: list[str] = []
    resource_outcomes: list[dict[str, Any]] = []
    callbacks = restore_callbacks or {}

    if lease_broker is None and (
        browser_leases
        or physical_device_leases
        or provider_account_leases
        or restore_callbacks
    ):
        raise BlockedError(
            reason="Mobile native leased cleanup requires the resource broker",
            resource="fixture-cleanup:resource-broker",
        )
    if lease_broker is not None and station_fixture is None:
        raise BlockedError(
            reason="Mobile native leased cleanup requires the Station Fixture",
            resource="fixture-cleanup:station-fixture",
        )

    if lease_broker is not None:
        for lease_kind, leases in (
            ("browser", browser_leases),
            ("device", physical_device_leases),
            ("account", provider_account_leases),
        ):
            for lease in reversed(tuple(leases)):
                try:
                    outcome, failure = _release_resource(
                        lease_broker,
                        lease,
                        callbacks,
                    )
                except BaseException as error:
                    failures.append(
                        f"{lease_kind}:{lease.get('resourceKey')}: "
                        f"terminalization failed: {error}"
                    )
                    continue
                resource_outcomes.append(outcome)
                if failure:
                    failures.append(f"{lease_kind}:{failure}")

    for service_id in reversed(tuple(SERVICE_CONFIG)):
        url_name, deploy_name = SERVICE_CONFIG[service_id]
        try:
            station_url = _required_environment(url_name)
            deployment_environment = _required_environment(deploy_name)
            verify_reset_target(station_url, deployment_environment)
            reset_fixture(deployment_environment, ROLES)
        except Exception as error:
            failures.append(f"{service_id}: {error}")

    released_fixture_services: tuple[str, ...] = ()
    if station_fixture is not None:
        try:
            released_fixture_services = station_fixture.cleanup()
        except BaseException as error:
            failures.append(f"mobile-oauth-station: {error}")

    fixture_outcomes: tuple[dict[str, Any], ...] = ()
    if station_fixture is not None:
        try:
            fixture_outcomes = _write_fixture_outcomes(station_fixture)
        except BaseException as error:
            failures.append(f"mobile-oauth-station-outcomes: {error}")

    correlation_cleanup = {
        "correlationChannelClosed": lease_broker is None,
        "correlationKeyZeroized": lease_broker is None,
    }
    if lease_broker is not None:
        try:
            correlation_cleanup = lease_broker.cleanup_correlation_channel()
        except BaseException as error:
            failures.append(f"provider-correlation: {error}")
    if not (
        correlation_cleanup.get("correlationChannelClosed") is True
        and correlation_cleanup.get("correlationKeyZeroized") is True
    ):
        failures.append("provider-correlation: cleanup was incomplete")

    result = MobileNativeCleanupResult(
        resource_outcomes=tuple(resource_outcomes),
        fixture_outcomes=fixture_outcomes,
        post_cleanup_station_proofs=tuple(
            f"evidence/mobile/cleanup/station/{service_id}.json"
            for service_id in released_fixture_services
        ),
        correlation_channel_closed=bool(
            correlation_cleanup.get("correlationChannelClosed")
        ),
        correlation_key_zeroized=bool(
            correlation_cleanup.get("correlationKeyZeroized")
        ),
    )
    if failures:
        raise BlockedError(
            reason=(
                "Mobile native Fixture cleanup failed after reverse-order "
                f"cleanup: {'; '.join(failures)}"
            ),
            resource="fixture-cleanup",
        )
    return result


def _release_resource(
    broker: ResourceLeaseCleanup,
    lease: Mapping[str, Any],
    callbacks: Mapping[str, Callable[[], BaselineRestoreResult]],
) -> tuple[dict[str, Any], str]:
    resource_key = str(lease.get("resourceKey") or "")
    restore = callbacks.get(resource_key)
    if restore is None:
        outcome = _quarantine_without_terminal_outcome(
            broker,
            lease,
            "LEASE_CLEANUP_FAILED",
        )
        return outcome, f"{resource_key}: restore callback is missing"

    try:
        outcome = broker.release(lease, restore=restore)
    except BaseException as error:
        outcome = _quarantine_without_terminal_outcome(
            broker,
            lease,
            "LEASE_CLEANUP_FAILED",
        )
        return outcome, f"{resource_key}: {error}"
    if outcome.get("finalState") != "RELEASED":
        return outcome, (
            f"{resource_key}: {outcome.get('failureCode') or 'LEASE_CLEANUP_FAILED'}"
        )
    return outcome, ""


def _quarantine_without_terminal_outcome(
    broker: ResourceLeaseCleanup,
    lease: Mapping[str, Any],
    failure_code: str,
) -> dict[str, Any]:
    resource_key = str(lease.get("resourceKey") or "")
    outcome = broker.terminal_outcome(resource_key)
    if outcome is not None:
        return outcome
    return broker.quarantine(lease, failure_code)


def _write_fixture_outcomes(
    station_fixture: StationFixtureCleanup,
) -> tuple[dict[str, Any], ...]:
    outcomes: list[dict[str, Any]] = []
    for service_id in reversed(tuple(station_fixture.leases)):
        lease = station_fixture.leases[service_id]
        reference = station_fixture.lease_refs.get(service_id)
        if reference is None:
            raise RuntimeError(
                f"Station Fixture acquisition reference is missing for {service_id}"
            )
        released = lease.get("state") == "RELEASED"
        payload = {
            "artifactKind": "mobile-lease-outcome",
            "runId": station_fixture.run_id,
            "gateId": GATE_ID,
            "leaseId": f"fixture-{service_id}",
            "leaseKind": "fixture",
            "resourceKey": lease["resourceKey"],
            "holderRunId": lease["holderRunId"],
            "fenceToken": lease["fenceToken"],
            "acquisition": reference.to_dict(),
            "finalState": "RELEASED" if released else "QUARANTINED",
            "cleanupCompleted": released,
            "baselineRestored": released,
            "identityReverified": released,
            "failureCode": "" if released else "LEASE_CLEANUP_FAILED",
            "observedAt": utc_now(),
        }
        validated = validate_contract_payload(
            payload,
            expected_kind="mobile-lease-outcome",
            expected_run_id=station_fixture.run_id,
            expected_gate_id=GATE_ID,
        )
        path = f"evidence/mobile/cleanup/leases/fixture-{service_id}.json"
        station_fixture.run_handle.write_json(
            path,
            validated,
            role=path,
            redact=False,
        )
        outcomes.append(validated)
    return tuple(outcomes)


def main() -> int:
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--cleanup", action="store_true")
    parser.add_argument("--environment-id", default="mobile-native")
    parser.add_argument("--run-id", default=os.environ.get("PT_ACCEPTANCE_RUN_ID", ""))
    args = parser.parse_args()
    try:
        if args.prepare:
            if not args.run_id:
                raise BlockedError(
                    reason="Mobile native Fixture requires a run id",
                    resource="fixture-run-id",
                )
            from tooling.acceptance.provisioners.mobile_native import (
                load_mobile_native_preflight_spec,
            )

            prepare_fixture(
                args.environment_id,
                args.run_id,
                load_mobile_native_preflight_spec().clients,
            )
        else:
            cleanup_fixture()
    except BlockedError as error:
        sys.stderr.write(f"{error.reason}\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
