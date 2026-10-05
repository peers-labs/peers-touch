# P1-M3: Knowledge Base & RAG — Acceptance (S2/S4)

> **Module**: P1-M3 Knowledge Base & RAG
> **Status**: defined (execute in S4)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | Rust compiles | `cd apps/desktop && cargo check --manifest-path src-tauri/Cargo.toml` |
| D3 | Station compiles | `cd apps/station && go build ./...` |
| D4 | Station tests pass | `cd apps/station && go test ./app/subserver/agent/...` |
| D5 | No `any` types in new files | `grep -r ': any' apps/desktop/src/components/agent/Knowledge*.tsx` → 0 hits |
| D6 | No hardcoded strings | All user-facing text uses `t()` from i18n |
| D7 | No console.log | `grep -r 'console.log' apps/desktop/src/components/agent/` → 0 hits |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | Upload file as knowledge | AgentProfile → Knowledge tab → Upload → select .md file → confirm | File uploaded, resource appears in list with type=document, status=active |
| F2 | Add URL knowledge | Knowledge tab → URL input → paste URL → add | Resource created with type=url, appears in list |
| F3 | Remove knowledge resource | Knowledge tab → resource item → delete button | Resource removed from list and agent config |
| F4 | RAG retrieval uses uploaded file | Send message to agent with query matching uploaded file content | Assistant response includes knowledge chunk reference indicator |
| F5 | Embedding provider fallback | No embedding API configured → send message | Retrieval still works (hash-based), no error |
| F6 | OSS key resolution | Upload file → verify Station can read it during RAG | loadResourceContent returns file content from OSS storage |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | Upload reuses OSS pipeline | No new upload infrastructure — uses existing attachment upload |
| I2 | Knowledge tab coexists with existing tabs | Agent profile page renders all tabs correctly |
| I3 | Turn request unchanged | Existing turn flow still passes knowledge_resources without breaking |
