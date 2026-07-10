# Agent LobeHub Fullstack Parity - PLAN-P5 Entry Gate

> **Status**: blocked-before-owner-confirmation
> **Version**: v0.3
> **Created**: 2026-07-07 | **Updated**: 2026-07-08
> **Owner**: Agent Architecture / Model / Station / Desktop
> **Plan Step**: PLAN-P5 entry control
> **Prepared Evidence**: EVID-011-AB-pre, EVID-011-AF-pre, EVID-011-AG-pre, EVID-011-AH-pre, EVID-011-AI-pre, EVID-011-AJ-pre, EVID-011-AK-pre, EVID-011-AL-pre, EVID-011-AZ-pre, EVID-011-BA-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BE-pre, EVID-011-BF-pre, EVID-011-BG-pre, EVID-011-BH-pre, EVID-011-BI-pre, EVID-011-BJ-pre, EVID-011-BK-pre, EVID-011-BL-pre, EVID-011-BM-pre, EVID-011-BN-pre, EVID-011-BO-pre, EVID-011-BP-pre, EVID-011-BQ-pre, EVID-011-BR-pre, EVID-011-BS-pre, EVID-011-BT-pre, EVID-011-BU-pre, EVID-011-BV-pre, EVID-011-BW-pre, EVID-011-BX-pre, EVID-011-BY-pre, EVID-011-BZ-pre, EVID-011-CA-pre, EVID-011-CB-pre, EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CK-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre
> **Supplemental Evidence**: EVID-011-CU-pre, EVID-011-CV-pre, EVID-011-CW-pre, EVID-011-CX-pre, EVID-011-CY-pre, EVID-011-DB-pre, EVID-011-DC-pre, EVID-011-DD-pre
> **Latest Handoff Sync**: EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-DA-pre, EVID-011-DB-pre, EVID-011-DC-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CM-pre, EVID-011-CN-pre, EVID-011-CO-pre, EVID-011-CP-pre, EVID-011-CQ-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-CT-pre, EVID-011-CU-pre, EVID-011-CV-pre, EVID-011-CW-pre, EVID-011-CX-pre, EVID-011-CY-pre
> **Implementation Evidence Starts At**: EVID-012
> **Gates**: GATE-003, GATE-004, GATE-005, GATE-006, GATE-007, GATE-008

---

## 1. Purpose

This document is the hard gate between the completed design/prototype planning
work and product implementation. It defines exactly what must be true before
EVID-012 can begin, and what must stay blocked even after Owner confirms the
prototype.

This document does not confirm the prototype, does not edit product code, and
does not satisfy GATE-008.

## 2. Entry Verdict

| Check | Current Verdict | Evidence | Consequence |
| --- | --- | --- | --- |
| Prototype is Owner-confirmed | FAIL-CLOSED | `agent-lobehub-parity` is `pending-review`; latest Owner confirmation is missing | EVID-012 cannot start. |
| Owner review scenarios are executable | PASS FOR PENDING REVIEW | `owner-review-runbook.md`, `prototype-confirmation-gap-audit.md`, `prototype-cross-surface-review-sweep.md`, `prototype-owner-review-decision-packet.md`, `home-ca-visual-delta-triage.md`, `home-cb-compact-dashboard-revision.md`, `chat-cc-compact-new-topic-revision.md`, `chat-da-compact-follow-up-revision.md`, `chat-db-clean-scoped-artifact-refresh.md`, `profile-cd-compact-editor-revision.md`, `profile-dd-compact-builder-follow-up-revision.md`, `tasks-ce-compact-default-revision.md`, `pages-cf-compact-default-revision.md`, `resources-cg-compact-default-revision.md`, `memory-ch-compact-default-revision.md`, `skills-si-compact-default-revision.md`, `settings-ss-compact-default-revision.md`, EVID-011-AA-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BN-pre, EVID-011-BO-pre, EVID-011-BP-pre, EVID-011-BQ-pre, EVID-011-BR-pre, EVID-011-BS-pre, EVID-011-BT-pre, EVID-011-BU-pre, EVID-011-BV-pre, EVID-011-BW-pre, EVID-011-BX-pre, EVID-011-BY-pre, EVID-011-BZ-pre, EVID-011-CA-pre, EVID-011-CB-pre, EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CZ-pre, EVID-011-DA-pre, EVID-011-DB-pre, EVID-011-DC-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre | Owner review package is synchronized for pending-review and the Portal entry loads the Agent preview; all 9 active compact-baseline surfaces now use clean scoped L2/L3 artifacts in the review package and gate reports, with Chat active on DA/DB after DC freshness hardening and Profile active on DD after Builder-visible follow-up, while Image and Community remain Owner-deferred. Visual Delta Checklist plus visual comparison ledger surface-shape automation fail closed on duplicate or unknown surface rows, and active compact L2/L3 artifact automation verifies readable screenshots, parseable DOM JSON, compact markers and empty forbidden hits, but Owner confirmation is still required before product migration. |
| Design/source audit is complete enough for migration | PASS FOR DESIGN | EVID-011-R-pre..EVID-011-X-pre | PLAN-P5 may use these docs only after Owner confirmation. |
| Product target paths are known | PASS FOR PREP | `m1-implementation-kickoff.md`, `contract-foundation.md` | M1 path list can seed EVID-012 after confirmation. |
| GATE-008 product evidence exists | FAIL-CLOSED | EVID-012..EVID-021 missing | Product parity cannot be claimed. |

Current entry verdict: **blocked-before-owner-confirmation**.

Latest handoff sync: `EVID-011-CI-pre` and `EVID-011-CJ-pre` improve the Home
compact dashboard artifact chain; `EVID-011-DA-pre` and `EVID-011-DB-pre` improve the Agent Chat
compact New Topic artifact chain, and `EVID-011-DC-pre` keeps Owner/P5 docs synchronized to DA/DB instead of historical CK; `EVID-011-CL-pre` improves the Agent Profile
compact editor artifact chain and `EVID-011-DD-pre` promotes the Builder-visible Profile artifact; `EVID-011-CM-pre` improves the Tasks compact
artifact chain with a clean scoped screenshot and DOM proof; `EVID-011-CN-pre`,
`EVID-011-CO-pre`, `EVID-011-CP-pre`, `EVID-011-CQ-pre` and `EVID-011-CR-pre`
promote Pages, Resources, Memory, Skills / Tools and Settings into clean scoped
compact artifact gates; `EVID-011-CS-pre` synchronizes the review package so all
9 active compact-baseline surfaces point to scoped L2/L3 artifacts in docs and
gate reports.
These rows are for Owner review only. They do not change this entry verdict, do
not confirm the prototype, and do not authorize EVID-012.

## 3. Required Evidence Before EVID-012

EVID-012 may start only when all rows are `PASS`.

| Requirement | Required Evidence | Current State |
| --- | --- | --- |
| Owner accepted prototype as migration reference | New Owner decision row with `OWNER_DECISION: confirmed` after revised prototype review | missing; current `EVID-011-Z-owner` is `revision-required` |
| Owner review readiness automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, EVID-011-AJ-pre, EVID-011-AL-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BE-pre, EVID-011-BF-pre, EVID-011-BG-pre, EVID-011-BH-pre, EVID-011-BI-pre, EVID-011-BJ-pre, EVID-011-BK-pre, EVID-011-BL-pre, EVID-011-BM-pre, EVID-011-BN-pre, EVID-011-BO-pre, EVID-011-BP-pre, EVID-011-BQ-pre, EVID-011-BR-pre, EVID-011-BS-pre, EVID-011-BT-pre, EVID-011-BU-pre, EVID-011-BV-pre, EVID-011-BW-pre, EVID-011-BX-pre, EVID-011-BY-pre, EVID-011-BZ-pre, EVID-011-CA-pre, EVID-011-CB-pre, EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CK-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre | pass for fail-closed pending-review only; must not be treated as Owner confirmation |
| Evidence-chain automation passed | `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-AF-pre, EVID-011-AG-pre, EVID-011-AI-pre, EVID-011-AK-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BE-pre, EVID-011-BF-pre, EVID-011-BG-pre, EVID-011-BH-pre, EVID-011-BI-pre, EVID-011-BJ-pre, EVID-011-BK-pre, EVID-011-BL-pre, EVID-011-BM-pre, EVID-011-BN-pre, EVID-011-BO-pre, EVID-011-BP-pre, EVID-011-BQ-pre, EVID-011-BR-pre, EVID-011-BS-pre, EVID-011-BT-pre, EVID-011-BU-pre, EVID-011-BV-pre, EVID-011-BW-pre, EVID-011-BX-pre, EVID-011-BY-pre, EVID-011-BZ-pre, EVID-011-CA-pre, EVID-011-CB-pre, EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CK-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre | pass for fail-closed pre-implementation state only |
| Review URL allowlist automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-CU-pre | pass for fail-closed Owner review execution only; validates known review URLs and required active compact URLs, not Owner confirmation |
| Review URL source reachability automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-CV-pre | pass for fail-closed Owner review execution only; validates active review URLs map to prototype source branches, state tokens and compact markers, not Owner confirmation |
| Pre-confirmation handoff sync automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-CW-pre | pass for fail-closed Owner/P5 handoff only; validates gap/readiness docs include latest review-package, artifact, URL and source-reachability evidence, not Owner confirmation |
| Canonical prototype evidence sync automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-CX-pre | pass for fail-closed Owner/P5 handoff only; validates canonical prototype evidence includes latest review-package, artifact, URL, source-reachability and handoff-sync guards, not Owner confirmation |
| Handoff summary freshness automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-CY-pre | pass for fail-closed Owner/P5 handoff only; validates Owner/P5 summary text no longer claims readiness only through stale CT-era evidence, not Owner confirmation |
| Chat active artifact freshness automation passed | `tooling/scripts/agent-lobehub-owner-review-readiness-gate.py`, `tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py`, EVID-011-DC-pre | pass for fail-closed Owner/P5 handoff only; validates Owner/P5 docs no longer present CK as the active Chat artifact after DA/DB promotion, not Owner confirmation |
| Prototype registry and manifest are updated consistently | `prototype.manifest.ts`, `docs/architecture/prototypes/README.md`, review docs show `pending-review` | pass for review; `confirmed` still missing |
| PLAN-P5 control board recognizes confirmation | `plan-p5-implementation-control-board.md` status updated from blocked to ready-for-M1 | missing |
| M1 evidence row is predeclared | `tmp/agent-lobehub-fullstack-ledger.md` has EVID-012 working row before product edits | missing |
| M1 target paths and checks are listed | `m1-implementation-kickoff.md` plus EVID-012 working row | prepared, not activated |
| Product-path knowledge scan is performed | `pt-read-before-edit` result for every product path to edit | missing |
| Required checks are named before edits | At minimum `./model/build.sh`, `pnpm --dir apps/desktop run check`, plus touched-layer Go/Rust checks | prepared, not activated |

## 4. Product Edit Authorization Rule

No product file may be edited for PLAN-P5 unless the EVID-012 working row
already exists and includes:

1. BOM IDs.
2. SPEC IDs.
3. Plan step and batch.
4. Gate IDs.
5. Target paths.
6. Required deterministic commands.
7. Product-path knowledge scan references.
8. Stop conditions.

Prototype/docs-only evidence cannot substitute for this authorization.

## 5. EVID-012 Working Row Template

Create this row before product edits after Owner confirmation:

```md
| EVID-012-working | BOM-013/BOM-014/BOM-015 | SPEC-003/SPEC-004/SPEC-006/SPEC-007/SPEC-008/SPEC-009/SPEC-011/SPEC-012/SPEC-013/SPEC-014 | PLAN-P5 / M1 Contract Foundation | GATE-005/GATE-006/GATE-007/GATE-008 | target paths: `model/domain/agent/`, generated outputs, Station/Desktop compatibility paths; commands planned: `./model/build.sh`, `pnpm --dir apps/desktop run check`, touched-layer Go/Rust tests; knowledge scan: pending before edit | IN_PROGRESS: M1 contract foundation authorized after Owner confirmation | Cannot claim implemented/verified until commands pass and generated outputs trace to proto source. |
```

Replace it with final EVID-012 only after implementation and checks.

## 6. First Product Batch Guardrails

M1 must be contract-first:

- Start from `model/domain/agent/` contracts.
- Do not start from Desktop UI layout.
- Do not add page-owned source-of-truth state.
- Do not introduce model-only identity.
- Do not store raw local paths as durable cross-end truth.
- Do not enable Actor#agent social product behavior.
- Do not manually edit generated Go/TS outputs.

## 7. Stop Conditions

Stop and keep PLAN-P5 blocked if:

1. Owner decision is not `confirmed`.
2. Confirmation evidence changes prototype status but misses registry or ledger traceability.
3. Product-path knowledge scan is missing.
4. A proposed M1 edit touches Desktop UI behavior before contract foundation.
5. `./model/build.sh` is unavailable or fails without a supported replacement path.
6. Any GATE-008 command fails.
7. Any evidence row tries to claim product parity from docs/prototype-only evidence.

## 8. Current Claim

PLAN-P5 has a concrete entry gate and EVID-012 authorization template. It is
still blocked because Owner confirmation is missing and the prototype is only
`pending-review`. No product migration has started.
