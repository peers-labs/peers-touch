# Unified Relay Plan v5 Review

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

## Review Target

- Package:
  `docs/architecture/platform/station/access/execution-plans/20261006-unified-relay-station-access-v5/plan.md`
- Mounted predecessor:
  `docs/architecture/platform/station/access/execution-plans/20261006-unified-relay-station-access-v4/plan.md`
- Product and architecture sources:
  `docs/architecture/platform/station/access/` and
  `docs/architecture/domains/federation/`

## Mechanical Delta

The v4 Development runner rejected the current closure with
`ACCEPTANCE_PLAN_DRIFT` after the exact-source
`relay-role-security-contract` reached `PASS/DONE/PROVEN` at
`0c04bb2a1ffac52e44832639e7744e40a6557463`.

v5 adds the 16 Gates reported by the active Acceptance registry to both the
completion and full inventories:

- `acceptance-infra-validation`
- `acceptance-plan-self`
- `acceptance-runtime-provisioning-self`
- `acceptance-workflow-contract`
- `chat-lifecycle-call-resolution-e2e`
- `chat-lifecycle-mixed-client-cross-station-e2e`
- `chat-lifecycle-mixed-client-group-mls-e2e`
- `chat-lifecycle-mixed-client-multi-device-e2e`
- `chat-lifecycle-mixed-client-same-station-e2e`
- `mobile-ios-simulator-layout-accessibility-e2e`
- `mobile-simulator-station-lifecycle-e2e`
- `station-access-capability-contract`
- `station-access-desktop-oauth-native-e2e`
- `station-access-domain-validation`
- `station-access-federation-boundary-e2e`
- `station-access-lifecycle-aggregate-e2e`

No closure mapping, Task Slice, dependency, Journey, architecture decision,
runtime authorization, or proof-strength requirement changes.

## Findings-First Checklist

1. v4 remains byte-stable and v5 has a distinct version identity and package.
2. The added Gates exactly equal the current runner's reported missing set.
3. Every added Gate exists in the active Gate catalog.
4. Closure mappings, Task slices, dependency DAG, and accepted semantics are
   unchanged except for Task 1's version-specific snapshot note.
5. Runtime authorization remains limited to `sixwin` and `three`; `one`
   remains excluded.
6. Push, pull request, history rewrite, destructive reset, and secret commits
   remain denied.
7. v5 is validated but remains unmounted pending explicit Owner approval.

## Verdict

Passed. The v5 package is a mechanical Gate-inventory correction:

- `make plan-validate` passes with digest
  `b2f6e4c2a62d8e2152f12a2f16ff2fe46d9afc4f2461737390dcd440daf17223`;
- the completion and full additions are the same 16-Gate set reported by the
  formal Development runner, with no duplicate or missing entry;
- v4 remains byte-stable;
- the four OAuth Gates emitted by the broad non-formal planner are correctly
  excluded from this amendment because the formal runner did not require them.

Residual risk: v5 is not mounted and its complete Development closure has not
run. Mounting must follow explicit Owner approval.
