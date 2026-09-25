# Host-Neutral Skill Rollout

> **Status**: accepted
> **Created**: 2026-09-19 | **Updated**: 2026-09-21
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
worktrees. After rollout, every installed copy executes from its consuming
worktree root and derives that worktree's `workspaceId` and machine-local
workflow state.

This rollout covers canonical repository-owned `tooling/skills/pt-*` only.
Machine-local user Overlays are installed and resolved by
`skill-overlay-control.py`; they never enter the host discovery directories
managed by this rollout.

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
   make skill-rollout-audit ROOT=<worktree-root>
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
   every canonical `pt-*` Skill. The complete install runs while holding the
   machine work-ledger lock, rejects every `DECLARED`, `ACTIVE`, or `RELEASING`
   declaration as `ACTIVE_ACTION_IN_FLIGHT`, validates the ledger through its
   canonical Node owner while holding that lock, never reclaims another owner's
   stale lock, waits while a live ledger owner holds an inode-bound recovery
   claim, reclaims only a dead recovery owner through PID/start identity, rejects
   host-root, retirement-root, and canonical-source ancestor/descendant symlink
   escape, and uses no-replace atomic move on macOS, Linux, and Windows when
   capturing owned lock metadata. It writes one strict current machine receipt in
   `ROLLOUT_RESTART_REQUIRED`. The receipt binds the recursive canonical Skill
   catalog, file modes, dirty catalog status, branch, and HEAD. The host
   must expose a stable session instance through its native session marker or,
   for a host integration that has none, an orchestrator-injected
   `PT_AGENT_SESSION_ID`.
6. End the old agent session. In the new host session run:

   ```bash
   make skill-rollout-ack IDE=<trae|cursor|codex>
   make skill-rollout-audit IDE=<trae|cursor|codex> ROOT=<worktree-root>
   ```

   ACK fails when the current host-session hash equals the installing session.
   Session hashing binds the host and stable session value, not the environment
   variable name used to expose that value; conflicting non-empty markers fail
   as `HOST_SESSION_ID_AMBIGUOUS`. The host-aware audit verifies the
   acknowledged session, receipt schema/kind, workspace, branch, HEAD,
   recursive catalog identity, dirty catalog status, and every projected
   symlink's exact canonical target before it reports `PASS`. It also invokes
   the canonical
   Plan binding and Plan Package validators, checks the current Task and source
   claims, and propagates malformed or blocked Acceptance registry state.
7. Resume from the persisted Plan, Task, Session, workspace active-work record,
   and Context Anchor under the refreshed host catalog, then publish the new
   Development declaration.
8. Verify the first resumed action is scheduled by `pt-goal-orchestrator` and
   executed by `pt-dev-workflow`. Do not recreate or rebind the Plan.

## Fleet Audit

Before and after rollout, run:

```bash
make skill-rollout-audit-all IDE=<trae|cursor|codex>
```

The canonical audit enumerates Git worktrees and reports each branch's missing
Skills, legacy source/references, and host projection gaps. Repeat the rollout
sequence independently for every active worktree. A worktree that
cannot integrate the canonical commit remains on the old governance set and is
reported `ROLLOUT_BLOCKED`; it must not receive only the new host projection or
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
- `ROLLOUT_RESTART_NOT_OBSERVED`: end the installing host session and ACK only
  from a new session identity.
- `HOST_PROJECTION_ESCAPE`: replace the external/symlinked host root with a
  real worktree-local directory before installation.
- `CANONICAL_SKILL_SOURCE_INVALID`: integrate real worktree-local Skill sources;
  do not project a symlinked external implementation.

## Completion

Fleet rollout is complete only when every selected active worktree reports
audit `PASS`, no host discovery root exposes the legacy scheduler, each
installed copy resolves runtime state under the consuming root's distinct
workspace path, and each resumed Plan advances at least one legal
owner-controlled action.
