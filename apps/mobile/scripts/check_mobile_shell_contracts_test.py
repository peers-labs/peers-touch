from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CHECKER_PATH = SCRIPT_DIR / "check-mobile-shell-contracts.py"
DEEP_LINK_PATH = SCRIPT_DIR.parent / "src-tauri" / "src" / "platform" / "deep_link.rs"

SPEC = importlib.util.spec_from_file_location(
    "check_mobile_shell_contracts",
    CHECKER_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load Mobile Shell checker: {CHECKER_PATH}")
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class DeepLinkEmissionPartitionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = DEEP_LINK_PATH.read_text(encoding="utf-8")

    def test_accepts_raw_emission_from_non_oauth_handler(self) -> None:
        CHECKER.validate_deep_link_emission_partition(self.source)

    def test_rejects_raw_emission_from_oauth_dispatch_branch(self) -> None:
        unsafe_source = self.source.replace(
            "dispatch_oauth_callback(app, url);",
            "native_events::emit_deep_link(app, url.to_string());",
            1,
        )

        with self.assertRaisesRegex(
            ValueError,
            "OAuth deep links must route only to the OAuth coordinator",
        ):
            CHECKER.validate_deep_link_emission_partition(unsafe_source)

    def test_rejects_raw_emission_from_oauth_callback_handler(self) -> None:
        unsafe_source = self.source.replace(
            "if let Err(error) = handle_native_callback(app, url) {",
            (
                "let _ = native_events::emit_deep_link(app, url.to_string());\n"
                "    if let Err(error) = handle_native_callback(app, url) {"
            ),
            1,
        )

        with self.assertRaisesRegex(
            ValueError,
            "OAuth deep links must not be forwarded raw to Mobile Web",
        ):
            CHECKER.validate_deep_link_emission_partition(unsafe_source)


class WebOAuthSecretBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.non_oauth_commands = """
export interface MessagingActivateInput {
  accessToken: string;
}
"""
        self.oauth_commands = """
export type MobileOAuthProvider = 'github' | 'google';
export interface OAuthStartInput {
  provider: MobileOAuthProvider;
}
"""

    def test_accepts_active_session_token_outside_oauth_contract(self) -> None:
        CHECKER.validate_web_oauth_secret_boundary(
            self.non_oauth_commands + self.oauth_commands,
            "export async function startOAuth() {}",
        )

    def test_rejects_secret_inside_oauth_contract(self) -> None:
        unsafe_source = (
            self.non_oauth_commands
            + self.oauth_commands
            + "export interface OAuthResult { accessToken: string; }\n"
        )

        with self.assertRaisesRegex(
            ValueError,
            "OAuth secret fields crossed into Mobile Web",
        ):
            CHECKER.validate_web_oauth_secret_boundary(unsafe_source, "")


class WebCredentialBoundaryTest(unittest.TestCase):
    def test_reports_credentials_only_from_production_web_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            source_root = mobile_root / "src"
            generated_root = source_root / "gen"
            generated_root.mkdir(parents=True)
            (source_root / "gateway.ts").write_text(
                "const headers = { Authorization: `Bearer ${session.accessToken}` };\n",
                encoding="utf-8",
            )
            (source_root / "gateway.test.ts").write_text(
                "const accessToken = 'test-only';\n",
                encoding="utf-8",
            )
            (generated_root / "session.ts").write_text(
                "export interface Session { accessToken: string }\n",
                encoding="utf-8",
            )

            references = CHECKER.web_credential_references(mobile_root)

        self.assertEqual(references, ["src/gateway.ts:1"])

    def test_accepts_credential_free_operation_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            source_root = mobile_root / "src"
            source_root.mkdir(parents=True)
            (source_root / "stationTransport.ts").write_text(
                "const operationId = 'actor_profile_get';\n",
                encoding="utf-8",
            )

            self.assertEqual(
                CHECKER.web_credential_references(mobile_root),
                [],
            )


class DebugRegionTest(unittest.TestCase):
    def test_reports_debug_regions_only_from_production_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            web_root = mobile_root / "src"
            native_root = mobile_root / "src-tauri" / "src"
            generated_root = web_root / "gen"
            web_root.mkdir(parents=True)
            native_root.mkdir(parents=True)
            generated_root.mkdir(parents=True)
            (web_root / "runtime.ts").write_text(
                "// #region debug-point A:web\n",
                encoding="utf-8",
            )
            (native_root / "runtime.rs").write_text(
                "// #region debug-point B:native\n",
                encoding="utf-8",
            )
            (web_root / "runtime.test.ts").write_text(
                "// #region debug-point C:test\n",
                encoding="utf-8",
            )
            (generated_root / "wire.ts").write_text(
                "// #region debug-point D:generated\n",
                encoding="utf-8",
            )

            references = CHECKER.debug_region_references(mobile_root)

        self.assertEqual(
            references,
            [
                "src/runtime.ts:1",
                "src-tauri/src/runtime.rs:1",
            ],
        )

    def test_accepts_production_source_without_debug_regions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            source_root = mobile_root / "src"
            source_root.mkdir(parents=True)
            (source_root / "runtime.ts").write_text(
                "export const active = true;\n",
                encoding="utf-8",
            )

            self.assertEqual(CHECKER.debug_region_references(mobile_root), [])


class MobileAuthIdentityTest(unittest.TestCase):
    def test_current_auth_surface_matches_the_shared_identity_contract(self) -> None:
        CHECKER.validate_auth_ui_identity()

    def test_rejects_a_mobile_specific_auth_logo(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = (
                root / "apps/desktop/src-tauri/icons/icon.png",
                root / "apps/mobile/src/assets/logo.png",
                root / "packages/prototypes/mobile/chat/src/assets/logo.png",
            )
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"canonical")
            paths[1].write_bytes(b"mobile-only")

            with self.assertRaisesRegex(
                ValueError,
                "must equal the canonical Desktop icon",
            ):
                CHECKER.validate_auth_logo_parity(root)


class CheckerCliTest(unittest.TestCase):
    def test_accepts_pnpm_argument_separator(self) -> None:
        arguments = CHECKER.parse_arguments(["--", "--hard-cut"])

        self.assertTrue(arguments.hard_cut)


class RetiredMobileChatRouteTest(unittest.TestCase):
    def test_reports_retired_routes_only_from_production_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            source_root = mobile_root / "src"
            generated_root = source_root / "gen"
            generated_root.mkdir(parents=True)
            (source_root / "gateway.ts").write_text(
                "const route = '/group-chat/invite';\n",
                encoding="utf-8",
            )
            (source_root / "gateway.test.ts").write_text(
                "expect(route).toBe('/group-chat/invite');\n",
                encoding="utf-8",
            )
            (generated_root / "legacy.ts").write_text(
                "const route = '/friend-chat/block';\n",
                encoding="utf-8",
            )

            references = CHECKER.retired_mobile_chat_route_references(
                mobile_root
            )

        self.assertEqual(references, ["src/gateway.ts:1"])

    def test_accepts_canonical_resource_owner_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            source_root = mobile_root / "src"
            source_root.mkdir(parents=True)
            (source_root / "gateway.ts").write_text(
                "\n".join(
                    (
                        "const command = '/conversation/command';",
                        "const social = '/api/v1/social/friend-request/send';",
                    )
                ),
                encoding="utf-8",
            )

            references = CHECKER.retired_mobile_chat_route_references(
                mobile_root
            )

        self.assertEqual(references, [])

    def test_reports_group_administration_in_generic_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            chat_command_path = (
                mobile_root / "src" / "features" / "chat" / "chatCommands.ts"
            )
            contact_command_path = (
                mobile_root
                / "src"
                / "features"
                / "social"
                / "contactCommands.ts"
            )
            chat_command_path.parent.mkdir(parents=True)
            contact_command_path.parent.mkdir(parents=True)
            chat_command_path.write_text(
                "\n".join(
                    (
                        "import { getInteractionAdmission } from './runtime';",
                        "const CMD_GROUP_UPDATE = 'group.update';",
                    )
                ),
                encoding="utf-8",
            )
            contact_command_path.write_text(
                "\n".join(
                    (
                        "import { getInteractionAdmission } from './runtime';",
                        "const CMD_CREATE_GROUP = 'group.create';",
                    )
                ),
                encoding="utf-8",
            )

            references = CHECKER.generic_group_ledger_references(mobile_root)

        self.assertEqual(
            references,
            [
                "src/features/chat/chatCommands.ts:2",
                "src/features/social/contactCommands.ts:2",
            ],
        )

    def test_accepts_group_creation_through_messaging_engine(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            command_path = (
                mobile_root
                / "src"
                / "features"
                / "social"
                / "contactCommands.ts"
            )
            command_path.parent.mkdir(parents=True)
            command_path.write_text(
                "\n".join(
                    (
                        "import { messagingCreateGroup } from './mobileCommands';",
                        "return messagingCreateGroup(input);",
                    )
                ),
                encoding="utf-8",
            )

            references = CHECKER.generic_group_ledger_references(mobile_root)

        self.assertEqual(references, [])

    def test_reports_opaque_generic_ledger_usage_from_product_surfaces(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            feature_path = (
                mobile_root
                / "src"
                / "features"
                / "social"
                / "contactCommands.ts"
            )
            page_path = mobile_root / "src" / "pages" / "MomentsPage.tsx"
            feature_path.parent.mkdir(parents=True)
            page_path.parent.mkdir(parents=True)
            feature_path.write_text(
                "\n".join(
                    (
                        "import { getInteractionAdmission } from './runtime';",
                        "getInteractionAdmission().admit(command);",
                    )
                ),
                encoding="utf-8",
            )
            page_path.write_text(
                "const admission: InteractionAdmission = runtime;\n",
                encoding="utf-8",
            )

            references = CHECKER.opaque_generic_ledger_references(
                mobile_root
            )

        self.assertEqual(
            references,
            [
                "src/features/social/contactCommands.ts:1",
                "src/features/social/contactCommands.ts:2",
                "src/pages/MomentsPage.tsx:1",
            ],
        )

    def test_accepts_typed_online_and_runtime_owned_command_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            feature_path = (
                mobile_root
                / "src"
                / "features"
                / "social"
                / "contactCommands.ts"
            )
            test_path = feature_path.with_name("contactCommands.test.ts")
            runtime_path = (
                mobile_root
                / "src"
                / "runtimes"
                / "commandRuntime.ts"
            )
            feature_path.parent.mkdir(parents=True)
            runtime_path.parent.mkdir(parents=True)
            feature_path.write_text(
                "return socialFriendRequestSend(input);\n",
                encoding="utf-8",
            )
            test_path.write_text(
                "getInteractionAdmission().admit(command);\n",
                encoding="utf-8",
            )
            runtime_path.write_text(
                "export function getInteractionAdmission() {}\n",
                encoding="utf-8",
            )

            references = CHECKER.opaque_generic_ledger_references(
                mobile_root
            )

        self.assertEqual(references, [])


class RetiredReliabilitySurfaceTest(unittest.TestCase):
    def test_reports_v1_commands_and_browser_only_draft_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            web_path = mobile_root / "src" / "runtimes" / "commandRuntime.ts"
            rust_path = mobile_root / "src-tauri" / "src" / "commands" / "ledger.rs"
            web_path.parent.mkdir(parents=True)
            rust_path.parent.mkdir(parents=True)
            web_path.write_text(
                "\n".join(
                    (
                        "invoke('ledger_initialize', { input });",
                        "window.dispatchEvent(new CustomEvent('recovery:draft-restore'));",
                    )
                ),
                encoding="utf-8",
            )
            rust_path.write_text(
                "pub fn draft_store_initialize() {}\n",
                encoding="utf-8",
            )

            references = CHECKER.retired_reliability_references(mobile_root)

        self.assertEqual(
            references,
            [
                "src/runtimes/commandRuntime.ts:1",
                "src/runtimes/commandRuntime.ts:2",
                "src-tauri/src/commands/ledger.rs:1",
            ],
        )

    def test_accepts_generated_reliability_and_typed_owner_actions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mobile_root = Path(directory)
            web_path = mobile_root / "src" / "runtimes" / "commandRuntime.ts"
            rust_path = mobile_root / "src-tauri" / "src" / "commands" / "ledger.rs"
            web_path.parent.mkdir(parents=True)
            rust_path.parent.mkdir(parents=True)
            web_path.write_text(
                "invoke('reliability_activate', { input });\n",
                encoding="utf-8",
            )
            rust_path.write_text(
                "pub fn reliability_close_scope() {}\n",
                encoding="utf-8",
            )

            references = CHECKER.retired_reliability_references(mobile_root)

        self.assertEqual(references, [])


if __name__ == "__main__":
    unittest.main()
