# Chat Native Visible-Client Operations

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Acceptance Framework

## Purpose

This playbook defines the operational preconditions for Chat acceptance with
real native Desktop clients. Assertions without this setup are not product
evidence.

## Preconditions

1. Station deployment commit is recorded and contains all Station/proto changes.
2. Each client records commit and dirty workspace digest.
3. Generated proto digests match the Station source contract.
4. Each worktree has a distinct profile, gateway port, Vite port, storage root,
   and observer socket.
5. `PT_DESKTOP_E2E=true` is enabled and Vite HMR is disabled.
6. Native windows are visible and attached to responsive observers.
7. Fresh-storage and recovery-storage journeys are separate.

## Launch

Use `make station` and `make desktop`. Do not invoke lower-level scripts as the
acceptance entrypoint.

For every client, emit these bounded steps:

```text
process.start
ports.ready
observer.ready
station.selected
login.submitted
shell.ready
device.registered
bundle.published
conversation.open
sessions.ready
message.submitted
message.received
message.decrypted
receipt.delivered
receipt.read
```

Each step has its own timeout and diagnostic snapshot. Fixed sleeps are
forbidden.

## Interaction Contract

- Stable selectors are mandatory for Station selection, login, contacts,
  composer, send, messages, receipts, session state, and errors.
- The runner clears injected composer text in `finally` when submission fails.
- A successful click is not a successful send. The runner waits for a committed
  message ID and receiver plaintext.
- Exact plaintext must appear on the receiver; ciphertext placeholders fail.
- Startup order is randomized. Correctness must not depend on Bob or Alice
  starting first.

## Failure Evidence

On the first failed boundary, capture:

- both DOM snapshots;
- both Desktop logs from the last successful step;
- Station logs correlated by conversation, command, envelope, and device IDs;
- current device registry and bundle publication timestamps;
- session state keyed by both endpoint tuples;
- pending outbox and inbox rows;
- composer value and visible error.

Do not continue through later assertions after a prerequisite fails.

## Required Journeys

1. Fresh Alice and Bob, concurrent startup, bidirectional direct messages.
2. Bob second device, one message decrypted on both Bob devices.
3. Recipient offline and durable resume.
4. Sender and receiver restart.
5. Reinstall and recovery-phrase history restore.
6. Device revoke and no future delivery.
7. Three-device MLS group add, send, remove, restart, and recovery.

## Claim Rule

Chat is `DONE/PROVEN` only when all required journeys pass using visible native
clients and the deployed Station/source digests match. Structural checks,
browser-only runs, API calls, or manual screenshots cannot substitute for this
evidence.
