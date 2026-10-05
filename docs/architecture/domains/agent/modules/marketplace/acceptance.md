# P3-M2 Marketplace — Acceptance

> **Module**: Marketplace / Discovery | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All UI strings via i18n | ✅ |
| D4 | Locale keys in en + zh-CN (`agent.marketplace.*`) | ✅ |
| D5 | Page descriptor + container pattern | ✅ |
| D6 | Registered in registry + CORE_PAGES | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Three tabs: Agents / Skills / MCP | Tab navigation works | ✅ |
| F2 | Agents tab | Shows local agents as templates, clone action | ✅ |
| F3 | Skills tab | Lists skills from market API, install action | ✅ |
| F4 | MCP tab | Shows configured MCP servers | ✅ |
| F5 | Search filter | Filters cards by name/description | ✅ |
| F6 | Clone agent | Uses export+import flow | ✅ |
| F7 | Empty state per tab | Placeholder text when no items | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Uses existing `api.listAgents`, `api.listSkillMarkets`, `api.listMCPServers` | ✅ |
| I2 | Clone uses `api.exportAgentPackage` → `api.importAgentPackage` | ✅ |
| I3 | Install skill uses `api.installMarketSkill` | ✅ |

## Files

- `src/pages/MarketplacePage.tsx`, descriptor, container
- `src/pages/marketplace/{AgentCard,SkillCard,MCPCard,index}.tsx`
- Locale: 20 keys
