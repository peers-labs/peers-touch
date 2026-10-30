# Station managed CLI installation

Agent owns installation and execution. Dashboard authenticates administrators
and calls the Agent management port. The governing ownership contract is
[Provider Control Plane](provider-control-plane.md).

## Installation

Dashboard retains TRAE CLI, Codex, Cursor and Claude Code even when binaries
are missing. Codex and Claude use their official npm packages; Cursor uses
`https://cursor.com/install`; TRAE exposes its official manual installation
link. Binary installation and authentication are separate states.

Only Dashboard administrators call `/dashboard/api/ai/install/start` and
`/dashboard/api/ai/install/status`. Jobs deduplicate by adapter across the
Station. The selection background shows progress; failures retain retry and
the official guide. Desktop has no installation command path.

Persistent resources under `PEERS_AGENT_WORKSPACE_BASE`:

```text
station-managed/
  node/                         shared Node LTS and receipt
  bin/                          shared executable wrappers
  tools/<provider>/versions/    immutable verified installations
  tools/<provider>/current     atomic activation pointer
  install-state/               private installer HOME/cache/temp
actors/<actor-identity-hash>/
  cli-state/<provider-hash>/    private HOME/XDG/tool/cache/temp state
  workspaces/<session>/         private invocation workspace
station-control/cli-state/     administrator model discovery state
```

Managed Node is pinned to v24.22.2, verified against checksums fetched from
nodejs.org. Archives preserve bounded relative npm symlinks and reject path
escapes or writes through symlinks. Downloads may use the npmmirror binary
mirror; npm tries the configured registry, npmmirror and npmjs.

Installers receive an explicit environment without Station credentials or
shell initialization hooks. They prepare a staging tree, run a version probe,
then switch the activation pointer atomically. Wrapper preparation happens
before activation. Failed final verification restores the previous pointer
and wrapper; older versions remain available to already running processes.

Jobs are process-local. After restart, executable and version facts determine
the installation state. A failed upgrade reports `failed` while retaining the
previous installed version for recovery.

## Execution and discovery

Wrappers locate shared code and never set HOME, XDG or tool configuration.
Machine PATH binaries follow the same state isolation. Model discovery uses
the same environment builder, with either the requesting actor's private
root or Station control-plane state.

The executor refuses runtime configuration that overrides private directories,
PATH, shell hooks, loader settings or credentials. Selected model and effort
are passed as adapter arguments, independent of administrator startup options.
Credential variables come only from the owner-bound encrypted envelope:
`CODEX_API_KEY`, `CURSOR_API_KEY` or `ANTHROPIC_API_KEY`. They are not persisted
in runtime configuration or exposed in consumer projections.

Private directories isolate application state. They are not an operating
system sandbox against hostile executable code.

## Focused verification

`service/cli` verifies invocation and discovery environments;
`service/cli/managed` verifies shared installation, private actor state,
relocation, safe shell quoting, archive boundaries, job deduplication and
failed upgrade recovery. Provider handler tests distinguish management catalog
visibility from authorized consumer models. These are source checks; real
installation, Dashboard interactions and account-switch journeys require
current-source runtime observations.
