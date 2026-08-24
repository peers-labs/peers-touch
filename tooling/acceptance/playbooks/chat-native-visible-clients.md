# Chat Native Visible-Client Operations

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-17
> **Owner**: Acceptance Framework

## Purpose

This playbook defines the operational preconditions for Chat acceptance with
real native Desktop clients. Assertions without this setup are not product
evidence.

## Preconditions

1. Station deployment commit is recorded and contains all Station/proto changes.
2. Each client records commit and dirty workspace digest.
3. Generated proto digests match the Station source contract.
4. Each worktree has a distinct profile, gateway port, Vite port, WebDriver
   port, and storage root.
5. `PT_DESKTOP_E2E=true` is enabled and Vite HMR is disabled.
6. Native windows are visible and attached to responsive observers.
7. Fresh-storage and recovery-storage journeys are separate.
8. Runtime Manifest, Station Attestation, and Actor Manifest share one run ID.

## Launch

Activate an approved disposable profile and use the stable Acceptance target:

```bash
make profile PROFILE=<approved-disposable-profile>
make station-check

CHAT_ACCEPTANCE_RESET=1 \
CHAT_NATIVE_DEMO_PASSWORD="$CHAT_NATIVE_DEMO_PASSWORD" \
make acceptance-chat-native-two-client
```

Do not export Station URLs, attestation paths, PTIDs, ports, profiles, or
storage roots. The Environment Provisioner derives them and writes an immutable
Runtime Manifest. The Gate receives only `PT_ACCEPTANCE_RUNTIME_MANIFEST` plus
the credential value resolved from its declared reference.

Provisioning must stop before Fixture reset or client launch when:

- profile filename and `PT_DEV_PROFILE` differ;
- Station is unreachable;
- live/deployed/client commit or proto digest differs;
- deployment workspace is dirty;
- reset authorization is absent;
- the credential reference is unresolved;
- canonical actor PTIDs cannot be produced.

These are `BLOCKED/UNPROVEN` environment outcomes, not product Gate failures.

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
- Native activation predicate snapshots when focus acquisition fails, including
  expected process ID, actual frontmost process ID, `document.hasFocus()`,
  Accessibility main/focused-window state, sampled point, point ownership, and
  the ordered window stack at that point;
- Station logs correlated by conversation, command, envelope, and device IDs;
- current device registry and bundle publication timestamps;
- session state keyed by both endpoint tuples;
- pending outbox and inbox rows;
- composer value and visible error.

Do not continue through later assertions after a prerequisite fails.
Native activation failures must emit these fields into immutable Gate evidence;
an unstructured `TimeoutException` is insufficient for diagnosis or review.

Cleanup evidence is mandatory on both success and failure. Every client process
must stop, gateway/renderer/WebDriver ports must have no listener, and run
storage must be released before a report can be `PROVEN`.

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
