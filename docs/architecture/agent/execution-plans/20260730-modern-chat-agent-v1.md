# Modern Chat Agent — Execution Plan (MODERN_CHAT_AGENT_V1)

&gt; **Status**: ready-for-review
&gt; **Version**: v1.0
&gt; **Created**: 2026-07-30 | **Updated**: 2026-07-30
&gt; **Owner**: Peers-Touch Agent Team
&gt; **Capability Profile**: MODERN_CHAT_AGENT_V1
&gt; **Governing design**: [../modern-chat-agent/](../modern-chat-agent/)
&gt; **Plan gate**: awaiting-owner-approval (PL3)

---

## 1. Objective

Deliver a production-grade Modern Chat Agent by completing one end-to-end
vertical loop first, then expanding to the full MCA-P01–P11 capability set.

**The First Vertical Loop** (minimum shippable proof):

```text
Start Station + Desktop
  -&gt; open Agent surface
  -&gt; select Agent with one ready Direct Model
  -&gt; create Station-owned topic
  -&gt; send "Reply with TEST_OK"
  -&gt; observe progressive streamed text
  -&gt; observe terminal completion
  -&gt; close and restart Desktop
  -&gt; reopen the same topic from Station
  -&gt; read "TEST_OK" persisted and restored
```

This loop proves MCA-C01 (config truth), MCA-C02 (conversation/message truth),
MCA-C03 (runtime execution with Direct Model), and MCA-C05 (stream + recovery).

**After the loop passes**, expand to the remaining capabilities in dependency
order.

## 2. Preconditions (All PASSED)

| Gate | Status | Evidence |
|------|--------|----------|
| P1 Product Decisions | ✅ PASSED | [product-definition.md §8](../modern-chat-agent/product-definition.md) |
| P2 L2 Visual Prototype | ✅ PASSED | [prototype/evidence-l2/](../modern-chat-agent/prototype/evidence-l2/) (10 screenshots) |
| P3 Prototype Confirmed | ✅ PASSED | [prototype/README.md](../modern-chat-agent/prototype/README.md) status `confirmed` |
| P4 PRODUCT Review | ✅ PASSED | Owner approval 2026-07-30 |
| D1 Architecture Decisions | ✅ PASSED | [decisions.md](../modern-chat-agent/decisions.md) MCA-D01–D13 approved |
| D2 Design Quality Gate | ✅ PASSED | All MCA-C01–C10 closure cells mapped in [integration.md §13](../modern-chat-agent/integration.md) |
| D3 DESIGN Review | ✅ PASSED | Owner approval 2026-07-30 |

## 3. Capability Profile: MODERN_CHAT_AGENT_V1

Required capabilities (ship in v1):

| ID | Capability | Classification |
|----|-----------|----------------|
| MCA-P01 | Agent setup and readiness | required |
| MCA-P02 | Persistent topics and messages | required |
| MCA-P03 | Progressive model conversation | required |
| MCA-P04 | Context intelligence (memory/skill/knowledge attribution) | required |
| MCA-P05 | Governed tools and intervention | required |
| MCA-P06 | Attachments and references | required |
| MCA-P07 | Queue and recovery | required |
| MCA-P08 | Branching and revision | required |
| MCA-P09 | Runtime capability transparency | required |
| MCA-P10 | Usage, feedback, and diagnostics | required |
| MCA-P11 | Client portability (Desktop now, Mobile contract-compatible) | required |

Optional-advertised (not in v1 core, but contract designed):

| ID | Capability | Classification |
|----|-----------|----------------|
| MCA-P12 | Stateful external Agent runtime | optional-advertised (post-v1) |
| MCA-P13 | Generated artifacts | optional-advertised (post-v1) |

Deferred (not in this plan):

| ID | Capability | Reason |
|----|-----------|--------|
| MCA-P14 | Voice, marketplace, sharing | Out of scope for v1 |
| MCA-P15 | Multi-Agent collaboration | Per MCA-D11, deferred until single-Agent readiness proven |

## 4. Workstreams and Dependency Order

Work executes in strict phases. Each phase must pass its gate before the next
begins.

```text
Phase 0: Proto and contract alignment (foundation)
  |
  +--&gt; Phase 1: First Vertical Loop (MCA-C01 + C02 + C03 + C05 core)
  |     |
  |     +--&gt; Phase 2: Capability expansion (MCA-C04, C06, C07, C08, C09, C10)
  |     |     |
  |     |     +--&gt; Phase 3: Failure and recovery scenarios
  |     |     |     |
  |     |     |     +--&gt; Phase 4: Quality gate + DELIVERY
```

### Phase 0: Proto and Contract Alignment

**Goal**: Establish canonical proto contracts for Agent conversation, message,
and turn event projection before writing implementation.

**Closure cells**: MCA-C01, MCA-C02, MCA-C05

**Tasks**:

| Task | Closure | Description | Deletion | Verification |
|------|---------|-------------|----------|--------------|
| T0.1 | C01 | Review existing `model/domain/agent/*.proto` for AgentDefinition, Conversation, AgentMessage, TurnEvent completeness | — | `./model/build.sh` passes |
| T0.2 | C02 | Add/verify proto for Conversation CRUD, message lineage (replaces_message_id, branch_id), queued admission | Desktop ad-hoc message shapes | Proto compilation passes; generated Go/TS present |
| T0.3 | C05 | Add/verify TurnEvent sequence, cursor, replay snapshot proto | Ephemeral-only event assumptions | Proto compilation passes |
| T0.4 | C01/C10 | Add ClientCapabilitySession opaque ref + platform capability proto | `workspace_root` and `executionOwner: desktop-rust` fields | Proto compilation passes |

**Gate**: `./model/build.sh` passes, no breaking changes to existing deployed
protos without migration plan.

---

### Phase 1: First Vertical Loop (E2E Proof)

**Goal**: The minimum path that proves Station-owned agent chat works end-to-end.

**Closure cells**: MCA-C01 (config readback), MCA-C02 (conversation/message CRUD
+ persistence), MCA-C03 (Direct Model execution), MCA-C05 (sequenced SSE stream
+ reconnect).

**Workstreams**:

#### W1.1 Station Conversation and Message API (C02)

| Task | Closure | Description | Deletion | Verification |
|------|---------|-------------|----------|--------------|
| T1.1.1 | C02 | Implement Station Conversation service: create, list, get, rename, archive, get active branch | Desktop `ChatStore` | Station unit tests: create/list/get/rename/archive |
| T1.1.2 | C02 | Implement Station Message persistence per turn: user/assistant/tool/system, sequence, lineage | Desktop in-memory message state | Station test: persist 5 messages, read back in order |
| T1.1.3 | C02 | Add Station HTTP/SSE handlers for conversation CRUD and message stream | Missing API routes | Station handler tests; manual API test with curl |
| T1.1.4 | C01 | AgentDefinition readback API with versioning and runtime readiness snapshot | Desktop duplicate config load | API returns versioned config + capability snapshot |

#### W1.2 Station Direct Model Execution Stream (C03, C05)

| Task | Closure | Description | Deletion | Verification |
|------|---------|-------------|----------|--------------|
| T1.2.1 | C03 | Verify Direct Model path in TurnService: actor credentials → provider → stream → persist; no Desktop CLI path in this loop | — | Station integration test with test provider (or real provider) |
| T1.2.2 | C05 | Assign monotonic TurnEvent sequence numbers; persist events before broadcast | Ephemeral non-sequenced events | Test: 10 events, all persisted and replayed in order |
| T1.2.3 | C05 | Add replay cursor endpoint: resume from last acknowledged sequence | No-reconnect resend-duplicates | Test: disconnect at event 5, reconnect, get events 6+ |
| T1.2.4 | C03 | Terminal state persistence: done/error/cancelled, with terminal reason | In-memory terminal flags | Test: cancel mid-stream, verify persisted terminal = cancelled |

#### W1.3 Desktop Rust Stream Bridge (C05, C10)

| Task | Closure | Description | Deletion | Verification |
|------|---------|-------------|----------|--------------|
| T1.3.1 | C05 | Rewire Tauri agent_turn to Station SSE (using existing bridge as base); remove any local CLI turn execution | `execute_cli_turn_blocking`, `stream_cli_turn` in Desktop Rust | `rg "execute_cli_turn_blocking\|stream_cli_turn" apps/desktop/src-tauri/src` returns zero results |
| T1.3.2 | C05 | Implement SSE cursor reconnect in Rust bridge on connection drop | Drop-and-recreate behavior | Test: kill network mid-stream, reconnect, verify continuation |
| T1.3.3 | C10 | Replace workspace_root/executionOwner with ClientCapabilitySession lease for local tools (stub for now; real tool in Phase 2) | `workspace_root: String` shared fields | Compile check; field removed from shared request structs |

#### W1.4 Desktop Web Projection (C02, C05)

| Task | Closure | Description | Deletion | Verification |
|------|---------|-------------|----------|--------------|
| T1.4.1 | C02 | Rewire agentTopicRuntime to Station Conversation API (create/list/read) | Desktop-local topic CRUD in chat.ts | Browser shows Station-owned topic list |
| T1.4.2 | C02 | Remove Desktop `ChatStore` durable ownership; chatRuntime becomes pure projection of Station TurnEvents | `struct ChatStore` in Desktop Rust; in-memory topic cache | `rg "struct ChatStore\|CHAT_STORES" apps/desktop/src-tauri/src/application/chat` returns zero results |
| T1.4.3 | C05 | Build chatRuntime reducer: consume sequenced TurnEvents, deduplicate by (turn_id, sequence), update cursor | Message concatenation on every event | Manual test: 20 progressive events, no duplicate renders |
| T1.4.4 | C05 | Browser gateway (desktop-web): proxy Station SSE, remove `executeAgentTurnOnce` fallback | `executeAgentTurnOnce` call sites for Agent chat | `rg "executeAgentTurnOnce" apps/desktop/src` shows no chat-UI callers |
| T1.4.5 | C02 | Render topic list, active topic, messages, composer, send button — connected to Station data | Hardcoded prototype UI paths | UI renders Station data, not local/demo data |

**Phase 1 Gate: First Vertical Loop E2E**

Run these steps **on a real Station + Desktop runtime** (not mock):

```bash
# Terminal 1: Station
make station

# Terminal 2: Desktop App
make desktop

# Terminal 3: Verification
# After completing the loop via UI, run:
# 1. Station DB query (or API call) proves message persisted
# 2. Restart Desktop, reopen topic, UI shows TEST_OK
# 3. Station event log shows sequenced events
```

**Required evidence**:
- E1: Screenshot showing "TEST_OK" response in active chat
- E2: Station DB/API readback proving message persistence after restart
- E3: Event log with monotonic sequence numbers
- E4: Desktop restart screenshot showing topic restored with same messages
- E5: `rg` commands proving deleted paths are gone (T1.3.1, T1.4.2, T1.4.4)

**Pass criteria**:
- Send → stream → persist → restart → restore all work with real (not mock) data
- No Desktop-local provider execution
- All deterministic checks pass:
  ```bash
  cd apps/station &amp;&amp; gofmt -l . &amp;&amp; go test ./app/subserver/agent/...
  cd apps/desktop &amp;&amp; pnpm run check &amp;&amp; pnpm run build
  ./model/build.sh
  ```

---

### Phase 2: Capability Expansion

After Phase 1 passes, implement remaining MCA-Cxx closures in dependency order.

#### W2.1 Context Intelligence (MCA-C04)

Depends on: Phase 1

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.1.1 | C04 | Implement typed ContextLedger: ordered segments (system, history, memory, skill, knowledge, attachment, tool), source refs, token estimates, truncation reasons | Unit tests verify deterministic ledger for same inputs |
| T2.1.2 | C04 | Persist ContextLedger with Turn (redacted); expose source attribution API | Test: turn lists memory_id, skill_id, knowledge_chunk_ids used |
| T2.1.3 | C04 | UI: render source attribution per message (memory/skill/knowledge badges) | UI shows source badges; clicking shows detail |

#### W2.2 Runtime Capabilities and Budget (MCA-C06)

Depends on: Phase 1

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.2.1 | C06 | RuntimeCapabilitySnapshot: fresh resolution per turn (vision, tools, reasoning, context_window, streaming) | Test: snapshot returns accurate capabilities for known models |
| T2.2.2 | C06 | Pre-admission rejection: if turn requires capability model lacks, return degraded/rejected before execution | Test: attach image to text-only model → rejection before provider call |
| T2.2.3 | C06/C09 | Runtime budgets: max attempts, max steps, max tools, wall time, token limit; typed exhaustion outcome | Test: budget exhaustion produces typed terminal = budget_exceeded |
| T2.2.4 | C09 | UI: degraded/blocked capability notice before send | Warning badge shows when model can't handle requested input |

#### W2.3 Tool Approval and Local Execution (MCA-C07)

Depends on: Phase 1, T1.3.3

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.3.1 | C07 | Tool approval flow: Station pauses turn, sends approval request to client, waits for approve/deny/timeout | Test: approve once → executes; deny → returns denied; timeout → returns expired |
| T2.3.2 | C07/C13 | ClientCapabilitySession full impl: lease creation, expiry, device selection, capability advertisement; Desktop registers local FS/read tools under lease | Test: two devices online, request routes to correct device; expiry kills lease |
| T2.3.3 | C07 | Tool result returns to Station turn, model continues; trace records request+decision+result+latency | Test: one tool call in a turn completes full loop; trace shows all stages |
| T2.3.4 | C07 | Tool loop detection: budget limits tool iterations per turn | Test: infinite-tool-loop prompt terminates at budget |

#### W2.4 Attachments (MCA-C08)

Depends on: Phase 1, T2.2.1

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.4.1 | C08 | Opaque AttachmentRef: client uploads to Station storage, receives opaque ref; never sends raw file data or local paths in turn request | Test: upload file, get ref, send turn with ref; no file paths in request |
| T2.4.2 | C08 | Attachment validation: type/size/capability check at admission; reject early for incompatible models | Test: oversized/unsupported attachment → rejection with reason |
| T2.4.3 | C08 | Persist attachment provenance with message/turn | Test: restart + reopen, attachment refs still present and accessible |
| T2.4.4 | C08 | UI: attachment chips, preview, remove, progress, error states | Composer shows upload progress, errors, removable chips |

#### W2.5 Queue, Retry, Regenerate, and Branch (MCA-C02 continued)

Depends on: Phase 1

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.5.1 | C02/C07 | Bounded FIFO queue: per-conversation capacity; TURN_QUEUE_FULL on overflow; queued items have admission status | Test: fill queue → overflow returns error; queue processes FIFO |
| T2.5.2 | C02 | Immutable lineage: retry stays under same turn; regenerate creates new turn with replaces_message_id; edit-resend creates user branch | Test: regenerate twice → 2 assistant branches; original preserved |
| T2.5.3 | C02 | Active branch selection API; branch-aware projection | Test: switch branches, UI shows correct responses per branch |
| T2.5.4 | C02 | UI: queue panel (edit/promote/remove), retry/regenerate actions, branch switcher | All UI actions work and match Station state |

#### W2.6 Feedback, Usage, and Diagnostics (MCA-C09)

Depends on: Phase 1

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.6.1 | C09 | Per-turn usage stats: token count (prompt/completion), model, wall time, tool count, attempt count | Usage returned from completed turn and persisted |
| T2.6.2 | C09 | Feedback API: thumbs up/down, optional comment; persisted per turn | Submit feedback, reload, verify readback |
| T2.6.3 | C09 | Diagnostic export: reconstructs turn with ContextLedger (redacted), events, tool trace; scrubs secrets/paths/local data | Export contains reconstruction data; no secrets/local paths present |
| T2.6.4 | C09 | UI: turn actions → copy/retry/regenerate/details; details panel shows sources, usage, feedback button | Details panel opens and shows all data |

#### W2.7 Client Portability — Mobile Contract (MCA-C10)

Depends on: T2.3.2 (ClientCapabilitySession)

| Task | Closure | Description | Verification |
|------|---------|-------------|--------------|
| T2.7.1 | C10 | Shared client kernel contract: proto-defined requests/events not using any Desktop-specific type names | Review: no `desktop`, `workspace_root`, `AppHandle` in shared proto/TS contracts |
| T2.7.2 | C10 | Mobile adapter stubs: shared request/result handling; capability advertisement for Mobile (no shell/stdio MCP) | Contract test: Mobile 
[truncated by convert_data_to_sft: original content length=13353 chars for checker-safe SFT export]
