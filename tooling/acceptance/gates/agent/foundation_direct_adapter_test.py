#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import unittest

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationAdapters,
    FoundationCandidateProducer,
    FoundationRolePolicy,
    FoundationTuple,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeEvidenceError,
    DirectRuntimeFoundationAdapter,
    DirectRuntimeProbeInput,
    REQUIRED_ASSERTIONS,
)

HASH = "a" * 64
OBSERVED_AT = "2026-08-25T00:00:00Z"


def runtime_tuple(
    cell: str,
    *,
    row: str = "foundation-desktop-direct",
    platform: str = "desktop_app",
) -> FoundationTuple:
    return FoundationTuple(
        gate="agent-v2-kernel-foundation-e2e",
        row=row,
        platform=platform,
        runtime="direct_model",
        cell=cell,
        locale="en",
        ordering="single",
        sample_id="sample-001",
        role_policy=FoundationRolePolicy(
            always=("cell-results", "runtime-attestation-set", "cleanup"),
            required=(
                "receiver-dom",
                "station-readback",
                "runtime-events",
                "measurement-report",
                "side-effect-count",
                "replay",
            ),
            not_applicable=("contract-evidence", "guard-report"),
        ),
        runtime_attestation_profile=(
            "direct_runtime_no_local_capability"
            if platform == "browser"
            else "direct_runtime"
        ),
    )


def capture(probe: DirectRuntimeProbeInput) -> dict[str, object]:
    runtime_snapshot = {
        "runtimeKind": "direct_model",
        "providerId": "provider",
        "modelId": "model",
        "runtimeProfileId": "modern-chat-agent-v1",
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "runtime": {"streaming": True},
            "agentic": {"tools": True},
            "limits": {"contextTokens": 1024},
            "resolution": {"text": "native"},
            "provenance": {"source": "station"},
        },
        "providerConfigVersion": "1",
        "agentConfigVersion": "1",
        "externalSessionId": "none",
        "externalSessionEpoch": 1,
        "thinkingMode": "auto",
    }
    capability_hash = hashlib.sha256(
        json.dumps(
            runtime_snapshot["capabilities"],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    config_hash = hashlib.sha256(
        json.dumps(
            {
                "agentConfigVersion": "1",
                "providerConfigVersion": "1",
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    runtime_snapshot_hash = hashlib.sha256(
        json.dumps(
            runtime_snapshot,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    result = {
        "assertions": {
            assertion: True
            for assertion in REQUIRED_ASSERTIONS[probe.cell]
        },
        "runtimeAttestation": {
            "actorIdentityHash": HASH,
            "conversationRuntimeBinding": {
                "runtimeKind": "direct_model",
                "providerId": "provider",
                "modelId": "model",
                "runtimeProfileId": "modern-chat-agent-v1",
                "externalSessionId": "none",
                "externalSessionEpoch": 1,
                "runtimeHomeRefHash": HASH,
                "capabilitySnapshotHash": capability_hash,
                "configSnapshotHash": config_hash,
                "boundAt": OBSERVED_AT,
            },
            "runtimeSnapshot": runtime_snapshot,
            "turnAttempt": {
                "attemptId": "attempt",
                "turnId": "turn",
                "index": 1,
                "contextLedgerId": "ledger",
                "capabilityReadinessSnapshotId": "readiness",
                "status": "completed",
                "runtimeSnapshotHash": runtime_snapshot_hash,
            },
            "toolCallBinding": {
                "toolCallId": "none",
                "turnId": "turn",
                "attemptId": "attempt",
                "capabilityId": "foundation",
                "capabilityVersion": "1",
                "bindingId": "binding",
                "bindingRevision": 1,
                "readinessSnapshotId": "readiness",
                "selectedDeviceId": "device",
                "selectedLeaseId": "lease",
                "sideEffectReceiptId": "receipt",
            },
            "clientSession": {
                "capabilitySessionId": "session",
                "actorIdHash": HASH,
                "deviceId": "device",
                "platform": probe.platform,
                "capabilities": [
                    {
                        "capabilityId": "foundation",
                        "schemaVersion": "1",
                        "permission": "allowed",
                        "constraints": {
                            "maxRequestBytes": 1,
                            "maxResultBytes": 1,
                            "allowedResourceKinds": ["text"],
                        },
                    }
                ],
                "expiresAt": OBSERVED_AT,
                "connectionId": "connection",
                "leaseId": "lease",
            },
            "stationProfile": "one",
            "desktopMode": probe.platform,
            "networkPath": "station",
            "machine": "test",
            "coldWarmState": "neutral",
            "observedAt": OBSERVED_AT,
        },
        "receiver-dom": {
            "scenarioId": probe.cell,
            "cellId": probe.cell,
            "selector": "[data-pt-agent-composer]",
            "locale": probe.locale,
            "textHash": HASH,
            "visible": True,
        },
        "station-readback": {
            "entityKind": "turn",
            "entityIdHash": HASH,
            "revision": 1,
            "stateHash": HASH,
        },
        "runtime-events": {
            "eventId": "event",
            "sequence": 1,
            "eventType": "terminal",
            "occurredAt": OBSERVED_AT,
        },
        "measurement-report": {
            "metric": probe.cell,
            "sampleIds": [probe.sample_id],
            "threshold": "reviewed",
            "passed": True,
        },
        "side-effect-count": {
            "counterId": hashlib.sha256(probe.cell.encode()).hexdigest(),
            "count": 0,
            "maximum": 0,
        },
        "replay": {
            "sourceHash": HASH,
            "replayHash": HASH,
            "equal": True,
        },
        "cleanup": {
            "resourceKind": "scenario",
            "resourceIdHash": HASH,
            "status": "clean",
        },
    }
    if probe.platform == "browser":
        attestation = result["runtimeAttestation"]
        del attestation["toolCallBinding"]
        attestation["clientSession"]["capabilities"] = []
    return result


class DirectRuntimeFoundationAdapterTest(unittest.TestCase):
    def adapter(self, probe=capture) -> DirectRuntimeFoundationAdapter:
        return DirectRuntimeFoundationAdapter(probe)

    def test_group_one_cells_are_explicitly_supported_on_both_receivers(self) -> None:
        adapter = self.adapter()
        producer = FoundationCandidateProducer(
            FoundationAdapters(
                desktop_native=adapter,
                browser=adapter,
                mobile_contract=adapter,
                d11=adapter,
                non_advertisement=adapter,
            )
        )
        for cell in REQUIRED_ASSERTIONS:
            for row, platform, method in (
                ("foundation-desktop-direct", "desktop_app", "observe_desktop_native"),
                ("foundation-browser-direct", "browser", "observe_browser"),
            ):
                item = runtime_tuple(cell, row=row, platform=platform)
                observation = getattr(adapter, method)(item)
                self.assertTrue(observation.observed)
                self.assertTrue(observation.passed)
                producer._validate_observation(item, observation)
                self.assertEqual(
                    set(observation.role_observations),
                    {
                        "cell-results",
                        "receiver-dom",
                        "station-readback",
                        "runtime-events",
                        "measurement-report",
                        "side-effect-count",
                        "replay",
                        "cleanup",
                    },
                )

    def test_unknown_cell_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            DirectRuntimeEvidenceError,
            "direct-runtime group is not implemented",
        ):
            self.adapter().observe_desktop_native(
                runtime_tuple("AS-F05")
            )

    def test_missing_required_assertion_fails_closed(self) -> None:
        def incomplete(probe: DirectRuntimeProbeInput) -> dict[str, object]:
            evidence = capture(probe)
            assertions = dict(evidence["assertions"])
            assertions.pop(next(iter(REQUIRED_ASSERTIONS[probe.cell])))
            evidence["assertions"] = assertions
            return evidence

        with self.assertRaisesRegex(
            DirectRuntimeEvidenceError,
            "incomplete oracle",
        ):
            self.adapter(incomplete).observe_desktop_native(
                runtime_tuple("AS-F01")
            )


if __name__ == "__main__":
    unittest.main()
