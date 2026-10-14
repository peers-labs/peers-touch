# Unified Station - Architecture And Plan Review

Review this package against `../../design.md`, `../../decisions.md`,
`../../data-model.md`, `../../module-layout.md`, `../../integration.md`,
Station Access and service coordination. Read current source cited in the
Evidence Ledger; design decisions and candidate checks are not runtime evidence.

Return findings first, then `PASS | CONDITIONAL | REVISE`. Each finding requires
location, violated relationship/criterion, consequence and corrective owner.

Review obligations:

1. Logical Station root and independent node key delegation preserve existing
   business identity and reject substituted Node/Relay/SPKI before credentials.
2. No Gateway service, alternate business API or duplicate Host owner exists.
   Frame HTTP2 streams into existing Hertz router and preserves handlers,
   RequestContext, wrappers, body/Flush and cancellation.
3. Standard Circuit admission can consume private grants through source-bound
   control redemption; renewal preserves connections and revocation is distinct.
4. Connection budgets cover SSE/files with finite aggregate resources. Proposed
   limits are not represented as measured capacity or latency improvements.
5. NCP-01/02 close internal prerequisites without a second production listener;
   NCP-03 atomically migrates all consumers and deletes the custom data plane.
6. NCP-04/05/06/07 dependencies reflect shared events, Session/keyring, existing
   Agent leases and OSS lock/backend ports. NCP-08 readiness depends on all four.
7. Replay/live handoff, missed wakes, durable device filtering, actor ordering,
   Session class races, healthy foreign ownership and stale fencing are covered;
   immutable object generation protects replacement bytes from stale deletion.
8. Product actions use native DOM events with receiver-render/readback oracles.
   Harness verifies service contracts and controlled failures, not native UX.
9. One Suite owns resources; scenarios attach. New Gate/entry-point references
   are explicit implementation obligations, not currently executable proof.
10. All four North Star criteria exactly map to Task closures and Gates;
    approval remains null, and runtime/profile/checkpoint authorization is bounded.
11. Task slices fit real bounded closures. If the atomic consumer inventory is
    larger than a continuation, refine preparatory library Tasks before execution
    while keeping one indivisible production cut.
12. Source checks, contract audit and formal runtime evidence are separate.
    No Mobile native, provider exactly-once or database HA claim is inferred.

## Plan-Model Review Result

Separate findings-first pass: **PASS for candidate structure and target model**.
Source-backed issues are resolved by distinct root/node identities, canonical
handler reuse, prior private-permit exchange, connection-level budgets, durable
device targeting, existing Session DBStore and domain-owned fencing.

Nine closures have real producer/consumer dependencies; each criterion maps
exactly to its Task/closure/Gate union. Multi-scenario runtime Tasks declare
Suite reuse. Existing runtime authorization is not assumed and missing Gate
implementation is explicit. The standard transport cut has no compatibility
fallback; storage migration is a separately authorized maintenance operation.

This pass accepts the execution model only. It does not approve the user's
North Star, create runtime lifecycle state or prove NCP-G01..NCP-G08.
