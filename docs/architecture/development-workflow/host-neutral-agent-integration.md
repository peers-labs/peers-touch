# Host-Neutral Agent Integration

> **Status**: accepted
> **Created**: 2026-09-19 | **Updated**: 2026-09-23
> **Owner**: Platform Team

## Goal

Roll out DWF-D21 to independent worktrees without raw-patch assumptions,
split-brain Skill ownership, or interruption of an active Development Run.

## Unit Of Rollout

One verified worktree is one rollout unit. Branches may contain different
Plans, Acceptance registries, and local governance changes, so rollout is a
semantic integration, not filesystem copying.

The `peers-dev-workflow` repository owns the canonical implementation and
distribution contract. It is not the runtime-state source for consuming
worktrees. Each installed adapter contributes its own canonical root as a
binding hint. The first blockable tool event for a stable host conversation
atomically selects one hint as the immutable `executionRoot`.

The canonical source includes repository-owned `tooling/skills/pt-*` and the
thin `tooling/plugins/pt-ew-plugin/` adapter. Machine-local user Overlays are
installed and resolved by
`skill-overlay-control.py`; they never enter the host discovery directories
managed by this integration.

## Kernel Model

The adapter and Kernel deliberately distinguish three identities:

| Identity | Meaning | Mutability |
|---|---|---|
| host conversation | one IDE chat/session, persisted only as a hash | stable |
| `executionRoot` | the worktree authorized for writes by that conversation | create-once |
| `subjectRoot` | the repository targeted by one read/write/tool invocation | per event |

`SessionStart` is optional prewarming. It cannot establish authority. Cursor
Cloud has no `sessionStart`, so local and cloud correctness both begin at the
first `preToolUse`. If the host has no stable conversation ID or cannot block
that event, the mode is `OBSERVE_ONLY`.

Cross-worktree reads are legal. A write whose subject root differs from the
conversation execution root fails with `CROSS_WORKTREE_WRITE_DENIED`.

| Host | Stable identity | Blocking boundary | Startup behavior |
|---|---|---|---|
| TRAE | `session_id` | `PreToolUse` | `SessionStart` prewarm |
| Cursor local | `conversation_id` | `preToolUse` + `failClosed` | `sessionStart` prewarm |
| Cursor Cloud | `conversation_id` | `preToolUse` + `failClosed` | no `sessionStart`; first tool binds |
| Codex plugin | `session_id` / `conversation_id` | `PreToolUse` | `SessionStart` prewarm |

Conflicting non-empty identity fields fail with
`HOST_CONVERSATION_ID_AMBIGUOUS`. Missing identity never falls back to a
process-global or mutable workspace pointer.

## Required Sequence

1. Reach a durable Task or Context Anchor boundary. Do not replace Skills while
   an agent action or runtime result commit is in flight.
2. Integrate the canonical governance commit into the selected worktree using
   normal Git conflict handling. Preserve unrelated branch work.
3. Migrate branch-owned references:
   - active Plan `scope.sourceClaims`;
   - Task write/read sets;
   - Acceptance registry path matchers;
   - local review scripts and worktree-binding fixtures;
   - docs that route to `pt-trae-goal-orchestrator`.
4. Run:

   ```bash
   make agent-integration-audit ROOT=<worktree-root>
   ```

   This source audit must report `PASS`. It fails closed on missing canonical
   Skills, missing canonical Acceptance registry matchers, legacy source/live
   references, and workflow identity mismatches. A bound workspace requires a
   tracked declaration locator; only an unbound pre-Plan workspace may carry an
   untracked declaration during this source-only audit.
5. Release the active Development declaration, then install the current host
   projection without prompting:

   ```bash
   make skills IDE=<trae|cursor|codex>
   ```

   The installer moves a real legacy Skill directory under the host's
   `retired-project-skills/` directory, outside the discovery root, and links
   every canonical `pt-*` Skill. Codex additionally receives
   `.agents/plugins/pt-ew-plugin`; Cursor receives merged project-native
   `.cursor/hooks.json` entries for `sessionStart`, `beforeSubmitPrompt`,
   `preToolUse`, and `stop`, all with `failClosed: true`; TRAE receives a
   merged `.trae/hooks.json` that preserves unrelated entries. No user-global
   hook file is modified.
   The complete install runs while holding the
   machine work-ledger lock, rejects every `DECLARED`, `ACTIVE`, or `RELEASING`
   declaration as `ACTIVE_ACTION_IN_FLIGHT`, validates the ledger through its
   canonical Node owner while holding that lock, never reclaims another owner's
   stale lock, waits while a live ledger owner holds an inode-bound recovery
   claim, reclaims only a dead recovery owner through PID/start identity, rejects
   host-root, retirement-root, and canonical-source ancestor/descendant symlink
   escape, and uses no-replace atomic move on macOS, Linux, and Windows when
   capturing owned lock metadata. It writes one strict current machine receipt
   in `INSTALLING`, runs the host-aware audit and callback proof, then publishes
   `INSTALLED` or `BLOCKED`. The receipt binds the recursive canonical Skill
   and plugin catalog, file modes, dirty status, branch, HEAD, and callback
   proof.
6. Run the read-only audit at any later boundary:

   ```bash
   make agent-integration-audit IDE=<trae|cursor|codex> ROOT=<worktree-root>
   ```

   There is no acknowledgement command or session-hash bypass. Restart the IDE
   only when changed hooks cannot be reloaded by the current host, then rerun
   the audit. The audit verifies receipt schema/kind, workspace, branch, HEAD,
   recursive catalog identity, dirty catalog status, callback proof, and every
   projected symlink's exact canonical target before it reports `PASS`. It also
   invokes the canonical
   Plan binding and Plan Package validators, checks the current Task and source
   claims, and propagates malformed or blocked Acceptance registry state.
7. Resume from the persisted Plan, Task, Session, workspace active-work record,
   and Context Anchor under the refreshed host catalog, then publish the new
   Development declaration.
8. Verify the first resumed action is scheduled by `pt-goal-orchestrator` and
   executed by `pt-dev-workflow`. Do not replace an unfinished Plan generation.

## Fleet Audit

Before and after rollout, run:

```bash
make agent-integration-audit-all IDE=<trae|cursor|codex>
```

The canonical audit enumerates Git worktrees and reports each branch's missing
Skills, plugin/hook drift, legacy source/references, and host projection gaps.
Repeat the integration
sequence independently for every active worktree. A worktree that
cannot integrate the canonical commit remains on the old governance set and is
reported `AGENT_INTEGRATION_BLOCKED`; it must not receive only the new host projection or
only the old Skill deletion.

Required report fields:

- worktree, branch, workspace ID, expected HEAD;
- active Plan ID/path and current Task;
- semantic integration commit;
- audit before/after;
- selected host and installed projection;
- old session closed, new session resumed;
- first post-rollout Goal Slice and result.

## Failure Semantics

- `LEGACY_SKILL_REFERENCE`: migrate the named Plan/registry/doc source.
- `MISSING_CANONICAL_SKILL`: integrate the canonical governance source first.
- `HOST_PROJECTION_INCOMPLETE`: rerun the non-interactive installer.
- `SOURCE_CONFLICT`: resolve semantically in that branch; never use a raw patch
  as the rollout authority.
- `ACTIVE_ACTION_IN_FLIGHT`: wait for or safely cancel the owner action, persist
  state, then restart the session.
- `MACHINE_WORK_LEDGER_LOCKED`: do not reclaim the lock from the rollout path;
  let the Development ledger owner verify or recover it.
- `AGENT_RESTART_NOT_OBSERVED`: end the installing host session and ACK only
  from a new session identity.
- `HOST_PROJECTION_ESCAPE`: replace the external/symlinked host root with a
  real worktree-local directory before installation.
- `CANONICAL_SKILL_SOURCE_INVALID`: integrate real worktree-local Skill sources;
  do not project a symlinked external implementation.
- `CANONICAL_PLUGIN_SOURCE_INVALID`: restore the current worktree's canonical
  `tooling/plugins/pt-ew-plugin` source.
- `TRAE_HOOKS_INVALID`: repair the workspace hook file without replacing
  unrelated hook entries.
- `CURSOR_HOOKS_INVALID`: repair the project hook file without replacing
  unrelated hook entries.
- `CONVERSATION_BINDING_INVALID`: repair the owner-controlled machine record;
  never infer a replacement execution root from the current tool `cwd`.
- `CROSS_WORKTREE_WRITE_DENIED`: execute the write from a conversation bound
  to that worktree; a read from the current conversation remains legal.

## Completion

Fleet integration is complete only when every selected active worktree reports
audit `PASS`, no host discovery root exposes the legacy scheduler, each
conversation proves immutable execution-root binding and cross-root write
denial, global hooks remain unchanged, and each resumed Plan advances at least
one legal owner-controlled action. Stop proof additionally requires the exact
machine-rendered Anchor and its create-once release receipt.
