# CSS-08A: Exact-Source Schema Activation

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08A-schema-activation","workstreamId":"CSS-W-ACTIVATION","title":"Freeze the final source and activate canonical private Social schema on both Stations","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"slice-schema-activation","journeyId":"SOC-SEC-SCHEMA-ACTIVATION","runtimeClass":"service","writeSet":["docs/architecture/domains/social/cross-station/execution-plans/20261003-native-private-social","docs/architecture/shared/security/secure-content/decisions.md","docs/architecture/shared/security/secure-content/data-model.md","docs/architecture/shared/security/secure-content/operations.md","tooling/development/secure_content/schema_activation.py","apps/station/app/subserver/social/infrastructure/secure_content_reset_store.go","tooling/development/secure_content/test_schema_activation.py"],"readSet":["tooling/development/secure_content","apps/station/app/subserver/social","apps/station/app/subserver/oss","docs/architecture/shared/security/secure-content"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":7800,"cleanupSeconds":600},"checks":[{"id":"schema-activation-owner","command":"python3 -m unittest tooling.development.secure_content.test_schema_activation tooling.development.secure_content.test_runtime_owner && git diff --check","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-source-freeze","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social source-freeze --work-item cross-station-social-source-freeze --generation-id $(git rev-parse HEAD) --budget-seconds 1800","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-four","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FOUR --profile four --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-five-arm","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FIVEARM --profile fiveArm --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-aggregate","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social aggregate --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --profiles four,fiveArm","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["one source-freeze result binds this Plan, CSS-08A, declaration, workspace, branch, and final source digest","four/station-four and fiveArm/station-five-arm complete fresh serial SCHEMA_ACTIVATION runs against that source","each child uses its own work-item declaration, reset ID, immutable manifest, exact destructive scope, lease, invocation set, COMPLETE journal, service attestation, and post-audit","the aggregate binds both child-result digests and canonical schema attestations","public and non-Social state remain byte-equal and the workspace returns to profile four slot 13 with no reset lease","CSS-09 consumes these attestations before its first private action"],"failureBehavior":["the two profiles never reset concurrently","partial reset, stale source/service identity, scope mismatch, public drift, incomplete journal, or failed cleanup blocks CSS-09","any source change after freeze invalidates the generation and returns execution to the owning source Task before reactivation","activation evidence never substitutes for FINAL_CUT or product proof"],"updatedAt":"2026-10-06T12:30:00+08:00","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"exact source-freeze generation d825232ea171f05fa3ca2d9b2e2b539b8b85a560; result digest 8de40e4ef792107f9aa44129c143af0e1fbeaf757ae373d2baa3872093f85162; checkpoint receipt 4dc5ba2f6ca1cdaae6bb9478294be789580e8c9117450b7663109859a9fb3b01"},{"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"four reset 176633fc0862403291f75d176144acf1 result 07aef4c7db116c9f7a645323f30313e239b0cdffcac8f89fddd96f41a7ec5734 attestation c3c00e442a5f79775ae912b27d987f07bda2adf18729ada613db08744b76ed52; fiveArm reset 6b1b05062e8145da91dab674519aca5d result 52fd5604720700c97c0abfd22fcc12dbf979a216ad702d1f300f63d3edd51e3d attestation eeed83ca20122da16011d3ea7b1e2289582b6f68a382cf318c76549d7d33651b; aggregate ea10802e0266cba4e6ccf651ff85e75d74d8bcf28305dfb2ddb382db39363e2e; journals COMPLETE; profile restored to four slot 13"}]}
```

## Mechanical Source Amendment

The first `four` pre-reset audit proved that Station's canonical reset owner
already includes the five receiver-side private Social tables introduced by
the accepted cross-Station design, while the Python activation owner and
SC-D23 documentation retained the older fourteen-table list. CSS-08A updates
that list to the same dependency order as
`CanonicalDatabaseResetTargets`. No reset executed before the mismatch was
reported, and no public, Conversation, Identity, Key Exchange, Recovery, or
Federation governance table is added.

## Current Snapshot

Exact product and evidence source
`d825232ea171f05fa3ca2d9b2e2b539b8b85a560` is frozen and activated
serially on `four` and `fiveArm`. Both journals are `COMPLETE`, both canonical
schema attestations are bound by aggregate
`ea10802e0266cba4e6ccf651ff85e75d74d8bcf28305dfb2ddb382db39363e2e`,
and profile `four` slot 13 is restored. CSS-09 consumed these same-source
attestations. A later evidence-only documentation commit changes no product,
runtime, schema, Gate, or Acceptance behavior and is not relabeled as
runtime-proven source.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`chore(social): activate cross-station private schema`.
