# Station Access Gate Implementation Plan

> Execution plan for implementing Station-driven access gates on Station, Dashboard, Desktop, and Mobile together.

---

## 1. Real Upgrade Goal

Upgrade client entry from a single login gate to a Station-owned access gate chain.

This is not a Mobile-only UX change. The implementation must land as one cross-platform contract:

```text
Proto -> Station policy/evaluation -> Dashboard management -> Desktop gate host -> Mobile gate host
```

---

## 2. Domain Responsibilities

| Domain | Responsibility | Deliverable |
| --- | --- | --- |
| Proto | Shared gate model and request/response payloads | `model/domain/access_gate/*.proto` |
| Station Access Gate | Attempt lifecycle, gate evaluation, access decisions | Go application/domain/service layer |
| Dashboard Access Policy | Admin policy management for invite/fixed-user mode | Dashboard API + UI/model integration |
| Desktop Gate Host | Render and submit Station gates before `ready` | Desktop lifecycle + LoginPage integration |
| Mobile Gate Host | Render and submit Station gates before shell | Mobile lifecycle + `AccessGateHost` |
| Verification | Prevent bypass and drift | Cross-platform tests/manual scenarios |

---

## 3. Dependency Order

### Phase 1. Contract

1. Add access gate proto under `model/domain/access_gate/`.
2. Define enums for gate type/state/decision and messages for attempt, gate, action, and decision.
3. Run shared generation:
   ```bash
   ./model/build.sh
   ```
4. If native/mobile generated proto is needed for plugin layer, run:
   ```bash
   ./tooling/scripts/proto-gen-mobile.sh
   ```

### Phase 2. Station Evaluation

1. Add Station access gate domain/application service.
2. Implement `StartAccessAttempt`, `SubmitAccessGate`, `GetAccessDecision`.
3. Implement minimum gates:
   - `station.capability`
   - `auth.login`
   - `auth.session_restore`
   - `invite.allowlist`
4. Ensure all actor-bound business APIs require a valid access grant, not just a JWT.

### Phase 3. Dashboard Policy

1. Add Dashboard policy endpoints under `/dashboard/api/access-gates`.
2. Add policy model for:
   - `open`
   - `invite_only`
   - `fixed_users`
   - `closed`
3. Add allowlist/invite management.
4. Add audit logs for policy changes and access denials.

### Phase 4. Desktop Gate Host

1. Add Desktop access gate service that talks to `desktop-rust`.
2. Integrate with `useAppLifecycle`.
3. Keep `LoginPage` as the UI host, but render login as `auth.login` gate.
4. Block `ready` until Station decision is `granted`.
5. Include PIN/OAuth/account picker as gate actions where applicable.

### Phase 5. Mobile Gate Host

1. Replace `StationAuthGate` with `AccessGateHost`.
2. Keep Station selection as the target selector.
3. Render `auth.login`, `invite.allowlist`, `invite.code`, and blocked states from the same gate chain.
4. Block shell until Station decision is `granted`.

### Phase 6. Verification

1. Verify Station rejects bypass when client skips gate completion.
2. Verify Desktop and Mobile show the same denial for invite-only blocked users.
3. Verify invited/allowed users enter both clients.
4. Verify Station switch clears access attempt and session projections.
5. Verify logout restarts the gate chain.

---

## 4. MVP Scope

The first shippable slice includes:

- Proto gate contract.
- Station access attempt and decision APIs.
- Dashboard-managed policy mode.
- Fixed-user allowlist by actor identity.
- Invite-only blocked state.
- Login as `auth.login` gate.
- Desktop and Mobile gate hosts using the same gate model.

Out of MVP:

- Device trust.
- Terms acceptance.
- Async admin review.
- Self-service invite code redemption unless explicitly needed for the first beta.

---

## 5. Acceptance Criteria

The feature is complete only when:

- The same Station policy affects Desktop and Mobile without client-specific configuration.
- A blocked user cannot enter by calling old login directly.
- Login success does not imply shell access unless the final access decision is granted.
- Dashboard is the only management surface for invite/fixed-user policy.
- Desktop and Mobile both render:
  - login gate;
  - invite/allowlist blocked gate;
  - granted transition;
  - retry/change Station actions.
- Verification commands pass:
  - `./model/build.sh`
  - `cd apps/station && gofmt -l . && go test ./...`
  - `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build`
  - `cd apps/mobile && pnpm run check:web`
  - `cd apps/mobile/src-tauri && source ~/.cargo/env && cargo check`
