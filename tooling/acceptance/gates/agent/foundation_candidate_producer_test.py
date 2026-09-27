from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any, Callable
from unittest import mock

from tooling.acceptance.core import EvidenceStore, source_identity
from tooling.acceptance.gates.agent.agent_v2_gate import _validate_candidate
from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    EVIDENCE_ROLES,
    GATE_ID,
    SCENARIO_ROLES,
    FoundationAdapters,
    FoundationCandidateError,
    FoundationCandidateProducer,
    FoundationRuntimeAttestation,
    FoundationTuple,
    FoundationTupleObservation,
    _ensure_evidence_safe,
    load_foundation_tuples,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
HASH = "a" * 64
OBSERVED_AT = "2026-08-24T00:00:00.000000+00:00"


def _load_script(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _runtime_attestation(
    runtime_tuple: FoundationTuple,
) -> FoundationRuntimeAttestation:
    suffix = hashlib.sha256(runtime_tuple.key.encode("utf-8")).hexdigest()[:16]
    if runtime_tuple.runtime_attestation_profile == "contract_only":
        payload = {
            "contractAttestation": {
                "contractId": runtime_tuple.cell,
                "contractHash": HASH,
                "platform": runtime_tuple.platform,
                "toolchain": "vitest-protobuf",
                "roundTripStatus": "passed",
            },
            "stationProfile": "one",
            "networkPath": "contract-only",
            "machine": "test-machine",
            "coldWarmState": "contract",
            "observedAt": OBSERVED_AT,
        }
        return FoundationRuntimeAttestation("contract_only", payload)
    if runtime_tuple.runtime_attestation_profile == "orchestration_guard":
        payload = {
            "guardAttestation": {
                "guardId": runtime_tuple.cell,
                "sourceInventoryHash": HASH,
                "violationCount": 0,
            },
            "stationProfile": "one",
            "networkPath": "source-audit",
            "machine": "test-machine",
            "coldWarmState": "neutral",
            "observedAt": OBSERVED_AT,
        }
        return FoundationRuntimeAttestation("orchestration_guard", payload)
    if runtime_tuple.runtime_attestation_profile == "non_advertised":
        payload = {
            "capabilityInventoryAttestation": {
                "inventoryHash": HASH,
                "surfaceId": runtime_tuple.runtime,
                "zeroExecutionCount": 0,
            },
            "stationProfile": "one",
            "networkPath": "capability-inventory",
            "machine": "test-machine",
            "coldWarmState": "neutral",
            "observedAt": OBSERVED_AT,
        }
        return FoundationRuntimeAttestation("non_advertised", payload)

    runtime_snapshot = {
        "runtimeKind": runtime_tuple.runtime,
        "providerId": f"provider-{suffix}",
        "modelId": f"model-{suffix}",
        "runtimeProfileId": "one",
        "capabilities": {
            "input": {"text": True},
            "output": {"text": True},
            "runtime": {"streaming": True},
            "agentic": {"tools": True},
            "limits": {"contextTokens": 1024},
            "resolution": {"text": "native"},
            "provenance": {"source": "deterministic-test-adapter"},
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
        ).encode("utf-8")
    ).hexdigest()
    config_hash = hashlib.sha256(
        json.dumps(
            {
                "agentConfigVersion": "1",
                "providerConfigVersion": "1",
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    snapshot_hash = hashlib.sha256(
        json.dumps(
            runtime_snapshot,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    attempt_id = f"attempt-{suffix}"
    turn_id = f"turn-{suffix}"
    readiness_id = f"readiness-{suffix}"
    device_id = f"device-{runtime_tuple.platform}"
    lease_id = f"lease-{suffix}"
    payload = {
        "actorIdentityHash": HASH,
        "conversationRuntimeBinding": {
            "runtimeKind": runtime_tuple.runtime,
            "providerId": runtime_snapshot["providerId"],
            "modelId": runtime_snapshot["modelId"],
            "runtimeProfileId": "one",
            "externalSessionId": "none",
            "externalSessionEpoch": 1,
            "runtimeHomeRefHash": HASH,
            "capabilitySnapshotHash": capability_hash,
            "configSnapshotHash": config_hash,
            "boundAt": OBSERVED_AT,
        },
        "runtimeSnapshot": runtime_snapshot,
        "turnAttempt": {
            "attemptId": attempt_id,
            "turnId": turn_id,
            "index": 1,
            "contextLedgerId": f"context-{suffix}",
            "capabilityReadinessSnapshotId": readiness_id,
            "status": "completed",
            "runtimeSnapshotHash": snapshot_hash,
        },
        "toolCallBinding": {
            "toolCallId": f"tool-{suffix}",
            "turnId": turn_id,
            "attemptId": attempt_id,
            "capabilityId": "foundation",
            "capabilityVersion": "1",
            "bindingId": f"binding-{suffix}",
            "bindingRevision": 1,
            "readinessSnapshotId": readiness_id,
            "selectedDeviceId": device_id,
            "selectedLeaseId": lease_id,
            "sideEffectReceiptId": f"receipt-{suffix}",
        },
        "clientSession": {
            "capabilitySessionId": f"session-{suffix}",
            "actorIdHash": HASH,
            "deviceId": device_id,
            "platform": runtime_tuple.platform,
            "capabilities": [
                {
                    "capabilityId": "foundation",
                    "schemaVersion": "1",
                    "permission": "granted",
                    "constraints": {
                        "maxRequestBytes": 1024,
                        "maxResultBytes": 1024,
                        "allowedResourceKinds": ["text"],
                    },
                }
            ],
            "expiresAt": "2026-08-24T01:00:00.000000+00:00",
            "connectionId": f"connection-{suffix}",
            "leaseId": lease_id,
        },
        "stationProfile": "one",
        "desktopMode": "test",
        "networkPath": "test",
        "machine": "test-machine",
        "coldWarmState": (
            "cold"
            if runtime_tuple.sample_id.startswith("cold-")
            else "warm"
            if runtime_tuple.sample_id.startswith("warm-")
            else "contract"
            if runtime_tuple.locale == "contract"
            else "neutral"
        ),
        "observedAt": OBSERVED_AT,
    }
    if (
        runtime_tuple.runtime_attestation_profile
        == "direct_runtime_no_local_capability"
    ):
        del payload["toolCallBinding"]
        payload["clientSession"]["capabilities"] = []
    return FoundationRuntimeAttestation(
        runtime_tuple.runtime_attestation_profile,
        payload,
    )


def _role_observations(runtime_tuple: FoundationTuple) -> dict[str, dict[str, object]]:
    suffix = hashlib.sha256(runtime_tuple.key.encode("utf-8")).hexdigest()[:16]
    values: dict[str, dict[str, object]] = {
        "cell-results": {
            "cellId": runtime_tuple.cell,
            "status": "passed",
            "expected": "reviewed matrix oracle",
            "actual": "adapter observation",
        },
        "receiver-dom": {
            "scenarioId": runtime_tuple.cell,
            "cellId": runtime_tuple.cell,
            "selector": "[data-agent-message]",
            "locale": runtime_tuple.locale,
            "textHash": HASH,
            "expectedVisible": (
                runtime_tuple.runtime_attestation_profile
                != "non_advertised"
            ),
            "visible": (
                runtime_tuple.runtime_attestation_profile
                != "non_advertised"
            ),
        },
        "station-readback": {
            "entityKind": "turn",
            "entityIdHash": HASH,
            "revision": 1,
            "stateHash": HASH,
        },
        "runtime-events": {
            "eventId": f"event-{suffix}",
            "sequence": 1,
            "eventType": "terminal",
            "occurredAt": OBSERVED_AT,
        },
        "measurement-report": {
            "metric": runtime_tuple.cell,
            "sampleIds": [runtime_tuple.sample_id],
            "threshold": "reviewed-cell-oracle",
            "passed": True,
        },
        "side-effect-count": {
            "counterId": f"counter-{suffix}",
            "count": 0,
            "maximum": 1,
        },
        "replay": {
            "sourceHash": HASH,
            "replayHash": HASH,
            "equal": True,
        },
        "cleanup": {
            "resourceKind": "tuple-fixture",
            "resourceIdHash": HASH,
            "status": "clean",
        },
        "contract-evidence": {
            "contractId": runtime_tuple.cell,
            "contractHash": HASH,
            "platform": runtime_tuple.platform,
            "status": "passed",
            "roundTripEqual": True,
        },
        "guard-report": {
            "guardId": runtime_tuple.cell,
            "sourceInventoryHash": HASH,
            "violationCount": 0,
            "passed": True,
        },
    }
    applicable_roles = runtime_tuple.role_policy.adapter_roles
    if not applicable_roles.issubset(values):
        raise AssertionError("test observations do not cover applicable roles")
    return {
        role: values[role]
        for role in EVIDENCE_ROLES
        if role in applicable_roles
    }


class RecordingAdapter:
    def __init__(
        self,
        mutate: Callable[
            [FoundationTuple, FoundationTupleObservation],
            FoundationTupleObservation,
        ]
        | None = None,
    ) -> None:
        self.calls: list[tuple[str, str]] = []
        self._mutate = mutate

    def _observe(
        self,
        method: str,
        runtime_tuple: FoundationTuple,
    ) -> FoundationTupleObservation:
        self.calls.append((method, runtime_tuple.row))
        observation = FoundationTupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=_runtime_attestation(runtime_tuple),
            role_observations=_role_observations(runtime_tuple),
        )
        return self._mutate(runtime_tuple, observation) if self._mutate else observation

    def observe_desktop_native(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        return self._observe("desktop_native", runtime_tuple)

    def observe_browser(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        return self._observe("browser", runtime_tuple)

    def observe_mobile_contract(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        return self._observe("mobile_contract", runtime_tuple)

    def observe_d11(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        return self._observe("d11", runtime_tuple)

    def observe_non_advertisement(
        self, runtime_tuple: FoundationTuple
    ) -> FoundationTupleObservation:
        return self._observe("non_advertisement", runtime_tuple)


def _adapters(adapter: RecordingAdapter) -> FoundationAdapters:
    return FoundationAdapters(
        desktop_native=adapter,
        browser=adapter,
        mobile_contract=adapter,
        d11=adapter,
        non_advertisement=adapter,
    )


class FoundationCandidateProducerTest(unittest.TestCase):
    def test_exact_matrix_routes_all_419_tuples(self) -> None:
        tuples = load_foundation_tuples()
        self.assertEqual(len(tuples), 419)
        adapter = RecordingAdapter()
        collected = FoundationCandidateProducer(_adapters(adapter)).collect()
        self.assertEqual(len(collected), 419)
        calls = Counter(method for method, _ in adapter.calls)
        expected = Counter(
            {
                "desktop_native": sum(
                    item.row == "foundation-desktop-direct" for item in tuples
                ),
                "browser": sum(
                    item.row == "foundation-browser-direct" for item in tuples
                ),
                "mobile_contract": sum(
                    item.row == "foundation-mobile-contract" for item in tuples
                ),
                "d11": sum(item.row == "foundation-d11" for item in tuples),
                "non_advertisement": sum(
                    item.row.endswith("-absent") for item in tuples
                ),
            }
        )
        self.assertEqual(calls, expected)
        self.assertTrue(all(expected.values()))
        self.assertEqual(
            Counter(item.runtime_attestation_profile for item in tuples),
            Counter(
                {
                    "direct_runtime": 197,
                    "direct_runtime_no_local_capability": 197,
                    "contract_only": 15,
                    "orchestration_guard": 2,
                    "non_advertised": 8,
                }
            ),
        )

    def test_produces_row_scoped_role_candidate_compatible_with_gate(self) -> None:
        adapter = RecordingAdapter()
        tuples = load_foundation_tuples()
        applicable_counts = Counter(
            role
            for runtime_tuple in tuples
            for role in runtime_tuple.role_policy.adapter_roles
        )
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            run = store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
            try:
                candidate_path = FoundationCandidateProducer(
                    _adapters(adapter)
                ).produce(run)
                self.assertFalse(candidate_path.is_relative_to(REPO_ROOT))
                self.assertEqual(_validate_candidate(GATE_ID, candidate_path), [])
                candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
                self.assertEqual(candidate["proofStatus"], "UNPROVEN")
                self.assertEqual(
                    {item["role"] for item in candidate["artifacts"]},
                    set(SCENARIO_ROLES),
                )
                artifacts = run.collect_existing_artifacts()
                runtime_set = store.read_json(artifacts["runtime-attestation-set"])
                self.assertEqual(len(runtime_set["tuples"]), 419)
                self.assertEqual(
                    Counter(
                        item["attestationProfile"]
                        for item in runtime_set["tuples"]
                    ),
                    Counter(
                        {
                            "direct_runtime": 197,
                            "direct_runtime_no_local_capability": 197,
                            "contract_only": 15,
                            "orchestration_guard": 2,
                            "non_advertised": 8,
                        }
                    ),
                )
                for role in EVIDENCE_ROLES:
                    with self.subTest(role=role):
                        payload = store.read_json(artifacts[role])
                        expected_keys = {
                            item.key
                            for item in tuples
                            if role in item.role_policy.adapter_roles
                        }
                        expected_scenarios = {
                            item.cell
                            for item in tuples
                            if role in item.role_policy.adapter_roles
                        }
                        self.assertEqual(
                            payload["sampleCount"],
                            applicable_counts[role],
                        )
                        self.assertEqual(
                            len(payload["observations"]),
                            applicable_counts[role],
                        )
                        self.assertEqual(
                            set(payload["runtimeAttestationRefs"]),
                            expected_keys,
                        )
                        self.assertEqual(
                            set(payload["scenarioIds"]),
                            expected_scenarios,
                        )
            finally:
                run.close()

    def test_emitted_roles_pass_canonical_candidate_validation(self) -> None:
        acceptance_run = _load_script(
            REPO_ROOT / "tooling/scripts/acceptance-run.py",
            "_foundation_candidate_acceptance_run",
        )
        validator: Any = _load_script(
            REPO_ROOT / "tooling/scripts/acceptance-validate.py",
            "_foundation_candidate_acceptance_validate",
        )
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            source = source_identity(REPO_ROOT)
            run = store.begin_run(GATE_ID, source=source)
            try:
                FoundationCandidateProducer(
                    _adapters(RecordingAdapter())
                ).produce(run)
                acceptance_run.emit_agent_v2_candidate_metadata(
                    run,
                    GATE_ID,
                    source,
                )
                run.finalize(
                    result={
                        "status": "passed",
                        "completionStatus": "DONE",
                        "proofStatus": "CANDIDATE",
                    }
                )
                candidate_ref = run.manifest_ref
            finally:
                run.close()

            validated = validator.validate_candidate(
                store,
                candidate_ref,
                candidate_ref.sha256,
            )
            self.assertEqual(
                validated["candidate"]["result"]["proofStatus"],
                "CANDIDATE",
            )
            self.assertEqual(
                set(validated["roles"]),
                set(acceptance_run.load_agent_v2_contract()["gates"][GATE_ID]["roles"]),
            )

    def test_unobserved_tuple_fails_before_evidence_write(self) -> None:
        def unobserve(
            runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            if runtime_tuple.row == "foundation-desktop-direct":
                return FoundationTupleObservation(
                    tuple_key=observation.tuple_key,
                    observed=False,
                    passed=observation.passed,
                    runtime_attestation=observation.runtime_attestation,
                    role_observations=observation.role_observations,
                )
            return observation

        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            run = store.begin_run(GATE_ID, source=source_identity(REPO_ROOT))
            try:
                with self.assertRaisesRegex(
                    FoundationCandidateError, "tuple was not observed"
                ):
                    FoundationCandidateProducer(
                        _adapters(RecordingAdapter(unobserve))
                    ).produce(run)
                self.assertEqual(run.collect_existing_artifacts(), {})
            finally:
                run.close()

    def test_missing_and_not_applicable_roles_fail_closed(self) -> None:
        def remove_role(
            _runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            roles = dict(observation.role_observations)
            roles.pop("cleanup")
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=observation.runtime_attestation,
                role_observations=roles,
            )

        with self.assertRaisesRegex(FoundationCandidateError, "missing=.*cleanup"):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(remove_role))
            ).collect()

        def add_not_applicable_role(
            runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            if runtime_tuple.runtime_attestation_profile != "contract_only":
                return observation
            roles = dict(observation.role_observations)
            roles["receiver-dom"] = {
                "scenarioId": runtime_tuple.cell,
                "cellId": runtime_tuple.cell,
                "selector": "[data-agent-message]",
                "locale": runtime_tuple.locale,
                "textHash": HASH,
                "visible": True,
            }
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=observation.runtime_attestation,
                role_observations=roles,
            )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "unexpected=.*receiver-dom",
        ):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(add_not_applicable_role))
            ).collect()

    def test_unexpected_tuple_and_runtime_profile_fail_closed(self) -> None:
        def replace_key(
            _runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            return FoundationTupleObservation(
                tuple_key='["unexpected"]',
                observed=True,
                passed=True,
                runtime_attestation=observation.runtime_attestation,
                role_observations=observation.role_observations,
            )

        with self.assertRaisesRegex(FoundationCandidateError, "identity mismatch"):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(replace_key))
            ).collect()

        def replace_profile(
            runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            if runtime_tuple.runtime_attestation_profile != "contract_only":
                return observation
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=FoundationRuntimeAttestation(
                    "direct_runtime",
                    observation.runtime_attestation.payload,
                ),
                role_observations=observation.role_observations,
            )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "runtime attestation profile mismatch",
        ):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(replace_profile))
            ).collect()

    def test_browser_no_local_capability_profile_rejects_local_authority(
        self,
    ) -> None:
        def add_local_capability(
            runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            if (
                runtime_tuple.runtime_attestation_profile
                != "direct_runtime_no_local_capability"
            ):
                return observation
            payload = dict(observation.runtime_attestation.payload)
            session = dict(payload["clientSession"])
            session["capabilities"] = [
                {
                    "capabilityId": "fabricated",
                    "schemaVersion": "1",
                    "permission": "granted",
                    "constraints": {
                        "maxRequestBytes": 1,
                        "maxResultBytes": 1,
                        "allowedResourceKinds": ["text"],
                    },
                }
            ]
            payload["clientSession"] = session
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=FoundationRuntimeAttestation(
                    observation.runtime_attestation.profile,
                    payload,
                ),
                role_observations=observation.role_observations,
            )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "client capabilities mismatch",
        ):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(add_local_capability))
            ).collect()

    def test_browser_no_local_capability_profile_rejects_tool_call(
        self,
    ) -> None:
        def add_tool_call(
            runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            if (
                runtime_tuple.runtime_attestation_profile
                != "direct_runtime_no_local_capability"
            ):
                return observation
            payload = dict(observation.runtime_attestation.payload)
            payload["toolCallBinding"] = {"toolCallId": "fabricated"}
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=FoundationRuntimeAttestation(
                    observation.runtime_attestation.profile,
                    payload,
                ),
                role_observations=observation.role_observations,
            )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "payload fields mismatch",
        ):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(add_tool_call))
            ).collect()

    def test_duplicate_tuple_and_matrix_hash_mismatch_fail_closed(self) -> None:
        runtime_tuple = load_foundation_tuples()[0]
        with mock.patch(
            "tooling.acceptance.gates.agent.foundation_candidate_producer."
            "load_foundation_tuples",
            return_value=(runtime_tuple, runtime_tuple),
        ):
            with self.assertRaisesRegex(FoundationCandidateError, "duplicate"):
                FoundationCandidateProducer(
                    _adapters(RecordingAdapter())
                ).collect()

        with tempfile.NamedTemporaryFile() as matrix:
            matrix.write(b"not the reviewed matrix")
            matrix.flush()
            with mock.patch(
                "tooling.acceptance.gates.agent.foundation_candidate_producer."
                "MATRIX_PATH",
                Path(matrix.name),
            ):
                with self.assertRaisesRegex(
                    FoundationCandidateError, "SHA-256 mismatch"
                ):
                    load_foundation_tuples()

    def test_secret_bearing_adapter_evidence_is_rejected(self) -> None:
        def inject_secret(
            _runtime_tuple: FoundationTuple,
            observation: FoundationTupleObservation,
        ) -> FoundationTupleObservation:
            roles = {
                role: dict(payload)
                for role, payload in observation.role_observations.items()
            }
            roles["receiver-dom"]["api_key"] = "must-not-be-persisted"
            return FoundationTupleObservation(
                tuple_key=observation.tuple_key,
                observed=True,
                passed=True,
                runtime_attestation=observation.runtime_attestation,
                role_observations=roles,
            )

        with self.assertRaisesRegex(
            FoundationCandidateError, "secret-bearing evidence field"
        ):
            FoundationCandidateProducer(
                _adapters(RecordingAdapter(inject_secret))
            ).collect()

    def test_token_accounting_fields_are_not_treated_as_credentials(self) -> None:
        _ensure_evidence_safe(
            {
                "details": {
                    "actual_tokens": "128",
                    "limit_tokens": "64",
                },
                "limits": {
                    "contextTokens": 128000,
                    "outputTokens": 8192,
                },
                "tokenUsage": {
                    "input_tokens": 8,
                    "output_tokens": 3,
                },
                "tokenAccountingPresent": True,
            },
            "runtimeAttestation",
        )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "secret-bearing evidence field",
        ):
            _ensure_evidence_safe(
                {"details": {"api_token": "must-not-be-persisted"}},
                "runtimeAttestation",
            )

    def test_credential_status_is_safe_but_its_value_is_still_scanned(self) -> None:
        _ensure_evidence_safe(
            {"credentialStatus": "not_configured"},
            "station-readback",
        )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "secret-bearing evidence value",
        ):
            _ensure_evidence_safe(
                {"credentialStatus": "api_key=must-not-be-persisted"},
                "station-readback",
            )

    def test_object_path_hash_is_not_treated_as_secret(self) -> None:
        _ensure_evidence_safe(
            {"deletionReadback": {"objectPathHash": "0" * 64}},
            "cleanup",
        )

    def test_topic_label_is_safe_but_bare_key_is_rejected(self) -> None:
        _ensure_evidence_safe(
            {"topics": {"alpha": {"topicLabel": "alpha"}}},
            "station-readback",
        )

        with self.assertRaisesRegex(
            FoundationCandidateError,
            "secret-bearing evidence field",
        ):
            _ensure_evidence_safe(
                {"topics": {"alpha": {"key": "alpha"}}},
                "station-readback",
            )

    def test_wrong_gate_or_source_identity_is_rejected_before_collection(self) -> None:
        adapter = RecordingAdapter()
        producer = FoundationCandidateProducer(_adapters(adapter))
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory), worktree=REPO_ROOT)
            wrong_gate = store.begin_run(
                "agent-v2-home-command-center-e2e",
                source=source_identity(REPO_ROOT),
            )
            try:
                with self.assertRaisesRegex(
                    FoundationCandidateError, "candidate run Gate"
                ):
                    producer.produce(wrong_gate)
                self.assertEqual(adapter.calls, [])
            finally:
                wrong_gate.close()

            wrong_source = store.begin_run(
                GATE_ID,
                source={
                    "commit": "0" * 40,
                    "workspaceDigest": "invalid",
                    "canonicalWorktreeHash": store.workspace_id,
                },
            )
            try:
                with self.assertRaisesRegex(
                    FoundationCandidateError, "source identity"
                ):
                    producer.produce(wrong_source)
                self.assertEqual(adapter.calls, [])
            finally:
                wrong_source.close()


if __name__ == "__main__":
    unittest.main()
