#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-budget-surface-controlled-gate.json');
const contractPath = 'apps/applets/atelier/contracts/atelier-projection.contract.json';

const budgetPreflightPattern = 'TestExecutePendingDirectRunBudgetPolicyPreflightEscalatesBeforeProviderCall';
const budgetDecisionRecoveryPattern = 'TestResolveCollaborationInterruptTxRoutesHumanDecisionBudgetContinue';
const budgetLedgerPattern = 'TestExecutePendingDirectRunSuccessPersistsProviderArtifactGateAndTraceHooks';
const budgetReconcilerPattern = 'TestBudgetUsageReconciler';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station DirectRun budget usage aggregation is backed by agent_task_budget_usages service-level tests',
    'Station provider billing reconciliation is backed by BudgetUsageReconciler service-level tests',
    'Station budget circuit breaker blocks DirectRun before provider calls for time/token/money budget exhaustion',
    'Station budget DecisionCard recovery resolves a reference-only human decision intent through Station orchestration',
    'budgetSurface remains a read-only applet projection with no budget write/halt/resume surface',
  ],
  doesNotProve: [
    'real provider implementations populate external billing in production',
    'real DecisionCard budget recovery from Desktop Host + applet',
    'real provider/live stream behavior',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function readContract() {
  return JSON.parse(readFileSync(contractPath, 'utf8'));
}

function runGoTest(pattern) {
  const result = spawnSync('go', ['test', './subserver/agent/service', '-run', pattern], {
    cwd: path.resolve('apps/station/app'),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `go test -run ${pattern} failed: ${output}`);
  return {
    pattern,
    command: `go test ./subserver/agent/service -run '${pattern}'`,
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-20),
  };
}

function runGate() {
  const testResults = [
    runGoTest(budgetPreflightPattern),
    runGoTest(budgetDecisionRecoveryPattern),
    runGoTest(budgetLedgerPattern),
    runGoTest(budgetReconcilerPattern),
  ];

  const contract = readContract();
  const controlledEvidence = contract.budgetSurface?.controlledEvidence;
  assert.deepEqual(controlledEvidence, {
    readiness: 'controlled_local_upstream',
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gates: [
      'atelier:official-frontend-gate',
      'atelier:bridge-runtime-gate',
      'atelier:budget-surface-controlled-gate',
    ],
    evidenceFiles: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-budget-surface-controlled-gate.json',
    ],
    descriptorField: 'workspace.budget',
    coveredStatuses: ['ok', 'warning', 'danger', 'blocked'],
    generatedTaxonomy: 'ATELIER_BUDGET_STATUSES',
    officialGuard: 'isAtelierBudgetProjection',
    prototypeGuard: 'isBudgetProjection',
    readOnlyProjection: true,
    appletBudgetWriteExposed: false,
    stationAggregationProven: true,
    providerBillingReconciliationProven: true,
    budgetCircuitBreakerProven: true,
    decisionCardRecoveryProven: true,
    realHostStationAppletE2EProven: false,
  });

  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-budget-surface-controlled-gate',
    source: 'station_budget_service_level_tests',
    budgetSurface: {
      descriptorField: controlledEvidence.descriptorField,
      coveredStatuses: controlledEvidence.coveredStatuses,
      readOnlyProjection: true,
      appletBudgetWriteExposed: false,
      stationAggregationProven: true,
      providerBillingReconciliationProven: true,
      budgetCircuitBreakerProven: true,
      decisionCardRecoveryProven: true,
      realHostStationAppletE2EProven: false,
    },
    commands: testResults.map((result) => result.command),
    tests: [
      budgetPreflightPattern,
      budgetDecisionRecoveryPattern,
      budgetLedgerPattern,
      budgetReconcilerPattern,
    ],
    outputTail: testResults.flatMap((result) => result.outputTail).slice(-40),
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS Atelier budget surface controlled gate: ${evidencePath}\n`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-budget-surface-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier budget surface controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
