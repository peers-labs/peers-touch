# Message Publishing Formal Acceptance

> **Plan ID**: message-publishing-acceptance-20261015
> **Version ID**: 20261015-lightweight-v4
> **Created**: 2026-10-15T05:00:33.000Z
> **Supersedes**: `20261015-message-publishing-acceptance`

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"message-publishing-acceptance-20261015","versionId":"20261015-lightweight-v4","createdAt":"2026-10-15T05:00:33.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/domains/chat/messaging/message-publishing.md","docs/architecture/domains/chat/messaging/design.md","docs/architecture/domains/chat/messaging/decisions.md","docs/architecture/domains/bot/product-definition.md","docs/architecture/domains/bot/design.md","docs/architecture/domains/bot/decisions.md","docs/architecture/domains/bot/integration.md","docs/api/message-publishing.md","docs/architecture/engineering/acceptance/design.md","docs/architecture/engineering/acceptance/decisions.md"],"decisions":["BOT-D01","BOT-D02","BOT-D03","BOT-D04","BOT-D05","MP-D04","MP-D05","MP-D10","MP-D12"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/architecture/domains/chat/messaging","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/bot","mode":"shared-read"},{"pathPrefix":"docs/api/message-publishing.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/engineering/acceptance","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"shared-read"},{"pathPrefix":"model/domain/chat","mode":"shared-read"},{"pathPrefix":"model/domain/bot","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation/production_publishing.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/bot","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/notification/infrastructure/tx_producer.go","mode":"shared-read"},{"pathPrefix":"apps/station/frame/core/auth/credential/opaque.go","mode":"shared-read"},{"pathPrefix":"apps/station/frame/touch","mode":"shared-read"},{"pathPrefix":"apps/desktop","mode":"shared-read"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging/adapter.rs","mode":"shared-read"},{"pathPrefix":"packages/messaging-core","mode":"shared-read"},{"pathPrefix":"packages/locales","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation/application/publishing/service_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation/application/publishing/normalize_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation/production_publishing_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/bot/application/registry/service_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/acceptance/message_publishing","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/components/chat/message/serviceEventAggregation.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/socialChat.conversationProjection.test.ts","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core/tests/service_plaintext_processor_test.rs","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/capabilities/chat.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/domains/chat.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/features/chat-message-publishing.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/home_station.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_provisioner_runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan.py","mode":"shared-read"},{"pathPrefix":"tooling/scripts/acceptance-plan-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect.py","mode":"shared-read"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"}],"nonGoals":["Cross-Station service plaintext or federated Message Publishing","Bot replies, calls, friendship, or human-device sessions","Public multi-target grant management in the owner-only v1 product","A Bot-only webhook schema, credential store, delivery path, notification path, or aggregation owner","Linux, Windows, Browser, Mobile, signing, notarization, push, pull request, merge, release, or history rewrite","Replacing human Double Ratchet or MLS payloads with Station-visible plaintext","A second Acceptance Domain, provisioner, runtime topology, or task-state authority"]},"tasks":[{"id":"MPUB-01-CONTRACT","workstreamId":"MPUB-W01","path":"tasks/MPUB-01-CONTRACT.md","dependsOn":[]},{"id":"MPUB-02-LIFECYCLE","workstreamId":"MPUB-W01","path":"tasks/MPUB-02-LIFECYCLE.md","dependsOn":["MPUB-01-CONTRACT"]},{"id":"MPUB-03-NATIVE","workstreamId":"MPUB-W02","path":"tasks/MPUB-03-NATIVE.md","dependsOn":["MPUB-02-LIFECYCLE"]},{"id":"MPUB-04-FORMAL","workstreamId":"MPUB-W03","path":"tasks/MPUB-04-FORMAL.md","dependsOn":["MPUB-03-NATIVE"]}],"authorization":{"checkpoint":{"localCommit":"denied","amend":"denied"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["one"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"message-publishing-contract":[],"message-publishing-lifecycle-source":[],"message-publishing-native-functional":[],"message-publishing-formal":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e"]},"completion":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e"],"full":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e","chat-domain-validation"]}
```

## Goal

Close the missing formal Acceptance path for the already accepted unified
Message Publishing architecture. The claim starts at owner grant management,
crosses the Conversation transaction and Device Inbox, and ends at a visible
native receiver projection with deterministic aggregation and recovery.

## Amendment Boundary

Version v4 supersedes v3 after the MPUB-02 source check proved that
`productionPublishingGrant` omitted the already accepted `disabled` lifecycle
field from the public grant projection. The Owner approved this exact
defect-backed scope amendment on 2026-10-15.

This version adds only
`apps/station/app/subserver/conversation/production_publishing.go` as an
exclusive write path for MPUB-02. Product scope, architecture ownership,
Journey, Gate set, runtime authorization, non-goals, and delivery restrictions
remain unchanged.

## Claim Boundary

- Conversation is the publishing, idempotency, notification-row, message, and
  delivery truth owner.
- Bot is only an optional Agent Actor profile over the generic grant.
- The receiver is one macOS Native Desktop owner client.
- Programs publish through authenticated management and ingress HTTP; no second
  UI publisher or second Station is introduced.
- The owner-only v1 grant has one public immutable service Direct target. The
  more general "default changes" replay rule remains a Station receipt
  invariant tested below the public API, not a new v1 management capability.
- Human private messages remain on their existing encrypted wire and storage
  path.

## Execution DAG

```text
MPUB-01-CONTRACT
  -> MPUB-02-LIFECYCLE
  -> MPUB-03-NATIVE
  -> MPUB-04-FORMAL
  -> MESSAGE_PUBLISHING_PROVEN
```

## Runtime Contract

The functional and formal Journey reuse the existing `home-station`
Environment and Provisioner. The new Gate reuses the reviewed `alice` actor
without reset and launches one isolated macOS Native Desktop client. Publisher
operations run as authenticated HTTP actions inside the Gate. This avoids the
two-Station Chat matrix, a second account lifecycle, and another Provisioner or
topology.

The Suite attests and logs in once, keeps scenarios attach-only, permits one
restart of the same client, captures receiver-visible evidence before cleanup,
revokes every created grant and Bot, deletes removable objects, records any
retained message fixtures by namespace, and releases all runtime-owned storage.

## Vertical Closures

- `MPUB-01-CONTRACT` injects the dedicated Feature, Capability, Domain,
  Registry, Gate, and exact path-selection contract.
- `MPUB-02-LIFECYCLE` implements the source-level Scenario matrix and stable
  Gate/Harness assertions for publishing, aggregation, security, and cleanup.
- `MPUB-03-NATIVE` runs one reusable exact-source Station plus macOS Native
  owner Suite and records functional receiver evidence.
- `MPUB-04-FORMAL` independently publishes formal Gate evidence, validates the
  Chat Domain and Gap Detector result, and releases every owned resource.

## Completion

All four Tasks are done; the dedicated Message Publishing Gate is `PROVEN` on
the same exact source; Chat Domain structure is valid; the Gap Detector reports
no missing, stale, or unrelated required Gate; cleanup is complete; and every
excluded platform or transport remains explicitly `UNPROVEN`. Full Chat Domain
proof remains a separate `full` obligation.
