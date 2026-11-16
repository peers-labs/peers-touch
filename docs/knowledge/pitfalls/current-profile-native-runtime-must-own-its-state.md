---
kind: pitfall
title: Current Profile Native Gates must own their client and recovery state
status: active
owns:
  - tooling/acceptance/provisioners/native_tauri_current_profile.py
  - tooling/acceptance/gates/chat/native_two_client_runner.py
  - tooling/acceptance/gates/chat/native_current_profile_two_client_e2e.py
  - tooling/acceptance/gates/chat/native_submitted_command_recovery_e2e.py
  - tooling/acceptance/fixtures/chat_native_reset.py
  - tooling/acceptance/drivers/tauri.py
  - apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs
  - apps/desktop/src-tauri/src/messaging/store.rs
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/integration.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
detected: 2026-10-24
---

# Current Profile Native runtime ownership

The old Gate required named sibling worktrees, copied historical client seeds
and externally selected recovery command IDs. A valid reviewed Profile could
therefore supply the Station while the Gate still could not equip its clients.
Requiring only a persistent directory also failed to prove process restart.

The current Provisioner uses the selected worktree, one verified build and
run-created accounts. Existing Station actors are never reset.
Station readiness uses the shared Local Dev equipment operation before retaining
profile/source leases; health/source/protocol readback follows under those leases.
Failed equipment or build process cleanup retains its typed failure at the Runner
boundary; a generic RuntimeError conversion cannot certify clean termination.
Source-bound Runtime Cells equip the executable in the parent and freeze its
canonical root, path and digest. Native child launch consumes that manifest,
checks Gate/lease, platform/input mode, current source and executable bytes,
and never invokes another build. Isolated child environments intentionally
omit build-only host variables; their absence cannot trigger a child rebuild.
Only new, unconfigured run-account profiles receive the committed avatar fixtures.
Avatar initialization updates `touch_actor.icon` and its timestamp while
advancing `touch_actor_meta.profile_revision` in the same transaction. Profile
revision belongs to the metadata row, not the Actor table.
Normal authentication creates local device, keys and session state. The run
owns temporary client storage; restarts preserve it and final cleanup deletes
it. Station account and authority records remain audit state; local keys and
active sessions do not.

Run-created accounts use generated credentials that satisfy the production
signup policy. Preset-user passwords are not signup credentials. The existing
ephemeral launch channel carries an actor-scoped authentication request, never
the password. Its parent handler borrows the declared Native WebDriver session,
verifies the Station binding, invokes canonical login and projects only the
authentication result. Borrowing neither creates nor deletes the child session.
Credential values remain in the evidence redaction scope and the handler
zeroizes its secret at closure. The child consumes the typed client's projected
authentication result and closes its channel after both initial authentications;
restart uses the preserved product sessions. Registrar failures preserve the actual resource,
code and safe error message for owner diagnosis.

Recovery sends a real message through visible UI while dispatch is paused.
MP-D33 admits a draft without preparing a command inline. The recovery fixture
uses the existing production retry boundary to prepare that exact admitted draft
while the lifecycle remains paused, and checks the returned message/command
identity against the prepared ledger before fault injection. A successful durable
retry must retain its outcome when the paused worker cannot be woken; the BFF
reports that wake failure without rejecting the completed transition.
The Gate retains its last actual reconciliation snapshot in the final report,
including timeout paths. That observation identifies the command's terminal or
pending state and actual lifecycle-worker liveness without exposing its token;
it does not supply convergence or delivery proof.
The authority commit writes the raw message projection as `accepted`, before
recipient receipts exist. A native recovery run observed that projection with
the exact committed ledger and bytes but timed out because its oracle expected
the removed `sent` state. Reconciliation must recognize the current durable
state and still require the committed attempt, local command and outbox, exact
identity and bytes. Queued states and renderer horizon judgments do not qualify.
Receiver plaintext and sender DELIVERED remain separate required observations.
The fault owner fences the exact durable command into submitted state inside
one transaction without replacing bytes or advancing the lane. Actual Native
restart activates reconciliation. Both restarted clients must preserve their
device identities and show exact plaintext with the original message ID.
External fixture flags and caller-selected historical IDs are not authority.

Authority commit deletes the pending intent while retaining the committed
attempt, local command, outbox and message projection. The 24-hour unconfirmed
retry surface can therefore outlive the pending row. Manual retry must redrive
that exact committed identity; pending-row absence alone cannot reject it.
The native recovery Gate pauses the receiver, restores the sender's Chat page
and conversation after restart, advances only its renderer horizon clock,
clicks the visible retry control and checks unchanged committed identity.
Resuming the receiver must show the original plaintext and the sender's
DELIVERED receipt. Clock manipulation or a successful BFF response alone does
not establish that delivery.

Message-clearance evidence measures the rendered body, metadata, interaction
controls and avatar bounds, not the message row's inter-item padding. A real
Native send observed the tail sentinel immediately after a row that already
reserved 14px below its content. Requiring another 8px after the padded row
rejected readable content without observing occlusion. The shared geometry
oracle now unions rendered descendants and retains the original 8px gap to
the composer, viewport and tail anchor. Overflowing Retry or metadata controls
remain in that union; missing content and a shrinking timeline never pass.
Synthetic clearance cases protect the measurement, while the original
current-source two-client Journey still owns actual delivery and layout proof.

## How to detect a recurrence

Run from the selected worktree:

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.tests.test_current_profile_native \
  tooling.acceptance.tests.test_runtime_source_snapshot \
  tooling.acceptance.gates.chat.native_two_client_e2e_test
```

Verify with `test_current_profile_native`, `native_two_client_e2e_test`, the
focused Rust test
`acceptance_fixture_fences_a_ui_prepared_command_without_replacing_bytes`,
and both current-source Native Gates. Reject shared instance resources,
foreign source/build identity, device rotation, unchanged process identity,
missing receiver plaintext or retained run storage. Self-tests prove this
contract only; they do not establish Native product PASS.
The Rust `manual_retry` regression must use real `commit_public_event` cleanup.
The submitted-command recovery Native Gate must also reject a new draft,
command, event or message during committed retry and require sender-visible
delivery after the receiver resumes.
