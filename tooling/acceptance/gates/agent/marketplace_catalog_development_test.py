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
            "officialStationTransportVerified": True,
            "tamperedTransportRejected": True,
            "oldStationMarkedStale": True,
            "transportRecovered": True,
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
                "transportKind": "official_station",
                "url": "",
                "branch": None,
                "manifestPath": "",
                "publicKeyFingerprint": "sha256:abc",
            },
            "sync": {
                "signatureStatus": "verified",
                "syncState": "fresh_verified",
                "transportKind": "official_station",
                "transportEndpoint": "/sub-agent/agent/package-catalog/official",
                "distributionId": "peers-official-station-v1",
                "envelopeSha256": "a" * 64,
                "catalogRevision": "2026.09.17.1",
                "stale": False,
                "error": None,
            },
            "negativeTransport": {
                "tampered": {
                    "signatureStatus": "verified",
                    "syncState": "stale_verified",
                    "stale": True,
                    "error": "OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID",
                    "catalogRevision": "2026.09.17.1",
                },
                "oldStation": {
                    "signatureStatus": "verified",
                    "syncState": "stale_verified",
                    "stale": True,
                    "error": "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE",
                    "catalogRevision": "2026.09.17.1",
                },
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
        "catalog-proxy": {
            "targetPath": "/sub-agent/agent/package-catalog/official",
            "requestCount": 4,
            "actions": ["pass", "tamper", "missing", "pass"],
            "responseSha256": ["a" * 64, "b" * 64, "a" * 64],
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
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST", source)
        self.assertIn("load_runtime_manifest", source)
        self.assertNotIn("HomeStationProvisioner", source)
        self.assertNotIn(".provision(", source)
        self.assertNotIn("provisioner.cleanup", source)
        self.assertIn("source_identity(ROOT)", source)
        self.assertNotIn("useAgentStore", source)
        self.assertNotIn("useSkillStore", source)
        self.assertNotIn("useMCPStore", source)

    def test_builtin_sync_uses_authenticated_station_transport(self) -> None:
        source = (
            ROOT
            / "apps/desktop/src-tauri/src/application/skills_market/mod.rs"
        ).read_text(encoding="utf-8")
        sync_fetch = source.split("fn fetch_catalog_envelope", maxsplit=1)[1].split(
            "fn encode_page_cursor",
            maxsplit=1,
        )[0]
        self.assertIn("TRANSPORT_OFFICIAL_STATION", sync_fetch)
        self.assertIn("OFFICIAL_CATALOG_ENDPOINT", sync_fetch)
        self.assertIn("station_client::request_proto", sync_fetch)
        self.assertIn("TRANSPORT_USER_PINNED_GITHUB", sync_fetch)
        self.assertNotIn("PEERS_MARKETPLACE_CATALOG_OVERRIDE", sync_fetch)
        self.assertNotIn("include_str!", sync_fetch)

    def test_official_catalog_has_one_canonical_asset_and_generated_station_projection(
        self,
    ) -> None:
        canonical = (
            ROOT
            / "packages/agent-catalog/official-catalog.v1.envelope.json"
        )
        old_desktop_copy = (
            ROOT
            / "apps/desktop/src-tauri/src/application/skills_market/"
            "official-catalog.v1.envelope.json"
        )
        verifier = (
            ROOT
            / "apps/desktop/src-tauri/src/application/skills_market/"
            "trusted_catalog.rs"
        ).read_text(encoding="utf-8")
        generator = (
            ROOT
            / "apps/station/app/subserver/agent/catalog/generate/main.go"
        ).read_text(encoding="utf-8")
        self.assertTrue(canonical.is_file())
        self.assertFalse(old_desktop_copy.exists())
        self.assertIn("include_bytes!", verifier)
        self.assertIn(
            "packages/agent-catalog/official-catalog.v1.envelope.json",
            verifier,
        )
        self.assertIn(
            'assetRelativePath  = "packages/agent-catalog/'
            'official-catalog.v1.envelope.json"',
            generator,
        )

    def test_station_registers_authenticated_proto_catalog_endpoint(self) -> None:
        station = (
            ROOT / "apps/station/app/subserver/agent/agent.go"
        ).read_text(encoding="utf-8")
        proto = (
            ROOT / "model/domain/agent/package_catalog.proto"
        ).read_text(encoding="utf-8")
        route = (
            'server.NewTypedHandler("agent-package-catalog-official", '
            '"/agent/package-catalog/official", server.GET, '
            "packageCatalogHandlers.HandleOfficial, logIDWrapper, jwtWrapper)"
        )
        self.assertIn(route, station)
        for field in (
            "bytes envelope_json = 1",
            "string media_type = 2",
            "string distribution_id = 3",
            "string envelope_sha256 = 4",
        ):
            self.assertIn(field, proto)

    def test_rejects_non_station_official_transport(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["catalog"]["sync"]["transportKind"] = "user_pinned_github"
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "officialStationTransportVerified",
        ):
            evaluate_marketplace_capture(capture)

    def test_rejects_invalid_station_transport_digest(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["catalog"]["sync"]["syncState"] = "stale_verified"
        capture["catalog"]["sync"]["stale"] = True
        capture["catalog"]["sync"]["error"] = (
            "OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID"
        )
        with self.assertRaisesRegex(
            MarketplaceCatalogError,
            "freshSignedSynchronization",
        ):
            evaluate_marketplace_capture(capture)

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
            "synchronized.transportKind",
            "synchronized.distributionId",
            "synchronized.envelopeSha256",
            "OFFICIAL_CATALOG_TRANSPORT_DIGEST_INVALID",
            "OFFICIAL_CATALOG_ENDPOINT_UNAVAILABLE",
            "recoveredSync.syncState",
            "api.listAgents()",
            "api.listSkills()",
            "api.listMCPServers()",
            "api.uninstallMarketSkill",
        ):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
