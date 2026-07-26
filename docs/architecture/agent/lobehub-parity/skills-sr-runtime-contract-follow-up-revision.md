# Agent LobeHub Parity - Skills Runtime Contract Follow-up Revision

> **Status**: active Skills artifact promotion / not confirmed
> **Evidence**: EVID-011-SR-pre
> **BOM**: BOM-005, BOM-006, BOM-012, BOM-015
> **Spec**: SPEC-007, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Plan Step**: PLAN-P2 Skills / Tools runtime contract follow-up / PLAN-P5 blocked precondition
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

SR extends DI from the default ConnectorDetail permission editor into a
source-backed runtime contract across settings inventory, connector lifecycle
and Agent runtime consumption:

- `external/lobehub/src/routes/(main)/settings/skill/index.tsx`: owns
  query-derived `tab` / `view` / `skill`, selected tool reset and Settings >
  Skill master-detail composition.
- `external/lobehub/src/routes/(main)/settings/skill/features/LeftPanel.tsx`:
  owns Connectors / Skills tabs, Add dropdown, Store action and Custom
  Connector modal entry.
- `external/lobehub/src/routes/(main)/settings/skill/features/SkillDetail/index.tsx`:
  owns `syncBuiltinTool`, `syncPluginTools`, `syncToolsFromClient`,
  `fetchConnectors`, `noManifest`, permission denial and
  `LobehubConnectorAction` connect/disconnect states.
- `external/lobehub/src/features/Connectors/ConnectorDetail/index.tsx` and
  `ToolPermissionGroup.tsx`: own Reset, Sync/Refresh, lifecycle actions,
  Auto / Needs approval / Disabled batch and row permission updates.
- `external/lobehub/src/features/Connectors/CustomConnectorModal/legacyPluginMigration.ts`:
  requires connector create before sync, keeps the legacy plugin when sync
  fails and treats cleanup as best-effort after success.
- `external/lobehub/src/features/ChatInput/ActionBar/Tools/index.tsx` and
  `PopoverContent.tsx`: own model tool-use compatibility, tool popover search,
  pinned/auto counts, Store and Settings navigation.

## DI Gap

`EVID-011-DI-pre` correctly promoted the default Settings > Skill success
surface to a ConnectorDetail-like permission editor, but its active evidence was
still a single success-state review. It did not expose a consolidated contract
for sync/no-manifest/no-permission branches, OAuth polling, MCP import/test
recovery, legacy migration ordering, model tool-use compatibility or
turn-level tool-call lineage.

## SR Revision

- Added `?surface=skills&state=skills-runtime-contract&check=sr`.
- Added marker `skills-runtime-contract-sr` and evidence id
  `EVID-011-SR-pre`.
- Promoted Skills / Tools active evidence to runtime-contract level with:
  Settings route query-state, connector detail sync states, permission rollback,
  OAuth states, MCP states, legacy migration states, runtime tool states and
  explicit ownership labels.
- Kept DI as historical default ConnectorDetail permission editor evidence.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/skills-sr-runtime-contract-scoped.png`, captured from `http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=skills&state=skills-runtime-contract&check=sr`, opened and inspected. Metadata: `tmp/agent-lobehub-skills-sr-scoped-screenshot-meta.json`; SHA-256 `c58c418fd44543de8ab3b5d56a9988402df52b896d896f54fd84e30c63d12ad6`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-skills-sr-dom.json`: `marker=skills-runtime-contract-sr`, `runtimeContractShell=true`, Settings route state, detail sync state, permission state, OAuth state, MCP state, legacy migration state, runtime tool state, ownership, lifecycle contract and fail-closed warning are present; `forbiddenHits=[]`; `portalChromeHit=false`. |

## Claim Boundary

`EVID-011-SR-pre` promotes Skills / Tools from DI's ConnectorDetail success
state to an active runtime-contract review. It does not confirm Skills / Tools,
does not prove marketplace data, real OAuth polling, connector persistence, MCP
execution, tool-call execution, Station audit ingestion, Owner confirmation,
`EVID-012` authorization or product migration.
