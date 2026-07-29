# Agent LobeHub Parity - Pages Source Interaction Follow-up Revision

> **Status**: active Pages source-interaction artifact / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-09
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Pages source-interaction follow-up / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-PS-pre
> **BOM**: BOM-005 / BOM-012 / BOM-015
> **Spec**: SPEC-006 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

---

## 1. Purpose

`EVID-011-PG-pre` made Pages route, list, editor, history, import/export,
delete and Page Agent runtime contracts visible in the active review path. It
did not yet close the source-interaction chain: SWR list truth, optimistic
mutations, body autosave, edit-lock recovery, draft restore, history restore
save source, page-scoped copilot context and server-side Page Agent persistence
still needed to be visible as source-owned states.

`EVID-011-PS-pre` promotes Pages to an active source-interaction artifact at
`?surface=pages&state=page-runtime-contract&check=ps`. PG remains historical
runtime-contract context.

## 2. Source Anchors

| LobeHub Source | Relevance |
| --- | --- |
| `external/lobehub/src/features/Pages/PageLayout/Body/index.tsx` | `useFetchDocuments`, `AsyncBoundary`, retry, private/workspace buckets and empty-create rows. |
| `external/lobehub/src/features/Pages/PageLayout/Body/List/index.tsx` | Limited list, `hasMore`, loading more and All Pages drawer handoff. |
| `external/lobehub/src/features/Pages/PageLayout/DataSync.tsx` | Workspace-aware navigation is injected into the Page store. |
| `external/lobehub/src/store/page/slices/list/action.ts` | `documentSWRKeys.pageDocuments`, allowed source/file filters, SWR onData and refresh. |
| `external/lobehub/src/store/page/slices/internal/action.ts` | `internal_dispatchDocuments` is the reducer gateway for list mutations. |
| `external/lobehub/src/store/page/slices/crud/action.ts` | Optimistic create, temp-real replacement, delete rollback, rename/update optimistic patch and detail SWR. |
| `external/lobehub/src/store/page/slices/selection/action.ts` | Selected page, drawer and route selection ownership. |
| `external/lobehub/src/features/PageEditor/store/action.ts` | Debounced meta save, `metaReadOnly`, copy link, delete confirmation and right-panel mode. |
| `external/lobehub/src/features/PageEditor/StoreUpdater.tsx` | Injects editor handlers into `pageAgentRuntime` and commits Page Agent mutations as `saveSource=llm_call`. |
| `external/lobehub/src/store/document/slices/editor/action.ts` | Body content dirty/save flow through `handleContentChange`, `performSave`, `lockOwnerId` and document history save sources. |
| `external/lobehub/src/features/PageEditor/useDocumentLock.ts` | Edit-lock peek/acquire/heartbeat/release, recovery rehydrate and save-block clearing. |
| `external/lobehub/src/features/PageEditor/usePageDraft.ts` | `page-draft:<documentId>` sessionStorage snapshot, restore prompt and cleanup boundary. |
| `external/lobehub/src/features/PageEditor/History/index.tsx` | History SWR, compare modal and restore through `performSave(... saveSource=restore)`. |
| `external/lobehub/src/features/PageEditor/Header/useMenu.tsx` | Duplicate, copy link, history, delete, publish/make-private and export permission/action gates. |
| `external/lobehub/src/features/PageEditor/PageAgentProvider.tsx` | `ConversationContext` with `scope=page`, `documentId`, fallback Page Agent and `messageMapKey`. |
| `external/lobehub/src/features/PageEditor/Copilot/Conversation.tsx` | Page copilot model selector, upload/search actions and send disabled while locked by other. |
| `external/lobehub/src/store/tool/slices/builtin/executors/lobe-page-agent.ts` | Page Agent runtime singleton boundary for editor tool execution. |
| `external/lobehub/apps/server/src/services/toolExecution/serverRuntimes/pageAgent.ts` | Server Page Agent runtime executes headless editor mutations and persists through document service. |
| `external/lobehub/apps/server/src/services/document/index.ts` | `runWithDocumentLock`, history append/coalescing and document update ownership. |

## 3. Revision Scope

| Delta | PS Handling |
| --- | --- |
| PG proved runtime states but not source chains | PS adds five visible source map cards: list/cache, mutation/rollback, editor/lock, history/transfer and Page Agent. |
| List source could be mistaken for static sidebar rows | PS exposes SWR key, allowed source/file filters, `AsyncBoundary`, internal dispatch and drawer handoff. |
| Mutations lacked explicit optimistic and rollback lineage | PS exposes temp page replacement, server visibility/workspace ownership, delete restore and rename revert. |
| Editor recovery was too broad | PS separates debounced meta save, body autosave, `metaReadOnly`, lock lifecycle, recovery rehydrate and session draft restore. |
| History/transfer actions needed permission/failure boundaries | PS exposes history list, restore save source, compare modal, duplicate/export/publish/private/delete gates. |
| Page Agent needed source-scoped conversation proof | PS exposes `scope=page`, `documentId`, `messageMapKey(context)`, fallback Page Agent, server runtime persistence and lock-blocked send. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/pages-ps-source-interaction-scoped.png`, captured from `http://127.0.0.1:4183/?prototype=agent-lobehub-parity&preview=only&surface=pages&state=page-runtime-contract&check=ps`, opened and inspected at `1204x3200`; metadata `tmp/agent-lobehub-pages-ps-scoped-screenshot-meta.json` records sha256 `a41c55fe32319d04c05848cb2d1f3e7b2d95aa26b6a5c37955496583ef7052bd`. |
| L3 DOM | `tmp/agent-lobehub-pages-ps-dom.json` proves `marker=pages-source-interaction-ps`, `evidenceId=EVID-011-PS-pre`, `runtimeContractShell=true`, `sourceInteractionClosure=true`, five source map cards, five source columns, body autosave, server runtime, Redis lock strictness not claimed, draft restore, fail-closed warning, `forbiddenHits=[]` and `portalChromeHit=false`. |

## 5. Remaining Risk

PS is prototype/evidence promotion only. It does not prove real document
storage, SWR behavior, edit-lock heartbeat, Redis-backed lock strictness,
autosave persistence, draft restore, history restore, import parsing, Markdown
export, publish/make-private authorization, delete mutation, Page Agent tool
execution, gateway replay or product GATE-008 parity. LobeHub's Redis lock
outage path is explicitly not evidence of a fail-closed lock guarantee.

## 6. Claim Boundary

`EVID-011-PS-pre` promotes Pages from PG runtime-contract history to an active
source-interaction artifact. It does not confirm Pages, does not authorize
`EVID-012`, and does not allow Desktop / Station / Model product migration.
