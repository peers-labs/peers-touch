from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILES = frozenset({"four", "fiveArm"})
EXPECTED_CLIENTS = frozenset(
    {
        "secure-content-hardcut-four-alice",
        "secure-content-hardcut-four-bob",
        "secure-content-hardcut-four-eve",
    }
)
FIXTURE_CAPABILITY = "secure-content-hardcut"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
DESKTOP_ACCEPTANCE_IDS = frozenset(
    {
        "SOC-SEC-AS01",
        "SOC-SEC-AS02",
        "SOC-SEC-AS03",
        "SOC-SEC-AS04",
        "SOC-SEC-AS05",
        "SOC-SEC-AS06",
        "SOC-SEC-AS07",
        "SOC-SEC-AS08",
        "SOC-SEC-AS09",
        "SOC-SEC-AS12",
        "SOC-SEC-AS13",
        "SOC-SEC-AS15",
        "SOC-SEC-AS16",
    }
)
UOW_BOUNDARIES = frozenset(
    {
        "post-plan",
        "post-fact",
        "post-audience-snapshot",
        "post-slot-mapping",
        "post-endpoint-envelopes",
        "post-recovery-envelopes",
        "post-delivery-intents",
        "post-object-attachment",
        "post-object-grants",
        "post-command-receipt",
        "comment-fact",
        "comment-dependent-mutations",
        "irreversible-prekey-replay",
        "conflicting-command-hash",
    }
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _require_digests(value: Any, label: str) -> tuple[str, ...]:
    _require(isinstance(value, list) and bool(value), f"{label} is missing")
    digests = tuple(str(item) for item in value)
    _require(
        all(SHA256.fullmatch(item) is not None for item in digests),
        f"{label} contains an invalid digest",
    )
    _require(len(set(digests)) == len(digests), f"{label} contains duplicates")
    return digests


def _require_runtime_binding(
    context: ScenarioContext,
    *,
    expected_clients: frozenset[str],
    expected_profiles: frozenset[str],
) -> None:
    if context.runtime != "desktop":
        raise RunnerError("hardcut-regression requires the desktop runtime")
    if set(context.profiles) != expected_profiles:
        raise RunnerError(
            "hardcut-regression received the wrong profile set"
        )
    if frozenset(context.clients) != expected_clients:
        raise RunnerError(
            "hardcut-regression requires the exact Desktop client set"
        )
    manifest = context.require_runtime_manifest()
    for client_id in context.clients:
        client = manifest.client(client_id)
        role = client_id.rsplit("-", 1)[-1]
        _require(
            client.get("runtime_kind") == "native-tauri"
            and client.get("actor_role") == role,
            f"hardcut-regression client {client_id!r} binding is invalid",
        )


def _invoke(
    context: ScenarioContext,
    fixture_capability: str,
    workstream: str,
    operation: str,
) -> Mapping[str, Any]:
    acknowledgement = context.invoke_fixture_action(
        fixture_capability,
        operation,
        {
            "workstream": workstream,
            "clients": list(context.clients),
            "profiles": list(context.profiles),
        },
    )
    outcome = acknowledgement.get("outcome")
    if not isinstance(outcome, Mapping):
        raise RunnerError(f"hardcut-regression {operation} outcome is invalid")
    _require(
        outcome.get("completed") is True,
        f"hardcut-regression {operation} did not complete",
    )
    _require(
        outcome.get("partialPrivateRows") == 0,
        f"hardcut-regression {operation} left partial private rows",
    )
    _require(
        outcome.get("publicFallbackUsed") is False,
        f"hardcut-regression {operation} used a PUBLIC fallback",
    )
    _require_digests(
        outcome.get("receiverObservationDigests"),
        f"hardcut-regression {operation} receiver observations",
    )
    return outcome


def execute_hardcut_regression(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str = FIXTURE_CAPABILITY,
    expected_clients: frozenset[str] = EXPECTED_CLIENTS,
    expected_profiles: frozenset[str] = EXPECTED_PROFILES,
) -> Mapping[str, Any]:
    _require_runtime_binding(
        context,
        expected_clients=expected_clients,
        expected_profiles=expected_profiles,
    )
    context.run_check(
        "hardcut-zero-reference",
        ["python3", "tooling/scripts/secure-content-hard-cut-check.py"],
        cwd=context.repo_root,
    )
    social = _invoke(context, fixture_capability, workstream, "full-social")
    _require(
        frozenset(social.get("coveredAcceptanceIds", ()))
        == DESKTOP_ACCEPTANCE_IDS,
        "hardcut-regression Desktop Social coverage is incomplete",
    )
    uow = _invoke(context, fixture_capability, workstream, "outer-uow")
    _require(
        frozenset(uow.get("coveredBoundaries", ())) == UOW_BOUNDARIES,
        "hardcut-regression outer UOW coverage is incomplete",
    )
    _require(
        uow.get("allOrNone") is True
        and uow.get("replayExact") is True
        and uow.get("conflictingHashTerminal") is True,
        "hardcut-regression outer UOW assertions are incomplete",
    )
    return {
        "observations": {
            "desktopAcceptanceIds": sorted(DESKTOP_ACCEPTANCE_IDS),
            "uowBoundaries": sorted(UOW_BOUNDARIES),
            "receiverObservationDigests": sorted(
                {
                    *_require_digests(
                        social.get("receiverObservationDigests"),
                        "hardcut-regression Social receiver observations",
                    ),
                    *_require_digests(
                        uow.get("receiverObservationDigests"),
                        "hardcut-regression UOW receiver observations",
                    ),
                }
            ),
        },
        "claimBoundary": {
            "productJourney": context.journey_id,
            "formalAcceptance": "NOT_RUN",
        },
    }


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_hardcut_regression(context, workstream="W11")


SCENARIO = ScenarioDefinition(
    scenario_id="hardcut-regression",
    journey_id="sc-dj-hardcut-regression",
    work_item_id="secure-content-w11",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W11/desktop/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W11"),
    result_task_id="W11",
    result_workstream_id="W11",
    result_variant="desktop",
)
