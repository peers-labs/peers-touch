# Developer Toolchain - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-12 | **Updated**: 2026-09-12
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

---

## 1. Profile Model

Profiles remain line-oriented env files containing declarative assignments:

```text
KEY=value
KEY="value with spaces"
KEY='literal value'
```

Blank lines and full-line comments are ignored. Variable expansion, command
substitution, shell functions, redirection, and executable statements are
invalid. The parser strips one matching quote pair and otherwise preserves the
value.

Required fields:

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
  PT_DESKTOP_WEB_GATEWAY_PORT: string;
  PT_DESKTOP_WEB_WEB_PORT: string;
}
```

Mode-specific fields are validated only when that mode is selected.
Unknown fields are passed to child processes so existing profile extensions
remain usable.

## 2. Active Profile Reference

```typescript
interface ActiveProfileReference {
  worktreeId: string;
  profileName: string;
  activePath: string;
  resolvedPath: string;
  canonical: boolean;
}
```

The active reference is worktree-specific. The file name and
`PT_DEV_PROFILE` value must match before any runtime mutation.

## 3. Runtime State Record

```typescript
type ManagedService =
  | "station"
  | "desktop-app-vite"
  | "desktop-app-tauri"
  | "desktop-web-vite"
  | "desktop-web-tauri";

interface RuntimeStateRecord {
  schemaVersion: 1;
  service: ManagedService;
  profile: string;
  worktreeId: string;
  pid: number;
  processGroupId?: number;
  command: string;
  args: string[];
  commandFingerprint: string;
  identityTokens: string[];
  ports: number[];
  startedAt: string;
  observedStartedAt?: string;
  logPath: string;
  readinessUrl?: string;
}
```

The record contains no secrets and is written atomically through a temporary
file plus rename.

## 4. Runtime State Machine

```text
ABSENT
  | start + preflight pass
  v
STARTING -- readiness pass --> READY
  |                             |
  | process exit / timeout      | stop
  v                             v
FAILED <-------------------- STOPPING
  |                             |
  +--------- cleanup ----------> ABSENT

record exists + PID missing       -> STALE -> ABSENT
record exists + identity mismatch -> FOREIGN (fail closed)
port occupied + no valid record   -> FOREIGN (fail closed)
```

`FOREIGN` is never auto-killed.

## 5. Diagnostic Result

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
  profile?: string;
  checks: DiagnosticCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}
```

Optional native accelerators may report `warn`; a missing dependency required
for the requested command reports `fail`.

## 6. Secret Handling

Keys matching `TOKEN`, `SECRET`, `PASSWORD`, `PRIVATE_KEY`, `API_KEY`, or
credential-like suffixes are redacted from config and diagnostic output.
Runtime state records never persist environment values.
