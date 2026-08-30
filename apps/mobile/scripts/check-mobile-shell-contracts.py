#!/usr/bin/env python3
"""Validate the Mobile Shell Acceptance contract wiring."""

from __future__ import annotations

import ast
import argparse
import json
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
ACCEPTANCE_ROOT = REPO_ROOT / "tooling" / "acceptance"

EXPECTED_CAPABILITIES = {
    "mobile-station-access",
    "mobile-runtime-lifecycle",
    "mobile-command-recovery",
    "mobile-social-product",
    "mobile-native-quality",
}
EXPECTED_FEATURES = {
    "mobile-station-trust",
    "mobile-access-gate-oauth",
    "mobile-session-lifecycle",
    "mobile-command-draft-recovery",
    "mobile-recovery-degraded-states",
    "mobile-chat-contacts-groups",
    "mobile-moments-participation",
    "mobile-profile-settings",
    "mobile-native-accessibility-performance",
}
EXPECTED_SERVICES = {
    "station-primary": "station",
    "station-secondary": "station",
    "relay": "relay",
}
EXPECTED_NATIVE_PLUGINS = {
    "tauri-plugin-deep-link": "=2.4.9",
    "tauri-plugin-opener": "=2.5.4",
}


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path.relative_to(REPO_ROOT)} must contain an object")
    return payload


def runtime_manifest_fields() -> set[str]:
    source = (
        ACCEPTANCE_ROOT / "core" / "provisioning.py"
    ).read_text(encoding="utf-8")
    module = ast.parse(source)
    for node in module.body:
        if isinstance(node, ast.ClassDef) and node.name == "RuntimeManifest":
            return {
                child.target.id
                for child in node.body
                if isinstance(child, ast.AnnAssign)
                and isinstance(child.target, ast.Name)
            }
    raise ValueError("RuntimeManifest class is missing")


def validate_native_oauth_adapters() -> None:
    mobile_root = REPO_ROOT / "apps" / "mobile"
    tauri_root = mobile_root / "src-tauri"

    cargo_source = (tauri_root / "Cargo.toml").read_text(encoding="utf-8")
    actual_plugins = {
        name: match.group(1) if (
            match := re.search(
                rf"(?m)^{re.escape(name)}\s*=\s*\"([^\"]+)\"$",
                cargo_source,
            )
        ) else None
        for name in EXPECTED_NATIVE_PLUGINS
    }
    if actual_plugins != EXPECTED_NATIVE_PLUGINS:
        raise ValueError(
            f"Mobile native plugin versions differ: {actual_plugins}"
        )
    config = load_json(tauri_root / "tauri.conf.json")
    deep_link = config.get("plugins", {}).get("deep-link", {})
    expected_mobile = [
        {
            "scheme": ["peers-touch"],
            "host": "oauth",
            "path": ["/callback"],
            "appLink": False,
        }
    ]
    if deep_link.get("mobile") != expected_mobile:
        raise ValueError(
            "Deep-link mobile config must register only "
            "peers-touch://oauth/callback"
        )

    lib_source = (tauri_root / "src" / "lib.rs").read_text(encoding="utf-8")
    required_registration = (
        ".plugin(tauri_plugin_opener::init())",
        ".plugin(tauri_plugin_deep_link::init())",
        ".setup(platform::deep_link::install)",
    )
    missing_registration = [
        token for token in required_registration if token not in lib_source
    ]
    if missing_registration:
        raise ValueError(
            f"Mobile native plugin registration is missing: {missing_registration}"
        )

    browser_source = (
        tauri_root / "src" / "platform" / "browser.rs"
    ).read_text(encoding="utf-8")
    if "OpenerExt" not in browser_source or ".opener()" not in browser_source:
        raise ValueError("OAuth browser launch must use OpenerExt")
    forbidden_browser_tokens = (
        "std::process::Command",
        "UIKit",
        "objc_msgSend",
        "MOBILE_UNSUPPORTED_PLATFORM",
    )
    present_browser_tokens = [
        token for token in forbidden_browser_tokens if token in browser_source
    ]
    if present_browser_tokens:
        raise ValueError(
            f"Ad hoc OAuth browser paths remain: {present_browser_tokens}"
        )

    deep_link_source = (
        tauri_root / "src" / "platform" / "deep_link.rs"
    ).read_text(encoding="utf-8")
    required_callback_tokens = (
        ".on_open_url(",
        ".get_current()",
        'const OAUTH_CALLBACK_SCHEME: &str = "peers-touch"',
        'const OAUTH_CALLBACK_HOST: &str = "oauth"',
        'const OAUTH_CALLBACK_PATH: &str = "/callback"',
        "fn handle_native_callback",
    )
    missing_callback_tokens = [
        token for token in required_callback_tokens
        if token not in deep_link_source
    ]
    if missing_callback_tokens:
        raise ValueError(
            f"OAuth deep-link routing is incomplete: {missing_callback_tokens}"
        )
    if deep_link_source.count("native_events::emit_oauth_projection") != 1:
        raise ValueError(
            "OAuth deep links must emit one sanitized public projection"
        )
    if "native_events::emit_deep_link" in deep_link_source:
        raise ValueError("OAuth deep links must not be forwarded raw to Mobile Web")

    package = load_json(mobile_root / "package.json")
    npm_dependencies = {
        **package.get("dependencies", {}),
        **package.get("devDependencies", {}),
    }
    forbidden_npm = {
        "@tauri-apps/plugin-deep-link",
        "@tauri-apps/plugin-opener",
    }
    present_npm = sorted(forbidden_npm.intersection(npm_dependencies))
    if present_npm:
        raise ValueError(f"W2-D must not add npm plugin dependencies: {present_npm}")


def validate_web_oauth_hard_cut() -> None:
    mobile_root = REPO_ROOT / "apps" / "mobile"
    commands_path = mobile_root / "src" / "services" / "mobileCommands.ts"
    runtime_path = mobile_root / "src" / "runtimes" / "authRuntime.ts"
    bridge_path = mobile_root / "src" / "runtimes" / "mobileNativeEventBridge.ts"
    gateway_path = mobile_root / "src" / "features" / "auth" / "mobileOAuthGateway.ts"

    if gateway_path.exists():
        raise ValueError("Web OAuth gateway must be deleted after the Rust hard cut")

    commands_source = commands_path.read_text(encoding="utf-8")
    runtime_source = runtime_path.read_text(encoding="utf-8")
    bridge_source = bridge_path.read_text(encoding="utf-8")

    required_commands = (
        "'oauth_start', { input }",
        "'oauth_status', { input }",
        "'oauth_cancel', { input }",
        "'oauth_restore', { input }",
        "'oauth_retry_browser'",
        "'oauth_projection'",
    )
    missing_commands = [
        token for token in required_commands if token not in commands_source
    ]
    if missing_commands:
        raise ValueError(
            f"Mobile Web OAuth intents are incomplete: {missing_commands}"
        )

    forbidden_legacy_commands = (
        "oauth_prepare_attempt",
        "oauth_bind_attempt",
        "oauth_claim_callback",
        "oauth_forget_attempt",
        "oauth_open_authorize_url",
    )
    combined_source = commands_source + runtime_source
    present_legacy_commands = [
        token for token in forbidden_legacy_commands if token in combined_source
    ]
    if present_legacy_commands:
        raise ValueError(
            f"Legacy Web OAuth commands remain: {present_legacy_commands}"
        )

    forbidden_runtime_patterns = {
        "Web OAuth fetch": r"\bfetch\s*\(",
        "Web OAuth gateway import": r"mobileOAuthGateway",
        "raw callback dispatch": r"dispatchAuthRuntimeDeepLink",
        "callback URL parsing": r"\bnew\s+URL\s*\(|isOAuthCallbackUrl",
        "Web expiry authority": r"\bsetTimeout\s*\(|\bclearTimeout\s*\(",
        "Web session activation": r"activateStationSession|window\.location\.reload",
    }
    present_runtime_patterns = [
        label
        for label, pattern in forbidden_runtime_patterns.items()
        if re.search(pattern, runtime_source)
    ]
    if present_runtime_patterns:
        raise ValueError(
            f"Web OAuth authority remains in authRuntime: {present_runtime_patterns}"
        )

    forbidden_secret_fields = (
        "pkceVerifier",
        "pkceChallenge",
        "pkceMethod",
        "nonce",
        "nonceHash",
        "attemptHandle",
        "attemptSecret",
        "deliveryPrivateKey",
        "authorizationCode",
        "callbackUrl",
        "authorizeUrl",
        "oauthAttemptId",
        "credentialEnvelope",
        "accessToken",
        "refreshToken",
    )
    present_secret_fields = [
        field
        for field in forbidden_secret_fields
        if re.search(rf"\b{re.escape(field)}\b", combined_source)
    ]
    if present_secret_fields:
        raise ValueError(
            f"OAuth secret fields crossed into Mobile Web: {present_secret_fields}"
        )

    oauth_commands_source = commands_source[commands_source.index(
        "export async function oauthStart"
    ):]
    if "secure_storage_" in oauth_commands_source:
        raise ValueError("Web OAuth intents must not call generic secure storage")

    required_projection_bridge = (
        "'mobile:oauth-projection'",
        "applyAuthRuntimeProjection(event.payload)",
    )
    missing_projection_bridge = [
        token for token in required_projection_bridge if token not in bridge_source
    ]
    if missing_projection_bridge:
        raise ValueError(
            f"OAuth projection subscription is incomplete: {missing_projection_bridge}"
        )
    if "dispatchAuthRuntimeDeepLink" in bridge_source:
        raise ValueError("Raw OAuth deep-link dispatch remains in Mobile Web")


def validate() -> None:
    domain = load_json(ACCEPTANCE_ROOT / "domains" / "mobile.yaml")
    if domain.get("id") != "mobile":
        raise ValueError("Mobile Domain profile id must be 'mobile'")

    capabilities = load_json(
        ACCEPTANCE_ROOT / "capabilities" / "mobile.yaml"
    ).get("capabilities", [])
    capability_ids = {item.get("id") for item in capabilities}
    if capability_ids != EXPECTED_CAPABILITIES:
        raise ValueError(
            f"Mobile Capability IDs differ: {sorted(capability_ids)}"
        )

    feature_ids = {
        load_json(path).get("id")
        for path in (
            ACCEPTANCE_ROOT / "features"
        ).glob("mobile-*.yaml")
    }
    if feature_ids != EXPECTED_FEATURES:
        raise ValueError(f"Mobile Feature IDs differ: {sorted(feature_ids)}")

    environment = load_json(
        ACCEPTANCE_ROOT / "environments" / "mobile-native.yaml"
    )
    services = environment.get("services")
    actual_services = {
        service_id: service.get("kind")
        for service_id, service in services.items()
    } if isinstance(services, dict) else {}
    if actual_services != EXPECTED_SERVICES:
        raise ValueError(
            f"Mobile service topology differs: {actual_services}"
        )

    fields = runtime_manifest_fields()
    if "services" not in fields or "station" in fields:
        raise ValueError(
            "RuntimeManifest must expose only the typed services map"
        )
    validate_native_oauth_adapters()
    validate_web_oauth_hard_cut()


def validate_hard_cut() -> None:
    required_paths = (
        "src/app/lifecycle/MobileLifecycleKernel.ts",
        "src/runtimes/commandRuntime.ts",
        "src-tauri/src/runtime/command_ledger",
        "src-tauri/src/runtime/draft_store",
    )
    missing = [
        path
        for path in required_paths
        if not (REPO_ROOT / "apps" / "mobile" / path).exists()
    ]
    if missing:
        raise ValueError(f"Mobile hard-cut owners are missing: {missing}")

    provisioning_source = (
        ACCEPTANCE_ROOT / "core" / "provisioning.py"
    ).read_text(encoding="utf-8")
    forbidden = (
        "station: StationAttestation",
        'result["station"]',
    )
    present = [token for token in forbidden if token in provisioning_source]
    if present:
        raise ValueError(f"legacy RuntimeManifest paths remain: {present}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hard-cut", action="store_true")
    args = parser.parse_args()
    try:
        validate()
        if args.hard_cut:
            validate_hard_cut()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        sys.stderr.write(f"mobile shell contract validation failed: {error}\n")
        return 1
    sys.stdout.write("mobile shell contracts: PASS\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
