# Agent LobeHub Parity - Memory Compact Home Follow-up Revision

> **Evidence**: EVID-011-DH-pre  
> **BOM**: BOM-004, BOM-012, BOM-015  
> **Spec**: SPEC-004, SPEC-010, SPEC-013, SPEC-014  
> **Plan Step**: PLAN-P2 Memory compact Home follow-up / PLAN-P5 blocked precondition  
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

LobeHub `/memory` defaults to a Home success surface, not a category list or
detail review surface:

- `external/lobehub/src/routes/(main)/memory/_layout/index.tsx`: `Sidebar` +
  main `Outlet`.
- `external/lobehub/src/routes/(main)/memory/_layout/Sidebar/Header/Nav.tsx`:
  Search opens the command menu, and Home is active for `/memory`.
- `external/lobehub/src/routes/(main)/memory/(home)/index.tsx`: `NavHeader`
  with `ActionBar`, scroll container, `AsyncBoundary`, `RoleTagCloud`,
  `PersonaHeader` and `Persona`.
- `external/lobehub/src/routes/(main)/memory/features/ActionBar/index.tsx`:
  header actions compose Purge, MemoryAnalysis and WideScreenButton.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/index.tsx`:
  analysis shows action or status based on async task state.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/AnalysisTrigger.tsx`:
  analysis action opens a date-range modal before extraction.

## CP Gap

`EVID-011-CP-pre` promoted a clean scoped Memory Home artifact, but the compact
success state still carried a default recovery/empty explanation block. That
made the successful Home render look like it always contained onboarding or
analysis guidance, while LobeHub only renders `MemoryEmpty` when `AsyncBoundary`
is empty and renders analysis status only for pending/processing/error tasks.

## DH Revision

- Removed the default compact Memory recovery/empty block from the success Home
  state.
- Kept the default surface focused on Home navigation, RoleTagCloud, Persona
  header, summary and detail.
- Moved analysis into the header action rail as a click-triggered date-range
  dialog state, matching LobeHub's `AnalysisTrigger` direction.
- Preserved deep Memory review states for category lists, detail panel, edit
  modal, loading, not-found and analysis status inspection.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/memory-dh-compact-home-scoped.png`, captured from `http://localhost:3200/?surface=memory&state=compact-memory&check=dh` after selecting `Agent LobeHub Parity`, clipped to `.pt-memory-layout.is-compact-memory`, opened and inspected. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-memory-dh-dom.json`: compact Memory shell, Search/Home/category nav, RoleTagCloud and Persona are present; default empty/recovery block, category list, filter bar, detail panel, analysis status, analysis date modal and edit modal are absent; click test opens the analysis date modal; `forbiddenHits=[]`; metadata `tmp/agent-lobehub-memory-dh-scoped-screenshot-meta.json`. |

## Claim Boundary

`EVID-011-DH-pre` promotes Memory from CP history to the active compact artifact
gate for the quieter `/memory` Home success state. It does not confirm Memory,
does not authorize `EVID-012`, and does not allow Desktop / Station / Model
product migration.
