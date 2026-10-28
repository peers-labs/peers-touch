#!/usr/bin/env python3
"""Structural tests for active Acceptance documentation.

These tests keep the boundary between current-state authority, non-normative
proposals, and historical material machine-checked, so humans and Agents can
trust the active entry points without reading Git archaeology.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ACCEPTANCE_DOCS = REPO_ROOT / "docs" / "architecture" / "engineering" / "acceptance"
TOOLING_ACCEPTANCE = REPO_ROOT / "tooling" / "acceptance"
ACTIVE_README = ACCEPTANCE_DOCS / "README.md"
TOOLING_README = TOOLING_ACCEPTANCE / "README.md"
SUMMARY_TEMPLATE = TOOLING_ACCEPTANCE / "templates" / "gate-execution-summary.md"
PROPOSAL_DIR = ACCEPTANCE_DOCS / "proposals" / "execution-model"
KNOWLEDGE_INDEX = REPO_ROOT / "docs" / "knowledge" / "README.md"
PITFALL = (
    REPO_ROOT
    / "docs"
    / "knowledge"
    / "pitfalls"
    / "acceptance-active-docs-must-not-promote-drafts.md"
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _section(text: str, heading: str) -> str:
    start = text.find(heading)
    self_fail = (
        f"missing section {heading!r}" if start < 0 else None
    )
    if self_fail is not None:
        raise AssertionError(self_fail)
    rest = text[start + len(heading):]
    next_heading = rest.find("\n## ", 1)
    return rest if next_heading < 0 else rest[:next_heading]


class ActiveEntryTests(unittest.TestCase):
    def test_active_readme_is_short_and_has_authority_sections(self) -> None:
        text = _read(ACTIVE_README)
        self.assertLessEqual(
            len(text.splitlines()),
            120,
            "active Acceptance entry must stay a navigation/authority index",
        )
        for heading in (
            "## Authority",
            "## Current Documents",
            "## Proposed And Historical Material",
            "## Proof Boundary",
        ):
            self.assertIn(heading, text)
        self.assertRegex(text, r"> \*\*Status\*\*: active")

    def test_current_documents_section_excludes_proposals(self) -> None:
        section = _section(_read(ACTIVE_README), "## Current Documents")
        self.assertNotIn("proposals/", section)
        self.assertNotIn("execution-plans/", section)


class ProposalAuthorityTests(unittest.TestCase):
    def test_every_proposal_doc_is_non_normative(self) -> None:
        docs = sorted(PROPOSAL_DIR.glob("*.md"))
        self.assertTrue(docs, "execution-model proposal docs must exist")
        for doc in docs:
            with self.subTest(doc=doc.name):
                text = _read(doc)
                self.assertRegex(text, r"> \*\*Status\*\*: draft")
                self.assertRegex(text, r"\*\*Authority\*\*: non-normative")

    def test_proposal_index_has_current_disposition(self) -> None:
        text = _read(PROPOSAL_DIR / "README.md")
        self.assertIn("LANDED", text)
        self.assertIn("STILL PROPOSED", text)
        self.assertIn("HISTORICAL", text)
        self.assertRegex(text, r"\*\*Updated\*\*: 2026-10-26")


class OperationalGuideTests(unittest.TestCase):
    def test_plans_are_optional_and_no_mandatory_plan_rule(self) -> None:
        text = _read(TOOLING_README)
        self.assertIn("Execution Plans are optional", text)
        self.assertNotRegex(
            text,
            re.compile(r"exactly one active formal execution plan", re.IGNORECASE),
        )

    def test_guide_points_to_docs_gate_and_summary_template(self) -> None:
        text = _read(TOOLING_README)
        self.assertIn("acceptance-docs-test.py", text)
        self.assertIn("templates/gate-execution-summary.md", text)


class SummaryTemplateTests(unittest.TestCase):
    def test_template_defaults_unproven_and_forbids_manual_proven(self) -> None:
        text = _read(SUMMARY_TEMPLATE)
        self.assertIn("**Projection status**: `UNPROVEN`", text)
        self.assertNotIn("**Projection status**: `PROVEN`", text)
        self.assertIn(
            "Do not replace `UNPROVEN` with `PROVEN` manually",
            text,
        )

    def test_template_cites_immutable_evidence_sections(self) -> None:
        text = _read(SUMMARY_TEMPLATE)
        for heading in (
            "## Identity",
            "## Immutable Evidence",
            "## Residual Gaps",
            "## Verdict",
        ):
            self.assertIn(heading, text)


class CurrentStateInventoryTests(unittest.TestCase):
    FORBIDDEN = (
        "ACCEPTED TARGET",
        "accepted target",
        "D-19 PROPOSED",
        "D-19 proposed",
        "目标目录树",
        "[NEW]",
        "contracts/mobile",
        "finalizers/mobile_native",
        "drivers/mobile.py",
    )

    def test_module_layout_inventories_implemented_paths_only(self) -> None:
        text = _read(ACCEPTANCE_DOCS / "module-layout.md")
        self.assertIn("## 当前目录树", text)
        for token in self.FORBIDDEN:
            with self.subTest(token=token):
                self.assertNotIn(token, text)

    def test_execution_budget_is_active_contract(self) -> None:
        text = _read(ACCEPTANCE_DOCS / "execution-budget.md")
        self.assertRegex(text, r"> \*\*Status\*\*: active")
        self.assertRegex(text, r"\*\*Updated\*\*: 2026-10-26")

    def test_current_docs_do_not_call_budget_experimental(self) -> None:
        for name in ("design.md", "integration.md"):
            with self.subTest(doc=name):
                text = _read(ACCEPTANCE_DOCS / name)
                self.assertNotIn("实验执行预算", text)
                self.assertNotIn("执行预算实验", text)


class KnowledgeGuardTests(unittest.TestCase):
    def test_pitfall_exists_covers_paths_and_is_indexed(self) -> None:
        self.assertTrue(PITFALL.is_file())
        text = _read(PITFALL)
        self.assertIn("kind: pitfall", text)
        self.assertIn("docs/architecture/engineering/acceptance/", text)
        self.assertIn("tooling/scripts/acceptance-docs-test.py", text)
        self.assertIn(
            "acceptance-active-docs-must-not-promote-drafts.md",
            _read(KNOWLEDGE_INDEX),
        )


if __name__ == "__main__":
    unittest.main()
