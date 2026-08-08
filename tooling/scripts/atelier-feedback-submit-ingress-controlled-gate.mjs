#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-feedback-submit-ingress-controlled-gate.json');

const serviceTestPattern = 'TestAtelierSubmitFeedbackPersistsStationOwnedPolicyEvent';
const facadeTestPattern = 'TestDecodeAtelierFeedbackSubmitJSON(RejectsExecutionShapedFields|AcceptsSignalPayload)';

const forbiddenFields = [
  'run',
  'execute',
  'provider',
  'attachments',
  'memory',
  'memoryContent',
  'memory_content',
  'rerun',
  'rerunTaskId',
  'inputSnapshot',
  'input_snapshot',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station official Atelier /v1/feedback/submit ingress rejects execution-shaped memory, rerun, provider, attachment, and input_snapshot fields',
    'Station Atelier SubmitFeedback persists Station-owned policy hint event metadata derived from allowed signal taxonomy',
    'Atelier feedback submit remains Station-owned review intent and does not expose memory.write, rerun execution, provider, runtime, or input_snapshot actions',
  ],
  doesNotProve: [
    'real Planner/Risk/Verifier feedback consumption',
    'real memory write E2E',
    'real rerun task creation E2E',
    'real Desktop Host + Station + applet feedback submit E2E',
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
  runGoTest('./subserver/agent/service', serviceTestPattern),
  runGoTest('./subserver/official_applets', facadeTestPattern),
];
const ok = results.every((result) => result.status === 0);

const evidence = {
  ok,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier-feedback-submit-ingress-controlled-gate',
  commands: results.map((result) => `go test ${result.pkg} -run '${result.pattern}'`),
  tests: [
    'TestAtelierSubmitFeedbackPersistsStationOwnedPolicyEvent',
    'TestDecodeAtelierFeedbackSubmitJSONRejectsExecutionShapedFields',
    'TestDecodeAtelierFeedbackSubmitJSONAcceptsSignalPayload',
  ],
  forbiddenIngressFields: forbiddenFields,
  forbiddenPersistedPayloadFields: forbiddenFields,
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  outputTail: results.flatMap((result) => result.output.split(/\r?\n/).filter(Boolean).slice(-20)),
};

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (!ok) {
  console.error(`FAIL Atelier feedback submit ingress controlled gate: ${evidencePath}`);
  for (const result of results) {
    if (result.status !== 0) {
      console.error(result.output);
    }
  }
  process.exit(1);
}

process.stdout.write(`PASS Atelier feedback submit ingress controlled gate: ${evidencePath}\n`);
