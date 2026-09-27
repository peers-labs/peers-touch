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
        "secure-content-browser-authenticated",
        "secure-content-browser-anonymous",
    }
)
FIXTURE_CAPABILITY = "secure-content-hardcut"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def execute_hardcut_browser_regression(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str = FIXTURE_CAPABILITY,
    expected_profiles: frozenset[str] = EXPECTED_PROFILES,
    expected_clients: frozenset[str] = EXPECTED_CLIENTS,
) -> Mapping[str, Any]:
    if context.runtime != "browser":
        raise RunnerError(
            "hardcut-browser-regression requires the browser runtime"
        )
    if set(context.profiles) != expected_profiles:
        raise RunnerError(
            "hardcut-browser-regression received the wrong profile set"
        )
    if frozenset(context.clients) != expected_clients:
        raise RunnerError(
            "hardcut-browser-regression requires the exact Browser clients"
        )
    manifest = context.require_runtime_manifest()
    expected_roles = {
        "secure-content-browser-authenticated": "browser_actor",
        "secure-content-browser-anonymous": "anonymous",
    }
    for client_id, actor_role in expected_roles.items():
        client = manifest.client(client_id)
        _require(
            client.get("runtime_kind") == "browser"
            and client.get("actor_role") == actor_role,
            f"hardcut-browser-regression client {client_id!r} binding is invalid",
        )

    acknowledgement = context.invoke_fixture_action(
        fixture_capability,
        "browser-boundary",
        {
            "workstream": workstream,
            "clients": list(context.clients),
            "profiles": list(context.profiles),
        },
    )
    outcome = acknowledgement.get("outcome")
    if not isinstance(outcome, Mapping):
        raise RunnerError(
            "hardcut-browser-regression browser-boundary outcome is invalid"
        )
    observation_digests = outcome.get("receiverObservationDigests")
    _require(
        outcome.get("completed") is True
        and outcome.get("publicControlReadable") is True
        and outcome.get("privatePublishState") == "PRIVATE_UNSUPPORTED"
        and outcome.get("privateReadState")
        == "PRIVATE_UNSUPPORTED_ON_DEVICE"
        and outcome.get("privateRequestCount") == 0
        and outcome.get("privateResponseCount") == 0
        and outcome.get("secretRepresentationCount") == 0
        and outcome.get("publicFallbackUsed") is False,
        "hardcut-browser-regression did not prove the Browser boundary",
    )
    _require(
        isinstance(observation_digests, list)
        and bool(observation_digests)
        and all(
            isinstance(digest, str) and SHA256.fullmatch(digest)
            for digest in observation_digests
        ),
        "hardcut-browser-regression receiver observations are invalid",
    )
    return {
        "observations": {
            "publicControlReadable": True,
            "privatePublishState": "PRIVATE_UNSUPPORTED",
            "privateReadState": "PRIVATE_UNSUPPORTED_ON_DEVICE",
            "receiverObservationDigests": sorted(set(observation_digests)),
        },
        "claimBoundary": {
            "productJourney": "sc-dj-browser-private-boundary",
            "formalAcceptance": "NOT_RUN",
        },
    }


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_hardcut_browser_regression(context, workstream="W11")


SCENARIO = ScenarioDefinition(
    scenario_id="hardcut-browser-regression",
    journey_id="sc-dj-browser-private-boundary",
    work_item_id="secure-content-w11",
    runtimes=frozenset({"browser"}),
    evidence_path=Path("W11/browser/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W11"),
    result_task_id="W11",
    result_workstream_id="W11",
    result_variant="browser",
)
