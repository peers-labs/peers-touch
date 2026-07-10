#!/usr/bin/env python3
"""Tests for Agent LobeHub parity evidence-chain gate."""

from __future__ import annotations

import json
import importlib.util
import tempfile
import unittest
from pathlib import Path
from typing import Any


def load_module() -> Any:
    script = Path(__file__).with_name("agent-lobehub-parity-evidence-chain-gate.py")
    spec = importlib.util.spec_from_file_location("agent_lobehub_parity_evidence_chain_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AgentLobeHubParityEvidenceChainGateTest(unittest.TestCase):
    def write_required_files(
        self,
        root: Path,
        *,
        blocked_gate: bool = True,
        blocked_visual_surface: str | None = None,
        missing_visual_delta_surface: str | None = None,
        missing_review_execution_evidence: str | None = None,
        missing_pre_confirmation_handoff_evidence: str | None = None,
        missing_canonical_prototype_evidence: str | None = None,
        stale_handoff_summary: bool = False,
        missing_review_url: str | None = None,
        invalid_review_url: str | None = None,
        missing_source_marker_url: str | None = None,
        missing_source_state_url: str | None = None,
        invalid_visual_delta_surface: str | None = None,
        missing_lobehub_source_surface: str | None = None,
        duplicate_visual_delta_surface: str | None = None,
        unknown_visual_delta_surface: str | None = None,
        duplicate_visual_surface: str | None = None,
        unknown_visual_surface: str | None = None,
        missing_compact_artifact_surface: str | None = None,
        invalid_compact_dom_surface: str | None = None,
    ) -> None:
        module = load_module()
        visual_rows = [
            "| Surface | BOM / Spec | LobeHub source | LobeHub live reference | Peers prototype reference | Current matched items | Current delta | Verdict |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        visual_delta_rows = [
            "| Surface | LobeHub reference | Peers prototype reference | Side-by-side action | Owner disposition |",
            "| --- | --- | --- | --- | --- |",
        ]
        review_url_by_surface = {
            "Home": "?surface=home&state=compact-home&check=ci",
            "Agent Chat": "?surface=chat&check=da",
            "Agent Profile": "?surface=profile&check=dd",
            "Tasks": "?surface=tasks&check=cm",
            "Pages": "?surface=pages&check=cn",
            "Resources": "?surface=resources&state=compact-resources&check=co",
            "Memory": "?surface=memory&state=compact-memory&check=cp",
            "Skills / Tools": "?surface=skills&state=compact-skills&check=cq",
            "Image": "?surface=image&state=copy-failure",
            "Settings": "?surface=settings&state=compact-settings&check=cr",
            "Community": "?surface=community&category=workspace",
        }
        for surface in module.REQUIRED_SURFACES:
            verdict = "deferred" if surface in module.DEFERRED_VISUAL_SURFACES else "revision-required"
            if surface == blocked_visual_surface:
                verdict = "blocked"
            delta = "Deferred by Owner for the current review scope." if verdict == "deferred" else "Known remaining delta."
            visual_rows.append(
                f"| {surface} | BOM-012 / SPEC-010 | `external/lobehub/src/{surface.lower()}.tsx` | `https://app.lobehub.com/{surface.lower()}` | `http://localhost:3200/?surface={surface.lower()}` | Matched shell. | {delta} | {verdict} |"
            )
            if surface == duplicate_visual_surface:
                visual_rows.append(
                    f"| {surface} | BOM-012 / SPEC-010 | `external/lobehub/src/{surface.lower()}-duplicate.tsx` | `https://app.lobehub.com/{surface.lower()}` | `http://localhost:3200/?surface={surface.lower()}-duplicate` | Duplicate shell. | Duplicate delta. | {verdict} |"
                )
            if surface != missing_visual_delta_surface:
                disposition = "deferred" if surface in module.DEFERRED_VISUAL_SURFACES else "undecided"
                if surface == invalid_visual_delta_surface:
                    disposition = "deferred"
                lobehub_reference = f"`https://app.lobehub.com/{surface.lower()}` and `external/lobehub/src/{surface.lower()}.tsx`"
                if surface == missing_lobehub_source_surface:
                    lobehub_reference = f"`https://app.lobehub.com/{surface.lower()}`"
                review_url = review_url_by_surface[surface]
                if review_url == missing_review_url:
                    review_url = "?surface=image&state=copy-failure"
                visual_delta_rows.append(
                    f"| {surface} | {lobehub_reference} | `agent-lobehub-parity` `{review_url}` | Run side-by-side visual and interaction delta review. | {disposition} |"
                )
                if surface == duplicate_visual_delta_surface:
                    visual_delta_rows.append(
                        f"| {surface} | {lobehub_reference} | `agent-lobehub-parity` `?surface={surface.lower()}-duplicate` | Run side-by-side visual and interaction delta review. | {disposition} |"
                    )
        if unknown_visual_surface is not None:
            visual_rows.append(
                f"| {unknown_visual_surface} | BOM-012 / SPEC-010 | `external/lobehub/src/unknown.tsx` | `https://app.lobehub.com/unknown` | `http://localhost:3200/?surface=unknown` | Unknown shell. | Unknown delta. | revision-required |"
            )
        if unknown_visual_delta_surface is not None:
            visual_delta_rows.append(
                f"| {unknown_visual_delta_surface} | `https://app.lobehub.com/unknown` and `external/lobehub/src/unknown.tsx` | `agent-lobehub-parity` `?surface=unknown` | Run side-by-side visual and interaction delta review. | undecided |"
            )
        review_execution_evidence = " ".join(
            evidence_id
            for evidence_id in module.REQUIRED_REVIEW_EXECUTION_EVIDENCE
            if evidence_id != missing_review_execution_evidence
        )
        pre_confirmation_handoff_evidence = " ".join(
            evidence_id
            for evidence_id in module.REQUIRED_PRE_CONFIRMATION_HANDOFF_EVIDENCE
            if evidence_id != missing_pre_confirmation_handoff_evidence
        )
        canonical_prototype_evidence = " ".join(
            evidence_id
            for evidence_id in module.REQUIRED_CANONICAL_PROTOTYPE_EVIDENCE
            if evidence_id != missing_canonical_prototype_evidence
        )
        stale_summary_text = (
            "active compact L2/L3 artifact validation and checklist/runbook scoped execution evidence validation "
            "through EVID-011-CS-pre / EVID-011-L23-pre / EVID-011-CT-pre.\n"
            if stale_handoff_summary
            else "latest handoff summary covers CT/CU/CV/CW/CX/CY plus Chat DB and DC guard freshness.\n"
        )
        review_execution_urls = " ".join(
            url for url in module.REQUIRED_ACTIVE_REVIEW_URLS if url != missing_review_url
        )
        if invalid_review_url is not None:
            review_execution_urls = f"{review_execution_urls} {invalid_review_url}"
        contents = {
            "manifest": "export default { id: 'agent-lobehub-parity', status: 'pending-review' };\n",
            "prototypeSource": self.prototype_source(
                module,
                missing_marker_url=missing_source_marker_url,
                missing_state_url=missing_source_state_url,
            ),
            "prototypeRegistry": (
                "| desktop | `desktop-shell` | shell | path | target | design | drafting | docs |\n"
                "| desktop | `agent-lobehub-parity` | feature | path | target | design | pending-review | docs |\n"
            ),
            "prototypeReviewEntry": "**Status**: pending-review\n\n| Status | `pending-review` |\n",
            "prototypeEvidence": (
                f"{canonical_prototype_evidence}\n"
                "This evidence does not confirm the prototype. Product migration remains blocked. not GATE-008.\n"
            ),
            "prototypeRunbook": f"{review_execution_evidence}\n{review_execution_urls}\nThis runbook does not confirm the prototype and does not start PLAN-P5.\n",
            "ownerChecklist": f"{review_execution_evidence}\n{review_execution_urls}\n\n## Visual Delta Checklist\n\n" + "\n".join(visual_delta_rows) + "\n",
            "confirmationGapAudit": (
                f"{pre_confirmation_handoff_evidence}\n"
                "Product migration remains blocked until Owner confirmation.\n"
            ),
            "planP5EntryGate": "Current entry verdict: **blocked-before-owner-confirmation**.\n"
            if blocked_gate
            else "Current entry verdict: **ready-for-M1**.\n",
            "planP5ControlBoard": "No implementation evidence from EVID-012 to EVID-021 may be recorded as successful before the prototype is confirmed.\n",
            "preImplementationReadiness": (
                f"{pre_confirmation_handoff_evidence}\n"
                f"{stale_summary_text}\n"
                "PLAN-P5 product implementation is NOT STARTED. Product migration remains blocked.\n"
            ),
            "ownerDecisionSnapshot": (
                f"{stale_summary_text}\n"
                "Status: pending-review-awaiting-owner-confirmation. Product migration remains blocked.\n"
            ),
            "visualComparisonLedger": "\n".join(visual_rows) + "\n",
            "ownerDecisionPacket": (
                "EVID-011-BZ-pre decision capture packet.\n"
                "This packet does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "homeCompactRevision": (
                "EVID-011-CB-pre Home compact dashboard revision.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "homeCiCompactRevision": (
                "EVID-011-CI-pre Home compact dashboard density revision.\n"
                "EVID-011-CJ-pre promotes the clean scoped Home CI artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "chatCompactRevision": (
                "EVID-011-CC-pre Agent Chat compact New Topic revision.\n"
                "EVID-011-CK-pre promotes the clean scoped Agent Chat artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "chatDaCompactRevision": (
                "EVID-011-DA-pre Agent Chat compact follow-up revision.\n"
                "EVID-011-DB-pre promotes the clean scoped DA Agent Chat artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "chatDcHandoffFreshnessGuard": (
                "EVID-011-DC-pre Agent Chat handoff freshness guard.\n"
                "This guard keeps Owner/P5 docs synchronized to DA/DB and does not authorize EVID-012 or product migration.\n"
            ),
            "profileCompactRevision": (
                "EVID-011-CD-pre Agent Profile compact editor revision.\n"
                "EVID-011-CL-pre promotes the clean scoped Agent Profile artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "profileDdCompactRevision": (
                "EVID-011-DD-pre Agent Profile compact Builder follow-up revision.\n"
                "This revision promotes the Builder-visible Profile artifact into the active compact artifact gate and does not authorize EVID-012 or product migration.\n"
            ),
            "tasksCompactRevision": (
                "EVID-011-CE-pre Tasks compact default revision.\n"
                "EVID-011-CM-pre promotes the clean scoped Tasks artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "pagesCompactRevision": (
                "EVID-011-CF-pre Pages compact default revision.\n"
                "EVID-011-CN-pre promotes the clean scoped Pages artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "resourcesCompactRevision": (
                "EVID-011-CG-pre Resources compact default revision.\n"
                "EVID-011-CO-pre promotes the clean scoped Resources artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "memoryCompactRevision": (
                "EVID-011-CH-pre Memory compact default revision.\n"
                "EVID-011-CP-pre promotes the clean scoped Memory artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "skillsCompactRevision": (
                "EVID-011-SI-pre Skills compact default revision.\n"
                "EVID-011-CQ-pre promotes the clean scoped Skills artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
            "settingsCompactRevision": (
                "EVID-011-SS-pre Settings compact default revision.\n"
                "EVID-011-CR-pre promotes the clean scoped Settings artifact into the compact artifact gate.\n"
                "This revision does not confirm the prototype and does not authorize EVID-012 or product migration.\n"
            ),
        }
        for key, relative in module.REQUIRED_FILES.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents[key], encoding="utf-8")
        self.write_compact_artifacts(
            root,
            module,
            missing_surface=missing_compact_artifact_surface,
            invalid_dom_surface=invalid_compact_dom_surface,
        )

    def prototype_source(
        self,
        module: Any,
        *,
        missing_marker_url: str | None = None,
        missing_state_url: str | None = None,
    ) -> str:
        surface_union = "\n".join(f"  | '{item['surface']}'" for item in module.ACTIVE_REVIEW_SOURCE_REQUIREMENTS)
        initial_surfaces = ", ".join(f"'{item['surface']}'" for item in module.ACTIVE_REVIEW_SOURCE_REQUIREMENTS)
        render_branches = "\n".join(
            f"{{surface === '{item['surface']}' && <{item['component']} />}}"
            for item in module.ACTIVE_REVIEW_SOURCE_REQUIREMENTS
        )
        state_tokens = "\n".join(
            f"const {item['surface']}State = '{item['stateToken']}';"
            for item in module.ACTIVE_REVIEW_SOURCE_REQUIREMENTS
            if item["stateToken"] is not None and item["url"] != missing_state_url
        )
        markers = "\n".join(
            f"<div className=\"{item['compactMarker']}\" />"
            for item in module.ACTIVE_REVIEW_SOURCE_REQUIREMENTS
            if item["url"] != missing_marker_url
        )
        return (
            f"type Surface =\n{surface_union};\n"
            f"const surfaces: Surface[] = [{initial_surfaces}];\n"
            f"{state_tokens}\n"
            f"{render_branches}\n"
            f"{markers}\n"
        )

    def write_compact_artifacts(
        self,
        root: Path,
        module: Any,
        *,
        missing_surface: str | None = None,
        invalid_dom_surface: str | None = None,
    ) -> None:
        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (1200).to_bytes(4, "big") + (720).to_bytes(4, "big")
        for surface, artifact in module.ACTIVE_COMPACT_ARTIFACTS.items():
            if surface == missing_surface:
                continue
            screenshot = root / artifact["screenshot"]
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            screenshot.write_bytes(png_header)
            dom = root / artifact["dom"]
            dom.parent.mkdir(parents=True, exist_ok=True)
            if surface == invalid_dom_surface:
                dom.write_text("undefined\n", encoding="utf-8")
                continue
            dom.write_text(
                json.dumps({artifact["compactFlag"]: True, "forbiddenHits": []}, indent=2),
                encoding="utf-8",
            )

    def write_ledger(
        self,
        root: Path,
        *,
        include_product_row: bool = False,
        owner_confirmed: bool = False,
        invalid_status: bool = False,
        missing_required_evidence: str | None = None,
    ) -> Path:
        module = load_module()
        ledger = root / module.DEFAULT_LEDGER
        ledger.parent.mkdir(parents=True, exist_ok=True)
        evidence_rows = [
            f"| {evidence_id} | BOM-012 | SPEC-010 | PLAN-P2 | GATE-003 | artifact | result | risk |"
            for evidence_id in module.REQUIRED_EVIDENCE
            if evidence_id != missing_required_evidence
        ]
        if include_product_row:
            evidence_rows.append("| EVID-012 | BOM-015 | SPEC-013 | PLAN-P5 | GATE-008 | product | implemented | risk |")
        if owner_confirmed:
            evidence_rows.append(
                "| EVID-011-Z-owner | BOM-012/BOM-015 | SPEC-010/SPEC-013 | PLAN-P2 Owner review | GATE-003/GATE-008 | notes | OWNER_DECISION: confirmed | Product migration still requires EVID-012 entry checks. |"
            )
        status = "done" if invalid_status else "in-progress"
        ledger.write_text(
            "\n".join(
                [
                    "## 7. Evidence",
                    *evidence_rows,
                    "",
                    "## 8. Traceability",
                    "| BOM ID | Spec ID | Plan Step | Gate ID | Evidence ID | Source Path | Target Path | Owner | Status | Risk |",
                    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
                    f"| BOM-015 | SPEC-013/SPEC-014 | PLAN-P4/PLAN-P5 | GATE-008 | EVID-011-AF-pre | `path | with literal pipe` | target | Desktop/Station | {status} | Product migration blocked. |",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        return ledger

    def test_passes_when_pending_review_state_is_fail_closed(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["readinessClaim"]["scope"], "evidence-chain-consistency-only")
        self.assertTrue(report["readinessClaim"]["gateEvidenceProven"])
        self.assertFalse(report["readinessClaim"]["prototypeConfirmed"])
        self.assertFalse(report["readinessClaim"]["productMigrationAllowed"])
        self.assertFalse(report["readinessClaim"]["evid012Authorized"])
        self.assertFalse(report["authorizationState"]["ownerConfirmed"])
        self.assertEqual(report["authorizationState"]["productEvidenceRows"], [])
        self.assertTrue(report["authorizationState"]["entryGateBlockedBeforeOwnerConfirmation"])
        self.assertEqual(report["pendingReviewState"]["registryStatus"], "pending-review")
        self.assertFalse(report["pendingReviewState"]["registryDrafting"])
        self.assertEqual(report["visualComparisonState"]["surfaceCount"], len(module.REQUIRED_SURFACES))
        verdict_coverage = report["visualComparisonState"]["verdictCoverage"]
        self.assertEqual(len(verdict_coverage["activeRevisionRequired"]), len(module.ACTIVE_VISUAL_SURFACES))
        self.assertEqual(len(verdict_coverage["activeAcceptableDelta"]), 0)
        self.assertEqual(len(verdict_coverage["activeReadyForOwnerReview"]), 0)
        self.assertEqual(len(verdict_coverage["deferredMarkedDeferred"]), len(module.DEFERRED_VISUAL_SURFACES))
        self.assertEqual(report["activeCompactArtifactState"]["requiredSurfaceCount"], len(module.ACTIVE_COMPACT_ARTIFACTS))
        self.assertEqual(report["activeCompactArtifactState"]["invalidArtifacts"], [])
        self.assertEqual(report["visualDeltaChecklistState"]["surfaceCount"], len(module.REQUIRED_SURFACES))
        self.assertEqual(report["visualDeltaChecklistState"]["dispositions"]["Home"], "undecided")
        self.assertEqual(report["visualDeltaChecklistState"]["dispositions"]["Image"], "deferred")
        anchor_coverage = report["visualDeltaChecklistState"]["anchorCoverage"]
        self.assertEqual(len(anchor_coverage["lobehubLive"]), len(module.REQUIRED_SURFACES))
        self.assertEqual(len(anchor_coverage["lobehubSource"]), len(module.REQUIRED_SURFACES))
        self.assertEqual(len(anchor_coverage["peersPrototype"]), len(module.REQUIRED_SURFACES))
        disposition_coverage = report["visualDeltaChecklistState"]["dispositionCoverage"]
        self.assertEqual(len(disposition_coverage["activeUndecided"]), len(module.ACTIVE_VISUAL_SURFACES))
        self.assertEqual(len(disposition_coverage["deferredMarkedDeferred"]), len(module.DEFERRED_VISUAL_SURFACES))
        self.assertEqual(
            len(report["reviewExecutionEvidenceState"]["present"]["prototypeRunbook"]),
            len(module.REQUIRED_REVIEW_EXECUTION_EVIDENCE),
        )
        self.assertEqual(
            len(report["reviewExecutionEvidenceState"]["present"]["ownerChecklist"]),
            len(module.REQUIRED_REVIEW_EXECUTION_EVIDENCE),
        )
        self.assertEqual(report["issueBreakdown"], [])

    def test_fails_closed_when_required_pre_evidence_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root)
            missing = module.REQUIRED_EVIDENCE[-1]
            ledger = self.write_ledger(root, missing_required_evidence=missing)
            report = module.build_report(root, ledger.relative_to(root))

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["issueBreakdown"][0]["category"], "missing-evidence")
        self.assertIn(missing, report["issueBreakdown"][0]["summary"])

    def test_fails_closed_when_product_evidence_precedes_owner_confirmation(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root)
            ledger = self.write_ledger(root, include_product_row=True)
            report = module.build_report(root, ledger.relative_to(root))

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["issueBreakdown"][0]["category"], "unauthorized-product-evidence")
        self.assertEqual(report["issueBreakdown"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["issueBreakdown"][0]["sourceSpec"], module.SPEC)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)

    def test_fails_closed_when_unconfirmed_owner_gate_is_not_blocked(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, blocked_gate=False)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("prototype-fail-closed-state", categories)
        self.assertIn("unsafe-entry-gate", categories)

    def test_fails_closed_when_owner_confirmed_but_entry_gate_still_blocked(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, blocked_gate=True)
            ledger = self.write_ledger(root, owner_confirmed=True)
            report = module.build_report(root, ledger.relative_to(root))

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["category"], "stale-entry-gate")

    def test_traceability_status_uses_tail_column_when_cells_contain_pipes(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root)
            ledger = self.write_ledger(root, invalid_status=True)
            report = module.build_report(root, ledger.relative_to(root))

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["issueBreakdown"][0]["category"], "traceability-status")
        self.assertEqual(report["issueBreakdown"][0]["evidenceDetails"]["invalidRows"][0]["status"], "done")

    def test_fails_closed_when_active_visual_surface_is_blocked(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, blocked_visual_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-verdict", categories)

    def test_fails_closed_when_visual_comparison_surface_is_duplicated(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, duplicate_visual_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-comparison-surface-shape", categories)

    def test_fails_closed_when_visual_comparison_surface_is_unknown(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, unknown_visual_surface="Unknown Surface")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-comparison-surface-shape", categories)

    def test_fails_closed_when_active_compact_artifact_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_compact_artifact_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-active-compact-artifact", categories)

    def test_fails_closed_when_active_compact_dom_is_invalid(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, invalid_compact_dom_surface="Tasks")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-active-compact-artifact", categories)

    def test_fails_closed_when_visual_delta_surface_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_visual_delta_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("missing-visual-delta-checklist", categories)

    def test_fails_closed_when_review_execution_evidence_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = module.REQUIRED_REVIEW_EXECUTION_EVIDENCE[-1]
            self.write_required_files(root, missing_review_execution_evidence=missing)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("missing-review-execution-evidence", categories)

    def test_fails_closed_when_review_execution_url_is_stale(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale_url = "?surface=home&state=compact-home&check=cj"
            self.write_required_files(root, invalid_review_url=stale_url)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-review-execution-url", categories)

    def test_fails_closed_when_active_review_url_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing_url = module.REQUIRED_ACTIVE_REVIEW_URLS[0]
            self.write_required_files(root, missing_review_url=missing_url)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("missing-active-review-url", categories)

    def test_fails_closed_when_active_review_source_marker_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_source_marker_url="?surface=memory&state=compact-memory&check=cp")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-active-review-source-reachability", categories)

    def test_fails_closed_when_active_review_source_state_token_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_source_state_url="?surface=resources&state=compact-resources&check=co")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-active-review-source-reachability", categories)

    def test_fails_closed_when_pre_confirmation_handoff_doc_is_missing_latest_evidence(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_pre_confirmation_handoff_evidence="EVID-011-CV-pre")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("missing-pre-confirmation-handoff-evidence", categories)

    def test_fails_closed_when_canonical_prototype_evidence_is_missing_latest_guard(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_canonical_prototype_evidence="EVID-011-CX-pre")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("missing-canonical-prototype-evidence", categories)

    def test_fails_closed_when_handoff_summary_contains_stale_evidence_chain(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, stale_handoff_summary=True)
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("stale-handoff-summary", categories)

    def test_fails_closed_when_visual_delta_surface_is_duplicated(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, duplicate_visual_delta_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-delta-surface-shape", categories)

    def test_fails_closed_when_visual_delta_surface_is_unknown(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, unknown_visual_delta_surface="Unknown Surface")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-delta-surface-shape", categories)

    def test_fails_closed_when_active_visual_delta_disposition_is_deferred(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, invalid_visual_delta_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("invalid-visual-delta-disposition", categories)

    def test_fails_closed_when_visual_delta_lobehub_source_anchor_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_required_files(root, missing_lobehub_source_surface="Home")
            ledger = self.write_ledger(root)
            report = module.build_report(root, ledger.relative_to(root))

        categories = {issue["category"] for issue in report["issueBreakdown"]}
        self.assertEqual(report["status"], "fail")
        self.assertIn("incomplete-visual-delta-checklist", categories)


if __name__ == "__main__":
    unittest.main()
