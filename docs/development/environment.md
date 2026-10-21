# Development Environment

> **Status**: active
> **Audience**: human developers and development agents
> **Owner**: Developer Infrastructure

This guide gets one checkout to a running Station and native Desktop app. The
common path is local and worktree-isolated. Remote Profiles are an advanced
project-operator path.

## Requirements

All development:

- Git
- Node.js 22
- pnpm 9.12.0 through Corepack
- Make and Bash on macOS/Linux

Native Desktop:

- current stable Rust and Cargo
- Protocol Buffers compiler (`protoc`)
- the Tauri system prerequisites for the host OS

Local Station:

- Docker with Docker Compose v2
- enough disk for the Station image, PostgreSQL data, Node packages, and Rust
  build output

Station source work also uses Go 1.24.10. The workspace declares its Go
language version in `go.work`; the Station Frame module declares the toolchain.

Run `make doctor` after selecting a Profile. It reports the exact executable
paths and versions seen by the current checkout.

## First Run On macOS Or Linux

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate

make profile-init local
make profile local
make doctor
make desktop
```

`profile-init` creates two private, Git-ignored files:

- `.local/dev/profiles/local.env`: local topology without credentials.
- `.local/dev/compose/local.env`: generated Station and PostgreSQL secrets.

Both files use mode `0600` on POSIX. Initialization never overwrites an
existing Profile or secret file.

`make desktop` is self-preparing: it installs locked Node dependencies when
needed, generates missing Desktop contracts, readies the selected Station, and
starts the native Tauri application. Use `make station` separately when working
on Station without Desktop.

## First Run On Windows

Use the native PowerShell adapter:

```powershell
corepack enable
corepack prepare pnpm@9.12.0 --activate

.\tooling\dev.ps1 profile init local --slot 0
.\tooling\dev.ps1 profile activate local
.\tooling\dev.ps1 doctor
.\tooling\dev.ps1 desktop start
```

The PowerShell adapter and Make forward to the same `tooling/devctl`
implementation. Windows does not need Make or Bash for the supported local
Desktop and Compose Station path.

## Daily Commands

```bash
make config          # Show the selected, redacted Profile
make status          # Show managed Station and Desktop state
make station         # Ready Station
make desktop         # Ready Station and start native Desktop
make station-logs    # Follow Station logs
make restart         # Restart managed local services
make stop            # Stop managed local services
make help            # Discover the complete command surface
```

Desktop has no supported browser-only product runtime. Normal debugging starts
with `make desktop`; packaged builds are reserved for package and release
validation.

## Profiles

A Profile describes one development topology. The machine Dev Control Plane
binds the selected Profile and an isolated port slot to the current worktree.

```bash
make profiles
make profile <name>
make profile-init <name> SLOT=<n>
```

- `profile-init` creates a local Compose Profile for this worktree.
- `profile` selects an existing local or reviewed Profile and registers the
  checkout on first use.
- Profiles whose canonical ID ends in `stable`, case-insensitively, are
  protected from autonomous reset.
- Remote topology comes only from the reviewed sibling `env` repository; do
  not invent hosts or copy private configuration into source.

The control-plane design is documented in
[Local Dev](../architecture/engineering/local-dev/README.md). Most developers
do not need its registry, lease, or schema details.

## Troubleshooting

1. Run `make doctor`.
2. Run `make config` and confirm the Profile name and Station URL.
3. Run `make status`.
4. Inspect `make station-logs`.
5. Resolve unknown port owners explicitly; development tooling stops only
   processes it can prove it owns.

Test identities and their intended use are documented in
[Dev test accounts](../knowledge/playbooks/dev-test-accounts.md).
