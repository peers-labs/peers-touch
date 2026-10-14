---
name: pt-trae-host-adapter
description: Binds an approved Peers-Touch worker or UI action to capabilities exposed by TRAE. Use only after a host-neutral owner has defined the action.
---

# TRAE Host Adapter

This is a thin transport adapter. It does not authorize work, own task state,
or decide PASS/FAIL.

## Input

- exact canonical worktree and workdir;
- one approved action and bounded targets;
- expected result and cleanup contract;
- requested TRAE capability.

Conversation and execution-session IDs are optional diagnostics only. They do
not create OWNER/WORKER/REVIEWER authority.

## Behavior

1. Verify the requested capability exists in the current host.
2. Invoke it with the exact canonical workdir and bounded inputs.
3. Return raw result, changed paths, and cleanup outcome to the owning workflow.
4. If unavailable, return `HOST_CAPABILITY_UNAVAILABLE`; repository-native
   fallback remains with the owner.

Hook context is advisory. Missing identity, unknown events, or Hook failure do
not block ordinary work.

## Forbidden

- Mutate Plan or task progress.
- Create worktrees.
- Grant deployment, reset, commit, push, or PR permission.
- Convert host metadata into project authority.
- Claim product or Acceptance success.

## Output

```text
host: trae
capability:
status: completed | failed | unavailable
workdir:
changedPaths:
cleanup:
rawResultRef:
```
