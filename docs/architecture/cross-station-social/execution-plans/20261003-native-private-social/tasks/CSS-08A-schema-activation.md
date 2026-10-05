# CSS-08A: Exact-Source Schema Activation

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08A-schema-activation","workstreamId":"CSS-W-ACTIVATION","title":"Freeze the final source and activate canonical private Social schema on both Stations","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"slice-schema-activation","journeyId":"SOC-SEC-SCHEMA-ACTIVATION","runtimeClass":"service","writeSet":["docs/architecture/cross-station-social/execution-plans/20261003-native-private-social","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/secure-content/operations.md","tooling/development/secure_content/schema_activation.py","apps/station/app/subserver/social/infrastructure/secure_content_reset_store.go","tooling/development/secure_content/test_schema_activation.py"],"readSet":["tooling/development/secure_content","apps/station/app/subserver/social","apps/station/app/subserver/oss","docs/architecture/secure-content"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":7800,"cleanupSeconds":600},"checks":[{"id":"schema-activation-owner","command":"python3 -m unittest tooling.development.secure_content.test_schema_activation tooling.development.secure_content.test_runtime_owner && git diff --check","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-source-freeze","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social source-freeze --work-item cross-station-social-source-freeze --generation-id $(git rev-parse HEAD) --budget-seconds 1800","verificationClass":"SOURCE_CHECK"},{"id":"schema-activation-four","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FOUR --profile four --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-five-arm","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social run --workstream CSS-SCHEMA-FIVEARM --profile fiveArm --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --budget-seconds 3600","verificationClass":"FUNCTIONAL_CHECK"},{"id":"schema-activation-aggregate","command":"python3 -m tooling.development.secure_content.schema_activation --owner cross-station-social aggregate --intent SCHEMA_ACTIVATION --generation-id $(git rev-parse HEAD) --profiles four,fiveArm","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["one source-freeze result binds this Plan, CSS-08A, declaration, workspace, branch, and final source digest","four/station-four and fiveArm/station-five-arm complete fresh serial SCHEMA_ACTIVATION runs against that source","each child uses its own work-item declaration, reset ID, immutable manifest, exact destructive scope, lease, invocation set, COMPLETE journal, service attestation, and post-audit","the aggregate binds both child-result digests and canonical schema attestations","public and non-Social state remain byte-equal and the workspace returns to profile four slot 13 with no reset lease","CSS-09 consumes these attestations before its first private action"],"failureBehavior":["the two profiles never reset concurrently","partial reset, stale source/service identity, scope mismatch, public drift, incomplete journal, or failed cleanup blocks CSS-09","any source change after freeze invalidates the generation and returns execution to the owning source Task before reactivation","activation evidence never substitutes for FINAL_CUT or product proof"],"updatedAt":"2026-10-06T06:58:00+08:00","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"product source-freeze generation 5c271d3670081891949f925daf3ee2cabb1b53ee; result digest 265a5bd15f13b19ed2baa725f2b1bffecde6540eb6447ce8a08300d7928c5a25; checkpoint receipt a98c6228076700850fb4cbc0ee56a0242f864504a3194044e1f8d42fb1f3d0ad"},{"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"four reset 30adb8108ed54bf5adf4c42858cd0534 result 3e1e06fcfd89d096d6b2b99c6b7685c68295c98b4fa51af467ed49b837a020c6 attestation a71384061ebb42cbab0d20573523bf15fb065be6beaff3c2debd075bb4106deb; fiveArm reset 999a465ffebf410b918f4cbc7125250f result 3494d5a511dabe95e143d4c750692faff2a519e8194f6c6cb709c926b546d660 attestation f208f43fe608220b3e71b0c7af21415ded255280c08f27263b8ca4724718e188; aggregate 3d0537aa972bae9c8e90ae5079dee7461749942ec33d93fa9cda5d70a769954f; journals COMPLETE; profile restored to four slot 13"}]}
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

Product generation `5c271d3670081891949f925daf3ee2cabb1b53ee` is frozen
and activated serially on `four` and `fiveArm`. Both journals are `COMPLETE`,
both canonical schema attestations are bound by aggregate
`3d0537aa972bae9c8e90ae5079dee7461749942ec33d93fa9cda5d70a769954f`,
and profile `four` slot 13 is restored. CSS-09 consumed these attestations from
current control commit `ce56fcd4464513cb1b8b2376ee19b8a0f08eae01`; later
control-plane-only Gate amendments did not rebuild or redeploy either Station.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`chore(social): activate cross-station private schema`.
