---
kind: invariant
title: Workflow enforcement is bound to one conversation execution root
status: active
owns:
  - tooling/plugins/pt-ew-plugin/
  - tooling/scripts/agent-integration-control.py
  - tooling/scripts/agent-integration-audit.py
  - tooling/scripts/install-agent-integration.sh
  - tooling/scripts/local-dev/workflow-*.mjs
  - tooling/make/setup.mk
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/host-neutral-agent-execution.md
  - docs/knowledge/invariants/workspace-active-work-is-local.md
  - docs/knowledge/invariants/worktree-observation-is-diagnostic.md
detected: 2026-09-23
---

# Workflow enforcement is bound to one conversation execution root

## What must hold

Each host conversation binds exactly once to one canonical Peers-Touch
`executionRoot`. The binding is created atomically on the first blockable
`PreToolUse`, keyed by a hash of host plus stable conversation ID, and cannot be
rebound by `cwd`, a tool target, another workspace root, or stale Plan state.
`SessionStart` and prompt hooks may prewarm context but cannot create authority.

The execution root and the current tool `subjectRoot` are separate:

- reads may target another worktree;
- writes may target only the immutable execution root;
- source writes must also satisfy the active declaration's source claims;
- dynamic or unparseable shell structure fails closed.

If a host supplies no stable conversation ID, or cannot run a blockable
pre-tool hook, the integration is explicitly `OBSERVE_ONLY`. It must not claim
enforcement.

The host-neutral Kernel may write only its own machine-local conversation
binding, rendered Anchor receipt, and create-once release receipt. It never
repairs or advances Plan, Task, declaration, Development Session, active-work,
runtime, or evidence state. TRAE, Cursor, and Codex only normalize payloads and
render host-native responses.

## Why this is non-negotiable

Tool `cwd` describes an operation, not the identity of the chat that authorized
it. Treating each `cwd` as the active worktree lets one conversation silently
change authority when it reads or writes through a sibling checkout.

Conversely, the conversation binding is not a worktree lease. It does not
reserve a directory or serialize independent conversations. It only prevents
one conversation from changing its own write authority.

## How to verify

- `node --test tooling/scripts/local-dev/workflow-*.test.mjs
  tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs` passes.
- `python3 -m unittest tooling/scripts/agent-integration-audit-test.py` passes.
- Session start leaves the binding store unchanged.
- Concurrent first `PreToolUse` calls converge on one binding.
- A sibling-worktree read passes and the corresponding write is denied.
- Multiline, substitution, and unsupported shell structures cannot bypass
  admission.
- Cursor projection contains native `sessionStart`, `beforeSubmitPrompt`,
  `preToolUse`, and `stop` hooks with `failClosed: true`.
- TRAE installation preserves unrelated `.trae/hooks.json` entries.
- Stop cannot release a terminal or blocked conversation until the exact
  machine-rendered Anchor is observable and its release receipt is committed.
- Runtime code, hook config, Acceptance registry, and review scripts contain no
  reference to the removed guard module.

## Crosswalks

- DWF-D21 keeps project execution semantics independent of host transport.
- DWF-D22 keeps mutable workflow owner state in each consuming worktree.
- DWF-D26 defines conversation-bound admission, Anchor, and release semantics.
