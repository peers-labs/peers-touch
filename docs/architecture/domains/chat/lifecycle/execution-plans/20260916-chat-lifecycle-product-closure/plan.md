# Chat Lifecycle Product Closure

> **Status**: completed
> **Branch**: fix/deploy-env-host-guard
> **Workspace ID**: a534541b87e49abf
> **Initial HEAD**: c6d3b79b409013c921fafcb8c735b7f419cc303f

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CHAT-LIFECYCLE-20260916","status":"completed","binding":{"branch":"fix/deploy-env-host-guard","workspaceId":"a534541b87e49abf","initialHead":"c6d3b79b409013c921fafcb8c735b7f419cc303f"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/chat-lifecycle/product-definition.md","docs/architecture/chat-lifecycle/experience-contract.md","docs/architecture/chat-lifecycle/product-state-model.md","docs/architecture/chat-lifecycle/acceptance-matrix.md","docs/architecture/chat-lifecycle/design.md","docs/architecture/chat-lifecycle/integration.md","docs/architecture/api-ownership/README.md","docs/architecture/identity/presence-supervisor.md","docs/architecture/federation/wire-protocol.md","docs/architecture/messaging-platform/design.md","docs/architecture/realtime/voice-video-calls.md","docs/architecture/realtime/group-call-architecture.md"],"decisions":["CHAT-D01","CHAT-D02","CHAT-D03","CHAT-D04","CHAT-D05","CHAT-D06","CHAT-D07","CHAT-D08","CHAT-D09","CHAT-D10","GC-D01","GC-D02","GC-D03","GC-D04","GC-D05","GC-D06"]},"scope":{"sourceClaims":[{"pathPrefix":"debug-chat-experience-failures.md","mode":"exclusive-write"},{"pathPrefix":"debug-native-file-chooser-focus.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/chat-lifecycle","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/api-ownership/station-api-capabilities.yaml","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/identity","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/federation","mode":"shared-read"},{"pathPrefix":"docs/architecture/messaging-platform","mode":"shared-read"},{"pathPrefix":"docs/architecture/prototypes/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/realtime","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/service-coordination.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social/prototype","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social-runtime","mode":"shared-read"},{"pathPrefix":"docs/client/chat","mode":"shared-read"},{"pathPrefix":"model/domain/chat","mode":"exclusive-write"},{"pathPrefix":"model/domain/realtime","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/plugin/server/hertz","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/server","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/accessgate","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor_handler.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/chat","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/constants.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/router.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/router_content_negotiation_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/client-chat-core","mode":"exclusive-write"},{"pathPrefix":"packages/secure-content-core","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"packages/prototypes/desktop/features/social-chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/devctl","mode":"exclusive-write"},{"pathPrefix":"tooling/docker","mode":"exclusive-write"},{"pathPrefix":"tooling/make/local-dev.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/lib/machine-dev-paths.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/deploy","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev","mode":"exclusive-write"}],"nonGoals":["Browser Chat readiness","Scheduled webinars and enterprise meeting administration","Server-side plaintext search or media processing","Conversation Authority hard-cut execution owned by peers-access-gate","Permanent aliases, fallback reads, or dual writes"]},"tasks":[{"id":"CHAT-01-safety","workstreamId":"CHAT-W00","path":"tasks/CHAT-01-safety.md","dependsOn":[],"status":"done","blocker":null},{"id":"CHAT-02-onboarding","workstreamId":"CHAT-W01","path":"tasks/CHAT-02-onboarding.md","dependsOn":["CHAT-01-safety"],"status":"done","blocker":null},{"id":"CHAT-03-direct","workstreamId":"CHAT-W02","path":"tasks/CHAT-03-direct.md","dependsOn":["CHAT-01-safety"],"status":"done","blocker":null},{"id":"CHAT-04-rich-voice","workstreamId":"CHAT-W03","path":"tasks/CHAT-04-rich-voice.md","dependsOn":["CHAT-03-direct"],"status":"done","blocker":null},{"id":"CHAT-05-interactions-group","workstreamId":"CHAT-W04","path":"tasks/CHAT-05-interactions-group.md","dependsOn":["CHAT-04-rich-voice"],"status":"done","blocker":null},{"id":"CHAT-05A-presence-layout","workstreamId":"CHAT-W04A","path":"tasks/CHAT-05A-presence-layout.md","dependsOn":["CHAT-05-interactions-group"],"status":"done","blocker":null},{"id":"CHAT-06-live-voice","workstreamId":"CHAT-W05","path":"tasks/CHAT-06-live-voice.md","dependsOn":["CHAT-05A-presence-layout"],"status":"done","blocker":null},{"id":"CHAT-06-group-live","workstreamId":"CHAT-W05B","path":"tasks/CHAT-06-group-live.md","dependsOn":["CHAT-06-live-voice"],"status":"done","blocker":null},{"id":"CHAT-07-mobile","workstreamId":"CHAT-W06","path":"tasks/CHAT-07-mobile.md","dependsOn":["CHAT-06-group-live"],"status":"descoped","blocker":{"code":"OWNED_BY_MOBILE_WORKTREE","owner":"peers-touch/mobile"}},{"id":"CHAT-08-continuity","workstreamId":"CHAT-W07","path":"tasks/CHAT-08-continuity.md","dependsOn":["CHAT-07-mobile"],"status":"descoped","blocker":{"code":"USER_DESCOPED","owner":"user"}},{"id":"CHAT-09-release","workstreamId":"CHAT-W08","path":"tasks/CHAT-09-release.md","dependsOn":["CHAT-08-continuity"],"status":"descoped","blocker":{"code":"USER_DESCOPED","owner":"user"}}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"denied"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-four","chat-native-disposable"],"destructiveResetScopes":["chat-native-four","chat-native-disposable-station"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "chat-safety": ["chat-lifecycle-safety-e2e"],
    "chat-onboarding": ["chat-lifecycle-onboarding-e2e"],
    "chat-direct": ["chat-lifecycle-direct-e2e"],
    "chat-rich-voice": ["chat-lifecycle-rich-voice-e2e"],
    "chat-interactions-group": ["chat-lifecycle-interactions-group-e2e"],
    "chat-presence-layout": ["chat-presence-layout-e2e"],
    "chat-live-voice": ["chat-lifecycle-live-voice-e2e"],
    "chat-group-live": ["chat-lifecycle-group-live-e2e"],
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
    "chat-presence-layout-e2e",
    "chat-lifecycle-live-voice-e2e",
    "chat-lifecycle-group-live-e2e",
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
    "chat-presence-layout-e2e",
    "chat-lifecycle-live-voice-e2e",
    "chat-lifecycle-group-live-e2e",
    "agent-event-stream-e2e",
    "chat-lifecycle-mobile-e2e",
    "chat-lifecycle-continuity-e2e",
    "chat-lifecycle-release-e2e",
    "chat-lifecycle-full-regression",
    "acceptance-infra-validation", "acceptance-plan-self",
    "acceptance-runtime-provisioning-self", "acceptance-workflow-contract",
    "agent-v2-kernel-foundation-e2e", "agent-v2-capability-binding-e2e",
    "agent-v2-mcp-lifecycle-e2e", "agent-v2-connector-invocation-e2e",
    "agent-v2-governed-tool-loop-e2e", "agent-v2-home-command-center-e2e",
    "agent-v2-evaluation-lab-e2e", "agent-core-lifecycle-native-e2e",
    "agent-stream-resilience-e2e", "agent-native-knowledge-binding-e2e",
    "agent-native-message-forward-e2e", "agent-native-mention-e2e",
    "agent-native-portal-navigation-e2e", "agent-native-connector-lifecycle-e2e",
    "agent-marketplace-catalog-e2e",
    "agent-attachment-e2e", "agent-capability-transparency-e2e",
    "agent-provider-credential-e2e", "agent-quick-completion-e2e",
    "agent-translation-e2e", "agent-follow-up-e2e", "agent-ecosystem-e2e",
    "agent-topic-comments-e2e", "agent-task-e2e",
    "desktop-dev-runtime-isolation-static", "station-agent-unit",
    "station-federation-unit", "station-dashboard-unit",
    "station-dashboard-web-check", "federation-surface-smoke",
    "federation-three-node-e2e",
    "chat-contact-message-resilience-e2e", "chat-desktop-gateway-e2e",
    "chat-friend-request-gateway-e2e", "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e", "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e", "chat-native-recovery-e2e",
    "chat-native-submitted-command-recovery-e2e", "chat-native-two-client-e2e",
    "chat-native-typing-e2e", "chat-native-visible-static",
    "desktop-check", "messaging-platform-contract",
    "federation-desktop-gateway-smoke",
    "mobile-contract-static", "mobile-identity-contract", "mobile-hard-cut-static",
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

Deliver product-grade Chat from account continuity and person discovery through
durable messaging, recorded voice, live one-to-one voice/video, groups, Mobile
parity, and continuity. Current
readiness starts at 0/12 required capabilities proven.

## Dependency Model

```text
W00 safety/evidence integrity
  -> W01 discovery-to-first-message runtime proof
  -> W02 daily Direct lifecycle
  -> W03 rich media and recorded voice
  -> W04 interactions and complete Group lifecycle
  -> W05 live one-to-one voice/video
  -> W05B group live voice/video
  -> W06 Mobile parity
  -> W07 cross-Station, multi-device, recovery continuity
  -> W08 current-source release aggregate
```

W01 and W02 may execute as separate branches after W00 because W02 can use an
existing durable Direct conversation while W01 runtime proof is parked. W02
still does not prove W01, and release remains impossible while either closure
is blocked or unproven. From W02 onward, serial order is intentional because
the closures share Chat UI, Messaging Core, Conversation contracts, and
Acceptance fixtures. One integrator keeps each vertical product result usable
before advancing.

W05B is part of the required product release, but it cannot be selected for
execution until a reviewed group-call SFU/room architecture satisfies
`CHAT-D09`. The dependency remains explicit so Mobile, continuity, and release
cannot silently omit group live calls.

## Cutover Rules

- Remove debug egress and false evidence before product proof.
- Cut each consumer to its canonical owner and delete the replaced path in the
  same closure.
- Do not promote current progress from the superseded NDR or Messaging plans.
- A Task closes only after its focused checks and real functional Journey pass.
- Formal Acceptance runs only after the same Journey reaches
  `FUNCTIONAL_PASS`.

## Completion

The plan completes only when CHAT-G00-G12 and CHAT-G14 pass on current exact
source, every required Desktop/Mobile cell is proven, old owners have zero
references, and quality/completion review has no unresolved required finding.
