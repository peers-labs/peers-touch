# Agent LobeHub Prototype Owner Review Runbook

> **Status**: pending-review-runbook
> **Version**: v0.4
> **Created**: 2026-07-07 | **Updated**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 / Owner review
> **Evidence**: EVID-011-AA-pre, EVID-011-Z-owner, EVID-011-AS-pre..EVID-011-GA-pre, EVID-011-CJ-pre, EVID-011-CK-pre, EVID-011-CZ-pre, EVID-011-DA-pre, EVID-011-DB-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CM-pre, EVID-011-CN-pre, EVID-011-CO-pre, EVID-011-CP-pre, EVID-011-CQ-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre, EVID-011-CU-pre, EVID-011-CV-pre, EVID-011-CW-pre, EVID-011-CX-pre, EVID-011-CY-pre, EVID-011-DC-pre
> **Gates**: GATE-003, GATE-004, GATE-005, GATE-006, GATE-008

---

## 1. Purpose

This runbook gives the Owner a deterministic way to review
`agent-lobehub-parity` without accidentally approving product migration. It
turns the current source-backed revision evidence into executable review
scenarios and a fail-closed decision record.

This document does not confirm the prototype and does not start PLAN-P5.

## 2. Review Boundary

| Boundary | Rule |
| --- | --- |
| Prototype target | `agent-lobehub-parity` only |
| Product code | Do not modify Desktop, Station, Model/proto or runtime product code during this review |
| Confirmation meaning | `confirmed` means accepted as migration reference, not product parity |
| Product migration | Remains blocked until Owner confirmation is recorded and EVID-012 entry checks pass |
| LobeHub use | Source-level reference only; do not copy source/assets/text without SPEC-014 evidence |
| Current status | `pending-review`; not Owner-confirmed |
| Deferred scope | Image generation and Community Marketplace are deferred by Owner for the current review scope, not complete |

## 3. Preparation

Run only if the Owner wants fresh local runtime evidence:

```bash
make run-prototype
```

Optional build checks:

```bash
pnpm --dir packages/prototypes/desktop/features/agent-lobehub-parity build
pnpm --filter @peers-touch/prototype-portal build
```

Build outputs are verification artifacts and must not be committed.

Before Owner review, the readiness gates must keep `EVID-011-CU-pre`, `EVID-011-CV-pre` and `EVID-011-DC-pre` green: CU proves the runbook/checklist URLs are known active review URLs, CV proves those URLs still map to implemented prototype source branches, handled state tokens and compact markers, and DC proves the Chat active review handoff remains DA/DB rather than the historical CK artifact.

## 4. Required Review Inputs

| Input | Purpose |
| --- | --- |
| `docs/architecture/agent/prototype/README.md` | Stable review entry and decision outcomes |
| `docs/architecture/agent/prototype/owner-review-checklist.md` | Surface checklist, Visual Delta Checklist and confirm/reject criteria |
| `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md` | Known gaps and fail-closed conditions |
| `docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md` | Post-confirmation EVID-012 entry gate before product edits |
| `docs/architecture/agent/prototype-lobehub-parity/README.md` | L1/L2/L3 evidence and known differences |
| `docs/architecture/agent/lobehub-parity/prototype-visual-comparison-ledger.md` | Per-surface LobeHub source/live/prototype/delta verdicts |
| `docs/architecture/agent/lobehub-parity/prototype-cross-surface-review-sweep.md` | Cross-surface latest L2/L3 evidence matrix, deferred-scope check and fail-closed claim boundary |
| `docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md` | Owner decision capture matrix and post-review ledger row templates |
| `docs/architecture/agent/lobehub-parity/home-ca-visual-delta-triage.md` | Home side-by-side live visual delta triage and required compact dashboard revision |
| `docs/architecture/agent/lobehub-parity/home-cb-compact-dashboard-revision.md` | Home compact dashboard revision evidence after CA triage; CJ promotes the clean scoped Home screenshot and DOM into the active compact artifact gate |
| `docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md` | Agent Chat compact New Topic default revision evidence after live/default visual comparison; CK is retained as historical scoped evidence |
| `docs/architecture/agent/lobehub-parity/chat-da-compact-follow-up-revision.md` | Agent Chat compact follow-up revision after CZ side-by-side triage |
| `docs/architecture/agent/lobehub-parity/chat-db-clean-scoped-artifact-refresh.md` | Agent Chat DA clean scoped screenshot and DOM promotion into the active compact artifact gate |
| `docs/architecture/agent/lobehub-parity/profile-cd-compact-editor-revision.md`; `docs/architecture/agent/lobehub-parity/profile-dd-compact-builder-follow-up-revision.md` | Agent Profile compact editor default revision evidence after live/default visual comparison; CL is historical clean scoped evidence and DD promotes the Builder-visible Profile screenshot and DOM into the active compact artifact gate |
| `docs/architecture/agent/lobehub-parity/tasks-ce-compact-default-revision.md` | Tasks compact default revision evidence after live/default visual comparison; CM promotes the clean scoped Tasks screenshot and DOM into the active compact artifact gate |
| `docs/architecture/agent/lobehub-parity/pages-cf-compact-default-revision.md` | Pages compact default placeholder revision evidence plus CN clean scoped artifact handoff after source/live default route comparison |
| `docs/architecture/agent/lobehub-parity/resources-cg-compact-default-revision.md` | Resources compact default ResourceManager explorer revision evidence plus CO clean scoped artifact handoff after source/live default route comparison |
| `docs/architecture/agent/lobehub-parity/memory-ch-compact-default-revision.md` | Memory compact default Home revision evidence plus CP clean scoped artifact handoff after source/live default route comparison |
| `docs/architecture/agent/lobehub-parity/skills-si-compact-default-revision.md` | Skills compact default Settings > Skill revision evidence plus CQ clean scoped artifact handoff after source/live default route comparison |
| `docs/architecture/agent/lobehub-parity/settings-ss-compact-default-revision.md` | Settings compact default Settings > Provider `all` revision evidence after source/live default route comparison; CR promotes the clean scoped Settings screenshot and DOM into the active compact artifact gate |
| `docs/architecture/agent/lobehub-parity/frontend-source-map.md` | LobeHub frontend source anchors |
| `tmp/agent-lobehub-fullstack-ledger.md` | Evidence and traceability source of truth |

## 5. Scenario Matrix

| Scenario ID | Surface | Review Action | Must Observe | BOM / Spec / Gate |
| --- | --- | --- | --- | --- |
| OR-001 | Portal registration | Open Prototype Portal and locate `Agent LobeHub Parity`. | Prototype is discoverable as `pending-review`, not `confirmed`; EVID-011-BD-pre already proves the current worktree Portal entry loads Agent Home and switches to Tasks. | BOM-012 / SPEC-010 / GATE-003 |
| OR-002 | Home | First open `?surface=home&state=compact-home&check=ci` and compare the compact dashboard using CJ's clean scoped artifact: connector strip, floating composer density, model chips, Brief/task card and recommendation cards. Then open `?surface=home&state=deep-home&check=bx` and inspect AgentSelect async/retry/active rows, daily hint, input notice, context/file/typo controls, add-context menu, tools/model/history popovers, StarterList loading/permission states, Recents accordion/menu/inline rename/All Recents drawer and Featured plugins. | Default Home visually starts from the LobeHub-like compact dashboard baseline; CJ is the active clean scoped compact artifact for Owner review; no hidden product-success claim for unresolved send/context/resource/recents flows. | BOM-001/BOM-012 / SPEC-001/SPEC-010 / GATE-004 |
| OR-003 | Agent switch and Topic rail | Switch Agent and Topic surfaces. | Shared Agent list projection, Topic rail grouping/search semantics and active selection are understandable. | BOM-001/BOM-002/BOM-012 / SPEC-001/SPEC-008 / GATE-004 |
| OR-004 | Chat runtime | First open `?surface=chat&check=da` and compare the compact New Topic default: icon rail, agent switcher popover, topic grouping, `New Topic` header, `Lobe AI` greeting, compact composer, `DeepSeek`, `Agent`, `No device`, `Allow List`, send control and `Space` / `Params` affordance. Then open `?surface=chat&state=deep-chat&working=review&check=bt` to inspect cached-topic refresh, virtualized-list meta, thread hydration recovery, BackBottom, ChatMiniMap preview, forward selection and WorkingSidebar resize. | Default Chat visually starts from the LobeHub-like New Topic baseline; DA/DB are the active clean scoped compact artifacts for Owner review; runtime states remain explicit in BT; action lineage and list recovery affordances are represented; unresolved states are not rendered as success. | BOM-007/BOM-012 / SPEC-002/SPEC-009 / GATE-004 |
| OR-005 | Tool approval | Inspect tool call approval/result/error states, tool detail inspector, intervention tabs and message context menu. | Approval boundary is visible and mapped to Station/Desktop ownership; tool output waiting states do not imply product-backed execution. | BOM-005/BOM-012 / SPEC-007/SPEC-011 / GATE-004/GATE-006 |
| OR-006 | Provider/model | First open `?surface=settings&state=compact-settings&check=cr` and compare compact Settings > Provider `all` using the clean scoped artifact: grouped Settings nav, 280px provider menu, Search providers, Add custom provider, All Providers active row and enabled/custom/disabled provider grid. Then open `?surface=settings&state=deep-settings&check=bs` plus Service Model / Storage BS URLs to inspect provider search/add/sort, provider detail, model tabs, model-list error/retry, model config/delete and Service Model assignment groups. | Default Settings visually starts from the LobeHub-like Provider `all` baseline; CR is the active clean scoped compact artifact for Owner review; model identity is shown as `provider + model`; no product claim that GATE-005 is fully implemented. | BOM-003/BOM-012 / SPEC-003 / GATE-005 |
| OR-007 | Profile/config | First open `?surface=profile&check=dd` and compare the compact ProfileEditor default plus right Agent Builder first screen: agent rail, breadcrumb header, avatar, large `Enter agent name`, Model & Tools, Add Skill, Core Instructions editor, Builder prompt, suggestion cards, `Switch` and bottom composer. Then open `?surface=profile&state=deep-profile&check=bu` and inspect avatar picker, config hydration/edit-lock recovery, ModelSelect menu, AgentTool menu, rich editor typo/slash controls, opening message/questions, settings preview and Builder topic/composer flow. | Default Profile visually starts from the LobeHub-like ProfileEditor baseline; DD is the active clean scoped compact artifact for Owner review and CL remains historical compact evidence; Agent config semantics are visible and tied to Station-owned future contract; profile UI does not imply store-backed model/tool/builder mutation success. | BOM-006/BOM-012 / SPEC-005 / GATE-004/GATE-006 |
| OR-008 | Memory | First open `?surface=memory&state=compact-memory&check=cp` and compare compact `/memory` Home using the clean scoped artifact: Search/Home/category nav, action row, RoleTagCloud and Persona summary/detail. Then open `?surface=memory&state=deep-memory&check=bq` and `?surface=memory&state=detail-missing&check=bq` to inspect category list/filter, analysis/progress, timeline/grid, detail menu, edit modal, loading and unavailable states. | Default Memory visually starts from the LobeHub-like Home baseline; CP is the active clean scoped compact artifact for Owner review; Station source-of-truth and Desktop projection boundary is clear; prototype does not claim real memory sync. | BOM-004/BOM-012 / SPEC-004 / GATE-004/GATE-006 |
| OR-009 | Knowledge/resources/files | First open `?surface=resources&state=compact-resources&check=co` and compare compact ResourceManager default using the clean scoped artifact: Resource sidebar, Private/Workspace toggle, category menu, Knowledge bases list, NavHeader actions and compact resource rows. Then open `?surface=resources&state=deep-resource&check=bp` for search overlay, file drawer, action menu, drag/drop overlay, upload dock, chunk drawer, upload/import boundary, generated image resource and visible-but-unbound binding. | Default Resources visually starts from the LobeHub-like ResourceManager baseline; CO is the active clean scoped compact artifact for Owner review; resource success paths that are not proven are explicitly unresolved/tool-limited. | BOM-005/BOM-012 / SPEC-006 / GATE-004 |
| OR-010 | Skills/tools/connectors | First open `?surface=skills&state=compact-skills&check=cq` and compare compact Settings > Skill default using the clean scoped artifact: global settings rail, 300px left panel, Connectors / Skills tabs, Add and Store icon actions, grouped connector sections and selected connector detail. Then open `?surface=skills&state=deep-skills&check=br` and `?surface=skills&state=import-failure&check=br` to inspect Add Skill menu, store tabs/detail/schema, management/connectors, import URL validation/API failure, OAuth waiting, connector sync error and custom MCP drawer. | Default Skills visually starts from the LobeHub-like Settings > Skill baseline; CQ is the active clean scoped compact artifact for Owner review; Skill install/connect success remains success-unproven unless product evidence exists. | BOM-005/BOM-012 / SPEC-007 / GATE-004 |
| OR-011 | Tasks/pages/deferred image/community | Open `?surface=tasks&check=cm` and inspect compact `All tasks` default using CM's clean scoped artifact: grouped rows, search/create/settings controls and right Topic / Task Agent composer; then open `?surface=tasks&state=deep-tasks&check=bv` and inspect inline create draft/attachments/error, task context menu, list/board, detail editors, schedule popover, topic drawer, right Task Agent resize/chat controls; open `?surface=pages&check=cn` and inspect compact `/page` placeholder using CN's clean scoped artifact: left nav, Private/Workspace buckets and New document / Upload files / Import Notion cards; then open `?surface=pages&state=deep-pages&check=bw` and inspect display menu, page item dropdown, All Pages drawer, action popover, autosave/lock banners, history/compare modal and Page Copilot panel; confirm Image and Community are explicitly deferred by Owner for this review scope. | Active default and deep surfaces are represented enough for the next review package; deferred surfaces are not claimed complete, Tasks CM and Pages CN are active clean scoped compact artifacts, Tasks UI does not imply store-backed task mutation or scheduler success, and Pages UI does not imply store-backed page mutation/history/Copilot success. | BOM-012 / SPEC-010 / GATE-004 |
| OR-012 | Ownership and migration boundary | Read prototype notes, confirmation gap audit and readiness docs. | Station/Desktop/Model ownership is clear and PLAN-P5 remains blocked before confirmation. | BOM-013/BOM-015 / SPEC-011/SPEC-013 / GATE-006/GATE-008 |

Every OR scenario that inspects a UI surface must use the `Visual Delta Checklist`
in `owner-review-checklist.md` for side-by-side LobeHub vs Peers comparison.
Each visual-delta row must keep both the live LobeHub URL and the `external/lobehub`
source anchor before Owner review can be treated as prepared.
The generated gate reports must show live/source/prototype anchor coverage counts.
The generated gate reports must show active/deferred disposition coverage counts.
The generated gate reports must show visual-comparison verdict coverage counts.
The generated gate reports must show explicit readiness-claim fields so `DONE` / `PROVEN` cannot be read as prototype confirmation or product migration authorization.
Before Owner confirmation, active surface rows must remain `undecided`; only
Owner-deferred rows may be `deferred`.

## 6. Decision Criteria

Owner may record `confirmed` only after every scenario is acceptable as a
migration reference, and all known unresolved states are acceptable as prototype
boundaries.

Owner must record `revision-required` if any major scenario is materially wrong,
missing, or misleading.

Owner may record `deferred` if more review evidence is needed.

## 7. Decision Record Template

```md
| EVID-011-Z-owner | BOM-012/BOM-015 | SPEC-010/SPEC-013/SPEC-014 | PLAN-P2 Owner review / PLAN-P5 entry control | GATE-003/GATE-004/GATE-005/GATE-006/GATE-008 | `docs/architecture/agent/prototype/owner-review-runbook.md`; `docs/architecture/agent/prototype/owner-review-checklist.md`; `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md`; Owner review notes; optional `make run-prototype` | OWNER_DECISION: confirmed / revision-required / deferred. Scenario results: OR-001..OR-012. | Product migration remains blocked unless the decision is `confirmed` and EVID-012 entry checks pass. |
```

If `confirmed`, update:

1. `packages/prototypes/desktop/features/agent-lobehub-parity/prototype.manifest.ts`
2. `docs/architecture/prototypes/README.md`
3. `docs/architecture/agent/prototype/README.md`
4. `tmp/agent-lobehub-fullstack-ledger.md`
5. `docs/architecture/agent/lobehub-parity/plan-p5-entry-gate.md`

If `revision-required`, keep product migration blocked and append concrete
correction items to the confirmation gap audit.

## 8. Current Claim

This runbook makes Owner review executable. It does not confirm the prototype,
does not start product migration, and does not satisfy GATE-008.
