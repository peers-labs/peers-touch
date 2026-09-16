# Cross-Platform Devctl - Execution Plan

> **Status**: active, approved for execution
> **Version**: v1.0
> **Created**: 2026-09-12 | **Updated**: 2026-09-12
> **Owner**: Developer Infrastructure
> **Branch**: `fix/windows-native-chat-closure`
> **Architecture**: [../design.md](../design.md)
> **Decisions**: DTC-D01 through DTC-D06

---

## 1. Goal

Deliver one cross-platform local-development control plane that runs natively
on Windows, macOS, and Linux, while preserving profile isolation, Desktop
runtime topology, Station health closure, and Acceptance runtime injection.

The first complete claim is:

> A developer can select a profile, diagnose dependencies, run deterministic
> checks, and start/status/stop a local Station plus Desktop App or Web stack on
> Windows without Bash. Unix entrypoints use the same command implementation.

## 2. Scope And Non-Scope

### In Scope

- `devctl` profile, config, doctor, check, status, stop, restart, local Station,
  and Desktop App/Web commands.
- Structured process state and platform adapters.
- Thin Make, PowerShell, shell, and package entrypoints.
- Desktop check migration and duplicate applet-build removal.
- Windows and Unix automated coverage.
- Documentation and obsolete-path deletion.

### Non-Scope

- Native Windows remote deployment.
- Product, protocol, Station domain, or Desktop UI changes.
- Acceptance profile or runtime-cell redesign.
- Relay and Mobile lifecycle migration.
- Release packaging and signing.

## 3. Architecture Traceability

| Plan requirement | Architecture source | Decision/invariant | Required evidence |
|---|---|---|---|
| One command implementation | `design.md` sections 1, 4, 8 | DTC-D01, DTC-D02 | wrapper policy scan |
| Existing profile truth retained | `design.md` sections 5, 7.1 | DTC-D03 | profile parity tests |
| Owned process cleanup | `design.md` sections 7.2, 7.3 | DTC-D04 | stale/foreign PID tests |
| No permanent parallel lifecycle | `integration.md` sections 3, 5 | DTC-D05 | tracked reference scan |
| Remote behavior does not drift | `integration.md` section 4 | DTC-D06 | unsupported-mode test |
| Acceptance injection unchanged | `design.md` sections 3, 8 | existing Acceptance contract | targeted Acceptance static tests |

## 4. Current-State Inventory

| Responsibility | Current assets | Observed gap |
|---|---|---|
| Profile | `tooling/scripts/local-dev/{profile,env,config}.sh` | Bash parsing and symlink operations |
| Station lifecycle | `station-dev.sh`, `station-check.sh`, `stop.sh`, `restart.sh` | Unix commands plus partial Git Bash branches |
| Desktop lifecycle | `desktop-dev.sh`, `dev-desktop-*.sh`, `_ensure-desktop-*.sh` | Bash process/port ownership and inline JSON quoting |
| Entry surface | `Makefile`, `tooling/make/local-dev.mk` | `/bin/bash` is hardcoded |
| Desktop checks | two `.sh` checks called from `apps/desktop/package.json` | default Windows shell fails |
| Tauri hooks | Desktop package hooks plus `tauri.conf.json` hooks | applets build twice |
| Windows support | `windows-desktop-build.ps1` | build/Acceptance only, no daily lifecycle |
| Tests | shell static tests and selected Python tests | assert implementation details rather than shared CLI contract |

## 5. Execution Closures

### C1: Profile And Diagnostic Foundation

**Dependencies**: none.

**Deliverables**:

- `tooling/devctl/{index,errors,profile,doctor}.mjs`.
- Profile parser and active-profile resolver.
- `profile list/init/activate`, `config`, and `doctor`.
- `tooling/dev.ps1` thin wrapper.
- Unit and CLI tests.

**Failure behavior**:

- Invalid syntax, profile mismatch, missing active profile, and unavailable
  required dependencies fail before runtime mutation.
- Config output redacts secrets.

**Gates**:

```text
node --test tooling/devctl/test/profile.test.mjs tooling/devctl/test/cli.test.mjs
node tooling/devctl/index.mjs config --json
node tooling/devctl/index.mjs doctor --json
powershell -File tooling/dev.ps1 config --json
```

### C2: Cross-Platform Source Checks And Hook Repair

**Dependencies**: C1 command/error foundation.

**Deliverables**:

- Node implementations for social wire and runtime-boundary checks.
- Package callers switched atomically.
- Obsolete check shell scripts deleted.
- Desktop Tauri hooks changed so applets build once.

**Failure behavior**:

- Every violation reports file, line, rule, and `DEVCTL_CHECK_FAILED`.
- Missing scan roots fail; they do not silently pass.

**Gates**:

```text
node --test tooling/devctl/test/checks.test.mjs
pnpm --dir apps/desktop run check
pnpm --dir apps/desktop run test
pnpm --dir apps/desktop run build
```

### C3: Runtime State And Process Adapters

**Dependencies**: C1 profile contract.

**Deliverables**:

- Atomic runtime-state store.
- Windows and Unix process inspection, spawn, tree termination, and port probes.
- Ownership, stale-state, foreign-process, timeout, and cleanup tests.

**Failure behavior**:

- Foreign or PID-reused processes are never killed.
- Failed start cleans only the process group created by that invocation.

**Gates**:

```text
node --test tooling/devctl/test/runtime-state.test.mjs
node --test tooling/devctl/test/process-adapter.test.mjs
```

### C4: Local Station Lifecycle

**Dependencies**: C1 and C3.

**Deliverables**:

- Native local Station build, config projection, start, health, status, stop,
  and restart.
- Compose adapter with explicit Docker diagnostics.
- Remote mode explicit legacy bridge or typed unsupported result by platform.
- Existing shell paths reduced to forwarding adapters where still consumed.

**Failure behavior**:

- Unknown port ownership and failed readiness are bounded and fail closed.
- Storage and database files are retained across normal restart.

**Gates**:

```text
node tooling/devctl/index.mjs station check
node tooling/devctl/index.mjs station restart
node tooling/devctl/index.mjs station status --json
node tooling/devctl/index.mjs station stop
```

Run against a disposable local profile; do not reset sixwin product data.

### C5: Desktop App And Web Lifecycle

**Dependencies**: C2, C3, and C4.

**Deliverables**:

- One-time applet preparation.
- Vite and Tauri launch with file-based config override.
- App/Web isolation, health checks, logs, status, stop, and restart.
- Make and package entrypoints switched to `devctl`.

**Failure behavior**:

- Station unavailability, port conflicts, child exit, and startup timeout
  preserve logs and clean only newly owned processes.
- Inline shell JSON is not used.

**Gates**:

```text
node tooling/devctl/index.mjs desktop start --mode app
node tooling/devctl/index.mjs desktop status --mode app --json
node tooling/devctl/index.mjs desktop stop --mode app
node tooling/devctl/index.mjs desktop start --mode web
node tooling/devctl/index.mjs desktop stop --mode web
```

Windows evidence includes a responding native `Peers` window and healthy
Station, Gateway, and Vite endpoints.

### C6: Consumer Cutover, CI, And Deletion

**Dependencies**: C1 through C5.

**Deliverables**:

- `tooling/make/local-dev.mk` reduced to forwarding recipes.
- Local-development docs, Desktop runtime docs, skill, and playbook updated.
- Windows and Unix CI smoke jobs.
- Obsolete lifecycle logic removed after consumer scan.

**Failure behavior**:

- CI fails when Bash is required by a Windows-native command.
- CI fails when wrapper lifecycle policy or direct cross-platform `.sh`
  package execution reappears.

**Gates**:

```text
rg -n "/bin/bash|lsof|pkill|pgrep|mktemp" Makefile tooling/make/local-dev.mk tooling/dev.ps1
rg -n "\"[^\"]+\": \"[^\"]*\\.sh" package.json apps/*/package.json packages/*/package.json
node --test tooling/devctl/test/*.test.mjs
git diff --check
```

## 6. Dependency DAG And Concurrency

```text
C1 profile/doctor
  +--> C2 checks/hooks --------+
  +--> C3 process substrate ---+--> C5 Desktop lifecycle
                |              |
                +--> C4 Station+
                               |
                               +--> C6 cutover/CI/deletion
```

C2 and C3 may be implemented in parallel only with exclusive write sets.
C4 and C5 share runtime ports and execute serially on one host. C6 and final
runtime evidence are integrator-owned.

### Current Concurrency Decision

Execution is serial under one integrator. C1 defines interfaces consumed by C2
and C3, no subagent execution was authorized, and C4/C5 share the sixwin
runtime and ports. The integrator exclusively owns plan state, shared
entrypoints, runtime processes, generated artifacts, reconciliation, and final
gates.

## 7. End-To-End Lifecycle Mapping

| Lifecycle step | Owner closure |
|---|---|
| Select and validate profile | C1 |
| Diagnose tools, SDKs, paths, and ports | C1 |
| Run repository checks | C2 |
| Create and validate runtime ownership | C3 |
| Start and health-check Station | C4 |
| Build applets once | C2/C5 |
| Start Vite and Tauri | C5 |
| Observe status | C3/C4/C5 |
| Stop/restart owned process trees | C3/C4/C5 |
| Reject foreign processes and unsupported modes | C3/C4/C5 |
| Prove wrapper parity and remove old owners | C6 |

No authentication or account-session transition is owned by this plan.

## 8. Acceptance Scenarios

### AS-01: Select A Windows Profile

- **Precondition**: canonical `sixwin` profile exists.
- **Action**: developer activates `sixwin` through `dev.ps1`.
- **Expected**: config resolves the same profile and displays redacted values.
- **Failure variant**: filename/declared identity mismatch fails with
  `DEVCTL_PROFILE_INVALID`.
- **Evidence**: CLI transcript and profile unit test.
- **Status**: passed on sixwin.

### AS-02: Diagnose A Windows Workstation

- **Precondition**: active local profile.
- **Action**: developer runs `devctl doctor`.
- **Expected**: required tools, SDKs, ports, and optional degradations are
  classified as pass/warn/fail.
- **Failure variant**: a required tool removed from `PATH` produces a non-zero
  result with remediation.
- **Evidence**: JSON reports from success and controlled-failure fixtures.
- **Status**: passed: 11 pass, 1 optional warning, 0 fail.

### AS-03: Run Desktop Checks Without Bash

- **Precondition**: workspace dependencies installed.
- **Action**: developer runs `pnpm --dir apps/desktop run check` from
  PowerShell with no script-shell override.
- **Expected**: social contract checks and TypeScript validation complete.
- **Failure variant**: a fixture containing a forbidden pattern reports its
  exact file and line.
- **Evidence**: command transcript and Node check tests.
- **Status**: passed in default PowerShell for Desktop and Mobile.

### AS-04: Start And Stop A Local Station

- **Precondition**: disposable local profile and free declared port.
- **Action**: developer starts Station, checks status, restarts it, then stops.
- **Expected**: health passes, PID changes on restart, data remains, and final
  port/state are released.
- **Failure variant**: an unmanaged listener on the port causes
  `DEVCTL_PORT_CONFLICT` and is not terminated.
- **Evidence**: health responses, state records, process observations, and
  retained database hash.
- **Status**: passed with disposable `devctl-smoke`; retained SQLite hashes matched.

### AS-05: Start And Stop Desktop App

- **Precondition**: healthy local Station and free App ports.
- **Action**: developer starts App mode from PowerShell.
- **Expected**: one Vite process and one responding `Peers` native window start;
  Gateway and Vite are healthy; applets build once.
- **Failure variant**: Vite or Tauri startup timeout removes only processes
  created by the command and retains logs.
- **Evidence**: process state, endpoint probes, build log count, window
  observation, and final cleanup.
- **Status**: passed for App and Web; App window was responding and cleanup was complete.

### AS-06: Reject Foreign Process Ownership

- **Precondition**: an unrelated process occupies a configured port or a state
  record references a reused PID.
- **Action**: developer runs start or stop.
- **Expected**: command fails closed and leaves the unrelated process alive.
- **Failure variant**: none; termination is an automatic failure.
- **Evidence**: deterministic process-adapter integration test.
- **Status**: passed by deterministic process-adapter integration test.

### AS-07: Preserve Unix Entry Semantics

- **Precondition**: Unix CI runner with an active disposable profile.
- **Action**: developer invokes matching Make and direct `devctl` commands.
- **Expected**: both reach the same command contract and return equivalent
  status and exit codes.
- **Failure variant**: wrapper policy scan detects duplicated lifecycle logic.
- **Evidence**: Unix CI transcript and wrapper scan.
- **Status**: CI workflow implemented; Ubuntu execution awaits the next push.

## 9. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| PID reuse kills unrelated work | command identity verification plus foreign-state failure |
| Windows wrapper PID exits before child | launch direct executables where possible and persist observed runtime PID |
| Process trees leak | bounded tree termination; Windows adapter prepared for Job Object replacement |
| Existing profiles use shell syntax | strict parser fixtures and explicit migration errors |
| Runtime data is damaged by tests | disposable profiles and retained-data hash gate |
| Remote behavior changes accidentally | DTC-D06 bridge and unsupported-mode tests |
| Acceptance behavior drifts | targeted static tests and no edits to runtime profile injection |
| Legacy paths become permanent | deletion matrix and final tracked-reference gate |

## 10. Final Readiness Gate

The plan is complete only when:

1. all seven acceptance scenarios have evidence and pass;
2. Windows daily development requires neither Bash nor GNU Make;
3. Unix wrappers invoke the same control plane;
4. local Station and Desktop lifecycle leave no owned processes or ports;
5. Desktop check, test, build, and native smoke pass;
6. process-ownership negative tests prove foreign processes survive;
7. legacy lifecycle owners are deleted or are demonstrably thin wrappers;
8. documentation and CI describe only the new source of truth.

## 11. Non-Claims

Completion does not prove native Windows remote deployment, Relay lifecycle,
Mobile iOS lifecycle, release packaging, or product behavior beyond the
Desktop development smoke.

## 12. Implementation Status

| Closure | Status | Evidence |
|---|---|---|
| C1 Profile and diagnostics | completed | Profile/CLI tests; sixwin config and doctor reports |
| C2 Checks and hooks | completed | Desktop/Mobile checks run natively; obsolete shell checks deleted |
| C3 Process adapters | completed | Runtime-state/process tests, including foreign PID refusal |
| C4 Local Station | completed | Disposable profile start/restart/stop and retained SQLite hash |
| C5 Desktop App/Web | completed | App and Web dual-health lifecycle; responding native `Peers` window |
| C6 Cutover, CI, deletion | in progress | Local gates pass; Ubuntu/Windows CI workflow awaits first remote run |
