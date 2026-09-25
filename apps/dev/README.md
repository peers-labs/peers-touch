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
```

## Ownership

- `apps/dev/server/` owns the local HTTP application and redacted projection.
- `apps/dev/web/` owns the browser UI.
- `tooling/scripts/local-dev/` remains the machine registry, declaration, and
  lease authority.
- The sibling `env` repository remains the profile and deploy-topology owner.
- `~/.peers-touch/dev/` remains machine-local state.

For tracked Plans, the UI displays both current Task-closure progress and the
machine-derived progress expected after the current Next Progress Slice.

Peers Dev is read-only in this version. Future write operations must use
guarded `devctl` application services instead of editing authority files.
