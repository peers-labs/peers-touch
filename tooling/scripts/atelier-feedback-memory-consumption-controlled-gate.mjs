#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-feedback-memory-consumption-controlled-gate.json');
const contractPath = 'apps/applets/atelier/contracts/atelier-projection.contract.json';

const serviceTestPattern = 'TestAtelier(FeedbackRecordedIsTypedIntentNotStreamPatch|ConfirmedMemoryFeedsPlannerRiskVerifierRetrieval)';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station feedback policy records planner/risk/verifier feed taxonomy for memory candidates',
    'Station confirmed Atelier feedback memory is retrievable by MemoryService search for planner/risk/verifier queries',
    'Station prompt memory snapshot includes the confirmed memory as a relevant item for consumer assembly',
    'Applet feedback and confirmation payloads remain intent/reference-only and do not write memory directly',
  ],
  doesNotProve: [
    'real Planner/Risk/Verifier model consumption in a live provider run',
    'real memory write E2E from Desktop Host + applet',
    'real rerun task creation E2E from Desktop Host + applet',
    'real executor/provider recovery for confirmed rerun tasks',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function readContract() {
  return JSON.parse(readFileSync(contractPath, 'utf8'));
}

function runGoTest() {
  const result = spawnSync('go', ['test', './subserver/agent/service', '-run', serviceTestPattern], {
    cwd: path.resolve('apps/station/app'),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `go test -run ${serviceTestPattern} failed: ${output}`);
  return output.split(/\r?\n/).filter(Boolean).slice(-30);
}

function assertContractMetadata(contract) {
  const feedback = contract.methodPayloads?.['atelier.feedback.submit']?.controlledEvidence;
  assert.equal(feedback?.stationPlannerRiskVerifierFeedPolicyProven, true);
  assert.equal(feedback?.realPlannerRiskVerifierFeedbackConsumptionProven, false);
  assert(feedback.gates.includes('atelier:feedback-memory-consumption-controlled-gate'));
  assert(feedback.evidenceFiles.includes('applet-readiness-evidence/official-applet/atelier-feedback-memory-consumption-controlled-gate.json'));

  const memory = contract.methodPayloads?.['atelier.memory.confirmCandidate']?.controlledEvidence;
  assert.equal(memory?.stationPlannerRiskVerifierMemoryRetrievalProven, true);
  assert.equal(memory?.stationPromptMemorySnapshotConsumptionProven, true);
  assert.equal(memory?.realPlannerVerifierConsumptionProven, false);
  assert(memory.gates.includes('atelier:feedback-memory-consumption-controlled-gate'));
  assert(memory.evidenceFiles.includes('applet-readiness-evidence/official-applet/atelier-feedback-memory-consumption-controlled-gate.json'));
}

function runGate() {
  const outputTail = runGoTest();
  assertContractMetadata(readContract());
  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-feedback-memory-consumption-controlled-gate',
    source: 'station_feedback_memory_consumption_service_tests',
    command: `go test ./subserver/agent/service -run '${serviceTestPattern}'`,
    tests: [
      'TestAtelierFeedbackRecordedIsTypedIntentNotStreamPatch',
      'TestAtelierConfirmedMemoryFeedsPlannerRiskVerifierRetrieval',
    ],
    feedbackPolicyConsumption: {
      stationPlannerRiskVerifierFeedPolicyProven: true,
      realPlannerRiskVerifierFeedbackConsumptionProven: false,
    },
    confirmedMemoryConsumption: {
      stationPlannerRiskVerifierMemoryRetrievalProven: true,
      stationPromptMemorySnapshotConsumptionProven: true,
      realPlannerVerifierConsumptionProven: false,
    },
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
    outputTail,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier feedback memory consumption controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-feedback-memory-consumption-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier feedback memory consumption controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
