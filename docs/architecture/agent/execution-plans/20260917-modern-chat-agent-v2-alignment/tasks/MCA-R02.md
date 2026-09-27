# MCA-R02 - Foundation Diagnostic Cleanup

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-R02",
  "workstreamId": "MCA-R02",
  "title": "Remove Foundation diagnostics and reprove clean source",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-foundation-diagnostic-cleanup",
  "journeyId": "V2-acceptance",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/acceptance/agent/harness.ts",
    "docs/architecture/agent"
  ],
  "readSet": [
    "apps/station/app/subserver/agent",
    "tooling/acceptance/gates/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "foundation-diagnostic-cleanup",
      "command": "if rg -n 'debug-point .*foundation-(recovery-prefix|retry-turn|credential-missing)' apps/desktop/src/acceptance/agent/harness.ts || test -e debug-foundation-recovery-prefix.md || test -e debug-foundation-retry-turn.md || test -e debug-foundation-credential-missing.md || test -e .dbg/foundation-recovery-prefix.env || test -e .dbg/foundation-retry-turn.env || test -e .dbg/foundation-credential-missing.env || test -e .dbg/trae-debug-log-foundation-recovery-prefix.ndjson || test -e .dbg/trae-debug-log-foundation-retry-turn.ndjson || test -e .dbg/trae-debug-log-foundation-credential-missing.ndjson; then exit 1; fi && python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test.AgentHarnessStaticTest.test_recovery_cursor_is_frozen_at_fault_acknowledgement tooling.acceptance.gates.agent.agent_native_static_test.AgentHarnessStaticTest.test_recovery_preparation_uses_one_fault_bound_attempt tooling.acceptance.gates.agent.agent_native_static_test.AgentHarnessStaticTest.test_recovery_restores_capabilities_after_transport_recovery tooling.acceptance.gates.agent.agent_native_static_test.AgentHarnessStaticTest.test_recovery_completion_reads_failure_after_evidence_sync && pnpm --dir apps/desktop check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "foundation-clean-source-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-R02-PR112 --gate agent-v2-kernel-foundation-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "The recovery-prefix, retry-turn, and credential-missing Harness debug regions and local session artifacts are removed",
    "The Foundation Harness and oracle semantics are unchanged apart from diagnostic removal",
    "The exact-source Foundation Journey passes after cleanup with clean runtime teardown"
  ],
  "failureBehavior": [
    "Do not alter product or oracle behavior while removing diagnostics",
    "Return any clean-source product failure to a new bounded remediation Task",
    "Keep formal proof UNPROVEN until MCA-A08 reruns the Gate"
  ],
  "updatedAt": "2026-09-24T20:38:00Z",
  "durableEvidence": []
}
```

## Objective

Remove temporary Foundation instrumentation only after the Station remediation
passes, then re-establish the Foundation Journey on clean source before final
formal promotion.

## Current Snapshot

- MCA-R02 is dependency-blocked until MCA-R01 closes.
- Diagnostic cleanup is limited to temporary `debug-point` regions and local
  debug-session files.
- Formal seven-Gate promotion remains owned by MCA-A08.
