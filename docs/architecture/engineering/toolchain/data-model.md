# Developer Toolchain - Data Model

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

## 1. Profile Definition

A Profile is a declarative env file. Blank lines and full-line comments are
ignored. Values may use one matching quote pair. Variable expansion, command
substitution, redirection, and executable shell syntax are rejected.

```typescript
interface DevProfile {
  PT_DEV_PROFILE: string;
  PT_DEV_SLOT: string;
  PT_STATION_MODE: "local" | "compose" | "remote";
  PT_STATION_NAME: string;
  PT_STATION_URL: string;
  PT_STATION_PORT: string;
  PT_DESKTOP_APP_GATEWAY_PORT: string;
  PT_DESKTOP_APP_WEB_PORT: string;
}
```

Mode-specific fields are validated only for the selected mode. Unknown
declarative fields remain available to product processes.

## 2. Local Compose Bootstrap

`devctl profile init <name> --slot <n>` creates two files:

```text
.local/dev/profiles/<name>.env   topology and local port defaults
.local/dev/compose/<name>.env    Compose project and generated credentials
```

The Profile references the Compose file through
`PT_STATION_COMPOSE_ENV_FILE`. The credential file contains random
`PEERS_AUTH_SECRET` and `PEERS_DB_PASSWORD` values. Both files are private on
POSIX and neither is overwritten.

Profile topology and credentials stay separate. Credential values are never
returned by `config`, `doctor`, or runtime state.

## 3. Resolved Runtime Profile

The machine Dev Control Plane selects the Profile and owns local allocation.
`devctl` combines that binding with one Profile definition:

```typescript
interface ResolvedRuntimeProfile {
  reference: {
    workspaceId: string;
    workspaceRoot: string;
    profileName: string;
    resolvedPath: string;
    authority: "machine-control-plane";
    canonical: boolean;
  };
  profile: DevProfile;
  paths: {
    profileState: string;
    profileData: string;
    profileLogs: string;
    profilePids: string;
  };
}
```

Machine allocation replaces local client ports and local or Compose Station
ports. A tracked-clean environment Profile is canonical for remote deployment;
a worktree-local Profile is valid only for that worktree.

An Acceptance runtime manifest may provide a run-scoped Profile file. It must
declare `acceptance-runtime-manifest` authority and remain inside the declared
runtime Profile root. It does not replace the workspace binding.

## 4. Runtime Paths

Managed runtime state resolves under:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/runtime/<profile>/
├── data/
├── logs/
└── pids/
```

The Local Dev owner resolves the platform-specific machine root. `devctl` does
not persist product data in the registry and does not use a worktree profile
pointer.

## 5. Managed Process Record

```typescript
interface ManagedProcessRecord {
  schemaVersion: 1;
  service: string;
  profile: string;
  worktreeId: string;
  pid: number;
  command: string;
  args: string[];
  commandFingerprint: string;
  identityTokens: string[];
  ports: number[];
  startedAt: string;
  observedStartedAt?: string;
  logPath: string;
  readinessUrl?: string;
  sourceCommit?: string;
}
```

Records are written atomically and contain no environment values. Before reuse
or termination, `devctl` re-observes the PID, process start time, and command
identity.

Process status is one of:

- `absent`: no record exists;
- `running`: the record matches a live process;
- `stale`: the recorded process no longer exists;
- `foreign`: the PID exists but its identity does not match.

Stale records may be removed. Foreign processes are never stopped.

## 6. Diagnostic Result

```typescript
interface DiagnosticCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  requiredFor: string[];
  observed?: string;
  remediation?: string;
}

interface DiagnosticReport {
  schemaVersion: 1;
  platform: NodeJS.Platform;
  profile: string;
  checks: DiagnosticCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}
```

`doctor` checks only dependencies needed by the selected topology. Compose
requires Docker; local Station requires Go. Desktop also requires pnpm, Cargo,
Rust, and `protoc`.

## 7. Secret Handling

Keys containing `TOKEN`, `SECRET`, `PASSWORD`, `PRIVATE_KEY`, `API_KEY`, or
`CREDENTIAL` are redacted from user-facing configuration. Managed process
records store command identity and paths, never environment values.
