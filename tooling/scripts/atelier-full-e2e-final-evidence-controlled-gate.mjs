#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-full-e2e-final-evidence-controlled-gate.json');
const sharedFullE2EEvidencePath = path.join(evidenceDir, 'atelier-full-e2e.json');
const sharedPreflightEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-preflight.json');
const sharedWorkspaceOpenEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-workspace-open.json');
const sharedIdeLaunchEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-ide-launch.json');
const sharedProviderRuntimeEvidencePath = path.join(evidenceDir, 'atelier-full-e2e-provider-runtime.json');
const controlledWorkDir = path.resolve('tmp/atelier-full-e2e-final-evidence-controlled-gate');
const runnerScript = path.resolve('tooling/scripts/atelier-full-e2e.mjs');
const fakeDesktopAppPath = path.join(controlledWorkDir, 'fake-desktop-app.mjs');
const rawRuntimeInputLeakSentinels = [
  'full-e2e-secret-station.invalid',
  'full-e2e-secret-ide-target',
  'full-e2e-provider-profile-secret-token',
];

function controlledHash(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'full E2E runner validates current-launch Desktop ready, workspace open, IDE launch, and provider runtime evidence before ok=true',
    'full E2E runner rejects workspace open evidence that tries to claim real IDE launch',
    'full E2E runner rejects workspace open evidence that is stale or not bound to the current launch/session',
    'full E2E runner rejects workspace open evidence that mutates Host-intent, IDE target, or pt-workspace URI shape',
    'full E2E runner rejects Desktop ready evidence whose Station URL digest does not match runtime input',
    'full E2E runner rejects IDE launch evidence that exposes file/shell/execute-like authority to the applet',
    'full E2E runner rejects IDE launch evidence that is not owned by Desktop Host',
    'full E2E runner rejects IDE launch evidence that exposes openExternalUrl to the applet',
    'full E2E runner rejects provider/runtime evidence whose provider profile digest does not match runtime input',
    'full E2E runner rejects provider/runtime evidence that exposes provider/runtime/artifact/trace authority to the applet',
    'full E2E runner rejects provider/runtime evidence that is not owned by Station',
    'controlled final evidence validation does not mutate shared atelier-full-e2e.json evidence',
    'controlled final evidence validation does not mutate shared atelier-full-e2e-preflight.json evidence',
    'controlled final evidence validation does not mutate shared workspace/IDE/provider side evidence',
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

function writePreflightFixture(filePath) {
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ok: true,
        evidenceClass: 'READINESS_AUDIT',
        gate: 'atelier:full-e2e-preflight',
        readiness: 'NOT_READY',
        globalReady: false,
        claimBoundary: {
          readiness: 'NOT_READY',
        },
      },
      null,
      2,
    )}\n`,
  );
}

function writeFakeDesktopApp() {
  writeFileSync(
    fakeDesktopAppPath,
    `import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const scenario = process.argv[2] || 'valid-final-evidence';
const now = () => new Date().toISOString();
const launchId = process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID;
const sessionId = 'controlled-session-' + scenario;
const stationUrl = process.env.PEERS_STATION_URL;
const gatewayUrl = new URL(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_GATEWAY_URL);
const taskId = 'controlled-task';
const workspaceUri = 'pt-workspace://task/' + encodeURIComponent(taskId) + '?workspace=controlled-workspace';
const ideTarget = process.env.PEERS_ATELIER_FULL_E2E_IDE;
const providerProfile = JSON.parse(process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE);

function controlledHash(value) {
  return 'sha256:' + createHash('sha256').update(String(value)).digest('hex');
}

function writeJson(filePath, document) {
  writeFileSync(filePath, JSON.stringify(document, null, 2) + '\\n');
}

function desktopReadyEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    readiness: 'NOT_READY',
    globalReady: false,
    serviceBinding: {
      service: 'atelier',
      transport: 'sdk.network.request',
      stationUrlRedacted: true,
      stationUrlHash: controlledHash(stationUrl),
      stationPathPrefix: '/applets/atelier/v1',
    },
    productShell: {
      kind: 'desktop_host_product_shell',
      appletId: 'peers.atelier',
    },
    productWindow: {
      kind: 'desktop_product_window',
      appletId: 'peers.atelier',
      mounted: true,
    },
    completedAt: now(),
  };
  if (scenario === 'desktop-ready-wrong-station-url-hash') {
    evidence.serviceBinding.stationUrlHash = controlledHash('http://other-station.invalid:3000');
  }
  return evidence;
}

function workspaceOpenEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    action: 'atelier.workspace.open',
    accepted: true,
    mode: 'host_intent',
    hostSideEffect: 'workspace_open_intent',
    realIdeLaunchProven: scenario === 'workspace-open-claims-real-ide-launch',
    ideHintRedacted: true,
    ideTargetHash: controlledHash(ideTarget),
    taskId,
    workspaceUri,
    completedAt: now(),
  };
  if (scenario === 'workspace-open-stale-launch') {
    evidence.launchId = 'stale-launch';
  }
  if (scenario === 'workspace-open-stale-session') {
    evidence.sessionId = 'stale-session';
  }
  if (scenario === 'workspace-open-wrong-ide-target') {
    evidence.ideTargetHash = controlledHash('other-ide-target');
  }
  if (scenario === 'workspace-open-wrong-action') {
    evidence.action = 'provider.invoke';
  }
  if (scenario === 'workspace-open-native-launch-mode') {
    evidence.mode = 'native_launch';
  }
  if (scenario === 'workspace-open-shell-side-effect') {
    evidence.hostSideEffect = 'shell_execute';
  }
  if (scenario === 'workspace-open-file-url') {
    evidence.workspaceUri = 'file:///tmp/workspace';
  }
  if (scenario === 'workspace-open-task-mismatch') {
    evidence.workspaceUri = 'pt-workspace://task/other-task?workspace=controlled-workspace';
  }
  if (scenario === 'workspace-open-missing-workspace-query') {
    evidence.workspaceUri = 'pt-workspace://task/' + encodeURIComponent(taskId);
  }
  return {
    ...evidence,
  };
}

function ideLaunchEvidence() {
  return {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    action: 'atelier.workspace.open',
    taskId,
    workspaceUri,
    ideTargetRedacted: true,
    ideTargetHash: controlledHash(ideTarget),
    realIdeLaunchProven: true,
    launchOwner: scenario === 'ide-launch-wrong-owner' ? 'applet' : 'desktop_host',
    resolver: 'controlled-workspace-resolver',
    launchCommand: 'controlled-ide-launch',
    appletFileShellExecuteExposed: scenario === 'ide-launch-exposes-shell',
    appletOpenExternalUrlExposed: scenario === 'ide-launch-exposes-open-external-url',
    completedAt: now(),
  };
}

function providerRuntimeEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    owner: scenario === 'provider-wrong-owner' ? 'applet' : 'station',
    scope: 'production-provider-runtime',
    providerProfileRefRedacted: true,
    providerProfileRefHash: controlledHash(providerProfile.profileRef),
    providerRuntimeProven: true,
    providerModelQualityProven: true,
    streamingReplyUXProven: true,
    artifactPersistenceProven: true,
    traceCheckpointResumeProven: true,
    appletProviderInvokeExposed: scenario === 'provider-exposes-invoke',
    appletRuntimeExecuteExposed: false,
    appletArtifactWriteExposed: scenario === 'provider-exposes-artifact-write',
    appletTraceCheckpointResumeExposed: scenario === 'provider-exposes-trace-checkpoint-resume',
    completedAt: now(),
  };
  if (scenario === 'provider-wrong-profile-ref-hash') {
    evidence.providerProfileRefHash = controlledHash('other-provider-profile');
  }
  return evidence;
}

function gatewayBody(request) {
  if (request?.cmd !== 'applets_invoke') {
    return { ok: false, error: { message: 'unsupported command' } };
  }
  const pathName = request?.args?.params?.path;
  if (pathName === '/v1/workspace') {
    return {
      ok: true,
      data: {
        status: {
          status: 200,
          body: {
            selectedTaskId: taskId,
            workspace: {
              tasks: [{ id: taskId }],
            },
          },
        },
      },
    };
  }
  if (pathName === '/v1/provider/capabilities') {
    return {
      ok: true,
      data: {
        status: {
          status: 200,
          body: {
            source: 'station.provider.capabilities',
            capabilities: [{ scope: 'station-provider', readOnly: true }],
          },
        },
      },
    };
  }
  return { ok: false, error: { message: 'unsupported path ' + pathName } };
}

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { message: 'invalid json' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(gatewayBody(parsed)));
  });
});

server.listen(Number(gatewayUrl.port), gatewayUrl.hostname, () => {
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE, workspaceOpenEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE, ideLaunchEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE, providerRuntimeEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE, desktopReadyEvidence());
});

process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), 2500).unref();
});
setInterval(() => {}, 1000);
`,
  );
}

function runnerEnv({ scenarioName, runnerEvidencePath, preflightPath, port }) {
  const scenarioDir = path.dirname(runnerEvidencePath);
  return {
    ...process.env,
    PEERS_ATELIER_FULL_E2E_CONTROLLED_FINAL_EVIDENCE_SCENARIO: scenarioName,
    PEERS_ATELIER_FULL_E2E_EVIDENCE_PATH: runnerEvidencePath,
    PEERS_ATELIER_FULL_E2E_PREFLIGHT_PATH: preflightPath,
    PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE: path.join(scenarioDir, 'atelier-workspace-open.fixture.json'),
    PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE: path.join(scenarioDir, 'atelier-full-e2e-ide-launch.fixture.json'),
    PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE: path.join(scenarioDir, 'atelier-full-e2e-provider-runtime.fixture.json'),
    PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE: path.join(scenarioDir, 'atelier-desktop-ready.fixture.json'),
    PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://full-e2e-secret-station.invalid:3000',
    PEERS_ATELIER_FULL_E2E_DESKTOP_APP: `cmd:${process.execPath} ${fakeDesktopAppPath} ${scenarioName}`,
    PEERS_ATELIER_FULL_E2E_IDE: 'full-e2e-secret-ide-target',
    PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({ profileRef: 'full-e2e-provider-profile-secret-token' }),
    PEERS_ATELIER_FULL_E2E_DESKTOP_GATEWAY_URL: `http://127.0.0.1:${port}/`,
    PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_TIMEOUT_MS: '10000',
    PEERS_ATELIER_FULL_E2E_HANDSHAKE_TIMEOUT_MS: '10000',
  };
}

async function runRunnerScenario(scenario, index) {
  const scenarioDir = path.join(controlledWorkDir, scenario.name);
  mkdirSync(scenarioDir, { recursive: true });
  const preflightPath = path.join(scenarioDir, 'atelier-full-e2e-preflight.fixture.json');
  const runnerEvidencePath = path.join(scenarioDir, 'atelier-full-e2e.fixture.json');
  writePreflightFixture(preflightPath);

  const child = spawn(process.execPath, [runnerScript], {
    cwd: process.cwd(),
    env: runnerEnv({
      scenarioName: scenario.name,
      runnerEvidencePath,
      preflightPath,
      port: 41800 + index,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const status = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  const evidence = JSON.parse(readFileSync(runnerEvidencePath, 'utf8'));
  assertNoRawRuntimeInputLeak(output, `${scenario.name} runner output`);
  assertNoRawRuntimeInputLeak(evidence, `${scenario.name} runner evidence`);
  for (const sideEvidenceFile of [
    'atelier-workspace-open.fixture.json',
    'atelier-full-e2e-ide-launch.fixture.json',
    'atelier-full-e2e-provider-runtime.fixture.json',
    'atelier-desktop-ready.fixture.json',
  ]) {
    const sideEvidence = JSON.parse(readFileSync(path.join(scenarioDir, sideEvidenceFile), 'utf8'));
    assertNoRawRuntimeInputLeak(sideEvidence, `${scenario.name} ${sideEvidenceFile}`);
  }
  if (scenario.expectedFailureMode) {
    assert.notEqual(status, 0, `${scenario.name} must fail closed; output: ${output}`);
    assert.equal(evidence.ok, false, `${scenario.name} evidence must be ok=false`);
    assert.equal(evidence.failureMode, scenario.expectedFailureMode, `${scenario.name} failureMode`);
    assert.ok(output.includes(scenario.expectedOutput), `${scenario.name} output must include ${scenario.expectedOutput}; got ${output}`);
  } else {
    assert.equal(status, 0, `${scenario.name} must pass controlled final evidence validation; output: ${output}`);
    assert.equal(evidence.ok, true, `${scenario.name} evidence must be ok=true`);
    assert.equal(evidence.evidenceClass, 'REAL_PRODUCT_PATH', `${scenario.name} evidence class`);
    assert.equal(evidence.readiness, 'NOT_READY', `${scenario.name} must leave readiness decision to completion audit`);
    assert.equal(evidence.globalReady, false, `${scenario.name} must preserve globalReady=false`);
  }
  assert.equal(evidence.readiness, 'NOT_READY', `${scenario.name} must keep readiness=NOT_READY`);
  assert.equal(evidence.globalReady, false, `${scenario.name} must keep globalReady=false`);

  return {
    name: scenario.name,
    status: 'PASS',
    expectedFailureMode: scenario.expectedFailureMode ?? '',
    evidencePath: path.relative(process.cwd(), runnerEvidencePath),
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-8),
    runnerOk: evidence.ok,
    failureMode: evidence.failureMode ?? '',
    readiness: evidence.readiness,
    globalReady: evidence.globalReady,
  };
}

function assertNoRawRuntimeInputLeak(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const sentinel of rawRuntimeInputLeakSentinels) {
    assert.equal(serialized.includes(sentinel), false, `${label} must not persist raw runtime input value ${sentinel}`);
  }
}

mkdirSync(controlledWorkDir, { recursive: true });
writeFakeDesktopApp();
const sharedBefore = readOptionalFile(sharedFullE2EEvidencePath);
const sharedPreflightBefore = readOptionalFile(sharedPreflightEvidencePath);
const sharedWorkspaceOpenBefore = readOptionalFile(sharedWorkspaceOpenEvidencePath);
const sharedIdeLaunchBefore = readOptionalFile(sharedIdeLaunchEvidencePath);
const sharedProviderRuntimeBefore = readOptionalFile(sharedProviderRuntimeEvidencePath);

const scenarios = [
  {
    name: 'valid-final-evidence',
  },
  {
    name: 'workspace-open-claims-real-ide-launch',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must not claim real IDE launch',
  },
  {
    name: 'workspace-open-stale-launch',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must match current launchId',
  },
  {
    name: 'workspace-open-stale-session',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must match Desktop ready sessionId',
  },
  {
    name: 'workspace-open-wrong-ide-target',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must match configured IDE target',
  },
  {
    name: 'workspace-open-wrong-action',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must prove atelier.workspace.open action',
  },
  {
    name: 'workspace-open-native-launch-mode',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must remain a Host intent',
  },
  {
    name: 'workspace-open-shell-side-effect',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must preserve Host intent side effect',
  },
  {
    name: 'workspace-open-file-url',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must use pt-workspace URI',
  },
  {
    name: 'workspace-open-task-mismatch',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence task path must match taskId',
  },
  {
    name: 'workspace-open-missing-workspace-query',
    expectedFailureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
    expectedOutput: 'workspace open action evidence must include workspace query',
  },
  {
    name: 'desktop-ready-wrong-station-url-hash',
    expectedFailureMode: 'DESKTOP_HOST_LAUNCH_FAILED',
    expectedOutput: 'Desktop Host readiness evidence must prove the configured Station URL by hash',
  },
  {
    name: 'ide-launch-exposes-shell',
    expectedFailureMode: 'REAL_IDE_LAUNCH_NOT_PROVEN',
    expectedOutput: 'real IDE launch evidence must not expose file/shell/execute to applet',
  },
  {
    name: 'ide-launch-wrong-owner',
    expectedFailureMode: 'REAL_IDE_LAUNCH_NOT_PROVEN',
    expectedOutput: 'real IDE launch evidence must be owned by Desktop Host',
  },
  {
    name: 'ide-launch-exposes-open-external-url',
    expectedFailureMode: 'REAL_IDE_LAUNCH_NOT_PROVEN',
    expectedOutput: 'real IDE launch evidence must not expose openExternalUrl to applet',
  },
  {
    name: 'provider-exposes-invoke',
    expectedFailureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
    expectedOutput: 'provider/runtime evidence must not expose provider invoke to applet',
  },
  {
    name: 'provider-wrong-owner',
    expectedFailureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
    expectedOutput: 'provider/runtime evidence must be Station-owned',
  },
  {
    name: 'provider-wrong-profile-ref-hash',
    expectedFailureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
    expectedOutput: 'provider/runtime evidence must match provider profile ref by hash',
  },
  {
    name: 'provider-exposes-artifact-write',
    expectedFailureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
    expectedOutput: 'provider/runtime evidence must not expose artifact writes to applet',
  },
  {
    name: 'provider-exposes-trace-checkpoint-resume',
    expectedFailureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
    expectedOutput: 'provider/runtime evidence must not expose Trace/Checkpoint/Resume to applet',
  },
];

const scenarioResults = [];
for (let index = 0; index < scenarios.length; index += 1) {
  scenarioResults.push(await runRunnerScenario(scenarios[index], index));
}

const sharedAfter = readOptionalFile(sharedFullE2EEvidencePath);
assert.equal(sharedAfter, sharedBefore, 'controlled final evidence gate must not mutate shared atelier-full-e2e.json');
const sharedPreflightAfter = readOptionalFile(sharedPreflightEvidencePath);
assert.equal(
  sharedPreflightAfter,
  sharedPreflightBefore,
  'controlled final evidence gate must not mutate shared atelier-full-e2e-preflight.json',
);
const sharedWorkspaceOpenAfter = readOptionalFile(sharedWorkspaceOpenEvidencePath);
assert.equal(
  sharedWorkspaceOpenAfter,
  sharedWorkspaceOpenBefore,
  'controlled final evidence gate must not mutate shared atelier-full-e2e-workspace-open.json',
);
const sharedIdeLaunchAfter = readOptionalFile(sharedIdeLaunchEvidencePath);
assert.equal(
  sharedIdeLaunchAfter,
  sharedIdeLaunchBefore,
  'controlled final evidence gate must not mutate shared atelier-full-e2e-ide-launch.json',
);
const sharedProviderRuntimeAfter = readOptionalFile(sharedProviderRuntimeEvidencePath);
assert.equal(
  sharedProviderRuntimeAfter,
  sharedProviderRuntimeBefore,
  'controlled final evidence gate must not mutate shared atelier-full-e2e-provider-runtime.json',
);

const document = {
  ok: true,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  gate: 'atelier:full-e2e-final-evidence-controlled-gate',
  readiness: 'NOT_READY',
  globalReady: false,
  scenarios: scenarioResults,
  isolatedWorkDir: path.relative(process.cwd(), controlledWorkDir),
  mutatesSharedFullE2EEvidence: false,
  mutatesSharedPreflightEvidence: false,
  sharedEvidenceUnchanged: {
    fullE2E: true,
    preflight: true,
    workspaceOpen: true,
    ideLaunch: true,
    providerRuntime: true,
  },
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  completedAt: new Date().toISOString(),
};

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
