---
kind: playbook
title: Adding a new access gate to the Station-driven gate chain
status: active
owns:
  - apps/station/frame/touch/accessgate/
  - apps/mobile/src/features/auth/authSession.ts
  - apps/desktop/src/services/accessGate.ts
referenced-by:
  - ../invariants/access-gate-wire-contract.md
related:
  - ../../architecture/access-gates/station-access-gate-architecture.md
  - ../../architecture/access-gates/station-access-gate-implementation-plan.md
detected: 2026-06-16
---

# Adding a new access gate to the Station-driven gate chain

## When to use

You are adding a new step a client must clear before entering a Station's authenticated shell — e.g. `device.trust`, `terms.acceptance`, or any future `custom` gate. Use this when the new check belongs *before* `access granted`, is owned by Station policy, and must render symmetrically on Desktop and Mobile.

Do **not** use this for post-login, in-shell permission checks — those are not access gates and must not be wired into the chain.

## Pre-conditions

- [ ] The gate's contract (type enum + any new request/field shape) is added to `model/domain/access_gate/access_gate.proto` and reviewed.
- [ ] `./model/build.sh` has regenerated Go proto, and `./tooling/scripts/proto-gen-mobile.sh` the mobile/native bindings.
- [ ] You have read invariant [`access-gate-wire-contract.md`](../invariants/access-gate-wire-contract.md) — every client predicate you touch must match both enum forms and snake_case-first keys.

## Steps

1. **Add the gate type to proto** — Extend `AccessGateType` in [`model/domain/access_gate/access_gate.proto`](../../../model/domain/access_gate/access_gate.proto). Reuse an existing submit field if the input fits; only add a new request field if the gate carries genuinely new input. Regenerate (`./model/build.sh`, `./tooling/scripts/proto-gen-mobile.sh`). Never hand-edit generated `*.pb.go` / prost output.

2. **Implement the gatekeeper** — Add a `<name>Gatekeeper` struct in [`apps/station/frame/touch/accessgate/builtin_gatekeepers.go`](../../../apps/station/frame/touch/accessgate/builtin_gatekeepers.go) implementing `Type()`, `GateID()`, and `Evaluate(ctx, *gatekeeper.EvalContext) *pb.AccessGate`. Define a stable `gateID<Name>` constant alongside the existing ones in [`service.go`](../../../apps/station/frame/touch/accessgate/service.go). If the gate needs form input, populate `InputSchemaJson` with a `{"fields":[…]}` schema and set `SubmitAction`. Keep policy storage out of the gatekeeper — inject it as a func (see `allowlistGatekeeper`'s `allowed allowedFunc`).

3. **Register it in chain order** — Add `r.Register(<name>Gatekeeper{…})` in `buildRegistry` in [`service.go`](../../../apps/station/frame/touch/accessgate/service.go) at the correct position. Order matters: gates needing actor identity (allowlist, invite) MUST register after `loginGatekeeper`.

4. **Handle submission server-side** — If the gate accepts input, add a `submitAccess<Name>` branch to the type switch in `SubmitAccessGate` in [`actor_handler.go`](../../../apps/station/frame/touch/actor_handler.go), mirroring `submitAccessInviteCode`. Validate input, evaluate, and return a `SubmitAccessGateResponse{Decision: …}`. Never trust client-asserted pass state — the decision is recomputed server-side.

5. **Render on Mobile** — In [`apps/mobile/src/features/auth/authSession.ts`](../../../apps/mobile/src/features/auth/authSession.ts) add the numeric+string enum constant and an `is<Name>Gate` predicate (match both forms). If the gate needs a submit transport, add a `submitStation<Name>Gate` helper. Render it in [`AccessGateHost.tsx`](../../../apps/mobile/src/features/auth/AccessGateHost.tsx) using `parseGateFields` for schema-driven fields. All user-facing text via locale keys — no literals.

6. **Render on Desktop** — Mirror step 5 in [`apps/desktop/src/services/accessGate.ts`](../../../apps/desktop/src/services/accessGate.ts) (predicate + constant). Transport lives in Rust: add a Tauri command in `apps/desktop/src-tauri/src/application/auth/service.rs` + `interface/tauri_commands/auth.rs`, register it in `main.rs`, expose it through `desktop_api.ts` and `store/session.ts`, then branch in `LoginPage.tsx` alongside the invite-code gate. Locale keys go in `packages/locales/{en,zh-CN}/auth.json`.

7. **Add Dashboard management if the gate is policy-driven** — If an admin toggles or configures the gate, extend `AccessGatesPage.tsx` and its API. Clients must never expose policy management.

## Verification

- [ ] `./model/build.sh` succeeds; no hand edits to generated files.
- [ ] `cd apps/station && gofmt -l . && go test ./...` passes.
- [ ] `rg -n '<NEW_ENUM_STRING_NAME>' apps/mobile/src/features/auth/authSession.ts apps/desktop/src/services/accessGate.ts` shows both clients match the new enum by string **and** number.
- [ ] `cd apps/desktop && pnpm run check` passes; `cargo check --lib` in `src-tauri` passes.
- [ ] Manual: a Station with the new gate enabled blocks `granted`/shell until the gate is cleared, identically on Desktop and Mobile.
- [ ] No raw UI strings introduced — all text resolves through locale keys.

## Crosswalks

- Invariant this playbook automatically respects: [`invariants/access-gate-wire-contract.md`](../invariants/access-gate-wire-contract.md).
- Architecture source: [`station-access-gate-architecture.md`](../../architecture/access-gates/station-access-gate-architecture.md) (§6 gate model, §7 gate types, §13 wire format).
