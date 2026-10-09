# CSS-02C: Federation-Bound Group Snapshot

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-02C-group-snapshot","workstreamId":"CSS-W-SOURCE","title":"Bind the Conversation-owned Group snapshot and submit fence to one Federation","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-group-snapshot","journeyId":"SOC-SEC-AS18-GROUP-SNAPSHOT","runtimeClass":"source-only","writeSet":["apps/station/app/subserver/conversation","apps/station/app/subserver/social"],"readSet":["docs/architecture/shared/security/secure-content/decisions.md","docs/architecture/domains/social/cross-station","model/domain/social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":120},"checks":[{"id":"group-snapshot-source","command":"(cd apps/station && go test -race ./app/subserver/conversation/... ./app/subserver/social/... -run 'Test.*GroupRecipientSnapshot|Test.*SubmitFence') && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Conversation remains the only Group membership owner","Conversation and Social value projections include the canonical Federation ID with Conversation ID, membership epoch, authority head, ordered members, and Home Stations","prepare and submit compare the complete snapshot byte for byte while preserving Conversation-lock-before-Social-UOW order","stale Federation ID, membership epoch, authority head, member set, or Home Station rejects before the Social commit callback","CSS-02D consumes this source closure; CSS-09 is its only direct functional successor"],"failureBehavior":["this source closure does not claim federated Group product support","Social gains no Conversation repository or mutation access","no remote Conversation query, compatibility field, second snapshot owner, or partial commit path is introduced","Native product behavior remains UNPROVEN until CSS-08A and CSS-09"],"updatedAt":"2026-10-03T22:58:33Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"group-snapshot-source: declared Conversation/Social race check PASS; all five stale snapshot dimensions reject before callback; canonical Federation ID round-trip and adapter mapping PASS; full affected-package race suite PASS; independent review found no findings; diff validation PASS"}]}
```

## Current Snapshot

The current snapshot freezes Conversation identity and membership authority but
does not include the Federation ID required to admit remote Group members.

## Timebox And Checkpoint

Agent timebox: 2 hours. Commit:
`feat(social): bind group snapshots to federation`.

## Concurrency Decision

Execution is hybrid. Two read-only lanes inspect the Conversation capability
and Social projection/fence paths in parallel. The integrator owns every write,
test, Session transition, plan update, commit, and Gate. Conversation lock
acquisition, Social UOW execution, and their reconciliation remain serial
because the accepted lock order is Conversation first and Social second.
