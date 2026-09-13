#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { workspaceRuntimePath, workspaceRuntimeRef } from './lib/machine-dev-paths.mjs';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-full-e2e-fail-closed-controlled-gate.json');
const sharedFullE2EEvidencePath = path.join(evidenceDir, 'atelier-full-e2e.json');
const sharedPreflightEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-preflight.json');
const sharedSideEvidencePaths = [
  path.join(evidenceDir, 'atelier-full-e2e-desktop-ready.json'),
  path.join(evidenceDir, 'atelier-full-e2e-workspace-open.json'),
  path.join(evidenceDir, 'atelier-full-e2e-ide-launch.json'),
  path.join(evidenceDir, 'atelier-full-e2e-provider-runtime.json'),
];
const controlledWorkDir = workspaceRuntimePath('atelier-full-e2e-fail-closed-controlled-gate');
const runnerScript = path.resolve('tooling/scripts/atelier-full-e2e.mjs');

const runtimeInputNames = [
  'PEERS_ATELIER_FULL_E2E_STATION_URL',
  'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
  'PEERS_ATELIER_FULL_E2E_IDE',
  'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
];
const rawRuntimeInputLeakSentinels = [
  'fail-closed-secret-token',
  'fail-closed-secret-host.invalid',
  'fail-closed-secret-ide-target',
  'fail-closed-provider-profile-secret-token',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'full E2E runner missing runtime input branch exits non-zero and writes isolated NOT_READY evidence',
    'full E2E runner invalid runtime input branch exits non-zero before Desktop launch and writes isolated NOT_READY evidence',
    'full E2E runner source instrumentation gap branch exits non-zero before Desktop launch and writes isolated NOT_READY evidence',
    'controlled fail-closed branch coverage does not mutate shared atelier-full-e2e.json evidence',
    'controlled fail-closed branch coverage isolates and clears stale final side evidence before any real runtime launch',
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

function writePreflightFixture(filePath, sourceInstrumentationGaps = []) {
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ok: true,
        evidenceClass: 'READINESS_AUDIT',
        gate: 'atelier:full-e2e-preflight',
        readiness: 'NOT_READY',
        globalReady: false,
        sourceInstrumentationGaps,
        claimBoundary: {
          readiness: 'NOT_READY',
        },
      },
      null,
      2,
    )}\n`,
  );
}

function sideEvidencePathsForScenario(scenarioDir) {
  return {
    desktopReady: path.join(scenarioDir, 'atelier-full-e2e-desktop-ready.fixture.json'),
    workspaceOpen: path.join(scenarioDir, 'atelier-full-e2e-workspace-open.fixture.json'),
    ideLaunch: path.join(scenarioDir, 'atelier-full-e2e-ide-launch.fixture.json'),
    providerRuntime: path.join(scenarioDir, 'atelier-full-e2e-provider-runtime.fixture.json'),
  };
}

function seedStaleSideEvidence(sideEvidencePaths) {
  for (const [kind, filePath] of Object.entries(sideEvidencePaths)) {
    writeFileSync(
      filePath,
      `${JSON.stringify({
        ok: true,
        kind,
        staleControlledFixture: true,
        appletProviderInvokeExposed: kind === 'providerRuntime',
      }, null, 2)}\n`,
    );
  }
}

function runnerEnv({ scenarioName, runnerEvidencePath, preflightPath, sideEvidencePaths, runtimeEnv }) {
  const env = {
    ...process.env,
    PEERS_ATELIER_FULL_E2E_EVIDENCE_PATH: runnerEvidencePath,
    PEERS_ATELIER_FULL_E2E_PREFLIGHT_PATH: preflightPath,
    PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE: sideEvidencePaths.desktopReady,
    PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE: sideEvidencePaths.workspaceOpen,
    PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE: sideEvidencePaths.ideLaunch,
    PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE: sideEvidencePaths.providerRuntime,
  };
  for (const name of runtimeInputNames) {
    delete env[name];
  }
  Object.assign(env, runtimeEnv);
  env.PEERS_ATELIER_FULL_E2E_CONTROLLED_SCENARIO = scenarioName;
  return env;
}

function runRunnerExpectFailure(scenario) {
  const scenarioDir = path.join(controlledWorkDir, scenario.name);
  mkdirSync(scenarioDir, { recursive: true });
  const preflightPath = path.join(scenarioDir, 'atelier-full-e2e-preflight.fixture.json');
  const runnerEvidencePath = path.join(scenarioDir, 'atelier-full-e2e.fixture.json');
  const sideEvidencePaths = sideEvidencePathsForScenario(scenarioDir);
  writePreflightFixture(preflightPath, scenario.preflightSourceInstrumentationGaps ?? []);
  seedStaleSideEvidence(sideEvidencePaths);

  const result = spawnSync(process.execPath, [runnerScript], {
    cwd: process.cwd(),
    env: runnerEnv({
      scenarioName: scenario.name,
      runnerEvidencePath,
      preflightPath,
      sideEvidencePaths,
      runtimeEnv: scenario.runtimeEnv,
    }),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assertNoRawRuntimeInputLeak(output, `${scenario.name} runner output`);
  assert.notEqual(result.status, 0, `${scenario.name} must fail closed; output: ${output}`);
  assert.ok(
    output.includes(scenario.expectedOutput),
    `${scenario.name} output must include ${scenario.expectedOutput}; got ${output}`,
  );

  const evidence = JSON.parse(readFileSync(runnerEvidencePath, 'utf8'));
  assertNoRawRuntimeInputLeak(evidence, `${scenario.name} runner evidence`);
  assert.equal(evidence.ok, false, `${scenario.name} evidence must be ok=false`);
  assert.equal(evidence.readiness, 'NOT_READY', `${scenario.name} evidence must remain NOT_READY`);
  assert.equal(evidence.globalReady, false, `${scenario.name} evidence must preserve globalReady=false`);
  assert.equal(evidence.failureMode, scenario.expectedFailureMode, `${scenario.name} failureMode`);
  assert.equal(evidence.preflight?.path, path.relative(process.cwd(), preflightPath), `${scenario.name} must use isolated preflight`);
  const expectedClearedSideEvidence = Object.values(sideEvidencePaths).map((filePath) => path.relative(process.cwd(), filePath));
  assert.deepEqual(
    [...(evidence.staleFinalSideEvidenceCleared ?? [])].sort(),
    [...expectedClearedSideEvidence].sort(),
    `${scenario.name} must record cleared stale final side evidence`,
  );
  for (const filePath of Object.values(sideEvidencePaths)) {
    assert.equal(existsSync(filePath), false, `${scenario.name} must clear ${filePath}`);
  }
  if (scenario.expectedSourceInstrumentationGapIds !== undefined) {
    assert.deepEqual(
      (evidence.sourceInstrumentationGaps ?? []).map((item) => item.id),
      scenario.expectedSourceInstrumentationGapIds,
      `${scenario.name} source instrumentation gaps`,
    );
  }

  for (const finalEvidenceId of [
    'full-host-station-applet-e2e',
    'post-ready-applet-ui-actions',
    'real-ide-launch',
    'production-provider-runtime-quality',
  ]) {
    assert.ok(
      evidence.missingFinalEvidence?.some((item) => item.id === finalEvidenceId),
      `${scenario.name} must preserve missing final evidence ${finalEvidenceId}`,
    );
  }

  return {
    name: scenario.name,
    status: 'PASS',
    expectedFailureMode: scenario.expectedFailureMode,
    evidencePath: path.relative(process.cwd(), runnerEvidencePath),
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-8),
    missingRuntimeInputs: (evidence.missingRuntimeInputs ?? []).map((input) => input.env),
    invalidRuntimeInputs: (evidence.invalidRuntimeInputs ?? []).map((input) => ({
      env: input.env,
      reason: input.reason,
    })),
    sourceInstrumentationGapIds: (evidence.sourceInstrumentationGaps ?? []).map((item) => item.id),
    missingFinalEvidenceIds: (evidence.missingFinalEvidence ?? []).map((item) => item.id),
  };
}

function assertNoRawRuntimeInputLeak(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const sentinel of rawRuntimeInputLeakSentinels) {
    assert.equal(serialized.includes(sentinel), false, `${label} must not persist raw runtime input value ${sentinel}`);
  }
}

rmSync(controlledWorkDir, { recursive: true, force: true });
mkdirSync(controlledWorkDir, { recursive: true });
const sharedBefore = readOptionalFile(sharedFullE2EEvidencePath);
const sharedPreflightBefore = readOptionalFile(sharedPreflightEvidencePath);
const sharedSideEvidenceBefore = Object.fromEntries(
  sharedSideEvidencePaths.map((filePath) => [filePath, readOptionalFile(filePath)]),
);

const scenarios = [
  {
    name: 'missing-runtime-inputs',
    expectedFailureMode: 'MISSING_RUNTIME_INPUTS',
    expectedOutput: 'missing runtime inputs',
    runtimeEnv: {},
  },
  {
    name: 'invalid-runtime-inputs',
    expectedFailureMode: 'INVALID_RUNTIME_INPUTS',
    expectedOutput: 'invalid runtime inputs',
    runtimeEnv: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://operator:fail-closed-secret-token@fail-closed-secret-host.invalid:18080',
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: 'cmd:node --version',
      PEERS_ATELIER_FULL_E2E_IDE: 'fail-closed-secret-ide-target',
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({ profileRef: 'fail-closed-provider-profile-secret-token' }),
    },
  },
  {
    name: 'source-instrumentation-gaps',
    expectedFailureMode: 'SOURCE_INSTRUMENTATION_GAPS',
    expectedOutput: 'source instrumentation gaps',
    expectedSourceInstrumentationGapIds: [
      'real-ide-launch-side-evidence-producer',
      'provider-runtime-side-evidence-producer',
    ],
    preflightSourceInstrumentationGaps: [
      {
        id: 'real-ide-launch-side-evidence-producer',
        proofObligationId: 'real-ide-launch',
        path: 'apps/desktop/src-tauri/src/application/applets/mod.rs',
        owner: 'desktop_host',
        missingAnchors: ['PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE'],
      },
      {
        id: 'provider-runtime-side-evidence-producer',
        proofObligationId: 'production-provider-runtime-quality',
        path: 'apps/station/app/subserver/agent/service/atelier_projection.go',
        owner: 'station',
        missingAnchors: ['PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE'],
      },
    ],
    runtimeEnv: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://fail-closed-secret-host.invalid:18080',
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: 'cmd:node --version',
      PEERS_ATELIER_FULL_E2E_IDE: 'fail-closed-secret-ide-target',
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({ profileRef: 'fail-closed-provider-profile-secret-token' }),
    },
  },
];

const scenarioResults = scenarios.map(runRunnerExpectFailure);
const sharedAfter = readOptionalFile(sharedFullE2EEvidencePath);
assert.equal(sharedAfter, sharedBefore, 'controlled fail-closed gate must not mutate shared atelier-full-e2e.json');
assert.equal(
  readOptionalFile(sharedPreflightEvidencePath),
  sharedPreflightBefore,
  'controlled fail-closed gate must not mutate shared atelier-full-e2e-preflight.json',
);
for (const sharedSideEvidencePath of sharedSideEvidencePaths) {
  assert.equal(
    readOptionalFile(sharedSideEvidencePath),
    sharedSideEvidenceBefore[sharedSideEvidencePath],
    `controlled fail-closed gate must not mutate shared side evidence ${sharedSideEvidencePath}`,
  );
}

const document = {
  ok: true,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier:full-e2e-fail-closed-controlled-gate',
  readiness: 'NOT_READY',
  globalReady: false,
  scenarios: scenarioResults,
  isolatedWorkDir: workspaceRuntimeRef('atelier-full-e2e-fail-closed-controlled-gate'),
  mutatesSharedFullE2EEvidence: false,
  mutatesSharedPreflightEvidence: false,
  mutatesSharedFinalSideEvidence: false,
  staleFinalSideEvidenceCleared: true,
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  completedAt: new Date().toISOString(),
};

assertNoRawRuntimeInputLeak(document, 'fail-closed controlled gate evidence');

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
