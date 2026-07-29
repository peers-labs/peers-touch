#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-confirmation-outcome-controlled-gate.json');
const contractPath = 'apps/applets/atelier/contracts/atelier-projection.contract.json';

const serviceTestPattern = 'TestConfirmAtelier(MemoryCandidateWritesStationOwnedMemory|MemoryCandidateRejectsNonCandidateFeedback|RerunCreatesStationOwnedNewRun|RerunRejectsNonRerunFeedback)';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station memory confirmation outcome writes review-derived long-term memory through MemoryService',
    'Station memory confirmation outcome emits an audit event and is idempotent by feedbackId',
    'Station rejects non-candidate feedback before memory write',
    'Station rerun confirmation outcome creates a new Station-owned collaboration task from the durable feedback intent',
    'Station rerun confirmation outcome clones provider plan/nodes, emits an audit event, and is idempotent by feedbackId',
    'Station rejects non-rerun feedback before task creation',
  ],
  doesNotProve: [
    'real memory write E2E from Desktop Host + applet',
    'real Planner/Risk/Verifier consumption of confirmed memory',
    'real rerun task creation E2E from Desktop Host + applet',
    'real executor/provider recovery for the confirmed rerun task',
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

function assertOutcomeMetadata(contract) {
  const memory = contract.methodPayloads?.['atelier.memory.confirmCandidate']?.controlledEvidence;
  assert.equal(memory?.stationOwnedMemoryWriteProven, true, 'memory confirmation must prove Station-owned memory write');
  assert.equal(memory?.stationMemoryAuditEventProven, true, 'memory confirmation must prove Station audit event');
  assert.equal(memory?.stationMemoryIdempotencyProven, true, 'memory confirmation must prove idempotency');
  assert.equal(memory?.stationNonCandidateRejectedProven, true, 'memory confirmation must prove non-candidate rejection');
  assert.equal(memory?.appletMemoryWriteExposed, false, 'memory confirmation must not expose applet memory write');
  assert.equal(memory?.realMemoryWriteE2EProven, false, 'memory confirmation must keep real E2E unproven');
  assert(memory.gates.includes('atelier:confirmation-outcome-controlled-gate'));
  assert(memory.evidenceFiles.includes('applet-readiness-evidence/official-applet/atelier-confirmation-outcome-controlled-gate.json'));

  const rerun = contract.methodPayloads?.['atelier.feedback.confirmRerun']?.controlledEvidence;
  assert.equal(rerun?.stationOwnedRerunTaskCreationProven, true, 'rerun confirmation must prove Station-owned task creation');
  assert.equal(rerun?.stationRerunProviderPlanCloneProven, true, 'rerun confirmation must prove provider plan/node clone');
  assert.equal(rerun?.stationRerunAuditEventProven, true, 'rerun confirmation must prove Station audit event');
  assert.equal(rerun?.stationRerunIdempotencyProven, true, 'rerun confirmation must prove idempotency');
  assert.equal(rerun?.stationNonRerunRejectedProven, true, 'rerun confirmation must prove non-rerun rejection');
  assert.equal(rerun?.appletRerunExecutionExposed, false, 'rerun confirmation must not expose applet rerun execution');
  assert.equal(rerun?.realRerunTaskCreationE2EProven, false, 'rerun confirmation must keep real E2E unproven');
  assert(rerun.gates.includes('atelier:confirmation-outcome-controlled-gate'));
  assert(rerun.evidenceFiles.includes('applet-readiness-evidence/official-applet/atelier-confirmation-outcome-controlled-gate.json'));
}

function runGate() {
  const outputTail = runGoTest();
  const contract = readContract();
  assertOutcomeMetadata(contract);
  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-confirmation-outcome-controlled-gate',
    source: 'station_confirmation_outcome_service_tests',
    command: `go test ./subserver/agent/service -run '${serviceTestPattern}'`,
    tests: [
      'TestConfirmAtelierMemoryCandidateWritesStationOwnedMemory',
      'TestConfirmAtelierMemoryCandidateRejectsNonCandidateFeedback',
      'TestConfirmAtelierRerunCreatesStationOwnedNewRun',
      'TestConfirmAtelierRerunRejectsNonRerunFeedback',
    ],
    memoryConfirmationOutcome: {
      stationOwnedMemoryWriteProven: true,
      stationMemoryAuditEventProven: true,
      stationMemoryIdempotencyProven: true,
      stationNonCandidateRejectedProven: true,
      appletMemoryWriteExposed: false,
      realMemoryWriteE2EProven: false,
    },
    rerunConfirmationOutcome: {
      stationOwnedRerunTaskCreationProven: true,
      stationRerunProviderPlanCloneProven: true,
      stationRerunAuditEventProven: true,
      stationRerunIdempotencyProven: true,
      stationNonRerunRejectedProven: true,
      appletRerunExecutionExposed: false,
      realRerunTaskCreationE2EProven: false,
      realExecutorProviderRecoveryE2EProven: false,
    },
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
    outputTail,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier confirmation outcome controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-confirmation-outcome-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier confirmation outcome controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
