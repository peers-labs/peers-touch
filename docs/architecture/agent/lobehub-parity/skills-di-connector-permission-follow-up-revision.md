# Agent LobeHub Parity - Skills Connector Permission Follow-up Revision

> **Evidence**: EVID-011-DI-pre
> **BOM**: BOM-005, BOM-006, BOM-012, BOM-015
> **Spec**: SPEC-007, SPEC-010, SPEC-013, SPEC-014
> **Plan Step**: PLAN-P2 Skills / Tools compact follow-up / PLAN-P5 blocked precondition
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

LobeHub `Settings > Skill` is a `NavHeader` + master-detail settings surface.
The default query-less view is `connector`, not a marketplace or schema detail
page:

- `external/lobehub/src/routes/(main)/settings/skill/index.tsx`: owns the
  `NavHeader`, `LeftPanel`, selected tool state and `SkillDetail` outlet.
- `external/lobehub/src/routes/(main)/settings/skill/features/LeftPanel.tsx`:
  owns the 300px left panel, `Connectors` / `Skills` tabs, Add dropdown and
  Store icon action.
- `external/lobehub/src/routes/(main)/settings/skill/features/SkillList.tsx`:
  groups connector view as Built-in Tools, OAuth Connectors, Community Tools
  and Custom Connectors; the Skills tab separately renders Built-in Skills,
  Community Skills and Custom Skills.
- `external/lobehub/src/routes/(main)/settings/skill/features/SkillDetail/index.tsx`:
  connector detail syncs or loads the connector manifest before rendering
  `ConnectorDetail`; empty, loading and no-permission states are separate
  fallback branches.
- `external/lobehub/src/features/Connectors/ConnectorDetail/index.tsx`:
  successful connector detail renders a 42px header with Reset permissions,
  Sync / Refresh and lifecycle actions, then description and tool permission
  groups.
- `external/lobehub/src/features/Connectors/ConnectorDetail/ToolPermissionGroup.tsx`:
  each tool group owns a count badge, batch permission menu and rows with
  Auto / Needs approval / Disabled choices.

## CQ Gap

`EVID-011-CQ-pre` promoted a clean scoped Skills artifact, but the default
right pane still looked like a product overview card stack: Permissions,
Available tools and Schema preview. LobeHub's default connector success state
does not show the marketplace overview/schema detail there; it renders the
connector permission editor after manifest sync.

## DI Revision

- Kept default Skills / Tools on the `Connectors` tab.
- Renamed connector groups to the source-backed sequence: Built-in Tools,
  OAuth Connectors, Community Tools and Custom Connectors.
- Replaced the default right-side overview/schema card stack with a
  ConnectorDetail-like permission editor: 42px header, Reset permissions,
  Refresh, Uninstall, manifest description, permission groups and per-tool
  Auto / Approval / Disable controls.
- Kept Add dropdown, Store modal, import failure, OAuth waiting, connector sync
  error and Custom MCP drawer as click-triggered or deep-review states, not
  default success content.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/skills-di-compact-settings-scoped.png`, captured from `http://localhost:3200/?surface=skills&state=compact-skills&check=di` after selecting `Agent LobeHub Parity`, clipped to `.pt-skill-settings-layout.is-compact-skills`, opened and inspected. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-skills-di-dom.json`: compact Skills shell, Connectors tab, left panel, Add and Store controls, Built-in Tools / OAuth Connectors / Community Tools / Custom Connectors groups, Web Search detail header, Reset / Refresh / Uninstall actions and permission rows are present; default Add menu, Store modal, MCP drawer, marketplace overview tabs and legacy schema cards are absent; Add menu opens after click; `forbiddenHits=[]`; metadata `tmp/agent-lobehub-skills-di-scoped-screenshot-meta.json`. |

## Claim Boundary

`EVID-011-DI-pre` promotes Skills / Tools from CQ history to the active compact
artifact gate for the source-backed connector permission success state. It does
not confirm Skills / Tools, does not authorize `EVID-012`, and does not allow
Desktop / Station / Model product migration.
