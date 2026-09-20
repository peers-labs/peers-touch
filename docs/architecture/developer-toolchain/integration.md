# Developer Toolchain - Integration And Migration

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-12 | **Updated**: 2026-09-18
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

---

## 1. Existing-System Mapping

| Current owner | Target owner | Migration treatment |
|---|---|---|
| `tooling/scripts/local-dev/profile.sh` and `env.sh` | `tooling/devctl/profile.mjs` | Replaced for daily use; legacy scripts have no Make/package consumer |
| `tooling/scripts/local-dev/station-*.sh` | `tooling/devctl/station.mjs` | Local lifecycle replaced; legacy log/remote paths retained |
| `tooling/scripts/local-dev/desktop-dev.sh` and `_ensure-desktop-*.sh` | `tooling/devctl/desktop.mjs` | Replaced for daily App/Web lifecycle |
| `tooling/scripts/local-dev/status.sh`, `stop.sh`, `restart.sh` | `tooling/devctl/runtime-state.mjs` plus command modules | Replaced for managed Station/Desktop processes |
| `tooling/make/local-dev.mk` | thin `devctl` forwarding recipes | Completed for in-scope commands |
| Desktop/Mobile social shell checks | `tooling/devctl/checks.mjs` | Deleted after package cutover |
| Frontend runtime registry shell check | `tooling/scripts/check-frontend-runtime-registry.mjs` | Replaced and consumers migrated |
| `apps/desktop` lifecycle hooks | one applet build per command | Duplicate hooks removed |
| `tooling/scripts/windows-desktop-build.ps1` | build/Acceptance owner | Retain; it is not the daily lifecycle owner |
| Acceptance latest-plan default | active formal plan plus current closure | Replace ambiguous latest-artifact execution |
| `.pt-dev-workflow/<session>/status.json` schema | formal plan plus `active_work` index | Delete unused duplicate workflow state |

## 2. Impact Surface

### Direct Consumers

- Root `Makefile` help and local-development targets.
- Root and Desktop `package.json` scripts.
- Developer documentation and local-environment skill.
- Desktop debug playbook.
- Acceptance fixtures that currently call local-dev shell paths.
- Static Acceptance tests that assert shell implementation details.

### Preserved Contracts

- Worktree-specific active profile selection.
- Canonical env-repository precedence.
- Profile identity mismatch rejection.
- Station health as the start postcondition.
- App/Web process and storage isolation.
- Acceptance runtime-time Station profile injection.
- Existing Station and Desktop runtime architecture.

## 3. Migration Strategy

### Profile And Diagnostics Cutover

Implement profile resolution and doctor first. Cut Make, PowerShell, and package
entrypoints together. Keep active profile paths unchanged.

### Deterministic Check Cutover

Port shell checks to Node, switch all package callers, run parity fixtures, then
delete the old check scripts.

### Local Runtime Cutover

Implement runtime-state and process adapters before Station or Desktop start.
Migrate local Station first, then Desktop composition. Each command family
switches all wrappers and tests in one change.

### Legacy Shell Removal

Search all tracked files for legacy script paths. Delete a script only after
all product, test, documentation, and Acceptance consumers have moved. A shell
wrapper may remain temporarily when an external documented path still exists,
but it must only `exec node ...`.

### Plan-Bound Acceptance Cutover

Add worktree metadata and an Acceptance Execution contract to the existing
formal plan. The Acceptance runner resolves that plan, validates its current
closure, reconciles registry impact, and executes only declared closure Gates.
The existing Evidence Store continues to persist projections and results but
does not select the active work.

## 4. Compatibility Boundary

The command contract is stable across platforms. Implementation support may be
mode-specific:

| Capability | Windows | macOS/Linux |
|---|---|---|
| profile/config/doctor/check | native | native |
| local Station | native | native |
| Desktop App/Web | native | native |
| compose Station | Docker CLI adapter | Docker CLI adapter |
| remote deploy | fail closed in first closure | explicit legacy bridge |
| Mobile iOS | unsupported | existing owner until separate migration |

Unsupported behavior returns `DEVCTL_UNSUPPORTED_MODE`; it never falls back to
another Station or profile.

## 5. Atomic Cutover Matrix

| Concern | Cutover condition | Old path to remove | Deletion proof |
|---|---|---|---|
| Profile/config | CLI tests and Windows profile smoke pass | profile/config shell logic | tree search has only forwarding references |
| Desktop checks | Node fixtures and Desktop check pass | two shell check scripts | no package script executes `.sh` |
| Local Station | start/check/status/stop smoke passes on Windows and Unix | local branch of station shell scripts | lifecycle tests plus reference scan |
| Desktop lifecycle | App/Web composition and cleanup smoke pass | desktop and ensure shell logic | no duplicate lifecycle owner remains |
| Make entrypoint | all mapped targets call `devctl` | local-dev shell recipes | Makefile policy scan passes |
| Acceptance execution | immutable workspace Plan and current closure resolve directly | branch scan or latest Acceptance artifact as implicit execution owner | plan-binding and drift tests pass |
| Workflow state | formal plan plus `active_work` index | `.pt-dev-workflow` session schema | no live consumer reference remains |

## 6. Documentation Updates

- `docs/global/local-dev-environment.md` becomes the user-facing command
  reference for `devctl`.
- `docs/architecture/runtime/desktop-runtime-architecture.md` references
  `devctl desktop`, while preserving its four-runtime-unit contract.
- `docs/knowledge/playbooks/desktop-debug-runtime.md` changes its invocation
  language only after Make forwards to `devctl`.
- `tooling/skills/pt-local-dev-env/SKILL.md` migrates to the new command
  contract in the same profile cutover.
