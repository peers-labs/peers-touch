#!/usr/bin/env python3
"""Prove one renderer-neutral owner per shared client semantic."""

from __future__ import annotations

import json
import re
from pathlib import Path

from tooling.acceptance.core import AcceptanceGate, GateError


GATE_ID = "unified-client-shared-semantics"
REPO_ROOT = Path(__file__).resolve().parents[4]
REGISTRY_PATH = Path(
    "docs/architecture/engineering/architecture-governance/"
    "architecture-modules.json"
)
SHARED_ROOTS = (
    Path("packages/client-chat-core/src"),
    Path("packages/client-media-security/src"),
    Path("packages/client-storage/src"),
)
CANONICAL_DECLARATIONS = {
    r"export class ChatStorageProjectionRuntime\b": (
        "chat storage projection runtime",
        "packages/client-chat-core/",
    ),
    r"export function projectIMConversation\b": (
        "chat conversation projection",
        "packages/client-chat-core/",
    ),
    r"export function projectIMMessage\b": (
        "chat message projection",
        "packages/client-chat-core/",
    ),
    r"export function resolveChatComposerCapabilities\b": (
        "chat capability admission",
        "packages/client-chat-core/",
    ),
    r"export function clientWireTimestampMillis\b": (
        "client wire timestamp codec",
        "packages/client-chat-core/",
    ),
    r"export function clientMediaEncryptionDescriptorFromAttachment\b": (
        "media encryption descriptor codec",
        "packages/client-media-security/",
    ),
    r"export function createClientStorageKernel\b": (
        "client storage kernel",
        "packages/client-storage/",
    ),
}
REQUIRED_CONSUMERS = {
    Path("apps/desktop/src/runtimes/chatStorageRuntime.ts"): (
        "ChatStorageProjectionRuntime",
        "sharedChatStorageScopeRevision",
        "chatStorageResultMatches",
    ),
    Path("apps/mobile/src/runtimes/chatStorageRuntime.ts"): (
        "ChatStorageProjectionRuntime",
        "sharedChatStorageScopeRevision",
        "chatStorageResultMatches",
    ),
    Path("apps/desktop/src/store/socialNormalizers.ts"): (
        "clientWireRecord",
        "clientWireTimestampIso",
    ),
    Path("apps/mobile/src/features/social/socialNormalizers.ts"): (
        "clientWireBytes",
        "clientWireTimestampMillis",
    ),
    Path("apps/desktop/src/components/moments/MomentComposer.tsx"): (
        "clientMediaEncryptionDescriptorFromAttachment",
    ),
    Path("apps/mobile/src/services/gateways/momentMediaGateway.ts"): (
        "clientMediaEncryptionDescriptorFromAttachment",
    ),
    Path("apps/desktop/src/store/socialProjection.ts"): (
        "projectIMConversation",
        "projectIMMessage",
    ),
    Path("apps/mobile/src/features/social/socialProjection.ts"): (
        "projectIMConversation",
        "projectIMMessage",
    ),
    Path("apps/desktop/src/components/chat/ChatComposer.tsx"): (
        "resolveChatComposerCapabilities",
        "canSubmitChatComposerDraft",
    ),
    Path("apps/mobile/src/pages/ChatPage.tsx"): (
        "canSubmitChatComposerDraft",
    ),
    Path(
        "apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx"
    ): (
        "buildChatMessageSurfaceItems",
    ),
    Path("apps/mobile/src/features/chat/chatSelectors.ts"): (
        "buildChatConversationSurfaceItems",
        "filterChatMessagesBySearchText",
    ),
}
FORM_POLICY_FILES = {
    Path(
        "apps/desktop/src/components/chat/chatPresentationPolicy.ts"
    ): (
        "DesktopChatVisualSurface",
        "DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN",
        "desktopChatLayoutForSurface",
    ),
    Path(
        "apps/mobile/src/pages/chat/chatPresentationPolicy.ts"
    ): (
        "MobileChatVisualSurface",
        "MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN",
        "mobileChatLayoutForSurface",
    ),
}
FORBIDDEN_LOCAL_DECLARATIONS = {
    Path("apps/desktop/src/runtimes/chatStorageRuntime.ts"): (
        r"class DesktopChatStorageRuntime\b",
        r"interface ChatStorageProjection\b",
        r"const RECONCILE_INTERVAL_MS\b",
        r"const RETENTION_SWEEP_INTERVAL_MS\b",
    ),
    Path("apps/mobile/src/runtimes/chatStorageRuntime.ts"): (
        r"class MobileChatStorageRuntime\b",
        r"interface MobileChatStorageProjection\b",
        r"const RECONCILE_INTERVAL_MS\b",
        r"const RETENTION_SWEEP_INTERVAL_MS\b",
    ),
    Path("apps/desktop/src/store/socialNormalizers.ts"): (
        r"function recordFromUnknown\b",
        r"function stringValue\b",
        r"function numberValue\b",
        r"function timestampString\b",
    ),
    Path("apps/mobile/src/features/social/socialNormalizers.ts"): (
        r"function bytesValue\b",
        r"function base64ToBytes\b",
    ),
}
FORBIDDEN_SHARED_IMPORTS = re.compile(
    r"""from\s+['"](?:react|react-dom|antd|@lobehub/ui|zustand|@tauri-apps/)"""
)
FORBIDDEN_SHARED_PRESENTATION = (
    "desktop-main",
    "desktop-thread",
    "mobile-main",
    "mobile-thread",
    "safe-area-inset",
    "composerOuterPadding",
    "hoverActionBridge",
)
CAPABILITY_IDS = {
    "client.chat.headless",
    "client.media-security.headless",
    "client.storage.headless",
}
FORM_CAPABILITIES = {
    "client.chat.presentation.desktop": (
        "apps/desktop/src/components/chat/chatPresentationPolicy.ts"
    ),
    "client.chat.presentation.mobile": (
        "apps/mobile/src/pages/chat/chatPresentationPolicy.ts"
    ),
}


def _typescript_sources(
    root: Path,
    relative_roots: tuple[Path, ...],
) -> dict[Path, str]:
    sources: dict[Path, str] = {}
    for relative_root in relative_roots:
        base = root / relative_root
        for pattern in ("*.ts", "*.tsx"):
            for path in sorted(base.rglob(pattern)):
                if path.name.endswith(".test.ts") or path.name.endswith(
                    ".test.tsx"
                ):
                    continue
                sources[path.relative_to(root)] = path.read_text(
                    encoding="utf-8"
                )
    return sources


def validate_shared_semantics(root: Path = REPO_ROOT) -> dict[str, object]:
    shared_sources = _typescript_sources(root, SHARED_ROOTS)
    app_sources = _typescript_sources(
        root,
        (Path("apps/desktop/src"), Path("apps/mobile/src")),
    )
    all_sources = {**shared_sources, **app_sources}

    declaration_drift: list[str] = []
    for pattern, (semantic, canonical_prefix) in (
        CANONICAL_DECLARATIONS.items()
    ):
        matches = [
            str(path)
            for path, source in all_sources.items()
            if re.search(pattern, source)
        ]
        if len(matches) != 1 or not matches[0].startswith(canonical_prefix):
            declaration_drift.append(f"{semantic}={matches}")
    if declaration_drift:
        raise GateError(
            "shared client semantic ownership drifted: "
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
            "Desktop/Mobile consumer bypasses canonical shared semantics: "
            + ", ".join(missing_consumers)
        )

    missing_form_policy = [
        f"{relative}:{marker}"
        for relative, markers in FORM_POLICY_FILES.items()
        for marker in markers
        if marker not in (root / relative).read_text(encoding="utf-8")
    ]
    if missing_form_policy:
        raise GateError(
            "Client Form presentation policy is missing: "
            + ", ".join(missing_form_policy)
        )

    local_owners = [
        f"{relative}:{pattern}"
        for relative, patterns in FORBIDDEN_LOCAL_DECLARATIONS.items()
        for pattern in patterns
        if re.search(
            pattern,
            (root / relative).read_text(encoding="utf-8"),
        )
    ]
    if local_owners:
        raise GateError(
            "duplicate local DTO/codec/retry owner remains: "
            + ", ".join(local_owners)
        )

    shared_host_imports = [
        str(path)
        for path, source in shared_sources.items()
        if FORBIDDEN_SHARED_IMPORTS.search(source)
    ]
    if shared_host_imports:
        raise GateError(
            "shared client package imports presentation or Host framework: "
            + ", ".join(shared_host_imports)
        )

    presentation_leaks = [
        f"{path}:{marker}"
        for path, source in shared_sources.items()
        for marker in FORBIDDEN_SHARED_PRESENTATION
        if marker in source
    ]
    if presentation_leaks:
        raise GateError(
            "Presentation Policy leaked into shared client package: "
            + ", ".join(presentation_leaks)
        )

    forked_mobile_components = [
        str(path)
        for path in (root / "apps/mobile/src").rglob("*.tsx")
        if re.search(r"(?:^|[._-])(?:android|ios)(?:[._-]|$)", path.name, re.I)
    ]
    if forked_mobile_components:
        raise GateError(
            "Android/iOS forked Mobile React components remain: "
            + ", ".join(forked_mobile_components)
        )

    registry = json.loads((root / REGISTRY_PATH).read_text(encoding="utf-8"))
    modules = registry.get("modules", [])
    cross_client = next(
        (
            module
            for module in modules
            if module.get("id") == "cross-client-runtime"
        ),
        None,
    )
    if not isinstance(cross_client, dict):
        raise GateError("cross-client-runtime capability registry is missing")
    capabilities = {
        capability.get("id"): capability
        for capability in cross_client.get("capabilities", [])
        if isinstance(capability, dict)
    }
    invalid_capabilities = []
    for capability_id in sorted(CAPABILITY_IDS):
        capability = capabilities.get(capability_id)
        if not isinstance(capability, dict):
            invalid_capabilities.append(f"{capability_id}:missing")
            continue
        consumers = set(capability.get("consumers", []))
        gates = set(capability.get("evidenceGates", []))
        if consumers != {
            "apps/desktop/package.json",
            "apps/mobile/package.json",
        }:
            invalid_capabilities.append(
                f"{capability_id}:consumers={sorted(consumers)}"
            )
        if GATE_ID not in gates:
            invalid_capabilities.append(
                f"{capability_id}:missing-evidence-gate"
            )
    if invalid_capabilities:
        raise GateError(
            "shared client capability registry is incomplete: "
            + ", ".join(invalid_capabilities)
        )
    invalid_form_capabilities = [
        capability_id
        for capability_id, expected_root in FORM_CAPABILITIES.items()
        if (
            not isinstance(capabilities.get(capability_id), dict)
            or expected_root
            not in capabilities[capability_id].get("contractRoots", [])
            or "client.chat.headless"
            not in capabilities[capability_id].get(
                "allowedDependencies",
                [],
            )
            or GATE_ID
            not in capabilities[capability_id].get("evidenceGates", [])
        )
    ]
    if invalid_form_capabilities:
        raise GateError(
            "Client Form capability registry is incomplete: "
            + ", ".join(invalid_form_capabilities)
        )

    return {
        "canonicalDeclarations": len(CANONICAL_DECLARATIONS),
        "productionConsumerFiles": len(REQUIRED_CONSUMERS),
        "formPolicyFiles": len(FORM_POLICY_FILES),
        "duplicateLocalOwners": 0,
        "sharedHostImports": 0,
        "sharedPresentationLeaks": 0,
        "forkedMobileComponents": 0,
        "registeredCapabilities": len(CAPABILITY_IDS) + len(FORM_CAPABILITIES),
    }


class UnifiedClientSharedSemanticsGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "UCA-06"
    bom = (
        "UCA-20261017",
        "CCR-D08",
        "CCR-D09",
        "CCR-D10",
        "CCR-D13",
    )
    spec = (
        "docs/architecture/platform/client/cross-client-runtime/design.md",
        "docs/architecture/platform/client/cross-client-runtime/integration.md",
        "docs/client/common/packages.md",
    )

    def run(self) -> dict[str, object]:
        result = validate_shared_semantics()
        self.assert_condition(
            "shared_semantics_have_one_owner",
            result["canonicalDeclarations"] == len(CANONICAL_DECLARATIONS),
            "renderer-neutral declarations resolve only to client-* packages",
        )
        self.assert_condition(
            "desktop_mobile_consume_shared_semantics",
            result["productionConsumerFiles"] == len(REQUIRED_CONSUMERS),
            "Desktop and Mobile consume the same projection, codec, and storage owners",
        )
        self.assert_condition(
            "presentation_policy_stays_in_form_shells",
            result["sharedPresentationLeaks"] == 0,
            "Desktop/Mobile layout and composer policy remain form-specific",
        )
        return {"runtimeCell": "source-only", **result}


def main() -> int:
    return UnifiedClientSharedSemanticsGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
