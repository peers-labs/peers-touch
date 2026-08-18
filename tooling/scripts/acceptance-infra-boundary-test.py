#!/usr/bin/env python3
"""Validate the Acceptance Infra responsibility firewall."""

from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


class AcceptanceInfraBoundaryTests(unittest.TestCase):
    def test_canonical_skill_declares_responsibility_firewall(self) -> None:
        skill = read(
            "tooling/skills/pt-acceptance-infra-engineering/SKILL.md"
        )

        required_markers = (
            'name: "pt-acceptance-infra-engineering"',
            "BUSINESS_INJECTION_REQUIRED",
            "acceptance_core_self_validation",
            "product_domain_validates_acceptance",
            "Infra never manufactures, repairs, weakens, or completes business injection",
            "Ownership Matrix",
        )
        for marker in required_markers:
            self.assertIn(marker, skill)

    def test_agent_handbook_and_workflow_route_by_ownership(self) -> None:
        agents = read("AGENTS.md")
        workflow = read("docs/global/workflow.md")

        self.assertIn("pt-acceptance-infra-engineering", agents)
        self.assertIn("Acceptance Infra ownership first", agents)
        self.assertIn("Acceptance ownership dispatch", agents)
        self.assertIn("Route Acceptance work by ownership", workflow)
        self.assertIn("BUSINESS_INJECTION_REQUIRED", workflow)
        self.assertIn(
            "Business Gate `FAILED`, `BLOCKED`, or `UNPROVEN` does not block",
            workflow,
        )

    def test_acceptance_skills_have_disjoint_entrypoints(self) -> None:
        infra = read(
            "tooling/skills/pt-acceptance-infra-engineering/SKILL.md"
        )
        business = read("tooling/skills/pt-acceptance-engineering/SKILL.md")
        god_view = read("tooling/skills/pt-god-view/SKILL.md")

        self.assertIn(
            "Business Domain onboarding, Gate implementation, product proof",
            infra,
        )
        self.assertIn(
            "Acceptance Infra optimization is owned by",
            business,
        )
        self.assertIn("ACCEPTANCE_INFRA_REQUIRED", business)
        self.assertIn("Need to optimize/audit Acceptance Infra", god_view)
        self.assertIn("Need business Domain Acceptance injection/proof", god_view)

    def test_architecture_records_accepted_boundary(self) -> None:
        decisions = read(
            "docs/architecture/acceptance-framework/decisions.md"
        )
        design = read("docs/architecture/acceptance-framework/design.md")

        self.assertIn(
            "D-12: Acceptance Infra 与业务注入使用独立责任平面",
            decisions,
        )
        self.assertIn("**Status**: accepted", decisions)
        self.assertIn(
            "Acceptance Infra 与业务注入责任防火墙",
            design,
        )
        self.assertIn("Infra impact: non-blocking", design)

    def test_quality_evidence_separates_reverse_validation(self) -> None:
        quality = read("tooling/scripts/quality-evidence.py")

        self.assertIn("blocking_unproven_scope", quality)
        self.assertIn("informational_unproven_scope", quality)
        self.assertIn(
            'direction == "product_domain_validates_acceptance"',
            quality,
        )
        self.assertIn(
            'evidence["acceptance"]["blocking_unproven_scope"]',
            quality,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
