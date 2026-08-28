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
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
    evaluate_as_f10,
)


GROUP_ONE_CELLS = frozenset(
    {
        "AS-F01",
        "AS-F02",
        "AS-F03",
        "AS-F04",
        "AS-F05",
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
EXPECTED_GROUP_ONE_TUPLES = 40


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
        "AS-F02": lambda facts: evaluate_as_f02(facts),
        "AS-F03": lambda facts: evaluate_as_f03(facts),
        "AS-F04": lambda facts: evaluate_as_f04(
            facts,
            platform=probe_input.platform,
        ),
        "AS-F05": lambda facts: evaluate_as_f05(facts),
        "AS-F10": lambda facts: evaluate_as_f10(
            facts,
            platform=probe_input.platform,
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
