---
kind: invariant
title: Agent turn projections retain admission and operation ownership
status: active
owns:
  - apps/desktop/src/store/chat.ts
  - apps/desktop/src/store/chatTurnIdentity.ts
  - apps/desktop/src/components/ChatInput.tsx
  - apps/desktop/src/components/composer/SendControl.tsx
  - apps/station/app/subserver/agent/service/turn_service.go
  - apps/station/app/subserver/agent/service/tool_dispatch_service.go
referenced-by: []
related:
  - docs/architecture/domains/agent/modern-chat-agent/design.md
  - docs/architecture/domains/agent/execution-plans/20261025-agent-usability-depth/plan.md
detected: 2026-10-29
---

# Agent turn projection ownership

## What must hold

Admission binds the exact optimistic message before a turn-based snapshot match.
When a folded snapshot arrives first, the identified optimistic row is absorbed
into its authoritative row, including when that row already matches by ID.
One admitted turn must not leave an unbound loading assistant behind.

The composer keeps Send and Stop as separate actions while running. Readiness,
content and attachment state qualify Send; a running turn alone does not disable
it. Button and keyboard submissions share the Station-owned FIFO admission path.

Stop resolves a running operation from the conversation's operation entries,
including recovered entries under parallel keys. It cancels only that operation
and settles only its assistant. Sibling operations, queued requests and their
buffers retain their state.

New tool batches that project chat messages lock their admitted turn before
capability, batch, message and conversation writes. Terminal settlement uses
the same turn-first order. Pinned batch replay retains its existing replay
contract and does not repeat projection.

A no-text terminal assistant extends the admitted turn's persisted chain and
inherits its branch and model. The currently selected conversation head is not
its parent authority. Settlement advances the selected head only when that head
still equals the terminal message's parent. Selecting another sibling while the
turn runs must not detach the admitted user message or switch the user back.

## How to verify

- Desktop regression: `chat.admissionRecovery.test.ts` covers a snapshot before
  admission identity, an exact-ID snapshot with an additional correlated row,
  recovered Stop behind a completed primary, and preservation of siblings.
- Station regression: `turn_terminal_message_test.go` verifies admitted
  lineage, retained sibling selection, terminal idempotency and pre-admission
  absence.
- PostgreSQL regression: `TestPostgresCancellationSerializesToolProjection`
  uses the existing `NCP_AGENT_POSTGRES_DSN` fixture input and a private schema.
  Its barrier forces cancellation to hold the turn while tool projection
  reaches that turn. Cancellation must commit, the late projection must observe
  the terminal fence, and history must contain one terminal assistant.
- Native Journey: send again through the visible Send button while a turn runs,
  observe FIFO, cancel the running recovered turn, and reload history. Inspect
  receiver-visible rows and Station lineage. Source checks and a skipped
  PostgreSQL fixture do not prove this Journey.
