# Agent LobeHub Parity - Skills Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Skills compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-SI-pre, EVID-011-CQ-pre

---

## 1. Purpose

`EVID-011-BR-pre` proved Skills / Tools deep interaction states such as Add Skill
menu, import failure, Skill Store tabs/detail/schema, OAuth waiting, connector
sync error and custom MCP drawer. LobeHub `/settings/skill` defaults to a quiet
Settings master-detail page: `NavHeader`, a 300px `LeftPanel`, Connectors /
Skills tabs, Add and Store icon actions, grouped `SkillList` and a selected
`SkillDetail`.

This revision changes default Skills / Tools to that compact Settings baseline
while preserving BR review states such as `state=deep-skills`,
`state=import-failure`, `state=store-open`, `addMenu=1`, `mcpDrawer=1`,
`oauth=1` and `syncError=1`.

`EVID-011-CQ-pre` promotes that default Skills / Tools baseline from the earlier
SI wide screenshot into a clean scoped `.pt-skill-settings-layout.is-compact-skills`
L2/L3 artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | SI Revision |
| --- | --- |
| Default Skills / Tools could read as a deep review workbench | Default `?surface=skills&check=si` now renders a compact Settings > Skill master-detail baseline. |
| LobeHub defaults to Connectors unless `tab=skill` or `view=skill` is present | Compact default keeps Connectors active and selects the first connector row. |
| LobeHub left panel is 300px with tabs, Add menu trigger, Store trigger and grouped list | Added compact left panel with Connectors / Skills tabs, two icon actions and Built-in Tools / OAuth Connectors / Community MCPs / Custom MCPs sections. |
| LobeHub default does not open Store, import, OAuth or MCP drawers | DOM evidence proves Add menu, Store modal, import dialog, OAuth status, sync error and custom MCP drawer are absent by default. |
| Existing BR deep evidence remains needed | Preserved `state=deep-skills` and `state=import-failure` for Add menu, Store modal, import error, OAuth wait, sync error and custom MCP drawer inspection. |
| Active compact artifact gate still used the SI wide screenshot | CQ adds a clean scoped `.pt-skill-settings-layout.is-compact-skills` screenshot and DOM artifact so Owner/gate evidence validates the Skills / Tools surface itself, not a broad capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/settings/skill/index.tsx`, `external/lobehub/src/routes/(main)/settings/skill/features/LeftPanel.tsx`, `external/lobehub/src/routes/(main)/settings/skill/features/SkillList.tsx`, `external/lobehub/src/routes/(main)/settings/skill/features/SkillDetail/index.tsx`, `external/lobehub/src/routes/(main)/settings/skill/features/Actions.tsx`, `external/lobehub/src/features/SkillStore/SkillStoreContent.tsx`, `external/lobehub/src/features/PluginDevModal/index.tsx`. |
| L2 Visual | Final SI prototype screenshot `tmp/agent-lobehub-l2-screenshots/skills-si-compact-settings-wide.png`, opened and inspected at 1391x560. CQ clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/skills-cq-compact-settings-scoped.png`, captured from `http://localhost:3200/?surface=skills&state=compact-skills&check=cq` after selecting `Agent LobeHub Parity` in Prototype Portal, clipped to `.pt-skill-settings-layout.is-compact-skills`, opened and inspected at 1320x675. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-skills-si-dom.json`: `compactSkills=true`, `skillSettingsLayout=true`, `leftPanel=true`, `detailPanel=true`, `viewTabs=2`, `activeTab=Connectors`, `iconActions=2`, `sectionCount=4`, `navItems=7`, `selectedConnector=Web Search`, `detailTabs=3`, `permissionRows=3`, `toolChips=4`, `schemaPreview=true`, `addMenuAbsentByDefault=true`, `storeModalAbsentByDefault=true`, `importDialogAbsentByDefault=true`, `customMcpDrawerAbsentByDefault=true`, `oauthStatusAbsentByDefault=true`, `syncErrorAbsentByDefault=true`, `evidenceChipAbsentByDefault=true`, `layoutWidth=1320`, `leftPanelWidth=300`, `forbiddenHits=[]`. CQ DOM `tmp/agent-lobehub-skills-cq-dom.json`: `root=true`, `compactSkills=true`, `compactShell=true`, `scopedSelector=".pt-skill-settings-layout.is-compact-skills"`, `leftPanel=true`, `detailPanel=true`, `viewTabs=2`, `activeTab="Connectors"`, `iconActions=2`, `sectionCount=4`, `navItems=7`, `selectedConnector="Web Search"`, `detailTabs=3`, `permissionRows=3`, `toolChips=4`, `schemaPreview=true`, default overlays absent, `evidenceChipAbsentByDefault=true`, `layoutWidth=1320`, `leftPanelWidth=300`, `forbiddenHits=[]`, `portalChromeHit=false`; metadata `tmp/agent-lobehub-skills-cq-scoped-screenshot-meta.json` records the scoped clip. |

## 4. Remaining Risk

This revision improves default Skills / Tools visual parity only. It does not
prove real permission-gated install/uninstall, OAuth popup/message/polling,
Composio/LobeHub/MCP store data, SWR retry precedence, connector migration,
schema file-tree viewer, CustomConnectorModal persistence, PluginDevModal
transport behavior, tool-call runtime authorization or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-SI-pre` proves a Skills / Tools compact default prototype revision
with L2/L3 evidence. `EVID-011-CQ-pre` proves the clean scoped Skills / Tools
artifact is strong enough for active compact artifact validation. Neither
evidence confirms Skills / Tools, creates or authorizes `EVID-012`, or allows
Desktop / Station / Model product migration.
