from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.chat.lifecycle_safety import (
    REPO_ROOT,
    scan_repository,
)


class ChatLifecycleSafetyTests(unittest.TestCase):
    def test_current_repository_has_no_safety_findings(self) -> None:
        self.assertEqual(scan_repository(REPO_ROOT), [])

    def test_detects_hard_coded_collector_and_debug_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "apps"
                / "station"
                / "app"
                / "subserver"
                / "conversation"
                / "unsafe.go"
            )
            source.parent.mkdir(parents=True)
            source.write_text(
                """
package conversation

// #region debug-point unsafe
const collector = "http://10.0.0.1:7784/event"
""".lstrip(),
                encoding="utf-8",
            )
            self._write_safe_search_contract(root)

            codes = {finding.code for finding in scan_repository(root)}

            self.assertEqual(
                codes,
                {
                    "debug-instrumentation-marker",
                    "hard-coded-collector-url",
                },
            )

    def test_detects_missing_explicit_federation_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            action_path = root / "apps" / "mobile" / "src" / "acceptance" / "actions.ts"
            action_path.parent.mkdir(parents=True)
            action_path.write_text(
                """
export const actions = {
  'social.people.search': async () => {
    return [{}];
  },
  'social.request.send': async () => undefined,
};
""".lstrip(),
                encoding="utf-8",
            )
            contract_path = action_path.with_name("contracts.ts")
            contract_path.write_text(
                """
export interface SocialPeopleSearchActionInput {
  query: string;
}
""".lstrip(),
                encoding="utf-8",
            )

            codes = {finding.code for finding in scan_repository(root)}

            self.assertEqual(
                codes,
                {
                    "explicit-federation-context-missing",
                    "federation-context-contract-missing",
                    "scoped-federation-projection-missing",
                },
            )

    def test_detects_desktop_federation_identity_without_readback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._write_safe_search_contract(root)
            harness_path = (
                root
                / "apps"
                / "desktop"
                / "src"
                / "acceptance"
                / "chat"
                / "harness.ts"
            )
            harness_path.parent.mkdir(parents=True)
            harness_path.write_text(
                """
export const harness = {
  async federationContext() {
    return { federations: [{ federationId: 'asserted' }] };
  },
  async createDirectConversation() {},
};
""".lstrip(),
                encoding="utf-8",
            )

            codes = {finding.code for finding in scan_repository(root)}

            self.assertEqual(
                codes,
                {
                    "desktop-federation-readback-missing",
                    "desktop-observed-identity-missing",
                },
            )

    def _write_safe_search_contract(self, root: Path) -> None:
        action_path = root / "apps" / "mobile" / "src" / "acceptance" / "actions.ts"
        action_path.parent.mkdir(parents=True, exist_ok=True)
        action_path.write_text(
            """
export const actions = {
  'social.people.search': async (input) => {
    const contextId = requireString(input.federationId);
    const results = searchSocialPeople(input.query, contextId);
    return results.map((result) => ({
      federationId: contextId,
    }));
  },
  'social.request.send': async () => undefined,
};
""".lstrip(),
            encoding="utf-8",
        )
        action_path.with_name("contracts.ts").write_text(
            """
export interface SocialPeopleSearchActionInput {
  query: string;
  federationId: string;
}
""".lstrip(),
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
