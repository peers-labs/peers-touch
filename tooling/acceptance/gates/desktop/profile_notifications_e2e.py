"""Attach-only consumer of the parent-owned Profile and notification Suite."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, EphemeralGateClient, GateError, REPO_ROOT, load_runtime_manifest
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.core.suite_runtime import RuntimeReuseContract, validate_suite_runtime_report
from tooling.acceptance.fixtures.desktop_profile_contract import (
    CAPABILITY_ID, GATE_ID, RUNTIME_REUSE, SCENARIO_IDS,
)


class DesktopProfileNotificationsGate(AcceptanceGate):
    gate_id = GATE_ID
    bom = ("Desktop Native", "Station Actor profile", "Station Social", "Station notifications")
    spec = ("DUI-C1-C9",)

    def run(self) -> dict[str, Any]:
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
        client = EphemeralGateClient.from_environment()
        if client is None:
            raise GateError("Profile and notification proof requires its parent-owned Suite")
        try:
            response = client.invoke(CAPABILITY_ID, "run-suite", {}, timeout_seconds=1800)
        finally:
            client.close()
        reference = ArtifactRef.from_dict(response.get("suiteResult"))
        if reference.gate_id != GATE_ID or reference.run_id != os.environ.get("PT_ACCEPTANCE_RUN_ID"):
            raise GateError("Suite result does not belong to the current proof run")
        store = EvidenceStore.from_environment(repo_root=REPO_ROOT)
        suite = store.read_json(reference)
        self.assert_condition(
            "source_bound_native_suite",
            suite["result"] == "PASS" and suite["source"] == manifest["source"],
        )
        runtime = validate_suite_runtime_report(suite["suiteRuntime"])
        self.assert_condition(
            "attach_only_two_client_reuse",
            RuntimeReuseContract.from_dict(runtime["contract"]) == RUNTIME_REUSE
            and runtime["sourceDigest"] == manifest["source"]["commit"]
            and runtime["metrics"]["clientLaunches"] == 2,
        )
        children = suite["scenarios"]
        self.assert_condition("complete_scenario_generation", set(children) == set(SCENARIO_IDS))
        actors_reference = ArtifactRef.from_dict(suite["actorManifest"])
        if actors_reference.run_id != reference.run_id or actors_reference.gate_id != GATE_ID:
            raise GateError("Actor manifest does not belong to this Suite")
        actors = store.read_json(actors_reference)["actors"]
        self.assert_condition(
            "distinct_authenticated_native_actors",
            set(actors) == {"receiver", "sender"}
            and bool(actors["receiver"]["ptid"]) and bool(actors["sender"]["ptid"])
            and actors["receiver"]["ptid"] != actors["sender"]["ptid"],
        )
        self.report.actors = {
            role: {"name": role, "runtime": "native-tauri", **actor}
            for role, actor in actors.items()
        }
        for index in range(1, 10):
            scenario = SCENARIO_IDS[0 if index <= 6 else 1]
            self.assert_condition(f"C{index}", children[scenario]["assertions"].get(f"C{index}") is True)
        preferences = children[SCENARIO_IDS[0]]["assertions"]["categoryPreferences"]
        self.assert_condition(
            "all_category_preferences_persist",
            set(preferences) == {"social", "chat", "system", "task"}
            and all(all(value.values()) for value in preferences.values()),
        )
        self.assert_condition(
            "sender_sees_acceptance_notification",
            children[SCENARIO_IDS[1]].get("senderAcceptanceVisible") is True,
        )
        self.assert_condition(
            "native_resources_released",
            suite["cleanup"]["originalProcessIdsReleased"] is True
            and not suite["cleanup"].get("cleanupErrors"),
        )
        return {
            "suiteResult": reference.to_dict(),
            "suiteRuntime": runtime,
            "suiteRuntimeRef": suite["suiteRuntimeRef"],
            "clientBindingProofs": suite["clientBindingProofs"],
            "actorManifest": suite["actorManifest"],
            "cleanup": suite["cleanup"],
            "evidence": suite["screenshots"],
        }


if __name__ == "__main__":
    raise SystemExit(DesktopProfileNotificationsGate().execute())
