# Agent LobeHub Parity - Owner Review Decision Packet

> **Status**: pending-owner-decision / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Owner review decision capture / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-BZ-pre, EVID-011-CB-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CK-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-L23-pre, EVID-011-CT-pre

---

## 1. Purpose

This packet is the Owner-facing decision capture layer after `EVID-011-BY-pre`.
It turns the cross-surface evidence sweep into a concrete review form without
changing prototype status, authorizing `EVID-012` or starting product migration.

Use this packet with:

- `docs/architecture/agent/lobehub-parity/prototype-cross-surface-review-sweep.md`
- `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md`
- `docs/architecture/agent/lobehub-parity/prototype-visual-comparison-ledger.md`
- `docs/architecture/agent/prototype/owner-review-checklist.md`
- `docs/architecture/agent/prototype/owner-review-runbook.md`
- `tmp/agent-lobehub-fullstack-ledger.md`

## 2. Decision Boundary

| Boundary | Current State | Rule |
| --- | --- | --- |
| Prototype confirmation | `false` | Only an explicit Owner decision row may mark `confirmed`. |
| Product migration | `blocked` | A confirmed prototype still requires `EVID-012-working` plus PLAN-P5 entry gate before product edits. |
| Active surfaces | `undecided` | Owner must inspect each active row side-by-side before confirmation. |
| Image / Community | `deferred` | Deferred by Owner scope; do not claim complete in this review. |
| Gate reports | pass for preparation only | Gate pass proves package consistency, CS all-active-surface scoped artifact sync, GA confirmation gap audit refresh, L23 artifact integrity and CT checklist/runbook execution evidence coverage, not Owner confirmation or product parity. |

## 3. Owner Decision Capture Matrix

| Surface | Latest Evidence | Required Owner Action | Allowed Decision | If Revision Required |
| --- | --- | --- | --- | --- |
| Home | EVID-011-CB-pre / EVID-011-CJ-pre | Compare the compact Home dashboard revision against LobeHub live Home using CJ's clean scoped artifact: connector strip, floating composer density, model chips, Brief/task card and recommendations; use BX for deep inspection controls. | `confirmed` / `revision-required` | If still divergent, append another Home-specific `EVID-011-*` revision row before `EVID-012`. |
| Agent Chat | EVID-011-CC-pre / EVID-011-CK-pre | Compare the compact New Topic default against LobeHub live Chat using CK's clean scoped artifact: left action stack, `New Topic` header, `Lobe AI` greeting, compact composer, model/context/prompt/Allow List/Send controls; then use BT for deep topic/message/tool/ChatMiniMap/WorkingSidebar inspection. | `confirmed` / `revision-required` | Append a new Chat-specific `EVID-011-*` revision row before `EVID-012`. |
| Agent Profile | EVID-011-CD-pre / EVID-011-CL-pre | Compare the compact ProfileEditor default against LobeHub live Profile using CL's clean scoped artifact: agent rail, breadcrumb header, avatar, large `Enter agent name`, Model & Tools, Add Skill and Core Instructions editor; then use BU for avatar picker, ModelSelect, AgentTool, rich editor controls and Builder flow. | `confirmed` / `revision-required` | Append a new Profile-specific `EVID-011-*` revision row before `EVID-012`. |
| Tasks | EVID-011-CE-pre / EVID-011-CM-pre | Compare compact `All tasks` default against LobeHub live Tasks using CM's clean scoped artifact: grouped rows, search/create/settings controls and right Topic / Task Agent composer; use EVID-011-BV-pre for inline create, task menu, detail sections, schedule popover, TopicChatDrawer and Task Agent panel deep inspection. | `confirmed` / `revision-required` | Append a new Tasks-specific `EVID-011-*` revision row before `EVID-012`. |
| Pages | EVID-011-CF-pre / EVID-011-CN-pre | Compare compact `/page` placeholder default, left nav, Private/Workspace buckets and New document / Upload files / Import Notion cards first using CN's clean scoped artifact; use EVID-011-BW-pre for display menu, page menu, All Pages drawer, lock/autosave, history/compare and Copilot panel deep inspection. | `confirmed` / `revision-required` | Append a new Pages-specific `EVID-011-*` revision row before `EVID-012`. |
| Resources | EVID-011-CG-pre / EVID-011-CO-pre | Compare compact ResourceManager default, Resource sidebar, Private/Workspace toggle, category menu, Knowledge bases list, NavHeader actions and compact resource rows first using CO's clean scoped artifact; use EVID-011-BP-pre for search overlay, file drawer, action menu, drag/drop, upload dock and chunk drawer deep inspection. | `confirmed` / `revision-required` | Append a new Resources-specific `EVID-011-*` revision row before `EVID-012`. |
| Memory | EVID-011-CH-pre / EVID-011-CP-pre | Compare compact `/memory` Home default, Search/Home/category nav, action row, RoleTagCloud and Persona summary/detail first using CP's clean scoped artifact; use EVID-011-BQ-pre for filters, timeline/grid, analysis modal, detail menu, edit modal, loading and missing states deep inspection. | `confirmed` / `revision-required` | Append a new Memory-specific `EVID-011-*` revision row before `EVID-012`. |
| Skills / Tools | EVID-011-SI-pre / EVID-011-CQ-pre | Compare compact Settings > Skill default, global settings rail, 300px left panel, Connectors / Skills tabs, Add and Store icon actions, grouped connector sections and selected connector detail first using CQ's clean scoped artifact; use EVID-011-BR-pre for Add Skill menu, Store, import failure, OAuth, sync error and MCP drawer deep inspection. | `confirmed` / `revision-required` | Append a new Skills-specific `EVID-011-*` revision row before `EVID-012`. |
| Settings | EVID-011-SS-pre / EVID-011-CR-pre | Compare compact Settings > Provider `all` default against LobeHub live Settings first using CR's clean scoped artifact: grouped Settings nav, 280px provider menu, search/add actions, All Providers active row and enabled/custom/disabled provider grid; then use EVID-011-BS-pre for provider config/model list, Service Model and Storage deep inspection. | `confirmed` / `revision-required` | Append a new Settings-specific `EVID-011-*` revision row before `EVID-012`. |
| Image | deferred | Confirm deferral remains acceptable for this review scope. | `deferred` | Reopen later as a dedicated Image parity pass. |
| Community | deferred | Confirm deferral remains acceptable for this review scope. | `deferred` | Reopen later as a dedicated Community parity pass. |

## 4. Decision Rows To Append

If Owner confirms the active scope:

```md
| EVID-011-CA-owner | BOM-012/BOM-015 | SPEC-010/SPEC-013/SPEC-014 | PLAN-P2 Owner review decision / PLAN-P5 entry control | GATE-003/GATE-004/GATE-008 | `docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md`; Owner notes; latest gate reports | OWNER_DECISION: confirmed for active scope; Image and Community remain deferred | Product migration remains blocked until EVID-012-working is created and PLAN-P5 entry gate passes. |
```

If Owner requests revision:

```md
| EVID-011-CA-owner | BOM-012/BOM-015 | SPEC-010/SPEC-013/SPEC-014 | PLAN-P2 Owner review decision / PLAN-P5 entry control | GATE-003/GATE-004/GATE-008 | `docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md`; Owner notes; latest gate reports | OWNER_DECISION: revision-required for <surface list> | Product migration remains blocked; append surface-specific EVID-011 revision rows before any EVID-012 work. |
```

## 5. Claim Boundary

`EVID-011-BZ-pre` proves that the Owner decision capture packet is prepared and
linked into the review/gate evidence chain. `EVID-011-CJ-pre`, `EVID-011-CK-pre`,
`EVID-011-CL-pre`, `EVID-011-CM-pre`, `EVID-011-CN-pre`, `EVID-011-CO-pre`,
`EVID-011-CP-pre`, `EVID-011-CQ-pre` and `EVID-011-CR-pre` prove that all
9 active compact-baseline surfaces have clean scoped artifacts for Owner review.
`EVID-011-CS-pre` proves the review package is synchronized around those active
artifacts, `EVID-011-GA-pre` proves the confirmation gap audit has been
refreshed, `EVID-011-L23-pre` proves active compact artifact integrity is
gate-checked, and `EVID-011-CT-pre` proves checklist/runbook execution evidence
is gate-checked. None of these evidence records stores the Owner's decision,
confirms the prototype, authorizes `EVID-012`, edits product code or proves
GATE-008 product parity.
