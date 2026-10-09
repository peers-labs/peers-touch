#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..', '..');
const matrixPath = path.join(
  scriptDirectory,
  'three-client-product-journey.matrix.json',
);
const requiredClients = Object.freeze({
  'android-alice': Object.freeze({ actor: 'alice', platform: 'android' }),
  'desktop-bob': Object.freeze({ actor: 'bob', platform: 'desktop' }),
  'ios-coral': Object.freeze({ actor: 'coral', platform: 'ios' }),
});
const requiredClientIds = Object.freeze(Object.keys(requiredClients));
const requiredPhases = Object.freeze([
  'entry',
  'shell',
  'contacts',
  'chat',
  'social',
  'recovery',
]);
const requiredScenarioIds = Object.freeze([
  'entry-station-login',
  'entry-restore-logout-relogin',
  'shell-primary-navigation',
  'shell-layout-and-accessibility',
  'contacts-discovery-and-request',
  'contacts-shared-group-create',
  'direct-text-roundtrip',
  'direct-rich-message-actions',
  'group-message-and-administration',
  'voice-message-roundtrip',
  'audio-call-lifecycle',
  'video-call-lifecycle',
  'social-alice-publish-bob-like',
  'social-coral-publish-three-client-convergence',
  'recovery-chat-and-social-relaunch',
  'recovery-call-terminal-cleanup',
]);
const requiredEvidence = Object.freeze([
  'source-identity',
  'interaction-trace',
  'screenshot',
  'accessibility-tree',
  'receiver-visible-result',
]);
const externalPreconditions = Object.freeze(new Set([
  'clean-isolated-storage',
  'livekit-healthy',
  'station-healthy',
]));

class JourneyContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JourneyContractError';
    this.code = code;
  }
}

function assertContract(condition, code, message) {
  if (!condition) throw new JourneyContractError(code, message);
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new JourneyContractError(
      'JSON_INVALID',
      `${label} is not valid JSON: ${error.message}`,
    );
  }
  assertContract(
    value && typeof value === 'object' && !Array.isArray(value),
    'JSON_OBJECT_REQUIRED',
    `${label} must be a JSON object`,
  );
  return value;
}

function stringList(value, label) {
  assertContract(
    Array.isArray(value) && value.length > 0,
    'NONEMPTY_LIST_REQUIRED',
    `${label} must be a non-empty array`,
  );
  const result = value.map((entry, index) => {
    assertContract(
      typeof entry === 'string' && entry.trim(),
      'NONEMPTY_STRING_REQUIRED',
      `${label}[${index}] must be a non-empty string`,
    );
    return entry.trim();
  });
  assertContract(
    new Set(result).size === result.length,
    'DUPLICATE_LIST_ENTRY',
    `${label} must not contain duplicates`,
  );
  return result;
}

function validateScenarioDependencies(scenarios) {
  const scenariosById = new Map(
    scenarios.map((scenario) => [scenario.id, scenario]),
  );
  for (const scenario of scenarios) {
    for (const precondition of scenario.preconditions) {
      assertContract(
        scenariosById.has(precondition)
          || externalPreconditions.has(precondition),
        'MATRIX_PRECONDITION_UNKNOWN',
        `${scenario.id} references unknown precondition ${precondition}`,
      );
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (scenarioId, trail) => {
    if (visited.has(scenarioId)) return;
    assertContract(
      !visiting.has(scenarioId),
      'MATRIX_PRECONDITION_CYCLE',
      `scenario precondition cycle: ${[...trail, scenarioId].join(' -> ')}`,
    );
    visiting.add(scenarioId);
    const scenario = scenariosById.get(scenarioId);
    for (const precondition of scenario.preconditions) {
      if (scenariosById.has(precondition)) {
        visit(precondition, [...trail, scenarioId]);
      }
    }
    visiting.delete(scenarioId);
    visited.add(scenarioId);
  };
  for (const scenario of scenarios) visit(scenario.id, []);
}

export function validateMatrix(matrix) {
  assertContract(
    matrix.kind === 'peers-touch-three-client-product-journey-matrix',
    'MATRIX_KIND_INVALID',
    'matrix kind is invalid',
  );
  assertContract(
    matrix.schemaVersion === 1,
    'MATRIX_SCHEMA_UNSUPPORTED',
    'matrix schemaVersion must be 1',
  );
  assertContract(
    matrix.journeyId === 'MS-J08',
    'MATRIX_JOURNEY_INVALID',
    'matrix journeyId must be MS-J08',
  );
  assertContract(
    matrix.clients && typeof matrix.clients === 'object',
    'MATRIX_CLIENTS_REQUIRED',
    'matrix clients are required',
  );
  const clientIds = Object.keys(matrix.clients).sort();
  assertContract(
    JSON.stringify(clientIds) === JSON.stringify([...requiredClientIds].sort()),
    'MATRIX_CLIENT_SET_INVALID',
    `matrix clients must be exactly ${requiredClientIds.join(', ')}`,
  );
  for (const clientId of requiredClientIds) {
    const client = matrix.clients[clientId];
    assertContract(
      client.actor === requiredClients[clientId].actor
        && client.platform === requiredClients[clientId].platform,
      'MATRIX_CLIENT_IDENTITY_INVALID',
      `${clientId} actor or platform is invalid`,
    );
    assertContract(
      client.evidencePerspective === 'sender-and-receiver',
      'MATRIX_PERSPECTIVE_INVALID',
      `${clientId} must prove sender and receiver perspectives`,
    );
  }

  const evidence = stringList(matrix.requiredEvidence, 'requiredEvidence');
  for (const evidenceKind of requiredEvidence) {
    assertContract(
      evidence.includes(evidenceKind),
      'MATRIX_EVIDENCE_MISSING',
      `matrix is missing required evidence ${evidenceKind}`,
    );
  }

  assertContract(
    matrix.phases && typeof matrix.phases === 'object',
    'MATRIX_PHASES_REQUIRED',
    'matrix phases are required',
  );
  const phaseIds = Object.keys(matrix.phases).sort();
  assertContract(
    JSON.stringify(phaseIds) === JSON.stringify([...requiredPhases].sort()),
    'MATRIX_PHASE_SET_INVALID',
    `matrix phases must be exactly ${requiredPhases.join(', ')}`,
  );

  const scenarios = [];
  const scenarioIds = new Set();
  for (const phase of requiredPhases) {
    const phaseScenarios = matrix.phases[phase];
    assertContract(
      Array.isArray(phaseScenarios) && phaseScenarios.length > 0,
      'MATRIX_PHASE_EMPTY',
      `matrix phase ${phase} must contain scenarios`,
    );
    for (const [index, scenario] of phaseScenarios.entries()) {
      const label = `${phase}[${index}]`;
      assertContract(
        scenario && typeof scenario === 'object' && !Array.isArray(scenario),
        'MATRIX_SCENARIO_INVALID',
        `${label} must be an object`,
      );
      assertContract(
        typeof scenario.id === 'string' && /^[a-z0-9-]+$/.test(scenario.id),
        'MATRIX_SCENARIO_ID_INVALID',
        `${label} has an invalid id`,
      );
      assertContract(
        !scenarioIds.has(scenario.id),
        'MATRIX_SCENARIO_ID_DUPLICATE',
        `scenario id ${scenario.id} is duplicated`,
      );
      scenarioIds.add(scenario.id);
      const clients = stringList(scenario.clients, `${scenario.id}.clients`);
      for (const clientId of clients) {
        assertContract(
          requiredClientIds.includes(clientId),
          'MATRIX_SCENARIO_CLIENT_INVALID',
          `${scenario.id} references unknown client ${clientId}`,
        );
      }
      assertContract(
        requiredClientIds.every((clientId) => clients.includes(clientId)),
        'MATRIX_THREE_CLIENT_SCOPE_MISSING',
        `${scenario.id} must cover all three foreground clients`,
      );
      const preconditions = stringList(
        scenario.preconditions,
        `${scenario.id}.preconditions`,
      );
      stringList(scenario.userActions, `${scenario.id}.userActions`);
      stringList(scenario.visibleResults, `${scenario.id}.visibleResults`);
      scenarios.push({ ...scenario, phase, preconditions });
    }
  }
  for (const scenarioId of requiredScenarioIds) {
    assertContract(
      scenarioIds.has(scenarioId),
      'MATRIX_SCENARIO_MISSING',
      `matrix is missing required scenario ${scenarioId}`,
    );
  }
  validateScenarioDependencies(scenarios);
  return {
    clientCount: clientIds.length,
    phaseCount: phaseIds.length,
    scenarioCount: scenarios.length,
    scenarios,
  };
}

function normalizeUrl(value, label) {
  assertContract(
    typeof value === 'string' && value.trim(),
    'RUNTIME_URL_REQUIRED',
    `${label} is required`,
  );
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new JourneyContractError(
      'RUNTIME_URL_INVALID',
      `${label} must be an HTTP URL`,
    );
  }
  assertContract(
    ['http:', 'https:'].includes(parsed.protocol),
    'RUNTIME_URL_PROTOCOL_INVALID',
    `${label} must use http or https`,
  );
  return parsed.toString().replace(/\/$/, '');
}

function resolveSourceIdentity() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const porcelain = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
  return {
    head,
    dirty: Boolean(porcelain),
    worktree: repoRoot,
  };
}

export function validateRuntimeManifest(manifest, sourceIdentity) {
  assertContract(
    manifest.kind === 'peers-touch-three-client-runtime-manifest',
    'RUNTIME_KIND_INVALID',
    'runtime manifest kind is invalid',
  );
  assertContract(
    manifest.schemaVersion === 1,
    'RUNTIME_SCHEMA_UNSUPPORTED',
    'runtime manifest schemaVersion must be 1',
  );
  assertContract(
    manifest.source && typeof manifest.source === 'object',
    'RUNTIME_SOURCE_REQUIRED',
    'runtime source identity is required',
  );
  assertContract(
    manifest.source.head === sourceIdentity.head,
    'RUNTIME_SOURCE_HEAD_MISMATCH',
    'runtime manifest source head does not match the current worktree',
  );
  assertContract(
    manifest.source.dirty === false && sourceIdentity.dirty === false,
    'RUNTIME_SOURCE_DIRTY',
    'three-client product journeys require a clean exact-source worktree',
  );
  assertContract(
    path.resolve(manifest.source.worktree) === sourceIdentity.worktree,
    'RUNTIME_SOURCE_WORKTREE_MISMATCH',
    'runtime manifest worktree does not match the current worktree',
  );
  normalizeUrl(manifest.stationUrl, 'stationUrl');
  assertContract(
    manifest.clients && typeof manifest.clients === 'object',
    'RUNTIME_CLIENTS_REQUIRED',
    'runtime clients are required',
  );
  const clientIds = Object.keys(manifest.clients).sort();
  assertContract(
    JSON.stringify(clientIds) === JSON.stringify([...requiredClientIds].sort()),
    'RUNTIME_CLIENT_SET_INVALID',
    `runtime clients must be exactly ${requiredClientIds.join(', ')}`,
  );

  const deviceIds = new Set();
  const storageIds = new Set();
  const sessionKeys = new Set();
  for (const clientId of requiredClientIds) {
    const client = manifest.clients[clientId];
    assertContract(
      client.actor === requiredClients[clientId].actor
        && client.platform === requiredClients[clientId].platform,
      'RUNTIME_CLIENT_IDENTITY_INVALID',
      `${clientId} actor or platform does not match the matrix`,
    );
    assertContract(
      client.sourceHead === sourceIdentity.head,
      'RUNTIME_CLIENT_SOURCE_MISMATCH',
      `${clientId} is not bound to the exact source head`,
    );
    assertContract(
      client.foreground === true,
      'RUNTIME_CLIENT_NOT_FOREGROUND',
      `${clientId} is not declared as a foreground client`,
    );
    for (const field of ['deviceId', 'storageId']) {
      assertContract(
        typeof client[field] === 'string' && client[field].trim(),
        'RUNTIME_CLIENT_FIELD_REQUIRED',
        `${clientId}.${field} is required`,
      );
    }
    assertContract(
      !deviceIds.has(client.deviceId),
      'RUNTIME_DEVICE_REUSED',
      `${clientId} reuses device ${client.deviceId}`,
    );
    assertContract(
      !storageIds.has(client.storageId),
      'RUNTIME_STORAGE_REUSED',
      `${clientId} reuses storage ${client.storageId}`,
    );
    deviceIds.add(client.deviceId);
    storageIds.add(client.storageId);
    assertContract(
      client.webdriver && typeof client.webdriver === 'object',
      'RUNTIME_WEBDRIVER_REQUIRED',
      `${clientId}.webdriver is required`,
    );
    const serverUrl = normalizeUrl(
      client.webdriver.serverUrl,
      `${clientId}.webdriver.serverUrl`,
    );
    assertContract(
      typeof client.webdriver.sessionId === 'string'
        && /^[A-Za-z0-9._:-]+$/.test(client.webdriver.sessionId),
      'RUNTIME_WEBDRIVER_SESSION_INVALID',
      `${clientId}.webdriver.sessionId is invalid`,
    );
    const sessionKey = `${serverUrl}/${client.webdriver.sessionId}`;
    assertContract(
      !sessionKeys.has(sessionKey),
      'RUNTIME_WEBDRIVER_SESSION_REUSED',
      `${clientId} reuses a WebDriver session`,
    );
    sessionKeys.add(sessionKey);
  }
  return {
    clientCount: clientIds.length,
    deviceCount: deviceIds.size,
    storageCount: storageIds.size,
    sessionCount: sessionKeys.size,
  };
}

export function scenariosForPhase(matrix, phase) {
  assertContract(
    phase === 'all' || requiredPhases.includes(phase),
    'PHASE_INVALID',
    `phase must be one of ${requiredPhases.join(', ')}, all`,
  );
  const phases = phase === 'all' ? requiredPhases : [phase];
  return phases.flatMap((phaseId) => (
    matrix.phases[phaseId].map((scenario) => ({ ...scenario, phase: phaseId }))
  ));
}

function parseArgs(argv) {
  const options = {
    evidenceDir: '',
    list: false,
    phase: '',
    preflightOnly: false,
    runtimeManifest: process.env.PT_THREE_CLIENT_RUNTIME_MANIFEST || '',
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--self-test') options.selfTest = true;
    else if (flag === '--list') options.list = true;
    else if (flag === '--preflight-only') options.preflightOnly = true;
    else if (flag === '--phase') options.phase = argv[++index] || '';
    else if (flag === '--runtime-manifest') {
      options.runtimeManifest = argv[++index] || '';
    } else if (flag === '--evidence-dir') {
      options.evidenceDir = argv[++index] || '';
    } else {
      throw new JourneyContractError(
        'ARGUMENT_UNSUPPORTED',
        `unsupported argument ${flag}`,
      );
    }
  }
  return options;
}

function webdriverEndpoint(client, suffix) {
  const serverUrl = client.webdriver.serverUrl.replace(/\/$/, '');
  const sessionId = encodeURIComponent(client.webdriver.sessionId);
  return `${serverUrl}/session/${sessionId}${suffix}`;
}

async function webdriverRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new JourneyContractError(
        'WEBDRIVER_RESPONSE_INVALID',
        `WebDriver returned non-JSON from ${url}`,
      );
    }
  }
  assertContract(
    response.ok,
    'WEBDRIVER_REQUEST_FAILED',
    `WebDriver ${response.status} from ${url}: ${text.slice(0, 300)}`,
  );
  return payload?.value ?? payload;
}

async function selectWebContext(client) {
  if (client.platform === 'desktop') return null;
  const current = await webdriverRequest(
    webdriverEndpoint(client, '/context'),
  ).catch(() => null);
  const contexts = await webdriverRequest(
    webdriverEndpoint(client, '/contexts'),
  );
  assertContract(
    Array.isArray(contexts),
    'WEBDRIVER_CONTEXTS_INVALID',
    `${client.platform} WebDriver contexts are invalid`,
  );
  const webContext = contexts.find((entry) => (
    typeof entry === 'string' && entry.toUpperCase().includes('WEBVIEW')
  ));
  assertContract(
    webContext,
    'WEBDRIVER_WEBVIEW_MISSING',
    `${client.platform} client has no WebView context`,
  );
  await webdriverRequest(webdriverEndpoint(client, '/context'), {
    method: 'POST',
    body: JSON.stringify({ name: webContext }),
  });
  return current;
}

async function restoreContext(client, context) {
  if (!context || client.platform === 'desktop') return;
  await webdriverRequest(webdriverEndpoint(client, '/context'), {
    method: 'POST',
    body: JSON.stringify({ name: context }),
  });
}

async function probeClient(clientId, client, evidenceDir) {
  const statusUrl = `${client.webdriver.serverUrl.replace(/\/$/, '')}/status`;
  await webdriverRequest(statusUrl);
  const priorContext = await selectWebContext(client);
  try {
    const foreground = await webdriverRequest(
      webdriverEndpoint(client, '/execute/sync'),
      {
        method: 'POST',
        body: JSON.stringify({
          script: `
            return {
              hasFocus: document.hasFocus(),
              visibilityState: document.visibilityState,
              title: document.title,
              url: location.href,
              bodyText: (document.body?.innerText || '').slice(0, 1000)
            };
          `,
          args: [],
        }),
      },
    );
    assertContract(
      foreground
        && foreground.visibilityState === 'visible'
        && foreground.hasFocus === true,
      'WEBDRIVER_CLIENT_NOT_FOREGROUND',
      `${clientId} is not visible and focused`,
    );
    const screenshot = await webdriverRequest(
      webdriverEndpoint(client, '/screenshot'),
    );
    assertContract(
      typeof screenshot === 'string' && screenshot.length > 100,
      'WEBDRIVER_SCREENSHOT_INVALID',
      `${clientId} screenshot is missing`,
    );
    const source = await webdriverRequest(
      webdriverEndpoint(client, '/source'),
    );
    assertContract(
      typeof source === 'string' && source.trim(),
      'WEBDRIVER_SOURCE_INVALID',
      `${clientId} accessibility or DOM source is missing`,
    );
    const screenshotPath = path.join(evidenceDir, `${clientId}.png`);
    const sourcePath = path.join(evidenceDir, `${clientId}.source.txt`);
    writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    writeFileSync(sourcePath, source);
    return {
      clientId,
      foreground: {
        hasFocus: foreground.hasFocus,
        visibilityState: foreground.visibilityState,
        title: foreground.title,
      },
      screenshot: {
        path: screenshotPath,
        sha256: createHash('sha256')
          .update(Buffer.from(screenshot, 'base64'))
          .digest('hex'),
      },
      source: {
        path: sourcePath,
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    };
  } finally {
    await restoreContext(client, priorContext);
  }
}

function defaultEvidenceDir(phase) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const machineRoot = process.env.PT_MACHINE_DEV_ROOT
    || path.join(homedir(), '.peers-touch', 'workflow');
  return path.join(
    machineRoot,
    'artifacts',
    'three-client-product-journey',
    'three-client',
    `${stamp}-${phase}`,
  );
}

async function runPreflight(matrix, phase, runtimeManifestPath, evidenceDir) {
  assertContract(
    runtimeManifestPath,
    'RUNTIME_MANIFEST_REQUIRED',
    '--runtime-manifest or PT_THREE_CLIENT_RUNTIME_MANIFEST is required',
  );
  const sourceIdentity = resolveSourceIdentity();
  const manifest = readJson(
    path.resolve(runtimeManifestPath),
    'runtime manifest',
  );
  validateRuntimeManifest(manifest, sourceIdentity);
  const scenarios = scenariosForPhase(matrix, phase);
  mkdirSync(evidenceDir, { recursive: true });
  const clients = [];
  for (const clientId of requiredClientIds) {
    clients.push(await probeClient(
      clientId,
      manifest.clients[clientId],
      evidenceDir,
    ));
  }
  const report = {
    kind: 'peers-touch-three-client-journey-preflight',
    schemaVersion: 1,
    phase,
    status: 'READY',
    source: sourceIdentity,
    stationUrl: manifest.stationUrl,
    scenarioIds: scenarios.map((scenario) => scenario.id),
    clients,
    observedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(evidenceDir, 'preflight.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function selfTest(matrix) {
  const matrixSummary = validateMatrix(matrix);
  assertContract(
    scenariosForPhase(matrix, 'chat').length === 6,
    'SELF_TEST_CHAT_COUNT',
    'chat phase scenario count changed unexpectedly',
  );
  assertContract(
    scenariosForPhase(matrix, 'all').length === matrixSummary.scenarioCount,
    'SELF_TEST_ALL_COUNT',
    'all phase does not include every scenario',
  );
  const sourceIdentity = {
    head: '0123456789abcdef0123456789abcdef01234567',
    dirty: false,
    worktree: repoRoot,
  };
  const manifest = {
    kind: 'peers-touch-three-client-runtime-manifest',
    schemaVersion: 1,
    source: { ...sourceIdentity },
    stationUrl: 'http://127.0.0.1:18132',
    clients: Object.fromEntries(requiredClientIds.map((clientId, index) => {
      const client = matrix.clients[clientId];
      return [clientId, {
        actor: client.actor,
        platform: client.platform,
        sourceHead: sourceIdentity.head,
        foreground: true,
        deviceId: `device-${index}`,
        storageId: `storage-${index}`,
        webdriver: {
          serverUrl: `http://127.0.0.1:${4700 + index}`,
          sessionId: `session-${index}`,
        },
      }];
    })),
  };
  const runtimeSummary = validateRuntimeManifest(manifest, sourceIdentity);
  const duplicateStorage = structuredClone(manifest);
  duplicateStorage.clients['ios-coral'].storageId = (
    duplicateStorage.clients['android-alice'].storageId
  );
  let duplicateRejected = false;
  try {
    validateRuntimeManifest(duplicateStorage, sourceIdentity);
  } catch (error) {
    duplicateRejected = error instanceof JourneyContractError
      && error.code === 'RUNTIME_STORAGE_REUSED';
  }
  assertContract(
    duplicateRejected,
    'SELF_TEST_FAIL_CLOSED',
    'runtime manifest did not reject reused storage',
  );
  const unknownPrecondition = structuredClone(matrix);
  unknownPrecondition.phases.entry[0].preconditions = ['unknown-runtime'];
  let unknownPreconditionRejected = false;
  try {
    validateMatrix(unknownPrecondition);
  } catch (error) {
    unknownPreconditionRejected = error instanceof JourneyContractError
      && error.code === 'MATRIX_PRECONDITION_UNKNOWN';
  }
  assertContract(
    unknownPreconditionRejected,
    'SELF_TEST_PRECONDITION_REFERENCE',
    'matrix did not reject an unknown precondition',
  );
  const cyclicMatrix = structuredClone(matrix);
  cyclicMatrix.phases.entry[0].preconditions = [
    'entry-restore-logout-relogin',
  ];
  let cycleRejected = false;
  try {
    validateMatrix(cyclicMatrix);
  } catch (error) {
    cycleRejected = error instanceof JourneyContractError
      && error.code === 'MATRIX_PRECONDITION_CYCLE';
  }
  assertContract(
    cycleRejected,
    'SELF_TEST_PRECONDITION_CYCLE',
    'matrix did not reject a precondition cycle',
  );
  return {
    status: 'PASS',
    matrix: {
      clientCount: matrixSummary.clientCount,
      phaseCount: matrixSummary.phaseCount,
      scenarioCount: matrixSummary.scenarioCount,
    },
    runtime: runtimeSummary,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = readJson(matrixPath, 'journey matrix');
  if (options.selfTest) {
    process.stdout.write(`${JSON.stringify(selfTest(matrix), null, 2)}\n`);
    return;
  }
  const summary = validateMatrix(matrix);
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      phases: requiredPhases,
      scenarios: summary.scenarios.map(({ id, phase, clients }) => ({
        id,
        phase,
        clients,
      })),
    }, null, 2)}\n`);
    return;
  }
  assertContract(
    options.phase,
    'PHASE_REQUIRED',
    '--phase is required',
  );
  const evidenceDir = path.resolve(
    options.evidenceDir || defaultEvidenceDir(options.phase),
  );
  const preflight = await runPreflight(
    matrix,
    options.phase,
    options.runtimeManifest,
    evidenceDir,
  );
  if (!options.preflightOnly) {
    throw new JourneyContractError(
      'PHASE_UI_BINDING_REQUIRED',
      [
        `phase ${options.phase} has passed exact-source three-client preflight`,
        'but its foreground UI action binding has not been implemented yet',
        'the runner refuses to substitute an API or headless check',
      ].join('; '),
    );
  }
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof JourneyContractError
    ? error.code
    : 'UNEXPECTED_FAILURE';
  process.stderr.write(`FAIL ${code}: ${error.message}\n`);
  process.exitCode = 1;
});
