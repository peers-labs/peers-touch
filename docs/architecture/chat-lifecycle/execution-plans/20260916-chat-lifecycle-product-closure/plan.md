# Chat Lifecycle Product Closure

> **Status**: active
> **Branch**: fix/deploy-env-host-guard
> **Workspace ID**: a534541b87e49abf
> **Initial HEAD**: c6d3b79b409013c921fafcb8c735b7f419cc303f
> **Expected HEAD**: adc059bddca7a0cd77534433057705416190444f
> **Worktree-set Digest**: 35f0ea99b3cfef1e4b7dd6df54ea74f34fcb2b7caf18ba60af138f0c6c1c06cb

## Plan Package

```json
{"schemaVersion":1,"kind":"peers-touch-plan-package","planId":"CHAT-LIFECYCLE-20260916","status":"active","binding":{"branch":"fix/deploy-env-host-guard","workspaceId":"a534541b87e49abf","initialHead":"c6d3b79b409013c921fafcb8c735b7f419cc303f","expectedHead":"adc059bddca7a0cd77534433057705416190444f","worktreeSetDigest":"35f0ea99b3cfef1e4b7dd6df54ea74f34fcb2b7caf18ba60af138f0c6c1c06cb"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/chat-lifecycle/product-definition.md","docs/architecture/chat-lifecycle/experience-contract.md","docs/architecture/chat-lifecycle/product-state-model.md","docs/architecture/chat-lifecycle/acceptance-matrix.md","docs/architecture/chat-lifecycle/design.md","docs/architecture/chat-lifecycle/integration.md","docs/architecture/messaging-platform/design.md","docs/architecture/realtime/voice-video-calls.md"],"decisions":["CHAT-D01","CHAT-D02","CHAT-D03","CHAT-D04","CHAT-D05","CHAT-D06","CHAT-D07","CHAT-D08"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/architecture/chat-lifecycle","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/messaging-platform","mode":"shared-read"},{"pathPrefix":"docs/architecture/realtime","mode":"shared-read"},{"pathPrefix":"docs/architecture/social-runtime","mode":"shared-read"},{"pathPrefix":"docs/client/chat","mode":"shared-read"},{"pathPrefix":"model/domain/chat","mode":"exclusive-write"},{"pathPrefix":"model/domain/realtime","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/client-chat-core","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/lib/machine-dev-paths.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/deploy/source_sync.py","mode":"exclusive-write"}],"nonGoals":["Browser Chat readiness","Group voice or video conferencing","Server-side plaintext search or media processing","Conversation Authority hard-cut execution owned by peers-access-gate","Permanent aliases, fallback reads, or dual writes"]},"tasks":[{"id":"CHAT-01-safety","workstreamId":"CHAT-W00","path":"tasks/CHAT-01-safety.md","dependsOn":[],"status":"done","blocker":null},{"id":"CHAT-02-onboarding","workstreamId":"CHAT-W01","path":"tasks/CHAT-02-onboarding.md","dependsOn":["CHAT-01-safety"],"status":"in_progress","blocker":null},{"id":"CHAT-03-direct","workstreamId":"CHAT-W02","path":"tasks/CHAT-03-direct.md","dependsOn":["CHAT-02-onboarding"],"status":"pending","blocker":null},{"id":"CHAT-04-rich-voice","workstreamId":"CHAT-W03","path":"tasks/CHAT-04-rich-voice.md","dependsOn":["CHAT-03-direct"],"status":"pending","blocker":null},{"id":"CHAT-05-interactions-group","workstreamId":"CHAT-W04","path":"tasks/CHAT-05-interactions-group.md","dependsOn":["CHAT-04-rich-voice"],"status":"pending","blocker":null},{"id":"CHAT-06-live-voice","workstreamId":"CHAT-W05","path":"tasks/CHAT-06-live-voice.md","dependsOn":["CHAT-05-interactions-group"],"status":"pending","blocker":null},{"id":"CHAT-07-mobile","workstreamId":"CHAT-W06","path":"tasks/CHAT-07-mobile.md","dependsOn":["CHAT-06-live-voice"],"status":"pending","blocker":null},{"id":"CHAT-08-continuity","workstreamId":"CHAT-W07","path":"tasks/CHAT-08-continuity.md","dependsOn":["CHAT-07-mobile"],"status":"pending","blocker":null},{"id":"CHAT-09-release","workstreamId":"CHAT-W08","path":"tasks/CHAT-09-release.md","dependsOn":["CHAT-08-continuity"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"denied"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "schemaVersion": 1,
  "closures": {
    "chat-safety": ["chat-lifecycle-safety-e2e"],
    "chat-onboarding": ["chat-lifecycle-onboarding-e2e"],
    "chat-direct": ["chat-lifecycle-direct-e2e"],
    "chat-rich-voice": ["chat-lifecycle-rich-voice-e2e"],
    "chat-interactions-group": ["chat-lifecycle-interactions-group-e2e"],
    "chat-live-voice": ["chat-lifecycle-live-voice-e2e"],
    "chat-mobile": ["chat-lifecycle-mobile-e2e"],
    "chat-continuity": ["chat-lifecycle-continuity-e2e"],
    "chat-release": ["chat-lifecycle-release-e2e"]
  },
  "completion": [
    "chat-lifecycle-safety-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-rich-voice-e2e",
    "chat-lifecycle-interactions-group-e2e",
    "chat-lifecycle-live-voice-e2e",
    "chat-lifecycle-mobile-e2e",
    "chat-lifecycle-continuity-e2e",
    "chat-lifecycle-release-e2e"
  ],
  "full": [
    "chat-lifecycle-safety-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-rich-voice-e2e",
    "chat-lifecycle-interactions-group-e2e",
    "chat-lifecycle-live-voice-e2e",
    "chat-lifecycle-mobile-e2e",
    "chat-lifecycle-continuity-e2e",
    "chat-lifecycle-release-e2e",
    "chat-lifecycle-full-regression",
    "acceptance-infra-validation", "acceptance-plan-self",
    "acceptance-runtime-provisioning-self", "acceptance-workflow-contract",
    "chat-contact-message-resilience-e2e", "chat-desktop-gateway-e2e",
    "chat-friend-request-gateway-e2e", "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e", "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e", "chat-native-recovery-e2e",
    "chat-native-submitted-command-recovery-e2e", "chat-native-two-client-e2e",
    "chat-native-typing-e2e", "chat-native-visible-static",
    "desktop-check", "messaging-platform-contract",
    "federation-desktop-gateway-smoke",
    "mobile-contract-static", "mobile-hard-cut-static",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-native-access-e2e", "mobile-native-chat-contacts-e2e",
    "mobile-native-lifecycle-e2e", "mobile-native-moments-e2e",
    "mobile-native-platform-e2e",
    "mobile-native-recovery-e2e", "mobile-native-recovery-ui-e2e",
    "mobile-native-settings-e2e", "mobile-native-social-convergence-e2e",
    "mobile-simulator-access-e2e", "mobile-simulator-chat-contacts-e2e",
    "mobile-simulator-runtime-lifecycle-e2e", "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-station-lifecycle-e2e", "proto-build",
    "station-api-ownership",
    "station-messaging-unit"
  ]
}
```

## Goal

Deliver product-grade Chat from person discovery through durable messaging,
recorded voice, live voice, groups, Mobile parity, and continuity. Current
readiness starts at 0/11 required capabilities proven.

## Dependency Model

```text
W00 safety/evidence integrity
  -> W01 discovery-to-first-message
  -> W02 daily Direct lifecycle
  -> W03 rich media and recorded voice
  -> W04 interactions and complete Group lifecycle
  -> W05 live one-to-one voice
  -> W06 Mobile parity
  -> W07 cross-Station, multi-device, recovery continuity
  -> W08 current-source release aggregate
```

The serial order is intentional: these closures share Chat UI, Messaging Core,
Conversation contracts, and Acceptance fixtures. One integrator keeps each
vertical product result usable before advancing.

## Cutover Rules

- Remove debug egress and false evidence before product proof.
- Cut each consumer to its canonical owner and delete the replaced path in the
  same closure.
- Do not promote current progress from the superseded NDR or Messaging plans.
- A Task closes only after its focused checks and real functional Journey pass.
- Formal Acceptance runs only after the same Journey reaches
  `FUNCTIONAL_PASS`.

## Completion

The plan completes only when CHAT-G00-G13 pass on current exact source, every
required Desktop/Mobile cell is proven, old owners have zero references, and
quality/completion review has no unresolved required finding.
