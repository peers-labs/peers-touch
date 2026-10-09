#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..', '..');
const mobileApplicationId = 'com.peers.touch.mobile';
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
const webdriverElementKey = 'element-6066-11e4-a52e-4f735466cecf';
const clientAccounts = Object.freeze({
  'android-alice': Object.freeze({
    email: 'alice@p.t',
    friendlyName: 'Alice',
  }),
  'desktop-bob': Object.freeze({
    email: 'bob@p.t',
    friendlyName: 'Bob',
  }),
  'ios-coral': Object.freeze({
    email: 'carol@p.t',
    friendlyName: 'Carol',
  }),
});
const demoPassport = '1';
const invalidPassport = 'invalid-entry-proof';
const uiWaitTimeoutMs = 45_000;
const uiPollIntervalMs = 250;
const nativeRelaunchTimeoutMs = 60_000;

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
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (
      error?.name === 'AbortError'
      || error?.name === 'TimeoutError'
    ) {
      throw new JourneyContractError(
        'WEBDRIVER_REQUEST_TIMEOUT',
        `WebDriver request timed out at ${url}`,
      );
    }
    throw error;
  }
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

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryableUiPollError(error) {
  return error instanceof JourneyContractError
    && [
      'WEBDRIVER_REQUEST_FAILED',
      'WEBDRIVER_REQUEST_TIMEOUT',
    ].includes(error.code);
}

function evidenceFileSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function executeWebScript(client, script, args = []) {
  return webdriverRequest(
    webdriverEndpoint(client, '/execute/sync'),
    {
      method: 'POST',
      body: JSON.stringify({ script, args }),
    },
  );
}

async function waitForVisualFrame(client) {
  await webdriverRequest(
    webdriverEndpoint(client, '/execute/async'),
    {
      method: 'POST',
      body: JSON.stringify({
        script: `
          const done = arguments[arguments.length - 1];
          const nextFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback) => setTimeout(callback, 16);
          nextFrame(() => nextFrame(() => setTimeout(() => done(true), 50)));
        `,
        args: [],
      }),
    },
  );
}

async function selectWebContext(client) {
  if (client.platform === 'desktop') return null;
  const current = await webdriverRequest(
    webdriverEndpoint(client, '/context'),
  ).catch(() => null);
  if (
    typeof current === 'string'
    && current.toUpperCase().includes('WEBVIEW')
  ) {
    return null;
  }
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

async function withWebContext(client, operation) {
  const priorContext = await selectWebContext(client);
  try {
    return await operation();
  } finally {
    await restoreContext(client, priorContext);
  }
}

async function findElement(client, using, value, optional = false) {
  try {
    const result = await webdriverRequest(
      webdriverEndpoint(client, '/element'),
      {
        method: 'POST',
        body: JSON.stringify({ using, value }),
      },
    );
    const elementId = result?.[webdriverElementKey] ?? result?.ELEMENT;
    assertContract(
      typeof elementId === 'string' && elementId,
      'WEBDRIVER_ELEMENT_INVALID',
      `WebDriver did not return an element for ${using}=${value}`,
    );
    return elementId;
  } catch (error) {
    if (optional && error instanceof JourneyContractError) return null;
    throw error;
  }
}

async function clickElement(client, elementId) {
  await webdriverRequest(
    webdriverEndpoint(client, `/element/${encodeURIComponent(elementId)}/click`),
    {
      method: 'POST',
      body: '{}',
    },
  );
}

async function clickSelector(client, selector, label) {
  const elementId = await findElement(client, 'css selector', selector);
  await clickElement(client, elementId);
  return { label, selector };
}

async function clickXpath(client, xpath, label, optional = false) {
  const elementId = await findElement(client, 'xpath', xpath, optional);
  if (!elementId) return false;
  await clickElement(client, elementId);
  return { label, xpath };
}

async function setInputValue(client, selector, value, label) {
  const result = await executeWebScript(
    client,
    `
      const selector = arguments[0];
      const value = arguments[1];
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLInputElement)
        && !(element instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: 'missing-input' };
      }
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (!descriptor?.set) {
        return { ok: false, reason: 'missing-native-setter' };
      }
      element.focus();
      descriptor.set.call(element, value);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText'
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: element.value === value,
        active: document.activeElement === element,
        value: element.value
      };
    `,
    [selector, value],
  );
  assertContract(
    result?.ok === true,
    'WEBDRIVER_INPUT_FAILED',
    `${label} could not set ${selector}: ${result?.reason || 'unknown error'}`,
  );
  return { label, selector, valueLength: value.length };
}

async function selectorIsVisible(client, selector) {
  return executeWebScript(
    client,
    `
      const element = document.querySelector(arguments[0]);
      return Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
    `,
    [selector],
  );
}

async function waitForUi(clientId, client, label, script, args = []) {
  const deadline = Date.now() + uiWaitTimeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await executeWebScript(client, script, args);
      if (lastValue?.ready === true || lastValue === true) return lastValue;
    } catch (error) {
      if (!retryableUiPollError(error)) throw error;
      lastValue = {
        webdriverError: error.message,
      };
    }
    await sleep(uiPollIntervalMs);
  }
  throw new JourneyContractError(
    'WEBDRIVER_UI_TIMEOUT',
    `${clientId} timed out waiting for ${label}: ${JSON.stringify(lastValue).slice(0, 600)}`,
  );
}

async function readClientUiState(client) {
  return executeWebScript(
    client,
    `
      const visible = (element) => Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
      const visibleSurfaces = [...document.querySelectorAll('[data-product-surface]')]
        .filter(visible)
        .map((element) => element.getAttribute('data-product-surface'));
      const dialogs = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"]')]
        .filter(visible)
        .map((element) => (element.innerText || '').trim().slice(0, 1000));
      const runtimeNotices = [...document.querySelectorAll('[data-runtime-ids]')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            blocking: (
              rect.width >= window.innerWidth * 0.9
              && rect.height >= window.innerHeight * 0.6
            ),
            height: rect.height,
            ids: element.getAttribute('data-runtime-ids') || '',
            text: (element.innerText || '').trim().slice(0, 1000),
            width: rect.width
          };
        });
      const stationTrigger = document.querySelector('[data-station-picker-trigger]');
      return {
        bodyText: (document.body?.innerText || '').slice(0, 6000),
        dialogs,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        navCount: document.querySelectorAll('[data-pt-primary-nav]').length,
        stationLabel: stationTrigger
          ? (stationTrigger.innerText || '').trim().split('\\n')[0]
          : '',
        surface: visibleSurfaces.find((surface) => surface?.startsWith('shell.'))
          || visibleSurfaces[0]
          || '',
        runtimeNotices,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        visibleSurfaces
      };
    `,
  );
}

async function captureJourneyStep(
  clientId,
  client,
  evidenceDir,
  sequence,
  stepId,
) {
  const fileStem = [
    String(sequence).padStart(3, '0'),
    evidenceFileSegment(clientId),
    evidenceFileSegment(stepId),
  ].join('-');
  await waitForVisualFrame(client);
  const screenshot = await webdriverRequest(
    webdriverEndpoint(client, '/screenshot'),
  );
  const source = await webdriverRequest(
    webdriverEndpoint(client, '/source'),
  );
  const state = await readClientUiState(client);
  assertContract(
    typeof screenshot === 'string' && screenshot.length > 100,
    'WEBDRIVER_SCREENSHOT_INVALID',
    `${clientId} screenshot is missing at ${stepId}`,
  );
  assertContract(
    typeof source === 'string' && source.trim(),
    'WEBDRIVER_SOURCE_INVALID',
    `${clientId} source is missing at ${stepId}`,
  );
  const screenshotPath = path.join(evidenceDir, `${fileStem}.png`);
  const sourcePath = path.join(evidenceDir, `${fileStem}.source.txt`);
  const statePath = path.join(evidenceDir, `${fileStem}.state.json`);
  writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
  writeFileSync(sourcePath, source);
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return {
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
    state: {
      path: statePath,
      sha256: createHash('sha256')
        .update(JSON.stringify(state))
        .digest('hex'),
      value: state,
    },
  };
}

async function recordJourneyStep({
  action,
  client,
  clientId,
  evidenceDir,
  interactionTrace,
  sequence,
  stepId,
}) {
  const startedAt = new Date().toISOString();
  try {
    const result = await action();
    const evidence = await captureJourneyStep(
      clientId,
      client,
      evidenceDir,
      sequence,
      stepId,
    );
    const record = {
      clientId,
      evidence,
      result,
      sequence,
      startedAt,
      status: 'PASS',
      stepId,
      completedAt: new Date().toISOString(),
    };
    interactionTrace.push(record);
    return record;
  } catch (error) {
    let evidence = null;
    try {
      evidence = await captureJourneyStep(
        clientId,
        client,
        evidenceDir,
        sequence,
        `${stepId}-failed`,
      );
    } catch {
      // Preserve the first actionable interaction failure.
    }
    interactionTrace.push({
      clientId,
      evidence,
      error: error instanceof Error ? error.message : String(error),
      sequence,
      startedAt,
      status: 'FAIL',
      stepId,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function activateForegroundClient(clientId, client) {
  if (client.platform === 'desktop') {
    const result = await webdriverRequest(
      webdriverEndpoint(client, '/execute/async'),
      {
        method: 'POST',
        body: JSON.stringify({
          script: `
            const done = arguments[arguments.length - 1];
            window.__TAURI__.window.getCurrentWindow().setFocus()
              .then(() => done({ ok: true }))
              .catch((error) => done({ ok: false, error: String(error) }));
          `,
          args: [],
        }),
      },
    );
    assertContract(
      result?.ok === true,
      'WEBDRIVER_CLIENT_NOT_FOREGROUND',
      `${clientId} could not focus its native window: ${result?.error || 'unknown error'}`,
    );
    await waitForUi(
      clientId,
      client,
      'Desktop native window focus',
      `
        return {
          ready: document.hasFocus()
            && document.visibilityState === 'visible'
        };
      `,
    );
    return null;
  }
  await webdriverRequest(
    webdriverEndpoint(client, '/appium/device/activate_app'),
    {
      method: 'POST',
      body: JSON.stringify({ appId: mobileApplicationId }),
    },
  );
  const state = await webdriverRequest(
    webdriverEndpoint(client, '/appium/device/app_state'),
    {
      method: 'POST',
      body: JSON.stringify({ appId: mobileApplicationId }),
    },
  );
  assertContract(
    state === 4,
    'WEBDRIVER_CLIENT_NOT_FOREGROUND',
    `${clientId} native application state is ${state}, expected foreground`,
  );
  return state;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, label) {
  const deadline = Date.now() + nativeRelaunchTimeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await sleep(uiPollIntervalMs);
  }
  throw new JourneyContractError(
    'NATIVE_PROCESS_EXIT_TIMEOUT',
    `${label} process ${pid} did not exit`,
  );
}

async function waitForWebDriverServer(serverUrl, label) {
  const deadline = Date.now() + nativeRelaunchTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, '')}/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(uiPollIntervalMs);
  }
  throw new JourneyContractError(
    'WEBDRIVER_SERVER_RESTART_TIMEOUT',
    `${label} WebDriver server did not restart: ${lastError}`,
  );
}

function desktopListenerPid(clientId, client) {
  const port = new URL(client.webdriver.serverUrl).port;
  assertContract(
    /^\d+$/.test(port),
    'DESKTOP_WEBDRIVER_PORT_INVALID',
    `${clientId} WebDriver URL has no port`,
  );
  const output = execFileSync(
    'lsof',
    [`-tiTCP:${port}`, '-sTCP:LISTEN'],
    { encoding: 'utf8' },
  );
  const pids = [...new Set(
    output.split(/\s+/).filter(Boolean).map((value) => Number(value)),
  )];
  assertContract(
    pids.length === 1 && Number.isInteger(pids[0]) && pids[0] > 0,
    'DESKTOP_PROCESS_IDENTITY_INVALID',
    `${clientId} WebDriver listener is ambiguous: ${pids.join(', ')}`,
  );
  return pids[0];
}

function desktopExecutable(clientId, pid) {
  const output = execFileSync(
    'lsof',
    ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-Fn'],
    { encoding: 'utf8' },
  );
  const candidates = [...new Set(
    output
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1))
      .filter((candidate) => path.basename(candidate) === 'peers-touch-desktop'),
  )];
  assertContract(
    candidates.length === 1,
    'DESKTOP_EXECUTABLE_IDENTITY_INVALID',
    `${clientId} native executable is ambiguous: ${candidates.join(', ')}`,
  );
  return candidates[0];
}

function processEnvironmentValue(command, key) {
  const match = command.match(
    new RegExp(`(?:^|\\s)${key}=([^\\s]+)(?=\\s|$)`),
  );
  return match?.[1] || '';
}

function desktopRelaunchEnvironment(clientId, client, pid) {
  const command = execFileSync(
    'ps',
    ['eww', '-p', String(pid), '-o', 'command='],
    { encoding: 'utf8' },
  );
  const requiredKeys = [
    'PEERS_STORAGE_ROOT',
    'PT_GATEWAY_PORT',
    'PT_PROFILE',
    'TAURI_WEBDRIVER_PORT',
  ];
  const preserved = Object.fromEntries(requiredKeys.map((key) => [
    key,
    processEnvironmentValue(command, key),
  ]));
  for (const key of requiredKeys) {
    assertContract(
      preserved[key],
      'DESKTOP_RELAUNCH_ENVIRONMENT_MISSING',
      `${clientId} native process is missing ${key}`,
    );
  }
  assertContract(
    `desktop:${preserved.PEERS_STORAGE_ROOT}` === client.storageId,
    'DESKTOP_RELAUNCH_STORAGE_MISMATCH',
    `${clientId} relaunch storage does not match the runtime manifest`,
  );
  assertContract(
    preserved.TAURI_WEBDRIVER_PORT === new URL(
      client.webdriver.serverUrl,
    ).port,
    'DESKTOP_RELAUNCH_WEBDRIVER_MISMATCH',
    `${clientId} relaunch WebDriver port does not match the runtime manifest`,
  );
  return {
    ...process.env,
    ...preserved,
  };
}

async function createDesktopWebDriverSession(clientId, client) {
  const serverUrl = client.webdriver.serverUrl.replace(/\/$/, '');
  const created = await webdriverRequest(`${serverUrl}/session`, {
    method: 'POST',
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:chromeOptions': {
            args: [],
            extensions: [],
          },
        },
        firstMatch: [{}],
      },
    }),
  });
  assertContract(
    typeof created?.sessionId === 'string' && created.sessionId,
    'DESKTOP_WEBDRIVER_RECONNECT_FAILED',
    `${clientId} WebDriver session response has no sessionId`,
  );
  client.webdriver.sessionId = created.sessionId;
  await webdriverRequest(webdriverEndpoint(client, '/timeouts'), {
    method: 'POST',
    body: JSON.stringify({ script: 30_000 }),
  });
  await webdriverRequest(webdriverEndpoint(client, '/window/rect'), {
    method: 'POST',
    body: JSON.stringify({ height: 800, width: 1200, x: 360, y: 92 }),
  });
  await waitForUi(
    clientId,
    client,
    'Desktop renderer after native relaunch',
    `
      return {
        ready: document.readyState === 'complete'
          && Boolean(document.body)
          && document.visibilityState === 'visible'
      };
    `,
  );
  return created.sessionId;
}

async function relaunchDesktopClient(clientId, client, evidenceDir) {
  const oldSessionId = client.webdriver.sessionId;
  const oldPid = desktopListenerPid(clientId, client);
  const executable = desktopExecutable(clientId, oldPid);
  const environment = desktopRelaunchEnvironment(
    clientId,
    client,
    oldPid,
  );
  const logPath = path.join(
    evidenceDir,
    `${evidenceFileSegment(clientId)}-native-relaunch.log`,
  );
  process.kill(oldPid, 'SIGTERM');
  await waitForProcessExit(oldPid, clientId);
  const logDescriptor = openSync(logPath, 'a');
  let child;
  try {
    child = spawn(executable, [], {
      cwd: repoRoot,
      detached: true,
      env: environment,
      stdio: ['ignore', logDescriptor, logDescriptor],
    });
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  assertContract(
    Number.isInteger(child.pid) && child.pid > 0,
    'DESKTOP_RELAUNCH_FAILED',
    `${clientId} did not start a replacement native process`,
  );
  await waitForWebDriverServer(client.webdriver.serverUrl, clientId);
  const newSessionId = await createDesktopWebDriverSession(clientId, client);
  await activateForegroundClient(clientId, client);
  return {
    executable,
    logPath,
    newPid: child.pid,
    newSessionId,
    oldPid,
    oldSessionId,
  };
}

async function waitForMobileWebContext(clientId, client) {
  const deadline = Date.now() + nativeRelaunchTimeoutMs;
  let lastContexts = [];
  while (Date.now() < deadline) {
    try {
      const contexts = await webdriverRequest(
        webdriverEndpoint(client, '/contexts'),
      );
      if (Array.isArray(contexts)) {
        lastContexts = contexts;
        const webContext = contexts.find((entry) => (
          typeof entry === 'string'
          && entry.toUpperCase().includes('WEBVIEW')
        ));
        if (webContext) {
          await webdriverRequest(webdriverEndpoint(client, '/context'), {
            method: 'POST',
            body: JSON.stringify({ name: webContext }),
          });
          const rendererReady = await executeWebScript(
            client,
            'return document.readyState === "complete" && Boolean(document.body);',
          );
          if (rendererReady) return webContext;
        }
      }
    } catch (error) {
      if (!retryableUiPollError(error)) throw error;
    }
    await sleep(uiPollIntervalMs);
  }
  throw new JourneyContractError(
    'MOBILE_WEBVIEW_RECONNECT_TIMEOUT',
    `${clientId} did not expose a ready WebView: ${lastContexts.join(', ')}`,
  );
}

async function relaunchMobileClient(clientId, client) {
  const currentContext = await webdriverRequest(
    webdriverEndpoint(client, '/context'),
  ).catch(() => null);
  if (
    typeof currentContext === 'string'
    && currentContext.toUpperCase() !== 'NATIVE_APP'
  ) {
    await webdriverRequest(webdriverEndpoint(client, '/context'), {
      method: 'POST',
      body: JSON.stringify({ name: 'NATIVE_APP' }),
    });
  }
  const applicationKey = client.platform === 'ios' ? 'bundleId' : 'appId';
  const application = { [applicationKey]: mobileApplicationId };
  await webdriverRequest(webdriverEndpoint(client, '/execute/sync'), {
    method: 'POST',
    body: JSON.stringify({
      script: 'mobile: terminateApp',
      args: [application],
    }),
  });
  await webdriverRequest(webdriverEndpoint(client, '/execute/sync'), {
    method: 'POST',
    body: JSON.stringify({
      script: 'mobile: activateApp',
      args: [application],
    }),
  });
  const deadline = Date.now() + nativeRelaunchTimeoutMs;
  let nativeApplicationState = null;
  while (Date.now() < deadline) {
    nativeApplicationState = await webdriverRequest(
      webdriverEndpoint(client, '/appium/device/app_state'),
      {
        method: 'POST',
        body: JSON.stringify({ appId: mobileApplicationId }),
      },
    );
    if (nativeApplicationState === 4) break;
    await sleep(uiPollIntervalMs);
  }
  assertContract(
    nativeApplicationState === 4,
    'MOBILE_NATIVE_RELAUNCH_FAILED',
    `${clientId} did not return to foreground after native relaunch`,
  );
  const webContext = await waitForMobileWebContext(clientId, client);
  return {
    nativeApplicationState,
    sessionId: client.webdriver.sessionId,
    webContext,
  };
}

async function relaunchClient(clientId, client, evidenceDir) {
  return client.platform === 'desktop'
    ? relaunchDesktopClient(clientId, client, evidenceDir)
    : relaunchMobileClient(clientId, client);
}

async function probeClient(clientId, client, evidenceDir) {
  const statusUrl = `${client.webdriver.serverUrl.replace(/\/$/, '')}/status`;
  await webdriverRequest(statusUrl);
  const nativeApplicationState = await activateForegroundClient(
    clientId,
    client,
  );
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
        && (
          client.platform !== 'desktop'
          || foreground.hasFocus === true
        ),
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
        nativeApplicationState,
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

async function ensureMobileAuthenticated(
  clientId,
  client,
  stationUrl,
  account,
) {
  let state = await readClientUiState(client);
  if (
    state.surface.startsWith('shell.')
    && state.bodyText.includes('Restore Account Identity')
  ) {
    await clickXpath(
      client,
      '//button[normalize-space(.)="Switch Station"]',
      'switch-station-from-identity-recovery',
    );
    await waitForUi(
      clientId,
      client,
      'Station selection after identity recovery',
      `
        const surface = document.querySelector('[data-product-surface="entry.station-selection"]');
        return { ready: Boolean(surface) };
      `,
    );
    state = await readClientUiState(client);
  }

  if (state.surface === 'entry.station-selection') {
    const stationState = await executeWebScript(
      client,
      `
        return {
          active: Boolean(document.querySelector('.station-entry.active')),
          input: Boolean(document.querySelector(
            'input[aria-label="Station or private connection"]'
          ))
        };
      `,
    );
    if (!stationState?.active) {
      assertContract(
        stationState?.input === true,
        'MOBILE_STATION_INPUT_MISSING',
        `${clientId} has no active Station or Station input`,
      );
      await setInputValue(
        client,
        'input[aria-label="Station or private connection"]',
        stationUrl,
        'station-address',
      );
      await clickSelector(
        client,
        'button[aria-label="Add Station"]',
        'add-station',
      );
      await waitForUi(
        clientId,
        client,
        'verified active Station',
        `
          const entry = document.querySelector('.station-entry.active');
          const status = entry?.querySelector('.station-entry-status');
          return {
            ready: Boolean(entry && status?.classList.contains('online')),
            status: status?.innerText || ''
          };
        `,
      );
    }
    await clickXpath(
      client,
      '//button[normalize-space(.)="Continue"]',
      'continue-with-station',
    );
    await waitForUi(
      clientId,
      client,
      'access gate or authenticated shell',
      `
        const shell = document.querySelector('[data-product-surface^="shell."]');
        const access = document.querySelector('[data-product-surface^="entry.access-"]');
        return { ready: Boolean(shell || access) };
      `,
    );
    state = await readClientUiState(client);
  }

  if (!state.surface.startsWith('shell.')) {
    const emailInputVisible = await selectorIsVisible(
      client,
      'input[placeholder="Email address"]',
    );
    if (!emailInputVisible) {
      await clickXpath(
        client,
        '//button[normalize-space(.)="Email Login"]',
        'open-email-login',
      );
    }
    await waitForUi(
      clientId,
      client,
      'email login form',
      `
        const visible = (element) => Boolean(
          element
          && element.getClientRects().length
          && getComputedStyle(element).visibility !== 'hidden'
          && getComputedStyle(element).display !== 'none'
        );
        return {
          ready: (
            visible(document.querySelector('input[placeholder="Email address"]'))
            && visible(document.querySelector('input[placeholder="Password"]'))
          )
        };
      `,
    );
    await setInputValue(
      client,
      'input[placeholder="Email address"]',
      account.email,
      'login-email',
    );
    await setInputValue(
      client,
      'input[placeholder="Password"]',
      demoPassport,
      'login-password',
    );
    await clickXpath(
      client,
      '//button[normalize-space(.)="Sign In"]',
      'submit-login',
    );
    const loginResult = await waitForUi(
      clientId,
      client,
      'authenticated shell',
      `
        const surface = [...document.querySelectorAll('[data-product-surface]')]
          .find((element) => element.getClientRects().length)
          ?.getAttribute('data-product-surface') || '';
        const text = document.body?.innerText || '';
        return {
          ready: surface.startsWith('shell.') || surface === 'entry.login-failed',
          surface,
          text: text.slice(0, 1200)
        };
      `,
    );
    assertContract(
      loginResult.surface.startsWith('shell.'),
      'MOBILE_LOGIN_FAILED',
      `${clientId} login failed: ${loginResult.text}`,
    );
  }

  await waitForUi(
    clientId,
    client,
    'ready mobile shell',
    `
      const shell = document.querySelector('[data-product-surface^="shell."]');
      const text = document.body?.innerText || '';
      return {
        ready: Boolean(shell)
          && !text.includes('Features Loading'),
        text: text.slice(0, 1200)
      };
    `,
  );
  return readClientUiState(client);
}

async function ensureDesktopAuthenticated(clientId, client, stationUrl, account) {
  const sessionEnded = await findElement(
    client,
    'xpath',
    '//button[normalize-space(.)="Confirm"]',
    true,
  );
  if (sessionEnded) {
    await clickElement(client, sessionEnded);
    await sleep(uiPollIntervalMs);
  }

  let state = await readClientUiState(client);
  if (state.navCount > 0) return state;

  const accountChooser = await findElement(
    client,
    'xpath',
    '//button[normalize-space(.)="Sign in with another account"]',
    true,
  );
  if (accountChooser) {
    await clickElement(client, accountChooser);
    await sleep(uiPollIntervalMs);
  }

  const stationTrigger = await findElement(
    client,
    'css selector',
    '[data-station-picker-trigger]',
    true,
  );
  if (stationTrigger) {
    const stationLabel = (
      await executeWebScript(
        client,
        `
          return (
            document.querySelector('[data-station-picker-trigger]')?.innerText
            || ''
          ).trim().split('\\n')[0];
        `,
      )
    );
    if (!stationLabel) {
      await clickElement(client, stationTrigger);
      await setInputValue(
        client,
        'input[aria-label="Station or private connection"]',
        stationUrl,
        'desktop-station-address',
      );
      await clickSelector(
        client,
        'button[aria-label="Add Station"]',
        'desktop-add-station',
      );
    }
  }

  await clickSelector(
    client,
    '[data-login-tab="email"]',
    'desktop-open-email-login',
  );
  await setInputValue(
    client,
    '[data-login-email]',
    account.email,
    'desktop-login-email',
  );
  await setInputValue(
    client,
    '[data-login-password]',
    demoPassport,
    'desktop-login-password',
  );
  await clickSelector(
    client,
    '[data-login-submit]',
    'desktop-submit-login',
  );
  await waitForUi(
    clientId,
    client,
    'Desktop PIN decision or shell',
    `
      return {
        ready: Boolean(
          document.querySelector('[data-login-pin-skip]')
          || document.querySelector('[data-pt-primary-nav]')
        )
      };
    `,
  );
  const pinSkip = await findElement(
    client,
    'css selector',
    '[data-login-pin-skip]',
    true,
  );
  if (pinSkip) await clickElement(client, pinSkip);
  await waitForUi(
    clientId,
    client,
    'authenticated Desktop shell',
    `
      return {
        ready: document.querySelectorAll('[data-pt-primary-nav]').length > 0
      };
    `,
  );
  state = await readClientUiState(client);
  return state;
}

async function ensureAuthenticated(clientId, client, stationUrl) {
  const account = clientAccounts[clientId];
  assertContract(
    account,
    'CLIENT_ACCOUNT_MISSING',
    `${clientId} has no assigned foreground account`,
  );
  return client.platform === 'desktop'
    ? ensureDesktopAuthenticated(clientId, client, stationUrl, account)
    : ensureMobileAuthenticated(clientId, client, stationUrl, account);
}

function assertFriendlyStationLabel(clientId, label, stationUrl) {
  const value = String(label || '').trim();
  const stationHost = new URL(stationUrl).host;
  assertContract(
    value
      && value !== stationUrl
      && value !== stationHost
      && !/^https?:\/\//i.test(value)
      && !/^12D3Koo/i.test(value)
      && !/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value),
    'ENTRY_STATION_IDENTITY_RAW',
    `${clientId} shows a raw Station identity: ${value || '<missing>'}`,
  );
  return value;
}

async function assertEntryControlUsability(clientId, client) {
  const result = await executeWebScript(
    client,
    `
      const visible = (element) => Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
      const accessibleName = (element) => (
        element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.getAttribute('placeholder')
        || (element.innerText || '').trim()
      );
      const controls = [
        ...document.querySelectorAll('button, input, textarea, select')
      ].filter(visible);
      const unlabeled = controls
        .filter((element) => !accessibleName(element))
        .map((element) => element.outerHTML.slice(0, 240));
      const primaryActions = controls.filter((element) => (
        element.matches('.ant-btn-primary, [data-login-submit]')
        && !element.disabled
      ));
      return {
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        primaryActionCount: primaryActions.length,
        unlabeled,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    `,
  );
  assertContract(
    result?.unlabeled?.length === 0,
    'ENTRY_CONTROL_LABEL_MISSING',
    `${clientId} has unlabeled entry controls: ${JSON.stringify(result?.unlabeled)}`,
  );
  assertContract(
    result.primaryActionCount <= 1,
    'ENTRY_PRIMARY_ACTION_AMBIGUOUS',
    `${clientId} shows ${result.primaryActionCount} primary entry actions`,
  );
  assertContract(
    result.documentWidth <= result.viewportWidth + 2,
    'ENTRY_LAYOUT_OVERFLOW',
    `${clientId} entry layout exceeds the viewport`,
  );
  return result;
}

async function logoutMobileClient(clientId, client) {
  await navigateMobileShell(
    clientId,
    client,
    'settings',
    '[data-product-surface="settings.summary"]',
  );
  await clickXpath(
    client,
    '//button[normalize-space(.)="Sign Out"]',
    'open-mobile-logout-confirmation',
  );
  await waitForUi(
    clientId,
    client,
    'Mobile logout confirmation',
    `
      const surface = document.querySelector(
        '[data-product-surface="settings.logout-confirm"]'
      );
      return { ready: Boolean(surface?.getClientRects().length) };
    `,
  );
  await clickXpath(
    client,
    [
      '//div[@data-product-surface="settings.logout-confirm"]',
      '/ancestor::div[contains(@class,"ant-modal-content")]',
      '//button[normalize-space(.)="Log Out"]',
    ].join(''),
    'confirm-mobile-logout',
  );
  const result = await waitForUi(
    clientId,
    client,
    'Mobile entry after logout',
    `
      const surface = [...document.querySelectorAll('[data-product-surface]')]
        .find((element) => element.getClientRects().length)
        ?.getAttribute('data-product-surface') || '';
      return {
        ready: surface.startsWith('entry.'),
        surface
      };
    `,
  );
  assertContract(
    result.surface.startsWith('entry.'),
    'ENTRY_LOGOUT_FAILED',
    `${clientId} did not return to Mobile entry`,
  );
  return result;
}

async function logoutDesktopClient(clientId, client) {
  await navigateDesktopPrimary(
    clientId,
    client,
    'settings',
    '[data-pt-secondary-tab="general"]',
    'Settings',
  );
  await clickXpath(
    client,
    '//button[normalize-space(.)="Sign Out"]',
    'open-desktop-sign-out-confirmation',
  );
  await waitForUi(
    clientId,
    client,
    'Desktop sign out confirmation',
    `
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
        .filter((element) => element.getClientRects().length);
      return {
        ready: dialogs.some((dialog) => (
          (dialog.innerText || '').includes('Re-enter login page')
        ))
      };
    `,
  );
  await clickXpath(
    client,
    [
      '//div[@role="dialog"]',
      '[.//*[contains(normalize-space(.),"Re-enter login page")]]',
      '//button[normalize-space(.)="Confirm"]',
    ].join(''),
    'confirm-desktop-sign-out',
  );
  const result = await waitForUi(
    clientId,
    client,
    'Desktop entry after sign out',
    `
      const loginCard = document.querySelector('[data-pt-login-card]');
      return {
        ready: Boolean(loginCard?.getClientRects().length),
        text: (document.body?.innerText || '').slice(0, 1600)
      };
    `,
  );
  return result;
}

async function logoutThroughForegroundUi(clientId, client) {
  return client.platform === 'desktop'
    ? logoutDesktopClient(clientId, client)
    : logoutMobileClient(clientId, client);
}

async function prepareMobileStationSelection(
  clientId,
  client,
  stationUrl,
) {
  let state = await readClientUiState(client);
  if (state.surface !== 'entry.station-selection') {
    await clickXpath(
      client,
      '//button[normalize-space(.)="Change Station"]',
      'open-mobile-station-selection',
    );
    await waitForUi(
      clientId,
      client,
      'Mobile Station selection',
      `
        const surface = document.querySelector(
          '[data-product-surface="entry.station-selection"]'
        );
        return { ready: Boolean(surface?.getClientRects().length) };
      `,
    );
  }

  let stationState = await executeWebScript(
    client,
    `
      return {
        activeCount: document.querySelectorAll(
          '.station-entry.active .station-entry-main[aria-pressed="true"]'
        ).length,
        entryCount: document.querySelectorAll('.station-entry').length,
        hasInput: Boolean(document.querySelector(
          'input[aria-label="Station or private connection"]'
        ))
      };
    `,
  );
  if (stationState.entryCount === 0) {
    assertContract(
      stationState.hasInput === true,
      'MOBILE_STATION_INPUT_MISSING',
      `${clientId} has no Station input`,
    );
    await setInputValue(
      client,
      'input[aria-label="Station or private connection"]',
      stationUrl,
      'mobile-station-address',
    );
    await clickSelector(
      client,
      'button[aria-label="Add Station"]',
      'mobile-add-station',
    );
    stationState = await waitForUi(
      clientId,
      client,
      'single automatically active Mobile Station',
      `
        return {
          ready: document.querySelectorAll('.station-entry').length === 1
            && document.querySelectorAll(
              '.station-entry.active .station-entry-main[aria-pressed="true"]'
            ).length === 1,
          activeCount: document.querySelectorAll(
            '.station-entry.active .station-entry-main[aria-pressed="true"]'
          ).length,
          entryCount: document.querySelectorAll('.station-entry').length
        };
      `,
    );
  }
  assertContract(
    stationState.entryCount !== 1 || stationState.activeCount === 1,
    'ENTRY_SINGLE_STATION_NOT_ACTIVE',
    `${clientId} did not automatically activate its only configured Station`,
  );
  if (stationState.activeCount === 0) {
    throw new JourneyContractError(
      'ENTRY_ACTIVE_STATION_MISSING',
      `${clientId} has no active Station`,
    );
  }
  await clickSelector(
    client,
    '.station-entry.active .station-entry-main',
    'select-mobile-station',
  );
  const verified = await waitForUi(
    clientId,
    client,
    'verified Mobile Station',
    `
      const entry = document.querySelector('.station-entry.active');
      const status = entry?.querySelector('.station-entry-status');
      const label = entry?.querySelector('.station-entry-copy strong')?.innerText || '';
      return {
        ready: Boolean(
          entry
          && status?.classList.contains('online')
          && entry.querySelector('.station-entry-main')?.getAttribute('aria-pressed') === 'true'
        ),
        label,
        status: status?.innerText || ''
      };
    `,
  );
  assertFriendlyStationLabel(clientId, verified.label, stationUrl);
  const controls = await assertEntryControlUsability(clientId, client);
  state = await readClientUiState(client);
  return {
    ...verified,
    controls,
    surface: state.surface,
  };
}

async function prepareDesktopStationSelection(
  clientId,
  client,
  stationUrl,
) {
  const accountChooser = await findElement(
    client,
    'xpath',
    '//button[normalize-space(.)="Sign in with another account"]',
    true,
  );
  if (accountChooser) {
    await clickElement(client, accountChooser);
    await sleep(uiPollIntervalMs);
  }
  await clickSelector(
    client,
    '[data-station-picker-trigger]',
    'open-desktop-station-picker',
  );
  await waitForUi(
    clientId,
    client,
    'Desktop Station picker',
    `
      return {
        ready: Boolean(document.querySelector(
          'input[aria-label="Station or private connection"]'
        ))
      };
    `,
  );
  let stationState = await executeWebScript(
    client,
    `
      return {
        activeCount: document.querySelectorAll(
          '[data-station-route-id][aria-pressed="true"]'
        ).length,
        entryCount: document.querySelectorAll('[data-station-peer-id]').length
      };
    `,
  );
  if (stationState.entryCount === 0) {
    await setInputValue(
      client,
      'input[aria-label="Station or private connection"]',
      stationUrl,
      'desktop-station-address',
    );
    await clickSelector(
      client,
      'button[aria-label="Add Station"]',
      'desktop-add-station',
    );
    stationState = await waitForUi(
      clientId,
      client,
      'single automatically active Desktop Station',
      `
        return {
          ready: document.querySelectorAll('[data-station-peer-id]').length === 1
            && document.querySelectorAll(
              '[data-station-route-id][aria-pressed="true"]'
            ).length === 1,
          activeCount: document.querySelectorAll(
            '[data-station-route-id][aria-pressed="true"]'
          ).length,
          entryCount: document.querySelectorAll('[data-station-peer-id]').length
        };
      `,
    );
  }
  assertContract(
    stationState.entryCount !== 1 || stationState.activeCount === 1,
    'ENTRY_SINGLE_STATION_NOT_ACTIVE',
    `${clientId} did not automatically activate its only configured Station`,
  );
  const selected = await executeWebScript(
    client,
    `
      const stationUrl = arguments[0];
      const routes = [...document.querySelectorAll('[data-station-route-id]')];
      const target = routes.find((route) => route.getAttribute('title') === stationUrl)
        || routes.find((route) => route.getAttribute('aria-pressed') === 'true');
      if (!(target instanceof HTMLButtonElement)) {
        return { ok: false, reason: 'matching-route-missing' };
      }
      target.click();
      return {
        ok: true,
        routeId: target.getAttribute('data-station-route-id'),
        title: target.getAttribute('title')
      };
    `,
    [stationUrl],
  );
  assertContract(
    selected?.ok === true,
    'ENTRY_DESKTOP_STATION_ROUTE_MISSING',
    `${clientId} has no matching visible Station route`,
  );
  await waitForUi(
    clientId,
    client,
    'selected Desktop Station route',
    `
      return {
        ready: document.querySelectorAll(
          '[data-station-route-id][aria-pressed="true"]'
        ).length === 1
      };
    `,
  );
  const hovered = await executeWebScript(
    client,
    `
      const selected = document.querySelector(
        '[data-station-route-id][aria-pressed="true"]'
      );
      const row = selected?.closest('[data-station-peer-id]');
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      return true;
    `,
  );
  assertContract(
    hovered === true,
    'ENTRY_DESKTOP_STATION_ROW_MISSING',
    `${clientId} cannot expose Station verification`,
  );
  await waitForUi(
    clientId,
    client,
    'Desktop Station verify action',
    `
      const button = document.querySelector(
        'button[aria-label="Verify Station"]'
      );
      return {
        ready: Boolean(
          button
          && button.getClientRects().length
          && getComputedStyle(button).pointerEvents !== 'none'
        )
      };
    `,
  );
  await clickSelector(
    client,
    'button[aria-label="Verify Station"]',
    'verify-desktop-station',
  );
  const verified = await waitForUi(
    clientId,
    client,
    'verified Desktop Station',
    `
      const selected = document.querySelector(
        '[data-station-route-id][aria-pressed="true"]'
      );
      const row = selected?.closest('[data-station-peer-id]');
      const label = (
        document.querySelector('[data-station-picker-trigger]')?.innerText || ''
      ).trim().split('\\n')[0];
      return {
        ready: Boolean(
          row?.querySelector('[aria-label="Station reachable"]')
        ),
        label
      };
    `,
  );
  assertFriendlyStationLabel(clientId, verified.label, stationUrl);
  const controls = await assertEntryControlUsability(clientId, client);
  return {
    ...selected,
    ...verified,
    controls,
  };
}

async function prepareStationSelection(clientId, client, stationUrl) {
  return client.platform === 'desktop'
    ? prepareDesktopStationSelection(clientId, client, stationUrl)
    : prepareMobileStationSelection(clientId, client, stationUrl);
}

async function prepareMobileLoginForm(
  clientId,
  client,
  account,
  password,
) {
  await clickXpath(
    client,
    '//button[normalize-space(.)="Continue"]',
    'continue-with-mobile-station',
  );
  await waitForUi(
    clientId,
    client,
    'Mobile access login',
    `
      const access = document.querySelector(
        '[data-product-surface^="entry.access-"]'
      );
      return { ready: Boolean(access?.getClientRects().length) };
    `,
  );
  if (!await selectorIsVisible(client, 'input[placeholder="Email address"]')) {
    await clickXpath(
      client,
      '//button[normalize-space(.)="Email Login"]',
      'open-mobile-email-login',
    );
  }
  await waitForUi(
    clientId,
    client,
    'Mobile email login fields',
    `
      const visible = (element) => Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
      return {
        ready: visible(document.querySelector('input[placeholder="Email address"]'))
          && visible(document.querySelector('input[placeholder="Password"]'))
      };
    `,
  );
  await setInputValue(
    client,
    'input[placeholder="Email address"]',
    account.email,
    'mobile-login-email',
  );
  await setInputValue(
    client,
    'input[placeholder="Password"]',
    password,
    'mobile-login-password',
  );
  await focusAndDismissPrimaryInput(
    clientId,
    client,
    'input[placeholder="Email address"]',
  );
  return assertEntryControlUsability(clientId, client);
}

async function prepareDesktopLoginForm(
  clientId,
  client,
  account,
  password,
) {
  if (await selectorIsVisible(
    client,
    'input[aria-label="Station or private connection"]',
  )) {
    await clickSelector(
      client,
      '[data-station-picker-trigger]',
      'close-desktop-station-picker',
    );
  }
  await clickSelector(
    client,
    '[data-login-tab="email"]',
    'desktop-open-email-login',
  );
  await waitForUi(
    clientId,
    client,
    'Desktop email login fields',
    `
      const visible = (element) => Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
      return {
        ready: visible(document.querySelector('[data-login-email]'))
          && visible(document.querySelector('[data-login-password]'))
      };
    `,
  );
  await setInputValue(
    client,
    '[data-login-email]',
    account.email,
    'desktop-login-email',
  );
  await setInputValue(
    client,
    '[data-login-password]',
    password,
    'desktop-login-password',
  );
  await focusAndDismissPrimaryInput(
    clientId,
    client,
    '[data-login-email]',
  );
  return assertEntryControlUsability(clientId, client);
}

async function prepareLoginForm(clientId, client, password) {
  const account = clientAccounts[clientId];
  return client.platform === 'desktop'
    ? prepareDesktopLoginForm(clientId, client, account, password)
    : prepareMobileLoginForm(clientId, client, account, password);
}

async function proveInvalidMobileLoginRecovery(clientId, client) {
  await clickXpath(
    client,
    '//button[normalize-space(.)="Sign In"]',
    'submit-invalid-mobile-login',
  );
  const failure = await waitForUi(
    clientId,
    client,
    'Mobile login field recovery',
    `
      const surface = document.querySelector(
        '[data-product-surface="entry.login-failed"]'
      );
      const email = document.querySelector('input[placeholder="Email address"]');
      const password = document.querySelector('input[placeholder="Password"]');
      const error = document.querySelector('.auth-error');
      return {
        ready: Boolean(
          surface?.getClientRects().length
          && email?.getClientRects().length
          && password?.getClientRects().length
          && error?.getClientRects().length
        ),
        error: error?.innerText || ''
      };
    `,
  );
  await setInputValue(
    client,
    'input[placeholder="Password"]',
    demoPassport,
    'mobile-recovered-password',
  );
  return failure;
}

async function proveInvalidDesktopLoginRecovery(clientId, client) {
  await clickSelector(
    client,
    '[data-login-submit]',
    'submit-invalid-desktop-login',
  );
  const failure = await waitForUi(
    clientId,
    client,
    'Desktop login field recovery',
    `
      const visible = (element) => Boolean(
        element
        && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none'
      );
      const notice = [...document.querySelectorAll('.ant-message-notice')]
        .find(visible);
      return {
        ready: Boolean(
          notice
          && visible(document.querySelector('[data-login-email]'))
          && visible(document.querySelector('[data-login-password]'))
        ),
        error: (notice?.innerText || '').trim()
      };
    `,
  );
  await setInputValue(
    client,
    '[data-login-password]',
    demoPassport,
    'desktop-recovered-password',
  );
  return failure;
}

async function proveInvalidLoginRecovery(clientId, client) {
  return client.platform === 'desktop'
    ? proveInvalidDesktopLoginRecovery(clientId, client)
    : proveInvalidMobileLoginRecovery(clientId, client);
}

async function verifyAuthenticatedActor(clientId, client) {
  const account = clientAccounts[clientId];
  if (client.platform === 'desktop') {
    await waitForUi(
      clientId,
      client,
      'authenticated Desktop shell',
      `
        return {
          ready: document.querySelectorAll('[data-pt-primary-nav]').length > 0
        };
      `,
    );
    await navigateDesktopPrimary(
      clientId,
      client,
      'settings',
      '[data-pt-secondary-tab="general"]',
      'Settings',
    );
    return verifyDesktopIdentity(clientId, client, account.friendlyName);
  }
  await waitForUi(
    clientId,
    client,
    'authenticated Mobile shell',
    `
      const shell = document.querySelector('[data-product-surface^="shell."]');
      const text = document.body?.innerText || '';
      return {
        ready: Boolean(shell) && !text.includes('Features Loading')
      };
    `,
  );
  await navigateMobileShell(
    clientId,
    client,
    'settings',
    '[data-product-surface="settings.summary"]',
  );
  return verifyMobileIdentity(clientId, client, account);
}

async function submitAssignedLogin(clientId, client) {
  if (client.platform === 'desktop') {
    await clickSelector(
      client,
      '[data-login-submit]',
      'submit-desktop-login',
    );
    await waitForUi(
      clientId,
      client,
      'Desktop PIN decision or shell',
      `
        return {
          ready: Boolean(
            document.querySelector('[data-login-pin-skip]')
            || document.querySelector('[data-pt-primary-nav]')
          )
        };
      `,
    );
    const pinSkip = await findElement(
      client,
      'css selector',
      '[data-login-pin-skip]',
      true,
    );
    if (pinSkip) await clickElement(client, pinSkip);
  } else {
    await clickXpath(
      client,
      '//button[normalize-space(.)="Sign In"]',
      'submit-mobile-login',
    );
  }
  return verifyAuthenticatedActor(clientId, client);
}

async function runEntryClient(
  clientId,
  client,
  stationUrl,
  evidenceDir,
  interactionTrace,
  sequenceRef,
) {
  const step = async (stepId, action) => {
    sequenceRef.value += 1;
    return recordJourneyStep({
      clientId,
      client,
      evidenceDir,
      interactionTrace,
      sequence: sequenceRef.value,
      stepId,
      action,
    });
  };

  await step(
    'entry-authenticated-precondition',
    () => ensureAuthenticated(clientId, client, stationUrl),
  );
  await step(
    'entry-logout',
    () => logoutThroughForegroundUi(clientId, client),
  );
  await step(
    'entry-station-selected-and-verified',
    () => prepareStationSelection(clientId, client, stationUrl),
  );
  await step(
    'entry-login-form',
    () => prepareLoginForm(clientId, client, invalidPassport),
  );
  await step(
    'entry-login-field-recovery',
    () => proveInvalidLoginRecovery(clientId, client),
  );
  await step(
    'entry-login-success',
    () => submitAssignedLogin(clientId, client),
  );
  await step(
    'entry-native-relaunch-and-session-restore',
    async () => {
      const relaunch = await relaunchClient(clientId, client, evidenceDir);
      const identity = await verifyAuthenticatedActor(clientId, client);
      return { identity, relaunch };
    },
  );
  await step(
    'entry-restored-session-logout',
    () => logoutThroughForegroundUi(clientId, client),
  );
  await step(
    'entry-relogin-station-selected-and-verified',
    () => prepareStationSelection(clientId, client, stationUrl),
  );
  await step(
    'entry-relogin-form',
    () => prepareLoginForm(clientId, client, demoPassport),
  );
  await step(
    'entry-relogin-success',
    () => submitAssignedLogin(clientId, client),
  );
}

async function runEntryPhase(manifest, evidenceDir, preflight) {
  const interactionTrace = [];
  const sequenceRef = { value: 0 };
  for (const clientId of requiredClientIds) {
    const client = manifest.clients[clientId];
    await activateForegroundClient(clientId, client);
    await withWebContext(client, async () => {
      await runEntryClient(
        clientId,
        client,
        manifest.stationUrl,
        evidenceDir,
        interactionTrace,
        sequenceRef,
      );
    });
  }
  const report = {
    kind: 'peers-touch-three-client-product-journey-result',
    schemaVersion: 1,
    phase: 'entry',
    status: 'PASS',
    source: preflight.source,
    stationUrl: manifest.stationUrl,
    scenarioIds: preflight.scenarioIds,
    preflight: path.join(evidenceDir, 'preflight.json'),
    interactionTrace,
    observedAt: new Date().toISOString(),
  };
  const reportPath = path.join(evidenceDir, 'result.json');
  const tracePath = path.join(evidenceDir, 'interaction-trace.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    tracePath,
    `${JSON.stringify(interactionTrace, null, 2)}\n`,
  );
  return { ...report, reportPath, tracePath };
}

function assertShellState(clientId, state) {
  assertContract(
    state.dialogs.length === 0,
    'SHELL_BLOCKING_DIALOG',
    `${clientId} has a blocking dialog: ${state.dialogs.join(' | ')}`,
  );
  const blockingRuntimeNotices = state.runtimeNotices.filter(
    (notice) => notice.blocking,
  );
  assertContract(
    blockingRuntimeNotices.length === 0,
    'SHELL_RUNTIME_NOTICE',
    `${clientId} has blocking runtime notices: ${JSON.stringify(blockingRuntimeNotices)}`,
  );
  assertContract(
    state.viewportWidth > 0
      && state.viewportHeight > 0
      && state.documentWidth <= state.viewportWidth + 2,
    'SHELL_LAYOUT_OVERFLOW',
    `${clientId} layout exceeds viewport: ${state.documentWidth}x${state.documentHeight} in ${state.viewportWidth}x${state.viewportHeight}`,
  );
}

async function navigateMobileShell(clientId, client, routeId, pageSelector) {
  await clickSelector(
    client,
    `button[data-route-id="tab:${routeId}"]`,
    `open-${routeId}`,
  );
  const result = await waitForUi(
    clientId,
    client,
    `${routeId} page`,
    `
      const shell = document.querySelector(arguments[0]);
      const page = document.querySelector(arguments[1]);
      return {
        ready: Boolean(
          shell
          && shell.getClientRects().length
          && page
          && page.getClientRects().length
        )
      };
    `,
    [
      `[data-product-surface="shell.${routeId}-tab"]`,
      pageSelector,
    ],
  );
  const state = await readClientUiState(client);
  assertShellState(clientId, state);
  return result;
}

async function navigateDesktopPrimary(
  clientId,
  client,
  pageId,
  expectedSelector,
  expectedText = '',
) {
  await clickSelector(
    client,
    `[data-pt-primary-nav="${pageId}"] [role="button"]`,
    `open-${pageId}`,
  );
  const result = await waitForUi(
    clientId,
    client,
    `Desktop ${pageId}`,
    `
      const target = document.querySelector(arguments[0]);
      const text = document.body?.innerText || '';
      return {
        ready: Boolean(target?.getClientRects().length)
          && (!arguments[1] || text.includes(arguments[1])),
        text: text.slice(0, 1800)
      };
    `,
    [expectedSelector, expectedText],
  );
  const state = await readClientUiState(client);
  assertShellState(clientId, state);
  return result;
}

async function focusAndDismissPrimaryInput(clientId, client, selector) {
  const result = await executeWebScript(
    client,
    `
      const input = document.querySelector(arguments[0]);
      if (!(input instanceof HTMLInputElement)
        && !(input instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: 'missing-input' };
      }
      input.focus();
      const focused = document.activeElement === input;
      input.blur();
      return {
        ok: focused && document.activeElement !== input,
        focused,
        dismissed: document.activeElement !== input
      };
    `,
    [selector],
  );
  assertContract(
    result?.ok === true,
    'SHELL_INPUT_FOCUS_FAILED',
    `${clientId} could not focus and dismiss ${selector}`,
  );
  return result;
}

async function verifyMobileIdentity(clientId, client, account) {
  const summary = await executeWebScript(
    client,
    `
      const surface = document.querySelector('[data-product-surface="settings.summary"]');
      const name = document.querySelector('.settings-profile-name')?.innerText.trim() || '';
      return {
        ready: Boolean(surface?.getClientRects().length && name),
        friendly: Boolean(name)
          && !/^ptid:/i.test(name)
          && !/^12D3Koo/i.test(name),
        name
      };
    `,
  );
  assertContract(
    summary?.ready === true && summary.friendly === true,
    'SHELL_ACTOR_IDENTITY_MISMATCH',
    `${clientId} shows non-human identity ${summary?.name || '<missing>'}`,
  );
  await clickSelector(
    client,
    '.settings-profile-trigger',
    'open-account-info',
  );
  const detail = await waitForUi(
    clientId,
    client,
    'visible account identity',
    `
      const surface = document.querySelector(
        '[data-product-surface="settings.account-info"]'
      );
      const text = document.body?.innerText || '';
      return {
        ready: Boolean(surface?.getClientRects().length)
          && text.includes(arguments[0]),
        text: text.slice(0, 1800)
      };
    `,
    [account.email],
  );
  assertContract(
    detail?.ready === true,
    'SHELL_ACTOR_ACCOUNT_MISSING',
    `${clientId} does not visibly show ${account.email}`,
  );
  return {
    account: account.email,
    detail,
    displayName: summary.name,
  };
}

async function verifyDesktopIdentity(clientId, client, friendlyName) {
  const result = await executeWebScript(
    client,
    `
      const text = document.body?.innerText || '';
      const stationLabel = (
        document.querySelector('[data-station-picker-trigger]')?.innerText || ''
      ).trim().split('\\n')[0];
      return {
        actorVisible: text.includes(arguments[0]),
        stationLabel,
        stationFriendly: !stationLabel || (
          !/^12D3Koo/i.test(stationLabel)
          && !/\\.\\.\\./.test(stationLabel)
        )
      };
    `,
    [friendlyName],
  );
  assertContract(
    result?.actorVisible === true,
    'SHELL_ACTOR_IDENTITY_MISMATCH',
    `${clientId} does not show ${friendlyName} in Settings`,
  );
  assertContract(
    result?.stationFriendly === true,
    'SHELL_STATION_IDENTITY_RAW',
    `${clientId} shows raw Station identity ${result?.stationLabel}`,
  );
  return result;
}

async function runMobileShellClient(
  clientId,
  client,
  evidenceDir,
  interactionTrace,
  sequenceRef,
) {
  const account = clientAccounts[clientId];
  const steps = [
    ['chat', '[data-product-surface^="chat.list"]'],
    ['moments', '[data-product-surface="moments.feed"]'],
    ['contacts', '[data-product-surface="contacts.list"]'],
    ['settings', '[data-product-surface="settings.summary"]'],
  ];
  for (const [routeId, pageSelector] of steps) {
    sequenceRef.value += 1;
    await recordJourneyStep({
      clientId,
      client,
      evidenceDir,
      interactionTrace,
      sequence: sequenceRef.value,
      stepId: `shell-${routeId}`,
      action: () => navigateMobileShell(
        clientId,
        client,
        routeId,
        pageSelector,
      ),
    });
    if (routeId === 'settings') {
      sequenceRef.value += 1;
      await recordJourneyStep({
        clientId,
        client,
        evidenceDir,
        interactionTrace,
        sequence: sequenceRef.value,
        stepId: 'shell-settings-identity',
        action: () => verifyMobileIdentity(clientId, client, account),
      });
    }
  }
  sequenceRef.value += 1;
  await recordJourneyStep({
    clientId,
    client,
    evidenceDir,
    interactionTrace,
    sequence: sequenceRef.value,
    stepId: 'shell-return-chat-and-focus',
    action: async () => {
      await clickSelector(
        client,
        'button[aria-label="Back"]',
        'close-account-info',
      );
      await waitForUi(
        clientId,
        client,
        'Settings summary',
        `
          const surface = document.querySelector(
            '[data-product-surface="settings.summary"]'
          );
          return { ready: Boolean(surface?.getClientRects().length) };
        `,
      );
      await navigateMobileShell(
        clientId,
        client,
        'chat',
        '[data-product-surface^="chat.list"]',
      );
      return focusAndDismissPrimaryInput(
        clientId,
        client,
        'input[placeholder="Search chats"]',
      );
    },
  });
}

async function runDesktopShellClient(
  clientId,
  client,
  evidenceDir,
  interactionTrace,
  sequenceRef,
) {
  const steps = [
    ['chat', '[data-social-chat-layout]', ''],
    ['moments', '[data-pt-primary-nav="moments"] [role="button"]', 'Social'],
  ];
  for (const [pageId, expectedSelector, expectedText] of steps) {
    sequenceRef.value += 1;
    await recordJourneyStep({
      clientId,
      client,
      evidenceDir,
      interactionTrace,
      sequence: sequenceRef.value,
      stepId: `shell-${pageId}`,
      action: () => navigateDesktopPrimary(
        clientId,
        client,
        pageId,
        expectedSelector,
        expectedText,
      ),
    });
  }

  sequenceRef.value += 1;
  await recordJourneyStep({
    clientId,
    client,
    evidenceDir,
    interactionTrace,
    sequence: sequenceRef.value,
    stepId: 'shell-contacts',
    action: async () => {
      await navigateDesktopPrimary(
        clientId,
        client,
        'chat',
        '[data-social-chat-layout]',
      );
      await clickSelector(
        client,
        '[data-chat-subpage="contacts"]',
        'open-contacts',
      );
      const result = await waitForUi(
        clientId,
        client,
        'Desktop Contacts',
        `
          const contacts = document.querySelector('[data-chat-subpage="contacts"]');
          const text = document.body?.innerText || '';
          return {
            ready: Boolean(contacts?.getClientRects().length)
              && getComputedStyle(contacts).backgroundColor !== 'rgba(0, 0, 0, 0)'
              && text.includes('Contacts'),
            text: text.slice(0, 1600)
          };
        `,
      );
      assertShellState(clientId, await readClientUiState(client));
      return result;
    },
  });

  sequenceRef.value += 1;
  await recordJourneyStep({
    clientId,
    client,
    evidenceDir,
    interactionTrace,
    sequence: sequenceRef.value,
    stepId: 'shell-settings',
    action: async () => {
      const result = await navigateDesktopPrimary(
        clientId,
        client,
        'settings',
        '[data-pt-secondary-tab="general"]',
        'Settings',
      );
      await verifyDesktopIdentity(
        clientId,
        client,
        clientAccounts[clientId].friendlyName,
      );
      return result;
    },
  });

  sequenceRef.value += 1;
  await recordJourneyStep({
    clientId,
    client,
    evidenceDir,
    interactionTrace,
    sequence: sequenceRef.value,
    stepId: 'shell-return-chat-and-focus',
    action: async () => {
      await navigateDesktopPrimary(
        clientId,
        client,
        'chat',
        '[data-social-chat-layout]',
      );
      await clickSelector(
        client,
        '[data-chat-subpage="chats"]',
        'open-chats',
      );
      await waitForUi(
        clientId,
        client,
        'Desktop conversation list',
        `
          return {
            ready: Boolean(
              document.querySelector('input[placeholder="Search..."]')
            )
          };
        `,
      );
      return focusAndDismissPrimaryInput(
        clientId,
        client,
        'input[placeholder="Search..."]',
      );
    },
  });
}

async function runShellPhase(manifest, evidenceDir, preflight) {
  const interactionTrace = [];
  const sequenceRef = { value: 0 };
  for (const clientId of requiredClientIds) {
    const client = manifest.clients[clientId];
    await activateForegroundClient(clientId, client);
    await withWebContext(client, async () => {
      sequenceRef.value += 1;
      await recordJourneyStep({
        clientId,
        client,
        evidenceDir,
        interactionTrace,
        sequence: sequenceRef.value,
        stepId: 'entry-authenticated-precondition',
        action: () => ensureAuthenticated(
          clientId,
          client,
          manifest.stationUrl,
        ),
      });
      if (client.platform === 'desktop') {
        await runDesktopShellClient(
          clientId,
          client,
          evidenceDir,
          interactionTrace,
          sequenceRef,
        );
      } else {
        await runMobileShellClient(
          clientId,
          client,
          evidenceDir,
          interactionTrace,
          sequenceRef,
        );
      }
    });
  }
  const report = {
    kind: 'peers-touch-three-client-product-journey-result',
    schemaVersion: 1,
    phase: 'shell',
    status: 'PASS',
    source: preflight.source,
    stationUrl: manifest.stationUrl,
    scenarioIds: preflight.scenarioIds,
    preflight: path.join(evidenceDir, 'preflight.json'),
    interactionTrace,
    observedAt: new Date().toISOString(),
  };
  const reportPath = path.join(evidenceDir, 'result.json');
  const tracePath = path.join(evidenceDir, 'interaction-trace.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    tracePath,
    `${JSON.stringify(interactionTrace, null, 2)}\n`,
  );
  return { ...report, reportPath, tracePath };
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
  assertContract(
    retryableUiPollError(new JourneyContractError(
      'WEBDRIVER_REQUEST_FAILED',
      'transient WebView execution failure',
    )) === true
      && retryableUiPollError(new JourneyContractError(
        'SHELL_LAYOUT_OVERFLOW',
        'product assertion failure',
      )) === false,
    'SELF_TEST_UI_POLL_RETRY',
    'UI polling retry classification is invalid',
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
  if (options.preflightOnly) {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }
  if (!['entry', 'shell'].includes(options.phase)) {
    throw new JourneyContractError(
      'PHASE_UI_BINDING_REQUIRED',
      [
        `phase ${options.phase} has passed exact-source three-client preflight`,
        'but its foreground UI action binding has not been implemented yet',
        'the runner refuses to substitute an API or headless check',
      ].join('; '),
    );
  }
  const manifest = readJson(
    path.resolve(options.runtimeManifest),
    'runtime manifest',
  );
  const result = options.phase === 'entry'
    ? await runEntryPhase(manifest, evidenceDir, preflight)
    : await runShellPhase(manifest, evidenceDir, preflight);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof JourneyContractError
    ? error.code
    : 'UNEXPECTED_FAILURE';
  process.stderr.write(`FAIL ${code}: ${error.message}\n`);
  process.exitCode = 1;
});
