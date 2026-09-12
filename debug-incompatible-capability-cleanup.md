# Debug Session: incompatible-capability-cleanup
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation Gate reaches `BASE-INCOMPATIBLE_CAPABILITY / browser / en / single` but the Harness reports `agent.acceptance.foundationIncompatibleCapabilityCleanupFailed`.
- **Debug Server**: `http://127.0.0.1:7787/event`
- **Log File**: `.dbg/trae-debug-log-incompatible-capability-cleanup.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify local and live Station source identity at `795b063e294c834f5a5f902f32b118455c8029f3`.
3. Run C08 and require `DONE / PROVEN`.
4. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate.
5. Observe Browser `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001`.

Pre-fix evidence:
- Gate run: `20260911T144617919957Z-488bd7f90445a030728100fb38fc6611`
- Aggregate run: `20260911T144617762479Z-489613d497b02ead168adbf4af8b84b7`
- Failure: `agent.acceptance.foundationIncompatibleCapabilityCleanupFailed`
- Provisioner cleanup and secret scan: passed
- Instrumented checkpoint run
  `20260911T154504429998Z-909db68477dae4e6ff1851f9610aaf1b`
  on `1e6f8c290bdb9aed694046eb1f129117d616fbf2` failed earlier at
  `agent.acceptance.foundationIncompatibleCapabilityProviderFixtureMissing`.
  It did not enter scenario cleanup, which is consistent with a fixture
  provider left configured by the preceding cleanup failure.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Scenario cleanup reaches an already-absent conversation or Agent and misclassifies canonical `NOT_FOUND` as failure. | High | Low | Rejected for the current failure: the new run stops at provider precondition before creating a conversation or Agent. |
| B | The capability binding is already tombstoned or removed, but cleanup repeats deletion with stale revision state. | Medium | Low | Rejected for the current failure: no stale `foundation-incompatible-*` Agent or binding exists. |
| C | Fixture provider restoration succeeds partially but the final version/credential assertion throws. | Medium | Low | Confirmed and refined: the provider control response cannot be decoded by the Desktop Rust wire DTO, so create persists `version=1` before failing and delete misclassifies the provider as absent. |
| D | Restoring the prior selected Agent fails after disposable Agent deletion or navigation reset. | Medium | Low | Rejected for the current failure: the scenario stops before selection mutation. |

## Log Evidence
- Exact-source Foundation run
  `20260911T170543628428Z-e3b5ae2fe8a6c5ec41f421eaf6e3fce3`
  on `ada4295633891d70b9039b20b7f6a825804a2130` reached Browser
  `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001` after the same-source
  C08 run passed 19/19.
- The `provider-precondition` event records every prerequisite as valid except
  `fixtureProviderVersion=1`; `fixtureCredentialPresent=false`.
- Read-only Station DB evidence shows exactly one `anthropic` provider row for
  Alice, created at `2026-09-11 15:16:10.571182+00`, with `version=1`, enabled,
  the catalog base URL, and an empty key vault. No
  `foundation-incompatible-*` Agent or capability binding remains.
- Station's public provider response is `AgentProviderInfo`. It omits the
  internal `actor_ptid`, `display_name`, and `cli_command` fields required by
  the old Desktop Rust `StationProvider` decoder. `createProvider` therefore
  persisted the provider before response decoding failed; `deleteProvider`
  decoded the provider list through the same incompatible DTO and silently
  converted the error to an empty list, returning NotFound before deletion.

## Instrumentation
- `A-D`: records whether the scenario had already failed and which cleanup
  resources were created.
- `A`: records conversation and Agent deletion boundaries.
- `B`: records active-binding presence and binding deletion completion.
- `C`: records fixture-provider readback and deletion completion.
- `D`: records prior-selection restoration.
- `A-D`: records the exact cleanup stage and normalized error code on failure,
  or all final safe cleanup booleans on success.
- `A-C`: records the provider/model precondition as safe booleans and the
  fixture provider version before the fail-closed prerequisite.

## Verification Conclusion
The current failure is not an Ark or product-runtime failure. It is a
Desktop-BFF wire-decoding defect followed by a non-idempotent Acceptance
Fixture precondition. The local fix:

1. aligns `StationProvider` with the public Station provider response and
   propagates provider-list decode errors instead of converting them to an
   empty list;
2. removes a configured fixed `anthropic` Fixture record before validating the
   catalog baseline, then re-reads and requires `version=0` with no credential;
3. retains the cleanup instrumentation with `runId=post-fix`.

Focused Rust wire decoding, Desktop typecheck, the 85-test Agent native static
suite, and diff hygiene pass. Exact-source C08 and Foundation post-fix evidence
remain pending.

## Iteration 2: Authoritative Cleanup Readback

Exact-source Foundation run
`20260911T231733779911Z-ca94e3b2c6d9c4870f95d3ddabee4c02`
on `43f94f5ef0838dd51ea458857e4f025ce135559a` reached Browser English
`BASE-INCOMPATIBLE_CAPABILITY` and failed only `stationReadinessReadback` and
`cleanupComplete`. Its current telemetry proves:

- the scenario completed and produced facts;
- conversation archive, binding delete, Agent delete, and provider delete all
  returned successfully;
- the final provider catalog baseline was restored and the prior Agent
  selection matched;
- the strict failed-Turn union remained one source-bound diagnostic Turn.

The three false cleanup booleans came from the producer's verification:

- permanent Conversation archive is a durable `status=deleted` transition, but
  the producer treated every successful get as not deleted;
- Agent and binding readbacks used string containment on a canonical
  not-found error instead of the established `isFoundationResourceNotFound`
  decoder.

The local correction accepts only the authoritative Conversation deleted
status or canonical not-found and uses the same canonical not-found decoder for
Agent and binding readback. Readiness telemetry now records each remaining
oracle predicate as safe booleans and counts. The independent oracle, product
behavior, tuples, and timeouts are unchanged.

Source reconciliation also found the readiness failure: Station admission
increments the Conversation version exactly once when it persists the rejected
failed Turn, and the TypeScript producer already requires
`conversationVersionAfter = conversationVersionBefore + 1`. The independent
Python oracle and its valid fixture still required equality. They now require
the same exact `+1` transition, preserving the one-failed-Turn contract rather
than weakening it.

Local verification:

- Desktop strict check: PASS.
- Focused Harness/independent-oracle tests: `206/206` PASS.
- `git diff --check`: PASS.
- Exact-source post-fix C08 and Foundation evidence remain pending.

## Iteration 3: Child Readback Before Parent Deletion

Exact-source C08 run
`20260912T033904525557Z-d6822c40db31c543386eb94ec994b4e0`
completed `DONE / PROVEN` on
`1362900aa41d2afa2d7f912fb34f8abc1e6bf30d`.
The same-source Foundation run
`20260912T034122773227Z-6f85ea63620dd1dca04bff43347bb8ba`
crossed AS-F06 and `BASE-CANCELLED`, then failed only
`BASE-INCOMPATIBLE_CAPABILITY / cleanupComplete`.

Fresh cleanup telemetry proves:

- Conversation deletion readback returned `status=deleted`.
- Agent deletion returned canonical not-found.
- Binding deletion completed and the active binding count was zero.
- The final binding readback ran after deleting the parent Agent, so the
  Desktop API surfaced `agent.capabilityBindingListFailed` instead of a
  binding-level not-found code.
- Provider restoration, prior selection restoration, and all remaining cleanup
  booleans passed.

The local correction verifies zero active bindings immediately after binding
deletion while the parent Agent still exists, then carries that verified result
into final cleanup facts. It no longer calls the child-list API after deleting
the parent Agent. Conversation and Agent readbacks retain their existing
canonical deletion checks. Exact-source post-fix proof is pending.
