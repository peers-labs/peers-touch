# Agent LobeHub Parity - Pages Runtime Contract Follow-up Revision

> **Status**: active Pages artifact promotion / not confirmed  
> **Version**: v0.1  
> **Created**: 2026-07-09  
> **Owner**: Peers-Touch Agent Team  
> **Plan Step**: PLAN-P2 Pages runtime contract follow-up / PLAN-P5 blocked precondition  
> **Evidence**: EVID-011-PG-pre  
> **BOM**: BOM-005 / BOM-012 / BOM-015  
> **Spec**: SPEC-006 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014  
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

---

## 1. Purpose

`EVID-011-DF-pre` proved a clean scoped `/page` placeholder artifact. That was
enough for the first-screen Pages baseline, but it left the risky source-backed
runtime contracts in deep review only.

`EVID-011-PG-pre` promotes Pages to an active runtime-contract artifact at
`?surface=pages&state=page-runtime-contract&check=pg`. It brings route/list,
editor/autosave/lock, history restore, import/export, delete rollback and Page
Agent context ownership into the active Owner review path.

## 2. Source Anchors

| LobeHub Source | Relevance |
| --- | --- |
| `external/lobehub/src/routes/(main)/page/_layout/index.tsx` | Pages route layout owns sidebar, outlet and data sync boundary. |
| `external/lobehub/src/routes/(main)/page/index.tsx` | `/page` default renders the placeholder, not editor success. |
| `external/lobehub/src/routes/(main)/page/[id]/index.tsx` | `/page/:id` owns selected document editor route. |
| `external/lobehub/src/features/Pages/PageLayout/Body/index.tsx` | SWR `useFetchDocuments`, `AsyncBoundary`, private/workspace buckets and empty-create actions. |
| `external/lobehub/src/features/Pages/PageLayout/Body/List/index.tsx` | Limited list, load-more state and All Pages drawer handoff. |
| `external/lobehub/src/features/Pages/PageLayout/Body/List/Item/index.tsx` | Selected page, rename editing, desktop double-click new-tab routing. |
| `external/lobehub/src/features/PageEditor/PageEditor.tsx` | Editor provider tree, scroll restoration, right panel, permissions and Page Agent provider. |
| `external/lobehub/src/features/PageEditor/store/action.ts` | Debounced meta save, copy link, delete confirmation, edit lock state and right-panel mode. |
| `external/lobehub/src/features/PageEditor/History/index.tsx` | History list, compare modal, restore confirmation and restore save source. |
| `external/lobehub/src/features/PageEditor/Header/useMenu.tsx` | Duplicate, copy, export, history, delete, publish and make-private action gates. |
| `external/lobehub/src/features/PageEditor/PageAgentProvider.tsx` | Page Agent context remains page-scoped instead of active-agent global state. |

## 3. Revision Scope

| Delta | PG Handling |
| --- | --- |
| DF only proved the default placeholder | PG makes `page-runtime-contract` the active review state and keeps DF as historical placeholder context. |
| List states were not active-review visible | PG exposes fetch loading, retryable error, empty-create, limited list, All Pages drawer and private/workspace bucket ownership. |
| Editor lock/autosave semantics were deep-only | PG exposes debounced meta save, dirty/saving/saved/metaReadOnly, edit-lock pending/unstable/lost/recovered states. |
| History and restore could be mistaken for static UI | PG exposes history loading/empty/compare/restore-confirm/restore-saving/restore-error as a source-backed contract. |
| Import/export/delete actions lacked recovery boundaries | PG marks import rollback, export failure and delete context preservation as explicit prototype states. |
| Page Agent sidecar lacked runtime ownership | PG shows Page Agent current-page/selection/tool-mutation/conflict context and keeps Station/Desktop ownership explicit. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/pages-pg-runtime-contract-scoped.png`, captured from `http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=pages&state=page-runtime-contract&check=pg`, opened and inspected at `1280x1500`. |
| L3 DOM | `tmp/agent-lobehub-pages-pg-dom.json`: `runtimeContractShell=true`, `marker=pages-runtime-contract-pg`, `evidenceId=EVID-011-PG-pre`, route/list/editor/lock/history/import/export/delete/Page Agent state fields present, `forbiddenHits=[]`, `portalChromeHit=false`. Metadata lives at `tmp/agent-lobehub-pages-pg-scoped-screenshot-meta.json`. |

## 5. Remaining Risk

PG is prototype/evidence promotion only. It does not prove real document
storage, SWR behavior, edit-lock heartbeat, autosave persistence, history
restore, import parsing, Markdown export, delete mutation, Page Agent tool
execution, gateway replay or product GATE-008 parity.

## 6. Claim Boundary

`EVID-011-PG-pre` promotes Pages from DF placeholder history to an active
runtime-contract artifact. It does not confirm Pages, does not authorize
`EVID-012`, and does not allow Desktop / Station / Model product migration.
