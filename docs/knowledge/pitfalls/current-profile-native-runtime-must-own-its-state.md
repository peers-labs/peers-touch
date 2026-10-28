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
The fault owner fences the exact durable command into submitted state inside
one transaction without replacing bytes or advancing the lane. Actual Native
restart activates reconciliation. Both restarted clients must preserve their
device identities and show exact plaintext with the original message ID.
External fixture flags and caller-selected historical IDs are not authority.

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
