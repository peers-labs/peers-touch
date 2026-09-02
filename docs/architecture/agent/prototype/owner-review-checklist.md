# Agent LobeHub Prototype Owner Review Checklist

> **Status**: pending-review-checklist
> **Version**: v0.4
> **Created**: 2026-07-07 | **Updated**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 / Owner review
> **Evidence**: EVID-010-PROTOTYPE-REBUILD-N, EVID-011-P-pre, EVID-011-Y-pre, EVID-011-AA-pre, EVID-011-Z-owner, EVID-011-AS-pre..EVID-011-GA-pre, EVID-011-CJ-pre, EVID-011-CK-pre, EVID-011-CZ-pre, EVID-011-DA-pre, EVID-011-DB-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CM-pre, EVID-011-CN-pre, EVID-011-CO-pre, EVID-011-CP-pre, EVID-011-CQ-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre, EVID-011-CU-pre, EVID-011-CV-pre, EVID-011-CW-pre, EVID-011-CX-pre, EVID-011-CY-pre, EVID-011-DC-pre

---

## Review Target

| Field | Value |
| --- | --- |
| Prototype ID | `agent-lobehub-parity` |
| Prototype path | `packages/prototypes/desktop/features/agent-lobehub-parity/` |
| Prototype docs | `docs/architecture/agent/prototype-lobehub-parity/README.md` |
| Owner review runbook | `docs/architecture/agent/prototype/owner-review-runbook.md` |
| Confirmation gap audit | `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md` |
| Owner decision packet | `docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md` |
| Home visual delta triage | `docs/architecture/agent/lobehub-parity/home-ca-visual-delta-triage.md` |
| Home compact dashboard revision | `docs/architecture/agent/lobehub-parity/home-cb-compact-dashboard-revision.md` |
| Agent Chat compact New Topic revision | `docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md` |
| Agent Chat active compact artifact | `docs/architecture/agent/lobehub-parity/chat-da-compact-follow-up-revision.md`; `docs/architecture/agent/lobehub-parity/chat-db-clean-scoped-artifact-refresh.md`; EVID-011-DC-pre guards this checklist against stale CK active-artifact wording |
| Agent Profile compact editor revision | `docs/architecture/agent/lobehub-parity/profile-cd-compact-editor-revision.md`; active DD artifact `docs/architecture/agent/lobehub-parity/profile-dd-compact-builder-follow-up-revision.md` |
| Tasks compact default revision | `docs/architecture/agent/lobehub-parity/tasks-ce-compact-default-revision.md` |
| Pages compact default revision | `docs/architecture/agent/lobehub-parity/pages-cf-compact-default-revision.md` |
| Resources compact default revision | `docs/architecture/agent/lobehub-parity/resources-cg-compact-default-revision.md` |
| Memory compact default revision | `docs/architecture/agent/lobehub-parity/memory-ch-compact-default-revision.md` |
| Skills compact default revision | `docs/architecture/agent/lobehub-parity/skills-si-compact-default-revision.md` |
| Settings compact default revision | `docs/architecture/agent/lobehub-parity/settings-ss-compact-default-revision.md` |
| All-active scoped artifact sync | `EVID-011-CS-pre`; latest gate reports verify 9 active surfaces use scoped L2/L3 artifacts |
| Active compact artifact validation | `EVID-011-L23-pre`; gate scripts validate screenshot readability, DOM parseability, compact markers and empty forbidden hits |
| Review execution evidence guard | `EVID-011-CT-pre`; gate scripts validate this checklist and the runbook keep the current scoped artifact evidence set |
| Review URL allowlist guard | `EVID-011-CU-pre`; gate scripts validate known active review URLs and reject stale prototype query params |
| Review URL source reachability guard | `EVID-011-CV-pre`; gate scripts validate active review URLs are backed by prototype source branches, handled state tokens and compact markers |
| Chat active artifact freshness guard | `EVID-011-DC-pre`; gate scripts validate Owner/P5 review docs remain synchronized to the DA/DB Chat artifact instead of the historical CK baseline |
| Current status | `pending-review` / not confirmed |
| Product migration | blocked until Owner confirms |

## Mandatory Evidence Before Review

| Gate | Required proof | Current evidence | Review result |
| --- | --- | --- | --- |
| GATE-001 LobeHub Source Coverage | LobeHub file paths listed for Home, Chat, Profile, Provider, Memory, Tool, Knowledge, Session and Runtime. | `source-audit.md`, `prototype-lobehub-parity/README.md`, EVID-001..EVID-011-BD-pre | ready for Owner review |
| GATE-003 Prototype Runnable | Prototype build, registry state and Portal Owner entry are aligned for Owner review. | EVID-010-PROTOTYPE-REBUILD-N, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BE-pre | pending-review proof only |
| GATE-004 Interaction Complete | Active review scope has clickable/source-backed Home, Chat, Profile, Tasks, Pages, Resources, Memory, Skills and Settings evidence, clean scoped artifacts for all 9 active surfaces, CS review-package sync and L23 artifact validation. Image and Community are Owner-deferred. | EVID-011-AS-pre..EVID-011-GA-pre plus EVID-011-CJ/CK/CL/DD/CM/CN/CO/CP/CQ/CR/CS/L23-pre | pending-review proof only |
| GATE-005 Provider/model Correctness | UI expresses provider + model identity from Settings Provider projection. | EVID-010-PROTOTYPE-REBUILD-N, EVID-011-AV-pre, EVID-011-BA-pre | pending-review proof only |
| GATE-006 Architecture Boundary | Station/Desktop/Model ownership is visible in docs and prototype notes. | EVID-006, EVID-007, EVID-011-O-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre | pending-review proof only |
| GATE-008 Product Migration Check | Product checks pass only after implementation. | none | not-started |

## Surface Review Checklist

| Surface | Must inspect | Current claim | Owner disposition |
| --- | --- | --- | --- |
| Home | Compact dashboard default with connector strip, floating composer density, model chips, Brief/task card and recommendation cards; CJ is the clean scoped active artifact, with CB retained as revision history. Deep review remains available for AgentSelect async/retry/active rows, daily hint, input notice, ChatInput context/file/typo controls, tools/model/history popovers, StarterList states, Recents accordion/menu/rename/drawer and Featured plugins. | source-backed revision evidence; CB/CJ remain pending Owner decision | undecided |
| Agent Chat | Compact New Topic default with `New Topic` header, `Lobe AI` greeting, live-like icon rail, agent switcher popover, topic grouping, compact composer, `Agent` / `No device` / `Allow List` footer and `Space` / `Params` affordance. Deep review remains available for ChatList-like virtualized meta, cached-topic refresh, thread hydration recovery, message context menu, tool detail inspector, intervention bar, BackBottom, ChatMiniMap, forward footer and WorkingSidebar resize. | DA implemented after CZ; DB provides the active clean scoped L2/L3 artifacts; DC keeps this review package from drifting back to historical CK evidence before Owner confirmation | undecided |
| Agent Profile | Compact ProfileEditor default with agent rail, breadcrumb header, avatar, large `Enter agent name`, Model & Tools, Add Skill, Core Instructions editor and right Agent Builder prompt/suggestion/composer first screen; deep review remains available for avatar picker, config hydration/edit-lock, ModelSelect menu, AgentTool menu, rich editor typo/slash controls, settings preview, Builder topic selector, suggestion feedback and Builder composer. | source-backed revision evidence; DD is the active artifact, while CD/CL remains historical pending Owner decision | undecided |
| Tasks | Compact `All tasks` default with grouped rows, search/create/settings controls and right Topic / Task Agent composer; CM is the clean scoped active artifact, with CE retained as history; deep review remains available for list/board, inline create draft/attachments/error, context menu, route-like detail editors, schedule popover, topic drawer, right Task Agent resize/chat controls and approval/delete states. | source-backed revision evidence; CE/CM remain pending Owner decision | undecided |
| Pages | Compact `/page` placeholder default with left Pages nav, Private/Workspace buckets and New document / Upload files / Import Notion cards; deep review remains available for display menu, page item context menu, All Pages drawer, editor autosave/lock banners, meta/rich blocks, version history, compare modal, Page Copilot topics/chat/composer and right-panel resize. | source-backed revision evidence; CF/CN remain pending Owner decision | undecided |
| Resources | Compact ResourceManager default with Resource sidebar, Private/Workspace toggle, category menu, Knowledge bases list, NavHeader actions and compact resource rows; CO is the clean scoped active artifact, with CG retained as history; deep review remains available for search overlay, file drawer, row action menu, drag/drop overlay, upload dock and chunk drawer. | source-backed revision evidence; CG/CO remain pending Owner decision | undecided |
| Memory | Compact `/memory` Home default with Search/Home/category nav, action row, RoleTagCloud and Persona summary/detail; CP is the clean scoped active artifact, with CH retained as history; deep review remains available for category list/filter, analysis modal/progress, timeline/grid, detail menu, edit modal, loading and unavailable states. | source-backed revision evidence; CH/CP remain pending Owner decision | undecided |
| Skills / Tools | Compact Settings > Skill default with global settings rail, 300px left panel, Connectors / Skills tabs, Add and Store icon actions, grouped connector sections and selected connector detail; CQ is the clean scoped active artifact, with SI retained as history; deep review remains available for Add Skill menu, Skill Store tabs/detail/schema, management, connectors, Import URL validation/API failure, OAuth waiting, connector sync error, custom MCP drawer and success-unproven state. | source-backed revision evidence; SI/CQ remain pending Owner decision | undecided |
| Image | Generation controls, result cards, preview, download request, copy failure. | deferred by Owner for current review scope | deferred |
| Settings | Compact Settings > Provider `all` default with grouped Settings nav, 280px provider menu, Search providers, Add custom provider, All Providers active row and enabled/custom/disabled provider grid; CR is the clean scoped active artifact, with SS retained as history; deep review remains available for provider search/add/sort, model tabs/error/config/delete, service model grouped assignment and storage loading/retry. | source-backed revision evidence; SS/CR remain pending Owner decision | undecided |
| Community | Categories/search/sort/detail/version/schema/install method/external link and subtype labels. | deferred by Owner for current review scope | deferred |

## Visual Delta Checklist

Owner review must compare LobeHub and Peers side-by-side. A source path or a remembered screenshot is not enough for confirmation.
Each `LobeHub reference` cell must include both a live `app.lobehub.com` URL and an `external/lobehub` source path.
Gate reports must surface LobeHub live, LobeHub source and Peers prototype anchor coverage as separate counts.
Gate reports must surface active `undecided` and deferred `deferred` disposition coverage as separate counts.
Gate reports must surface visual comparison verdict coverage as separate counts for active and deferred surfaces.
Gate reports must include explicit readiness-claim fields that keep prototype confirmation, product migration and EVID-012 authorization false before Owner confirmation.
Pre-confirmation disposition is fail-closed: active surfaces remain `undecided`, and only Owner-deferred surfaces may be marked `deferred`.

| Surface | LobeHub reference | Peers prototype reference | Side-by-side action | Owner disposition |
| --- | --- | --- | --- | --- |
| Home | `https://app.lobehub.com/`; `external/lobehub/src/routes/(main)<home>`; `external/lobehub/src/features/AgentHome/**`; `external/lobehub/src/features/ChatInput/**` | `agent-lobehub-parity` `?surface=home&state=compact-home&check=ci`; `docs/architecture/agent/lobehub-parity/home-cb-compact-dashboard-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-scoped.png`; DOM `tmp/agent-lobehub-home-ci-dom.json`; metadata `tmp/agent-lobehub-home-ci-scoped-screenshot-meta.json`; CB history `tmp/agent-lobehub-l2-screenshots/home-cb-compact-dashboard-region.png`; deep inspection `?surface=home&state=deep-home&check=bx` | Run side-by-side visual and interaction delta review for the compact Home dashboard first using CJ's clean scoped artifact: connector strip, floating composer density, model chips, Brief/task card and recommendation cards. Then use BX deep-home for AgentSelect, context/file/typo controls, popovers and Recents states. | undecided |
| Agent Chat | `https://app.lobehub.com/agent/agt_e78tsQpHIgjF`; `external/lobehub/src/routes/(main)/agent/features/Conversation/ConversationArea.tsx`; `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx`; `external/lobehub/src/features/Conversation/ChatList/index.tsx`; `external/lobehub/src/features/Conversation/ChatInput/index.tsx`; `external/lobehub/src/features/ChatInput/Desktop/index.tsx`; `external/lobehub/src/features/ChatInput/SendArea/index.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Header/Nav.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/List/index.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/AgentListContent.tsx` | `agent-lobehub-parity` `?surface=chat&check=da`; `docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md`; `docs/architecture/agent/lobehub-parity/chat-cz-side-by-side-delta-triage.md`; `docs/architecture/agent/lobehub-parity/chat-da-compact-follow-up-revision.md`; `docs/architecture/agent/lobehub-parity/chat-db-clean-scoped-artifact-refresh.md`; screenshot `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png`; DOM `tmp/agent-lobehub-chat-da-dom.json`; scoped metadata `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json`; deep inspection `?surface=chat&state=deep-chat&working=review&check=bt` | Run side-by-side visual and interaction delta review after DB: verify compact Chat now includes live-like icon rail, agent switcher popover, topic grouping, `Agent` / `No device` / `Allow List` composer footer and `Space` / `Params` affordance using DA's clean scoped L2/L3 artifacts. Keep Chat `undecided` until Owner accepts. BT deep-chat remains available for message stream, context menu, tool detail, ChatMiniMap, forward selection and WorkingSidebar resize. | undecided |
| Agent Profile | `https://app.lobehub.com/agent/agt_iWCUvmNhYz73/profile`; `external/lobehub/src/routes/(main)/agent/profile/index.tsx`; `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`; `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentHeader.tsx`; `external/lobehub/src/features/AgentBuilder/**`; `external/lobehub/src/features/ProfileEditor/AgentTool.tsx` | `agent-lobehub-parity` `?surface=profile&check=dd`; `docs/architecture/agent/lobehub-parity/profile-cd-compact-editor-revision.md`; `docs/architecture/agent/lobehub-parity/profile-dd-compact-builder-follow-up-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/profile-dd-compact-builder-scoped.png`; DOM `tmp/agent-lobehub-profile-dd-dom.json`; scoped metadata `tmp/agent-lobehub-profile-dd-scoped-screenshot-meta.json`; deep inspection `?surface=profile&state=deep-profile&check=bu` | Run side-by-side visual and interaction delta review for the compact ProfileEditor default first: agent rail, breadcrumb header, avatar, large `Enter agent name`, Model & Tools, Add Skill, Core Instructions editor and Builder prompt/suggestion/composer. DD is the active scoped L2/L3 artifact; BU deep-profile remains available for avatar picker, config recovery/edit lock, ModelSelect, AgentTool, rich EditorCanvas controls, settings preview and Agent Builder topic/composer flow. | undecided |
| Tasks | `https://app.lobehub.com/tasks`; `external/lobehub/src/routes/(main)/tasks/index.tsx`; `external/lobehub/src/features/AgentTasks/**`; `external/lobehub/src/features/AgentTaskManager/**` | `agent-lobehub-parity` `?surface=tasks&check=cm`; `docs/architecture/agent/lobehub-parity/tasks-ce-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/tasks-cm-compact-tasks-scoped.png`; DOM `tmp/agent-lobehub-tasks-cm-dom.json`; scoped metadata `tmp/agent-lobehub-tasks-cm-scoped-screenshot-meta.json`; deep inspection `?surface=tasks&state=deep-tasks&check=bv` | Run side-by-side visual and interaction delta review for the compact `All tasks` default first using CM's clean scoped artifact: grouped rows, search/create/settings controls and right Topic / Task Agent composer. Then use BV deep-tasks for inline create, task context menu, list/board, detail outlet/editors, schedule popover, topic drawer and right Task Agent resize/chat controls. | undecided |
| Pages | `https://app.lobehub.com/page`; `external/lobehub/src/routes/(main)/page/_layout/**`; `external/lobehub/src/routes/(main)/page/(home)/index.tsx`; `external/lobehub/src/features/Pages/**`; `external/lobehub/src/features/PageEditor/**` | `agent-lobehub-parity` `?surface=pages&check=cn`; `docs/architecture/agent/lobehub-parity/pages-cf-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/pages-cn-compact-pages-scoped.png`; DOM `tmp/agent-lobehub-pages-cn-dom.json`; metadata `tmp/agent-lobehub-pages-cn-scoped-screenshot-meta.json`; CF history `tmp/agent-lobehub-l2-screenshots/pages-cf-compact-pages-placeholder-wide.png`; deep inspection `?surface=pages&state=deep-pages&check=bw` | Run side-by-side visual and interaction delta review for the compact `/page` placeholder first using CN's clean scoped artifact: left nav, Private/Workspace buckets and New document / Upload files / Import Notion cards. Then use BW deep-pages for list display menu, item dropdown, All Pages drawer, editor lock/autosave, history/compare and Page Copilot right panel. | undecided |
| Resources | `https://app.lobehub.com/resource`; `external/lobehub/src/routes/(main)/resource/(home)/index.tsx`; `external/lobehub/src/routes/(main)/resource/(home)/_layout/**`; `external/lobehub/src/features/ResourceManager/**` | `agent-lobehub-parity` `?surface=resources&state=compact-resources&check=co`; `docs/architecture/agent/lobehub-parity/resources-cg-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/resources-co-compact-explorer-scoped.png`; DOM `tmp/agent-lobehub-resources-co-dom.json`; metadata `tmp/agent-lobehub-resources-co-scoped-screenshot-meta.json`; CG history `tmp/agent-lobehub-l2-screenshots/resources-cg-compact-explorer-wide.png`; deep inspection `?surface=resources&state=deep-resource&check=bp` | Run side-by-side visual and interaction delta review for the compact ResourceManager default first using CO's clean scoped artifact: Resource sidebar, Private/Workspace toggle, category menu, Knowledge bases list, NavHeader actions and compact resource rows. Then use BP deep-resource for search overlay, file drawer, action menu, drag/drop overlay, upload dock and chunk drawer. | undecided |
| Memory | `https://app.lobehub.com/memory`; `https://app.lobehub.com/memory/preferences`; `external/lobehub/src/routes/(main)/memory/_layout/**`; `external/lobehub/src/routes/(main)/memory/(home)/**`; `external/lobehub/src/routes/(main)/memory/features/**` | `agent-lobehub-parity` `?surface=memory&state=compact-memory&check=cp`; `docs/architecture/agent/lobehub-parity/memory-ch-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/memory-cp-compact-home-scoped.png`; DOM `tmp/agent-lobehub-memory-cp-dom.json`; metadata `tmp/agent-lobehub-memory-cp-scoped-screenshot-meta.json`; CH history `tmp/agent-lobehub-l2-screenshots/memory-ch-compact-home-wide.png`; deep inspection `?surface=memory&state=deep-memory&check=bq`; `?surface=memory&state=detail-missing&check=bq` | Run side-by-side visual and interaction delta review for compact `/memory` Home first using CP's clean scoped artifact: Search/Home/category nav, action row, RoleTagCloud and Persona content. Then use BQ deep-memory for filters, timeline/grid, analysis status/modal, detail menu, edit modal, loading and not-found states. | undecided |
| Skills / Tools | `https://app.lobehub.com/settings/skill`; `external/lobehub/src/routes/(main)/settings/skill/**`; `external/lobehub/src/features/SkillStore/**`; `external/lobehub/src/features/PluginDevModal/**` | `agent-lobehub-parity` `?surface=skills&state=compact-skills&check=cq`; `docs/architecture/agent/lobehub-parity/skills-si-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/skills-cq-compact-settings-scoped.png`; DOM `tmp/agent-lobehub-skills-cq-dom.json`; metadata `tmp/agent-lobehub-skills-cq-scoped-screenshot-meta.json`; SI history `tmp/agent-lobehub-l2-screenshots/skills-si-compact-settings-wide.png`; deep inspection `?surface=skills&state=deep-skills&check=br`; `?surface=skills&state=import-failure&check=br` | Run side-by-side visual and interaction delta review for compact Settings > Skill default first using CQ's clean scoped artifact: global settings rail, 300px left panel, Connectors / Skills tabs, Add and Store icon actions, grouped connector sections and selected connector detail. Then use BR deep-skills/import-failure for Add Skill menu, Skill Store, import failure, OAuth waiting, connector sync error and custom MCP drawer. | undecided |
| Image | `https://app.lobehub.com/image`; `external/lobehub/src/routes/(main)/(create)/image/**` | `agent-lobehub-parity` `?surface=image&state=copy-failure` | Run side-by-side visual and interaction delta review only to verify deferred scope is honest and not claimed complete. | deferred |
| Settings | `https://app.lobehub.com/settings/provider`; `https://app.lobehub.com/settings/provider/all`; `https://app.lobehub.com/settings/service-model`; `https://app.lobehub.com/settings/storage`; `https://app.lobehub.com/settings/about`; `external/lobehub/src/routes/(main)/settings/_layout/**`; `external/lobehub/src/routes/(main)/settings/provider/**`; `external/lobehub/src/features/ServiceModel/ModelAssignmentsForm.tsx` | `agent-lobehub-parity` `?surface=settings&state=compact-settings&check=cr`; `docs/architecture/agent/lobehub-parity/settings-ss-compact-default-revision.md`; screenshot `tmp/agent-lobehub-l2-screenshots/settings-cr-compact-provider-grid-scoped.png`; DOM `tmp/agent-lobehub-settings-cr-dom.json`; metadata `tmp/agent-lobehub-settings-cr-scoped-screenshot-meta.json`; SS history `tmp/agent-lobehub-l2-screenshots/settings-ss-compact-provider-grid-wide.png`; deep inspection `?surface=settings&state=deep-settings&check=bs`; `?surface=settings&tab=Service%20Model&state=service-picker&check=bs`; `?surface=settings&tab=Storage&check=bs` | Run side-by-side visual and interaction delta review for compact Settings > Provider `all` default first using CR's clean scoped artifact: grouped settings nav, 280px provider menu, search/add, All Providers and provider grid. Then use BS deep-settings/service/storage for provider config/model list, service model assignment and storage recovery. | undecided |
| Community | `https://app.lobehub.com/community`; `external/lobehub/src/routes/(main)/community/**` | `agent-lobehub-parity` `?surface=community&category=workspace` | Run side-by-side visual and interaction delta review only to verify deferred marketplace scope is honest and not claimed complete. | deferred |

## Confirmation Gap Audit

Use `docs/architecture/agent/prototype/owner-review-runbook.md` for the ordered OR-001..OR-012 review scenarios.

Before marking the prototype `confirmed`, review `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md`.

The gap audit separates:

- already evidenced pending-review proof,
- Owner judgment items,
- honest unresolved/tool-limited states,
- fail-closed conditions that keep product migration blocked.

## Confirm / Reject Criteria

Owner may mark `confirmed` only if:

1. The prototype is acceptable as the product migration reference despite known non-product mock states.
2. Known unresolved states are explicitly acceptable as honest placeholders, not hidden defects.
3. Provider/model identity, ownership labels and product migration fail-closed boundary are acceptable.
4. Any required visual or interaction correction is small enough to track as a migration task rather than a prototype blocker.

Owner must keep `pending-review` or mark `revision-required` if:

1. The prototype still fails to resemble LobeHub at the required interaction or visual fidelity.
2. A major LobeHub surface is missing, materially wrong, or unverifiable.
3. A live-unresolved state is falsely represented as a success state.
4. Product migration risk is unclear or the Station/Desktop/Model ownership boundary is ambiguous.

## Decision Recording Template

```md
| EVID-011-Q-owner | BOM-012/BOM-015 | SPEC-010/SPEC-013 | PLAN-P2 Owner review / PLAN-P5 entry control | GATE-003/GATE-004/GATE-008 | `docs/architecture/agent/prototype/owner-review-checklist.md`; Owner review notes; optional `make run-prototype` evidence | OWNER_DECISION: confirmed / revision-required / deferred | Product migration remains blocked unless the decision is confirmed and PLAN-P5 entry checks pass. |
```

## Current Claim Boundary

This checklist does not confirm the prototype.

It is the reviewable decision surface. Until the Owner records `confirmed`, `agent-lobehub-parity` remains `pending-review` and product migration remains blocked.
