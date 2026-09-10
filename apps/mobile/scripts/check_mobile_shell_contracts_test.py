from __future__ import annotations

import importlib.util
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


class CheckerCliTest(unittest.TestCase):
    def test_accepts_pnpm_argument_separator(self) -> None:
        arguments = CHECKER.parse_arguments(["--", "--hard-cut"])

        self.assertTrue(arguments.hard_cut)


if __name__ == "__main__":
    unittest.main()
