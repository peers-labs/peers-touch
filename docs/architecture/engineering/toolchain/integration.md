# Developer Toolchain - Integration

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

## 1. Boundary Map

| Concern | Owner |
|---|---|
| Public local-development commands | Make and PowerShell adapters |
| Profile parsing and local bootstrap | `tooling/devctl/profile.mjs` |
| Worktree binding, slot, capabilities, and leases | Local Dev Control Plane |
| Reviewed remote topology | sibling `env` repository |
| Local and Compose Station lifecycle | `tooling/devctl/station.mjs` |
| Remote Station deployment | reviewed Unix deployment adapter |
| Native Desktop lifecycle | `tooling/devctl/desktop.mjs` |
| Relay and Mobile lifecycle | existing platform adapters |
| Work organization and verification promotion | Development Workflow |
| Formal evidence | Acceptance |

These owners compose at command boundaries. They do not copy each other's
state.

## 2. Public Adapters

macOS and Linux use Make. Windows uses `tooling/dev.ps1`. Package scripts and
CI may call `devctl` directly.

Adapters may:

- translate command names and arguments;
- provide help and defaults;
- forward stdout, stderr, and exit status.

Adapters may not:

- select a Profile from ambient files;
- calculate ports or generate credentials;
- manage process identity;
- weaken a typed failure;
- choose verification or Acceptance scope.

## 3. Profile Flow

### Initialize

`make profile-init <name> SLOT=<n>` calls `devctl profile init`. It creates one
worktree-local Compose Profile and one private Compose credential file. The
operation is atomic and refuses overwrite.

### Select

`make profile <name>` calls the Local Dev machine owner. First selection
registers the canonical worktree and allocates a slot. Later selection updates
that binding without changing current Git HEAD ownership.

### Resolve

`devctl` reads the Profile named by the machine binding. It accepts either:

- a tracked-clean environment Profile; or
- a private worktree-local Profile.

Machine allocation supplies runtime ports. Acceptance may inject a contained
run-scoped Profile, but the real workspace binding remains required.

## 4. Runtime Flow

### Station

- `local`: build and start an owned Go process with isolated configuration.
- `compose`: run the selected Compose project with the Profile's private env
  file.
- `remote`: reuse a healthy exact-source deployment or invoke the reviewed
  remote adapter under Local Dev capability and lease checks.

Every successful start ends with readiness. Stop and restart act only on an
owned process or the exact selected Compose project.

### Desktop

`make desktop` performs the complete native development closure:

1. resolve the machine binding and Profile;
2. install locked packages when required;
3. prepare generated contracts and applet assets;
4. ready Station;
5. start managed Vite and native Tauri processes;
6. wait for the dependency canary and React mount signal.

Browser-only Desktop mode has no public command.

### Relay And Mobile

Relay and Mobile still use their platform adapters. They consume the same
machine binding and Profile environment but remain outside `devctl` ownership
until an explicit command-family cutover.

## 5. Cross-Platform Contract

| Capability | Windows | macOS/Linux |
|---|---|---|
| Profile, config, doctor, checks | native Node | native Node |
| Local Station | native Node | native Node |
| Compose Station | Docker CLI | Docker CLI |
| Native Desktop | Node + Tauri | Node + Tauri |
| Remote Station deployment | unsupported | reviewed Unix adapter |
| Relay and Mobile | platform-specific | platform-specific |

Unsupported behavior fails with a typed error. It never changes topology or
falls back to another Profile.

## 6. Verification

The current integration is checked by:

- Profile parsing, initialization, selection, and redaction tests;
- machine binding and allocation tests;
- process identity and lifecycle tests;
- Station and Desktop tests;
- Make and PowerShell wrapper-policy tests;
- fresh-checkout bootstrap plus Compose rendering;
- scans for deleted Profile scripts, profile-pointer authority, and
  browser-only Desktop entrypoints.

The user-facing command sequence lives in
[`docs/development/environment.md`](../../../development/environment.md).
