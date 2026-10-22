#!/usr/bin/env python3
"""Prove the SC-D30 host-neutral Secure Content operation contract."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError


GATE_ID = "secure-content-portable-core"
REPO_ROOT = Path(__file__).resolve().parents[4]

REQUIRED_SOURCE_MARKERS = {
    "src/operation/state.rs": (
        "pub enum OperationState",
        "pub fn acquire_operation",
        "pub fn complete_operation",
        "pub fn recover_interrupted_operation",
        "StaleSessionGeneration",
        "LostLease",
    ),
    "src/operation/prekey_maintenance.rs": (
        "pub fn plan_content_prekey_maintenance",
        "pub fn content_prekey_publication_command_id",
        "pub fn classify_content_prekey_publish",
        'CONTENT_PREKEY_PUBLICATION_COMMAND_PREFIX: &str = "cpk-pub-v1-"',
    ),
    "src/operation/reconciliation.rs": (
        "pub fn decide_unknown_outcome",
        "pub fn decide_committed_readback",
        "pub fn apply_readback_decision",
        "pub fn continue_recovery_envelope",
        "ReadbackObservation::AuthoritativeAbsent",
    ),
    "src/operation/outcome.rs": (
        "pub enum OperationOutcome",
        "pub struct OperationFailure",
    ),
    "src/ports/cancellation.rs": ("pub trait LifecycleCancellation",),
    "src/ports/clock.rs": ("pub trait OperationClock",),
    "src/ports/key_material.rs": ("pub trait ContentKeyMaterial",),
    "src/ports/store.rs": ("pub trait EncryptedOperationStore",),
    "src/ports/transport.rs": ("pub trait ContentPreKeyTransport",),
    "src/ports/blob.rs": ("pub trait ObjectBlob",),
}
FORBIDDEN_CORE_PATTERNS = {
    "HTTP client": re.compile(r"\b(reqwest|hyper|ureq)\b"),
    "SQL implementation": re.compile(r"\b(rusqlite|sqlx|diesel)\b"),
    "Tauri": re.compile(r"\btauri(?:::|[-_])"),
    "filesystem API": re.compile(r"\bstd::(?:fs|path)::"),
    "application implementation": re.compile(
        r"\b(?:apps|social|conversation)::"
    ),
}
INVENTORY_MARKERS = (
    "Desktop `PublicationState`",
    "Desktop `StoredPublication`",
    "Desktop `recover_orphaned_leases`",
    "Desktop `publication_command_id`",
    "Mobile `DurableState`",
    "Mobile `StoredPreKeyPublication`",
    "Mobile `unknown_submission_readback`",
    "secure-content-operation-v1",
    "There is no dual-write window.",
)
REQUIRED_PRODUCTION_CONSUMERS = {
    Path("apps/desktop/src-tauri/src/secure_content/prekey_runtime.rs"): (
        "secure_content_core::operation",
    ),
    Path("apps/desktop/src-tauri/src/secure_content/store.rs"): (
        "acquire_operation",
        "complete_operation",
        "apply_readback_decision",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/runtime.rs"): (
        "secure_content_core::operation",
        "decide_unknown_outcome",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/store.rs"): (
        "acquire_operation",
        "complete_operation",
        "apply_readback_decision",
    ),
}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise GateError(f"{path.relative_to(REPO_ROOT)} must contain an object")
    return value


def validate_portable_core(root: Path = REPO_ROOT) -> dict[str, object]:
    core_root = root / "packages" / "secure-content-core"
    missing: list[str] = []
    for relative, markers in REQUIRED_SOURCE_MARKERS.items():
        path = core_root / relative
        if not path.is_file():
            missing.append(relative)
            continue
        source = path.read_text(encoding="utf-8")
        missing.extend(
            f"{relative}:{marker}"
            for marker in markers
            if marker not in source
        )
    if missing:
        raise GateError(
            "Secure Content portable operation contract is incomplete: "
            + ", ".join(missing)
        )

    cargo = (core_root / "Cargo.toml").read_text(encoding="utf-8")
    rust_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((core_root / "src").rglob("*.rs"))
    )
    forbidden = [
        name
        for name, pattern in FORBIDDEN_CORE_PATTERNS.items()
        if pattern.search(cargo) or pattern.search(rust_sources)
    ]
    if forbidden:
        raise GateError(
            "Secure Content portable core imports forbidden owners: "
            + ", ".join(forbidden)
        )

    missing_consumers = [
        f"{relative}:{marker}"
        for relative, markers in REQUIRED_PRODUCTION_CONSUMERS.items()
        for marker in markers
        if marker not in (root / relative).read_text(encoding="utf-8")
    ]
    if missing_consumers:
        raise GateError(
            "UCA-05 production operation consumer contract is incomplete: "
            + ", ".join(missing_consumers)
        )

    integration = (
        root
        / "docs"
        / "architecture"
        / "shared"
        / "security"
        / "secure-content"
        / "integration.md"
    ).read_text(encoding="utf-8")
    missing_inventory = [
        marker for marker in INVENTORY_MARKERS if marker not in integration
    ]
    if missing_inventory:
        raise GateError(
            "Secure Content operation migration inventory is incomplete: "
            + ", ".join(missing_inventory)
        )

    return {
        "operationModules": len(REQUIRED_SOURCE_MARKERS),
        "forbiddenDependencyFindings": 0,
        "productionConsumers": len(REQUIRED_PRODUCTION_CONSUMERS),
        "inventoryMarkers": len(INVENTORY_MARKERS),
    }


def validate_acceptance_trace(root: Path = REPO_ROOT) -> dict[str, object]:
    feature = load_json(
        root
        / "tooling"
        / "acceptance"
        / "features"
        / "unified-client-secure-content-core.yaml"
    )
    capabilities = load_json(
        root / "tooling" / "acceptance" / "capabilities" / "mobile.yaml"
    )
    domain = load_json(
        root / "tooling" / "acceptance" / "domains" / "mobile.yaml"
    )
    registry = load_json(root / "tooling" / "acceptance" / "registry.yaml")
    gates = load_json(root / "tooling" / "acceptance" / "gates.yaml")

    capability = next(
        (
            item
            for item in capabilities.get("capabilities", [])
            if item.get("id") == "mobile-secure-content-portable-core"
        ),
        None,
    )
    registry_rule = next(
        (
            item
            for item in registry.get("rules", [])
            if item.get("id") == "unified-client-secure-content-core"
        ),
        None,
    )
    gate = gates.get("gates", {}).get(GATE_ID)
    valid = (
        feature.get("id") == "unified-client-secure-content-core"
        and feature.get("required_gates") == [GATE_ID]
        and isinstance(capability, dict)
        and capability.get("features")
        == ["unified-client-secure-content-core"]
        and capability.get("required_gates") == [GATE_ID]
        and "mobile-secure-content-portable-core"
        in domain.get("capabilities", [])
        and isinstance(registry_rule, dict)
        and registry_rule.get("features")
        == ["unified-client-secure-content-core"]
        and registry_rule.get("require") == [GATE_ID]
        and isinstance(gate, dict)
        and gate.get("command")
        == (
            "python3 -m "
            "tooling.acceptance.gates.mobile.secure_content_portable_core"
        )
        and gate.get("environment") == "local"
    )
    if not valid:
        raise GateError(
            "Secure Content Feature -> Capability -> Domain -> Registry -> "
            "Gate trace is incomplete"
        )
    return {
        "feature": feature["id"],
        "capability": capability["id"],
        "domain": domain["id"],
        "gate": GATE_ID,
    }


def run_operation_tests(root: Path = REPO_ROOT) -> None:
    with tempfile.TemporaryDirectory(prefix="secure-content-portable-core-") as temporary:
        isolated_root = Path(temporary)
        isolated_core = isolated_root / "packages" / "secure-content-core"
        isolated_core.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(
            root / "packages" / "secure-content-core",
            isolated_core,
            ignore=shutil.ignore_patterns("Cargo.lock", "target"),
        )
        testdata = Path("model/domain/secure_content/testdata")
        (isolated_root / testdata).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(root / testdata, isolated_root / testdata)
        completed = subprocess.run(
            [
                "cargo",
                "test",
                "--manifest-path",
                str(isolated_core / "Cargo.toml"),
                "--offline",
                "operation::",
            ],
            cwd=isolated_root,
            env={
                **os.environ,
                "CARGO_TARGET_DIR": str(isolated_root / "target"),
            },
            capture_output=True,
            text=True,
            check=False,
        )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise GateError(f"Secure Content operation tests failed: {detail}")


class SecureContentPortableCoreGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-05"
    bom = ("UCA-20261017", "SC-D30", "secure-content-operation-v1")
    spec = (
        "docs/architecture/shared/security/secure-content/decisions.md",
        "docs/architecture/shared/security/secure-content/integration.md",
    )

    def run(self) -> dict[str, object]:
        contract = validate_portable_core()
        trace = validate_acceptance_trace()
        run_operation_tests()
        self.assert_condition(
            "sc_d30_portable_operation_contract",
            True,
            f"{contract['operationModules']} source modules/ports validated",
        )
        self.assert_condition(
            "sc_d30_no_production_dual_owner",
            contract["productionConsumers"]
            == len(REQUIRED_PRODUCTION_CONSUMERS),
            "UCA-05 production consumers use the portable operation contract",
        )
        self.assert_condition(
            "sc_d30_acceptance_trace",
            True,
            (
                f"{trace['feature']} -> {trace['capability']} -> "
                f"{trace['domain']} -> {trace['gate']}"
            ),
        )
        self.assert_condition(
            "sc_d30_operation_tests",
            True,
            "portable operation transition and reconciliation corpus passed",
        )
        return {
            "runtimeCell": "source-only",
            "contract": contract,
            "acceptanceTrace": trace,
            "productionConsumerActivated": True,
        }


def main() -> int:
    return SecureContentPortableCoreGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
