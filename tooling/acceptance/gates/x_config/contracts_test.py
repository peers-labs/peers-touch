"""Home X Config Acceptance security and lifecycle boundaries."""

import tempfile
import threading
import time
import unittest
from pathlib import Path

from tooling.acceptance.core import ProvisioningError
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.gates.x_config.aggregate import APIAggregateGate
from tooling.acceptance.gates.x_config.browser_report import (
    require_browser_journey,
)
from tooling.acceptance.gates.x_config.home_operator_login import (
    HomeOperatorLoginGate,
)
from tooling.acceptance.gates.x_config.home_publication import (
    HomePublicationGate,
)
from tooling.acceptance.provisioners.x_config_home import (
    HomeRuntimeHandler,
    REMOTE_SCRIPT,
    percentile95,
    private_document,
    service_origin,
)


class BoundaryTests(unittest.TestCase):
    def test_gate_specs_resolve_to_frozen_source_documents(self):
        repo_root = Path(__file__).resolve().parents[4]
        for gate in (
            HomeOperatorLoginGate,
            HomePublicationGate,
            APIAggregateGate,
        ):
            with self.subTest(gate=gate.gate_id):
                self.assertTrue((repo_root / gate.spec[0]).is_file())

    def test_legacy_vercel_runtime_paths_are_absent(self):
        repo_root = Path(__file__).resolve().parents[4]
        for relative in (
            "apps/x-config/api",
            "apps/x-config/bridge",
            "apps/x-config/vercel.json",
            "tooling/skills/pt-x-config-2-vercel",
            "tooling/acceptance/features/x-config-vercel-publication.yaml",
            "tooling/acceptance/environments/x-config-hosting-api.yaml",
            "tooling/acceptance/environments/x-config-production-api.yaml",
            "tooling/acceptance/provisioners/x_config_hosting.py",
            "tooling/acceptance/provisioners/x_config_production.py",
            "tooling/acceptance/gates/x_config/vercel_api.py",
            "tooling/acceptance/gates/x_config/production_api.py",
        ):
            with self.subTest(path=relative):
                self.assertFalse((repo_root / relative).exists())

    def test_private_authority_document_rejects_public_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text("{}", encoding="utf-8")
            path.chmod(0o644)
            with self.assertRaises(ProvisioningError):
                private_document(path)
            path.chmod(0o600)
            self.assertEqual(private_document(path), {})

    def test_home_origin_rejects_vercel_and_non_root_urls(self):
        for raw in (
            "https://peers-x-config.vercel.app",
            "http://xconfig.home.example:28443",
            "https://xconfig.home.example:28443/api",
            "https://user:password@xconfig.home.example:28443",
        ):
            with self.subTest(raw=raw), self.assertRaises(ProvisioningError):
                service_origin(raw)
        self.assertEqual(
            service_origin("https://xconfig.home.example:28443/"),
            "https://xconfig.home.example:28443",
        )

    def test_p95_uses_nearest_rank_and_rejects_invalid_samples(self):
        values = [float(value) for value in range(1, 21)]
        self.assertEqual(percentile95(values), 19)
        for invalid in ([], [1, -1], [1, float("nan")]):
            with self.subTest(invalid=invalid), self.assertRaises(
                ProvisioningError
            ):
                percentile95(invalid)

    def test_operator_handler_enforces_closed_operation_order(self):
        handler = HomeRuntimeHandler(
            "x-config-home-operator-login-e2e",
            {},
            "a" * 40,
            "b" * 40,
            None,
            Path("/tmp"),
        )
        with self.assertRaises(ProvisioningError):
            handler.invoke(
                "restart-with-session",
                {},
                deadline_monotonic=time.monotonic() + 10,
                cancellation=threading.Event(),
            )
        handler.close()

    def test_child_payload_cannot_redirect_parent_authority(self):
        handler = HomeRuntimeHandler(
            "x-config-home-operator-login-e2e",
            {},
            "a" * 40,
            "b" * 40,
            None,
            Path("/tmp"),
        )
        with self.assertRaises(ProvisioningError):
            handler.invoke(
                "service-authority",
                {"service_origin": "other"},
                deadline_monotonic=time.monotonic() + 10,
                cancellation=threading.Event(),
            )
        handler.close()

    def test_cleanup_zeroizes_operator_authority(self):
        handler = HomeRuntimeHandler(
            "x-config-home-operator-login-e2e",
            {},
            "a" * 40,
            "b" * 40,
            None,
            Path("/tmp"),
        )
        secret = bytearray(b"private-value")
        handler.secrets["session"] = secret
        cleanup = handler.close()
        self.assertTrue(cleanup.secrets_zeroized)
        self.assertEqual(secret, bytearray())
        self.assertEqual(handler.sensitive_values, ())

    def test_database_metadata_is_read_inside_container_boundary(self):
        self.assertIn('"docker", "exec", container_name, "stat"', REMOTE_SCRIPT)
        self.assertNotIn("database.stat()", REMOTE_SCRIPT)

    def test_api_publication_cannot_claim_browser_journey(self):
        report = require_browser_journey(
            new_report("x-config-home-publication-e2e")
        )
        report.status = "PASS"
        value = report.to_dict()
        self.assertEqual(value["completionStatus"], "PARTIAL")
        self.assertEqual(value["proofStatus"], "UNPROVEN")
        self.assertFalse(value["sampleEmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
