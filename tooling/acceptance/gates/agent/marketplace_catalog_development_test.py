from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.marketplace_catalog_development import (
    ROOT,
    MarketplaceCatalogError,
    evaluate_marketplace_capture,
)


def valid_capture() -> dict[str, object]:
    package_policies = [
        {
            "packageId": "peers.agent.research-assistant",
            "packageType": "agent",
            "signatureStatus": "verified",
            "scanVerdict": "passed",
            "riskLevel": "high",
            "installPolicy": "confirmation_required",
            "revoked": False,
        },
        {
            "packageId": "peers.skill.evidence-review",
            "packageType": "skill",
            "signatureStatus": "verified",
            "scanVerdict": "passed",
            "riskLevel": "low",
            "installPolicy": "allowed",
            "revoked": False,
        },
        {
            "packageId": "peers.mcp.docs",
            "packageType": "mcp",
            "signatureStatus": "verified",
            "scanVerdict": "passed",
            "riskLevel": "medium",
            "installPolicy": "allowed",
            "revoked": False,
        },
        {
            "packageId": "peers.skill.retired-shell-helper",
            "packageType": "skill",
            "signatureStatus": "verified",
            "scanVerdict": "passed",
            "riskLevel": "high",
            "installPolicy": "blocked",
            "revoked": True,
        },
    ]
    return {
        "assertions": {
            "defaultSourceVerified": True,
            "signedSyncVerified": True,
            "paginationVerified": True,
            "packageTypesVisible": True,
            "packageDetailVisible": True,
            "highRiskConfirmationVisible": True,
            "unacknowledgedRiskRejected": True,
            "agentAuthorityReadback": True,
            "skillAuthorityReadback": True,
            "mcpAuthorityReadback": True,
            "revokedInstallRejected": True,
        },
        "receiver-dom": {
            "marketplaceVisible": True,
            "sourceVisible": True,
            "highRiskConfirmationVisible": True,
        },
        "catalog": {
            "source": {
                "id": "peers-official",
                "builtIn": True,
                "signatureStatus": "verified",
                "trustLevel": "official",
                "publicKeyFingerprint": "sha256:abc",
            },
            "sync": {
                "signatureStatus": "verified",
                "stale": False,
                "error": None,
            },
            "firstPage": {
                "catalogRevision": "2026.09.17.1",
                "nextCursor": "cursor",
                "skills": [package_policies[0]],
            },
            "secondPage": {
                "catalogRevision": "2026.09.17.1",
                "skills": [package_policies[1]],
            },
            "packagePolicies": package_policies,
        },
        "target-readback": {
            "agent": {"id": "agent-1"},
            "skill": {"id": "skill-1"},
            "mcp": {"name": "peers-docs"},
        },
        "revocation": {
            "packageId": "peers.skill.retired-shell-helper",
            "rejected": True,
        },
        "cleanup": {
            "status": "clean",
            "agentRemoved": True,
            "skillRemoved": True,
            "mcpRemoved": True,
        },
    }


class MarketplaceCatalogDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_x3_capture(self) -> None:
        assertions = evaluate_marketplace_capture(valid_capture())
        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_target_authority_readback(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["target-readback"]["skill"] = {}
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "targetAuthoritiesReadBack",
        ):
            evaluate_marketplace_capture(capture)

    def test_rejects_unverified_source(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["catalog"]["source"]["signatureStatus"] = "invalid"
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "defaultSourceVerified",
        ):
            evaluate_marketplace_capture(capture)

    def test_rejects_cursor_revision_drift(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["catalog"]["secondPage"]["catalogRevision"] = "2026.09.17.2"
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "cursorPaginationVerified",
        ):
            evaluate_marketplace_capture(capture)

    def test_rejects_stale_catalog_sync(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["catalog"]["sync"]["stale"] = True
        capture["catalog"]["sync"]["error"] = "catalog source returned HTTP 404"
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "freshSignedSynchronization",
        ):
            evaluate_marketplace_capture(capture)

    def test_runner_uses_production_harness_and_not_frontend_stores(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/marketplace_catalog_development.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"runMarketplaceCatalogDevelopment"', source)
        self.assertIn("HomeStationProvisioner", source)
        self.assertIn("source_identity(ROOT)", source)
        self.assertNotIn("useAgentStore", source)
        self.assertNotIn("useSkillStore", source)
        self.assertNotIn("useMCPStore", source)

    def test_builtin_sync_uses_registered_repository_path(self) -> None:
        source = (
            ROOT
            / "apps/desktop/src-tauri/src/application/skills_market/mod.rs"
        ).read_text(encoding="utf-8")
        sync_fetch = source.split("fn fetch_catalog_envelope", maxsplit=1)[1].split(
            "fn encode_page_cursor",
            maxsplit=1,
        )[0]
        self.assertIn("github_raw_manifest_url(&source.registration())", sync_fetch)
        self.assertNotIn("include_str!", sync_fetch)

    def test_harness_covers_native_surface_and_all_target_authorities(self) -> None:
        source = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        for marker in (
            "runMarketplaceCatalogDevelopment",
            "resource: 'marketplace'",
            "marketplace-page",
            "marketplace-package-detail",
            "MARKETPLACE_RISK_CONFIRMATION_REQUIRED",
            "MARKETPLACE_PACKAGE_REVOKED_OR_BLOCKED",
            "synchronized.stale",
            "api.listAgents()",
            "api.listSkills()",
            "api.listMCPServers()",
            "api.uninstallMarketSkill",
        ):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
