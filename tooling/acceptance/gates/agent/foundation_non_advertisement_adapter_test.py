#!/usr/bin/env python3

from __future__ import annotations

import dataclasses
import unittest

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationRolePolicy,
    FoundationTuple,
)
from tooling.acceptance.gates.agent.foundation_non_advertisement_adapter import (
    NonAdvertisementEvidenceError,
    NonAdvertisementFoundationAdapter,
    NonAdvertisementProbeInput,
)


def runtime_tuple(
    row: str = "foundation-desktop-external-absent",
    platform: str = "desktop_app",
) -> FoundationTuple:
    return FoundationTuple(
        gate="agent-v2-kernel-foundation-e2e",
        row=row,
        platform=platform,
        runtime=(
            "stateless_cli_absent"
            if "cli" in row
            else "external_agent_absent"
        ),
        cell=(
            "AS-F13-NON_ADVERTISED"
            if "cli" in row
            else "AS-F11-NON_ADVERTISED"
        ),
        locale="en",
        ordering="single",
        sample_id="sample-001",
        role_policy=FoundationRolePolicy(
            always=("cell-results", "runtime-attestation-set", "cleanup"),
            required=("receiver-dom", "station-readback", "side-effect-count"),
            not_applicable=(
                "runtime-events",
                "measurement-report",
                "replay",
                "contract-evidence",
                "guard-report",
            ),
        ),
        runtime_attestation_profile="non_advertised",
    )


def snapshot(
    *,
    owner: str,
    runtime_id: str,
    epoch: str,
    process_count: int = 0,
) -> dict[str, object]:
    return {
        "snapshot_id": f"{owner}-snapshot",
        "owner": owner,
        "owner_instance_id": f"{owner}-instance",
        "ptid": "actor-1",
        "runtime_kind": (
            "RUNTIME_KIND_DIRECT_MODEL"
            if runtime_id == "trae-cli"
            else "RUNTIME_KIND_EXTERNAL_AGENT"
        ),
        "runtime_id": runtime_id,
        "counter_epoch": epoch,
        "counters": {
            "runtime_bindings_created": 0,
            "external_sessions_created": 0,
            "runtime_homes_created": 0,
            "processes_started": process_count,
            "workspaces_created": 0,
        },
    }


def capture(probe: NonAdvertisementProbeInput) -> dict[str, object]:
    station = snapshot(
        owner="station",
        runtime_id=probe.runtime_id,
        epoch="station-epoch",
    )
    local = (
        snapshot(
            owner="desktop-rust",
            runtime_id=probe.runtime_id,
            epoch="desktop-epoch",
        )
        if probe.include_local
        else None
    )
    return {
        "profile": {
            "snapshot_id": "profile-snapshot",
            "profile_id": "modern-chat-agent-v1",
            "profile_revision": 1,
            "readiness_snapshot_id": "readiness-1",
            "runtimes": [
                {
                    "runtime_id": probe.runtime_id,
                    "state": "RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED",
                }
            ],
        },
        "before": {"station": station, "local": local},
        "after": {"station": dict(station), "local": dict(local) if local else None},
        "receiver": {
            "selector": f'[data-runtime-id="{probe.runtime_id}"]',
            "count": 0,
            "visible": False,
            "text": "",
        },
        "cleanup": {"status": "clean"},
        "networkPath": "native-tauri" if probe.include_local else "secondary-gateway",
    }


class NonAdvertisementFoundationAdapterTest(unittest.TestCase):
    def adapter(self, probe=capture) -> NonAdvertisementFoundationAdapter:
        return NonAdvertisementFoundationAdapter(
            probe,
            station_profile="one",
            machine="test-machine",
        )

    def test_desktop_and_secondary_rows_produce_typed_zero_evidence(self) -> None:
        for row, platform in (
            ("foundation-desktop-cli-absent", "desktop_app"),
            ("foundation-secondary-cli-absent", "secondary"),
            ("foundation-desktop-external-absent", "desktop_app"),
            ("foundation-secondary-external-absent", "secondary"),
        ):
            observation = self.adapter().observe_non_advertisement(
                runtime_tuple(row, platform)
            )
            self.assertTrue(observation.observed)
            self.assertTrue(observation.passed)
            self.assertEqual(
                observation.role_observations["side-effect-count"]["count"],
                0,
            )
            self.assertFalse(
                observation.role_observations["receiver-dom"]["visible"]
            )

    def test_runtime_activity_fails_when_a_counter_increases(self) -> None:
        def changed(probe: NonAdvertisementProbeInput) -> dict[str, object]:
            evidence = capture(probe)
            after = dict(evidence["after"])
            station = dict(after["station"])
            counters = dict(station["counters"])
            counters["processes_started"] = 1
            station["counters"] = counters
            after["station"] = station
            evidence["after"] = after
            return evidence

        with self.assertRaisesRegex(
            NonAdvertisementEvidenceError,
            "runtime activity delta is not zero",
        ):
            self.adapter(changed).observe_non_advertisement(runtime_tuple())

    def test_secondary_rejects_desktop_local_counter_evidence(self) -> None:
        def borrowed(probe: NonAdvertisementProbeInput) -> dict[str, object]:
            evidence = capture(probe)
            local = snapshot(
                owner="desktop-rust",
                runtime_id=probe.runtime_id,
                epoch="desktop-epoch",
            )
            evidence["before"]["local"] = local
            evidence["after"]["local"] = dict(local)
            return evidence

        with self.assertRaisesRegex(
            NonAdvertisementEvidenceError,
            "must not borrow Desktop counters",
        ):
            self.adapter(borrowed).observe_non_advertisement(
                runtime_tuple(
                    "foundation-secondary-external-absent",
                    "secondary",
                )
            )

    def test_missing_explicit_runtime_row_fails_closed(self) -> None:
        def missing(probe: NonAdvertisementProbeInput) -> dict[str, object]:
            evidence = capture(probe)
            evidence["profile"] = {
                **evidence["profile"],
                "runtimes": [],
            }
            return evidence

        with self.assertRaisesRegex(
            NonAdvertisementEvidenceError,
            "expected one explicit runtime row",
        ):
            self.adapter(missing).observe_non_advertisement(runtime_tuple())

    def test_role_policy_drift_fails_closed(self) -> None:
        changed = dataclasses.replace(
            runtime_tuple(),
            role_policy=FoundationRolePolicy(
                always=("cell-results", "runtime-attestation-set", "cleanup"),
                required=("receiver-dom", "station-readback"),
                not_applicable=("side-effect-count",),
            ),
        )
        with self.assertRaisesRegex(
            NonAdvertisementEvidenceError,
            "evidence role policy changed",
        ):
            self.adapter().observe_non_advertisement(changed)


if __name__ == "__main__":
    unittest.main()
