# MPUB-03-PIPELINE-PROOF: Plan Version Pipeline Functional Proof

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"message-publishing-acceptance-20261015","taskId":"MPUB-03-PIPELINE-PROOF","workstreamId":"MPUB-W02","title":"Prove canonical and legacy Suite Runtime plan parsing fail closed","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"acceptance-plan-version-pipeline-audit-functional","journeyId":"MPUB-J01","runtimeClass":"source-only","writeSet":["tooling/acceptance/reports"],"readSet":["docs/architecture/engineering/acceptance","docs/knowledge/invariants/acceptance-suite-runtime-reuse.md","tooling/acceptance/core/suite_runtime.py","tooling/scripts/acceptance-pipeline-audit.py","tooling/scripts/acceptance-pipeline-audit-test.py","docs/architecture/domains/chat/messaging/execution-plans/20261015-message-publishing-acceptance-v5"],"budgets":{"focusedCheckSeconds":300,"functionalRunSeconds":300,"cleanupSeconds":30},"checks":[{"id":"acceptance-pipeline-audit-self","command":"python3 tooling/scripts/acceptance-pipeline-audit-test.py","verificationClass":"SOURCE_CHECK"},{"id":"message-publishing-pipeline-contract","command":"python3 tooling/scripts/acceptance-pipeline-audit.py --plan docs/architecture/domains/chat/messaging/execution-plans/20261015-message-publishing-acceptance-v5/plan.md --tasks MPUB-04-NATIVE","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["canonical Plan Version, accepted legacy headings, malformed canonical metadata, ambiguous manifest blocks, missing runtimeReuse, and mutated runtime report cases all produce their expected deterministic result","the v5 Native Task returns PASS with proofState NOT_RUN before runtime evidence exists","the functional result is framework self-validation only and makes no Message Publishing product claim"],"failureBehavior":["do not repair or synthesize business injection from generic Infra","do not treat a parser exit zero as runtime or product proof","any ambiguous or malformed manifest remains a deterministic failure"],"updatedAt":"2026-10-15T13:50:54.000Z"}
```

## Current Snapshot

Stable obligation: prove the generic parser behavior independently from the
source edit and from Message Publishing product execution.

## Closure

Canonical and legacy manifest parsing is current, deterministic, and
fail-closed; the Native product Journey remains a separate Task.
