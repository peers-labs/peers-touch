# P3-M3 Custom Plugins — Acceptance

> **Module**: Custom Plugins | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All UI strings via i18n | ✅ |
| D4 | Locale keys (`agent.plugins.*`) in en + zh-CN | ✅ |
| D5 | Store uses `createDesktopStore` | ✅ |
| D6 | No secrets in source (authValue in localStorage only) | ✅ |
| D7 | Page descriptor + registry | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Create plugin | Form modal → plugin card appears | ✅ |
| F2 | Edit plugin | Update all fields | ✅ |
| F3 | Delete plugin with confirmation | Removed | ✅ |
| F4 | Toggle enabled/disabled | Badge reflects state | ✅ |
| F5 | Test plugin | Sends HTTP request, shows response | ✅ |
| F6 | Auth types (none/bearer/api-key) | Correct header sent on test | ✅ |
| F7 | JSON Schema input | TextArea accepts valid JSON | ✅ |
| F8 | Persistence | localStorage across refresh | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Test uses `fetch()` to configured endpoint | ✅ |
| I2 | Auth credentials never logged or committed | ✅ |
| I3 | Ready to register as MCP tool source (future) | ✅ |

## Files

- `src/store/customPlugins.ts`
- `src/pages/CustomPluginsPage.tsx`, descriptor, container
- Locale: 25 keys
