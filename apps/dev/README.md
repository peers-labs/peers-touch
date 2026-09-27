# Peers Dev

Peers Dev is the local self-development application for Peers Touch. It joins
worktree requirements and Journeys with machine runtime resources without
becoming a second workflow, environment, registry, or lease authority.

## Run

From the repository root:

```bash
make dev-ui
```

Peers Dev has one fixed machine endpoint:

```text
http://127.0.0.1:4177
```

The first process to bind that endpoint owns the live server. A launch from any
other worktree verifies `GET /api/server`, reports the existing source identity,
and exits successfully. An unrelated listener fails closed.

Print the read-only projection without starting the server:

```bash
make dev-ui-snapshot
make workflow-snapshot
```

Publish the current worktree's opportunity report:

```bash
make dev-observe
```

Agent hooks invoke the same reporter with a 15-second write debounce. The
browser polls every 15 seconds, and every snapshot also reconciles
`git worktree list`, so worktrees without a recent report remain visible as
`unreported`.

The browser prefers the bounded SSE stream and falls back to polling while
retaining the last valid snapshot. It presents project Stage, Plan closure
progress, current Task segments, Completion Review, and reduced Agent activity
as distinct layers.

## Diagnose

```bash
make workflow-doctor
```

The Doctor checks the installed integration, current Plan generation, owner
state, Completion Review, compatible machine-wide server, and executable
documentation. A failed promise is a typed blocker, not permission to repair
authority state from the UI.

<!-- workflow-doctor:dev.integration.installed -->
<!-- workflow-doctor:dev.plan.binding -->
<!-- workflow-doctor:dev.workflow.current -->
<!-- workflow-doctor:dev.review.current -->
<!-- workflow-doctor:dev.server.live -->
<!-- workflow-doctor:dev.docs.executable -->

## Ownership

- `apps/dev/server/` owns the local HTTP application and redacted projection.
- `apps/dev/web/` owns the browser UI.
- `tooling/scripts/local-dev/` remains the machine registry, declaration, and
  lease authority.
- The sibling `env` repository remains the profile and deploy-topology owner.
- `~/.peers-touch/dev/` remains machine-local state.

The dashboard shows `Reported`, `State`, and `Checked` times separately.
Observation and Git discovery are diagnostic only: they never register a
workspace or mutate workflow/runtime authority.

For tracked Plans, the UI displays both current Task-closure progress and the
machine-derived progress expected after the current Next Progress Slice.

Peers Dev is read-only in this version. Future write operations must use
guarded `devctl` application services instead of editing authority files.
