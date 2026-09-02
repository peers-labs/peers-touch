# Modern Chat Agent — Product Acceptance Matrix

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-08-17
> **Owner**: Peers-Touch Agent Team

---

## 1. Acceptance Rule

Product acceptance is receiver-perspective:

```text
benchmark evidence
  -> product capability
  -> journey and visible state
  -> architecture closure
  -> prototype surface
  -> user assertion
  -> runtime and durable evidence
```

A screenshot proves appearance only. A product row passes only when visible
behavior, Station readback, runtime evidence, and failure/recovery assertions
required by that row all pass.

## 2. Traceability Matrix

| Product capability | Benchmark | Journey/state | Architecture mapping | Prototype surface | Receiver assertion | Required production evidence |
|---|---|---|---|---|---|---|
| MCA-P01 Agent setup/readiness | B01-B03, B16 | J01-J02; readiness FSM | MCA-C01/C03/C06; D01/D05/D12 | Profile, Home, Chat draft | I can tell whether this Agent is ready and fix the blocker before sending | Config readback, capability snapshot, Surface Gate |
| MCA-P02 Persistent topics/messages | B03, B05 | J01/J03; topic FSM | MCA-C02; D01/D06/D08 | Chat/topic rail | My accepted topic and messages return unchanged after restart | Station readback before/after restart plus UI comparison |
| MCA-P03 Progressive conversation | B04 | J01/J07; turn FSM | MCA-C03/C05; D02/D06/D07 | Chat timeline | I see genuine progress, can cancel, and get one accurate terminal state | Raw event timestamps, provider cancellation, terminal turn |
| MCA-P04 Context intelligence | B09-B10 | J04 | MCA-C04; D04 | Chat source detail, Memory, Skills | The answer uses relevant approved context and shows what affected it | ContextLedger, source IDs, fixed quality case |
| MCA-P05 Governed tools | B10-B11, B15 | J05; tool FSM | MCA-C07; D05/D09/D10/D13 | Tool card/inspector | I understand the action, approve or deny once, and see its result | Policy decision, single execution ID, durable tool trace |
| MCA-P06 Attachments/references | B12 | J06; resource FSM | MCA-C08; D04/D05/D13 | Composer/resource chips | Valid files survive submission; invalid files explain recovery before execution | Object/resource readback, capability gate, attachment trace |
| MCA-P07 Queue/recovery | B07-B08 | J03/J07; queue/recovery FSM | MCA-C02/C05; D06/D07 | Queue panel, recovery layer | My accepted follow-up is not lost or executed out of order after refresh | Queue rows, replay cursor, final ordered messages |
| MCA-P08 Branch/revision | B06 | J08; branch FSM | MCA-C02; D08 | Message actions/branch selector | I can compare alternatives without losing the original answer | Message lineage readback, active branch, separate usage/feedback |
| MCA-P09 Capability transparency | B13-B16 | J01/J05/J06/J09 | MCA-C03/C06/C10; D02/D05/D13 | Runtime selector, trust/recovery notice | Unsupported tools, files, reasoning, or device work are disclosed before commitment | Capability snapshot and zero provider/tool execution on rejection |
| MCA-P10 Usage/feedback/diagnostics | B17-B18 | J04/J09 | MCA-C09; D10 | Usage/source/diagnostic inspector | I can rate and inspect the exact turn without exposing secrets | Feedback readback, usage facts, redacted replay export |
| MCA-P11 Client portability | B08, B16 | all required journeys; platform matrix | MCA-C10; D01/D05/D07/D13 | Desktop now; narrow/mobile contract states | Core outcomes remain coherent while unsupported local abilities are explicit | Desktop App/browser cells plus Mobile contract tests |
| MCA-P12 External Agent runtime | B14-B16 | J10 | MCA-C03/C05/C07; D02/D03/D05/D07/D09 | Runtime/device/workspace controls, activity blocks | An advertised runtime resumes safely and explains reset/device constraints | Two-topic isolation, resume/reset, process cleanup, structured activity |
| MCA-P13 Artifacts | B19-B20 | separate optional journey required | Attachment/artifact architecture extension | Existing parity prototype artifact surface | Advertised artifacts are durable, previewable, iterative, and exportable | Not yet defined; cannot be advertised |
| MCA-V2-H01 Home Command Center | B23 | V2-J01; Home FSM | MCA-C11; D14; A15 | V2 Home review surface | I can resume Chat/Task work with accurate readiness, recents, Brief/Needs You, task, and capability state | Native Chat/Task submit, Station topic/task/readback, restart, stale/error/retry |
| MCA-V2-T01 / MCA-V2-T02 / MCA-V2-T03 Capability inventory/binding/compatibility | B24, B10, B16 | V2-J02; capability readiness FSM | MCA-C12; D15; A16 | V2 Capability review surface | I can tell what the Agent can use and bind it only after authoritative compatibility/readiness | Manifest/binding readback and compatibility rejection |
| MCA-V2-T04 Governed Tool Loop | B11, B24 | V2-J03; tool intervention FSM | MCA-C12/C13; D15/D16; A19 | V2 Capability review surface | I can approve or deny once and see exactly one authoritative result | Policy decision, one execution/result lineage, replay dedupe |
| MCA-V2-M01 MCP lifecycle | B24, B11 | V2-J04 | MCA-C13; D16; A17 | V2 Capability review surface | I can install, test, invoke, cancel, reconnect, and understand MCP failure without leaked process or secret | Disposable MCP Native journey, Station trace, process/port cleanup, redaction |
| MCA-V2-C01 Connector lifecycle | B24, B11 | V2-J05 | MCA-C14; D17; A18 | V2 Capability review surface | I can connect OAuth resources, bind tools, invoke them, and recover from expiry | Approved OAuth fixture, tool manifest, invocation result, expiry/disconnect readback |
| MCA-V2-O01 Tool observability/recovery | B11, B17-B18, B24 | V2-J03/J04/J05 | MCA-C12/C13/C14; D15-D17; A17-A19 | V2 Capability review surface | Failure, timeout, denial, cancellation, disconnect, replay, and diagnostics identify the next action | Typed terminal state, retryability, replay/reconcile, redacted source-bound diagnostics |
| MCA-V2-E01 Evaluation Lab | B25 | V2-J06; Evaluation FSM | MCA-C15; D18; A20 | V2 Evaluation review surface | I can run durable cases against an Agent, cancel/retry, inspect results, and recover after restart | Native dataset/run/cancel/retry/result, Station readback, restart, actor isolation |

### 2.1 V2 Required Production Gate Contracts

| Gate ID | Capabilities | Journey | Current status |
|---|---|---|---|
| `agent-v2-home-command-center-e2e` | MCA-V2-H01/T03 | V2-J01 | `UNPROVEN` |
| `agent-v2-capability-binding-e2e` | MCA-V2-T01 / MCA-V2-T02 / MCA-V2-T03 | V2-J02 | `UNPROVEN` |
| `agent-v2-governed-tool-loop-e2e` | MCA-V2-T04/O01 | V2-J03 | `UNPROVEN` |
| `agent-v2-mcp-lifecycle-e2e` | MCA-V2-M01/O01 | V2-J04 | `UNPROVEN` |
| `agent-v2-connector-invocation-e2e` | MCA-V2-C01/O01 | V2-J05 | `UNPROVEN` |
| `agent-v2-evaluation-lab-e2e` | MCA-V2-E01 | V2-J06 | `UNPROVEN` |

These are required production Gate contracts, not current registry entries.
Prototype evidence cannot change them to `PROVEN`.

## 3. Feasibility Closures

| Capability | Tangible user/system actions | Existing foundation | Missing closure | Executable proof |
|---|---|---|---|---|
| MCA-P01 | Open Agent Profile, select Direct Model, save, return to Chat, resolve readiness notice | Agent Profile/provider stores; Station provider and credential services | One versioned Station Agent config/readiness projection | Save through UI, read back Station config, restart Desktop, verify same ready selection |
| MCA-P02 | Click New Topic, send first message, rename/archive, restart, reopen | Station turn/message persistence; Desktop topic runtime and stores | Complete Station conversation CRUD; delete Desktop `ChatStore` truth | Create two topics, restart Station/Desktop, verify titles/messages/active branches by API and UI |
| MCA-P03 | Send a delayed-response prompt, watch chunks, press Cancel | Station stream handler; Desktop Rust SSE/cancel bridge; Web reducer | Sequenced semantic events, browser parity, terminal reconciliation | Record raw event timestamps proving progressive frames; cancel and verify upstream terminal cleanup |
| MCA-P04 | State a code word, open another topic, request recall, inspect source/skill detail | Prompt assembly, memory, skill, knowledge, compression services | Typed ContextLedger and user-safe attribution projection | Seed fixed memory/skill/knowledge cases, assert answer plus exact source IDs and omission behavior |
| MCA-P05 | Request a bounded local/Station tool, review approval card, deny once, repeat and approve | Station tool registry/local broker; Desktop local tool resolver | Portable owner resolution, durable approval/audit, loop budgets | Execute one safe tool through UI; prove one decision, one execution ID, one result, then denial/expiry cases |
| MCA-P06 | Attach a small PNG and PDF, remove one, send, reopen topic | Composer/upload and attachment metadata foundations | Durable opaque refs, extraction, authorization, runtime capability gate | Send supported files, verify model-visible result and Station refs; reject oversized/unsupported input before provider call |
| MCA-P07 | Send a long turn, queue two follow-ups, edit/promote one, refresh page | Desktop recovery service; Station turn lifecycle foundations | Durable bounded queue plus cursor replay/snapshot | Refresh during turn, verify queue order and exactly-once final messages; overflow returns visible recovery |
| MCA-P08 | Regenerate an answer, edit/resend the user message, switch branches | Existing Desktop retry/regenerate actions; Station messages/turns | Immutable lineage commands and branch-aware projection | Read back original and sibling branches, switch active branch, verify independent usage/feedback |
| MCA-P09 | Choose a non-vision model, attach image, observe blocked/degraded notice | Provider/model metadata and runtime selection foundations | Authoritative capability snapshot and pre-admission resolver | Assert visible rejection/degradation and prove zero provider/tool execution for the unsupported request |
| MCA-P10 | Open turn details, inspect usage/sources, submit thumbs-down, export diagnostics | TurnTrace, growth/review services, usage foundations | Unified immutable usage/feedback/export contract | Submit feedback, reload, verify readback; export and check turn reconstruction plus secret redaction |
| MCA-P11 | Run the core flow in App/browser; evaluate Mobile contract with no shell capability | Desktop and Mobile Tauri kernels; shared proto roots | Shared client capability/session contract and Mobile adapter | Contract tests prove same core commands/events; Mobile advertises no shell/stdio MCP and rejects them before send |
| MCA-P12 | Select advertised external runtime and workspace, send follow-up, restart, resume/reset | Station CLI foundation; conversation runtime design; Desktop activity blocks | Stateful runtime manager, topic-owned session/home, cleanup | Two topics use distinct runtime homes/session IDs; restart resumes each; explicit reset rotates epoch and cleans process |
| MCA-P13 | Generate substantial output, open preview, refine, export | Existing parity prototype artifact surface only | Accepted journey, durable owner/storage, sandbox/export contract | `UNPROVEN`: no production proof may be defined until product and architecture amendments are accepted |
| MCA-V2-H01 | Select Agent/model, submit Chat and Task, open Brief/Needs You, restart Home | Existing Home pinned/recent UI, Station topics/tasks, readiness and connector foundations | Runtime-owned Home projection, Chat/Task handoff, authoritative recents/Brief/capability recovery | Native Home scenario with Station topic/task readback before and after restart |
| MCA-V2-T01 / MCA-V2-T02 / MCA-V2-T03 | Inspect inventory, bind capability, and reject incompatible model/runtime | Tool registry, Agent config, connector/MCP stores | One manifest/binding/policy source and compatibility snapshot | Bind/read back and reject incompatible model before execution |
| MCA-V2-T04 | Trigger governed tool turn and approve/deny once | ToolCall events, approval bridge, TurnTrace | Exactly-once decision/execution/result lineage | Prove one approval, one execution/result, denial, expiry, timeout, cancellation, and dedupe |
| MCA-V2-M01 | Install/config/test/invoke/cancel/reconnect disposable MCP | Desktop Rust MCP bridge and MCP management UI | Bounded operation lifecycle, secret boundary, restart/process cleanup | Native disposable MCP run with process/port/secret leak canary |
| MCA-V2-C01 | OAuth connect, sync resource tools, bind, invoke, expire/reconnect | Existing OAuth and C7 lifecycle proof | Resource-to-manifest-to-turn invocation and typed expiry recovery | Approved fixture Native invocation plus Station binding/TurnTrace readback |
| MCA-V2-O01 | Force deny, timeout, cancellation, disconnect, replay, and diagnostic export | TurnTrace, ToolCallCard, recovery foundations | Typed retryability and source-bound redacted diagnostics | Native failure matrix plus Station terminal/readback and replay equality |
| MCA-V2-E01 | Create benchmark/dataset/cases, run Agent, cancel, retry failed case, restart | Evaluation UI/store and Station dataset proto/API | Station benchmark/test-case/run/result lifecycle and real Agent runtime | Native dataset→run→result, cancel/retry, restart readback, actor isolation |

Feasibility status:

- P01-P11 have repository foundations and concrete end-to-end proof paths.
- P12 is feasible only as an optional advertised capability after its stateful
  runtime contract is accepted and implemented.
- P13 remains `UNPROVEN`; it is not part of the core readiness claim.

## 4. Required Scenario Cells

| Cell | Required scope |
|---|---|
| Desktop App + Direct Model | All P01-P11 and all required MCA-V2 rows |
| Browser gateway + Direct Model | P01-P10 and required MCA-V2 Station-backed outcomes except unavailable device-local operations |
| Desktop App + external Agent | P12 only when advertised |
| Future Mobile contract | P01-P11 and MCA-V2 semantic contract compatibility; no Mobile UI delivery claim |
| Two actors | P01-P10 isolation and no credential/resource leakage |
| Two devices | Config conflict, capability target selection, replay, and resource isolation |

## 5. Failure And Recovery Cases

Every required runtime cell covers:

- Missing credential or unavailable model.
- Unsupported vision/tool/reasoning/local capability.
- Queue capacity rejection.
- Provider timeout/rate limit and retry exhaustion.
- Tool approval denial/expiry and local executor disconnect.
- Attachment validation/upload failure.
- Cancel during text, tool, and approval waits.
- Client disconnect, page switch, client restart, and Station restart.
- Duplicate command/event delivery.
- Stale Agent config and branch mutation.
- Home recents/readiness/Brief/task projection stale or partially unavailable.
- MCP process disconnect, Connector token expiry, and capability incompatibility.
- Evaluation cancel race, duplicate case retry, partial result, client restart,
  and actor/device isolation.

## 6. Prototype Gate

The current executable reference is:

- `packages/prototypes/desktop/features/modern-chat-agent/`
- `docs/architecture/agent/modern-chat-agent/prototype/README.md`

Current status: `confirmed`.

For this product contract, Owner review must explicitly decide at least:

- Agent setup and first-use readiness.
- New-topic draft and first-send transition.
- Active streaming/queue/recovery states.
- Tool approval and ask-user states.
- Attachment validation and degraded capability states.
- Branch/retry/regenerate interaction.
- Memory/skill/source and usage/diagnostic inspection.
- Narrow-container behavior.
- Home default/loading/empty/error/stale, Chat submit, Task submit, and
  Brief/Needs You behavior.
- Unified Tool/MCP/Connector inventory, compatibility, binding, approval,
  terminal result, and recovery.
- Evaluation draft/running/cancelling/completed/partial/failed/restart states.

Prototype confirmation proves intended interaction only; production Gate
contracts remain `UNPROVEN`.

## 7. Product Gate Status

Current judgment: `PRODUCT_READY_FOR_ARCHITECTURE`.

Evidence:

1. Owner confirmed the Home/Tool/Evaluation prototype on 2026-08-17.
2. Third-round independent PRODUCT review returned `passed` on 2026-08-17.
3. Capability→brain-map→journey→architecture closure/decision/scenario→Gate
   trace is complete; every V2 production Gate remains honestly `UNPROVEN`.
4. MCA-P13 remains optional and `UNPROVEN`; it is outside the required V2
   claim and does not block architecture reconciliation.
