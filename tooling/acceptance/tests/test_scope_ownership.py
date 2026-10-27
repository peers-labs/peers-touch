"""Registered ownership excludes business work without suppressing shared Infra."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tooling.acceptance.core import ArtifactRef, EvidenceStore
from tooling.acceptance.core.execution_budget import ExecutionBudgetError, freeze_scope
from tooling.acceptance.core.scope_ownership import load_scope_catalog


REPO = Path(__file__).resolve().parents[3]


class ScopeOwnershipTest(unittest.TestCase):
    def test_all_relationships_and_shared_owners_are_retained(self):
        definitions = {name: {"command": "true"} for name in (
            "feature-gate", "registry-gate", "domain-gate", "shared", "infra",
        )}
        capabilities = [{
            "id": "infra-capability", "domain": "included",
            "features": ["shared-feature"], "required_gates": ["infra"],
        }]
        scope = freeze_scope(
            definitions, capabilities, excluded_domains=["excluded"], excluded_gates=[],
            features=[
                {"id": "business", "product_area": "excluded",
                 "required_gates": ["feature-gate"]},
                {"id": "shared-feature", "product_area": "excluded",
                 "required_gates": ["shared"]},
            ],
            domains=[{"id": "excluded", "capabilities": ["infra-capability"],
                      "validation_gate_id": "domain-gate"}],
            rules=[{"id": "business-rule", "features": ["business"],
                    "require": ["registry-gate"]}],
        )
        self.assertEqual(scope["requiredGateIds"], ["shared", "infra"])
        by_id = {item["gateId"]: item for item in scope["decisions"]}
        self.assertEqual(by_id["shared"]["domains"], ["excluded", "included"])
        self.assertEqual(by_id["infra"]["domains"], ["included"])
        for name, kind in (
            ("feature-gate", "feature"), ("registry-gate", "registry"),
            ("domain-gate", "domain-validation"),
        ):
            self.assertEqual(by_id[name]["reason"], "excluded-domain-only")
            self.assertEqual(by_id[name]["ownershipSources"][0]["kind"], kind)

    def test_unknown_feature_is_a_gap_and_never_infers_owner_from_name(self):
        scope = freeze_scope(
            {"business-prefixed-infra": {"command": "true"}}, [],
            excluded_domains=["excluded"], excluded_gates=[],
            domains=[{"id": "excluded"}],
            rules=[{"id": "excluded-rule", "features": ["missing"],
                    "require": ["business-prefixed-infra"]}],
        )
        self.assertEqual(scope["requiredGateIds"], ["business-prefixed-infra"])
        self.assertEqual(scope["decisions"][0]["domains"], [])
        self.assertEqual(scope["unresolvedFeatureReferences"], [{
            "kind": "registry", "id": "excluded-rule", "featureId": "missing",
        }])

    def test_invalid_duplicate_and_missing_contracts_fail_closed(self):
        cases = (
            {"features": [{"id": "duplicate"}, {"id": "duplicate"}]},
            {"features": [{"id": "feature", "required_gates": ["missing"]}]},
            {"rules": [{"id": "rule", "require": ["missing"]}]},
            {"domains": [{"id": "domain", "validation_gate_id": "missing"}]},
            {"domains": [{"id": "domain", "capabilities": ["missing"]}]},
        )
        for contracts in cases:
            with self.subTest(contracts=contracts), self.assertRaises(ExecutionBudgetError):
                freeze_scope({"gate": {"command": "true"}}, [],
                             excluded_domains=[], excluded_gates=[], **contracts)

    def test_feature_change_invalidates_the_frozen_scope_identity(self):
        definitions = {"gate": {"command": "true"}}
        features = [{"id": "feature", "product_area": "first", "required_gates": ["gate"]}]
        first = freeze_scope(definitions, [], excluded_domains=[], excluded_gates=[],
                             features=features)
        features[0]["product_area"] = "second"
        second = freeze_scope(definitions, [], excluded_domains=[], excluded_gates=[],
                              features=features)
        self.assertNotEqual(first["ownershipDigest"], second["ownershipDigest"])
        self.assertNotEqual(first["digest"], second["digest"])

    def test_repeated_registry_ids_preserve_every_rule_and_its_position(self):
        scope = freeze_scope(
            {"shared": {"command": "true"}}, [],
            excluded_domains=["excluded"], excluded_gates=[],
            features=[
                {"id": "first", "product_area": "excluded"},
                {"id": "second", "product_area": "included"},
            ],
            rules=[
                {"id": "same-id", "features": ["first"], "require": ["shared"]},
                {"id": "same-id", "features": ["second"], "require": ["shared"]},
            ],
        )
        self.assertEqual(scope["requiredGateIds"], ["shared"])
        self.assertEqual(scope["decisions"][0]["domains"], ["excluded", "included"])
        self.assertEqual(
            [item["registryIndex"] for item in scope["decisions"][0]["ownershipSources"]],
            [0, 1],
        )

    def test_loader_rejects_duplicate_json_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "registry.yaml").write_text('{"rules":[],"rules":[]}')
            with self.assertRaises(ValueError):
                load_scope_catalog(root)

    def test_real_runner_uses_selected_catalog_and_never_dispatches_excluded_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "features").mkdir()
            (root / "domains").mkdir()
            (root / "features/business.yaml").write_text(json.dumps({
                "id": "business", "product_area": "excluded",
                "required_gates": ["feature-gate"],
            }))
            (root / "domains/excluded.yaml").write_text(json.dumps({
                "id": "excluded", "validation_gate_id": "domain-gate",
            }))
            (root / "registry.yaml").write_text(json.dumps({"rules": [{
                "id": "business-rule", "features": ["business"], "require": ["registry-gate"],
            }]}))
            excluded_marker = root / "excluded-dispatched"
            included_marker = root / "included-dispatched"
            catalog = root / "gates.yaml"
            catalog.write_text(json.dumps({"gates": {
                name: {
                    "argv": [
                        sys.executable, "-c",
                        f"from pathlib import Path;Path({str(marker)!r}).touch()",
                    ],
                    "timeout_seconds": 5, "environment": "local", "tier": "ci-cheap",
                }
                for name, marker in (
                    ("feature-gate", excluded_marker), ("registry-gate", excluded_marker),
                    ("domain-gate", excluded_marker), ("business-prefixed-infra", included_marker),
                )
            }}))
            policy = root / "policy.json"
            policy.write_text(json.dumps({
                "requestSeconds": 25, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 2, "publishSeconds": 2}, "gates": {},
            }))
            completed = subprocess.run(
                [
                    sys.executable, "-B", str(REPO / "tooling/scripts/acceptance-run.py"),
                    "--all-gates", "--exclude-domain", "excluded", "--gates", str(catalog),
                    "--execution-budget", str(policy),
                ],
                cwd=REPO, capture_output=True, text=True, timeout=35,
                env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertTrue(included_marker.is_file())
            self.assertFalse(excluded_marker.exists())
            markers = [
                line.removeprefix("execution-session-manifest: ")
                for line in completed.stdout.splitlines()
                if line.startswith("execution-session-manifest: ")
            ]
            self.assertEqual(len(markers), 1)
            ref = ArtifactRef.from_dict(json.loads(markers[0]))
            store = EvidenceStore(root / "evidence", worktree=REPO)
            manifest = store.read_run_manifest(ref, manifest_sha256=ref.sha256)
            session = store.read_json(ArtifactRef.from_dict(
                manifest["artifacts"]["execution-session"],
            ))
            self.assertEqual(session["requiredGateIds"], ["business-prefixed-infra"])
            self.assertEqual(session["state"], "QUALIFIED")


if __name__ == "__main__":
    unittest.main()
