# Modern Chat Agent — Product Acceptance Matrix

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
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

Feasibility status:

- P01-P11 have repository foundations and concrete end-to-end proof paths.
- P12 is feasible only as an optional advertised capability after its stateful
  runtime contract is accepted and implemented.
- P13 remains `UNPROVEN`; it is not part of the core readiness claim.

## 4. Required Scenario Cells

| Cell | Required scope |
|---|---|
| Desktop App + Direct Model | All P01-P11 rows |
| Browser gateway + Direct Model | P01-P10 except unavailable device-local operations |
| Desktop App + external Agent | P12 only when advertised |
| Future Mobile contract | P01-P11 semantic compatibility; no Mobile UI delivery claim |
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

## 6. Prototype Gate

The current executable reference is:

- `packages/prototypes/desktop/features/modern-chat-agent/`
- `docs/architecture/agent/modern-chat-agent/prototype/README.md`

Current status: `pending-review`.

For this product contract, Owner review must explicitly decide at least:

- Agent setup and first-use readiness.
- New-topic draft and first-send transition.
- Active streaming/queue/recovery states.
- Tool approval and ask-user states.
- Attachment validation and degraded capability states.
- Branch/retry/regenerate interaction.
- Memory/skill/source and usage/diagnostic inspection.
- Narrow-container behavior.

The PRODUCT gate cannot pass while the relevant prototype surfaces remain
`pending-review` or `revision-required`.

## 7. Product Gate Status

Current judgment: `PRODUCT_DESIGN_INCOMPLETE`.

Blocking evidence:

1. Product decisions in `product-definition.md §8` are proposed, not approved.
2. The relevant executable prototype is not `confirmed`.
3. MCA-P13 lacks an accepted optional artifact journey and production evidence
   contract.
4. No independent PRODUCT review has passed.

Architecture and execution planning remain blocked from claiming an accepted
product contract. Existing architecture may continue as draft input and must be
reconciled after PRODUCT approval.
