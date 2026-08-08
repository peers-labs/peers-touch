#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-direct-run-execution-evidence-controlled-gate.json');
const contractPath = 'apps/applets/atelier/contracts/atelier-projection.contract.json';
const officialGeneratedPath = 'apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts';
const prototypeGeneratedPath = 'packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts';
const officialClientPath = 'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts';
const prototypeRuntimePath = 'packages/prototypes/desktop/applets/atelier/src/runtime.ts';
const stationServiceTestPattern = 'TestAtelierDirectRunExecutionEvidenceIsStationOwnedMetadataOnly';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'controlled DirectRun execution evidence remains a Station-owned read-only projection',
    'controlled DirectRun evidence exposes only canonical evidence refs and status fields',
    'Station service-level DirectRun evidence is derived from durable DirectRun/artifact/gate/budget indexes without raw input snapshot or artifact body fields',
    'official applet client and browser prototype runtime do not expose DirectRun execution/write actions',
  ],
  doesNotProve: [
    'real Desktop CodingProvider worker execution',
    'real provider/model quality',
    'real streaming reply UX',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function readContract() {
  return JSON.parse(readText(contractPath));
}

function assertNoForbiddenActionExposure(filePath, forbiddenActions) {
  const source = readText(filePath);
  for (const action of forbiddenActions) {
    assert.equal(
      source.includes(action),
      false,
      `${filePath} must not expose DirectRun execution/write action ${action}`,
    );
  }
}

function runGate() {
  const serviceTest = spawnSync('go', ['test', './subserver/agent/service', '-run', stationServiceTestPattern], {
    cwd: path.resolve('apps/station/app'),
    encoding: 'utf8',
  });
  assert.equal(
    serviceTest.status,
    0,
    `Station service DirectRun evidence test failed: ${(serviceTest.stdout ?? '')}${(serviceTest.stderr ?? '')}`,
  );

  const contract = readContract();
  const directRunEvidence = contract.directRunExecutionEvidence;
  assert.equal(directRunEvidence.owner, 'station');
  assert.equal(directRunEvidence.surfaceKind, 'read_only_execution_evidence');
  assert.equal(directRunEvidence.projectionOnly, true);
  assert.deepEqual(directRunEvidence.displayFields, [
    'directRunId',
    'taskId',
    'providerId',
    'modelIntent',
    'state',
    'traceId',
    'artifactRefs',
    'gateRefs',
    'budgetUsage',
    'failureArtifactRef',
    'cliHandoffRef',
  ]);
  assert.deepEqual(directRunEvidence.claimBoundary.doesNotProve, claimBoundary.doesNotProve);
  assert.deepEqual(directRunEvidence.controlledEvidence, {
    readiness: 'controlled_local_upstream',
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier:direct-run-execution-evidence-controlled-gate',
    evidenceFiles: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-direct-run-execution-evidence-controlled-gate.json',
    ],
    source: 'direct_run_execution_evidence_controlled_harness',
    displayFields: directRunEvidence.displayFields,
    forbiddenActions: directRunEvidence.forbiddenActions,
    readOnlyProjection: true,
    stationServiceProjectionProven: true,
    stationOwnedRecordSourceProven: true,
    metadataOnlyProjectionProven: true,
    appletProviderInvokeExposed: false,
    appletModelRunExposed: false,
    appletCliExecuteExposed: false,
    appletTraceWriteExposed: false,
    appletArtifactWriteExposed: false,
    appletGateRunExposed: false,
    appletBudgetWriteExposed: false,
    inputSnapshotReadWriteExposed: false,
    realDesktopCodingProviderWorkerProven: false,
    realProviderModelQualityProven: false,
    realStreamingReplyUXProven: false,
    realHostStationAppletE2EProven: false,
  });

  const officialGenerated = readText(officialGeneratedPath);
  const prototypeGenerated = readText(prototypeGeneratedPath);
  assert.ok(officialGenerated.includes('"directRunExecutionEvidence"'), 'official generated contract must expose DirectRun evidence metadata');
  assert.ok(prototypeGenerated.includes('"directRunExecutionEvidence"'), 'prototype generated contract must expose DirectRun evidence metadata');
  assert.ok(officialGenerated.includes('"controlledEvidence"'), 'official generated contract must expose controlled evidence metadata');
  assert.ok(prototypeGenerated.includes('"controlledEvidence"'), 'prototype generated contract must expose controlled evidence metadata');
  assertNoForbiddenActionExposure(officialClientPath, directRunEvidence.forbiddenActions);
  assertNoForbiddenActionExposure(prototypeRuntimePath, directRunEvidence.forbiddenActions);

  const controlledProjection = {
    directRunId: 'direct-run-controlled-evidence',
    taskId: 'task-controlled-evidence',
    providerId: 'provider-controlled-readonly',
    modelIntent: 'gpt-4.1',
    state: 'completed',
    traceId: 'trace-controlled-evidence',
    artifactRefs: ['artifact://task-controlled-evidence/artifact-controlled/body'],
    gateRefs: ['gate://task-controlled-evidence/gate-controlled'],
    budgetUsage: {
      tokens: 42,
      moneyUsd: 0.01,
      source: 'station_budget_ledger_projection',
    },
    failureArtifactRef: null,
    cliHandoffRef: null,
  };
  assert.deepEqual(Object.keys(controlledProjection), directRunEvidence.displayFields);

  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-direct-run-execution-evidence-controlled-gate',
    source: 'direct_run_execution_evidence_controlled_harness',
    directRunExecutionEvidence: {
      owner: directRunEvidence.owner,
      surfaceKind: directRunEvidence.surfaceKind,
      projectionOnly: directRunEvidence.projectionOnly,
      displayFields: directRunEvidence.displayFields,
      forbiddenActions: directRunEvidence.forbiddenActions,
      readOnlyProjection: true,
      stationServiceProjectionProven: true,
      stationOwnedRecordSourceProven: true,
      metadataOnlyProjectionProven: true,
      appletProviderInvokeExposed: false,
      appletModelRunExposed: false,
      appletCliExecuteExposed: false,
      appletTraceWriteExposed: false,
      appletArtifactWriteExposed: false,
      appletGateRunExposed: false,
      appletBudgetWriteExposed: false,
      inputSnapshotReadWriteExposed: false,
      realDesktopCodingProviderWorkerProven: false,
      realProviderModelQualityProven: false,
      realStreamingReplyUXProven: false,
      realHostStationAppletE2EProven: false,
    },
    controlledProjection,
    commands: [
      `go test ./subserver/agent/service -run '${stationServiceTestPattern}'`,
    ],
    tests: [
      stationServiceTestPattern,
    ],
    outputTail: `${serviceTest.stdout ?? ''}${serviceTest.stderr ?? ''}`.split(/\r?\n/).filter(Boolean).slice(-20),
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS Atelier DirectRun execution evidence controlled gate: ${evidencePath}\n`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-direct-run-execution-evidence-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier DirectRun execution evidence controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
