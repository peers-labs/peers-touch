---
kind: pitfall
title: Chat target resolution and fault transport preserve canonical ownership
status: active
owns:
  - tooling/acceptance/fixtures/chat_reset_targets.py
  - tooling/acceptance/fixtures/chat_native_reset.py
  - tooling/acceptance/fixtures/chat_native_actors.py
  - tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py
  - tooling/acceptance/drivers/native/runtime.py
  - tooling/acceptance/gates/chat/native_product_closure_runner.py
  - tooling/acceptance/gates/chat/contact_message_resilience_runner.py
  - tooling/acceptance/tests/test_chat_reset_target_resolution.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
  - docs/architecture/engineering/acceptance/decisions.md
detected: 2026-10-22
---

# Chat target and Direct fault ownership

## Symptom

A two-Station Fixture resolved a primary URL through the active secondary
Profile. After exact target resolution was repaired, product closure failed at
signed discovery because an HTTP fault proxy replaced the canonical Station
origin. Repeated lease and registry validations also consumed Gate work time.

## Root cause

The active Profile is not the owner of every bound Station URL. A transparent
HTTP proxy cannot become a signed origin: the upstream statement still names
the canonical Station. Revalidating the same operation at every helper boundary
adds process overhead without strengthening that operation's authority.

## Mitigation

The target owner validates one live lease per resolution and one registry
definition per candidate, then requires one exact reviewed target. Explicit
targets validate their own Profile. Deployment and reset authorization consume
the same result. Each new operation revalidates; no cross-operation cache exists.
Unknown, ambiguous, drifted or stable targets remain rejected with diagnostics.
Actor reads group accounts by exact Station. Each read validates the target
and both containers once, then verifies one local row per requested account.
Manifest hydration and the pre-contact drift check remain independent reads;
the optimization never reuses authority or identity across operations.
The Native Station attestation comparison records actual commit/protocol
mismatch, assigned Profile, deployment and endpoint with its recovery action.

Runtime Binding always launches, discovers and proves the canonical Station.
Live Direct fault handles alter only dial multiaddrs. Chat uses the existing
TCP proxy after signed discovery. Reaction proof binds the unique new
message-scoped command, retained intent/outbox hash and ID, retry scheduling
count, restored connection forwarding, automatic submission and both visible
receivers. Successful submission retains the failure scheduling count.
Encrypted TCP evidence cannot establish HTTP path or wire command hashes.

## How to detect a recurrence

Run the existing target, reset authority, Runtime Binding, Native interaction,
product closure and Node Connectivity regressions. Both implicit targets must
resolve with the secondary Profile active. Each operation validates the lease
once and each candidate once; explicit resolution checks only its Profile.
Prelaunch handles must leave canonical origin and proof unchanged.

Live qualification must deploy and read back both assigned Profiles at the
current source, acquire the canonical Fixture lease, verify the borrowed child
FD, resolve and reset both targets, read back Actors and seal actual mismatch
diagnostics. The real product scenarios separately prove Direct interruption,
UI failure, recovery and cleanup. Fixture routing alone is not product proof.
Batch read regressions must reject missing/duplicate accounts and invalid
container identity or volume. Actual three-actor timing must retain both
independent read phases. Product closure records durable Step and login/device
boundaries; already-hydrated login identity is checked without a second
hydration. Neither timing nor intermediate observations establish product PASS.
