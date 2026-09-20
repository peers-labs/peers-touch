---
kind: pitfall
title: Shared Gate validators must derive variant semantics
status: active
owns:
  - tooling/acceptance/gates/chat/native_two_client_e2e.py
  - tooling/acceptance/gates/chat/native_current_profile_two_client_e2e.py
  - tooling/acceptance/gates/chat/native_submitted_command_recovery_e2e.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/acceptance-framework/design.md
  - docs/architecture/acceptance-framework/decisions.md
  - docs/architecture/acceptance-framework/execution-plans/20260824-native-desktop-runtime-cells.md
detected: 2026-09-13
---

# Shared Gate validators must derive variant semantics

## Symptom

The exact-source submitted-command recovery journey passed every product and
cleanup assertion, but its validator failed with:

```text
chat native submitted-command validation failed: unexpected native two-client journey
```

The next latent check would also have rejected the valid shared `four-app`
profile used by both current-profile clients.

## Root cause

The reusable two-client validator hard-coded the base Direct journey name and
special-cased one Gate ID for profile topology. A second Gate reused the same
runtime contract but supplied its own journey and belonged to the same
current-profile Gate family.

## Mitigation

### What was done in code

- `native_two_client_e2e.py` derives the expected journey from the Gate ID.
- Shared-profile validation uses the canonical `is_current_profile_gate`
  classification instead of comparing one Gate ID.
- `native_two_client_e2e_test.py` covers the submitted-command journey and
  profile-family classification.

### What guards against regression

`NativeTwoClientEvidenceTest.test_submitted_recovery_uses_current_profile_contract`
asserts both variant rules.

## How to detect a recurrence

Run:

```bash
python3 -m unittest tooling.acceptance.gates.chat.native_two_client_e2e_test
```

Then inspect shared validators for base-Gate literals:

```bash
rg -n '"direct-delivered-receipt"|!= CURRENT_PROFILE_GATE_ID' \
  tooling/acceptance/gates/chat/*e2e.py
```

Any literal used as a universal assertion must be replaced by a closed
Gate-variant classification or an explicit validator input.

## Crosswalks

- Decision `D-06` defines Chat as a managed product domain.
- Decision `D-11` requires immutable source-bound runtime evidence.
- Decision `D-12` keeps this Chat-specific validator in the business injection
  responsibility plane.
