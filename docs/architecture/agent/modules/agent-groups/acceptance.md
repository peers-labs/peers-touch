# P3-M1 Agent Groups — Acceptance

> **Module**: Agent Groups | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All UI strings via i18n | ✅ |
| D4 | Locale keys (`agent.groups.*`) in en + zh-CN | ✅ |
| D5 | Store uses `createDesktopStore` | ✅ |
| D6 | Page descriptor + registry | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Create group | Modal form → group appears in list | ✅ |
| F2 | Edit group (name, description, mode) | Updates persist | ✅ |
| F3 | Delete group with confirmation | Removed from list | ✅ |
| F4 | Add member agent | Agent appears in group member list | ✅ |
| F5 | Remove member | Agent removed | ✅ |
| F6 | Orchestration mode selection | Sequential / Parallel / Router | ✅ |
| F7 | Persistence across refresh | localStorage | ✅ |
| F8 | Empty state | "No groups" placeholder | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Member picker uses agents from `useAgentStore` | ✅ |
| I2 | localStorage key isolated (`peers-agent-groups`) | ✅ |
| I3 | Ready for Station backend (swap localStorage for API calls) | ✅ |

## Files

- `src/store/agentGroups.ts`
- `src/pages/AgentGroupsPage.tsx`, descriptor, container
- Locale: 16 keys
