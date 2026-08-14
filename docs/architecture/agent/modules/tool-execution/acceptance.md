# P1-M1: Tool Execution Runtime — Acceptance (S2/S4)

> **Module**: P1-M1 Tool Execution Runtime
> **Status**: complete (deterministic pass, functional pending GUI)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | Rust compiles | `cd apps/desktop && cargo check --manifest-path src-tauri/Cargo.toml` |
| D3 | Station compiles | `cd apps/station && go build ./app/subserver/agent/...` |
| D4 | Station tests pass | `cd apps/station && go test ./app/subserver/agent/...` |
| D5 | No `any` types in tool store | `grep -r ': any' apps/desktop/src/store/tool*.ts` → 0 hits |
| D6 | No hardcoded strings | All user-facing text uses `t()` from i18n |
| D7 | No console.log | `grep -r 'console.log' apps/desktop/src/store/tool*.ts apps/desktop/src/services/agent-service.ts` → 0 hits |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | Auto-approved tool execution | Agent has file_read (approval:auto) → user asks to read a file → LLM emits tool_call → client auto-executes → result submitted | No approval prompt; ToolCallCard shows name/args/loading/result; assistant uses file content |
| F2 | Tool requiring approval | Agent has shell (approval:ask) → user asks to run command → approval prompt shown | Approve/Deny buttons visible; Approve triggers execution; result in ToolCallCard |
| F3 | Tool denied by user | Same as F2 → user clicks Deny | Result submitted as error; LLM responds gracefully; ToolCallCard shows "Denied" |
| F4 | Approval timeout | Same as F2 → 110s pass without action | Auto-deny fires; ToolCallCard shows "Timed out"; stream continues |
| F5 | Unknown tool | LLM hallucinates tool not in registry | Error result submitted ("not available"); no crash |
| F6 | Sequential tool calls | LLM emits tool_call A → result → tool_call B → result → final response | Both ToolCallCards rendered; final response uses both results |
| F7 | Parallel tool calls | LLM emits multiple tool_calls in single response | All executed (auto) or all prompted (ask); results submitted together |
| F8 | Tool executor error | file_read on nonexistent path | Error result; ToolCallCard shows red status; LLM handles gracefully |
| F9 | Tool progress stream | Tool emits progress events during execution | ToolCallCard shows progress bar / text update |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | Tool registry isolated from chat store | `store/tool*.ts` does not import from `store/chat.ts` |
| I2 | Streaming FSM handles tool events | `tool_call` and `tool_result` stream events processed without breaking message flow |
| I3 | Approval service respects agent config | Per-tool policy (auto/ask/deny) from agent config drives behavior |
