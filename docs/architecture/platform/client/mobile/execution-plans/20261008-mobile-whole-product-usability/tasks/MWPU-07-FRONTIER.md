# MWPU-07-FRONTIER: Final Exact-Source Functional Frontier

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"mobile-whole-product-usability-20261008","taskId":"MWPU-07-FRONTIER","workstreamId":"MWPU-PROOF","title":"Rerun and remediate the complete Android, Desktop, and iOS product frontier","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"mobile-final-functional-frontier","journeyId":"MS-J08","runtimeClass":"native-mobile","writeSet":["apps/desktop","apps/mobile/src","apps/mobile/src-tauri/src","apps/mobile/scripts","apps/station","docs/architecture/platform/client/mobile/prototype","packages/locales","packages/prototypes/desktop","packages/prototypes/mobile/chat","packages/prototypes/shared","tooling/acceptance/gates/mobile","docs/architecture","docs/client","go.work.sum","model","packages/messaging-core","tooling/development/secure_content"],"readSet":["docs/architecture/domains/chat","docs/architecture/domains/social","docs/architecture/platform/client/mobile","docs/architecture/platform/station/access","docs/client/common/ui-identity","docs/client/desktop","docs/client/mobile","docs/architecture/shared/security/secure-content"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":10800,"cleanupSeconds":600},"checks":[{"id":"three-client-final-functional-source","command":"pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check && go test ./apps/station/app/subserver/conversation/... ./apps/station/app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"three-client-final-functional","command":"node apps/mobile/scripts/run-three-client-product-journey.mjs --phase all","verificationClass":"FUNCTIONAL_CHECK"},{"id":"three-client-final-functional-ux-review","command":"node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set all --mode review","verificationClass":"UX_REVIEW"}],"runtimeReuse":{"scope":"suite","entryCheckId":"three-client-final-functional","scenarioIds":["entry","shell","direct","group","voice","call","social","recovery"],"maxProvisioningRuns":1,"maxClientLaunches":3,"minWarmReuseRate":0.85,"requireAttachOnlyScenarios":true,"requireReceiverVisibleProof":true,"allowClientReplacement":false},"doneWhen":["all earlier closures are rerun against the final Desktop, Mobile, Station, shared locale, runtime, and component source","Android Alice, Desktop Bob, and iOS Coral complete the full foreground journey without stale binaries or stale sessions","any regression discovered here is fixed at its owning page or shared layer and the complete frontier is rerun","the final exact-source functional result is ready for formal Acceptance promotion"],"failureBehavior":["do not promote stale page evidence after shared-source changes","do not enter formal Acceptance until this complete frontier passes","do not defer a source-backed visual finding to the aggregate Task"],"updatedAt":"2026-10-08T00:00:00.000Z"}
```

## Current iOS Execution Frontier

The owner-approved current Run uses two native iOS simulators and one real
Station. Android remains deferred. Agent settings retain their current source
but are visible as disabled `pending` entries and are excluded from functional
claims.

Owner decision
`trae-chat:6ac3c21a832b0391483a590a:20261015:authorize-chat-native-five-social-private-reset-and-checkpoint`
authorizes a local checkpoint, exact-source deployment of `chat-native-five`,
and one SC-D30 `SCHEMA_ACTIVATION` reset of
`chat-native-five-social-private`. The reset must use the canonical SC-D23
owner and preserve public and non-Social state.

The frontier is serial and observable:

1. Shell, recovery overlays, deferred status composition, Tabbar, safe areas.
2. Station selection, identity, login/PIN, resume, restart, logout.
3. Contacts, discovery, requests, profile, search, group creation.
4. Direct Chat complete message and recovery lifecycle.
5. Group Chat complete membership, administration and destructive lifecycle.
6. One-to-one audio/video Call signaling, media truth and cleanup.
7. Moments Home/Public/Circles complete publish and interaction lifecycle.
8. Me and every non-Agent Settings section.
9. Final cold-start dual-iOS whole-product rerun and resource release.

Each frontier item must close the same loop:

```text
confirmed prototype states
  -> production implementation
  -> focused source checks
  -> native iOS A action
  -> native iOS B receiver-visible readback
  -> screenshot comparison
  -> failure/recovery proof
  -> resource audit
```

An item stays open when behavior exists but prototype composition, visible
state, copy, geometry, receiver readback or recovery is incomplete. Source
presence, unit tests, Harness results and API responses cannot advance this
frontier by themselves.

## Current Snapshot

- Page Tasks are serial and share `styles.css`, localization, runtime, and
  common component sources.
- Without a final all-surface rerun, later page fixes can invalidate earlier
  foreground evidence while leaving each historical Task marked done.
