# Modern Chat Agent — Experience Contract

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
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
├─ Agent Rail
├─ Topic Rail
├─ Conversation Rail
│  ├─ Context Header
│  ├─ Message / Activity Timeline
│  ├─ Recovery Layer
│  └─ Composer
└─ Contextual Inspector
   ├─ Agent Profile
   ├─ Tool / Source Detail
   └─ Usage / Diagnostics
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
5. Retry starts from an explicit failed/cancelled source.

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
3. Structured file, command, todo, skill, subagent, and ask-user activity
   appears in the timeline where supported.
4. Follow-up resumes the same topic-owned runtime session.
5. Runtime reset or workspace change requires explicit confirmation.

If these semantics are not implemented, the runtime must not be advertised.

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

Platform differences may change interaction mechanism, not durable conversation
or acceptance semantics.

## 5. Experience Non-Claims

- Prototype visuals do not prove Station persistence or runtime safety.
- A visible reasoning block does not prove access to private model reasoning.
- A model appearing in a selector does not prove capability readiness.
- A completed assistant bubble does not prove tool, persistence, or evidence
  completion unless the terminal state confirms them.
