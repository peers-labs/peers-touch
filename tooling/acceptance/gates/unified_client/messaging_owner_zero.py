#!/usr/bin/env python3
"""Prove that UCA-04 leaves one host-neutral Messaging semantic owner."""

from __future__ import annotations

import json
import re
from pathlib import Path

from tooling.acceptance.core import AcceptanceGate, GateError


GATE_ID = "messaging-owner-hard-cut-zero"
REPO_ROOT = Path(__file__).resolve().parents[4]
INVENTORY_PATH = (
    Path("docs/architecture/platform/client/cross-client-runtime/")
    / "execution-plans/20261017-unified-client-architecture"
    / "artifacts/UCA-04-owner-inventory.json"
)
DESKTOP_ROOT = Path("apps/desktop/src-tauri/src/messaging")
MOBILE_ROOT = Path("apps/mobile/src-tauri/src/messaging")
CORE_ROOT = Path("packages/messaging-core")
NATIVE_FILESYSTEM_ROOT = Path("packages/messaging-native-filesystem")

FORBIDDEN_APPLICATION_SYMBOLS = (
    "SendPreparer",
    "MobileMlsItemConsumer",
    "MobileOutboxStore",
    "next_activation_generation",
)
CANONICAL_DECLARATIONS = {
    r"pub struct EngineLifecycleRecord\b": "engine lifecycle",
    r"pub fn reconcile_submitted_commands\b": "command reconciliation",
    r"pub struct CommandOutboxWorker\b": "command outbox",
    r"pub struct QueueDrain\b": "queue drain",
    r"pub struct MessagingItemConsumer\b": "inbox consumer",
    r"pub struct DeliveryReceiptDispatcher\b": "receipt dispatch",
    r"pub struct DeliveryReceiptOutboxEntry\b": "receipt outbox model",
    r"pub struct AttachmentTransferWorker\b": "attachment transfer",
    r"pub struct MessagingRecoveryArchive\b": "recovery archive",
}
REQUIRED_CONSUMERS = {
    DESKTOP_ROOT / "engine.rs": (
        "DirectOutboundPreparer",
        "MlsOutboundPreparer",
        "MessagingItemConsumer",
        "DeliveryReceiptDispatcher",
        "reconcile_submitted_commands",
    ),
    DESKTOP_ROOT / "lifecycle.rs": (
        "EngineLifecycleRecord",
        "validate_active_engine",
    ),
    DESKTOP_ROOT / "store.rs": (
        "MessagingStore::commit_member_authority_state",
    ),
    MOBILE_ROOT / "engine.rs": (
        "DirectOutboundPreparer",
        "MlsOutboundPreparer",
        "MessagingItemConsumer",
        "DeliveryReceiptDispatcher",
        "reconcile_submitted_commands",
    ),
    MOBILE_ROOT / "lifecycle.rs": (
        "EngineLifecycleRecord",
        "validate_active_engine",
        "has_immediate_follow_up",
        "next_reconciliation_at_unix_ms",
    ),
    MOBILE_ROOT / "adapter.rs": (
        "transition_non_message_intents",
    ),
}
FORBIDDEN_PARALLEL_CONSUMERS = {
    MOBILE_ROOT / "engine.rs": (
        "fn consume_conversation_mutation_event",
    ),
}
FORBIDDEN_CORE_OS = re.compile(
    r"\b(?:std::fs|std::path|std::env|rustix::fs)\b"
)


def _read_sources(root: Path, relative_root: Path) -> dict[Path, str]:
    base = root / relative_root
    return {
        path.relative_to(root): path.read_text(encoding="utf-8")
        for path in sorted(base.rglob("*.rs"))
    }


def validate_owner_zero(root: Path = REPO_ROOT) -> dict[str, object]:
    inventory = json.loads((root / INVENTORY_PATH).read_text(encoding="utf-8"))
    if (
        inventory.get("kind") != "peers-touch-uca-owner-inventory"
        or inventory.get("taskId") != "UCA-04"
        or inventory.get("targetOwner") != "packages/messaging-core"
    ):
        raise GateError("UCA-04 owner inventory identity is invalid")

    desktop_legacy = inventory.get("legacyOwners", {}).get("desktop", [])
    retained_files = [
        relative
        for relative in desktop_legacy
        if isinstance(relative, str) and (root / relative).exists()
    ]
    if retained_files:
        raise GateError(
            "deleted Desktop Messaging owners remain: "
            + ", ".join(retained_files)
        )

    application_sources = {
        **_read_sources(root, DESKTOP_ROOT),
        **_read_sources(root, MOBILE_ROOT),
    }
    forbidden_symbols = [
        f"{path}:{symbol}"
        for path, source in application_sources.items()
        for symbol in FORBIDDEN_APPLICATION_SYMBOLS
        if symbol in source
    ]
    if forbidden_symbols:
        raise GateError(
            "legacy Messaging owner symbols remain: "
            + ", ".join(forbidden_symbols)
        )

    core_sources = _read_sources(root, CORE_ROOT / "src")
    all_sources = {**core_sources, **application_sources}
    duplicate_or_missing: list[str] = []
    for pattern, owner in CANONICAL_DECLARATIONS.items():
        matches = [
            str(path)
            for path, source in all_sources.items()
            if re.search(pattern, source)
        ]
        if len(matches) != 1 or not matches[0].startswith("packages/messaging-core/"):
            duplicate_or_missing.append(f"{owner}={matches}")
    if duplicate_or_missing:
        raise GateError(
            "Messaging canonical declaration ownership drifted: "
            + ", ".join(duplicate_or_missing)
        )

    missing_consumers = [
        f"{relative}:{marker}"
        for relative, markers in REQUIRED_CONSUMERS.items()
        for marker in markers
        if marker not in (root / relative).read_text(encoding="utf-8")
    ]
    if missing_consumers:
        raise GateError(
            "Messaging production consumers do not use the canonical core: "
            + ", ".join(missing_consumers)
        )

    parallel_consumers = [
        f"{relative}:{marker}"
        for relative, markers in FORBIDDEN_PARALLEL_CONSUMERS.items()
        for marker in markers
        if marker in (root / relative).read_text(encoding="utf-8")
    ]
    if parallel_consumers:
        raise GateError(
            "Messaging application retains a parallel Core consumer: "
            + ", ".join(parallel_consumers)
        )

    core_os_findings = [
        str(path)
        for path, source in core_sources.items()
        if FORBIDDEN_CORE_OS.search(source)
    ]
    core_cargo = (root / CORE_ROOT / "Cargo.toml").read_text(encoding="utf-8")
    if core_os_findings or re.search(r"^rustix\s*=", core_cargo, re.MULTILINE):
        raise GateError(
            "portable Messaging Core retains native filesystem ownership: "
            + ", ".join(core_os_findings)
        )

    native_source = root / NATIVE_FILESYSTEM_ROOT / "src" / "lib.rs"
    native_cargo = root / NATIVE_FILESYSTEM_ROOT / "Cargo.toml"
    if not native_source.is_file() or not native_cargo.is_file():
        raise GateError("shared Messaging native filesystem adapter is missing")
    native_text = native_source.read_text(encoding="utf-8")
    for marker in (
        "impl StorageMeasurementPort for NativeMessagingFilesystem",
        "impl CacheCleanupFilesystem for NativeMessagingFilesystem",
        "use rustix::fs",
    ):
        if marker not in native_text:
            raise GateError(
                f"shared Messaging native filesystem adapter lacks {marker}"
            )

    for manifest in (
        Path("apps/desktop/src-tauri/Cargo.toml"),
        Path("apps/mobile/src-tauri/Cargo.toml"),
    ):
        if "messaging-native-filesystem" not in (
            root / manifest
        ).read_text(encoding="utf-8"):
            raise GateError(f"{manifest} does not use the shared native adapter")

    return {
        "deletedDesktopOwners": len(desktop_legacy),
        "forbiddenApplicationSymbols": 0,
        "canonicalDeclarations": len(CANONICAL_DECLARATIONS),
        "productionConsumerFiles": len(REQUIRED_CONSUMERS),
        "parallelApplicationConsumers": 0,
        "portableCoreOsOwners": 0,
        "nativeFilesystemAdapter": str(NATIVE_FILESYSTEM_ROOT),
    }


class MessagingOwnerZeroGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-04"
    bom = ("UCA-20261017", "MP-D16", "messaging-store-v1")
    spec = (
        "docs/architecture/domains/chat/messaging/decisions.md",
        "docs/architecture/domains/chat/messaging/integration.md",
        str(INVENTORY_PATH),
    )

    def run(self) -> dict[str, object]:
        result = validate_owner_zero()
        self.assert_condition(
            "messaging_legacy_owners_absent",
            result["deletedDesktopOwners"] > 0,
            f"{result['deletedDesktopOwners']} Desktop owner files deleted",
        )
        self.assert_condition(
            "messaging_canonical_declarations_unique",
            result["canonicalDeclarations"] == len(CANONICAL_DECLARATIONS),
            "all host-neutral declarations resolve only to messaging-core",
        )
        self.assert_condition(
            "messaging_native_filesystem_shared",
            result["portableCoreOsOwners"] == 0,
            "Desktop and Mobile use one native filesystem adapter",
        )
        return {"runtimeCell": "source-only", **result}


def main() -> int:
    return MessagingOwnerZeroGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
