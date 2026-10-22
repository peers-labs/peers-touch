"""Business-owned bindings for native release operation evidence."""

from __future__ import annotations

from typing import Any, Mapping

from tooling.acceptance.core import ArtifactRef, EvidenceError, EvidenceStore, GateError

JOURNEY_IDS = (
    "first-launch-and-login",
    "station-and-relay-choice",
    "federation-lifecycle",
    "find-person-and-friend",
    "direct-and-group-chat",
    "attachments-and-recovery",
    "moments-publish-and-interact",
    "settings-and-account",
    "restart-and-return",
)
PLATFORMS = ("desktop-macos", "ios-simulator")
REQUIRED_JOURNEYS = tuple((journey, platform) for journey in JOURNEY_IDS for platform in PLATFORMS)
RUNTIME_CELLS = {"desktop-macos": "desktop-macos-native", "ios-simulator": "ios-simulator-native"}
MANIFEST_CELLS = {
    "desktop-macos-native": {"desktop-macos-native"},
    "ios-simulator": {"ios-simulator-native"},
    "ios-simulator-native": {"ios-simulator-native"},
    "dual-ios-simulator": {"ios-simulator-native"},
    "desktop-macos-native+ios-simulator": {"desktop-macos-native", "ios-simulator-native"},
}
RECEIVER_JOURNEYS = {
    "direct-and-group-chat", "attachments-and-recovery", "moments-publish-and-interact",
}


def validate_journey_set(journeys: object) -> list[Mapping[str, Any]]:
    if not isinstance(journeys, list) or len(journeys) != len(REQUIRED_JOURNEYS):
        raise GateError("operation analysis report has incomplete journey coverage")
    seen = set()
    for journey in journeys:
        if not isinstance(journey, Mapping):
            raise GateError("operation journey must be an object")
        key = (journey.get("journeyId"), journey.get("platform"))
        if key not in REQUIRED_JOURNEYS or key in seen or journey.get("completed") is not True:
            raise GateError("operation journey coverage is invalid or duplicated")
        seen.add(key)
        steps = journey.get("steps")
        if not isinstance(steps, list) or not steps or any(
            not isinstance(step, str) or not step.strip() for step in steps
        ):
            raise GateError("operation journey has no actual steps")
        if not isinstance(journey.get("traceSegmentId"), str) or not journey["traceSegmentId"]:
            raise GateError("operation journey has no trace segment binding")
    return journeys


def validate_trace_binding(
    store: EvidenceStore,
    journey: Mapping[str, Any],
    *,
    expected_source: Mapping[str, str],
) -> None:
    try:
        trace_ref = ArtifactRef.from_dict(journey["interactionTrace"]["artifact"])
        screenshot_ref = ArtifactRef.from_dict(journey["screenshot"]["artifact"])
        trace = store.read_json(trace_ref)
        manifest = store.read_json(ArtifactRef.from_dict(journey["interactionTrace"]["runManifest"]))
        screenshot_manifest = store.read_json(ArtifactRef.from_dict(journey["screenshot"]["runManifest"]))
    except (EvidenceError, KeyError, TypeError, ValueError) as error:
        raise GateError("operation trace binding is unavailable or malformed") from error
    if trace_ref.media_type != "application/json" or screenshot_ref.media_type not in {
        "image/png", "image/jpeg",
    }:
        raise GateError("operation trace/screenshot media type is invalid")
    if (
        trace.get("artifactKind") != "release-operation-interaction-trace"
        or trace.get("source") != dict(expected_source)
        or not isinstance(trace.get("segments"), list)
    ):
        raise GateError("operation trace has no current native segment map")
    segments = [segment for segment in trace["segments"] if isinstance(segment, Mapping)
                and segment.get("segmentId") == journey.get("traceSegmentId")]
    if len(segments) != 1:
        raise GateError("operation trace segment is missing or ambiguous")
    segment = segments[0]
    expected_cell = RUNTIME_CELLS[journey["platform"]]
    for native_manifest in (manifest, screenshot_manifest):
        cell = native_manifest.get("result", {}).get("runtimeCell")
        if expected_cell not in MANIFEST_CELLS.get(cell, set()):
            raise GateError("operation evidence run does not contain the required native platform")
    if not isinstance(segment.get("screenshots"), list):
        raise GateError("operation trace segment has no screenshot map")
    if (
        segment.get("journeyId") != journey["journeyId"]
        or segment.get("platform") != journey["platform"]
        or segment.get("runtimeCell") != RUNTIME_CELLS[journey["platform"]]
        or segment.get("steps") != journey["steps"]
        or screenshot_ref.to_dict() not in segment.get("screenshots", [])
    ):
        raise GateError("operation trace segment does not match Journey/platform/steps/screenshot")
    actions = segment.get("actions")
    assertions = segment.get("assertions")
    if not isinstance(actions, list) or not actions or not isinstance(assertions, list) or not assertions:
        raise GateError("operation trace segment has no actions or visible assertions")
    steps = set()
    for item in actions + assertions:
        if not isinstance(item, Mapping):
            raise GateError("operation trace observation is malformed")
        index = item.get("stepIndex")
        if (
            isinstance(index, bool) or not isinstance(index, int)
            or not 0 <= index < len(journey["steps"])
            or item.get("status") != "passed"
            or not isinstance(item.get("observation"), str) or not item["observation"].strip()
        ):
            raise GateError("operation trace observation has invalid step/result")
        steps.add(index)
    if steps != set(range(len(journey["steps"]))) or any(
        item.get("kind") != "ui-action" for item in actions
    ):
        raise GateError("operation trace does not cover the actual UI steps")
    if not any(item.get("kind") == "ui-visible" for item in assertions):
        raise GateError("operation trace has no native UI visible result")
    if journey["journeyId"] in RECEIVER_JOURNEYS and not any(
        item.get("kind") == "receiver-visible" for item in assertions
    ):
        raise GateError("operation trace has no receiver visible result")
