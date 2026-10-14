# Workflow Snapshot - Product Definition

> **Status**: active
> **Version**: v4.0
> **Updated**: 2026-10-13
> **Owner**: Platform Team

## Product Thesis

Workflow Snapshot gives developers and Agents one bounded, machine-readable
view of current Git source and optional task-local recovery state. It is an
on-demand read-only command, not a dashboard, resident application, or
workflow authority.

> One command returns current facts and exits without selecting a task,
> starting a service, opening a browser, reserving a port, or mutating state.

## Capability Profile

- Fresh canonical root, workspace ID, branch, HEAD, and dirty state.
- Explicit task-local projections only; no implicit current task.
- Corrupt task and unavailable workspace isolation.
- Optional runtime status attachment without permission inference.
- One-shot JSON lifecycle with no listener or background process.

## Journey

1. The caller runs `make workflow-snapshot`.
2. The command reads the requested canonical root and current Git source.
3. It lists task-local records under `.dev-workflow/tasks/`.
4. Missing or malformed data becomes a typed local finding.
5. The process emits one JSON document and exits.

## Non-Goals

- Browser UI, server, polling, or refresh service.
- Selecting or advancing a Plan/task.
- Mutation of task, registry, Profile, runtime, lease, or evidence state.
- Runtime authorization, completion judgment, or formal proof.

## Product Acceptance

- Current Git identity matches the selected root.
- One corrupt task does not suppress valid tasks.
- One unavailable workspace does not suppress valid workspace rows.
- Invocation creates no listener, browser process, PID file, runtime lease, or
  workflow mutation.
