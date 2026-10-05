# Workflow Snapshot - Product Definition

> **Status**: active
> **Version**: v3.0
> **Created**: 2026-09-23 | **Updated**: 2026-10-04
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Product Thesis

Workflow Snapshot gives developers and Agents one bounded, machine-readable
view of worktrees, Plan mounts and runs, declarations, Sessions, active-work,
runtime leases, and environment health. It is an on-demand read-only command,
not a dashboard or resident application.

Product promise:

> One command returns the current redacted workflow state and exits without
> starting a service, opening a browser, reserving a port, or mutating an owner.

## 2. Capability Profile

| ID | Capability | Level | Value |
|---|---|---|---|
| WFS-C01 | Worktree discovery | required | Unregistered worktrees remain visible |
| WFS-C02 | Owner join | required | Mount, run, declaration, Session, active-work, and lease disagreements are explicit |
| WFS-C03 | Fresh Git observation | required | Branch, HEAD, dirty, and existence come from the current check |
| WFS-C04 | Separate work and environment state | required | Runtime health cannot rewrite Task lifecycle |
| WFS-C05 | Redaction | required | Canonical roots, credentials, raw profiles, logs, and product data are absent |
| WFS-C06 | Typed partial failure | required | One invalid workspace source does not erase other rows |
| WFS-C07 | One-shot lifecycle | required | The command writes JSON and exits with no listener or background process |

## 3. Journey

### WFS-J01: Inspect current workflow state

1. The caller runs `make workflow-snapshot`.
2. The command reads current owner stores and Git observations.
3. The result lists each discovered workspace with independent work state and
   environment health.
4. A mounted workspace identifies its `mountId`, `runId`, Plan Version,
   current Task, declaration, Session, and active-work consistency.
5. Stale or malformed sources are reported as typed issues and never inferred
   into authority.
6. The process exits after emitting one bounded JSON document.

## 4. Non-Goals

- Browser UI, HTTP/SSE server, fixed port, polling, or source-freshness service.
- Mutation of PlanMount, ExecutionRun, declaration, Session, active-work,
  registry, profile, or lease state.
- Worktree removal, profile allocation, environment creation, deploy, reset,
  or runtime start.
- Selection or rebinding of an Agent conversation, Plan, or worktree.
- Exposure of canonical roots, credentials, logs, product data, or Acceptance
  payloads.

## 5. Product Acceptance

- Snapshot worktree count and Git identities match the current discovery.
- Plan mount and run disagreements fail closed and remain visible.
- Work state and environment health are projected independently.
- Corrupt data for one workspace does not suppress valid workspaces.
- Output contains no canonical root or secret-bearing field.
- Invocation creates no listener, browser process, PID file, runtime lease, or
  machine-state mutation.
- No `apps/dev` server/web source, 4177 resource, `make dev-ui`, or browser Gate
  remains.
