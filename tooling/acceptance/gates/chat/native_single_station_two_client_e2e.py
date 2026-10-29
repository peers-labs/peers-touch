#!/usr/bin/env python3
"""Fail-closed validator for the same-Station Local Direct Chat report."""

from __future__ import annotations

import sys
from typing import Any

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.native_support import runtime_station_service
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
    write_validation,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
    SINGLE_STATION_GATE_ID,
)


GATE_ID = SINGLE_STATION_GATE_ID


def validate_same_station_scope(report: dict[str, Any]) -> None:
    manifest = report.get("manifest")
    require(isinstance(manifest, dict), "runtime manifest is required")
    alice_station = runtime_station_service(manifest, "alice")
    bob_station = runtime_station_service(manifest, "bob")
    require(
        alice_station.get("runtimeIdentity")
        and alice_station.get("runtimeIdentity")
        == bob_station.get("runtimeIdentity"),
        "same-Station Direct requires both actors on one Home Station",
    )
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    require(
        runtime.get("directScope") == "local",
        "same-Station Direct must be classified as Local scope",
    )


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=REQUIRED_STEPS,
        required_assertions=REQUIRED_ASSERTIONS,
    )
    validate_same_station_scope(report)
    validation_ref = write_validation(
        report,
        source_ref=source_ref,
        gate_id=GATE_ID,
        required_assertions=REQUIRED_ASSERTIONS,
    )
    print("Chat Native Same-Station Two-Client E2E")
    print("======================================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            f"chat native same-station two-client validation failed: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1)
