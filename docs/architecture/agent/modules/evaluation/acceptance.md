# P3-M4 Evaluation System — Acceptance

> **Module**: Evaluation System | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All UI strings via i18n | ✅ |
| D4 | Locale keys (`agent.eval.*`) in en + zh-CN | ✅ |
| D5 | Store uses `createDesktopStore` | ✅ |
| D6 | Page descriptor + registry | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Create dataset | Name + description, appears in list | ✅ |
| F2 | Add/edit/remove dataset items | Table with input/expected/tags | ✅ |
| F3 | Delete dataset with confirmation | Removed | ✅ |
| F4 | Start eval run | Select dataset + agent → run executes | ✅ |
| F5 | Run progress | Items evaluated sequentially, status updates | ✅ |
| F6 | Results display | Per-item pass/fail, actual output, latency | ✅ |
| F7 | Metrics summary | Accuracy %, average latency | ✅ |
| F8 | Cancel run | Stops execution mid-run | ✅ |
| F9 | Datasets persist (localStorage) | Survive refresh | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Run uses `api.quickCompletion(agentId, input)` for each item | ✅ |
| I2 | Agent picker uses agents from `useAgentStore` | ✅ |
| I3 | Comparison: simple string equality (v1) | ✅ |
| I4 | Ready for Station-side evaluation service (future) | ✅ |

## Files

- `src/store/evaluation.ts`
- `src/pages/EvaluationPage.tsx`, descriptor, container
- Locale: 36 keys
