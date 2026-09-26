---
kind: pitfall
title: Shared Acceptance tooling must derive variant and scheduling semantics
status: active
owns:
  - tooling/acceptance/gates/chat/native_two_client_e2e.py
  - tooling/acceptance/gates/chat/native_two_client_runner.py
  - tooling/acceptance/gates/chat/native_current_profile_two_client_e2e.py
  - tooling/acceptance/gates/chat/native_submitted_command_recovery_e2e.py
  - tooling/acceptance/gates/chat/storage_redaction_recovery_e2e.py
  - tooling/acceptance/gates/chat/storage_redaction_recovery_runner.py
  - tooling/scripts/acceptance-gap-detect.py
  - tooling/scripts/acceptance-gap-detect-test.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/acceptance-framework/design.md
  - docs/architecture/acceptance-framework/decisions.md
  - docs/architecture/acceptance-framework/execution-plans/20260824-native-desktop-runtime-cells.md
detected: 2026-09-13
---

# Shared Acceptance tooling must derive variant and scheduling semantics

## Symptom

The exact-source submitted-command recovery journey passed every product and
cleanup assertion, but its validator failed with:

```text
chat native submitted-command validation failed: unexpected native two-client journey
```

The next latent check would also have rejected the valid shared `four-app`
profile used by both current-profile clients.

Later, the storage redaction and Recovery Gate passed every assertion, but the
Gap Detector still required `chat-native-two-client-e2e` because
`socialChat.ts` matched a second hardcoded path table outside the canonical
planner and formal Plan closure.

## Root cause

The reusable two-client validator relied on an incomplete Gate-to-journey
mapping and special-cased one Gate ID for profile topology. Reused Gates can
therefore emit the correct variant journey while validation silently falls
back to the base Direct journey.

The Gap Detector independently duplicated a Chat path-to-Gate obligation.
That made impact discovery behave as scheduling and overrode the formal
Execution Plan's current closure, contrary to D-20.

## Mitigation

### What was done in code

- `native_two_client_e2e.py` derives the expected journey from the Gate ID.
- `native_two_client_runner.py` keeps a closed mapping for every shared runner
  variant, including storage redaction and Recovery.
- Shared-profile validation uses the canonical `is_current_profile_gate`
  classification instead of comparing one Gate ID.
- `acceptance-gap-detect.py` validates the canonical planner's candidate
  superset but derives execution obligations only from the supplied formal
  closure and explicit required Gates.
- Gate-specific tests cover their journey mappings; the submitted-command
  suite also covers profile-family classification. Gap Detector tests cover a
  receiver-visible path whose broader candidate Gate is intentionally deferred
  by a specialized formal closure.

### What guards against regression

`NativeTwoClientEvidenceTest.test_submitted_recovery_uses_current_profile_contract`
asserts the submitted-command rules.
`StorageGovernanceRunnerTest.test_redaction_gate_uses_the_single_station_native_environment`
asserts the storage-redaction journey mapping.
`AcceptanceGapDetectorTests.test_formal_closure_may_defer_receiver_candidate_gate`
asserts that the Gap Detector does not reschedule a deferred candidate.

## How to detect a recurrence

Run:

```bash
python3 -m unittest tooling.acceptance.gates.chat.native_two_client_e2e_test
python3 tooling/scripts/acceptance-gap-detect-test.py
```

Then inspect shared validators for base-Gate literals:

```bash
rg -n '"direct-delivered-receipt"|!= CURRENT_PROFILE_GATE_ID' \
  tooling/acceptance/gates/chat/*e2e.py

rg -n 'RECEIVER_VISIBLE_PATHS|RECEIVER_PROOF_GATE' \
  tooling/scripts/acceptance-gap-detect.py
```

Any literal used as a universal assertion must be replaced by a closed
Gate-variant classification or an explicit validator input. Any product path
or Gate obligation in the generic Gap Detector must instead come from the
canonical planner, the formal closure, or an explicit required-Gate input.

## Crosswalks

- Decision `D-06` defines Chat as a managed product domain.
- Decision `D-11` requires immutable source-bound runtime evidence.
- Decision `D-12` keeps this Chat-specific validator in the business injection
  responsibility plane.
- Decision `D-20` makes the formal Execution Plan the sole Acceptance
  scheduling owner.
