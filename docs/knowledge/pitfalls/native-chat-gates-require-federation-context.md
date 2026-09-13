---
kind: pitfall
title: Native Chat Gates require explicit Federation context
status: active
owns:
  - tooling/acceptance/gates/chat/native_support.py
  - tooling/acceptance/gates/chat/native_two_client_runner.py
  - tooling/acceptance/gates/chat/native_interactions_runner.py
  - tooling/acceptance/gates/chat/native_multi_device_runner.py
  - tooling/acceptance/gates/chat/native_recovery_runner.py
  - tooling/acceptance/gates/chat/native_typing_runner.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/messaging-platform/decisions.md
  - docs/architecture/acceptance-framework/execution-plans/20260824-native-desktop-runtime-cells.md
detected: 2026-09-13
---

# Native Chat Gates require explicit Federation context

## Symptom

A source-bound three-client typing run authenticated every client, then failed
at its first Direct action:

```text
messaging_create_direct: missing field federation_id
```

## Root cause

Several Native Chat runners retained the old Harness call shape after Direct
and Group creation became explicitly Federation-scoped. Inferring a default
Federation in the product API would hide ambiguity and violate the selected
Federation contract.

## Mitigation

### What was done in code

- `native_support.py` resolves one Federation ID present in every named
  client's production `federationContext`.
- Direct and Group Native runners pass that ID explicitly to every creation
  action.
- No product default, fallback, or synthetic Federation is introduced.

### What guards against regression

`NativeRuntimeCellRunnerContractTest` verifies shared-Federation selection and
requires every Native `createDirectConversation` and `createGroup` payload to
include `federationId`.

## How to detect a recurrence

Run:

```bash
python3 -m unittest \
  tooling.acceptance.gates.chat.native_runtime_cell_runner_test
```

Then inspect all Native Chat creation actions:

```bash
rg -n -C 4 '"createDirectConversation"|"createGroup"' \
  tooling/acceptance/gates/chat/*runner.py
```

Every programmatic creation payload must carry the Federation selected from
the participating clients' production contexts.

## Crosswalks

- `MP-D19` requires an explicit Federation scope for Direct creation.
- `MP-D32` routes cross-Station typing through Conversation Authority.
