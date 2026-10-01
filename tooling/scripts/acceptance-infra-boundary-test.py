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
            "Suite Runtime schema, lifecycle ledger, reuse metrics",
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
        self.assertIn("pt-acceptance-pipeline-auditor", business)
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
        self.assertIn(
            "D-21: Multi-Scenario Proof Uses One Suite Runtime",
            decisions,
        )
        self.assertIn("**Status**: accepted", decisions)
        self.assertIn(
            "Acceptance Infra 与业务注入责任防火墙",
            design,
        )
        self.assertIn("Reusable Suite Runtime", design)
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

    def test_submit_pipeline_routes_infra_only_changes(self) -> None:
        makefile = read("tooling/make/acceptance.mk")
        submit_pipeline = read(
            "tooling/scripts/review/submit-pipeline.sh"
        )

        self.assertIn("acceptance-infra-validate:", makefile)
        self.assertIn("--infra", makefile)
        self.assertIn("acceptance-infra-validate", submit_pipeline)
        self.assertIn("acceptance-framework", submit_pipeline)

    def test_procedures_enforce_ownership_classification(self) -> None:
        procedures = read(
            "tooling/skills/pt-acceptance-engineering/PROCEDURES.md"
        )

        self.assertIn("Responsibility Ownership Rule", procedures)
        self.assertIn("ACCEPTANCE_OWNERSHIP_MISCLASSIFIED", procedures)
        self.assertIn(
            "Classify ownership of every touched file",
            procedures,
        )
        self.assertIn("native_visible_runner.py", procedures)
        self.assertIn(
            "Does NOT determine ownership",
            procedures,
        )

    def test_ownership_classification_table(self) -> None:
        """Verify that known paths classify correctly per the rule."""
        procedures = read(
            "tooling/skills/pt-acceptance-engineering/PROCEDURES.md"
        )

        INFRA_PATHS = (
            "tooling/scripts/acceptance-validate.py",
            "tooling/scripts/acceptance-plan.py",
            "tooling/scripts/quality-evidence.py",
            "tooling/acceptance/core/",
            "tooling/scripts/acceptance-run.py",
        )
        BUSINESS_PATHS = (
            "tooling/acceptance/gates/chat/native_visible_runner.py",
            "tooling/acceptance/gates/chat/native_interactions_runner.py",
            "tooling/acceptance/provisioners/home_station.py",
            "tooling/acceptance/gates/chat/native_typing_runner.py",
            "apps/desktop/src/acceptance/chat/harness.ts",
        )

        self.assertIn(
            "Would break ALL Domains if removed",
            procedures,
        )
        self.assertIn(
            "Would break only one Domain if removed",
            procedures,
        )

        for path in BUSINESS_PATHS:
            self.assertNotIn(
                path,
                procedures.split("A file is **Acceptance Infra**")[1].split(
                    "A file is **business injection**"
                )[0],
                msg=f"{path} must not appear in Infra definition section",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
