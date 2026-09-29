from __future__ import annotations

import json
import unittest

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.provisioning import ProvisioningState
from tooling.acceptance.provisioners import (
    StationAccessLoginBrowserProvisioner,
    get_provisioner,
)


ENVIRONMENT_ID = "station-access-login-browser"
GATE_ID = "station-access-desktop-oauth-layout-e2e"


class StationAccessDesktopOAuthLayoutAcceptanceTests(unittest.TestCase):
    def test_environment_resolves_registered_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )

        provisioner = get_provisioner(contract)

        self.assertIsInstance(
            provisioner,
            StationAccessLoginBrowserProvisioner,
        )

    def test_provisioner_emits_clean_browser_runtime_identity(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )
        provisioner = StationAccessLoginBrowserProvisioner(contract)
        provisioner._git_commit = lambda: "a" * 40
        provisioner._git_workspace_digest = lambda: "clean"

        manifest = provisioner.provision(GATE_ID)

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, ENVIRONMENT_ID)
        self.assertEqual(manifest.clients[0].runtime, "browser")
        self.assertEqual(manifest.clients[0].actor, "unauthenticated-user")
        self.assertEqual(manifest.clients[0].required_service_roles, ())

    def test_gate_declares_the_browser_provisioner(self) -> None:
        gates = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(encoding="utf-8")
        )["gates"]

        gate = gates[GATE_ID]
        self.assertEqual(gate["environment"], ENVIRONMENT_ID)
        self.assertEqual(gate["provisioner"], ENVIRONMENT_ID)

    def test_journey_covers_both_providers_viewports_and_geometry(self) -> None:
        driver = (
            ENVIRONMENTS_DIR.parent
            / "gates"
            / "station_access"
            / "desktop_oauth_layout_e2e.mjs"
        ).read_text(encoding="utf-8")

        for required_source in (
            "{ id: 'wide-1200x800', width: 1200, height: 800",
            "{ id: 'narrow-640x800', width: 640, height: 800",
            "const providers = ['github', 'google'];",
            "[data-pt-login-card]",
            "[data-pt-login-oauth-provider=",
            "[data-pt-login-oauth-action=",
            "[data-pt-login-oauth-cancel=",
            "[data-pt-login-oauth-state=\"waiting\"]",
            "[data-pt-login-oauth-state=\"error\"]",
            "[data-pt-login-oauth-state=\"initializing\"]",
            "[data-pt-login-oauth-state=\"success\"]",
            "document.querySelectorAll('[data-pt-login-oauth-panel]').length",
            "assertStableRect(geometries.idle.card, geometry.card",
            "assertStableRect(geometries.idle.action, geometry.action",
            "document.activeElement?.getAttribute('data-pt-login-oauth-cancel')",
            "document.activeElement?.getAttribute('data-pt-login-oauth-provider')",
            "document.activeElement?.getAttribute('data-pt-login-oauth-action')",
            "page.screenshot({ path: screenshotPath })",
            "writeFileSync(domPath, await page.content()",
            "invocation.command === 'oauth2_start_loopback'",
            "invocation.command === 'oauth2_cancel_loopback'",
        ):
            with self.subTest(required_source=required_source):
                self.assertIn(required_source, driver)

    def test_gate_publishes_canonical_evidence_report(self) -> None:
        gate = (
            ENVIRONMENTS_DIR.parent
            / "gates"
            / "station_access"
            / "desktop_oauth_layout_e2e.py"
        ).read_text(encoding="utf-8")

        for required_source in (
            "with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id)",
            '"artifactKind": "acceptance-gate-evidence-report"',
            '"completionStatus": completion_status',
            '"proofStatus": proof_status',
            '"phase": self.phase',
            '"bom": list(self.bom)',
            '"spec": list(self.spec)',
            "station-access-desktop-oauth-layout-evidence.json",
        ):
            with self.subTest(required_source=required_source):
                self.assertIn(required_source, gate)


if __name__ == "__main__":
    unittest.main()
