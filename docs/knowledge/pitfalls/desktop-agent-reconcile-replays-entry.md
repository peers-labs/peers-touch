---
kind: pitfall
title: Agent background reconciliation must not replay page entry
status: active
owns:
  - apps/desktop/src/runtimes/agentCapabilityRuntime.ts
  - apps/desktop/src/runtimes/agentTopicRuntime.ts
  - apps/desktop/src/store/agent.ts
  - apps/desktop/src/store/agentTopics.ts
  - apps/desktop/src/store/chat.ts
  - apps/desktop/src/components/AgentSidebar.tsx
referenced-by:
  - docs/client/desktop/runtime-projections.md
related:
  - docs/client/common/ui-identity/frontend-component-tree.md
detected: 2026-11-01
---

# Agent reconciliation replays entry

## Symptom

An idle Native Agent workbench feels periodically refreshed even though its
document and page root survive. Topic actions disappear into synchronization
feedback and current history is repeatedly republished.

## Root cause

Capability and evaluation timers both reload the Agent roster. Allocating an
equal roster array triggers a Topic runtime subscriber that mistakes allocation
for Agent selection. Alongside its own timer, that runtime replays cache
bootstrap, background history sync and authoritative message refresh. Equal
Topic/message arrays invalidate renderer selectors, and the loading flag
replaces the established Topic action strip.

## Mitigation

Use TanStack Query structural sharing at JSON projection commit boundaries.
Compare canonical selected-Agent identity, coalesce same-Agent reconciliation
and reserve cache bootstrap for cold entry. Keep established actions and
accepted empty content during background reads. Selection invalidation refreshes
capability authority without reloading global directories. Draft reconciliation
must preserve local rejection and composer state. Retain periodic/event recovery
and publish actual authoritative changes.

## How to detect a recurrence

Run the Agent native Topic Journey across at least two real reconciliation
periods without invoking Harness reconciliation during observation. Compare
document/page/message/action identity, reading position, focused composer and
draft; observe a real changed Topic after background refresh. Capture Native
screenshots and command names/counts without prompts, credentials or arguments.
Check `agentTopicRuntime.test.ts`, `agent.test.ts`, `agentTopics.test.ts` and
`chatMerge.test.ts` for duplicate reads and unchanged projection identity.
Source checks alone do not prove Native continuity.
