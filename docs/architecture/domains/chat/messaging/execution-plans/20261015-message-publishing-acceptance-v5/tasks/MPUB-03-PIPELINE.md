# MPUB-03-PIPELINE: Canonical Plan Version Pipeline Audit

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"message-publishing-acceptance-20261015","taskId":"MPUB-03-PIPELINE","workstreamId":"MPUB-W02","title":"Make the generic Suite Runtime auditor consume canonical Plan Version manifests","workClass":"infrastructure","completionClass":"source","executionMode":"build","closureId":"acceptance-plan-version-pipeline-audit","journeyId":"MPUB-J01","runtimeClass":"source-only","writeSet":["tooling/scripts/acceptance-pipeline-audit.py","tooling/scripts/acceptance-pipeline-audit-test.py"],"readSet":["docs/architecture/engineering/acceptance","docs/knowledge/invariants/acceptance-suite-runtime-reuse.md","tooling/acceptance/core/suite_runtime.py","docs/architecture/domains/chat/messaging/execution-plans/20261015-message-publishing-acceptance-v5"],"budgets":{"focusedCheckSeconds":300,"functionalRunSeconds":1,"cleanupSeconds":30},"checks":[{"id":"acceptance-pipeline-audit-self","command":"python3 tooling/scripts/acceptance-pipeline-audit-test.py","verificationClass":"SOURCE_CHECK"},{"id":"message-publishing-pipeline-contract","command":"python3 tooling/scripts/acceptance-pipeline-audit.py --plan docs/architecture/domains/chat/messaging/execution-plans/20261015-message-publishing-acceptance-v5/plan.md --tasks MPUB-04-NATIVE","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["the auditor accepts exactly one canonical `## Plan Version` JSON block","legacy accepted `## Plan` and `## Plan Package` fixtures remain readable without changing Suite Runtime semantics","zero or multiple matching manifest blocks fail closed","the v5 Native Task runtimeReuse contract passes synthetic pipeline audit without claiming runtime proof","no Message Publishing Domain, Gate, Scenario, actor, endpoint, or product assertion is encoded in generic audit logic"],"failureBehavior":["do not modify business injection or product evidence from the Infra closure","do not broaden the parser to arbitrary headings or first-JSON-block selection","ambiguous plan manifests remain invalid","synthetic self-validation cannot be promoted to Message Publishing functional or formal proof"],"updatedAt":"2026-10-15T13:50:54.000Z"}
```

## Current Snapshot

Stable obligation: canonical Plan Version packages must be valid inputs to the
generic Suite Runtime pipeline auditor.

## Closure

Acceptance Infra validates the v5 Suite contract without owning or repairing
any Message Publishing business injection.
