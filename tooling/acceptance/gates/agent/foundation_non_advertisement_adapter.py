#!/usr/bin/env python3
"""Production-evidence validator for Foundation non-advertisement tuples."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationRuntimeAttestation,
    FoundationTuple,
    FoundationTupleObservation,
)

EXPECTED_ROLES = frozenset(
    {"cell-results", "receiver-dom", "station-readback", "side-effect-count", "cleanup"}
)
NOT_ADVERTISED = "RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED"
RUNTIME_BY_ROW = {
    "foundation-desktop-cli-absent": (1, "trae-cli", True),
    "foundation-browser-cli-absent": (1, "trae-cli", False),
    "foundation-desktop-external-absent": (2, "external-agent", True),
    "foundation-browser-external-absent": (2, "external-agent", False),
}
COUNTER_FIELDS = (
    "runtime_bindings_created",
    "external_sessions_created",
    "runtime_homes_created",
    "processes_started",
    "workspaces_created",
)


class NonAdvertisementEvidenceError(RuntimeError):
    """Production readback cannot prove a non-advertisement tuple."""


@dataclass(frozen=True)
class NonAdvertisementProbeInput:
    platform: str
    locale: str
    runtime_kind: int
    runtime_id: str
    include_local: bool


Probe = Callable[[NonAdvertisementProbeInput], Mapping[str, Any]]


class NonAdvertisementFoundationAdapter:
    def __init__(
        self,
        probe: Probe,
        *,
        station_profile: str,
        machine: str,
    ) -> None:
        self._probe = probe
        self._station_profile = station_profile
        self._machine = machine

    def observe_non_advertisement(
        self,
        runtime_tuple: FoundationTuple,
    ) -> FoundationTupleObservation:
        expected = RUNTIME_BY_ROW.get(runtime_tuple.row)
        if expected is None:
            raise NonAdvertisementEvidenceError(
                f"unsupported non-advertisement row: {runtime_tuple.row}"
            )
        if runtime_tuple.role_policy.adapter_roles != EXPECTED_ROLES:
            raise NonAdvertisementEvidenceError(
                f"{runtime_tuple.row}: evidence role policy changed"
            )
        runtime_kind, runtime_id, include_local = expected
        capture = dict(
            self._probe(
                NonAdvertisementProbeInput(
                    platform=runtime_tuple.platform,
                    locale=runtime_tuple.locale,
                    runtime_kind=runtime_kind,
                    runtime_id=runtime_id,
                    include_local=include_local,
                )
            )
        )
        profile = _mapping(capture, "profile")
        before = _mapping(capture, "before")
        after = _mapping(capture, "after")
        receiver = _mapping(capture, "receiver")
        cleanup = _mapping(capture, "cleanup")

        runtime = _find_runtime(profile, runtime_id)
        if runtime.get("state") != NOT_ADVERTISED:
            raise NonAdvertisementEvidenceError(
                f"{runtime_id}: Station profile did not report NOT_ADVERTISED"
            )
        if not profile.get("profile_id") or not profile.get("readiness_snapshot_id"):
            raise NonAdvertisementEvidenceError(
                f"{runtime_id}: effective profile identity is incomplete"
            )
        if receiver.get("visible") is not False or receiver.get("count") != 0:
            raise NonAdvertisementEvidenceError(
                f"{runtime_id}: runtime selector is visible"
            )

        station_before = _mapping(before, "station")
        station_after = _mapping(after, "station")
        station_delta = _zero_delta(station_before, station_after, "station")
        local_delta: dict[str, int] = {}
        if include_local:
            local_before = _mapping(before, "local")
            local_after = _mapping(after, "local")
            local_delta = _zero_delta(local_before, local_after, "desktop-rust")
        elif before.get("local") is not None or after.get("local") is not None:
            raise NonAdvertisementEvidenceError(
                f"{runtime_tuple.row}: Browser evidence must not borrow Desktop counters"
            )

        if cleanup.get("status") != "clean":
            raise NonAdvertisementEvidenceError(
                f"{runtime_tuple.row}: runtime cleanup is not clean"
            )

        state_payload = {
            "profile": profile,
            "stationBefore": station_before,
            "stationAfter": station_after,
            "localDelta": local_delta,
            "receiver": receiver,
        }
        state_hash = _hash(state_payload)
        actor_hash = _hash({"ptid": station_before.get("ptid")})
        observed_at = datetime.now(timezone.utc).isoformat()
        selector = str(receiver.get("selector") or "")
        if not selector:
            raise NonAdvertisementEvidenceError(
                f"{runtime_tuple.row}: receiver selector is missing"
            )

        return FoundationTupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=FoundationRuntimeAttestation(
                "non_advertised",
                {
                    "capabilityInventoryAttestation": {
                        "inventoryHash": state_hash,
                        "surfaceId": runtime_id,
                        "zeroExecutionCount": 0,
                    },
                    "stationProfile": self._station_profile,
                    "networkPath": str(capture.get("networkPath") or ""),
                    "machine": self._machine,
                    "coldWarmState": "neutral",
                    "observedAt": observed_at,
                },
            ),
            role_observations={
                "cell-results": {
                    "cellId": runtime_tuple.cell,
                    "status": "passed",
                    "expected": f"{runtime_id} is not advertised and has zero activity delta",
                    "actual": "production profile, DOM, and activity snapshots agree",
                },
                "receiver-dom": {
                    "scenarioId": runtime_tuple.cell,
                    "cellId": runtime_tuple.cell,
                    "selector": selector,
                    "locale": runtime_tuple.locale,
                    "textHash": _hash({"text": receiver.get("text", "")}),
                    "visible": False,
                },
                "station-readback": {
                    "entityKind": "effective-runtime-profile",
                    "entityIdHash": _hash(
                        {
                            "snapshot": profile.get("snapshot_id"),
                            "runtime": runtime_id,
                        }
                    ),
                    "revision": int(profile.get("profile_revision") or 0),
                    "stateHash": state_hash,
                },
                "side-effect-count": {
                    "counterId": _hash(
                        {
                            "stationEpoch": station_before.get("counter_epoch"),
                            "localEpoch": (
                                _mapping(before, "local").get("counter_epoch")
                                if include_local
                                else "not-applicable"
                            ),
                            "runtime": runtime_id,
                        }
                    ),
                    "count": sum(station_delta.values()) + sum(local_delta.values()),
                    "maximum": 0,
                },
                "cleanup": {
                    "resourceKind": "isolated-client",
                    "resourceIdHash": _hash(
                        {"platform": runtime_tuple.platform, "runtime": runtime_id}
                    ),
                    "status": "clean",
                },
            },
        )


def _mapping(value: Mapping[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, Mapping):
        raise NonAdvertisementEvidenceError(f"{key}: mapping evidence is missing")
    return dict(item)


def _find_runtime(profile: Mapping[str, Any], runtime_id: str) -> dict[str, Any]:
    runtimes = profile.get("runtimes")
    if not isinstance(runtimes, list):
        raise NonAdvertisementEvidenceError("effective profile runtimes are missing")
    matches = [
        dict(item)
        for item in runtimes
        if isinstance(item, Mapping) and item.get("runtime_id") == runtime_id
    ]
    if len(matches) != 1:
        raise NonAdvertisementEvidenceError(
            f"{runtime_id}: expected one explicit runtime row, found {len(matches)}"
        )
    return matches[0]


def _zero_delta(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    owner: str,
) -> dict[str, int]:
    for field in ("owner", "owner_instance_id", "ptid", "runtime_kind", "runtime_id", "counter_epoch"):
        if not before.get(field) or before.get(field) != after.get(field):
            raise NonAdvertisementEvidenceError(
                f"{owner}: snapshot identity changed at {field}"
            )
    before_counters = before.get("counters")
    after_counters = after.get("counters")
    if not isinstance(before_counters, Mapping) or not isinstance(after_counters, Mapping):
        raise NonAdvertisementEvidenceError(f"{owner}: counters are missing")
    delta: dict[str, int] = {}
    for field in COUNTER_FIELDS:
        previous = int(before_counters.get(field, -1))
        current = int(after_counters.get(field, -1))
        if previous < 0 or current < previous:
            raise NonAdvertisementEvidenceError(
                f"{owner}: counter {field} regressed or is missing"
            )
        delta[field] = current - previous
    if any(delta.values()):
        raise NonAdvertisementEvidenceError(
            f"{owner}: runtime activity delta is not zero: {delta}"
        )
    return delta


def _hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
