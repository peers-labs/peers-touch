#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const evidenceRoot = path.resolve('.artifacts/applet-readiness');
const outputDir = path.join(evidenceRoot, 'release');
const outputPath = path.join(outputDir, 'product-capability-service-gate-output.txt');

mkdirSync(outputDir, { recursive: true });

const rustTests = [
  'applets::tests::executes_network_skill_through_gateway_service_policy',
  'applets::tests::executes_network_task_through_gateway_service_policy',
  'applets::tests::executes_agent_task_through_station_client',
  'applets::tests::rejects_placeholder_skill_when_product_executors_required',
  'applets::tests::rejects_placeholder_task_when_product_executors_required',
];

function runRustTest(testName) {
  const result = spawnSync(
    'cargo',
    [
      'test',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      testName,
      '--',
      '--nocapture',
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
  return {
    testName,
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function liveE2eHasProductExecutorEvidence() {
  const liveE2ePath = path.join(evidenceRoot, 'desktop/live-e2e-output.txt');
  if (!existsSync(liveE2ePath)) {
    return {
      status: 'FAIL',
      detail: 'Missing desktop/live-e2e-output.txt',
    };
  }
  const content = readFileSync(liveE2ePath, 'utf8');
  const required = [
    'Gateway live chain: PASS',
    'task-network',
    'task-agent',
    'skill-network',
    'skill-agent',
    '/agent/turn/execute',
  ];
  const missing = required.filter((marker) => !content.includes(marker));
  if (missing.length > 0) {
    return {
      status: 'FAIL',
      detail: `Missing live E2E markers: ${missing.join(', ')}`,
    };
  }
  return {
    status: 'PASS',
    detail: 'Live E2E controlled upstream includes network/agent task and skill executor evidence.',
  };
}

const rustResults = rustTests.map(runRustTest);
const liveE2eEvidence = liveE2eHasProductExecutorEvidence();
const failedRust = rustResults.filter((result) => result.status !== 0);
const status = failedRust.length === 0 && liveE2eEvidence.status === 'PASS' ? 'PASS' : 'FAIL';

const lines = [
  `${status} Product capability service executors`,
  'Scope: Gateway-governed network/agent skill and task executors plus release-mode placeholder fallback rejection.',
  `Product executor mode: ${'PEERS_APPLET_REQUIRE_PRODUCT_EXECUTORS'} or per-call productExecutorsOnly rejects skill/task fallback paths.`,
  '',
  'Rust executor checks:',
  ...rustResults.map((result) => `- ${result.status === 0 ? 'PASS' : 'FAIL'} ${result.testName}`),
  '',
  `Live E2E evidence: ${liveE2eEvidence.status} - ${liveE2eEvidence.detail}`,
];

for (const result of failedRust) {
  lines.push('');
  lines.push(`Failure output for ${result.testName}:`);
  if (result.stdout.trim()) lines.push(result.stdout.trim());
  if (result.stderr.trim()) lines.push(result.stderr.trim());
}

writeFileSync(outputPath, `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\nEvidence: ${outputPath}\n`);

if (status !== 'PASS') {
  process.exit(1);
}
