---
kind: pitfall
title: Cross-Station fixtures require explicit shared Federation context
status: active
owns:
  - apps/desktop/src/acceptance/moments/harness.ts
  - tooling/acceptance/provisioners/secure_content_remote_recipient.py
  - tooling/acceptance/gates/chat/native_support.py
  - tooling/acceptance/gates/chat/native_two_client_runner.py
  - tooling/acceptance/gates/chat/native_interactions_runner.py
  - tooling/acceptance/gates/chat/native_multi_device_runner.py
  - tooling/acceptance/gates/chat/native_recovery_runner.py
  - tooling/acceptance/gates/chat/native_typing_runner.py
  - tooling/development/secure_content/runtime_owner.py
  - tooling/development/secure_content/scenarios/social_expansion.py
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

The Secure Content W8 remote-recipient run later resolved a real fiveArm Actor
successfully, but failed while adding that Actor to a Group:

```text
/conversation/membership/prepare HTTP 500
```

The primary and remote clients had valid but disjoint Federation memberships,
so the Group's Federation could not resolve the remote Station.

An activated Station can also retain an older active Federation whose founder
membership predates its current Station domain and therefore has an empty
`station_url`. Treating any active Federation as a usable join authority makes
the fixture fail before it can establish shared membership.

## Root cause

Several Native Chat runners retained the old Harness call shape after Direct
and Group creation became explicitly Federation-scoped. Inferring a default
Federation in the product API would hide ambiguity and violate the selected
Federation contract.

Likewise, resolving a remote Actor proves identity only. It does not establish
that both Home Stations share the Federation governing a Conversation.
Device enrollment alone also does not prove that the remote endpoint has
published an available MLS KeyPackage. Group genesis and membership
preparation reserve that KeyPackage and fail when the fixture binds the Actor
before its MLS inventory is ready.

## Mitigation

### What was done in code

- `native_support.py` resolves one Federation ID present in every named
  client's production `federationContext`.
- Direct and Group Native runners pass that ID explicitly to every creation
  action.
- The W8 remote-recipient provisioner selects an active Federation only when
  its production membership projection exposes the active sequencer endpoint.
  When no such Federation exists, the Acceptance Harness creates one through
  the production Federation API and requires the new projected sequencer
  endpoint before joining fiveArm.
- The provisioner then verifies the active member set from both Stations and
  binds the Federation digest into the opaque Fixture acknowledgement.
- The W8 runtime owner waits on the remote Native client's `chat.mlsReadiness`
  projection after device enrollment and before binding the remote Actor. The
  projection must identify a non-empty Actor and device, report the endpoint
  active, and expose at least one available MLS KeyPackage.
- No product default, fallback, or synthetic Federation is introduced.

### What guards against regression

`NativeRuntimeCellRunnerContractTest` verifies shared-Federation selection and
requires every Native `createDirectConversation` and `createGroup` payload to
include `federationId`.

`RuntimeOwnerTest.test_w8_remote_recipient_is_created_and_bound_by_identity_provisioner`
and the Moments Harness tests verify reusable authority selection, production
Federation creation for stale endpoint-less membership, the W8 join, bilateral
membership projection, and digest binding. The runtime-owner readiness
regressions verify that inactive endpoints and zero-KeyPackage states keep
polling and that timeout fails closed before identity binding.

## How to detect a recurrence

Run:

```bash
python3 -m unittest \
  tooling.acceptance.gates.chat.native_runtime_cell_runner_test \
  tooling.development.secure_content.test_runtime_owner \
  tooling.development.secure_content.scenarios.test_social_expansion
```

Then inspect all Native Chat creation actions:

```bash
rg -n -C 4 '"createDirectConversation"|"createGroup"' \
  tooling/acceptance/gates/chat/*runner.py
```

Every programmatic creation payload must carry the Federation selected from
the participating clients' production contexts.

For a cross-Station fixture, also verify that each participating Station lists
the same active Federation membership before creating the Conversation. Actor
resolution alone is insufficient. Before Group genesis or membership
preparation, verify every added endpoint is active and has at least one
available MLS KeyPackage through the owning Native client.

## Crosswalks

- `MP-D19` requires an explicit Federation scope for Direct creation.
- `MP-D32` routes cross-Station typing through Conversation Authority.
