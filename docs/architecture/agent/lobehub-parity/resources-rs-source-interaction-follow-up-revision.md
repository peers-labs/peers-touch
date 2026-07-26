# Resources RS Source Interaction Follow-up Revision

> **Status**: active Resources artifact promotion / not confirmed
> **Evidence**: EVID-011-RS-pre
> **BOM**: BOM-005, BOM-012, BOM-015
> **Spec**: SPEC-006, SPEC-007, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Plan Step**: PLAN-P2 Resources source-interaction follow-up / PLAN-P5 blocked precondition
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

- `external/lobehub/src/features/ResourceManager/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/index.tsx`
- `external/lobehub/src/store/file/slices/resource/initialState.ts`
- `external/lobehub/src/types/resource.ts`
- `external/lobehub/src/services/knowledgeBase.ts`
- `external/lobehub/src/services/rag.ts`
- `external/lobehub/src/store/agent/slices/knowledge/action.ts`
- `external/lobehub/src/services/agent.ts`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/WorkingSidebar/Files/index.tsx`
- `external/lobehub/src/features/ChatInput/Desktop/ContextContainer/ContextList.tsx`
- `external/lobehub/src/features/ChatInput/InputEditor/useWorkspaceFileDrop.ts`
- `external/lobehub/src/features/ChatInput/InputEditor/workspaceFileDragData.ts`
- `external/lobehub/src/features/ChatInput/InputEditor/LocalFileTag/LocalFileTagPlugin.ts`
- `external/lobehub/src/features/Conversation/ChatInput/QueueTray.tsx`

## RR Gap

`EVID-011-RR-pre` correctly promoted Resources from the DR list-contract artifact to a runtime-contract artifact. It proved the presence of ResourceManager route/query states, upload/import/preview/index states, Agent-visible but unbound states and the base-resource / agent-domain / Station ownership boundary.

That was still too coarse for source-level parity because LobeHub does not treat Resources as one list. It links ResourceManager query/SWR/error precedence, optimistic resource sync, upload/chunk drawers, knowledge binding mutations and ChatInput context consumption. Those chains must be visible as separate source-backed interaction paths before Owner review can judge the surface at high fidelity.

## RS Revision

`EVID-011-RS-pre` keeps RR as historical runtime-contract context and promotes the active Resources artifact to a source-interaction closure:

- `data-review-marker="resources-source-interaction-rs"` on the scoped Resources artifact.
- `data-source-interaction-closure="true"`.
- `data-resource-manager-chain="url-swr-asyncboundary|optimistic-sync-queue|upload-dock|chunk-drawer|rag-retry"`.
- `data-agent-domain-chain="add-files|add-knowledge-base|toggle-file|toggle-knowledge-base|refresh-config|invalidate-visibility-caches"`.
- `data-agent-consumer-chain="working-sidebar-drag|localfile-mime|context-list|queue-restore|station-audit-pending"`.
- source map cards for `base-resource`, `agent-domain` and `agent-consumer`.
- source-level closure columns for URL/SWR, optimistic resource union, upload/chunk dock, file/KB add, enable toggle, public restriction, WorkingSidebar files, composer context list and QueueTray restore.

## L2 / L3 Evidence

- L2 screenshot: `tmp/agent-lobehub-l2-screenshots/resources-rs-source-interaction-scoped.png`
- L3 DOM: `tmp/agent-lobehub-resources-rs-dom.json`
- Screenshot metadata: `tmp/agent-lobehub-resources-rs-scoped-screenshot-meta.json`

DOM evidence proves:

- `marker=resources-source-interaction-rs`
- `evidenceId=EVID-011-RS-pre`
- `runtimeContractShell=true`
- `sourceInteractionClosure=true`
- `resourceManagerChain=url-swr-asyncboundary|optimistic-sync-queue|upload-dock|chunk-drawer|rag-retry`
- `agentDomainChain=add-files|add-knowledge-base|toggle-file|toggle-knowledge-base|refresh-config|invalidate-visibility-caches`
- `agentConsumerChain=working-sidebar-drag|localfile-mime|context-list|queue-restore|station-audit-pending`
- `sourceChainCount=3`
- `sourceColumnCount=3`
- `hasBaseResource=true`
- `hasAgentDomain=true`
- `hasAgentConsumer=true`
- `hasWorkingSidebarDrag=true`
- `hasContextList=true`
- `hasQueueRestore=true`
- `hasProductMigrationBlocked=true`
- `hasFailClosedWarning=true`
- `forbiddenHits=[]`
- `portalChromeHit=false`

## Claim Boundary

`EVID-011-RS-pre` promotes Resources from RR runtime-contract review to the active source-interaction artifact for Owner review. It does not confirm Resources, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

It does not prove real upload/import/index execution, SWR mutation, optimistic sync queue execution, Agent binding persistence, queued message file restore in product runtime, chunking/embedding execution, similarity search execution, delete/move side effects or Station audit ingestion.
