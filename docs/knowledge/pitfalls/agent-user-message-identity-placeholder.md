---
kind: pitfall
title: Agent chat user tile must project the session actor, never a placeholder
status: active
owns:
  - apps/desktop/src/components/messages/UserMessage.tsx
  - apps/desktop/src/components/MessageBubble.tsx
  - apps/desktop/src/store/chat.ts
referenced-by:
  - docs/knowledge/invariants/desktop-identity-lifecycle-closure.md
related:
  - docs/client/desktop/identity-lifecycle.md
detected: 2026-10-28
---

# Agent chat user tile must project the session actor, never a placeholder

## Symptom

Agent workbench user messages showed a purple gradient tile with the letter
"U" and the label "You", which matched neither the logged-in actor's name
initial nor their uploaded avatar. It read as a second, unknown person in the
conversation.

## Root Cause

The agent-chat surface rendered user messages through its own identity-less
path:

- `MessageBubble` / its call sites never supplied any actor identity.
- `UserMessage` rendered `UserSquareAvatar` with `name={undefined}`, whose
  default parameter substituted `'User'` (initial "U") over a hardcoded
  gradient background.
- `ChatMessage` carried no author concept, and `model/domain/agent/agent.proto`
  `AgentMessage` and the `agent_messages` table have no author column either.

The correct identity infrastructure already existed elsewhere
(`useUserAvatar()` over `session.currentUser`, `UserSquareAvatar`,
`currentAuthenticatedActorPtid()`; social IM additionally stamps
`senderPtid`). The agent surface simply never connected to it — a "chimney"
placeholder instead of the session identity.

## Fix / contract

- Agent conversations are single-owner: Station enforces
  `agent_conversations.actor_ptid = <JWT ptid>` on every conversation and
  message query. Therefore every user message in an agent conversation IS the
  current session actor; per-message author fields on this surface would be a
  redundant half-model, not an identity improvement.
- `UserMessage` resolves `useUserAvatar()` (ptid, url, name) directly from the
  session store and renders the real tile: uploaded avatar image when present,
  real name initial otherwise. The audit attribute
  `data-pt-user-actor-ptid` carries the session ptid.
- Identity must not be stamped onto optimistic chat messages or threaded
  through optional component props "as an override": those create two identity
  paths (stamped local vs unstamped history). The session state machine is the
  single source, per `desktop-identity-lifecycle-closure.md`.

## How to detect a recurrence

- `rg "linear-gradient\(135deg, #667eea" apps/desktop/src/components` — the
  retired hardcoded user-tile gradient must have no identity-placeholder use.
- `rg "authorPtid" apps/desktop/src/store/chat.ts` — must stay empty; agent
  message author is not a client message field.
- Any component rendering a human actor tile must consume `useUserAvatar()` /
  `UserSquareAvatar`; a `name` default that synthesizes an identity (such as
  `'User'`) at the call site is the bug shape.

## Crosswalks

- Invariant: `docs/knowledge/invariants/desktop-identity-lifecycle-closure.md`.
- Platform contract: `docs/client/desktop/identity-lifecycle.md`.
