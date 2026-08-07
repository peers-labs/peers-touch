#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-message-send-ingress-controlled-gate.json');

const serviceTestPattern = 'TestAtelierSendMessagePersistsTextOnlyUserEvent';
const facadeTestPattern = 'TestDecodeAtelierMessageJSON(RejectsExecutionShapedFields|AcceptsTextOnlyPayload)';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station Atelier SendMessage persists only text user-message event metadata',
    'Station official Atelier /v1/messages ingress rejects run, attachments, inputSnapshot, and input_snapshot fields',
    'Atelier message send remains Station-owned message append intent and does not expose run/provider/runtime/input_snapshot actions',
  ],
  doesNotProve: [
    'real Agent reply E2E',
    'real provider execution',
    'real Run input_snapshot write',
    'real Desktop Host + Station + applet message send E2E',
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
  gate: 'atelier-message-send-ingress-controlled-gate',
  commands: results.map((result) => `go test ${result.pkg} -run '${result.pattern}'`),
  tests: [
    'TestAtelierSendMessagePersistsTextOnlyUserEvent',
    'TestDecodeAtelierMessageJSONRejectsExecutionShapedFields',
    'TestDecodeAtelierMessageJSONAcceptsTextOnlyPayload',
  ],
  forbiddenIngressFields: ['run', 'attachments', 'inputSnapshot', 'input_snapshot'],
  forbiddenPersistedPayloadFields: ['run', 'run_kind', 'run_model', 'run_flow_id', 'attachments', 'inputSnapshot', 'input_snapshot'],
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  outputTail: results.flatMap((result) => result.output.split(/\r?\n/).filter(Boolean).slice(-20)),
};

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (!ok) {
  console.error(`FAIL Atelier message send ingress controlled gate: ${evidencePath}`);
  for (const result of results) {
    if (result.status !== 0) {
      console.error(result.output);
    }
  }
  process.exit(1);
}

console.log(`PASS Atelier message send ingress controlled gate: ${evidencePath}`);
