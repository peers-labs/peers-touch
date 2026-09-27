# Acceptance Admission

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-TRUSTED-AUTONOMOUS-DEVELOPMENT-20260920",
  "taskId": "DWF-H03-ACCEPTANCE-ADMISSION",
  "workstreamId": "DWF-ACCEPTANCE",
  "title": "Enforce functional readiness before broad Acceptance",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "dwf-acceptance-admission",
  "journeyId": "DWF-J24-functional-before-acceptance",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/acceptance-framework",
    "docs/architecture/development-workflow",
    "docs/knowledge",
    "tooling/make/acceptance.mk",
    "tooling/make/review.mk",
    "tooling/scripts/acceptance-gap-detect.py",
    "tooling/scripts/acceptance-gap-detect-test.py",
    "tooling/scripts/acceptance-run.py",
    "tooling/scripts/acceptance-run-test.py",
    "tooling/scripts/plan",
    "tooling/scripts/review"
  ],
  "readSet": [
    "tooling/scripts/local-dev/dev-session-store.mjs",
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 240,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 15
  },
  "checks": [
    {
      "id": "acceptance-admission-cli",
      "command": "node --check tooling/scripts/plan/acceptance-admission.mjs && python3 -m py_compile tooling/scripts/plan/acceptance_admission.py tooling/scripts/acceptance-run.py tooling/scripts/acceptance-gap-detect.py",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "acceptance-admission-python",
      "command": "node --test tooling/scripts/plan/acceptance-admission.test.mjs tooling/scripts/plan/planctl.test.mjs && python3 tooling/scripts/plan/acceptance_admission_test.py && python3 tooling/scripts/acceptance-run-test.py && python3 tooling/scripts/acceptance-gap-detect-test.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Development execution remains limited to the current Journey closure",
    "Completion/full Acceptance and Gap Detector require an explicit matching Session",
    "Broad Acceptance rejects a functional Task before FUNCTIONAL_PASS",
    "Acceptance aggregate Tasks depend on the functional frontier they promote",
    "Acceptance execution identity binds the selected Plan, run and source"
  ],
  "failureBehavior": [
    "Do not weaken business Gate assertions",
    "Do not add fallback evidence or infer readiness from source checks",
    "Return typed admission errors before any Gate starts"
  ],
  "updatedAt": "2026-09-20T05:40:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- Broad Acceptance now delegates admission to the journal-backed Session owner
  before constructing an Evidence Store or starting any Gate.
- Completion/full execution requires `ACCEPTANCE_RUNNING`; Gap Detector
  requires `ACCEPTANCE_PASS` or `DELIVERY_READY`.
- Plan validation rejects an Acceptance aggregate without a transitive
  functional predecessor.
