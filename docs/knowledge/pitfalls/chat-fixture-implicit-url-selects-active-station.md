---
kind: pitfall
title: Chat Fixture implicit URL must resolve its bound reviewed target
status: active
owns:
  - tooling/acceptance/fixtures/chat_reset_targets.py
  - tooling/acceptance/fixtures/chat_native_reset.py
  - tooling/acceptance/fixtures/chat_submit_fault_proxy.py
  - tooling/acceptance/tests/test_chat_reset_target_resolution.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-22
---

# Chat Fixture implicit URL must resolve its bound reviewed target

## Symptom

Native product closure rejected the submit-fault proxy before client launch:
the requested URL belonged to the primary Station, while the selected deployment
belonged to the active secondary Profile. Both Stations had current source and
the Fixture already held reviewed bindings and a live reset lease.

## Root cause

The implicit environment resolver selected the active Profile before checking
the supplied URL. Exact target validation correctly rejected that disagreement.
The refusal omitted owner observations, obscuring the wrong selection.

## Mitigation

Chat's target owner resolves implicit URLs by one exact match among the current
bound reviewed Profiles. Explicit environments retain exact target validation.
The Machine Dev registry remains the Profile truth owner; its stable policy and
the canonical live lease remain required. Unknown or ambiguous URLs and binding
drift fail closed with actual expected/observed diagnostics. No Gate or proxy
selects a replacement active Profile or relaxes URL validation.

## How to detect a recurrence

```bash
python3 -m unittest \
  tooling.acceptance.tests.test_chat_reset_target_resolution \
  tooling.acceptance.gates.chat.chat_native_reset_test \
  tooling.acceptance.tests.test_provisioning_owners
```

The primary and secondary implicit URL cases must both pass with the secondary
Profile active. The actual submit-proxy constructor must resolve the primary
target and release its listener. Explicit disagreement, unknown/ambiguous URLs,
stable targets and lease absence must reject with owner diagnostics.

For live qualification, retain the current-source Station readbacks and acquire
the canonical Fixture lease once. Bind both assigned Profiles, resolve both
implicit URLs and construct/stop the primary submit proxy before releasing the
lease. This qualification proves Fixture routing only, not receiver behavior.
