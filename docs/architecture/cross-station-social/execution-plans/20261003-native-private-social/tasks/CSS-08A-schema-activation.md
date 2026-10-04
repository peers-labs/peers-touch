# CSS-08A: Exact-Source Schema Activation

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08A-schema-activation","workstreamId":"CSS-W-ACTIVATION","title":"Freeze the final source and activate canonical private Social schema on both Stations","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"slice-schema-activation","journeyId":"SOC-SEC-SCHEMA-ACTIVATION","runtimeClass":"service","writeSet":["docs/architecture/cross-station-social/execution-plans/20261003-native-private-social","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/secure-content/operations.md","tooling/development/secure_content/schema_activation.py"],"readSet":["tooling/development/secure_content","apps/station/app/subserver/social","apps/station/app/subserver/oss","docs/architecture/secure-content"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":7800,"cleanupSeconds":600},"checks":[{"id":"schema-activation-owner","command":"python3 -m unittest tooling.development.secure_content.test_schema_activation tooling.development.secure_content.test_runtime_owner && git diff --check","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-source-freeze","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social source-freeze --work-item cross-station-social-source-freeze --generation-id $(git rev-parse HEAD) --budget-seconds 1800","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-four","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FOUR --profile four --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-five-arm","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FIVEARM --profile fiveArm --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-aggregate","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social aggregate --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --profiles four,fiveArm","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["one source-freeze result binds this Plan, CSS-08A, declaration, workspace, branch, and final source digest","four/station-four and fiveArm/station-five-arm complete fresh serial SCHEMA_ACTIVATION runs against that source","each child uses its own work-item declaration, reset ID, immutable manifest, exact destructive scope, lease, invocation set, COMPLETE journal, service attestation, and post-audit","the aggregate binds both child-result digests and canonical schema attestations","public and non-Social state remain byte-equal and the workspace returns to profile four slot 13 with no reset lease","CSS-09 consumes these attestations before its first private action"],"failureBehavior":["the two profiles never reset concurrently","partial reset, stale source/service identity, scope mismatch, public drift, incomplete journal, or failed cleanup blocks CSS-09","any source change after freeze invalidates the generation and returns execution to the owning source Task before reactivation","activation evidence never substitutes for FINAL_CUT or product proof"],"updatedAt":"2026-10-05T02:30:00+08:00","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-08A source freeze"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-08A activation"}]}
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

The implementation Tasks change the exact source bound by canonical private
schema attestations. Both approved Stations therefore require fresh serial
activation before formal cross-Station product proof.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`chore(social): activate cross-station private schema`.
