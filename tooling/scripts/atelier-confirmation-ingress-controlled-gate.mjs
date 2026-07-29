#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-confirmation-ingress-controlled-gate.json');

const facadeTestPattern = 'TestDecodeAtelier(MemoryConfirmationJSON|RerunConfirmationJSON)(RejectsExecutionShapedFields|AcceptsReferencePayload)';
const serviceTestPattern = 'TestConfirmAtelier(MemoryCandidateWritesStationOwnedMemory|MemoryCandidateRejectsNonCandidateFeedback|RerunCreatesStationOwnedNewRun|RerunRejectsNonRerunFeedback)';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station official Atelier memory and rerun confirmation ingress rejects execution-shaped fields',
    'Station confirmation requests remain reference-only taskId/feedbackId intents',
    'Station service tests keep memory writes and rerun creation Station-owned after durable feedback review lookup',
  ],
  doesNotProve: [
    'real memory write E2E from Desktop Host + applet',
    'real rerun task creation E2E from Desktop Host + applet',
    'real Planner/Risk/Verifier feedback consumption',
    'complete Host + Station + applet E2E',
  ],
};

function runGoTest(pkg, pattern) {
  const result = spawnSync('go', ['test', pkg, '-run', pattern], {
    cwd: path.resolve('apps/station/app'),
    encoding: 'utf8',
  });
  return {
    pkg,
    pattern,
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

mkdirSync(evidenceDir, { recursive: true });

const results = [
  runGoTest('./subserver/official_applets', facadeTestPattern),
  runGoTest('./subserver/agent/service', serviceTestPattern),
];
const ok = results.every((result) => result.status === 0);

const evidence = {
  ok,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier-confirmation-ingress-controlled-gate',
  commands: results.map((result) => `go test ${result.pkg} -run '${result.pattern}'`),
  tests: [
    'TestDecodeAtelierMemoryConfirmationJSONRejectsExecutionShapedFields',
    'TestDecodeAtelierMemoryConfirmationJSONAcceptsReferencePayload',
    'TestDecodeAtelierRerunConfirmationJSONRejectsExecutionShapedFields',
    'TestDecodeAtelierRerunConfirmationJSONAcceptsReferencePayload',
    'TestConfirmAtelierMemoryCandidateWritesStationOwnedMemory',
    'TestConfirmAtelierMemoryCandidateRejectsNonCandidateFeedback',
    'TestConfirmAtelierRerunCreatesStationOwnedNewRun',
    'TestConfirmAtelierRerunRejectsNonRerunFeedback',
  ],
  memoryConfirmationForbiddenIngressFields: [
    'run',
    'execute',
    'provider',
    'attachments',
    'memory',
    'memoryContent',
    'memory_content',
    'content',
    'target',
    'layer',
    'inputSnapshot',
    'input_snapshot',
  ],
  rerunConfirmationForbiddenIngressFields: [
    'run',
    'execute',
    'provider',
    'attachments',
    'rerun',
    'rerunTaskId',
    'goal',
    'model',
    'inputSnapshot',
    'input_snapshot',
  ],
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  outputTail: results.flatMap((result) => result.output.split(/\r?\n/).filter(Boolean).slice(-20)),
};

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (!ok) {
  console.error(`FAIL Atelier confirmation ingress controlled gate: ${evidencePath}`);
  for (const result of results) {
    if (result.status !== 0) {
      console.error(result.output);
    }
  }
  process.exit(1);
}

console.log(`PASS Atelier confirmation ingress controlled gate: ${evidencePath}`);
