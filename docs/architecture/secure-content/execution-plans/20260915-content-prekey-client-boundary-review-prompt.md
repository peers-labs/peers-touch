# Secure Content PreKey Client Boundary - Review Prompt

> **Status**: review passed; Owner accepted
> **Version**: v1.0
> **Created**: 2026-09-15 | **Updated**: 2026-09-15
> **Owner**: Architecture Team

---

Review proposed `SC-D20` in:

- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/integration.md`
- `docs/architecture/secure-content/security.md`
- `docs/architecture/api-ownership/design.md`
- `docs/architecture/api-ownership/station-api-capabilities.yaml`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`

## Verified Gap

W3 implemented the accepted Content PreKey publication, inventory, signing,
epoch, replay, quota and claim semantics behind an internal Key Exchange
capability. That capability intentionally registers no public route. The
API-ownership registry has no Content PreKey client capability, and Desktop has
generated messages but no Native transport, encrypted private-key store or
maintenance worker.

W7 therefore cannot produce a real recipient key, prepare a private Social
resource or prove the Desktop pilot without inventing:

1. public route ownership and exact method/path pairs;
2. raw protobuf canonicality and request bounds;
3. JWT/device identity projection and HTTP error mapping;
4. crash-safe Native publication and deletion-safe private-key retention;
5. a plan item authorized to modify Key Exchange and API-ownership sources.

This is `DESIGN_AMENDMENT_REQUIRED`, not a W7 implementation detail.

## Proposed Decision

`SC-D20` proposes:

1. Key Exchange owns exactly:
   - `POST /key-exchange/content-prekeys/publish`;
   - `POST /key-exchange/content-prekeys/inventory`.
2. The routes reuse the existing generated
   `PublishContentPreKeys*` and `GetContentPreKeyInventory*` messages while
   adding publication `command_id` / `exact_replay`, a typed device-possession
   proof, and stable Content PreKey codes in the shared `ErrorResponse`.
3. They accept only canonical `application/protobuf`, no query/JSON/alias, with
   128 KiB publish and 4 KiB inventory body limits.
4. A reusable server canonical-protobuf mode rejects recursive unknowns,
   duplicate singular/oneof fields, non-minimal varints, explicit default
   encodings and non-canonical field order through deterministic
   decode/re-encode equality.
5. Publication also requires ascending canonical `key_id` order before the
   existing `SC-D15` normalization and signature verification.
6. Bearer JWT authenticates the actor only. A fresh Ed25519
   device-possession proof binds capability ID, local Station peer ID, validated
   JWT session ID, actor/device, current signing key/profile, request ID,
   proof-free request hash, nonce and issued-at. It must match local Station
   identity, `Subject.SessionID`, JWT PTID and `X-Device-ID`. Endpoint pools are
   self-endpoint scoped; recovery pools are same-actor scoped.
7. Publish/inventory remain separate synchronous operations. Existing exact
   replay, CAS epoch, quota, depletion and claim semantics remain unchanged.
8. `ClaimContentPreKeys` and `ValidateContentPreKeyClaims` remain internal.
9. Key Exchange inserts or locks a command-scoped `PENDING` publication receipt
   before pool inspection. Concurrent same-command requests serialize, and the
   same transaction commits keys, pool state and the `COMPLETED` receipt.
   Exact retry returns the stored result before signing-key/profile
   revalidation for the same currently active endpoint; a changed request
   conflicts. Completed receipts are retained for the endpoint lifetime, and a
   non-secret command/hash tombstone remains after acknowledged destruction.
   The command ID is deterministically derived from the proof-free publication
   payload, so alternate command IDs cannot amplify receipt state. A first-time
   command must insert at least one new immutable key; an all-existing batch is
   legal only as replay of its original command.
10. Native persists private material and exact publish bytes before network
    publication. A session-fenced send lease marks in-flight work; bootstrap
    conservatively converts orphaned pending/in-flight work to
    `UNKNOWN_COMMIT` and reconciles it before generating replacement material.
11. Batch publication state and per-key state are separate. Endpoint private
    keys are retained until that key's root-key commit or explicit local
    account/device destruction after acknowledged endpoint revocation.
    `SC-D15` claim-time fencing makes every unclaimed revoked-publisher key
    ineligible without a second retirement acknowledgement. Heuristic
    count/age eviction is forbidden.
    Recovery masters are epoch-keyed; missing historical epochs require the
    typed phrase/key-unavailable path.
12. One process-owned supervisor fences callbacks by Station, actor, device and
    session generation, and zeroizes in-memory secrets on every teardown path.
13. The two routes have an exact target API-ownership projection. Browser,
    Social, Secure Content, Direct and MLS do not gain PreKey publication
    authority. The route-matched canonical handler owns protobuf transport/auth
    errors; unmatched-route `404` and method-level `405` remain outside this
    guarantee. Errors use the shared protobuf `ErrorResponse`; retry timing is
    carried only in `Retry-After` and is capped at 300 seconds.
14. Route errors carry no free-form cause and cap `Retry-After` at 300 seconds.
    Revoked JWT/session state is `401 UNAUTHENTICATED`; a valid JWT naming an
    inactive/revoked endpoint is `403 FORBIDDEN`.
15. The plan and work-item manifest contain parked source-only W7A with the
    exact Key Exchange, shared server, proto/generated, API registry/Gate and
    service-Journey write sets, including the auth adapters required for typed
    route errors and the scoped generator changes required for the shared error
    model. A model-neutral server error-projector callback prevents a
    `frame/core -> frame/touch/model` dependency. W7A applies then checks
    only the `content-prekey-client` generator scope, compiles Desktop/Mobile
    Rust proto consumers, updates the governed error/i18n ranges, shared locale
    catalogs and locale metadata version, and synchronizes all owning
    architecture documents. A dedicated parity check covers every generated
    error consumer and locale. PostgreSQL receipt/lock/rotation/revocation tests
    are mandatory; a fail-closed runner requires the DSN, parses
    `go test -json`, and rejects skip, missing, renamed, zero-match or non-pass
    cases. Secure Content Core tests run from a temporary copy without
    repository-local Cargo artifacts. W7A runs the existing
    `station-api-ownership` Gate; W13 owns and runs the candidate
    `secure-content-prekey-client-boundary` Gate against final source. Both are
    mapped to the W7A Journey, and W13 includes `SC-D20` in final promotion.
    W7A cannot execute until Owner acceptance.

## Review Questions

1. Do the two routes preserve Key Exchange ownership without creating a public
   Secure Content service or Social proxy?
2. Is reusing the existing proto pair preferable to separate endpoint/recovery
   route families or a combined reconcile mutation?
3. Does exact deterministic decode/re-encode equality close all raw-wire
   ambiguity required by `SC-D15`?
4. Does the fresh actor-device signature correctly treat JWT as actor-only and
   `X-Device-ID` as an assertion rather than authority, and bind the proof to
   the local Station plus validated JWT session?
5. Are 128 KiB and 4 KiB valid upper bounds for the accepted 100-key batch and
   one-target inventory request?
6. Do the shared `ErrorResponse` codes provide one protobuf-only machine
   contract for transport, auth and application failures, with deterministic
   Native retry actions and bounded `Retry-After`?
7. Does the deterministic command ID plus transaction-held reservation make
   concurrent replay and a response lost before profile rotation decidable
   without permitting receipt amplification or a revoked endpoint mutation?
8. Does persist-before-publish plus `UNKNOWN_COMMIT` reconciliation prevent
   advertised public material from losing its private counterpart after a crash?
9. Do separate command and per-key states prevent one batch result from
   deleting an unopened key, and is retaining each key until root-key commit
   the safe current policy without a server disposition protocol?
10. Are recovery masters bound to exact epochs, with phrase-required behavior
    instead of unsafe current-epoch substitution?
11. Does the supervisor contract cover logout, account/Station switch, vault
    lock, revocation, shutdown and stale callbacks?
12. Does the exact W7A projection isolate Key Exchange/API ownership changes
    from the later Desktop/runtime lane without changing product semantics?

## Required Verdict

Return:

```text
Verdict: PASS | HOLD | REJECT

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- route and capability ownership: PASS | HOLD
- canonical transport and limits: PASS | HOLD
- authentication and typed error mapping: PASS | HOLD
- receipt replay and unknown outcomes: PASS | HOLD
- Native durability, retention and teardown: PASS | HOLD
- execution ownership and evidence: PASS | HOLD
```

A `PASS` means `SC-D20` is internally consistent and ready for Owner
acceptance. It does not accept the decision, authorize implementation, release
the active Desktop/Station owners or establish W7 `FUNCTIONAL_PASS`.

## Outcome

- Final independent security/lifecycle review: `PASS`.
- Final independent architecture/API ownership and plan review: `PASS`.
- Material findings remaining: none.
- Owner acceptance: accepted on 2026-09-15.
- W7A execution: released to the execution queue.
