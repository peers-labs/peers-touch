# Modern Chat Agent V2 Alignment - Plan Package

> **Status**: active
> **Branch**: feat/p0-streaming-runtime-message-actions
> **Workspace ID**: 65e7b6da4dc9be85
> **Initial HEAD**: dcf0813ea23d73256cf21173d75516b6c36f68b4

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"modern-chat-agent-v2-alignment-20260917","status":"active","binding":{"branch":"feat/p0-streaming-runtime-message-actions","workspaceId":"65e7b6da4dc9be85","initialHead":"dcf0813ea23d73256cf21173d75516b6c36f68b4"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/agent/modern-chat-agent/product-definition.md","docs/architecture/agent/modern-chat-agent/experience-contract.md","docs/architecture/agent/modern-chat-agent/product-state-model.md","docs/architecture/agent/modern-chat-agent/design.md","docs/architecture/agent/modern-chat-agent/decisions.md","docs/architecture/agent/modern-chat-agent/data-model.md","docs/architecture/agent/agent-lobehub-blueprint.md","docs/architecture/agent/lobehub-parity-mindmap.source.md","docs/architecture/agent/execution-plans/20260816-lobehub-parity-full-landing.md","docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2.md","docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md","docs/architecture/agent/modern-chat-agent/proposals/20260918-mca-d21-runtime-truthful-formal-evidence.md","docs/architecture/agent/modern-chat-agent/proposals/20260918-mca-d21-runtime-truthful-formal-evidence-review.md","docs/architecture/agent/modern-chat-agent/proposals/20260918-mca-d22-capability-scenario-control-plane.md","docs/architecture/agent/modern-chat-agent/proposals/20260918-mca-d22-capability-scenario-control-plane-review.md","docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d23-governed-tool-scenario-control-plane.md","docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d23-governed-tool-scenario-control-plane-review.md","docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d24-evaluation-scenario-control-plane.md","docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d24-evaluation-scenario-control-plane-review.md","docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d25-tool-zero-execution-evidence.md","docs/architecture/agent/modern-chat-agent/proposals/20260921-mca-d26-connector-execution-evidence.md","docs/architecture/access-gates/station-access-gate-architecture.md","docs/architecture/access-gates/station-access-gate-implementation-plan.md"],"decisions":["MCA-D14","MCA-D15","MCA-D16","MCA-D17","MCA-D18","MCA-D20","MCA-D20A","P4-3","V2-D03","V2-D04","V2-D07","V2-D08","DWF-D13","DWF-D14","MCA-D21","MCA-D22","MCA-D23","MCA-D24","MCA-D25","MCA-D26","MCA-D27"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/agent","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/social","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/agent","mode":"exclusive-write"},{"pathPrefix":"docs/client","mode":"exclusive-write"},{"pathPrefix":"go.work.sum","mode":"exclusive-write"},{"pathPrefix":"model/domain/agent","mode":"exclusive-write"},{"pathPrefix":"packages/agent-catalog","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/docker/compose.yml","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/deploy/deploy.sh","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-prove.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-validate.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-agent-v2-locales.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-agent-v2-locales.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/expand-agent-v2-runtime-matrix.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-agent-v2-proto-coverage.py","mode":"exclusive-write"}],"nonGoals":["Clone LobeHub navigation, branding, hosted commercial marketplace, Community, subscription, or Cloud Gateway","Implement unsupported image or video generation or deferred server-side audio generation","Create a standalone Custom HTTP Plugin credential authority","Claim Mobile UI parity beyond accepted contract compatibility","Use mocks, static checks, or model-selected behavior as product-functional proof"]},"tasks":[{"id":"MCA-J01","workstreamId":"MCA-J01","path":"tasks/MCA-J01.md","dependsOn":[],"status":"done","blocker":null},{"id":"MCA-J02","workstreamId":"MCA-J02","path":"tasks/MCA-J02.md","dependsOn":[],"status":"done","blocker":null},{"id":"MCA-J03","workstreamId":"MCA-J03","path":"tasks/MCA-J03.md","dependsOn":["MCA-J02"],"status":"done","blocker":null},{"id":"MCA-J04","workstreamId":"MCA-J04","path":"tasks/MCA-J04.md","dependsOn":["MCA-J03"],"status":"done","blocker":null},{"id":"MCA-J05","workstreamId":"MCA-J05","path":"tasks/MCA-J05.md","dependsOn":["MCA-J03"],"status":"done","blocker":null},{"id":"MCA-J06","workstreamId":"MCA-J06","path":"tasks/MCA-J06.md","dependsOn":["MCA-J02"],"status":"done","blocker":null},{"id":"MCA-X3","workstreamId":"MCA-X3","path":"tasks/MCA-X3.md","dependsOn":["MCA-J02"],"status":"done","blocker":null},{"id":"MCA-A01","workstreamId":"MCA-A01","path":"tasks/MCA-A01.md","dependsOn":["MCA-J01","MCA-J02","MCA-J03","MCA-J04","MCA-J05","MCA-J06","MCA-X3"],"status":"done","blocker":null},{"id":"MCA-A02","workstreamId":"MCA-A02","path":"tasks/MCA-A02.md","dependsOn":["MCA-A01"],"status":"done","blocker":null},{"id":"MCA-A03","workstreamId":"MCA-A03","path":"tasks/MCA-A03.md","dependsOn":["MCA-A01"],"status":"done","blocker":null},{"id":"MCA-A04","workstreamId":"MCA-A04","path":"tasks/MCA-A04.md","dependsOn":["MCA-A03"],"status":"done","blocker":null},{"id":"MCA-A05","workstreamId":"MCA-A05","path":"tasks/MCA-A05.md","dependsOn":["MCA-A04"],"status":"done","blocker":null},{"id":"MCA-A06","workstreamId":"MCA-A06","path":"tasks/MCA-A06.md","dependsOn":["MCA-A04"],"status":"done","blocker":null},{"id":"MCA-A07","workstreamId":"MCA-A07","path":"tasks/MCA-A07.md","dependsOn":["MCA-A03"],"status":"done","blocker":null},{"id":"MCA-R01","workstreamId":"MCA-R01","path":"tasks/MCA-R01.md","dependsOn":["MCA-A02","MCA-A03","MCA-A04","MCA-A05","MCA-A06","MCA-A07","MCA-X3"],"status":"in_progress","blocker":null},{"id":"MCA-R02","workstreamId":"MCA-R02","path":"tasks/MCA-R02.md","dependsOn":["MCA-R01"],"status":"pending","blocker":null},{"id":"MCA-A08","workstreamId":"MCA-A08","path":"tasks/MCA-A08.md","dependsOn":["MCA-A02","MCA-A03","MCA-A04","MCA-A05","MCA-A06","MCA-A07","MCA-X3","MCA-R02"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"allowed","pullRequest":"allowed"},"runtime":{"deployProfiles":["two"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "V2-J01-functional": [],
    "V2-J02-functional": [],
    "V2-J03-functional": [],
    "V2-J04-functional": [],
    "V2-J05-functional": [],
    "V2-J06-functional": [],
    "X3-functional": [],
    "V2-acceptance": [
      "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "desktop-dev-runtime-isolation-static", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
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
    "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "desktop-dev-runtime-isolation-static", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
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
    "acceptance-infra-validation", "acceptance-plan-self", "acceptance-runtime-provisioning-self", "acceptance-workflow-contract", "proto-build", "desktop-check", "desktop-dev-runtime-isolation-static", "chat-desktop-gateway-e2e", "chat-native-visible-static", "chat-native-interactions-e2e", "chat-native-group-mls-e2e", "messaging-platform-contract", "station-messaging-unit",
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

- The manifest `dependsOn` DAG is authoritative: J03 consumes J02; J04/J05
  consume J03; J06 consumes J02; and X3 reuses canonical package/capability
  readback without creating a second authority.
- MCA-A01 lands MCA-D21. MCA-A03 incorporates MCA-D22 with Station-owned,
  Acceptance-only J02 controls and no production manifest-registration path.
- MCA-R01 -> MCA-R02 -> MCA-A08 is the mandatory remediation, diagnostic
  cleanup, and final-proof chain.
- MCA-A08 waits for all six Journey candidates and re-runs every formal Gate on
  one final exact source.
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
