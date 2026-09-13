---
kind: pitfall
title: Mutable runtime evidence must have one final writer
status: active
owns:
  - tooling/acceptance/gates/chat/native_two_client_runner.py
  - tooling/acceptance/gates/chat/native_multi_device_runner.py
  - tooling/acceptance/gates/chat/native_recovery_runner.py
  - tooling/acceptance/gates/chat/native_group_mls_runner.py
  - tooling/acceptance/gates/chat/native_typing_runner.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/acceptance-framework/design.md
  - docs/architecture/acceptance-framework/execution-plans/20260824-native-desktop-runtime-cells.md
detected: 2026-09-11
---

# Mutable runtime evidence must have one final writer

## Symptom

A Native Chat Gate completed every product assertion, then failed during
cleanup with:

```text
EvidenceConflict: artifact path already has different bytes:
evidence/chat-native-current-profile-two-client-e2e-bob-app-log.log
```

## Root cause

The runner copied a live, still-growing app log into the immutable Evidence
Store during product evidence collection. Cleanup stopped the client and copied
the same source file to the same artifact key again. The second copy correctly
failed because its bytes differed from the first immutable artifact.

## Mitigation

### What was done in code

- Native Chat runners capture screenshots and DOM before shutdown.
- Their cleanup owner stops each client and exports its final app log exactly
  once.
- Evidence Store conflict detection remains strict; no overwrite, skip, or
  equal-name fallback was introduced.

Implemented by commit `c980b22d68741b80c92caf6c43563fb3fd9057f5`.

### What guards against regression

- `NativeTwoClientEvidenceTest.test_visible_evidence_defers_mutable_app_log_until_cleanup`
  proves visible evidence collection does not write the app log.
- `NativeTwoClientEvidenceTest.test_cleanup_exports_remote_log_before_binding_cleanup`
  proves cleanup exports the final app log.
- `chat-native-visible-static` runs both regressions.

## How to detect a recurrence

Run:

```bash
python3 -m unittest \
  tooling.acceptance.gates.chat.native_two_client_e2e_test
```

Then inspect each affected runner:

```bash
rg -n "save_app_log\\(" \
  tooling/acceptance/gates/chat/native_two_client_runner.py \
  tooling/acceptance/gates/chat/native_multi_device_runner.py \
  tooling/acceptance/gates/chat/native_recovery_runner.py \
  tooling/acceptance/gates/chat/native_group_mls_runner.py \
  tooling/acceptance/gates/chat/native_typing_runner.py
```

Each mutable app log must have one final writer for a given artifact key.

## Crosswalks

- Acceptance Evidence Store immutability is defined by D-11 in
  `docs/architecture/acceptance-framework/decisions.md`.
