# Host-Neutral Agent Integration

> **Status**: accepted
> **Created**: 2026-09-19 | **Updated**: 2026-10-09
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
worktrees. Each worktree installs its own adapter and Hook from its own checked
out source. A multi-root workspace descriptor supplies the allowed runtime root
set but does not make one worktree an integration source for another. The
Kernel resolves the explicit target worktree for each mutating OWNER event; the
first blockable event creates only the immutable OWNER identity.

The Hook's own filesystem location is never an action-workspace hint. A unique
mutation target wins, followed by a host-provided task root, tool `cwd`, active
editor root, and repository `cwd`. The selected root must match one declared
workspace root. Multiple mutation roots return `WORKTREE_SELECTION_REQUIRED`;
folder order is never authority.

The canonical source includes repository-owned `tooling/skills/pt-*` and the
thin `tooling/plugins/pt-ew-plugin/` adapter. Machine-local user Overlays are
installed and resolved by
`skill-overlay-control.py`; they never enter the host discovery directories
managed by this integration.

## Kernel Model

The adapter and Kernel deliberately distinguish five identities:

| Identity | Meaning | Mutability |
|---|---|---|
| root chat | one visible development chat, persisted only as a hash | stable |
| execution session | host-internal owner/worker/reviewer invocation, persisted only for assigned children | per invocation |
| binding role | `OWNER`, `WORKER`, or `REVIEWER` | assignment-bound |
| binding lineage | root, parent, and assignment digests | create-once |
| `executionRoot` | selected workspace for one OWNER mutation, or the fixed assignment workspace for a child | per OWNER mutation / create-once child |
| `subjectRoot` | the repository targeted by one read/write/tool invocation | per event |

`SessionStart` is optional prewarming. It cannot establish authority. Cursor
Cloud has no `sessionStart`, so local and cloud correctness both begin at the
first `preToolUse`. If the host has no host-specific root-chat identity or
cannot block that event, the mode is `OBSERVE_ONLY`.

Cross-worktree reads are legal. One OWNER chat may perform separate mutations
in different worktrees without rebinding. A single mutation spanning roots
fails with `WORKTREE_SELECTION_REQUIRED`; a path escaping the selected action
workspace fails with `ACTION_WORKSPACE_WRITE_DENIED`.

| Host | OWNER identity key | Assigned-child identity key | Blocking boundary |
|---|---|---|---|
| TRAE | `chat_session_id` | `session_id` | `PreToolUse` |
| Cursor local/cloud | `conversation_id` | `conversation_id` | `preToolUse` + `failClosed` |
| Codex plugin | `session_id` | `session_id` | `PreToolUse` |

Adapters read only the named fields for their host. Missing identity never
falls back to another host's alias, `ICUBE_CODEMAIN_SESSION`, a process-global
value, or a mutable workspace pointer.

An execution session without an assignment uses the OWNER projection for
admission and cannot claim child independence. WORKER/REVIEWER assignment is
create-once, carries root/parent binding digests plus the Development Session
and operation IDs, freezes one assignment workspace, and has a bounded lease.
Creation requires the exact current `active-work.json` and `session.json`
identity in that workspace. Terminal receipts close child liveness; expired or
terminal children never participate in current owner selection.

TRAE `SubagentStart` and `SubagentStop` are the lifecycle boundaries for
assignment claim and terminalization. `PreCompact` records the current
projection into a bounded receipt keyed by `bindingDigest`; concurrent lineage
members never share that slot. `PostCompact` re-resolves the actor and requires
the same root, parent, assignment, Session, workspace, and execution root before
restoring context. Task changes update only the projected Development Session
identity; they do not create another OWNER.

Completion Review is repository-native and does not consume host bindings or
Action Receipts. Schema v3 uses only the `completion-reviews-v3` machine
namespace with a request-scoped reviewer capability. Earlier review records
remain untouched and are never loaded, translated, or copied into current
authority.

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

   This full audit normally reports `PASS`. It fails closed on missing
   canonical Skills, missing canonical Acceptance registry matchers, legacy
   source/live references, and workflow identity mismatches. During bootstrap,
   projection may continue only when canonical source, registry, and catalog
   checks pass and the remaining findings are existing machine workflow
   identity/schema diagnostics. Projection does not claim those diagnostics
   repaired.
5. Install the current non-destructive host projection without prompting. This
   step does not release the active declaration and does not depend on a Hook
   grant:

   ```bash
   make skills IDE=<trae|cursor|codex>
   make skills IDE=trae WORKSPACE=<absolute-.code-workspace-path>
   ```

   The installer moves a real legacy Skill directory under the host's
   `retired-project-skills/` directory, outside the discovery root, and links
   every canonical `pt-*` Skill. Codex additionally receives
   `.agents/plugins/pt-ew-plugin`; Cursor receives merged project-native
   `.cursor/hooks.json` entries for `sessionStart`, `beforeSubmitPrompt`,
   `preToolUse`, and `stop`, all with `failClosed: true`; TRAE receives one
   local managed Hook set in the selected worktree, including
   `SubagentStart`, `SubagentStop`, `PreCompact`, and `PostCompact`. The
   workspace descriptor is passed to that local Hook for runtime root
   validation. No sibling worktree or user-global hook file is modified.
   Ordinary install never deletes conversation or workflow-action stores. It
   runs while holding the machine work-ledger lock and does not require a
   grant from the Hook it installs. Canonical source, host-root, workspace,
   Hook-merge, symlink-boundary, and callback-proof checks remain fail closed.
   Unrelated live declarations, child assignments, workflow actions, and
   Action Store activity do not participate in projection admission.
   The install wrapper runs an explicit `--projection-only` audit; that scope
   ignores workflow-identity findings only for its PASS calculation and still
   includes them in output. A later full `make agent-integration-audit` remains
   required after Plan/declaration state migration or repair.
   `skills-hard-cut` and `skills-gc` use separate OWNER_CONTROL labels and
   create-once OWNER grants. Only those cleanup commands reject every live machine
   declaration, child assignment, unrelated canonical workflow action, and
   Action Store lock as `GLOBAL_WORKFLOW_NOT_IDLE`. Every mode holds the
   machine lock, never reclaims another owner's stale ledger lock, waits while
   a live ledger owner holds an inode-bound recovery claim, and reclaims only a
   dead recovery owner through PID/start identity. Destructive cleanup
   validates ledger, binding, and Action stores through their canonical owners,
   rejects host-root, retirement-root, reset, and canonical-source symlink
   escape, and validates every reset target before deleting any store.
   Projection does not parse those unrelated owner stores. Each operation
   completes fallible path, workspace, catalog, and hook planning before any
   destructive grant consumption. After consumption cleanup immediately writes
   one strict current machine receipt and performs only that operation's
   bounded mutation,
   reset inside the guarded lifecycle, runs the host-aware audit and exact
   installed callback proof, then publishes `INSTALLED` or `BLOCKED`. A reset
   failure therefore cannot leave an absent or stale lifecycle receipt. The
   receipt binds the recursive canonical Skill and plugin catalog, file modes,
   dirty status, branch, HEAD, and callback proof.
6. Run the read-only audit at any later boundary:

   ```bash
   make agent-integration-audit IDE=<trae|cursor|codex> ROOT=<worktree-root>
   ```

   There is no acknowledgement command or session-hash bypass. Restart the IDE
   only when changed hooks cannot be reloaded by the current host, then rerun
   the audit. The audit verifies receipt schema/kind, workspace descriptor and
   participating Hook roots, branch, HEAD,
   recursive catalog identity, dirty catalog status, callback proof, and every
   projected symlink's exact canonical target before it reports `PASS`. It also
   invokes the canonical
   Plan mount and stable Plan validators, checks the current Task and source
   claims, and propagates malformed or blocked Acceptance registry state.
7. Resume from the persisted Plan, Task, Session, workspace active-work record,
   and Context Anchor under the refreshed host catalog, then publish the new
   Development declaration.
8. Verify the first resumed action is scheduled by `pt-goal-orchestrator` and
   executed by `pt-dev-workflow`. Do not replace or unmount an unfinished Plan.

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
- `GLOBAL_WORKFLOW_NOT_IDLE`: close or expire every live declaration, child
  assignment, and workflow action other than the current exact OWNER installer
  action, then retry the hard cut.
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
- `TRAE_WORKSPACE_DESCRIPTOR_INVALID`: repair the selected worktree's
  descriptor membership without replacing unrelated local Hook entries.
- `CURSOR_HOOKS_INVALID`: repair the project hook file without replacing
  unrelated hook entries.
- `WORKFLOW_BINDING_INVALID`: repair the owner-controlled current binding
  store; never infer OWNER identity from the current tool `cwd` or read a
  legacy conversation record.
- `WORKTREE_SELECTION_REQUIRED`: split a multi-root mutation into separate
  actions or supply one declared task root/tool `cwd`.
- `ACTION_WORKSPACE_WRITE_DENIED`: run the action inside its selected
  workspace and keep every mutation path inside that root and declaration.

## Completion

Fleet integration is complete only when every selected active worktree reports
its own audit `PASS`, no host discovery root exposes the legacy scheduler, each
worktree has one exact local managed Hook per event that points to its own
plugin, each owner lineage proves stable OWNER identity, per-action workspace
selection, single-root mutation confinement, and assignment-bound children,
global and sibling hooks remain unchanged, and each resumed Plan advances at
least one legal owner-controlled action. Stop proof additionally requires the
exact machine-rendered Anchor and its create-once OWNER release receipt.
