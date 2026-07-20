#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-task-lifecycle-controlled-gate.json');
const testPattern = 'TestAtelierTaskLifecycle(SetStatus|Purge)|TestPurgeAtelierTaskRecordsTxDeletesDurableIndexes';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Station Atelier SetTaskStatus persists workbench lifecycle status without mutating execution status',
    'Station Atelier PurgeTask rejects non-deleted tasks through the public service',
    'Station Atelier PurgeTask removes task-owned durable indexes through the public service',
    'Atelier task lifecycle remains Station-owned and does not expose applet execution actions',
  ],
  doesNotProve: [
    'real Desktop Host + Station + applet task lifecycle E2E',
    'real product-window task menu interaction',
    'real cross-device lifecycle synchronization',
    'real user confirmation modal UX',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

const result = spawnSync('go', [
  'test',
  './subserver/agent/service',
  '-run',
  testPattern,
], {
  cwd: path.resolve('apps/station/app'),
  encoding: 'utf8',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const evidence = {
  ok: result.status === 0,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier-task-lifecycle-controlled-gate',
  command: `go test ./subserver/agent/service -run '${testPattern}'`,
  tests: [
    'TestAtelierTaskLifecycleSetStatusPersistsWorkbenchStateWithoutExecutionTransition',
    'TestAtelierTaskLifecyclePurgeRequiresDeletedAndUsesPublicService',
    'TestPurgeAtelierTaskRecordsTxDeletesDurableIndexes',
  ],
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  outputTail: output.split(/\r?\n/).filter(Boolean).slice(-20),
};

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (!evidence.ok) {
  console.error(`FAIL Atelier task lifecycle controlled gate: ${evidencePath}`);
  console.error(output);
  process.exit(result.status ?? 1);
}

console.log(`PASS Atelier task lifecycle controlled gate: ${evidencePath}`);
