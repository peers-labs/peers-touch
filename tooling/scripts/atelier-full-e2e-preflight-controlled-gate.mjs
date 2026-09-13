#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { workspaceRuntimePath, workspaceRuntimeRef } from './lib/machine-dev-paths.mjs';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-full-e2e-preflight-controlled-gate.json');
const sharedPreflightEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-preflight.json');
const controlledWorkDir = workspaceRuntimePath('atelier-full-e2e-preflight-controlled-gate');
const preflightScript = path.resolve('tooling/scripts/atelier-full-e2e-preflight.mjs');

const runtimeInputNames = [
  'PEERS_ATELIER_FULL_E2E_STATION_URL',
  'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
  'PEERS_ATELIER_FULL_E2E_IDE',
  'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
];

const finalProofObligationIds = [
  'full-host-station-applet-e2e',
  'post-ready-applet-ui-actions',
  'real-ide-launch',
  'production-provider-runtime-quality',
];

const expectedSourceInstrumentationGapIds = [];
const rawRuntimeInputLeakSentinels = [
  'preflight-secret-host.invalid',
  'preflight-secret-ide-target',
  'preflight-provider-profile-secret-token',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'full E2E preflight records missing runtime inputs in isolated evidence',
    'full E2E preflight records invalid runtime inputs in isolated evidence',
    'full E2E preflight records present-shaped runtime inputs without claiming readiness',
    'full E2E preflight records final side evidence source instrumentation gaps without claiming readiness',
    'controlled preflight branch coverage does not mutate shared atelier-full-e2e-preflight.json evidence',
  ],
  doesNotProve: [
    'real Desktop Host launch',
    'real Station service binding',
    'real applet UI actions',
    'real IDE launch',
    'production provider/model/runtime quality',
    'full Host + Station + applet E2E',
    'global Atelier readiness',
  ],
};

function readOptionalFile(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function preflightEnv({ scenarioName, preflightEvidencePath, runtimeEnv }) {
  const env = {
    ...process.env,
    PEERS_ATELIER_FULL_E2E_PREFLIGHT_EVIDENCE_PATH: preflightEvidencePath,
  };
  for (const name of runtimeInputNames) {
    delete env[name];
  }
  Object.assign(env, runtimeEnv);
  env.PEERS_ATELIER_FULL_E2E_PREFLIGHT_CONTROLLED_SCENARIO = scenarioName;
  return env;
}

function runPreflightScenario(scenario) {
  const scenarioDir = path.join(controlledWorkDir, scenario.name);
  mkdirSync(scenarioDir, { recursive: true });
  const preflightEvidencePath = path.join(scenarioDir, 'atelier-full-e2e-preflight.fixture.json');
  const result = spawnSync(process.execPath, [preflightScript], {
    cwd: process.cwd(),
    env: preflightEnv({
      scenarioName: scenario.name,
      preflightEvidencePath,
      runtimeEnv: scenario.runtimeEnv,
    }),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `${scenario.name} preflight must complete; output: ${output}`);

  const evidence = JSON.parse(readFileSync(preflightEvidencePath, 'utf8'));
  assertNoRawRuntimeInputLeak(evidence, `${scenario.name} preflight evidence`);
  assert.equal(evidence.ok, true, `${scenario.name} preflight evidence must keep ok=true`);
  assert.equal(evidence.readiness, 'NOT_READY', `${scenario.name} preflight evidence must remain NOT_READY`);
  assert.equal(evidence.globalReady, false, `${scenario.name} preflight evidence must preserve globalReady=false`);

  assert.deepEqual(
    (evidence.missingRuntimeInputs ?? []).map((input) => input.env),
    scenario.expectedMissingRuntimeInputs,
    `${scenario.name} missing runtime inputs`,
  );
  assert.deepEqual(
    (evidence.invalidRuntimeInputs ?? []).map((input) => input.env),
    scenario.expectedInvalidRuntimeInputs,
    `${scenario.name} invalid runtime inputs`,
  );
  assert.deepEqual(
    (evidence.presentRuntimeInputs ?? []).map((input) => input.env),
    scenario.expectedPresentRuntimeInputs,
    `${scenario.name} present runtime inputs`,
  );

  for (const finalProofObligationId of finalProofObligationIds) {
    assert.ok(
      evidence.finalProofObligations?.some((item) => item.id === finalProofObligationId),
      `${scenario.name} must preserve final proof obligation ${finalProofObligationId}`,
    );
  }

  assert.deepEqual(
    (evidence.sourceInstrumentationGaps ?? []).map((item) => item.id),
    expectedSourceInstrumentationGapIds,
    `${scenario.name} source instrumentation gaps`,
  );
  assert.ok(
    evidence.sourceInstrumentation?.some((item) => item.id === 'post-ready-workspace-open-action-producer' && item.owner === 'desktop_host'),
    `${scenario.name} must record Desktop Host workspace.open post-ready action producer audit`,
  );
  assert.ok(
    evidence.sourceInstrumentation?.some((item) => item.id === 'real-ide-launch-side-evidence-producer' && item.owner === 'desktop_host'),
    `${scenario.name} must record Desktop Host IDE launch side evidence producer audit`,
  );
  assert.ok(
    evidence.sourceInstrumentation?.some((item) => item.id === 'provider-runtime-side-evidence-producer' && item.owner === 'station'),
    `${scenario.name} must record Station provider runtime side evidence producer audit`,
  );

  return {
    name: scenario.name,
    status: 'PASS',
    evidencePath: path.relative(process.cwd(), preflightEvidencePath),
    missingRuntimeInputs: (evidence.missingRuntimeInputs ?? []).map((input) => input.env),
    invalidRuntimeInputs: (evidence.invalidRuntimeInputs ?? []).map((input) => ({
      env: input.env,
      reason: input.reason,
    })),
    presentRuntimeInputs: (evidence.presentRuntimeInputs ?? []).map((input) => input.env),
    finalProofObligationIds: (evidence.finalProofObligations ?? []).map((item) => item.id),
    sourceInstrumentationGapIds: (evidence.sourceInstrumentationGaps ?? []).map((item) => item.id),
  };
}

function assertNoRawRuntimeInputLeak(value, label) {
  const serialized = JSON.stringify(value);
  for (const sentinel of rawRuntimeInputLeakSentinels) {
    assert.equal(serialized.includes(sentinel), false, `${label} must not persist raw runtime input value ${sentinel}`);
  }
}

rmSync(controlledWorkDir, { recursive: true, force: true });
mkdirSync(controlledWorkDir, { recursive: true });
const sharedBefore = readOptionalFile(sharedPreflightEvidencePath);

const safePresentRuntimeEnv = {
  PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://preflight-secret-host.invalid:3000',
  PEERS_ATELIER_FULL_E2E_DESKTOP_APP: 'cmd:node --version',
  PEERS_ATELIER_FULL_E2E_IDE: 'preflight-secret-ide-target',
  PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({ profileRef: 'preflight-provider-profile-secret-token' }),
};

const scenarios = [
  {
    name: 'missing-runtime-inputs',
    runtimeEnv: {},
    expectedMissingRuntimeInputs: runtimeInputNames,
    expectedInvalidRuntimeInputs: [],
    expectedPresentRuntimeInputs: [],
  },
  {
    name: 'invalid-runtime-inputs',
    runtimeEnv: {
      ...safePresentRuntimeEnv,
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'file:///tmp/station.sock',
    },
    expectedMissingRuntimeInputs: [],
    expectedInvalidRuntimeInputs: ['PEERS_ATELIER_FULL_E2E_STATION_URL'],
    expectedPresentRuntimeInputs: [
      'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
      'PEERS_ATELIER_FULL_E2E_IDE',
      'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
    ],
  },
  {
    name: 'present-shaped-runtime-inputs',
    runtimeEnv: safePresentRuntimeEnv,
    expectedMissingRuntimeInputs: [],
    expectedInvalidRuntimeInputs: [],
    expectedPresentRuntimeInputs: runtimeInputNames,
  },
];

const scenarioResults = scenarios.map(runPreflightScenario);
const sharedAfter = readOptionalFile(sharedPreflightEvidencePath);
assert.equal(sharedAfter, sharedBefore, 'controlled preflight gate must not mutate shared atelier-full-e2e-preflight.json');

const document = {
  ok: true,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier:full-e2e-preflight-controlled-gate',
  readiness: 'NOT_READY',
  globalReady: false,
  scenarios: scenarioResults,
  isolatedWorkDir: workspaceRuntimeRef('atelier-full-e2e-preflight-controlled-gate'),
  mutatesSharedPreflightEvidence: false,
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  completedAt: new Date().toISOString(),
};

assertNoRawRuntimeInputLeak(document, 'preflight controlled gate evidence');

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
