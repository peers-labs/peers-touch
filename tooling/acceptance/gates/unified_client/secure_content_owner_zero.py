#!/usr/bin/env python3
"""Prove that UCA-05 leaves one portable Secure Content semantic owner."""

from __future__ import annotations

import json
import re
from pathlib import Path

from tooling.acceptance.core import AcceptanceGate, GateError


GATE_ID = "secure-content-owner-hard-cut-zero"
REPO_ROOT = Path(__file__).resolve().parents[4]
INVENTORY_PATH = (
    Path("docs/architecture/platform/client/cross-client-runtime/")
    / "execution-plans/20261017-unified-client-architecture"
    / "artifacts/UCA-05-owner-inventory.json"
)
CORE_ROOT = Path("packages/secure-content-core/src")
DESKTOP_ROOT = Path("apps/desktop/src-tauri/src")
MOBILE_ROOT = Path("apps/mobile/src-tauri/src")

CANONICAL_DECLARATIONS = {
    r"pub enum OperationState\b": "operation state",
    r"pub fn acquire_operation\b": "operation acquisition",
    r"pub fn complete_operation\b": "operation completion",
    r"pub fn recover_interrupted_operation\b": "operation recovery",
    r"pub fn decide_unknown_outcome\b": "unknown-outcome reconciliation",
    r"pub fn decide_committed_readback\b": "committed readback",
    r"pub fn apply_readback_decision\b": "readback transition",
    r"pub fn continue_recovery_envelope\b": "recovery continuation",
    r"pub struct ObjectTransferWorker\b": "object transfer worker",
}
REQUIRED_CONSUMERS = {
    Path("apps/desktop/src-tauri/src/secure_content/store.rs"): (
        "acquire_operation",
        "complete_operation",
        "apply_readback_decision",
        "recover_interrupted_operation",
        "impl ObjectTransferRepository for SecureContentStore",
        "secure-content-operation-v1",
    ),
    Path("apps/desktop/src-tauri/src/social/private_moment.rs"): (
        "decide_unknown_outcome",
        "decide_committed_readback",
    ),
    Path("apps/desktop/src-tauri/src/social/private_comment.rs"): (
        "decide_unknown_outcome",
        "decide_committed_readback",
    ),
    Path("apps/desktop/src-tauri/src/secure_content/object_runtime.rs"): (
        "ObjectTransferWorker",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/store.rs"): (
        "acquire_operation",
        "complete_operation",
        "apply_readback_decision",
        "recover_interrupted_operation",
        "impl ObjectTransferRepository for PrivateSocialStore",
        "secure-content-operation-v1",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/runtime.rs"): (
        "decide_unknown_outcome",
        "decide_committed_readback",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/private_comment.rs"): (
        "acquire_comment_submission",
        "complete_comment_submission",
        "decide_unknown_outcome",
        "decide_committed_readback",
        "apply_comment_readback",
    ),
    Path("apps/mobile/src-tauri/src/secure_content/object_runtime.rs"): (
        "ObjectTransferWorker",
        "ObjectTransferTransport",
    ),
}
FORBIDDEN_MOBILE_SOCIAL_UPLOAD_SYMBOLS = (
    "begin_private_object_upload",
    "put_private_object_chunk",
    "complete_private_object_upload",
    "ciphertext_chunk",
    "chunk_stride",
)
FORBIDDEN_CORE_OS = re.compile(
    r"\b(?:std::fs|std::path|std::env|reqwest|rusqlite|tauri)\b"
)


def _rust_sources(root: Path, relative_root: Path) -> dict[Path, str]:
    base = root / relative_root
    return {
        path.relative_to(root): path.read_text(encoding="utf-8")
        for path in sorted(base.rglob("*.rs"))
    }


def validate_owner_zero(root: Path = REPO_ROOT) -> dict[str, object]:
    inventory = json.loads((root / INVENTORY_PATH).read_text(encoding="utf-8"))
    if (
        inventory.get("kind") != "peers-touch-uca-owner-inventory"
        or inventory.get("taskId") != "UCA-05"
        or inventory.get("targetOwner") != "packages/secure-content-core"
        or inventory.get("operationSchema") != "secure-content-operation-v1"
    ):
        raise GateError("UCA-05 owner inventory identity is invalid")

    deleted = inventory.get("deletedOwners", [])
    retained_deleted = [
        relative
        for relative in deleted
        if isinstance(relative, str) and (root / relative).exists()
    ]
    if retained_deleted:
        raise GateError(
            "deleted Secure Content owners remain: " + ", ".join(retained_deleted)
        )

    application_sources = {
        **_rust_sources(root, DESKTOP_ROOT / "secure_content"),
        **_rust_sources(root, DESKTOP_ROOT / "social"),
        **_rust_sources(root, MOBILE_ROOT / "secure_content"),
        **_rust_sources(root, MOBILE_ROOT / "social"),
    }
    forbidden_symbols = [
        f"{path}:{symbol}"
        for path, source in application_sources.items()
        for symbol in inventory.get("forbiddenLegacySymbols", [])
        if isinstance(symbol, str) and symbol in source
    ]
    if forbidden_symbols:
        raise GateError(
            "legacy Secure Content owner symbols remain: "
            + ", ".join(forbidden_symbols)
        )

    core_sources = _rust_sources(root, CORE_ROOT)
    all_sources = {**core_sources, **application_sources}
    declaration_drift: list[str] = []
    for pattern, owner in CANONICAL_DECLARATIONS.items():
        matches = [
            str(path)
            for path, source in all_sources.items()
            if re.search(pattern, source)
        ]
        if len(matches) != 1 or not matches[0].startswith(
            "packages/secure-content-core/"
        ):
            declaration_drift.append(f"{owner}={matches}")
    if declaration_drift:
        raise GateError(
            "Secure Content canonical ownership drifted: "
            + ", ".join(declaration_drift)
        )

    missing_consumers = [
        f"{relative}:{marker}"
        for relative, markers in REQUIRED_CONSUMERS.items()
        for marker in markers
        if marker not in (root / relative).read_text(encoding="utf-8")
    ]
    if missing_consumers:
        raise GateError(
            "Secure Content production consumers bypass the portable core: "
            + ", ".join(missing_consumers)
        )

    mobile_social = (
        root / "apps/mobile/src-tauri/src/social/mod.rs"
    ).read_text(encoding="utf-8")
    manual_upload = [
        marker
        for marker in FORBIDDEN_MOBILE_SOCIAL_UPLOAD_SYMBOLS
        if marker in mobile_social
    ]
    if manual_upload:
        raise GateError(
            "Mobile Social retains manual object-transfer policy: "
            + ", ".join(manual_upload)
        )

    core_os_findings = [
        str(path)
        for path, source in core_sources.items()
        if FORBIDDEN_CORE_OS.search(source)
    ]
    if core_os_findings:
        raise GateError(
            "portable Secure Content Core imports Host implementation: "
            + ", ".join(core_os_findings)
        )

    retained_adapters = inventory.get("retainedHostAdapters", {})
    missing_adapters = [
        relative
        for platform in ("desktop", "mobile")
        for relative in retained_adapters.get(platform, [])
        if not isinstance(relative, str) or not (root / relative).is_file()
    ]
    if missing_adapters:
        raise GateError(
            "declared Secure Content Host adapters are missing: "
            + ", ".join(str(path) for path in missing_adapters)
        )

    return {
        "deletedOwners": len(deleted),
        "forbiddenLegacySymbols": 0,
        "canonicalDeclarations": len(CANONICAL_DECLARATIONS),
        "productionConsumerFiles": len(REQUIRED_CONSUMERS),
        "manualMobileUploadOwners": 0,
        "portableCoreHostImports": 0,
    }


class SecureContentOwnerZeroGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-05"
    bom = ("UCA-20261017", "SC-D30", "secure-content-operation-v1")
    spec = (
        "docs/architecture/shared/security/secure-content/decisions.md",
        "docs/architecture/shared/security/secure-content/integration.md",
        str(INVENTORY_PATH),
    )

    def run(self) -> dict[str, object]:
        result = validate_owner_zero()
        self.assert_condition(
            "secure_content_legacy_owners_absent",
            result["deletedOwners"] == 2,
            "Desktop and Mobile worker owners are deleted",
        )
        self.assert_condition(
            "secure_content_canonical_declarations_unique",
            result["canonicalDeclarations"] == len(CANONICAL_DECLARATIONS),
            "portable operation and object-transfer declarations have one owner",
        )
        self.assert_condition(
            "secure_content_consumers_use_core",
            result["productionConsumerFiles"] == len(REQUIRED_CONSUMERS),
            "Desktop and Mobile consume core operations and object transfer",
        )
        return {"runtimeCell": "source-only", **result}


def main() -> int:
    return SecureContentOwnerZeroGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
