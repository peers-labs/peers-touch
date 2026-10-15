# Workflow Snapshot - Product State Model

> **Status**: active
> **Version**: v4.0
> **Updated**: 2026-10-14
> **Owner**: Platform Team

## Invocation

```text
requested -> reading -> emitted -> exited
                    \-> partial
                    \-> failed
```

There is no serving, refreshing, connected-client, or resident state.

## Workspace Projection

- `current`: canonical root and current Git source are readable.
- `partial`: source is readable but one or more optional tasks are corrupt.
- `unavailable`: the selected workspace cannot be read.

## Task Projection

- `current`: the atomic snapshot checksum is valid.
- `source-stale`: source changed and prior evidence was invalidated.
- `corrupt`: snapshot JSON or checksum is invalid; only this task is affected.
- `none`: no task was explicitly selected or stored.

## Durable Readback

Git facts are captured per invocation. Task snapshots remain task-local.
Registry, Profile, runtime, lease, and evidence owners retain their own stores.
Workflow Snapshot has no ticket, service identity, endpoint, lease, or cache
owner.
