#!/usr/bin/env python3
"""Prove the MP-D16 source-only portable Messaging Core contract."""

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


GATE_ID = "unified-client-messaging-core-contract"
REPO_ROOT = Path(__file__).resolve().parents[4]

REQUIRED_SOURCE_MARKERS = {
    "src/engine/lifecycle.rs": (
        "pub enum EnginePhase",
        "pub struct EngineLifecycleRecord",
        "pub struct EngineFence",
        "pub fn activate_engine",
        "pub fn complete_engine_start",
        "pub fn resume_engine",
        "pub fn suspend_engine",
        "pub fn begin_engine_stop",
        "pub fn complete_engine_stop",
        "pub fn advance_engine_consumer_epoch",
        "pub fn validate_active_engine",
        "pub fn validate_engine_fence",
        "pub fn recover_interrupted_engine",
    ),
    "src/engine/reconciliation.rs": (
        "pub fn reconcile_submitted_commands",
        "pub trait CommandReconciliationRepository",
        "CommandReconciliationDisposition::NotFound",
        "terminal_membership_conversations",
    ),
    "src/engine/store_policy.rs": (
        'pub const MESSAGING_STORE_SCHEMA_ID: &str = "messaging-store-v1"',
        "pub fn plan_store_cutover",
        "pub fn allows_dual_write",
        "DeleteLegacyOwner",
    ),
    "src/outbox/dispatch.rs": (
        "CommandSubmitFailure::Ambiguous",
        "pub struct CommandOutboxWorker",
    ),
    "src/recovery/mod.rs": ("pub use codec", "RecoveryReconciliation"),
    "src/inbox/receipt.rs": ("pub struct DeliveryReceiptProcessor",),
    "src/outbox/receipt.rs": ("pub struct DeliveryReceiptDispatcher",),
    "src/attachment/transfer.rs": ("pub struct AttachmentTransferWorker",),
    "src/ports/attachment_blob.rs": ("ObjectBlob as AttachmentBlob",),
    "src/ports/clock.rs": ("pub trait Clock",),
    "src/ports/command_result_transport.rs": ("pub trait CommandResultTransport",),
    "src/ports/encrypted_store.rs": ("pub trait EncryptedStore",),
    "src/ports/event_sink.rs": ("pub trait EngineEventSink",),
    "src/ports/key_material.rs": ("pub trait KeyMaterial",),
    "src/ports/lifecycle_cancellation.rs": ("pub trait LifecycleCancellation",),
    "src/ports/queue_transport.rs": ("pub trait QueueTransport",),
}

FORBIDDEN_APPLICATION_PATTERNS = {
    "Tauri": re.compile(r"\btauri(?:::|[-_])"),
    "Desktop/Mobile application import": re.compile(
        r"\b(?:apps|desktop|mobile)::"
    ),
    "Station implementation import": re.compile(r"\bstation::"),
    "HTTP client": re.compile(r"\b(reqwest|hyper|ureq)\b"),
    "SQL implementation": re.compile(r"\b(rusqlite|sqlx|diesel)\b"),
}
FORBIDDEN_OS_PATTERNS = {
    "filesystem": re.compile(r"\bstd::fs\b"),
    "OS path": re.compile(r"\bstd::path\b"),
    "environment path": re.compile(r"\bstd::env\b"),
    "rustix filesystem": re.compile(r"\brustix::fs\b"),
}
NATIVE_FILESYSTEM_MARKERS = (
    "impl StorageMeasurementPort for NativeMessagingFilesystem",
    "impl CacheCleanupFilesystem for NativeMessagingFilesystem",
    "pub fn immutable_file_cleanup_item",
    "pub fn cleanup_file_physical_identity",
    "use rustix::fs",
)
PRODUCTION_CONSUMER_MARKERS = {
    "apps/desktop/src-tauri/src/messaging/engine.rs": (
        "reconcile_submitted_commands",
        "DirectOutboundPreparer",
        "MessagingItemConsumer",
    ),
    "apps/desktop/src-tauri/src/messaging/lifecycle.rs": (
        "EngineLifecycleRecord",
        "validate_active_engine",
    ),
    "apps/mobile/src-tauri/src/messaging/engine.rs": (
        "reconcile_submitted_commands",
        "DirectOutboundPreparer",
        "MessagingItemConsumer",
    ),
    "apps/mobile/src-tauri/src/messaging/lifecycle.rs": (
        "EngineLifecycleRecord",
        "validate_active_engine",
    ),
}
DELETED_DESKTOP_OWNER_FILES = (
    "command_outbox.rs",
    "command_reconciliation.rs",
    "consumer.rs",
    "conversation_state.rs",
    "direct.rs",
    "drain.rs",
    "inbox.rs",
    "public_event.rs",
    "receipt.rs",
    "send.rs",
    "service_plaintext.rs",
    "skipped.rs",
)
INVENTORY_MARKERS = (
    "Desktop `MessagingEngine`, `EngineRegistry`",
    "Desktop `MessagingLifecycleWorker`",
    "Desktop `MessagingStore`",
    "Desktop `SubmittedCommand`",
    "Mobile `MessagingEngine`",
    "Mobile `MobileMessagingRuntime`",
    "Mobile `MobileMessagingStore`",
    "Core `storage_governance::{mod,cache}`",
    "messaging-store-v1",
    "There is no dual-write window",
)
SCHEMA_MARKERS = (
    "| 1 | `INACTIVE`",
    "| 6 | `FAILED`",
    "lifecycle_generation",
    "worker_generation",
    "target_schema_id = messaging-store-v1",
)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise GateError(f"{path.relative_to(REPO_ROOT)} must contain an object")
    return value


def validate_portable_core(root: Path = REPO_ROOT) -> dict[str, object]:
    core_root = root / "packages" / "messaging-core"
    missing: list[str] = []
    for relative, markers in REQUIRED_SOURCE_MARKERS.items():
        path = core_root / relative
        if not path.is_file():
            missing.append(relative)
            continue
        source = path.read_text(encoding="utf-8")
        missing.extend(
            f"{relative}:{marker}" for marker in markers if marker not in source
        )
    if missing:
        raise GateError(
            "Messaging portable contract is incomplete: " + ", ".join(missing)
        )

    application_findings: list[str] = []
    os_findings: dict[str, list[str]] = {}
    for path in sorted((core_root / "src").rglob("*.rs")):
        relative = str(path.relative_to(core_root))
        source = path.read_text(encoding="utf-8")
        for name, pattern in FORBIDDEN_APPLICATION_PATTERNS.items():
            if pattern.search(source):
                application_findings.append(f"{relative}:{name}")
        matched_os = [
            name
            for name, pattern in FORBIDDEN_OS_PATTERNS.items()
            if pattern.search(source)
        ]
        if matched_os:
            os_findings[relative] = matched_os
    if application_findings:
        raise GateError(
            "Messaging portable core imports forbidden application owners: "
            + ", ".join(application_findings)
        )
    if os_findings:
        raise GateError(
            "Messaging portable core imports forbidden OS owners: "
            + ", ".join(
                f"{path}:{'/'.join(names)}"
                for path, names in sorted(os_findings.items())
            )
        )

    cargo = (core_root / "Cargo.toml").read_text(encoding="utf-8")
    if "rustix" in cargo:
        raise GateError(
            "Messaging portable core must not retain the native filesystem dependency"
        )

    native_source = (
        root / "packages" / "messaging-native-filesystem" / "src" / "lib.rs"
    )
    native_cargo = root / "packages" / "messaging-native-filesystem" / "Cargo.toml"
    if not native_source.is_file() or not native_cargo.is_file():
        raise GateError("Messaging native filesystem adapter is missing")
    native_text = native_source.read_text(encoding="utf-8")
    missing_native = [
        marker for marker in NATIVE_FILESYSTEM_MARKERS if marker not in native_text
    ]
    if missing_native:
        raise GateError(
            "Messaging native filesystem adapter is incomplete: "
            + ", ".join(missing_native)
        )

    missing_consumers: list[str] = []
    for relative, markers in PRODUCTION_CONSUMER_MARKERS.items():
        source = (root / relative).read_text(encoding="utf-8")
        missing_consumers.extend(
            f"{relative}:{marker}" for marker in markers if marker not in source
        )
    if missing_consumers:
        raise GateError(
            "Messaging production core consumers are incomplete: "
            + ", ".join(missing_consumers)
        )
    desktop_root = root / "apps" / "desktop" / "src-tauri" / "src" / "messaging"
    retained_owners = [
        name for name in DELETED_DESKTOP_OWNER_FILES if (desktop_root / name).exists()
    ]
    if retained_owners:
        raise GateError(
            "Messaging deleted Desktop owners are still present: "
            + ", ".join(retained_owners)
        )

    integration = (
        root
        / "docs"
        / "architecture"
        / "domains"
        / "chat"
        / "messaging"
        / "integration.md"
    ).read_text(encoding="utf-8")
    missing_inventory = [
        marker for marker in INVENTORY_MARKERS if marker not in integration
    ]
    if missing_inventory:
        raise GateError(
            "Messaging migration inventory is incomplete: "
            + ", ".join(missing_inventory)
        )
    data_model = (
        root
        / "docs"
        / "architecture"
        / "domains"
        / "chat"
        / "messaging"
        / "data-model.md"
    ).read_text(encoding="utf-8")
    missing_schema = [
        marker for marker in SCHEMA_MARKERS if marker not in data_model
    ]
    if missing_schema:
        raise GateError(
            "Messaging store schema contract is incomplete: "
            + ", ".join(missing_schema)
        )

    return {
        "contractModules": len(REQUIRED_SOURCE_MARKERS),
        "forbiddenApplicationFindings": 0,
        "forbiddenOsOwnerFindings": 0,
        "nativeFilesystemMarkers": len(NATIVE_FILESYSTEM_MARKERS),
        "productionConsumerFiles": sorted(PRODUCTION_CONSUMER_MARKERS),
        "deletedDesktopOwnerFiles": len(DELETED_DESKTOP_OWNER_FILES),
        "inventoryMarkers": len(INVENTORY_MARKERS),
        "schemaMarkers": len(SCHEMA_MARKERS),
    }


def validate_acceptance_trace(root: Path = REPO_ROOT) -> dict[str, object]:
    feature = load_json(
        root
        / "tooling"
        / "acceptance"
        / "features"
        / "unified-client-messaging-core.yaml"
    )
    capabilities = load_json(
        root / "tooling" / "acceptance" / "capabilities" / "chat.yaml"
    )
    domain = load_json(root / "tooling" / "acceptance" / "domains" / "chat.yaml")
    registry = load_json(root / "tooling" / "acceptance" / "registry.yaml")
    gates = load_json(root / "tooling" / "acceptance" / "gates.yaml")

    capability = next(
        (
            item
            for item in capabilities.get("capabilities", [])
            if item.get("id") == "chat-portable-messaging-core"
        ),
        None,
    )
    registry_rule = next(
        (
            item
            for item in registry.get("rules", [])
            if item.get("id") == "unified-client-messaging-core"
        ),
        None,
    )
    gate = gates.get("gates", {}).get(GATE_ID)
    valid = (
        feature.get("id") == "unified-client-messaging-core"
        and feature.get("required_gates") == [GATE_ID]
        and isinstance(capability, dict)
        and "unified-client-messaging-core"
        in capability.get("features", [])
        and GATE_ID in capability.get("required_gates", [])
        and "chat-portable-messaging-core" in domain.get("capabilities", [])
        and isinstance(registry_rule, dict)
        and registry_rule.get("features") == ["unified-client-messaging-core"]
        and registry_rule.get("require") == [GATE_ID]
        and isinstance(gate, dict)
        and gate.get("command")
        == (
            "python3 -m "
            "tooling.acceptance.gates.chat.unified_client_core_contract"
        )
        and gate.get("environment") == "local"
    )
    if not valid:
        raise GateError(
            "Messaging Feature -> Capability -> Domain -> Registry -> Gate "
            "trace is incomplete"
        )
    return {
        "feature": feature["id"],
        "capability": capability["id"],
        "domain": domain["id"],
        "gate": GATE_ID,
    }


def run_portable_contract_tests(root: Path = REPO_ROOT) -> None:
    with tempfile.TemporaryDirectory(
        prefix="unified-client-messaging-core-"
    ) as temporary:
        isolated_root = Path(temporary)
        for relative in (
            Path("packages/messaging-core"),
            Path("packages/secure-content-core"),
            Path("model/domain"),
        ):
            destination = isolated_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                root / relative,
                destination,
                ignore=shutil.ignore_patterns("Cargo.lock", "target"),
            )
        commands = (
            [
                "cargo",
                "test",
                "--manifest-path",
                str(
                    isolated_root
                    / "packages"
                    / "messaging-core"
                    / "Cargo.toml"
                ),
                "--offline",
                "engine::",
            ],
            [
                "cargo",
                "test",
                "--manifest-path",
                str(
                    isolated_root
                    / "packages"
                    / "messaging-core"
                    / "Cargo.toml"
                ),
                "--offline",
                "ambiguous_submission_waits_for_authority_reconciliation",
            ],
        )
        for command in commands:
            completed = subprocess.run(
                command,
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
                raise GateError(
                    f"Messaging portable contract tests failed: {detail}"
                )


class UnifiedClientMessagingCoreContractGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-04A"
    bom = ("UCA-20261017", "MP-D16", "messaging-store-v1")
    spec = (
        "docs/architecture/domains/chat/messaging/decisions.md",
        "docs/architecture/domains/chat/messaging/integration.md",
        "docs/architecture/domains/chat/messaging/data-model.md",
    )

    def run(self) -> dict[str, object]:
        contract = validate_portable_core()
        trace = validate_acceptance_trace()
        run_portable_contract_tests()
        self.assert_condition(
            "mp_d16_portable_engine_contract",
            True,
            f"{contract['contractModules']} source modules/ports validated",
        )
        self.assert_condition(
            "mp_d16_production_consumers_cut_over",
            len(contract["productionConsumerFiles"])
            == len(PRODUCTION_CONSUMER_MARKERS),
            "Desktop and Mobile production consumers use the portable core",
        )
        self.assert_condition(
            "mp_d16_native_filesystem_adapter",
            contract["forbiddenOsOwnerFindings"] == 0
            and contract["nativeFilesystemMarkers"]
            == len(NATIVE_FILESYSTEM_MARKERS),
            "portable core is OS-free and both Hosts use one native adapter",
        )
        self.assert_condition(
            "mp_d16_acceptance_trace",
            True,
            (
                f"{trace['feature']} -> {trace['capability']} -> "
                f"{trace['domain']} -> {trace['gate']}"
            ),
        )
        self.assert_condition(
            "mp_d16_portable_tests",
            True,
            "engine lifecycle, cutover and reconciliation corpus passed",
        )
        return {
            "runtimeCell": "source-only",
            "contract": contract,
            "acceptanceTrace": trace,
            "productionConsumerActivated": True,
        }


def main() -> int:
    return UnifiedClientMessagingCoreContractGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
