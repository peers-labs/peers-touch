#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-artifact-body-fetch-controlled-gate.json');
const serviceSourcePath = 'apps/station/app/subserver/agent/service/atelier_projection.go';
const serviceTestPath = 'apps/station/app/subserver/agent/service/atelier_projection_test.go';
const testCommand = [
  'go',
  'test',
  './subserver/agent/service',
  '-run',
  'TestFetchAtelierArtifactBody',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station-owned Atelier artifact body fetch returns owned safe-text bodies through canonical artifact:// bodyRef',
    'Station artifact body fetch enforces actor-owned task scope, canonical bodyRef, active retention, fetchable text kinds, and body hash checks',
    'Station artifact body fetch truncates safe text by maxBytes without exposing file/path/url/html/iframe/image execution channels',
  ],
  doesNotProve: [
    'real Desktop product-window artifact body fetch',
    'live Desktop webview iframe/image/html/diff rendering',
    'real Station artifact blob production by provider/executor',
    'Console Logs runtime stream',
    'attachment Host Storage runtime',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function assertSourceAnchors() {
  const source = readFileSync(serviceSourcePath, 'utf8');
  const test = readFileSync(serviceTestPath, 'utf8');
  for (const anchor of [
    'func (s *AtelierProjectionService) FetchArtifactBody',
    'canonicalBodyRef := atelierArtifactBodyRef(taskID, artifactID)',
    'loadOwnedAtelierTask(ctx, actorID, taskID)',
    'artifact body kind is not fetchable as text',
    'artifact body hash mismatch',
    'expectedHash does not match artifact body',
    'truncateUTF8Bytes(blob.BodyText, maxBytes)',
  ]) {
    assert.ok(source.includes(anchor), `${serviceSourcePath} missing ${anchor}`);
  }
  for (const anchor of [
    'TestFetchAtelierArtifactBodyReturnsOwnedSafeTextBody',
    'TestFetchAtelierArtifactBodyRejectsUnsafeOrUnownedBlob',
    'unsafe html kind',
    'unowned task',
    'body ref mismatch',
    'expired body',
    'hash mismatch',
  ]) {
    assert.ok(test.includes(anchor), `${serviceTestPath} missing ${anchor}`);
  }
}

function runGoTest() {
  const result = spawnSync(testCommand[0], testCommand.slice(1), {
    cwd: path.resolve('apps/station/app'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    command: testCommand.join(' '),
    cwd: 'apps/station/app',
    status: 'PASS',
  };
}

try {
  assertSourceAnchors();
  const testRun = runGoTest();
  const evidence = {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-artifact-body-fetch-controlled-gate',
    source: 'station_artifact_body_fetch_service_tests',
    testRun,
    coveredPolicy: {
      allowedBodyKinds: ['markdown', 'diff', 'text', 'json'],
      canonicalBodyRef: 'artifact://<taskId>/<artifactId>/body',
      rejectionCases: ['unowned task', 'body ref mismatch', 'unsafe html kind', 'expired body', 'hash mismatch'],
      maxBytesTruncation: true,
    },
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier artifact body fetch controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-artifact-body-fetch-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier artifact body fetch controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
