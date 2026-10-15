---
name: pt-codex-host-adapter
description: Binds an approved Peers-Touch worker or UI action to capabilities exposed by Codex. Use only after a host-neutral owner has defined the action.
---

# Codex Host Adapter

Thin transport only. Receive one approved action, exact canonical workdir,
bounded targets, expected result, and cleanup contract.

Use Codex capability when present, then return raw result, changed paths, and
cleanup outcome. Codex session/task metadata is diagnostic and never becomes
Plan, task progress, permission, or evidence authority.

Return `HOST_CAPABILITY_UNAVAILABLE` when the capability is absent. The owning
workflow decides repository-native fallback.

Never create worktrees, mutate task progress, grant delivery/runtime
permission, or claim product/Acceptance success.
