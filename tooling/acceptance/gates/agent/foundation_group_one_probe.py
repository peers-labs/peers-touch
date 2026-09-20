#!/usr/bin/env python3
"""Matrix-driven runtime dispatcher for Foundation Group 1 scenarios."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any, Protocol

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationTuple,
    FoundationTupleObservation,
    load_foundation_tuples,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeFoundationAdapter,
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_base_attachment_rejected,
    evaluate_base_approval_expired,
    evaluate_base_approval_denied,
    evaluate_base_active_mutation_conflict,
    evaluate_base_cancelled,
    evaluate_base_context_overflow,
    evaluate_base_credential_missing,
    evaluate_base_duplicate_conflict,
    evaluate_base_executor_unavailable,
    evaluate_base_forbidden_actor,
    evaluate_base_incompatible_capability,
    evaluate_base_interrupted,
    evaluate_base_invalid_reference,
    evaluate_base_invalid_resource_reference,
    evaluate_base_lease_expired,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
    evaluate_as_f06,
    evaluate_as_f07,
    evaluate_as_f10,
    evaluate_as_f12,
)


GROUP_ONE_CELLS = frozenset(
    {
        "AS-F01",
        "AS-F02",
        "AS-F03",
        "AS-F04",
        "AS-F05",
        "AS-F06",
        "AS-F07",
        "AS-F08",
        "AS-F09",
        "AS-F10",
        "AS-F12",
    }
)
GROUP_ONE_ROWS = frozenset(
    {
        "foundation-desktop-direct",
        "foundation-browser-direct",
    }
)
EXPECTED_GROUP_ONE_TUPLES = 44


class GroupOneProbeError(RuntimeError):
    """The Group 1 runtime capture is incomplete or inconsistent."""


class HarnessClient(Protocol):
    def harness(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        timeout: float = 120,
    ) -> Any: ...


ScenarioProbe = Callable[
    [HarnessClient, DirectRuntimeProbeInput],
    Mapping[str, Any],
]


def group_one_tuples() -> tuple[FoundationTuple, ...]:
    tuples = tuple(
        item
        for item in load_foundation_tuples()
        if item.row in GROUP_ONE_ROWS and item.cell in GROUP_ONE_CELLS
    )
    if len(tuples) != EXPECTED_GROUP_ONE_TUPLES:
        raise GroupOneProbeError(
            "Foundation Group 1 matrix changed: "
            f"expected {EXPECTED_GROUP_ONE_TUPLES}, got {len(tuples)}"
        )
    return tuples


class FoundationGroupOneProbeRunner:
    def __init__(
        self,
        *,
        desktop_native: HarnessClient,
        browser: HarnessClient,
    ) -> None:
        self._clients = {
            "desktop_app": desktop_native,
            "browser": browser,
        }

    def collect(
        self,
        scenario_probe: ScenarioProbe,
    ) -> tuple[tuple[FoundationTuple, FoundationTupleObservation], ...]:
        captures: dict[tuple[str, str, str, str], Mapping[str, Any]] = {}
        tuples = group_one_tuples()
        for runtime_tuple in tuples:
            client = self._clients.get(runtime_tuple.platform)
            if client is None:
                raise GroupOneProbeError(
                    f"{runtime_tuple.key}: no client for {runtime_tuple.platform}"
                )
            locale = client.harness(
                "setFoundationLocale",
                {"locale": runtime_tuple.locale},
            )
            if (
                not isinstance(locale, Mapping)
                or locale.get("locale") != runtime_tuple.locale
            ):
                raise GroupOneProbeError(
                    f"{runtime_tuple.key}: receiver locale did not converge"
                )
            probe_input = DirectRuntimeProbeInput(
                platform=runtime_tuple.platform,
                locale=runtime_tuple.locale,
                cell=runtime_tuple.cell,
                sample_id=runtime_tuple.sample_id,
            )
            capture = scenario_probe(client, probe_input)
            if not isinstance(capture, Mapping):
                raise GroupOneProbeError(
                    f"{runtime_tuple.key}: scenario returned no capture"
                )
            self._assert_scenario_facts(runtime_tuple, capture)
            captures[self._capture_key(probe_input)] = dict(capture)

        adapter = DirectRuntimeFoundationAdapter(
            lambda probe_input: captures[self._capture_key(probe_input)]
        )
        observations = []
        for runtime_tuple in tuples:
            if runtime_tuple.row == "foundation-desktop-direct":
                observation = adapter.observe_desktop_native(runtime_tuple)
            else:
                observation = adapter.observe_browser(runtime_tuple)
            observations.append((runtime_tuple, observation))
        return tuple(observations)

    @staticmethod
    def _capture_key(
        probe_input: DirectRuntimeProbeInput,
    ) -> tuple[str, str, str, str]:
        return (
            probe_input.platform,
            probe_input.locale,
            probe_input.cell,
            probe_input.sample_id,
        )

    @staticmethod
    def _assert_scenario_facts(
        runtime_tuple: FoundationTuple,
        capture: Mapping[str, Any],
    ) -> None:
        assert_group_one_capture(
            DirectRuntimeProbeInput(
                platform=runtime_tuple.platform,
                locale=runtime_tuple.locale,
                cell=runtime_tuple.cell,
                sample_id=runtime_tuple.sample_id,
            ),
            capture,
        )


def assert_group_one_capture(
    probe_input: DirectRuntimeProbeInput,
    capture: Mapping[str, Any],
) -> None:
    evaluators = {
        "BASE-ATTACHMENT_REJECTED": (
            lambda facts: evaluate_base_attachment_rejected(facts)
        ),
        "BASE-APPROVAL_EXPIRED": (
            lambda facts: evaluate_base_approval_expired(facts)
        ),
        "BASE-APPROVAL_DENIED": (
            lambda facts: evaluate_base_approval_denied(facts)
        ),
        "BASE-ACTIVE_MUTATION_CONFLICT": (
            lambda facts: evaluate_base_active_mutation_conflict(facts)
        ),
        "BASE-CANCELLED": (
            lambda facts: evaluate_base_cancelled(facts)
        ),
        "BASE-CONTEXT_OVERFLOW": (
            lambda facts: evaluate_base_context_overflow(facts)
        ),
        "BASE-CREDENTIAL_MISSING": (
            lambda facts: evaluate_base_credential_missing(facts)
        ),
        "BASE-DUPLICATE_CONFLICT": (
            lambda facts: evaluate_base_duplicate_conflict(facts)
        ),
        "BASE-EXECUTOR_UNAVAILABLE": (
            lambda facts: evaluate_base_executor_unavailable(facts)
        ),
        "BASE-FORBIDDEN_ACTOR": (
            lambda facts: evaluate_base_forbidden_actor(facts)
        ),
        "BASE-INCOMPATIBLE_CAPABILITY": (
            lambda facts: evaluate_base_incompatible_capability(facts)
        ),
        "BASE-INTERRUPTED": (
            lambda facts: evaluate_base_interrupted(facts)
        ),
        "BASE-INVALID_REFERENCE": (
            lambda facts: evaluate_base_invalid_reference(facts)
        ),
        "BASE-INVALID_RESOURCE_REF": (
            lambda facts: evaluate_base_invalid_resource_reference(facts)
        ),
        "BASE-LEASE_EXPIRED": (
            lambda facts: evaluate_base_lease_expired(facts)
        ),
        "AS-F02": lambda facts: evaluate_as_f02(facts),
        "AS-F03": lambda facts: evaluate_as_f03(facts),
        "AS-F04": lambda facts: evaluate_as_f04(
            facts,
            platform=probe_input.platform,
        ),
        "AS-F05": lambda facts: evaluate_as_f05(facts),
        "AS-F06": lambda facts: evaluate_as_f06(
            facts,
            platform=probe_input.platform,
            locale=probe_input.locale,
            sample_id=probe_input.sample_id,
        ),
        "AS-F07": lambda facts: evaluate_as_f07(facts),
        "AS-F10": lambda facts: evaluate_as_f10(
            facts,
            platform=probe_input.platform,
        ),
        "AS-F12": lambda facts: evaluate_as_f12(
            facts,
            platform=probe_input.platform,
            locale=probe_input.locale,
            sample_id=probe_input.sample_id,
        ),
    }
    evaluator = evaluators.get(probe_input.cell)
    if evaluator is None:
        return
    scenario_facts = capture.get("scenarioFacts")
    assertions = capture.get("assertions")
    if not isinstance(scenario_facts, Mapping):
        raise GroupOneProbeError(
            f"{probe_input.cell} capture must contain scenarioFacts"
        )
    if not isinstance(assertions, Mapping):
        raise GroupOneProbeError(
            f"{probe_input.cell} capture must contain assertions"
        )
    if probe_input.cell in {
        "BASE-ATTACHMENT_REJECTED",
        "BASE-CANCELLED",
        "BASE-CONTEXT_OVERFLOW",
        "BASE-CREDENTIAL_MISSING",
        "BASE-DUPLICATE_CONFLICT",
        "BASE-FORBIDDEN_ACTOR",
        "BASE-INCOMPATIBLE_CAPABILITY",
        "BASE-INTERRUPTED",
        "BASE-INVALID_REFERENCE",
        "BASE-INVALID_RESOURCE_REF",
        "BASE-LEASE_EXPIRED",
    }:
        runtime_event = scenario_facts.get("runtimeEvent")
        runtime_role = capture.get("runtime-events")
        if not isinstance(runtime_event, Mapping) or not isinstance(
            runtime_role,
            Mapping,
        ):
            raise GroupOneProbeError(
                f"{probe_input.cell} runtime event evidence is missing"
            )
        expected_role = {
            "eventId": runtime_event.get("eventId"),
            "sequence": runtime_event.get("sequence"),
            "eventType": runtime_event.get("eventType"),
            "occurredAt": runtime_event.get("observedAt"),
            "streamGeneration": runtime_event.get("streamGeneration"),
            "streamIdHash": runtime_event.get("streamIdHash"),
            "conversationIdHash": runtime_event.get("conversationIdHash"),
            "payloadHash": runtime_event.get("payloadHash"),
            "errorType": runtime_event.get("errorType"),
        }
        if probe_input.cell in {
            "BASE-CANCELLED",
            "BASE-CONTEXT_OVERFLOW",
            "BASE-CREDENTIAL_MISSING",
            "BASE-DUPLICATE_CONFLICT",
            "BASE-FORBIDDEN_ACTOR",
            "BASE-INCOMPATIBLE_CAPABILITY",
            "BASE-INTERRUPTED",
            "BASE-INVALID_REFERENCE",
            "BASE-INVALID_RESOURCE_REF",
            "BASE-LEASE_EXPIRED",
        }:
            expected_role.update(
                {
                    "sourceTransport": runtime_event.get("sourceTransport"),
                    "sourcePtidHash": runtime_event.get("sourcePtidHash"),
                    "sourceConversationId": runtime_event.get(
                        "sourceConversationId"
                    ),
                    "sourceTurnId": runtime_event.get("sourceTurnId"),
                    "sourceSequence": runtime_event.get("sourceSequence"),
                    "sourceEventType": runtime_event.get("sourceEventType"),
                }
            )
            runtime_attestation = capture.get("runtimeAttestation")
            if (
                not isinstance(runtime_attestation, Mapping)
                or expected_role["sourcePtidHash"]
                != runtime_attestation.get("actorIdentityHash")
            ):
                raise GroupOneProbeError(
                    f"{probe_input.cell} runtime source actor does not match "
                    "the runtime attestation"
                )
        if dict(runtime_role) != expected_role:
            raise GroupOneProbeError(
                f"{probe_input.cell} runtime-events role does not "
                "match the observed terminal event"
            )
    try:
        evaluated = evaluator(scenario_facts)
    except GroupOneScenarioError as error:
        raise GroupOneProbeError(str(error)) from error
    normalized_assertions = {
        key: value
        for key, value in dict(assertions).items()
        if value is not None
    }
    normalized_evaluated = {
        key: value
        for key, value in evaluated.items()
        if value is not None
    }
    if normalized_assertions != normalized_evaluated:
        mismatches = _assertion_mismatch_diagnostics(
            normalized_assertions,
            normalized_evaluated,
        )
        raise GroupOneProbeError(
            f"{probe_input.cell} assertions do not match production scenario facts: "
            f"mismatches={mismatches}"
        )
    deferred_capture = {
        key for key, value in dict(assertions).items() if value is None
    }
    deferred_evaluated = {
        key for key, value in evaluated.items() if value is None
    }
    if deferred_capture != deferred_evaluated:
        mismatches = _assertion_mismatch_diagnostics(
            {key: None for key in deferred_capture},
            {key: None for key in deferred_evaluated},
        )
        raise GroupOneProbeError(
            f"{probe_input.cell} deferred keys mismatch: "
            f"mismatches={mismatches}"
        )


def _assertion_mismatch_diagnostics(
    capture: Mapping[str, Any],
    evaluated: Mapping[str, Any],
) -> str:
    mismatches = [
        {
            "key": key,
            "capture": _redacted_assertion_value(capture.get(key)),
            "evaluated": _redacted_assertion_value(evaluated.get(key)),
        }
        for key in sorted(set(capture) | set(evaluated))
        if key not in capture
        or key not in evaluated
        or capture[key] != evaluated[key]
    ]
    return json.dumps(mismatches, sort_keys=True, separators=(",", ":"))


def _redacted_assertion_value(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None
