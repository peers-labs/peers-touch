# CSS-01: Acceptance Contract First

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-01-acceptance-contract","workstreamId":"CSS-W01","title":"Register cross-Station Social acceptance contracts before functional work","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"cross-station-acceptance-contract","journeyId":"SOC-SEC-J10-J12","runtimeClass":"source-only","writeSet":["tooling/acceptance/capabilities/social.yaml","tooling/acceptance/domains/social.yaml","tooling/acceptance/features/social-private-moments-desktop.yaml","tooling/acceptance/gates/social","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml"],"readSet":["docs/architecture/social","docs/architecture/cross-station-social","tooling/acceptance/core"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1200,"cleanupSeconds":60},"checks":[{"id":"cross-station-acceptance-structure","command":"python3 tooling/scripts/acceptance-validate.py --domain social && python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance --self-check","verificationClass":"STRUCTURAL_CHECK"},{"id":"cross-station-acceptance-runner-tests","command":"python3 -m unittest discover -s tooling/acceptance/gates/social -p 'test_*.py'","verificationClass":"FUNCTIONAL_CHECK"},{"id":"cross-station-acceptance-contract-proof","command":"python3 tooling/scripts/acceptance-run.py --gate acceptance-plan-self && python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation && python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["AS17 through AS24 and Browser AS11 map to registered Gate IDs","every later task Gate has a fail-closed runner and unit test before it is invoked","the existing same-Station feature remains an explicit regression","Mobile has no new Gate or readiness claim"],"failureBehavior":["missing runtime inputs report UNPROVEN rather than pass","a source-only or mocked result cannot satisfy the final Native claim"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"STRUCTURAL_CHECK","result":"NOT_RUN","ref":"pending CSS-01 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-01 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending CSS-01 execution"}]}
```

## Current Snapshot

The Social domain has only the same-Station Gate and a negative remote boundary;
the positive Gate IDs referenced by later tasks are not registered.

This closure establishes executable proof contracts before implementation. It
does not change Social runtime behavior.
