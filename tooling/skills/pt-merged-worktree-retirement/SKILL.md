---
name: pt-merged-worktree-retirement
description: Retire or reuse a feature worktree after its PR merges. Verify the merge, stop task-owned processes, delegate cache cleanup, align to master without rebasing squash-merged commits, rebind machine-dev registration, and record the retirement. Use when asked to clean up a worktree, align to master for the next task, or delete a merged feature branch.
---

# Merged Worktree Retirement

## Invoke When

- The PR for the current worktree is merged and the worktree must be cleaned
  or reused for a new task.
- Asked to align a worktree to master, delete a merged feature branch, or free
  disk after a merge.

Do not use for pre-merge cache cleanup (use `pt-debug-space-clean` alone),
opening/reviewing PRs (`pt-github-*`), or resetting stable Profile data.

## Core Rule

Verify before discarding; delegate cache classification; never replay merged
history; remote branch deletion requires separate explicit authorization.

## Workflow

1. **Verify the merge.** `git fetch origin --prune`; `gh pr view <n> --json
   state,mergeCommit,headRefOid`. Require `MERGED` and the merge commit on
   `origin/master` (`git merge-base --is-ancestor`). For squash merges verify
   `git rev-parse <head>^{tree}` equals `git rev-parse <mergeCommit>^{tree}`.
   Do not treat unmerged content as merged.
2. **Quiesce the worktree.** Require zero dirty paths. Inventory processes
   with cwd under the worktree (`lsof -nP -d cwd`) and active leases for the
   workspace (`machine-dev.mjs status-all`). Stop only task-owned dev servers
   and drivers; resources owned by another task or workspace block the
   retirement.
3. **Release artifacts through `pt-debug-space-clean`.** Run its scanner and
   use its cleanup paths/locks for caches; ignore-generated leftovers may be
   removed only when `git check-ignore` matches, the path is tracked nowhere,
   and it is not a symlink. Preserve original build lock files. Never delete
   `node_modules`, `.local`, evidence, credentials, databases, stable data,
   or another worktree's resources.
4. **Align without rebasing squash-merged history.** A plain `git rebase
   origin/master` replays already-squashed commits and creates false
   conflicts. Instead point the worktree at `origin/master`
   (`git reset --hard origin/master`) and create the new branch with
   `git switch -c <new-branch>`.
5. **Delete the old branch only when authorized.** Local deletion is allowed
   after step 1 proves the tree is in master. Remote branch deletion
   (`git push origin --delete`) is a separate explicit user authorization;
   never assume it. To discard the worktree itself use `git worktree remove`;
   report prunable records, never auto-prune.
6. **Rebind machine control plane.** Update the registration to the new
   branch and purpose (`machine-dev.mjs update ...`) and require `check` to
   pass. If the lifecycle helper fails on a stale Python wrapper, prepend a
   working interpreter to `PATH`; do not edit the registry by hand.
7. **Record the retirement.** Emit one JSON record: PR and merge commit,
   tree-equality result, branch disposition (local/remote), stopped PIDs,
   released artifacts with measured free-space delta, retained resources, and
   cold-rebuild consequence. Keep historical acceptance verdicts unchanged.

## Verification

- `git status` clean on the new branch at current `origin/master`.
- No task-owned orphan processes remain; workspace lease-free.
- `machine-dev.mjs check` PASS with the new branch binding.
- Evidence, credentials, `node_modules`, and lock files intact.
- Old branch disposition matches the granted authorization.

## Non-Goals

- Does not open, update, or review PRs.
- Does not define cache classification or own compilation-cache rules.
- Does not touch other worktrees or stable Profile data.
- Does not merge or release.
