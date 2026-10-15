# Message Publishing Formal Acceptance

> **Plan ID**: message-publishing-acceptance-20261015
> **Version ID**: 20261015-secure-relay-v5
> **Created**: 2026-10-15T13:50:54.000Z
> **Supersedes**: `20261015-lightweight-v4`

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"message-publishing-acceptance-20261015","versionId":"20261015-secure-relay-v5","createdAt":"2026-10-15T13:50:54.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/domains/chat/messaging/message-publishing.md","docs/architecture/domains/chat/messaging/design.md","docs/architecture/domains/chat/messaging/decisions.md","docs/architecture/domains/bot/product-definition.md","docs/architecture/domains/bot/design.md","docs/architecture/domains/bot/decisions.md","docs/architecture/domains/bot/integration.md","docs/api/message-publishing.md","docs/architecture/engineering/acceptance/design.md","docs/architecture/engineering/acceptance/decisions.md","docs/architecture/platform/station/access/design.md","docs/architecture/platform/station/access/decisions.md","docs/architecture/platform/runtime/node-connectivity/design.md","docs/architecture/platform/runtime/node-connectivity/decisions.md"],"decisions":["BOT-D01","BOT-D02","BOT-D03","BOT-D04","BOT-D05","MP-D04","MP-D05","MP-D10","MP-D12","SAL-D01","SAL-D02","SAL-D03","SAL-D04","SAL-D06","SAL-D07","SAL-D08","SAL-D12","SAL-D14","SAL-D15","NCP-D01","NCP-D02","NCP-D03","NCP-D04","NCP-D05","NCP-D06","NCP-D07","NCP-D08","NCP-D09","NCP-D10","NCP-D11","NCP-D12","NCP-D13","NCP-D14","NCP-D15","NCP-D16","NCP-D17","NCP-D18"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/architecture/domains/chat/messaging","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/bot","mode":"shared-read"},{"pathPrefix":"docs/api/message-publishing.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/engineering/acceptance","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/runtime/node-connectivity","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"shared-read"},{"pathPrefix":"model/domain/chat","mode":"shared-read"},{"pathPrefix":"model/domain/bot","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation/production_publishing.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/bot","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/notification/infrastructure/tx_producer.go","mode":"shared-read"},{"pathPrefix":"apps/station/frame/core/auth/credential/opaque.go","mode":"shared-read"},{"pathPrefix":"apps/station/frame/touch","mode":"shared-read"},{"pathPrefix":"apps/desktop","mode":"shared-read"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging/adapter.rs","mode":"shared-read"},{"pathPrefix":"packages/messaging-core","mode":"shared-read"},{"pathPrefix":"packages/locales","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/conversation/application/publishing/service_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation/application/publishing/normalize_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation/production_publishing_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/bot/application/registry/service_test.go","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/acceptance/message_publishing","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/components/chat/message/serviceEventAggregation.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/socialChat.conversationProjection.test.ts","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core/tests/service_plaintext_processor_test.rs","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/suite_runtime.py","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/capabilities/chat.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/domains/chat.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/drivers/native/macos.py","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/features/chat-message-publishing.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/home-station.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/__init__.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/home_station.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/native_desktop_macos.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/station_access_relay_role.py","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/reports","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_native_desktop_macos.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_provisioner_runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_provisioning_model.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_station_access_relay_role.py","mode":"shared-read"},{"pathPrefix":"tooling/scripts/acceptance-cell.py","mode":"shared-read"},{"pathPrefix":"tooling/scripts/acceptance-pipeline-audit.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-pipeline-audit-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-run-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan.py","mode":"shared-read"},{"pathPrefix":"tooling/scripts/acceptance-plan-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect.py","mode":"shared-read"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"}],"nonGoals":["Cross-Station service plaintext or federated Message Publishing","Bot replies, calls, friendship, or human-device sessions","Public multi-target grant management in the owner-only v1 product","A Bot-only webhook schema, credential store, delivery path, notification path, or aggregation owner","Linux, Windows, Browser, Mobile, signing, notarization, push, pull request, merge, release, or history rewrite","Replacing human Double Ratchet or MLS payloads with Station-visible plaintext","A second Acceptance Domain, provisioner, runtime topology, Station, Relay, task-state authority, or owner account","Relaxing Desktop Station discovery to admit remote plaintext HTTP","Using Relay for owner management or publisher ingress HTTP"]},"tasks":[{"id":"MPUB-03-PIPELINE","workstreamId":"MPUB-W02","path":"tasks/MPUB-03-PIPELINE.md","dependsOn":[]},{"id":"MPUB-03-PIPELINE-PROOF","workstreamId":"MPUB-W02","path":"tasks/MPUB-03-PIPELINE-PROOF.md","dependsOn":["MPUB-03-PIPELINE"]},{"id":"MPUB-03-MACOS-RUNTIME","workstreamId":"MPUB-W05","path":"tasks/MPUB-03-MACOS-RUNTIME.md","dependsOn":[]},{"id":"MPUB-03-MACOS-RUNTIME-PROOF","workstreamId":"MPUB-W05","path":"tasks/MPUB-03-MACOS-RUNTIME-PROOF.md","dependsOn":["MPUB-03-MACOS-RUNTIME"]},{"id":"MPUB-04-NATIVE","workstreamId":"MPUB-W03","path":"tasks/MPUB-04-NATIVE.md","dependsOn":["MPUB-03-PIPELINE-PROOF","MPUB-03-MACOS-RUNTIME-PROOF"]},{"id":"MPUB-05-FORMAL","workstreamId":"MPUB-W04","path":"tasks/MPUB-05-FORMAL.md","dependsOn":["MPUB-04-NATIVE"]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"denied"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["one"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"acceptance-plan-version-pipeline-audit":[],"acceptance-plan-version-pipeline-audit-functional":[],"message-publishing-macos-runtime-source":[],"message-publishing-macos-runtime-functional":[],"message-publishing-native-relay-functional":[],"message-publishing-formal":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e"]},"completion":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e"],"full":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-messaging-unit","messaging-platform-contract","desktop-check","chat-message-publishing-native-e2e","chat-domain-validation"]}
```

## Goal

Close the missing formal Acceptance path for the accepted unified Message
Publishing architecture while preserving the Desktop transport security
boundary. Owner management and publisher ingress use the direct Station HTTP
service; the macOS Native receiver reaches that same Station identity through
the existing Profile one HTTPS Relay.

## Amendment Boundary

Version v5 supersedes v4 after the first Native functional run proved that the
Profile one direct Station endpoint is remote plaintext HTTP and is therefore
correctly rejected by Desktop discovery. This is a runtime-contract mismatch,
not a reason to weaken Desktop security.

This version adds two accepted closures:

- generic Acceptance pipeline audit support for canonical `## Plan Version`
  manifests;
- source-bound attachment of Profile one's existing Relay and
  `station-via-relay` route for the Native receiver only.

Product publishing semantics, Conversation ownership, actor identity, Station
identity, Scenario set, and receiver oracle remain unchanged.

## Claim Boundary

- Conversation is the publishing, idempotency, notification-row, message, and
  delivery truth owner.
- Bot is only an optional Agent Actor profile over the generic grant.
- The receiver is one macOS Native Desktop owner client.
- Programs publish through authenticated management and ingress HTTP against
  the direct Station service.
- Native Alice binds its `station` client role to `station-via-relay`, whose
  source, runtime identity, TLS trust anchor, and Relay route are attested.
- The owner-only v1 grant has one public immutable service Direct target.
- Human private messages remain on their existing encrypted wire and storage
  path.

## Execution DAG

```text
MPUB-03-PIPELINE
  -> MPUB-03-PIPELINE-PROOF
MPUB-03-MACOS-RUNTIME
  -> MPUB-03-MACOS-RUNTIME-PROOF
MPUB-03-PIPELINE-PROOF + MPUB-03-MACOS-RUNTIME-PROOF
  -> MPUB-04-NATIVE
  -> MPUB-05-FORMAL
  -> MESSAGE_PUBLISHING_PROVEN
```

## Runtime Contract

The functional and formal Journey reuse the existing `home-station`
Environment and Provisioner. For this Gate only, that environment attaches the
existing Profile one Relay through the reviewed Station Access Relay owner and
emits `station`, `relay`, and `station-via-relay` attestations. It does not
provision a second Station, Relay, actor, Domain, or owner lifecycle.

The direct `station` attestation remains the management and publisher HTTP
endpoint. The sole Native Alice client binds to `station-via-relay`; Desktop
stages the attested Relay TLS trust anchor and verifies that the route resolves
to the same Station runtime identity before product actions.

The Suite attests and logs in once, keeps scenarios attach-only, permits one
restart of the same client, captures receiver-visible evidence before cleanup,
revokes every created grant and Bot, deletes removable objects, records any
retained message fixtures by namespace, and releases all runtime-owned storage.

## Vertical Closures

- `MPUB-03-PIPELINE` makes the generic Suite Runtime auditor consume canonical
  Plan Version packages without adding product semantics to Acceptance Infra;
  `MPUB-03-PIPELINE-PROOF` independently validates that source closure.
- `MPUB-03-MACOS-RUNTIME` keeps the fail-closed Native adapter probe on the
  main display; its proof Task validates the current host layout.
- `MPUB-04-NATIVE` attaches the exact-source Relay topology and runs the one
  reusable macOS Native owner Suite.
- `MPUB-05-FORMAL` independently publishes formal Gate evidence, validates the
  Chat Domain and Gap Detector result, and releases every owned resource.

## Completion

All six v5 Tasks are done; the dedicated Message Publishing Gate is `PROVEN` on
the same exact source; Native Alice used the attested HTTPS Relay route to the
same Station identity; direct Station HTTP remained confined to management and
publisher calls; Chat Domain structure is valid; the Gap Detector reports no
missing, stale, or unrelated required Gate; cleanup is complete; and every
excluded platform or transport remains explicitly `UNPROVEN`. Full Chat Domain
proof remains a separate `full` obligation.
