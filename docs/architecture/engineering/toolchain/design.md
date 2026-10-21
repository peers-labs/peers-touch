# Developer Toolchain Design

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

## 1. Principles

1. `devctl` owns cross-platform command behavior.
2. Make, PowerShell, package scripts, and CI are adapters.
3. The machine Dev Control Plane owns worktree binding, slot, capability, and
   lease authority.
4. Profile files own topology, not machine allocation.
5. Process records are ownership evidence; live probes determine readiness.
6. Missing or conflicting state fails before mutation.
7. Logs and diagnostics redact credentials.

## 2. System

```text
Developer / Agent / CI
  |
  +-- make <command>
  +-- tooling/dev.ps1 <command>
  +-- package or workflow adapter
  |
  v
tooling/devctl/index.mjs
  |
  +-- profile.mjs ---- machine registry + Profile definition
  +-- doctor.mjs ----- executable and runtime preflight
  +-- station.mjs ---- Station ready/status/stop/restart
  +-- desktop.mjs ---- dependencies, Station closure, Vite, Tauri
  +-- checks.mjs ----- deterministic cross-platform checks
  |
  v
Station / Vite / native Tauri Desktop
```

`devctl` is development infrastructure. It never owns Station or client
business data.

## 3. Sources Of Truth

- Worktree identity, selected Profile, slot, and allowed capabilities:
  `~/.peers-touch/dev/registry.json`, through the Local Dev owner.
- Reviewed remote topology: sibling `env/peers-touch/<profile>/`.
- Worktree-local topology: `.local/dev/profiles/<profile>.env`.
- Local Compose credentials: `.local/dev/compose/<profile>.env`.
- Runtime source identity: current Git branch and HEAD observed per operation.
- Managed process identity: workspace-scoped runtime records plus live OS
  identity.
- Runtime readiness: Station health/build endpoint and Desktop dependency,
  Vite, and WebView mount probes.

No `.local/dev/active` pointer, task record, Plan, Hook, or chat identity may
select or authorize a runtime.

## 4. Profile Lifecycle

### Initialize

`devctl profile init <name> --slot <n>` creates:

- one declarative Compose Profile;
- one private Compose environment with random Station and PostgreSQL secrets.

Initialization validates the name and slot, creates both files atomically, and
refuses to overwrite either file.

### Select

Profile selection delegates to the machine Dev Control Plane. First selection
registers the current worktree and allocates a free slot. The selected Profile
name and declared `PT_DEV_PROFILE` must match.

### Resolve

Normal resolution requires an authoritative machine binding. The binding
selects either:

- a tracked-clean Profile from the sibling environment repository; or
- a private worktree-local Profile.

Machine allocation overrides local client ports and local/Compose Station
ports. Acceptance may supply a contained runtime-manifest Profile, but it still
requires the real workspace binding.

## 5. Doctor

`doctor` resolves the selected Profile before checking dependencies.

- every path: Node and pnpm;
- Desktop: Cargo, Rust, and `protoc`;
- local Station mode: Go;
- Compose Station mode: Docker;
- Windows Desktop: MSVC linker or reviewed Build Tools location.

Diagnostics report the executable path and observed version. Credential-like
configuration is redacted.

## 6. Station

Station behavior depends on Profile mode:

- `local`: build the Go Station, generate isolated runtime configuration, and
  run an owned process;
- `compose`: start the Profile's isolated PostgreSQL and Station services;
- `remote`: reuse only a healthy build whose commit matches current source,
  otherwise use the reviewed deployment adapter and verify build identity.

Start succeeds only after readiness. Stop or restart acts only on a proven
owned process or the exact selected Compose project.

## 7. Desktop

Desktop startup:

1. resolves the Profile and runtime paths;
2. installs locked packages when incomplete;
3. prepares generated contracts and applet assets;
4. readies Station;
5. starts one managed Vite process and one native Tauri process;
6. waits for the dependency canary and React mount signal.

There is no Desktop Web mode. Packaged installation is a separate
`desktop install` command and does not replace the live development runtime.

## 8. Allowed Relationships

Allowed:

- wrappers invoke `devctl`;
- `devctl` consumes machine binding and Profile topology;
- `devctl` starts owned product processes;
- platform-specific helpers remain for capabilities not yet owned by `devctl`.

Forbidden:

- wrappers implementing Profile or lifecycle policy;
- selecting a Profile from a symlink, branch, basename, or sibling worktree;
- creating secrets in tracked source;
- killing an unknown port owner;
- browser-only Desktop startup;
- workflow or Acceptance state controlling runtime admission;
- a direct script becoming a second project-wide development entrypoint.

## 9. Failure Semantics

Failures are typed and occur before unsafe mutation where possible:

- missing or invalid Profile;
- missing machine binding or capability;
- missing dependency;
- occupied port with unknown owner;
- managed-process identity mismatch;
- readiness timeout;
- unsupported platform or mode;
- remote source or target mismatch.

Errors include operation and non-secret identity. They never include Profile
credentials.

## 10. Quality Gates

- Profile parsing and bootstrap tests.
- Machine binding and allocation tests.
- Managed-process identity and lifecycle tests.
- Station mode tests.
- Desktop dependency/readiness/lifecycle tests.
- Make and PowerShell adapter checks.
- fresh-checkout Profile bootstrap and Compose rendering.
- scans preventing Web mode, active-pointer authority, or wrapper policy from
  returning.
