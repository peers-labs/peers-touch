# Developer Toolchain - Architecture Design

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-12 | **Updated**: 2026-09-18
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

---

## 1. Core Principles

1. **One control plane**: lifecycle semantics live in `devctl`; wrappers only
   translate invocation syntax.
2. **Explicit configuration**: the selected profile is the only source for
   ports, Station mode, runtime identity, and tool overrides.
3. **Owned processes only**: stop and restart operations act only on processes
   whose recorded identity still matches the live process.
4. **Fail closed**: missing profiles, invalid values, occupied ports, missing
   tools, and unsupported modes return typed non-zero failures before mutation.
5. **Evidence over assumptions**: status and doctor report observed process,
   port, dependency, and health state.
6. **One worktree, one active plan**: a tracked worktree has exactly one active
   formal execution plan; every runtime projection validates that plan instead
   of creating another workflow state.
7. **Plan-bound verification**: Acceptance execution is selected from the
   current closure in the formal plan. Diff-based impact analysis detects plan
   drift but never silently expands execution.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Make is not a Windows compatibility layer in the current tree | `verified_fact` | Root `Makefile` fixes `SHELL := /bin/bash`; `gmake config` fails without `sh.exe` | high | none |
| Daily local-development ownership is Bash-based | `verified_fact` | `tooling/make/local-dev.mk` and `tooling/scripts/local-dev/*.sh` | high | none |
| Package checks are not shell-neutral | `verified_fact` | `apps/desktop/package.json` directly executes two `.sh` files | high | none |
| Tauri development builds applets twice | `verified_fact` | `pretauri:dev` and `beforeDevCommand -> pnpm dev -> predev` | high | none |
| Windows build support is not a complete lifecycle | `verified_fact` | `tooling/scripts/windows-desktop-build.ps1` has no profile/status/stop/restart contract | high | none |
| A Node control plane can provide the required OS adapters without a new runtime dependency | `proposal` | Node is already required by the pnpm workspace and exposes filesystem, child-process, crypto, and networking APIs | high | Windows and Unix lifecycle gates |

## 3. Scope And Non-Scope

### In Scope

- Profile list, initialization, activation, resolution, and redacted display.
- Dependency and environment diagnostics.
- Local Station health, start, status, stop, and restart.
- Desktop App and Desktop Web start, status, stop, and restart.
- Cross-platform source checks currently implemented in shell.
- Make, package, and PowerShell adapters over the same command contract.
- Structured runtime metadata and bounded cleanup.
- Windows and Unix CI smoke coverage.
- Worktree-bound execution-plan discovery and Acceptance scheduling.
- Plan-completion and explicitly requested full/release verification.

### Non-Scope

- Changing Station, Desktop, Relay, or Mobile business semantics.
- Replacing the remote deployment implementation in the first closure.
- Changing Acceptance Station profile injection or Runtime Cell ownership.
- Packaging, signing, installers, or release automation.
- Adding a second profile or process source of truth.
- Adding an Acceptance-specific task, iteration, or lifecycle state machine.

## 4. System Architecture

```text
Developer / CI
      |
      +-- node tooling/devctl/index.mjs ...
      +-- make <target> --------------------+
      +-- tooling/dev.ps1 ------------------+
      +-- package scripts ------------------+
                                           |
                                           v
                              +-------------------------+
                              | devctl command router   |
                              +-----------+-------------+
                                          |
                   +----------------------+----------------------+
                   |                      |                      |
                   v                      v                      v
          profile/config owner    lifecycle coordinator    doctor/check owner
                   |                      |                      |
                   v                      v                      v
       .local/dev/profiles     OS process + port adapter   deterministic checks
       .local/dev/active       runtime state records       structured results
                   |                      |
                   +----------+-----------+
                              v
              Station / desktop-rust / Vite / desktop-app
```

`devctl` is a control plane. It does not become a product runtime and does not
own Station or Desktop data.

The development workflow uses the existing formal plan as its only task-state
owner:

```text
verified worktree
  -> one active formal execution plan
  -> one current closure from its Implementation Status table
  -> closure Acceptance declaration
  -> Acceptance runner
```

`active_work`, Context Anchor, Goal queues, and Acceptance impact artifacts are
indexes or projections. None may redefine plan scope, progress, or Gate timing.

## 5. Sources Of Truth And Ownership

| Concern | Source of truth | Mutation owner |
|---|---|---|
| Profile definition | canonical env repository when present; otherwise `.local/dev/profiles/<name>.env` | `devctl profile` |
| Active profile | `.local/dev/active/<worktree>.env` | `devctl profile activate` |
| Runtime configuration | resolved active profile | `devctl` command invocation |
| Managed process identity | `.local/dev/state/<profile>/<service>.json` | lifecycle coordinator |
| Runtime health | live health endpoint and listening port | status/doctor probes |
| Product data | Station/Desktop storage roots | product runtimes, never `devctl` |
| Work scope and progress | formal execution plan | planning/execution stage owner |
| Plan lookup | immutable workspace Plan binding, or explicit CI input | Development Workflow binding |
| Acceptance timing | plan Acceptance Execution contract | planning stage owner |
| Diff impact | generated Acceptance projection | Acceptance planner |

The runtime-state record is evidence of ownership, not proof of liveness.
Liveness is always re-observed.

## 5.1 Plan-Bound Acceptance

Every tracked plan declares its worktree identity and one machine-readable
Acceptance Execution contract. The contract maps closure IDs to Gate IDs and
defines plan-completion and explicit full/release Gate sets.

The runner:

1. resolves the verified workspace's immutable Plan binding directly;
2. reads the current closure from the existing Implementation Status table;
3. validates actual changed paths against the registry-derived impact
   projection;
4. rejects undeclared impact with `ACCEPTANCE_PLAN_DRIFT`;
5. prints the selected Gates, environments, and timeout budget;
6. executes only the current closure unless completion or full execution was
   explicitly requested.

No tier, environment availability, latest evidence pointer, or Agent inference
may broaden the selected execution set.

## 6. Command Contract

```text
devctl profile list
devctl profile init <name> [--slot <n>]
devctl profile activate <name>
devctl config [--json]
devctl doctor [--json]
devctl station start|check|status|stop|restart
devctl desktop start [--mode app|web] [--foreground]
devctl desktop status|stop|restart [--mode app|web]
devctl status [--json]
devctl stop [station|desktop|all]
devctl restart [station|desktop|all]
devctl check [desktop|all]
```

Commands return `0` only when their stated postcondition holds. JSON mode
writes one machine-readable document to stdout; diagnostics go to stderr.

## 7. Runtime And Lifecycle Semantics

### 7.1 Profile Resolution

Resolution order remains:

1. explicit `PT_DEV_PROFILE_FILE`;
2. worktree-specific active profile pointer;
3. canonical sibling env repository source for the selected profile;
4. local profile cache when no canonical source exists.

The selected filename and declared `PT_DEV_PROFILE` must match.

### 7.2 Start

1. Resolve and validate the profile.
2. Run dependency and port preflight.
3. Reuse a healthy, identity-matching process.
4. Reject an occupied port owned by an unknown process.
5. Spawn one process group with explicit environment and log files.
6. Persist runtime identity atomically.
7. Wait for the declared readiness condition with a bounded timeout.
8. On failure, stop only the newly created process group and retain logs.

### 7.3 Stop

1. Read the runtime-state record.
2. Re-observe PID and command identity.
3. Refuse to kill a mismatched or unowned process.
4. Terminate the owned process tree with a bounded graceful period.
5. Escalate to force termination only after timeout.
6. Remove state only after the process is gone.

On Windows, the adapter owns process-tree termination. A later implementation
may replace the initial process-tree adapter with a Job Object without changing
the command contract.

### 7.4 Desktop Composition

App mode starts one Vite renderer and one windowed Tauri process. Web mode
starts one Vite renderer and one rendererless Tauri process. Both use separate
profiles, storage roots, gateway ports, and web ports while sharing the selected
Station.

Applet assets are built once before the two Desktop processes start. Tauri's
internal `beforeDevCommand` is disabled only for the externally coordinated
development invocation.

## 8. Allowed And Forbidden Relationships

Allowed:

- wrappers invoke `devctl`;
- `devctl` reads profile files and starts toolchain processes;
- lifecycle adapters use OS APIs or bounded platform commands;
- legacy shell entrypoints invoke `devctl` during migration.

Forbidden:

- Make, PowerShell, shell, and package scripts each implementing lifecycle
  semantics independently;
- killing a process solely because it owns a configured port;
- falling back to a default profile when no profile is selected;
- embedding machine names or Station profiles in command definitions;
- changing Acceptance runtime profile injection;
- requiring Git Bash for a Windows-native command path.
- a missing/mismatched Plan binding or any Plan rebind attempt;
- an Acceptance artifact acting as a second execution plan;
- default execution of completion, environment, nightly, or release Gates;
- running full/release Acceptance without an explicit user request;
- merging a tracked worktree while its formal plan remains active.

## 9. Failure Contract

Stable CLI error codes:

| Code | Meaning |
|---|---|
| `DEVCTL_PROFILE_REQUIRED` | No explicit or active profile can be resolved |
| `DEVCTL_PROFILE_INVALID` | Profile syntax or identity is invalid |
| `DEVCTL_DEPENDENCY_MISSING` | Required executable or SDK is unavailable |
| `DEVCTL_PORT_CONFLICT` | A required port is owned by an unmanaged process |
| `DEVCTL_PROCESS_IDENTITY_MISMATCH` | Recorded PID no longer belongs to the managed command |
| `DEVCTL_START_TIMEOUT` | Runtime did not become ready before the deadline |
| `DEVCTL_UNSUPPORTED_MODE` | The selected operation is not implemented for the profile mode/platform |
| `DEVCTL_CHECK_FAILED` | A deterministic source check failed |
| `WORKSPACE_PLAN_BINDING_REQUIRED` | The local workspace has no immutable Plan binding |
| `WORKSPACE_PLAN_BINDING_MISMATCH` | The bound Plan identity/path/workspace does not match |
| `WORKSPACE_PLAN_REBIND_DENIED` | A different Plan attempted to replace the immutable binding |
| `WORKSPACE_PLAN_DECLARATION_REQUIRED` | A Plan-bound workspace attempted untracked mutation |
| `EXECUTION_PLAN_INPUT_REQUIRED` | CI omitted its explicit Plan input |
| `EXECUTION_PLAN_INVALID` | Plan metadata, status, or Acceptance contract is malformed |
| `EXECUTION_PLAN_COMPLETE` | Plain run requested after all closures completed |
| `ACCEPTANCE_PLAN_DRIFT` | Actual diff implies an undeclared Acceptance Gate |

Errors include operation and relevant profile/service context, but never secret
values.

## 10. Quality Gates

- Unit tests cover env parsing, profile identity, path normalization, state
  validation, process ownership, and command routing.
- Windows smoke proves `profile`, `config`, `doctor`, `check`, and a bounded
  Desktop start/status/stop lifecycle without Bash.
- Unix smoke proves wrappers resolve to the same command contract.
- Tree scan rejects direct `.sh` execution from cross-platform package scripts.
- Tree scan rejects lifecycle logic reappearing in Make or PowerShell wrappers.
- Desktop checks, typecheck, tests, and build pass.
- No Acceptance Gate or provisioner gains a hardcoded Station profile.
