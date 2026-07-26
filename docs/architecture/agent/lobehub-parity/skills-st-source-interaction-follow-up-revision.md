# Agent LobeHub Parity - Skills Source Interaction Follow-up Revision

> **Status**: active Skills artifact promotion / not confirmed
> **Evidence**: EVID-011-ST-pre
> **BOM**: BOM-005, BOM-006, BOM-012, BOM-015
> **Spec**: SPEC-007, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Plan Step**: PLAN-P2 Skills / Tools source-interaction follow-up / PLAN-P5 blocked precondition
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

ST extends SR from a runtime-contract state map into source-interaction closure
across cache keys, store actions, services, runtime invocation and rendered chat
mentions:

- `external/lobehub/src/libs/swr/keys.ts`: owns `toolKeys` for
  uninstalled builtins, installed plugins and MCP plugin list windows.
- `external/lobehub/src/store/tool/slices/builtin/action.ts`: owns
  workspace-aware builtin install/uninstall, full `settings.tool` persistence
  and `mutate(toolKeys.uninstalledBuiltins(workspaceId))`.
- `external/lobehub/src/store/tool/slices/plugin/action.ts`: owns installed
  plugin refresh, plugin settings update and manifest validation.
- `external/lobehub/src/store/tool/slices/connector/action.ts`: owns
  connector list fetch, builtin/plugin/client tool sync, permission optimistic
  update and rollback via `fetchConnectors`.
- `external/lobehub/src/store/tool/slices/mcpStore/action.ts`: owns MCP install,
  dependency/config pauses, HTTP/stdio/cloud manifest resolution, cancel
  controllers, progress, error reporting and connection test state.
- `external/lobehub/src/services/plugin/index.ts`,
  `external/lobehub/src/services/mcp.ts` and
  `external/lobehub/src/services/skill/index.ts`: own durable plugin
  persistence, MCP tool invocation and Agent skill import/list/resource/update
  service calls.
- `external/lobehub/src/store/tool/slices/agentSkills/action.ts`: owns
  Agent skill CRUD/import store actions and list/detail/resource state.
- `external/lobehub/src/services/chat/mecha/skillEngineering.ts`,
  `external/lobehub/src/services/chat/mecha/skillPreload.ts`,
  `external/lobehub/src/services/chat/mecha/toolPreload.ts` and
  `external/lobehub/src/services/chat/mecha/toolSetComposer.ts`: own selected
  skill resolution, client skill preload and tool composition before model
  execution.
- `external/lobehub/src/features/ChatInput/ActionBar/Tools/**`: owns the
  Agent composer tool entry and model tool-use compatibility filter.
- `external/lobehub/src/features/ChatInput/InputEditor/ActionTag/**`: owns
  skill/tool chips, custom MIME drag/drop and code-context text preservation.
- `external/lobehub/src/store/chat/slices/agentRun/actions/transports/client/streamingExecutor.ts`
  and `external/lobehub/src/store/chat/agents/createAgentExecutors.ts`: own
  runtime tool set construction and tool dispatch.
- `external/lobehub/src/features/Conversation/Messages/AssistantGroup/Tool/**`:
  owns Tool Inspector loading/error/pending/rejected/aborted and fallback render
  states.
- `external/lobehub/src/features/Conversation/Markdown/plugins/Tool/Render.tsx`
  and `external/lobehub/src/features/Conversation/Markdown/plugins/Skill/Render.tsx`:
  own persisted tool/skill mention rendering and project skill resolution.

## SR Gap

`EVID-011-SR-pre` correctly promoted Skills / Tools from DI's success-state
permission editor to a runtime-contract review. It still grouped cache windows,
mutation paths and Agent consumers into one state surface. It did not explicitly
close the source chain from `toolKeys` through builtin/plugin/MCP/connector
actions, Agent skill import services, runtime invocation, Markdown rendering
and Station audit ownership.

## ST Revision

- Added `?surface=skills&state=skills-runtime-contract&check=st`.
- Added marker `skills-source-interaction-st` and evidence id
  `EVID-011-ST-pre`.
- Promoted Skills / Tools active evidence to source-interaction closure with:
  tool SWR key families, builtin install persistence, installed plugin refresh,
  connector sync, permission rollback, MCP install/test/cancel progress, skill
  import services, prompt preload/composition, runtime invocation, Tool
  Inspector recovery and Markdown Tool/Skill render.
- Kept SR as historical runtime-contract context and DI as historical default
  ConnectorDetail permission editor context.
- Kept Community Marketplace and Image-generation-oriented discovery out of
  scope; marketplace data remains discovery/reference only and does not imply
  installed Agent runtime capability.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/skills-st-source-interaction-scoped.png`, captured from `http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=skills&state=skills-runtime-contract&check=st`, opened and inspected. Metadata: `tmp/agent-lobehub-skills-st-scoped-screenshot-meta.json`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-skills-st-dom.json`: `marker=skills-source-interaction-st`, `sourceInteractionClosure=true`, tool SWR/action/consumer chain attributes, source map, source columns, marketplace deferred marker, fail-closed warning and product migration blocked state are present; `forbiddenHits=[]`; `portalChromeHit=false`. |

## Claim Boundary

`EVID-011-ST-pre` promotes Skills / Tools from SR's runtime-contract review to
an active source-interaction review. It does not confirm Skills / Tools, does
not prove marketplace data, real OAuth polling, connector persistence, MCP
execution, tool-call execution, skill import persistence, Station audit
ingestion, Owner confirmation, `EVID-012` authorization or product migration.
