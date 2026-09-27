---
kind: invariant
title: Access Gate wire is generated protobuf only
status: active
owns:
  - model/domain/access_gate/
  - apps/station/frame/touch/actor_handler.go
  - apps/station/frame/touch/accessgate/
  - apps/mobile/src-tauri/src/runtime/oauth/
  - apps/mobile/src/features/auth/authSession.ts
  - apps/desktop/src-tauri/src/application/auth/
  - apps/desktop/src/services/accessGate.ts
referenced-by:
  - ../playbooks/adding-an-access-gate.md
related:
  - ../../architecture/access-gates/station-access-gate-architecture.md
detected: 2026-09-26
---

# Access Gate wire is generated protobuf only

## What must hold

The four unauthenticated Access endpoints use the generated messages in
`model/domain/access_gate/access_gate.proto` and the canonical
`application/protobuf` media type:

- `/actor/access/start`
- `/actor/access/submit`
- `/actor/access/decision`
- `/actor/access/cancel`

Station binds request bytes directly into generated Go messages. Desktop and
Mobile encode and decode generated Rust/prost messages before projecting a
typed client model. Client code must not:

- parse the Access wire as JSON;
- accept alternate key casing or numeric/string enum variants;
- keep raw wire mirrors or normalization adapters;
- accept `application/json` or an alternate protobuf MIME on these endpoints;
- fall back to a direct credential route;
- reuse an attempt after identity, Station, device, lifecycle generation,
  schema revision, schema digest, or expiry mismatch.

Schema-driven form content remains opaque Station-owned data inside
`input_schema_json`. Clients may parse that JSON field only after the enclosing
generated protobuf message has been decoded and validated.

## Typed failure contract

Unknown gate type/action, missing current gate, expired attempt, identity
mismatch, and schema/scope mismatch must fail closed. Desktop and Mobile may
map errors into platform-specific UI keys, but both must preserve the same
semantic outcome and must not restart through a compatibility path.

## Why this is non-negotiable

Wire tolerance at the admission boundary creates a second protocol. It lets
stale clients reinterpret Station policy, hides source/runtime drift, and
makes malformed or replayed submissions look recoverable. Generated protobuf
types provide one field numbering, enum model, oneof shape, and schema digest
contract across Station, Desktop, and Mobile.

## How to verify

```bash
rg -n 'application/protobuf' \
  apps/station/frame/touch \
  apps/desktop/src-tauri/src/application/auth \
  apps/mobile/src-tauri/src/runtime/oauth

python3 tooling/scripts/acceptance-run.py --gate station-access-capability-contract
python3 tooling/scripts/acceptance-run.py --gate station-access-scope-isolation-e2e
```

## Crosswalks

- [`playbooks/adding-an-access-gate.md`](../playbooks/adding-an-access-gate.md)
- [`station-access-gate-architecture.md`](../../architecture/access-gates/station-access-gate-architecture.md)
