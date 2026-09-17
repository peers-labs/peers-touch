# Modern Chat Agent V2 Alignment - Plan Package

> **Status**: active
> **Branch**: feat/p0-streaming-runtime-message-actions
> **Workspace ID**: 65e7b6da4dc9be85
> **Initial HEAD**: dcf0813ea23d73256cf21173d75516b6c36f68b4
> **Expected HEAD**: f049151fe8633e18cbb7e5d4d1f1b8ec2741bb87
> **Worktree-set Digest**: a74d45cfd3380790eff01f1a4b3b0f539aea3230d2313a0e21219dc395ad9546

## Plan Package

```json
{"schemaVersion":1,"kind":"peers-touch-plan-package","planId":"modern-chat-agent-v2-alignment-20260917","status":"active","binding":{"branch":"feat/p0-streaming-runtime-message-actions","workspaceId":"65e7b6da4dc9be85","initialHead":"dcf0813ea23d73256cf21173d75516b6c36f68b4","expectedHead":"f049151fe8633e18cbb7e5d4d1f1b8ec2741bb87","worktreeSetDigest":"a74d45cfd3380790eff01f1a4b3b0f539aea3230d2313a0e21219dc395ad9546"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/agent/modern-chat-agent/product-definition.md","docs/architecture/agent/modern-chat-agent/experience-contract.md","docs/architecture/agent/modern-chat-agent/product-state-model.md","docs/architecture/agent/modern-chat-agent/design.md","docs/architecture/agent/modern-chat-agent/decisions.md","docs/architecture/agent/modern-chat-agent/data-model.md","docs/architecture/agent/agent-lobehub-blueprint.md","docs/architecture/agent/lobehub-parity-mindmap.source.md","docs/architecture/agent/execution-plans/20260816-lobehub-parity-full-landing.md","docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2.md","docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md"],"decisions":["MCA-D14","MCA-D15","MCA-D16","MCA-D17","MCA-D18","MCA-D20","MCA-D20A","P4-3","V2-D03","V2-D04","V2-D07","V2-D08","DWF-D13","DWF-D14"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/agent","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/agent","mode":"exclusive-write"},{"pathPrefix":"docs/client","mode":"exclusive-write"},{"pathPrefix":"model/domain/agent","mode":"exclusive-write"},{"pathPrefix":"packages/agent-catalog","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-agent-v2-proto-coverage.py","mode":"exclusive-write"}],"nonGoals":["Clone LobeHub navigation, branding, hosted commercial marketplace, Community, subscription, or Cloud Gateway","Implement unsupported image or video generation or deferred server-side audio generation","Create a standalone Custom HTTP Plugin credential authority","Claim Mobile UI parity beyond accepted contract compatibility","Use mocks, static checks, or model-selected behavior as product-functional proof"]},"tasks":[{"id":"MCA-J01","workstreamId":"MCA-J01","path":"tasks/MCA-J01.md","dependsOn":[],"status":"done","blocker":null},{"id":"MCA-J02","workstreamId":"MCA-J02","path":"tasks/MCA-J02.md","dependsOn":[],"status":"done","blocker":null},{"id":"MCA-J03","workstreamId":"MCA-J03","path":"tasks/MCA-J03.md","dependsOn":["MCA-J02"],"status":"done","blocker":null},{"id":"MCA-J04","workstreamId":"MCA-J04","path":"tasks/MCA-J04.md","dependsOn":["MCA-J03"],"status":"blocked","blocker":{"code":"PROFILE_UNAVAILABLE","owner":"local-dev-control-plane","evidenceRef":"/Users/bytedance/Documents/Projects/peers-touch/env/peers-touch/two/profile.env.example"}},{"id":"MCA-J05","workstreamId":"MCA-J05","path":"tasks/MCA-J05.md","dependsOn":["MCA-J03"],"status":"blocked","blocker":{"code":"PROFILE_UNAVAILABLE","owner":"local-dev-control-plane","evidenceRef":"/Users/bytedance/Documents/Projects/peers-touch/env/peers-touch/two/profile.env.example"}},{"id":"MCA-J06","workstreamId":"MCA-J06","path":"tasks/MCA-J06.md","dependsOn":["MCA-J02"],"status":"blocked","blocker":{"code":"PROFILE_UNAVAILABLE","owner":"local-dev-control-plane","evidenceRef":"<env-repo>/peers-touch/two/profile.env.example"}},{"id":"MCA-X3","workstreamId":"MCA-X3","path":"tasks/MCA-X3.md","dependsOn":["MCA-J02"],"status":"in_progress","blocker":null},{"id":"MCA-A01","workstreamId":"MCA-A01","path":"tasks/MCA-A01.md","dependsOn":["MCA-J01","MCA-J02","MCA-J03","MCA-J04","MCA-J05","MCA-J06","MCA-X3"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"allowed","pullRequest":"allowed"},"runtime":{"deployProfiles":["two"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "schemaVersion": 1,
  "closures": {
    "V2-J01-functional": [],
    "V2-J02-functional": [],
    "V2-J03-functional": [],
    "V2-J04-functional": [],
    "V2-J05-functional": [],
    "V2-J06-functional": [],
    "X3-functional": [],
    "V2-acceptance": [
      "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
      "mobile-ios-simulator-layout-accessibility-e2e", "mobile-native-platform-e2e", "mobile-hard-cut-static",
      "agent-v2-kernel-foundation-e2e", "station-agent-unit", "agent-stream-resilience-e2e", "agent-core-lifecycle-native-e2e",
      "agent-native-knowledge-binding-e2e", "agent-native-message-forward-e2e", "agent-native-mention-e2e", "agent-native-portal-navigation-e2e", "agent-attachment-e2e", "agent-capability-transparency-e2e", "agent-provider-credential-e2e", "agent-translation-e2e", "agent-follow-up-e2e", "agent-ecosystem-e2e", "agent-topic-comments-e2e",
      "agent-v2-home-command-center-e2e",
      "agent-v2-capability-binding-e2e",
      "agent-v2-governed-tool-loop-e2e",
      "agent-v2-mcp-lifecycle-e2e",
      "agent-native-connector-lifecycle-e2e",
      "agent-v2-connector-invocation-e2e",
      "agent-v2-evaluation-lab-e2e",
      "agent-marketplace-catalog-e2e"
    ]
  },
  "completion": [
    "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
    "mobile-ios-simulator-layout-accessibility-e2e", "mobile-native-platform-e2e", "mobile-hard-cut-static",
    "agent-v2-kernel-foundation-e2e", "station-agent-unit", "agent-stream-resilience-e2e", "agent-core-lifecycle-native-e2e",
    "agent-native-knowledge-binding-e2e", "agent-native-message-forward-e2e", "agent-native-mention-e2e", "agent-native-portal-navigation-e2e", "agent-attachment-e2e", "agent-capability-transparency-e2e", "agent-provider-credential-e2e", "agent-quick-completion-e2e", "agent-translation-e2e", "agent-follow-up-e2e", "agent-ecosystem-e2e", "agent-topic-comments-e2e",
    "agent-v2-home-command-center-e2e",
    "agent-v2-capability-binding-e2e",
    "agent-v2-governed-tool-loop-e2e",
    "agent-v2-mcp-lifecycle-e2e",
    "agent-native-connector-lifecycle-e2e",
    "agent-v2-connector-invocation-e2e",
    "agent-v2-evaluation-lab-e2e",
    "agent-marketplace-catalog-e2e"
  ],
  "full": [
    "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
    "mobile-ios-simulator-layout-accessibility-e2e", "mobile-native-platform-e2e", "mobile-hard-cut-static",
    "agent-v2-kernel-foundation-e2e", "station-agent-unit", "agent-stream-resilience-e2e", "agent-core-lifecycle-native-e2e",
    "agent-native-knowledge-binding-e2e", "agent-native-message-forward-e2e", "agent-native-mention-e2e", "agent-native-portal-navigation-e2e", "agent-attachment-e2e", "agent-capability-transparency-e2e", "agent-provider-credential-e2e", "agent-quick-completion-e2e", "agent-translation-e2e", "agent-follow-up-e2e", "agent-ecosystem-e2e", "agent-topic-comments-e2e",
    "agent-v2-home-command-center-e2e",
    "agent-v2-capability-binding-e2e",
    "agent-v2-governed-tool-loop-e2e",
    "agent-v2-mcp-lifecycle-e2e",
    "agent-native-connector-lifecycle-e2e",
    "agent-v2-connector-invocation-e2e",
    "agent-v2-evaluation-lab-e2e",
    "agent-marketplace-catalog-e2e"
  ]
}
```

## Goal

Close every accepted Modern Chat Agent V2 Journey and the remaining X3
package-discovery gap against the LobeHub benchmark without copying LobeHub's
hosted commercial product or violating Station authority.

## Vertical Closures

| Task | Observable closure | Main authority |
|---|---|---|
| MCA-J01 | Home starts or resumes Chat/Task work and survives restart | Station Home projection and canonical Chat/Task services |
| MCA-J02 | One capability inventory and binding/readiness plane | Station capability manifest, binding, and readiness authority |
| MCA-J03 | One governed ToolCall lineage from proposal through continuation | Station Turn, decision, dispatch, receipt, and trace authority |
| MCA-J04 | MCP install/test/bind/invoke/cancel/recover lifecycle | Station operation lineage plus Desktop local capability manager |
| MCA-J05 | OAuth resource becomes a governed Connector tool result | OAuth owner, Connector manifest adapter, Station ToolCall lineage |
| MCA-J06 | Evaluation datasets, runs, attempts, results, and metrics survive restart | Station Evaluation aggregate using the canonical Turn kernel |
| MCA-X3 | Trusted catalog is useful on first run and installs with authoritative readback | Curated source contract plus Desktop package installer authorities |
| MCA-A01 | Required Gates prove the final exact source and update the parity ledger | Acceptance Core and the mind-map source |

## Dependency And Cutover Rules

- J01 and J02 are independent entry closures and are re-proven before receiving
  completion credit.
- J03 consumes J02's canonical binding/readiness snapshot.
- J04 and J05 consume the governed lineage closed by J03.
- J06 consumes J02's immutable Agent/runtime/config snapshot and canonical Turn
  kernel.
- X3 reuses canonical package and capability readback; it does not create a
  second capability authority.
- J04 deletes no local MCP owner. It removes client-only terminal truth by
  reporting operation and result lineage to Station.
- J05 preserves OAuth credential ownership while removing label/config-derived
  readiness.
- J06 removes `localStorage` and `quickCompletion` as Evaluation truth.
- X3 either implements the accepted stable catalog/source contract or returns
  `DESIGN_AMENDMENT_REQUIRED`; it never treats an arbitrary repository URL as a
  JSON index.

## Claim Boundary

- A functional Task can reach `FUNCTIONAL_PASS` only from an exact-source real
  Journey and cleanup.
- Only MCA-A01 may promote the seven formal Gates to `PROVEN`.
- The mind-map X3/P3/E1 rows change only after their required source and proof
  evidence exists.
- Existing unrelated dirty files remain outside completion claims and must not
  be reverted or absorbed accidentally.
