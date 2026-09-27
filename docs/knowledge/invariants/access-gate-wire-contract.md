---
kind: invariant
title: AccessDecision crosses Go→Rust→TS with snake_case keys and string enums
status: active
owns:
  - apps/station/frame/core/server/serializer.go
  - apps/station/frame/touch/actor_handler.go
  - apps/station/frame/touch/accessgate/service.go
  - apps/mobile/src/features/auth/authSession.ts
  - apps/desktop/src/services/accessGate.ts
referenced-by:
  - ../playbooks/adding-an-access-gate.md
related:
  - ../../architecture/access-gates/station-access-gate-architecture.md
  - ../../architecture/access-gates/station-access-gate-implementation-plan.md
detected: 2026-06-16
---

# AccessDecision crosses Go→Rust→TS with snake_case keys and string enums

## What must hold

Every client that decodes an `AccessDecision` (or any nested `AccessGate` / `AccessGateField`) MUST tolerate the exact wire form Station emits, and MUST NOT assume a single key casing or a single enum representation. Concretely:

- Field reads MUST accept **snake_case first** (`attempt_id`, `current_gate_id`, `blocking_reason`, `input_schema_json`) and fall back to camelCase.
- Enum comparisons (state, gate type) MUST match **both** the numeric constant **and** the protobuf string name (`3` *and* `"ACCESS_DECISION_STATE_GRANTED"`; `5` *and* `"ACCESS_GATE_TYPE_INVITE_CODE"`).
- Gate forms MUST be rendered from `input_schema_json` (parsed into a field list), never hard-coded per client.

Station's encoding is fixed by [`serializer.go`](../../../apps/station/frame/core/server/serializer.go): `protojson.MarshalOptions{EmitUnpopulated: true, UseProtoNames: true}` for responses and `protojson.UnmarshalOptions{DiscardUnknown: true}` for requests. That makes snake_case keys + string enums + all-fields-emitted the canonical form, and makes the request side liberal (either casing, either enum form is accepted).

## Why this is non-negotiable

The gate chain is the *only* thing standing between an unauthenticated visitor and the authenticated shell, and it is decoded independently three times: once in Go (Station emits it), once in Rust (the Desktop kernel relays it through `accessGate.ts`'s normalizer), and once in TS (mobile and desktop UIs predicate on it). A representation mismatch at any hop does not throw — it silently produces the wrong branch.

The failure modes are concrete and all silent:

- **Enum matched by number only.** `UseProtoNames: true` does not change enum encoding, but protojson emits enums as their **string name** by default. A client that checks `state === 3` will read `"ACCESS_DECISION_STATE_GRANTED"`, see no match, treat the decision as not-granted, and either loop the gate forever or block a user who was actually admitted. The inverse — a future proxy or build that emits numeric enums — breaks a client that only checks the string. Matching both is the only stable choice.
- **Key casing assumed.** Today Station emits snake_case. A reverse proxy, a gateway transform, or a future `UseProtoNames: false` build would emit camelCase. A client reading only `decision.currentGateId` would suddenly see `undefined`, render no gate, and strand the user at a blank step with a valid attempt in flight.
- **Gate form hard-coded.** The `invite.code` gate ships its form in `input_schema_json`. If a client hard-codes the field name/label instead of parsing the schema, Station can no longer evolve a gate's form without a synchronized client release — which defeats the entire "Station owns the gate chain" design goal.

Because the gate sits on the security boundary, "silently wrong" here means "wrong admission decision," not "cosmetic glitch." That is why the dual-form tolerance is an invariant, not a nicety.

## How to verify

Station encoding is the single source — confirm it has not drifted:

```bash
rg -n 'EmitUnpopulated|UseProtoNames|DiscardUnknown' apps/station/frame/core/server/serializer.go
```

Every client predicate must match both enum forms. These must each return hits showing the numeric **and** string constant side by side:

```bash
rg -n 'ACCESS_DECISION_STATE_GRANTED|ACCESS_GATE_TYPE_INVITE_CODE' apps/mobile/src/features/auth/authSession.ts apps/desktop/src/services/accessGate.ts
```

Every client field read must use the snake_case-first pattern — spot-check that normalizers read `?? camelCase`:

```bash
rg -n 'current_gate_id|input_schema_json|blocking_reason' apps/mobile/src/features/auth/authSession.ts apps/desktop/src/services/accessGate.ts
```

Reviewer rule: any new `AccessDecision`/`AccessGate` consumer that compares an enum with `===` against only one form (number xor string), or reads only one key casing, is a review block.

## Crosswalks

- Playbook [`playbooks/adding-an-access-gate.md`](../playbooks/adding-an-access-gate.md) builds this dual-form tolerance into the standard procedure for adding a new gate type.
- Architecture [`station-access-gate-architecture.md` §13](../../architecture/access-gates/station-access-gate-architecture.md#13-wire-format-contract) states the same contract at the design level.
