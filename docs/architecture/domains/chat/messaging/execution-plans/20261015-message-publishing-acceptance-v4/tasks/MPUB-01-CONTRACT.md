# MPUB-01-CONTRACT: Message Publishing Acceptance Contract

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"message-publishing-acceptance-20261015","taskId":"MPUB-01-CONTRACT","workstreamId":"MPUB-W01","title":"Inject the dedicated Message Publishing Acceptance graph","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"message-publishing-contract","journeyId":"MPUB-J01","runtimeClass":"source-only","writeSet":["tooling/acceptance/capabilities/chat.yaml","tooling/acceptance/domains/chat.yaml","tooling/acceptance/features/chat-message-publishing.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/gates/chat","tooling/acceptance/provisioners/home_station.py","tooling/acceptance/registry.yaml","tooling/acceptance/tests/test_provisioner_runtime.py","tooling/scripts/acceptance-plan-test.py"],"readSet":["docs/architecture/domains/chat/messaging","docs/architecture/domains/bot","docs/api/message-publishing.md","docs/architecture/engineering/acceptance","docs/knowledge"],"budgets":{"focusedCheckSeconds":600,"functionalRunSeconds":1,"cleanupSeconds":30},"checks":[{"id":"message-publishing-contract-tests","command":"python3 -m unittest tooling.acceptance.gates.chat.message_publishing_contract_test && python3 tooling/scripts/acceptance-plan-test.py","verificationClass":"SOURCE_CHECK"},{"id":"message-publishing-domain-structure","command":"make acceptance-validate DOMAIN=chat","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["Chat contains one active message-publishing capability and one active chat-message-publishing Feature","the Feature names Conversation publication receipts, message/event authority, Device Inbox, notification rows, and Desktop projection as its truth and surfaces","the Chat Domain references the new capability without creating a Bot or Message Publishing Domain","one stable chat-message-publishing-native-e2e Gate uses home-station and the existing home_station Provisioner","home_station allocates and launches exactly one alice Native client","registry rules map owned publishing, Bot adapter, service-plaintext consumer, aggregation, and Acceptance paths to the new Feature","planner regression proves the Message Publishing change range does not select the broad unrelated Chat matrix","legacy Bot webhook paths are absent from current Feature ownership and Gate selection"],"failureBehavior":["do not weaken existing Chat capabilities or remove their ownership to make validation pass","do not create a second Domain, Provisioner, Station topology, or Bot-specific Gate","missing Feature, Capability, Domain, Registry, Gate, Environment, or Provisioner linkage fails structural validation","an overbroad path rule remains a contract failure even when all selected Gates happen to pass"],"updatedAt":"2026-10-15T01:25:00.000Z"}
```

## Current Snapshot

Stable obligation: inject one dedicated Message Publishing proof graph without
changing the accepted owner-only product boundary.

## Closure

The managed Chat graph can select one bounded Message Publishing proof path
without inheriting the full two-Station Chat matrix.
