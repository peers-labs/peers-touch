# Modern Chat Agent — Experience Contract

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-07-30 | **Updated**: 2026-10-01
> **Owner**: Peers-Touch Agent Team

---

## 1. Experience Principles

1. The center conversation rail is the dominant reading and action surface.
2. Agent, topic, runtime, and trust state are visible where they affect the
   user's next action, not as permanent debug chrome.
3. A submitted turn remains observable after page switching, disconnect, or
   restart.
4. Tool and memory authority is explicit; pending state never looks committed.
5. Unsupported capability is disclosed before the user commits work.
6. Failure preserves user input and confirmed conversation history.

The visual language follows Agent UI Identity and Quiet Protocol Minimalism.

## 2. Surface Anatomy

```text
Agent Module
├─ Home Command Center
│  ├─ Agent/model readiness and capability strip
│  ├─ Chat/Task composer
│  ├─ Pinned Agents and Station recents
│  └─ Brief/Needs You and running tasks
├─ Agent Rail
├─ Topic Rail
├─ Conversation Rail
│  ├─ Context Header
│  ├─ Message / Activity Timeline
│  ├─ Recovery Layer
│  └─ Composer
├─ Contextual Inspector
│  ├─ Agent Profile
│  ├─ Tool / Source Detail
│  └─ Usage / Diagnostics
└─ Evaluation Lab
   ├─ Benchmark / Dataset / Test Cases
   ├─ Run Status And Controls
   └─ Case Results / Metrics / Recovery
```

- Agent and topic rails may collapse but cannot cover the conversation rail.
- The inspector is contextual and optional; it is not a permanent dashboard.
- Narrow containers preserve one dominant conversation rail.

## 3. End-To-End Journeys

### MCA-J01: Reach The First Useful Answer

**Capabilities**: P01, P02, P03, P09

1. User opens Agent and sees available Agents or a clear create path.
2. User selects an Agent; readiness identifies model/runtime status.
3. Missing configuration provides one contextual recovery action.
4. User enters a new-topic draft and sends a prompt.
5. The draft becomes durable only after Station accepts the turn.
6. User sees progressive output and an unambiguous terminal state.
7. Reopening after restart shows the same accepted topic and answer.

Failure preserves the draft and identifies configuration, network, provider, or
capability ownership.

### MCA-J02: Create Or Refine An Agent

**Capabilities**: P01, P04, P05

1. User creates from a minimal role or describes the role to Agent Builder.
2. Product shows identity, model/runtime, skills, knowledge, memory, and tools
   as separate configuration areas.
3. Readiness updates as configuration changes.
4. Save conflict never silently overwrites another device.
5. User starts a new topic with the saved configuration.

Existing topics retain the runtime/config snapshot they actually used.

### MCA-J03: Continue And Organize Work

**Capabilities**: P02, P03, P07

1. User searches or selects a topic.
2. Recent messages load first without replacing the reading anchor.
3. User sends follow-ups; active-turn submissions enter a visible queue.
4. User may edit, remove, or promote a queued item.
5. Rename, favorite/archive, and search remain available without changing
   message truth.

Topic switch and page switch do not cancel accepted turns.

### MCA-J04: Use Context Intelligently

**Capabilities**: P04, P10

1. User asks a question that requires prior context.
2. Agent uses relevant history, approved memory, skills, or knowledge.
3. Answer exposes concise source/skill/memory attribution.
4. User can inspect why an item was included or omitted.
5. User can correct or remove memory without editing chat history.

No attribution is shown when the resource did not affect the turn.

### MCA-J05: Approve And Inspect Tool Work

**Capabilities**: P05, P09, P10

1. Timeline shows the proposed tool and purpose.
2. Sensitive calls pause with target, scope, arguments summary, risk, and
   consequence.
3. User approves or denies once.
4. Progress, result, failure, and attachments stay bound to the same call.
5. Agent continues only with the authoritative decision/result.

Timeout or disconnect remains visible and retryable; it never becomes success.

### MCA-J06: Work With Files And Images

**Capabilities**: P06, P09

1. User attaches or drops a resource into the composer.
2. Composer shows validating/uploading/ready/rejected per attachment.
3. Model/runtime compatibility is checked before send.
4. Accepted attachments stay linked to the resulting turn.
5. Failure preserves text and unaffected attachments.

Unsupported local device capabilities are absent or explicitly unavailable.

### MCA-J07: Cancel, Disconnect, And Recover

**Capabilities**: P03, P07, P10

1. User cancels an active turn or the client disconnects unexpectedly.
2. Product distinguishes cancellation from connection loss.
3. Reconnect replays events and reconciles from durable state.
4. Partial output is labeled partial when retained.
5. Retry starts from an explicit failed/cancelled/interrupted source.

The product never asks the user to resend when Station already accepted the
intent.

### MCA-J08: Revise Without Losing Evidence

**Capabilities**: P08, P10

1. User edits and resends a user message, retries a failed attempt, or
   regenerates an answer.
2. Product explains whether this creates an attempt or a new branch.
3. Original content remains accessible.
4. Active branch is visible and switchable.
5. Feedback and usage remain attached to the response they describe.

### MCA-J09: Understand Capability And Cost

**Capabilities**: P09, P10

1. Before send, the product resolves requested modalities, tools, runtime, and
   limits.
2. Any degradation or rejection names the affected capability and recovery.
3. During and after execution, usage and context pressure are visible on
   demand.
4. Diagnostic export reconstructs the turn without exposing secrets.

### MCA-J10: Use An Advertised External Agent

**Capabilities**: P12

1. User selects an available external Agent runtime before the first turn.
2. Product shows execution device/workspace and resume constraints.
3. The first accepted Turn creates one topic-owned runtime home and external
   session; another topic receives a different home and session.
4. Structured file, command, todo, skill, subagent, and ask-user activity
   appears in the timeline when emitted by the selected adapter.
5. Follow-up and post-Station-restart work resume the same external session
   and epoch.
6. Resume failure is terminal for that Turn and shows `Confirm reset`; it does
   not silently start a new session.
7. Reset or workspace change requires explicit destructive confirmation.
8. Confirmed reset cleans the old session/home, increments the epoch, and lets
   the next Turn create a fresh session. Failed cleanup remains visible and
   blocks new execution until retry succeeds.
9. Cancellation terminates the active process without resetting the durable
   external session.

If these semantics are not implemented, the runtime must not be advertised.

### V2-J01: Resume Or Start Work From Home

**Capabilities**: MCA-V2-H01, MCA-V2-T03

1. User opens Home and sees Station-backed pinned/favorite Agents, recents,
   readiness, connector/tool status, and actionable Brief/Needs You items.
2. User selects an Agent and model; incompatible capability state is visible
   before input is committed.
3. In Chat mode, send creates or restores a Station topic and moves into the
   conversation with accepted intent preserved.
4. In Task mode, submit creates and starts a Station Agent Task, then opens its
   task/topic handoff.
5. Loading, empty, stale, disconnected, and failed projections expose retry
   without rendering mock cards as success.
6. Restart restores recents, active tasks, and accepted work from Station.

Home excludes promotion, commercial recommendation, Community, image/video,
and decorative product-persona surfaces.

### V2-J02: Configure Agent Capabilities

**Capabilities**: MCA-V2-T01, MCA-V2-T02, MCA-V2-T03

1. User inspects one Tool/MCP/Connector inventory with source, version,
   readiness, compatibility, risk, and binding state.
2. Binding or policy changes are saved through Station and confirmed by
   readback.
3. Incompatible or disconnected capabilities cannot be silently saved as
   ready.
4. The selected model/runtime compatibility snapshot is visible before send.

### V2-J03: Complete A Governed Tool Turn

**Capabilities**: MCA-V2-T04, MCA-V2-O01

1. A real turn proposes a tool with target, authority, argument summary, and
   risk.
2. Policy resolves auto/manual/deny before execution.
3. Manual approval produces one durable decision and one execution.
4. Running, result, denial, expiry, timeout, cancellation, disconnect, and
   replay remain attached to one call lineage.
5. The model continues only after the authoritative result.

### V2-J04: Install And Invoke MCP

**Capabilities**: MCA-V2-M01, MCA-V2-O01

1. User inspects the MCP manifest and configuration requirements.
2. Install, test, connect, cancellation, typed failure, and retry are visible.
3. Secret values remain in the owning runtime.
4. After Agent binding readback, a real turn invokes one MCP tool.
5. Disconnect/restart reconciles process and connection state without a false
   success.

### V2-J05: OAuth Connector To Tool Invocation

**Capabilities**: MCA-V2-C01, MCA-V2-O01

1. User completes OAuth and sees authoritative connection/scope state.
2. Connector resources become versioned tool manifests.
3. Binding/policy is confirmed through Station readback.
4. A real turn invokes the Connector tool and persists one result.
5. Expiry, permission denial, disconnect, and reconnect expose typed recovery.

### V2-J06: Evaluate An Agent

**Capabilities**: MCA-V2-E01

1. User creates or selects a benchmark, dataset, and test cases.
2. User chooses a target Agent and starts a real evaluation run.
3. Run and case states expose draft, pending, running, cancelling, cancelled,
   completed, partial, failed, retrying, and restoring outcomes.
4. User can cancel the run and retry a failed case without duplicating
   completed work.
5. Results and metrics identify the exact Agent/runtime/config snapshot.
6. Desktop restart restores run status, results, and recovery actions from
   Station.

## 4. Platform Adaptation

| Capability | Desktop | Browser gateway | Future Mobile |
|---|---|---|---|
| Core Agent/topics/chat | full | full Station-backed outcome | full Station-backed outcome |
| Stream/replay/recovery | App bridge | HTTP/SSE gateway | lifecycle-aware foreground stream plus reconcile |
| File selection | filesystem picker/drag | browser picker/drag | native document/photo picker |
| Clipboard | local capability | browser permission when available | native plugin permission |
| Shell and stdio MCP | optional local capability | unavailable unless remote executor selected | unavailable |
| Tool approval | inline card | inline card | touch-first inline card/sheet |
| External local Agent | only when compatible execution device is selected | observe/control remote execution | observe/control remote execution |
| Home Command Center | full Chat/Task/Brief/capability experience | same Station outcomes; no unavailable local device actions | contract semantics only; UI delivery deferred |
| Unified capability plane | full, including local capability session | Station/remote capabilities; local-only entries unavailable | contract semantics; platform registry may differ |
| Evaluation Lab | full product surface | same Station benchmark/run outcomes | contract semantics only; UI delivery deferred |

Platform differences may change interaction mechanism, not durable conversation
or acceptance semantics.

## 5. Experience Non-Claims

- Prototype visuals do not prove Station persistence or runtime safety.
- A visible reasoning block does not prove access to private model reasoning.
- A model appearing in a selector does not prove capability readiness.
- A completed assistant bubble does not prove tool, persistence, or evidence
  completion unless the terminal state confirms them.
