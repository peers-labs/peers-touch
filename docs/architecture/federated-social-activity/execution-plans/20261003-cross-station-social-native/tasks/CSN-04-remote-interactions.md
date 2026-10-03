# CSN-04: Remote Private Interactions

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-04-remote-interactions","workstreamId":"CSN-W04","title":"Route private Comment and Reaction to source Social authority","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-interactions","journeyId":"SOC-SEC-J11","runtimeClass":"service","writeSet":["apps/station/app/subserver/social"],"readSet":["apps/station/frame/core/federation","model/domain/social","docs/architecture/federated-social-activity"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":2400,"cleanupSeconds":120},"checks":[{"id":"cross-station-interaction-source","command":"cd apps/station && go test -race ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"social-cross-station-interaction","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-interaction","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["actor Home Station persists one signed command and durable outbox record","source Post Station revalidates parent access and commits one canonical interaction","typed result converges both actor projections","comment drafts survive retryable and unknown outcomes"],"failureBehavior":["deleted parent, revoked grant, rate limit and hash conflict do not write interactions","retry uses the same command identity","recipient Station never becomes interaction authority"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSN-04 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending AS20 proof"}]}
```

## Current Snapshot

- Same-Station private Comment and Reaction authority exists.
- Cross-Station Friend Request already demonstrates command/result delivery.
- No private interaction command returns to a remote source Post authority.

## Closure

Alice and Bob converge on one source-authoritative Comment/Reaction across
outage and replay.

## Concurrency Decision

May execute in parallel with CSN-05 after CSN-03; source file ownership must be
partitioned before declarations are granted.
