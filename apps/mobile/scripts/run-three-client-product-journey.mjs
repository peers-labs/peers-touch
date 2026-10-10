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

function retryableStaleElementError(error) {
  return retryableUiPollError(error)
    && error.message.toLowerCase().includes('stale element reference');
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
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            done(true);
          };
          const nextFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback) => setTimeout(callback, 16);
          const fallback = setTimeout(finish, 250);
          nextFrame(() => nextFrame(() => setTimeout(() => {
            clearTimeout(fallback);
            finish();
          }, 50)));
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

async function clickLocatedElement(client, using, value, optional = false) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const elementId = await findElement(client, using, value, optional);
    if (!elementId) return false;
    try {
      await clickElement(client, elementId);
      return true;
    } catch (error) {
      if (!retryableStaleElementError(error) || attempt === 2) throw error;
      await sleep(uiPollIntervalMs);
    }
  }
  return false;
}

async function clickSelector(client, selector, label) {
  await clickLocatedElement(client, 'css selector', selector);
  return { label, selector };
}

async function clickVisibleSelector(client, selector, label) {
  const result = await executeWebScript(
    client,
    `
      const element = [...document.querySelectorAll(arguments[0])]
        .find((candidate) => (
          candidate instanceof HTMLElement
          && candidate.getClientRects().length
          && getComputedStyle(candidate).visibility !== 'hidden'
          && getComputedStyle(candidate).display !== 'none'
          && !candidate.hasAttribute('disabled')
        ));
      if (!element) return { ok: false };
      element.click();
      return { ok: true };
    `,
    [selector],
  );
  assertContract(
    result?.ok === true,
    'WEBDRIVER_VISIBLE_ELEMENT_MISSING',
    `${label} could not find a visible ${selector}`,
  );
  return { label, selector };
}

async function clickVisibleButtonText(client, text, label) {
  const result = await executeWebScript(
    client,
    `
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => (
          candidate instanceof HTMLButtonElement
          && candidate.getClientRects().length
          && getComputedStyle(candidate).visibility !== 'hidden'
          && getComputedStyle(candidate).display !== 'none'
          && !candidate.disabled
          && (candidate.innerText || '').trim() === arguments[0]
        ));
      if (!button) return { ok: false };
      button.click();
      return { ok: true };
    `,
    [text],
  );
  assertContract(
    result?.ok === true,
    'WEBDRIVER_VISIBLE_BUTTON_MISSING',
    `${label} could not find a visible button named ${text}`,
  );
  return { label, text };
}

async function clickXpath(client, xpath, label, optional = false) {
  const clicked = await clickLocatedElement(
    client,
    'xpath',
    xpath,
    optional,
  );
  if (!clicked) return false;
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

async function waitForUi(
  clientId,
  client,
  label,
  script,
  args = [],
  isReady = (value) => value?.ready === true || value === true,
) {
  const deadline = Date.now() + uiWaitTimeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await executeWebScript(client, script, args);
      if (isReady(lastValue)) return lastValue;
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

function selectNewReadyAttachmentDraft(snapshot, priorDraftIds) {
  if (!Array.isArray(snapshot?.drafts)) return null;
  const prior = new Set(priorDraftIds);
  return snapshot.drafts.find((draft) => (
    draft?.visible === true
    && typeof draft.id === 'string'
    && draft.id
    && !prior.has(draft.id)
    && draft.status === 'ready'
  )) ?? null;
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
    const desktopPid = desktopListenerPid(clientId, client);
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
    try {
      execFileSync(
        'osascript',
        [
          '-e',
          'tell application "System Events" to set frontmost of first process '
            + `whose unix id is ${desktopPid} to true`,
        ],
        { encoding: 'utf8' },
      );
    } catch (error) {
      throw new JourneyContractError(
        'DESKTOP_NATIVE_ACTIVATION_FAILED',
        `${clientId} could not activate process ${desktopPid}: ${error.message}`,
      );
    }
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
  if (client.platform === 'desktop') {
    await webdriverRequest(webdriverEndpoint(client, '/timeouts'), {
      method: 'POST',
      body: JSON.stringify({ script: 30_000 }),
    });
  }
  const nativeApplicationState = await activateForegroundClient(
    clientId,
    client,
  );
  const priorContext = await selectWebContext(client);
  try {
    if (client.platform !== 'desktop') {
      await webdriverRequest(webdriverEndpoint(client, '/timeouts'), {
        method: 'POST',
        body: JSON.stringify({ script: 30_000 }),
      });
    }
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
    await waitForUi(
      clientId,
      client,
      'ready active Station',
      `
        const entry = document.querySelector('.station-entry.active');
        const status = entry?.querySelector('.station-entry-status');
        const continueButton = [...document.querySelectorAll('button')]
          .find((button) => (
            (button.innerText || '').trim() === 'Continue'
          ));
        return {
          ready: Boolean(entry)
            && status?.classList.contains('online')
            && continueButton instanceof HTMLButtonElement
            && !continueButton.disabled,
          status: status?.innerText || ''
        };
      `,
    );
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
    if (!stationLabel || stationLabel.toLowerCase() === 'station') {
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

async function assertMobileControlClearOfNonBlockingStatus(
  clientId,
  client,
  selector,
) {
  const layout = await executeWebScript(
    client,
    `
      const target = document.querySelector(arguments[0]);
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const targetRect = target?.getBoundingClientRect();
      const notices = [
        ...document.querySelectorAll(
          '[data-blocks-unrelated-content="false"]'
        )
      ].filter((element) => element.getClientRects().length);
      const intersections = targetRect
        ? notices.map((notice) => {
            const noticeRect = notice.getBoundingClientRect();
            const overlaps = (
              targetRect.left < noticeRect.right
              && targetRect.right > noticeRect.left
              && targetRect.top < noticeRect.bottom
              && targetRect.bottom > noticeRect.top
            );
            return {
              notice: {
                bottom: noticeRect.bottom,
                left: noticeRect.left,
                right: noticeRect.right,
                top: noticeRect.top
              },
              overlaps,
              target: {
                bottom: targetRect.bottom,
                left: targetRect.left,
                right: targetRect.right,
                top: targetRect.top
              }
            };
          }).filter((entry) => entry.overlaps)
        : [];
      return {
        ready: Boolean(targetRect && target?.getClientRects().length),
        intersections
      };
    `,
    [selector],
  );
  assertContract(
    layout?.ready === true,
    'MOBILE_CONTROL_MISSING',
    `${clientId} is missing ${selector}`,
  );
  assertContract(
    layout.intersections.length === 0,
    'MOBILE_NON_BLOCKING_STATUS_OCCLUSION',
    `${clientId} ${selector} is occluded by a non-blocking status surface: `
      + JSON.stringify(layout.intersections),
  );
}

async function logoutMobileClient(clientId, client) {
  const confirmationOpen = await selectorIsVisible(
    client,
    '[data-product-surface="settings.logout-confirm"]',
  );
  if (!confirmationOpen) {
    if (await selectorIsVisible(
      client,
      '[data-product-surface="settings.account-info"]',
    )) {
      await clickSelector(
        client,
        'button[aria-label="Back"]',
        'return-to-settings-summary',
      );
      await waitForUi(
        clientId,
        client,
        'Mobile Settings summary',
        `
          const surface = document.querySelector(
            '[data-product-surface="settings.summary"]'
          );
          return { ready: Boolean(surface?.getClientRects().length) };
        `,
      );
    } else {
      await navigateMobileShell(
        clientId,
        client,
        'settings',
        '[data-product-surface="settings.summary"]',
      );
    }
    await assertMobileControlClearOfNonBlockingStatus(
      clientId,
      client,
      '.settings-sign-out',
    );
    await clickXpath(
      client,
      '//button[normalize-space(.)="Sign Out"]',
      'open-mobile-logout-confirmation',
    );
  }
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
  await clickVisibleSelector(
    client,
    '.ant-modal-container .ant-modal-footer .ant-btn-dangerous',
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
      const transition = document.querySelector(
        '[data-acceptance-id="recovery-scope-exit"]'
      );
      return {
        ready: surface.startsWith('entry.')
          && !transition?.getClientRects().length,
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
  await clickVisibleSelector(
    client,
    '[data-pt-secondary-tab="help"]',
    'open-desktop-help-settings',
  );
  await waitForUi(
    clientId,
    client,
    'Desktop Danger Zone',
    `
      const text = document.body?.innerText || '';
      return {
        ready: text.includes('Danger Zone')
          && text.includes('Sign Out')
      };
    `,
  );
  await clickVisibleButtonText(
    client,
    'Sign Out',
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
  await clickVisibleButtonText(
    client,
    'Confirm',
    'confirm-desktop-sign-out',
  );
  await sleep(1000);
  const result = await waitForUi(
    clientId,
    client,
    'stable Desktop entry after sign out reload',
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

function assertFriendlyLoginRecovery(clientId, error) {
  const value = String(error || '').trim();
  assertContract(
    value.length > 0 && value.length <= 160,
    'ENTRY_LOGIN_RECOVERY_COPY_INVALID',
    `${clientId} login recovery copy is missing or too long`,
  );
  assertContract(
    !/access gate|station returned|https?:\/\/|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/i.test(value),
    'ENTRY_LOGIN_RECOVERY_INTERNAL_DETAIL',
    `${clientId} exposes internal login failure detail: ${JSON.stringify(value)}`,
  );
  return value;
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
  assertFriendlyLoginRecovery(clientId, failure?.error);
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
  assertFriendlyLoginRecovery(clientId, failure?.error);
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
  const routeSelector = `button[data-route-id="tab:${routeId}"]`;
  if (!await selectorIsVisible(client, routeSelector)) {
    const backButton = await findElement(
      client,
      'css selector',
      'button[aria-label="Back"]',
      true,
    );
    if (backButton) {
      await clickLocatedElement(
        client,
        'css selector',
        'button[aria-label="Back"]',
      );
      await waitForUi(
        clientId,
        client,
        'Mobile primary navigation after closing detail',
        `
          const route = document.querySelector(arguments[0]);
          return {
            ready: Boolean(route?.getClientRects().length)
          };
        `,
        [routeSelector],
      );
    }
  }
  await clickSelector(
    client,
    routeSelector,
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

async function navigateContactsSurface(clientId, client) {
  if (client.platform === 'desktop') {
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
    return waitForUi(
      clientId,
      client,
      'Desktop Contacts projection',
      `
        const panel = document.querySelector('[data-chat-contacts]');
        return {
          ready: Boolean(panel?.getClientRects().length)
            && panel.getAttribute('data-chat-friendship-state') === 'ready',
          state: panel?.getAttribute('data-chat-friendship-state') || '',
          text: (panel?.innerText || '').slice(0, 2400)
        };
      `,
    );
  }
  await navigateMobileShell(
    clientId,
    client,
    'contacts',
    '[data-product-surface="contacts.list"]',
  );
  return waitForUi(
    clientId,
    client,
    'Mobile Contacts projection',
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.list"]'
      );
      return {
        ready: Boolean(surface?.getClientRects().length),
        text: (surface?.innerText || '').slice(0, 2400)
      };
    `,
  );
}

async function openMobileFindPeople(clientId, client) {
  await navigateContactsSurface(clientId, client);
  await clickVisibleSelector(
    client,
    '[data-contacts-find-people]',
    'open-find-people',
  );
  const controls = await waitForUi(
    clientId,
    client,
    'Find People controls',
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.add-friend"]'
      );
      const input = surface?.querySelector('input');
      const scopes = [...(surface?.querySelectorAll(
        '.people-federation-chip'
      ) || [])].filter((element) => element.getClientRects().length);
      return {
        ready: Boolean(surface?.getClientRects().length)
          && input instanceof HTMLInputElement
          && (!input.disabled || scopes.length > 0),
        inputDisabled: input instanceof HTMLInputElement
          ? input.disabled
          : null,
        scopeCount: scopes.length,
        text: (surface?.innerText || '').slice(0, 2200)
      };
    `,
  );
  if (controls.inputDisabled) {
    const selected = await executeWebScript(
      client,
      `
        const surface = document.querySelector(
          '[data-product-surface="contacts.add-friend"]'
        );
        const scopes = [...(surface?.querySelectorAll(
          '.people-federation-chip'
        ) || [])].filter((element) => element.getClientRects().length);
        const preferred = scopes.find((element) => (
          /chat-native-acceptance/i.test(element.innerText || '')
        )) || scopes.find((element) => (
          !/federation:\\s*local/i.test(element.innerText || '')
        )) || scopes[0];
        if (!(preferred instanceof HTMLButtonElement)) {
          return { ok: false };
        }
        preferred.click();
        return {
          label: (preferred.innerText || '').trim(),
          ok: true
        };
      `,
    );
    assertContract(
      selected?.ok === true,
      'CONTACTS_FEDERATION_SCOPE_MISSING',
      `${clientId} cannot select a Find People Federation scope`,
    );
    await waitForUi(
      clientId,
      client,
      'enabled Find People input',
      `
        const input = document.querySelector(
          '[data-product-surface="contacts.add-friend"] input'
        );
        return {
          ready: input instanceof HTMLInputElement && !input.disabled
        };
      `,
    );
    return { ...controls, selectedScope: selected.label };
  }
  return controls;
}

async function closeMobileContactsOverlay(clientId, client, surfaceSelector) {
  const closed = await executeWebScript(
    client,
    `
      const surface = document.querySelector(arguments[0]);
      const modal = surface?.closest('.ant-modal');
      const close = modal?.querySelector('button.ant-modal-close');
      if (!(close instanceof HTMLButtonElement)) return false;
      close.click();
      return true;
    `,
    [surfaceSelector],
  );
  assertContract(
    closed === true,
    'CONTACTS_OVERLAY_CLOSE_MISSING',
    `${clientId} cannot close ${surfaceSelector}`,
  );
  await waitForUi(
    clientId,
    client,
    `closed ${surfaceSelector}`,
    `
      const surface = document.querySelector(arguments[0]);
      return {
        ready: !surface || !surface.getClientRects().length
      };
    `,
    [surfaceSelector],
  );
}

async function proveMobilePeopleNoResult(clientId, client, query) {
  await openMobileFindPeople(clientId, client);
  await setInputValue(
    client,
    '[data-product-surface="contacts.add-friend"] input',
    query,
    'enter-no-result-people-query',
  );
  await clickVisibleSelector(
    client,
    '[data-product-surface="contacts.add-friend"] .people-search-button',
    'search-no-result-person',
  );
  const result = await waitForUi(
    clientId,
    client,
    'distinct no-result feedback',
    `
      const state = document.querySelector('[data-people-search-state]');
      return {
        ready: state?.getAttribute('data-people-search-state')
          === 'local-no-result',
        state: state?.getAttribute('data-people-search-state') || '',
        text: (state?.innerText || '').slice(0, 1200)
      };
    `,
  );
  await closeMobileContactsOverlay(
    clientId,
    client,
    '[data-product-surface="contacts.add-friend"]',
  );
  return result;
}

async function searchMobilePerson(clientId, client, query, friendlyName) {
  await openMobileFindPeople(clientId, client);
  await setInputValue(
    client,
    '[data-product-surface="contacts.add-friend"] input',
    query,
    `search-${query}`,
  );
  await clickVisibleSelector(
    client,
    '[data-product-surface="contacts.add-friend"] .people-search-button',
    `submit-search-${query}`,
  );
  return waitForUi(
    clientId,
    client,
    `search result for ${friendlyName}`,
    `
      const friendlyName = arguments[0].toLowerCase();
      const query = arguments[1].toLowerCase();
      const cards = [...document.querySelectorAll(
        '[data-people-result-ptid]'
      )].filter((element) => element.getClientRects().length);
      const card = cards.find((element) => {
        const text = (element.innerText || '').toLowerCase();
        return text.includes(friendlyName) || text.includes(query);
      });
      return {
        ready: Boolean(card),
        ptid: card?.getAttribute('data-people-result-ptid') || '',
        state: card?.getAttribute('data-people-result-state') || '',
        text: (card?.innerText || '').slice(0, 1400)
      };
    `,
    [friendlyName, query],
  );
}

async function requestMobileFriendship(
  clientId,
  client,
  query,
  friendlyName,
) {
  const result = await searchMobilePerson(
    clientId,
    client,
    query,
    friendlyName,
  );
  assertContract(
    result.ptid,
    'CONTACTS_SEARCH_IDENTITY_MISSING',
    `${clientId} search result for ${friendlyName} has no Actor PTID`,
  );
  let action = 'reused';
  if (result.state === 'available') {
    const clicked = await executeWebScript(
      client,
      `
        const button = document.querySelector(
          '[data-people-result-action="' + CSS.escape(arguments[0]) + '"]'
        );
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
          return false;
        }
        button.click();
        return true;
      `,
      [result.ptid],
    );
    assertContract(
      clicked === true,
      'CONTACTS_REQUEST_CONTROL_MISSING',
      `${clientId} cannot send a request to ${friendlyName}`,
    );
    action = 'sent';
  } else {
    assertContract(
      [
        'friend',
        'incoming-pending',
        'outgoing-pending',
      ].includes(result.state),
      'CONTACTS_REQUEST_STATE_INVALID',
      `${clientId} search result for ${friendlyName} is ${result.state}`,
    );
  }
  const outcome = await waitForUi(
    clientId,
    client,
    `request state for ${friendlyName}`,
    `
      const card = document.querySelector(
        '[data-people-result-ptid="' + CSS.escape(arguments[0]) + '"]'
      );
      const state = card?.getAttribute('data-people-result-state') || '';
      return {
        ready: ['friend', 'incoming-pending', 'outgoing-pending'].includes(
          state
        ),
        state,
        text: (card?.innerText || '').slice(0, 1400)
      };
    `,
    [result.ptid],
  );
  await closeMobileContactsOverlay(
    clientId,
    client,
    '[data-product-surface="contacts.add-friend"]',
  );
  return {
    action,
    peerPtid: result.ptid,
    state: outcome.state,
  };
}

async function acceptIncomingFriendship(
  clientId,
  client,
  friendlyName,
  expectedPeerPtid = '',
) {
  await navigateContactsSurface(clientId, client);
  if (client.platform === 'desktop') {
    const expanded = await executeWebScript(
      client,
      `
        const section = document.querySelector(
          '[data-chat-friend-request-section]'
        );
        const header = section?.closest('.ant-collapse-header');
        if (!(header instanceof HTMLElement)) {
          return { available: false, expanded: false };
        }
        const alreadyExpanded = header.getAttribute('aria-expanded') === 'true';
        if (!alreadyExpanded) header.click();
        return {
          available: true,
          expanded: alreadyExpanded
        };
      `,
    );
    assertContract(
      expanded?.available === true,
      'CONTACTS_REQUEST_SECTION_MISSING',
      `${clientId} has no New Friends section`,
    );
  }
  const projection = await waitForUi(
    clientId,
    client,
    `incoming request or accepted contact for ${friendlyName}`,
    client.platform === 'desktop'
      ? `
          const [friendlyName, expectedPeerPtid] = arguments;
          const matches = (element) => {
            const ptid = element.getAttribute(
              'data-chat-contact-ptid'
            ) || element.getAttribute(
              'data-chat-friend-request-peer-ptid'
            ) || '';
            return (expectedPeerPtid && ptid === expectedPeerPtid)
              || (element.innerText || '').toLowerCase().includes(
                friendlyName.toLowerCase()
              );
          };
          const requests = [...document.querySelectorAll(
            '[data-chat-friend-request-direction="incoming"]'
          )].filter((element) => element.getClientRects().length);
          const request = requests.find(matches)
            || (!expectedPeerPtid && requests.length === 1
              ? requests[0]
              : null);
          const requestPeerPtid = request?.getAttribute(
            'data-chat-friend-request-peer-ptid'
          ) || '';
          const friend = [...document.querySelectorAll(
            '[data-chat-contact-ptid]'
          )].find((element) => (
            element.getClientRects().length
            && (
              matches(element)
              || (
                requestPeerPtid
                && element.getAttribute('data-chat-contact-ptid')
                  === requestPeerPtid
              )
            )
          ));
          return {
            ready: Boolean(friend || request),
            kind: friend ? 'friend' : request ? 'request' : '',
            peerPtid: (
              friend?.getAttribute('data-chat-contact-ptid')
              || request?.getAttribute(
                'data-chat-friend-request-peer-ptid'
              )
              || ''
            ),
            text: ((friend || request)?.innerText || '').slice(0, 1400)
          };
        `
      : `
          const [friendlyName, expectedPeerPtid] = arguments;
          const matches = (element) => {
            const ptid = element.getAttribute('data-contact-ptid')
              || element.getAttribute(
                'data-friend-request-sender-ptid'
              )
              || '';
            return (expectedPeerPtid && ptid === expectedPeerPtid)
              || (element.innerText || '').toLowerCase().includes(
                friendlyName.toLowerCase()
              );
          };
          const requests = [...document.querySelectorAll(
            '[data-friend-request-direction="incoming"]'
          )].filter((element) => element.getClientRects().length);
          const request = requests.find(matches)
            || (!expectedPeerPtid && requests.length === 1
              ? requests[0]
              : null);
          const requestPeerPtid = request?.getAttribute(
            'data-friend-request-sender-ptid'
          ) || '';
          const friend = [...document.querySelectorAll(
            '[data-contact-ptid]'
          )].find((element) => (
            element.getClientRects().length
            && (
              matches(element)
              || (
                requestPeerPtid
                && element.getAttribute('data-contact-ptid')
                  === requestPeerPtid
              )
            )
          ));
          return {
            ready: Boolean(friend || request),
            kind: friend ? 'friend' : request ? 'request' : '',
            peerPtid: (
              friend?.getAttribute('data-contact-ptid')
              || request?.getAttribute(
                'data-friend-request-sender-ptid'
              )
              || ''
            ),
            text: ((friend || request)?.innerText || '').slice(0, 1400)
          };
        `,
    [friendlyName, expectedPeerPtid],
  );
  assertContract(
    projection.peerPtid,
    'CONTACTS_REQUEST_IDENTITY_MISSING',
    `${clientId} request from ${friendlyName} has no Actor PTID`,
  );
  if (projection.kind === 'request') {
    const accepted = await executeWebScript(
      client,
      client.platform === 'desktop'
        ? `
            const request = document.querySelector(
              '[data-chat-friend-request-peer-ptid="'
                + CSS.escape(arguments[0])
                + '"][data-chat-friend-request-direction="incoming"]'
            );
            const button = request?.querySelector(
              '[data-chat-friend-request-action="accept"]'
            );
            if (!(button instanceof HTMLButtonElement) || button.disabled) {
              return false;
            }
            button.click();
            return true;
          `
        : `
            const request = document.querySelector(
              '[data-friend-request-sender-ptid="'
                + CSS.escape(arguments[0])
                + '"]'
            );
            const button = [...(request?.querySelectorAll('button') || [])]
              .find((candidate) => /accept/i.test(
                candidate.getAttribute('aria-label') || ''
              ));
            if (!(button instanceof HTMLButtonElement) || button.disabled) {
              return false;
            }
            button.click();
            return true;
          `,
      [projection.peerPtid],
    );
    assertContract(
      accepted === true,
      'CONTACTS_ACCEPT_CONTROL_MISSING',
      `${clientId} cannot accept ${friendlyName}`,
    );
  }
  const friend = await waitForUi(
    clientId,
    client,
    `accepted contact ${friendlyName}`,
    client.platform === 'desktop'
      ? `
          const friend = document.querySelector(
            '[data-chat-contact-ptid="' + CSS.escape(arguments[0]) + '"]'
          );
          return {
            ready: Boolean(friend?.getClientRects().length),
            peerPtid: arguments[0],
            text: (friend?.innerText || '').slice(0, 1400)
          };
        `
      : `
          const friend = document.querySelector(
            '[data-contact-ptid="' + CSS.escape(arguments[0]) + '"]'
          );
          return {
            ready: Boolean(friend?.getClientRects().length),
            peerPtid: arguments[0],
            text: (friend?.innerText || '').slice(0, 1400)
          };
        `,
    [projection.peerPtid],
  );
  return {
    action: projection.kind === 'request' ? 'accepted' : 'reused',
    ...friend,
  };
}

async function verifyMobileDuplicateFriendship(
  clientId,
  client,
  query,
  friendlyName,
  expectedPeerPtid,
) {
  const result = await searchMobilePerson(
    clientId,
    client,
    query,
    friendlyName,
  );
  assertContract(
    result.ptid === expectedPeerPtid && result.state === 'friend',
    'CONTACTS_DUPLICATE_STATE_MISSING',
    `${clientId} does not show ${friendlyName} as an existing friend`,
  );
  await closeMobileContactsOverlay(
    clientId,
    client,
    '[data-product-surface="contacts.add-friend"]',
  );
  return result;
}

async function openAndVerifyContactProfile(
  clientId,
  client,
  peerPtid,
  friendlyName,
) {
  await navigateContactsSurface(clientId, client);
  if (client.platform === 'desktop') {
    await clickVisibleSelector(
      client,
      `[data-chat-contact-ptid="${peerPtid}"]`,
      `open-${friendlyName}-profile`,
    );
    const profile = await waitForUi(
      clientId,
      client,
      `${friendlyName} profile`,
      `
        const detail = document.querySelector(
          '[data-chat-contact-detail-kind="friend"]'
            + '[data-chat-contact-detail-peer-ptid="'
            + CSS.escape(arguments[0])
            + '"]'
        );
        const text = detail?.innerText || '';
        return {
          ready: Boolean(detail?.getClientRects().length)
            && Boolean(text.trim()),
          text: text.slice(0, 2400)
        };
      `,
      [peerPtid, friendlyName],
    );
    assertContract(
      !/^ptid:/i.test(profile.text.trim())
        && !/^12D3Koo/i.test(profile.text.trim()),
      'CONTACTS_PROFILE_RAW_IDENTITY',
      `${clientId} profile starts with a raw identifier`,
    );
    return profile;
  }

  const opened = await executeWebScript(
    client,
    `
      const row = document.querySelector(
        '[data-contact-ptid="' + CSS.escape(arguments[0]) + '"]'
      );
      const action = row?.querySelector('.contact-item-row');
      if (!(action instanceof HTMLElement)) return false;
      action.click();
      return true;
    `,
    [peerPtid],
  );
  assertContract(
    opened === true,
    'CONTACTS_PROFILE_CONTROL_MISSING',
    `${clientId} cannot open ${friendlyName}`,
  );
  const profile = await waitForUi(
    clientId,
    client,
    `${friendlyName} profile`,
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.profile"]'
      );
      const title = surface?.querySelector('h1')?.innerText.trim() || '';
      return {
        ready: Boolean(surface?.getClientRects().length)
          && Boolean(title),
        text: (surface?.innerText || '').slice(0, 2400),
        title
      };
    `,
    [friendlyName],
  );
  assertContract(
    profile.title
      && !/^ptid:/i.test(profile.title)
      && !/^12D3Koo/i.test(profile.title),
    'CONTACTS_PROFILE_RAW_IDENTITY',
    `${clientId} profile title is ${profile.title || '<missing>'}`,
  );
  const destructiveConfirmation = await executeWebScript(
    client,
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.profile"]'
      );
      const block = [...(surface?.querySelectorAll('button') || [])]
        .find((button) => (
          button instanceof HTMLButtonElement
          && !button.disabled
          && /^block$/i.test((button.innerText || '').trim())
        ));
      if (!block) return false;
      block.click();
      return true;
    `,
  );
  assertContract(
    destructiveConfirmation === true,
    'CONTACTS_DESTRUCTIVE_CONFIRMATION_MISSING',
    `${clientId} profile has no Block confirmation entry`,
  );
  await waitForUi(
    clientId,
    client,
    'destructive contact confirmation',
    `
      const confirm = document.querySelector('.ant-modal-confirm');
      return {
        ready: Boolean(confirm?.getClientRects().length),
        text: (confirm?.innerText || '').slice(0, 1200)
      };
    `,
  );
  const cancelled = await executeWebScript(
    client,
    `
      const confirm = document.querySelector('.ant-modal-confirm');
      const cancel = [...(confirm?.querySelectorAll('button') || [])]
        .find((button) => /cancel/i.test((button.innerText || '').trim()));
      if (!(cancel instanceof HTMLButtonElement)) return false;
      cancel.click();
      return true;
    `,
  );
  assertContract(
    cancelled === true,
    'CONTACTS_DESTRUCTIVE_CANCEL_MISSING',
    `${clientId} cannot cancel Block`,
  );
  await waitForUi(
    clientId,
    client,
    'closed destructive contact confirmation',
    'return { ready: !document.querySelector(".ant-modal-confirm") };',
  );
  await clickVisibleSelector(
    client,
    'button[aria-label="Back"]',
    'close-contact-profile',
  );
  await waitForUi(
    clientId,
    client,
    'Contacts list after profile',
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.list"]'
      );
      return { ready: Boolean(surface?.getClientRects().length) };
    `,
  );
  return profile;
}

async function createMobileSharedGroup(
  clientId,
  client,
  memberPtids,
  groupName,
) {
  await navigateContactsSurface(clientId, client);
  await clickVisibleSelector(
    client,
    '[data-contacts-create-group]',
    'open-create-group',
  );
  const initial = await waitForUi(
    clientId,
    client,
    'Create Group controls',
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.create-group"]'
      );
      const modal = surface?.closest('.ant-modal');
      const submit = modal?.querySelector(
        '.ant-modal-footer button.ant-btn-primary'
      );
      return {
        ready: Boolean(surface?.getClientRects().length)
          && submit instanceof HTMLButtonElement,
        submitDisabled: submit instanceof HTMLButtonElement
          ? submit.disabled
          : null
      };
    `,
  );
  assertContract(
    initial.submitDisabled === true,
    'CONTACTS_GROUP_MEMBER_REQUIREMENT_MISSING',
    `${clientId} Create Group is enabled without initial members`,
  );
  const selected = await executeWebScript(
    client,
    `
      const requested = new Set(arguments[0]);
      const controls = [...document.querySelectorAll(
        '[data-group-member-ptid]'
      )].filter((element) => (
        requested.has(element.getAttribute('data-group-member-ptid'))
      ));
      for (const control of controls) {
        const input = control instanceof HTMLInputElement
          ? control
          : control.querySelector('input[type="checkbox"]');
        if (input instanceof HTMLInputElement && !input.checked) {
          input.click();
        }
      }
      return {
        found: controls.map((element) => (
          element.getAttribute('data-group-member-ptid') || ''
        )),
        selected: controls.filter((element) => {
          const input = element instanceof HTMLInputElement
            ? element
            : element.querySelector('input[type="checkbox"]');
          return input instanceof HTMLInputElement && input.checked;
        }).map((element) => (
          element.getAttribute('data-group-member-ptid') || ''
        ))
      };
    `,
    [memberPtids],
  );
  assertContract(
    selected.found.length === memberPtids.length
      && selected.selected.length === memberPtids.length,
    'CONTACTS_GROUP_MEMBERS_MISSING',
    `${clientId} could not select every group member: ${JSON.stringify(selected)}`,
  );
  await setInputValue(
    client,
    '[data-product-surface="contacts.create-group"] input[placeholder="Group name"]',
    groupName,
    'enter-group-name',
  );
  const submitted = await executeWebScript(
    client,
    `
      const surface = document.querySelector(
        '[data-product-surface="contacts.create-group"]'
      );
      const modal = surface?.closest('.ant-modal');
      const submit = modal?.querySelector(
        '.ant-modal-footer button.ant-btn-primary'
      );
      if (!(submit instanceof HTMLButtonElement) || submit.disabled) {
        return false;
      }
      submit.click();
      return true;
    `,
  );
  assertContract(
    submitted === true,
    'CONTACTS_GROUP_CREATE_CONTROL_MISSING',
    `${clientId} cannot submit Create Group`,
  );
  const created = await waitForUi(
    clientId,
    client,
    `created group ${groupName}`,
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.group-thread"]'
      );
      const title = surface?.querySelector('h1')?.innerText.trim() || '';
      const text = surface?.innerText || '';
      return {
        ready: Boolean(surface?.getClientRects().length)
          && title === arguments[0]
          && /3\\s+members?/i.test(text),
        text: text.slice(0, 2400),
        title
      };
    `,
    [groupName],
  );
  return {
    groupName,
    memberCount: 3,
    ...created,
  };
}

async function openSharedGroup(
  clientId,
  client,
  groupName,
) {
  if (client.platform === 'desktop') {
    await navigateContactsSurface(clientId, client);
    const group = await waitForUi(
      clientId,
      client,
      `Desktop group ${groupName}`,
      `
        const group = [...document.querySelectorAll(
          '[data-chat-contact-kind="group"]'
        )].find((element) => (
          element.getClientRects().length
          && (element.innerText || '').includes(arguments[0])
        ));
        return {
          ready: Boolean(group),
          conversationId: group?.getAttribute(
            'data-chat-contact-conversation-id'
          ) || '',
          text: (group?.innerText || '').slice(0, 1600)
        };
      `,
      [groupName],
    );
    await clickVisibleSelector(
      client,
      `[data-chat-contact-conversation-id="${group.conversationId}"]`,
      `open-${groupName}-detail`,
    );
    const detail = await waitForUi(
      clientId,
      client,
      `Desktop group detail ${groupName}`,
      `
        const detail = document.querySelector(
          '[data-chat-contact-detail-kind="group"]'
        );
        const text = detail?.innerText || '';
        return {
          ready: Boolean(detail?.getClientRects().length)
            && text.includes(arguments[0])
            && /3\\s+members?/i.test(text),
          text: text.slice(0, 2400)
        };
      `,
      [groupName],
    );
    await clickVisibleSelector(
      client,
      '[data-chat-contact-detail-kind="group"] [data-chat-contact-message]',
      `open-${groupName}-thread`,
    );
    await waitForUi(
      clientId,
      client,
      `Desktop group thread ${groupName}`,
      `
        const composer = document.querySelector(
          '[data-chat-composer="' + CSS.escape(arguments[0]) + '"]'
        );
        const text = document.body?.innerText || '';
        return {
          ready: Boolean(composer) && text.includes(arguments[1]),
          text: text.slice(0, 2400)
        };
      `,
      [group.conversationId, groupName],
    );
    return {
      conversationId: group.conversationId,
      detail,
      memberCount: 3,
    };
  }

  await navigateMobileShell(
    clientId,
    client,
    'chat',
    '[data-product-surface^="chat.list"]',
  );
  const group = await waitForUi(
    clientId,
    client,
    `Mobile group ${groupName}`,
    `
      const group = [...document.querySelectorAll(
        '[data-conversation-kind="group"]'
      )].find((element) => (
        element.getClientRects().length
        && (element.innerText || '').includes(arguments[0])
      ));
      return {
        ready: Boolean(group),
        conversationId: group?.getAttribute('data-conversation-id') || '',
        text: (group?.innerText || '').slice(0, 1600)
      };
    `,
    [groupName],
  );
  await clickVisibleSelector(
    client,
    `[data-conversation-id="${group.conversationId}"]`,
    `open-${groupName}-thread`,
  );
  const thread = await waitForUi(
    clientId,
    client,
    `Mobile group thread ${groupName}`,
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.group-thread"]'
      );
      const title = surface?.querySelector('h1')?.innerText.trim() || '';
      const text = surface?.innerText || '';
      return {
        ready: Boolean(surface?.getClientRects().length)
          && title === arguments[0]
          && /3\\s+members?/i.test(text),
        text: text.slice(0, 2400),
        title
      };
    `,
    [groupName],
  );
  return {
    conversationId: group.conversationId,
    memberCount: 3,
    thread,
  };
}

async function runContactsPhase(manifest, evidenceDir, preflight) {
  const interactionTrace = [];
  const sequenceRef = { value: 0 };
  const step = async (clientId, stepId, action) => {
    const client = manifest.clients[clientId];
    await activateForegroundClient(clientId, client);
    return withWebContext(client, async () => {
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
    });
  };

  for (const clientId of requiredClientIds) {
    await step(clientId, 'contacts-authenticated-precondition', () => (
      ensureAuthenticated(
        clientId,
        manifest.clients[clientId],
        manifest.stationUrl,
      )
    ));
  }

  await step(
    'android-alice',
    'contacts-distinct-no-result',
    () => proveMobilePeopleNoResult(
      'android-alice',
      manifest.clients['android-alice'],
      `mwpu-no-result-${Date.now()}`,
    ),
  );
  const aliceToBob = (await step(
    'android-alice',
    'contacts-alice-request-bob',
    () => requestMobileFriendship(
      'android-alice',
      manifest.clients['android-alice'],
      'bob',
      'Bob',
    ),
  )).result;
  const bobAcceptedAlice = (await step(
    'desktop-bob',
    'contacts-bob-accept-alice',
    () => acceptIncomingFriendship(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      'Alice',
    ),
  )).result;
  const coralToAlice = (await step(
    'ios-coral',
    'contacts-coral-request-alice',
    () => requestMobileFriendship(
      'ios-coral',
      manifest.clients['ios-coral'],
      'alice',
      'Alice',
    ),
  )).result;
  assertContract(
    coralToAlice.peerPtid === bobAcceptedAlice.peerPtid,
    'CONTACTS_ACTOR_IDENTITY_DIVERGED',
    'Bob and Coral resolved different Actor PTIDs for Alice',
  );
  const aliceAcceptedCoral = (await step(
    'android-alice',
    'contacts-alice-accept-coral',
    () => acceptIncomingFriendship(
      'android-alice',
      manifest.clients['android-alice'],
      clientAccounts['ios-coral'].friendlyName,
    ),
  )).result;

  await step(
    'android-alice',
    'contacts-bob-duplicate-and-profile',
    async () => {
      const duplicate = await verifyMobileDuplicateFriendship(
        'android-alice',
        manifest.clients['android-alice'],
        'bob',
        'Bob',
        aliceToBob.peerPtid,
      );
      const profile = await openAndVerifyContactProfile(
        'android-alice',
        manifest.clients['android-alice'],
        aliceToBob.peerPtid,
        'Bob',
      );
      return { duplicate, profile };
    },
  );
  await step(
    'desktop-bob',
    'contacts-alice-profile',
    () => openAndVerifyContactProfile(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      bobAcceptedAlice.peerPtid,
      'Alice',
    ),
  );
  await step(
    'ios-coral',
    'contacts-alice-duplicate-and-profile',
    async () => {
      const duplicate = await verifyMobileDuplicateFriendship(
        'ios-coral',
        manifest.clients['ios-coral'],
        'alice',
        'Alice',
        coralToAlice.peerPtid,
      );
      const profile = await openAndVerifyContactProfile(
        'ios-coral',
        manifest.clients['ios-coral'],
        coralToAlice.peerPtid,
        'Alice',
      );
      return { duplicate, profile };
    },
  );

  const stamp = new Date().toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);
  const groupName = `MWPU Three Client ${stamp}`;
  await step(
    'android-alice',
    'contacts-alice-create-shared-group',
    () => createMobileSharedGroup(
      'android-alice',
      manifest.clients['android-alice'],
      [
        aliceToBob.peerPtid,
        aliceAcceptedCoral.peerPtid,
      ],
      groupName,
    ),
  );
  const bobGroup = (await step(
    'desktop-bob',
    'contacts-bob-open-shared-group',
    () => openSharedGroup(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      groupName,
    ),
  )).result;
  const coralGroup = (await step(
    'ios-coral',
    'contacts-coral-open-shared-group',
    () => openSharedGroup(
      'ios-coral',
      manifest.clients['ios-coral'],
      groupName,
    ),
  )).result;

  const report = {
    kind: 'peers-touch-three-client-product-journey-result',
    schemaVersion: 1,
    phase: 'contacts',
    status: 'PASS',
    source: preflight.source,
    stationUrl: manifest.stationUrl,
    scenarioIds: preflight.scenarioIds,
    preflight: path.join(evidenceDir, 'preflight.json'),
    relationships: {
      alicePtid: bobAcceptedAlice.peerPtid,
      bobPtid: aliceToBob.peerPtid,
      coralPtid: aliceAcceptedCoral.peerPtid,
    },
    sharedGroup: {
      name: groupName,
      memberCount: 3,
      receiverConversationIds: {
        'desktop-bob': bobGroup.conversationId,
        'ios-coral': coralGroup.conversationId,
      },
    },
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

function chatComposerSelector(client) {
  return client.platform === 'desktop'
    ? 'textarea[data-pt-text-input="chat-composer"]'
    : 'input.message-composer-input';
}

async function openChatConversation(
  clientId,
  client,
  kind,
  friendlyName = '',
) {
  if (client.platform === 'desktop') {
    await navigateDesktopPrimary(
      clientId,
      client,
      'chat',
      '[data-social-chat-layout]',
    );
    await clickSelector(
      client,
      '[data-chat-subpage="chats"]',
      'open-chat-conversation-list',
    );
    await waitForUi(
      clientId,
      client,
      'Desktop conversation list',
      `
        return {
          ready: Boolean(
            document.querySelector('[data-chat-conversation-list-shell]')
          )
        };
      `,
    );
  } else {
    if (await selectorIsVisible(
      client,
      '[data-product-surface^="chat."][data-product-surface$="-thread"]',
    )) {
      await clickSelector(
        client,
        'button[aria-label="Back"]',
        'return-to-chat-conversation-list',
      );
    }
    await navigateMobileShell(
      clientId,
      client,
      'chat',
      '[data-product-surface^="chat.list"]',
    );
  }

  const selector = client.platform === 'desktop'
    ? '[data-pt-conversation-item]'
    : '[data-conversation-id]';
  const opened = await waitForUi(
    clientId,
    client,
    `${kind} conversation ${friendlyName || 'latest shared group'}`,
    `
      const [selector, kind, friendlyName] = arguments;
      const rows = [...document.querySelectorAll(selector)]
        .filter((element) => (
          element instanceof HTMLElement
          && element.getClientRects().length
          && (
            element.getAttribute('data-chat-conversation-kind')
            || element.getAttribute('data-conversation-kind')
          ) === kind
        ));
      const normalizedName = friendlyName.toLowerCase();
      const target = rows.find((element) => (
        normalizedName
          ? (element.innerText || '').toLowerCase().includes(normalizedName)
          : (element.innerText || '').includes('MWPU Three Client')
      ));
      if (!(target instanceof HTMLElement)) {
        return {
          ready: false,
          candidates: rows.map((element) => (
            (element.innerText || '').replace(/\\s+/g, ' ').trim()
          )).slice(0, 20)
        };
      }
      const id = target.getAttribute('data-pt-conversation-item')
        || target.getAttribute('data-conversation-id')
        || '';
      const label = (target.innerText || '').replace(/\\s+/g, ' ').trim();
      target.click();
      return { ready: Boolean(id), id, label };
    `,
    [selector, kind, friendlyName],
  );
  const surface = kind === 'group'
    ? 'chat.group-thread'
    : 'chat.direct-thread';
  const thread = await waitForUi(
    clientId,
    client,
    `${kind} conversation composer`,
    client.platform === 'desktop'
      ? `
          const pane = document.querySelector(
            '[data-chat-conversation-pane="' + CSS.escape(arguments[0]) + '"]'
          );
          const composer = document.querySelector(
            '[data-chat-composer="' + CSS.escape(arguments[0]) + '"]'
          );
          const text = pane?.innerText || '';
          return {
            ready: Boolean(pane?.getClientRects().length)
              && Boolean(composer?.getClientRects().length)
              && (!arguments[1]
                || text.toLowerCase().includes(arguments[1].toLowerCase())),
            text: text.slice(0, 2400)
          };
        `
      : `
          const surface = document.querySelector(
            '[data-product-surface="' + arguments[0] + '"]'
          );
          const title = surface?.querySelector('h1')?.innerText.trim() || '';
          return {
            ready: Boolean(surface?.getClientRects().length)
              && Boolean(surface.querySelector('.message-composer'))
              && (!arguments[1]
                || title.toLowerCase().includes(arguments[1].toLowerCase())),
            text: (surface?.innerText || '').slice(0, 2400),
            title
          };
        `,
    client.platform === 'desktop'
      ? [opened.id, friendlyName]
      : [surface, friendlyName],
  );
  const title = thread.title || friendlyName || opened.label.split(' ')[0] || '';
  assertContract(
    !friendlyName || title.toLowerCase().includes(friendlyName.toLowerCase()),
    'CHAT_FRIENDLY_TITLE_MISSING',
    `${clientId} opened ${kind} conversation without friendly title ${friendlyName}`,
  );
  return {
    conversationId: opened.id,
    label: opened.label,
    title,
  };
}

async function waitForChatMessage(clientId, client, text) {
  return waitForUi(
    clientId,
    client,
    `message ${text}`,
    `
      const targetText = arguments[0];
      const rows = [...document.querySelectorAll('[data-message-ulid]')]
        .filter((element) => element.getClientRects().length);
      const row = rows.find((element) => (
        (element.innerText || '').includes(targetText)
      ));
      return {
        ready: Boolean(row),
        messageId: row?.getAttribute('data-message-ulid') || '',
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim(),
        reply: (row?.querySelector('.message-reply-quote')?.innerText || '')
          .replace(/\\s+/g, ' ')
          .trim(),
        receipt: row?.querySelector('[data-message-receipt]')
          ?.getAttribute('data-message-receipt') || '',
        delivery: row?.querySelector('[data-message-delivery]')
          ?.getAttribute('data-message-delivery') || '',
        reaction: (row?.querySelector('.message-reaction-row')?.innerText || '')
          .replace(/\\s+/g, ' ')
          .trim()
      };
    `,
    [text],
  );
}

async function sendChatText(
  clientId,
  client,
  kind,
  friendlyName,
  text,
) {
  const conversation = await openChatConversation(
    clientId,
    client,
    kind,
    friendlyName,
  );
  const composer = chatComposerSelector(client);
  await setInputValue(client, composer, text, `compose-${text}`);
  await clickVisibleSelector(
    client,
    client.platform === 'desktop'
      ? '[data-chat-send]'
      : 'button.message-send-button',
    `send-${text}`,
  );
  return {
    conversation,
    message: await waitForChatMessage(clientId, client, text),
  };
}

async function waitForChatReadReceipt(
  clientId,
  client,
  kind,
  friendlyName,
  text,
) {
  await openChatConversation(clientId, client, kind, friendlyName);
  return waitForUi(
    clientId,
    client,
    `read receipt for ${text}`,
    `
      const targetText = arguments[0];
      const row = [...document.querySelectorAll('[data-message-ulid]')]
        .find((element) => (
          element.getClientRects().length
          && (element.innerText || '').includes(targetText)
        ));
      const receipt = row?.querySelector('[data-message-receipt]')
        ?.getAttribute('data-message-receipt') || '';
      const delivery = row?.querySelector('[data-message-delivery]')
        ?.getAttribute('data-message-delivery') || '';
      return {
        ready: receipt === 'read' || delivery === 'read',
        messageId: row?.getAttribute('data-message-ulid') || '',
        receipt,
        delivery
      };
    `,
    [text],
  );
}

async function assertChatMessageOrder(
  clientId,
  client,
  kind,
  friendlyName,
  orderedTexts,
) {
  await openChatConversation(clientId, client, kind, friendlyName);
  const snapshot = await waitForUi(
    clientId,
    client,
    `stable ${kind} history`,
    `
      const expected = arguments[0];
      const rows = [...document.querySelectorAll('[data-message-ulid]')]
        .filter((element) => element.getClientRects().length)
        .map((element) => ({
          id: element.getAttribute('data-message-ulid') || '',
          text: (element.innerText || '').replace(/\\s+/g, ' ').trim()
        }));
      const indexes = expected.map((text) => (
        rows.findIndex((row) => row.text.includes(text))
      ));
      return {
        ready: indexes.every((index) => index >= 0)
          && indexes.every((index, position) => (
            position === 0 || indexes[position - 1] < index
          )),
        indexes,
        rows
      };
    `,
    [orderedTexts],
  );
  return snapshot;
}

async function stageDesktopImageAttachment(client, filename) {
  const priorDraftIds = await executeWebScript(
    client,
    `
      return [...document.querySelectorAll('[data-chat-attachment-draft]')]
        .map((element) => element.getAttribute('data-chat-attachment-draft') || '')
        .filter(Boolean);
    `,
  );
  const staged = await executeWebScript(
    client,
    `
      const composer = document.querySelector('[data-chat-composer]');
      if (!(composer instanceof HTMLElement) || typeof DataTransfer === 'undefined') {
        return { ok: false, reason: 'composer-or-data-transfer-missing' };
      }
      const binary = atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      );
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], arguments[0], { type: 'image/png' }));
      composer.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
      composer.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
      composer.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
      return {
        ok: true,
        filename: transfer.files[0]?.name || '',
        size: transfer.files[0]?.size || 0,
        type: transfer.files[0]?.type || ''
      };
    `,
    [filename],
  );
  assertContract(
    staged?.ok === true
      && staged.filename === filename
      && staged.size > 0
      && staged.type === 'image/png',
    'CHAT_ATTACHMENT_GESTURE_FAILED',
    `Desktop attachment gesture failed: ${staged?.reason || 'unknown'}`,
  );
  const snapshot = await waitForUi(
    'desktop-bob',
    client,
    `attachment draft ${filename}`,
    `
      return {
        drafts: [...document.querySelectorAll('[data-chat-attachment-draft]')]
          .map((element) => ({
            id: element.getAttribute('data-chat-attachment-draft') || '',
            status: element.getAttribute('data-chat-attachment-status') || '',
            text: (element.innerText || '').replace(/\\s+/g, ' ').trim(),
            visible: Boolean(
              element.getClientRects().length
              && getComputedStyle(element).visibility !== 'hidden'
              && getComputedStyle(element).display !== 'none'
            )
          }))
      };
    `,
    [],
    (value) => Boolean(selectNewReadyAttachmentDraft(value, priorDraftIds)),
  );
  return selectNewReadyAttachmentDraft(snapshot, priorDraftIds);
}

async function sendDesktopAttachment(
  clientId,
  client,
  friendlyName,
  filename,
) {
  const conversation = await openChatConversation(
    clientId,
    client,
    'friend',
    friendlyName,
  );
  await stageDesktopImageAttachment(client, filename);
  await clickVisibleSelector(client, '[data-chat-send]', 'send-attachment');
  const message = await waitForUi(
    clientId,
    client,
    `sent attachment ${filename}`,
    `
      const rows = [...document.querySelectorAll(
        '[data-message-ulid][data-message-attachment-count]'
      )].filter((element) => element.getClientRects().length);
      const row = rows.at(-1);
      return {
        ready: Number(row?.getAttribute('data-message-attachment-count') || 0) > 0,
        messageId: row?.getAttribute('data-message-ulid') || '',
        attachmentCount: Number(
          row?.getAttribute('data-message-attachment-count') || 0
        ),
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
  );
  return { conversation, message };
}

async function verifyMobileAttachment(
  clientId,
  client,
  friendlyName,
) {
  await openChatConversation(clientId, client, 'friend', friendlyName);
  const attachment = await waitForUi(
    clientId,
    client,
    'receiver-visible attachment',
    `
      const rows = [...document.querySelectorAll('[data-message-ulid]')]
        .filter((element) => element.getClientRects().length);
      const row = rows.find((element) => (
        element.querySelector('[data-attachment-id]')
      ));
      const item = row?.querySelector('[data-attachment-id]');
      return {
        ready: Boolean(item?.getClientRects().length)
          && !item.hasAttribute('disabled'),
        messageId: row?.getAttribute('data-message-ulid') || '',
        attachmentId: item?.getAttribute('data-attachment-id') || '',
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
  );
  await clickVisibleSelector(
    client,
    `[data-message-ulid="${attachment.messageId}"] [data-attachment-id]`,
    'open-receiver-attachment',
  );
  const preview = await waitForUi(
    clientId,
    client,
    'in-app attachment preview',
    `
      const preview = document.querySelector(
        '[data-product-surface="chat.attachment-preview"]'
      );
      return {
        ready: Boolean(preview?.getClientRects().length)
          && preview.getAttribute('data-attachment-id') === arguments[0],
        attachmentId: preview?.getAttribute('data-attachment-id') || '',
        kind: preview?.getAttribute('data-attachment-kind') || ''
      };
    `,
    [attachment.attachmentId],
  );
  await clickVisibleSelector(
    client,
    '.mobile-attachment-preview-modal .ant-modal-close',
    'close-receiver-attachment',
  );
  await waitForUi(
    clientId,
    client,
    'chat after attachment preview',
    `
      return {
        ready: !document.querySelector(
          '[data-product-surface="chat.attachment-preview"]'
        )?.getClientRects().length
          && Boolean(document.querySelector('[data-message-viewport]'))
      };
    `,
  );
  return { ...attachment, preview };
}

async function openMobileMessageActions(clientId, client, messageText) {
  const message = await waitForChatMessage(clientId, client, messageText);
  const opened = await executeWebScript(
    client,
    `
      const row = document.querySelector(
        '[data-message-ulid="' + CSS.escape(arguments[0]) + '"]'
      );
      const button = row?.querySelector('.message-overflow-button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
    [message.messageId],
  );
  assertContract(
    opened === true,
    'CHAT_MESSAGE_ACTION_CONTROL_MISSING',
    `${clientId} cannot open actions for ${messageText}`,
  );
  await waitForUi(
    clientId,
    client,
    'Mobile message action sheet',
    `
      return {
        ready: Boolean(document.querySelector(
          '[data-product-surface="chat.message-actions"]'
        )?.getClientRects().length)
      };
    `,
  );
  return message;
}

async function reactToMobileMessage(
  clientId,
  client,
  messageText,
  reaction,
) {
  const message = await openMobileMessageActions(
    clientId,
    client,
    messageText,
  );
  const reacted = await executeWebScript(
    client,
    `
      const button = [...document.querySelectorAll(
        '[data-product-surface="chat.message-actions"] .message-reaction-choice'
      )].find((element) => (
        element instanceof HTMLButtonElement
        && (element.innerText || '').includes(arguments[0])
      ));
      if (!button || button.disabled) return false;
      button.click();
      return true;
    `,
    [reaction],
  );
  assertContract(
    reacted === true,
    'CHAT_REACTION_CONTROL_MISSING',
    `${clientId} cannot react with ${reaction}`,
  );
  await waitForUi(
    clientId,
    client,
    `reaction ${reaction}`,
    `
      const row = document.querySelector(
        '[data-message-ulid="' + CSS.escape(arguments[0]) + '"]'
      );
      const chip = [...(row?.querySelectorAll('.message-reaction-chip') || [])]
        .find((element) => (element.innerText || '').includes(arguments[1]));
      const actionSheet = document.querySelector(
        '[data-product-surface="chat.message-actions"]'
      );
      return {
        ready: Boolean(chip) && !actionSheet?.getClientRects().length,
        actionSheetOpen: Boolean(actionSheet?.getClientRects().length),
        text: (chip?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [message.messageId, reaction],
  );
  return { messageId: message.messageId, reaction };
}

async function replyToMobileMessage(
  clientId,
  client,
  messageText,
  replyText,
) {
  await openMobileMessageActions(clientId, client, messageText);
  const selected = await executeWebScript(
    client,
    `
      const button = document.querySelector(
        '[data-product-surface="chat.message-actions"] '
          + '.chat-action-group .chat-action-button '
          + 'svg.lucide-corner-up-left'
      )?.closest('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    selected === true,
    'CHAT_REPLY_CONTROL_MISSING',
    `${clientId} cannot select Reply`,
  );
  await waitForUi(
    clientId,
    client,
    'reply composer context',
    `
      const context = document.querySelector('.message-reply-context');
      return {
        ready: Boolean(context?.getClientRects().length)
          && (context.innerText || '').includes(arguments[0]),
        text: (context?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [messageText],
  );
  await setInputValue(
    client,
    chatComposerSelector(client),
    replyText,
    `compose-${replyText}`,
  );
  await clickVisibleSelector(
    client,
    'button.message-send-button',
    `send-${replyText}`,
  );
  const reply = await waitForChatMessage(clientId, client, replyText);
  assertContract(
    reply.reply.includes(messageText),
    'CHAT_REPLY_CONTEXT_MISSING',
    `${clientId} reply ${replyText} does not quote ${messageText}`,
  );
  return reply;
}

async function forwardMobileMessage(
  clientId,
  client,
  messageText,
  destination,
) {
  await openMobileMessageActions(clientId, client, messageText);
  const selected = await executeWebScript(
    client,
    `
      const button = document.querySelector(
        '[data-product-surface="chat.message-actions"] '
          + '.chat-action-group .chat-action-button svg.lucide-forward'
      )?.closest('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    selected === true,
    'CHAT_FORWARD_CONTROL_MISSING',
    `${clientId} cannot select Forward`,
  );
  await waitForUi(
    clientId,
    client,
    `forward destination ${destination}`,
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.forward-picker"]'
      );
      const button = [...(surface?.querySelectorAll('button') || [])]
        .find((element) => (
          element.getClientRects().length
          && (element.getAttribute('aria-label') || '')
            .toLowerCase()
            .includes(arguments[0].toLowerCase())
        ));
      return { ready: Boolean(button), label: button?.getAttribute('aria-label') || '' };
    `,
    [destination],
  );
  const forwarded = await executeWebScript(
    client,
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.forward-picker"]'
      );
      const button = [...(surface?.querySelectorAll('button') || [])]
        .find((element) => (
          element.getClientRects().length
          && (element.getAttribute('aria-label') || '')
            .toLowerCase()
            .includes(arguments[0].toLowerCase())
        ));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
    [destination],
  );
  assertContract(
    forwarded === true,
    'CHAT_FORWARD_DESTINATION_MISSING',
    `${clientId} cannot forward to ${destination}`,
  );
  await waitForUi(
    clientId,
    client,
    'forward completion',
    `
      return {
        ready: !document.querySelector(
          '[data-product-surface^="chat.forward-"]'
        )
      };
    `,
  );
  return { destination, messageText };
}

async function searchMobileMessage(
  clientId,
  client,
  messageText,
) {
  const opened = await executeWebScript(
    client,
    `
      const actions = document.querySelector('.chat-header-actions');
      const buttons = [...(actions?.querySelectorAll('button') || [])]
        .filter((button) => button.getClientRects().length);
      const button = buttons.at(-1);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    opened === true,
    'CHAT_CONVERSATION_ACTION_CONTROL_MISSING',
    `${clientId} cannot open conversation actions`,
  );
  await waitForUi(
    clientId,
    client,
    'conversation action sheet',
    `
      return {
        ready: Boolean(document.querySelector(
          '[data-product-surface="chat.conversation-actions"]'
        )?.getClientRects().length)
      };
    `,
  );
  const searchSelected = await executeWebScript(
    client,
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.conversation-actions"]'
      );
      const button = surface?.querySelector(
        '.chat-action-group .chat-action-button'
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    searchSelected === true,
    'CHAT_SEARCH_CONTROL_MISSING',
    `${clientId} cannot open message search`,
  );
  await setInputValue(
    client,
    '.chat-header-search input',
    messageText,
    `search-${messageText}`,
  );
  await clickVisibleSelector(
    client,
    '.chat-header-search .ant-input-search-button',
    `submit-search-${messageText}`,
  );
  const result = await waitForUi(
    clientId,
    client,
    `search result ${messageText}`,
    `
      const result = [...document.querySelectorAll('.message-search-result')]
        .find((element) => (
          element.getClientRects().length
          && (element.innerText || '').includes(arguments[0])
        ));
      return {
        ready: Boolean(result),
        anchor: result?.getAttribute('data-scroll-anchor-id') || '',
        text: (result?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [messageText],
  );
  await clickVisibleSelector(
    client,
    `.message-search-result[data-scroll-anchor-id="${result.anchor}"]`,
    `reopen-search-${messageText}`,
  );
  await waitForUi(
    clientId,
    client,
    `highlighted message ${messageText}`,
    `
      const row = document.querySelector(
        '[data-message-ulid="' + CSS.escape(arguments[0]) + '"]'
      );
      return {
        ready: Boolean(row?.classList.contains('highlighted'))
          && (row.innerText || '').includes(arguments[1])
      };
    `,
    [result.anchor, messageText],
  );
  return result;
}

async function openMobileGroupManagement(clientId, client) {
  const opened = await executeWebScript(
    client,
    `
      const actions = document.querySelector('.chat-header-actions');
      const buttons = [...(actions?.querySelectorAll('button') || [])]
        .filter((button) => button.getClientRects().length);
      const button = buttons.at(-1);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    opened === true,
    'CHAT_GROUP_ACTION_CONTROL_MISSING',
    `${clientId} cannot open Group actions`,
  );
  await waitForUi(
    clientId,
    client,
    'Group conversation actions',
    `
      return {
        ready: Boolean(document.querySelector(
          '[data-product-surface="chat.conversation-actions"]'
        )?.getClientRects().length)
      };
    `,
  );
  const selected = await executeWebScript(
    client,
    `
      const groups = [...document.querySelectorAll(
        '[data-product-surface="chat.conversation-actions"] .chat-action-group'
      )];
      const button = groups.flatMap((group) => [...group.querySelectorAll('button')])
        .find((candidate) => candidate.querySelector('svg.lucide-users'));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
  );
  assertContract(
    selected === true,
    'CHAT_GROUP_MANAGEMENT_CONTROL_MISSING',
    `${clientId} cannot open Group management`,
  );
  return waitForUi(
    clientId,
    client,
    'Group management sheet',
    `
      const sheet = document.querySelector(
        '[data-acceptance-id="group-management"]'
      );
      return {
        ready: Boolean(sheet?.getClientRects().length),
        surface: sheet?.parentElement?.getAttribute('data-product-surface') || '',
        text: (sheet?.innerText || '').slice(0, 3000)
      };
    `,
  );
}

async function groupMemberRowState(clientId, client, memberName, minimumButtons) {
  return waitForUi(
    clientId,
    client,
    `Group member ${memberName} controls`,
    `
      const rows = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].filter((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
      ));
      const row = rows.find((element) => (
        element.querySelectorAll('button').length >= arguments[1]
      ));
      const buttons = [...(row?.querySelectorAll('button') || [])];
      return {
        ready: Boolean(row),
        buttonCount: buttons.length,
        buttonText: buttons.map((button) => (button.innerText || '').trim()),
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [memberName, minimumButtons],
  );
}

async function clickGroupMemberButton(
  clientId,
  client,
  memberName,
  buttonIndex,
) {
  const before = await groupMemberRowState(clientId, client, memberName, 4);
  const clicked = await executeWebScript(
    client,
    `
      const row = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].find((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
        && element.querySelectorAll('button').length >= 4
      ));
      const button = row?.querySelectorAll('button')[arguments[1]];
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
    [memberName, buttonIndex],
  );
  assertContract(
    clicked === true,
    'CHAT_GROUP_MEMBER_CONTROL_MISSING',
    `${clientId} cannot operate ${memberName} button ${buttonIndex}`,
  );
  const after = await waitForUi(
    clientId,
    client,
    `Group member ${memberName} update`,
    `
      const row = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].find((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
        && element.querySelectorAll('button').length >= 4
      ));
      const buttons = [...(row?.querySelectorAll('button') || [])];
      const current = buttons.map((button) => (button.innerText || '').trim());
      return {
        ready: Boolean(row)
          && buttons.every((button) => !button.disabled)
          && current[arguments[1]] !== arguments[2],
        buttonText: current,
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [memberName, buttonIndex, before.buttonText[buttonIndex] || ''],
  );
  return { after, before };
}

async function removeAndRestoreGroupMember(
  clientId,
  client,
  memberName,
) {
  await groupMemberRowState(clientId, client, memberName, 4);
  const removeClicked = await executeWebScript(
    client,
    `
      const row = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].find((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
        && element.querySelectorAll('button').length >= 4
      ));
      const buttons = [...(row?.querySelectorAll('button') || [])];
      const button = buttons.at(-1);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
    [memberName],
  );
  assertContract(
    removeClicked === true,
    'CHAT_GROUP_REMOVE_CONTROL_MISSING',
    `${clientId} cannot remove ${memberName}`,
  );
  await waitForUi(
    clientId,
    client,
    `remove confirmation for ${memberName}`,
    `
      const modal = [...document.querySelectorAll('.ant-modal-confirm')]
        .find((element) => element.getClientRects().length);
      const confirm = modal?.querySelector(
        '.ant-modal-confirm-btns .ant-btn-primary'
      );
      return { ready: Boolean(confirm), text: (modal?.innerText || '').slice(0, 1000) };
    `,
  );
  await clickVisibleSelector(
    client,
    '.ant-modal-confirm .ant-modal-confirm-btns .ant-btn-primary',
    `confirm-remove-${memberName}`,
  );
  await waitForUi(
    clientId,
    client,
    `${memberName} removed`,
    `
      const rows = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].filter((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
      ));
      return {
        ready: rows.some((element) => (
          element.querySelectorAll('button').length === 1
        )) && !rows.some((element) => (
          element.querySelectorAll('button').length >= 4
        )),
        rows: rows.map((element) => ({
          buttons: element.querySelectorAll('button').length,
          text: (element.innerText || '').replace(/\\s+/g, ' ').trim()
        }))
      };
    `,
    [memberName],
  );
  const invited = await executeWebScript(
    client,
    `
      const row = [...document.querySelectorAll(
        '[data-acceptance-id="group-management"] .ant-list-item'
      )].find((element) => (
        element.getClientRects().length
        && (element.innerText || '').toLowerCase().includes(
          arguments[0].toLowerCase()
        )
        && element.querySelectorAll('button').length === 1
      ));
      const button = row?.querySelector('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `,
    [memberName],
  );
  assertContract(
    invited === true,
    'CHAT_GROUP_RESTORE_CONTROL_MISSING',
    `${clientId} cannot restore ${memberName}`,
  );
  const restored = await groupMemberRowState(clientId, client, memberName, 4);
  return { removed: true, restored };
}

async function proveGroupRoleDenied(clientId, client) {
  const management = await openMobileGroupManagement(clientId, client);
  assertContract(
    management.surface === 'chat.group-role-denied',
    'CHAT_GROUP_ROLE_GATE_MISSING',
    `${clientId} did not expose the role-gated Group management state`,
  );
  await clickVisibleSelector(
    client,
    '[data-acceptance-id="group-management"] .chat-action-sheet-header button',
    'close-role-gated-group-management',
  );
  return management;
}

async function recordMobileVoiceMessage(
  clientId,
  client,
  friendlyName,
) {
  await openChatConversation(clientId, client, 'friend', friendlyName);
  const existingIds = await executeWebScript(
    client,
    `
      return [...document.querySelectorAll(
        '[data-message-ulid] [data-attachment-id]'
      )].map((element) => (
        element.closest('[data-message-ulid]')
          ?.getAttribute('data-message-ulid') || ''
      )).filter(Boolean);
    `,
  );
  const startRecording = async () => {
    const opened = await executeWebScript(
      client,
      `
        const buttons = [...document.querySelectorAll(
          '.message-composer-row .message-composer-tool'
        )].filter((button) => button.getClientRects().length);
        const more = buttons.at(-1);
        if (!(more instanceof HTMLButtonElement) || more.disabled) return false;
        more.click();
        return true;
      `,
    );
    assertContract(
      opened === true,
      'CHAT_VOICE_MORE_CONTROL_MISSING',
      `${clientId} cannot open composer tools`,
    );
    await waitForUi(
      clientId,
      client,
      'voice composer tool',
      `
        const option = [...document.querySelectorAll(
          '.more-panel .composer-tool-option'
        )].find((button) => button.querySelector('svg.lucide-mic'));
        return { ready: Boolean(option?.getClientRects().length) };
      `,
    );
    const started = await executeWebScript(
      client,
      `
        const option = [...document.querySelectorAll(
          '.more-panel .composer-tool-option'
        )].find((button) => button.querySelector('svg.lucide-mic'));
        if (!(option instanceof HTMLButtonElement) || option.disabled) return false;
        option.click();
        return true;
      `,
    );
    assertContract(
      started === true,
      'CHAT_VOICE_RECORD_CONTROL_MISSING',
      `${clientId} cannot start voice recording`,
    );
    return waitForUi(
      clientId,
      client,
      'voice recording state',
      `
        const surface = document.querySelector(
          '[data-product-surface="chat.voice-recording"]'
        );
        return {
          ready: Boolean(surface?.getClientRects().length),
          text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
        };
      `,
    );
  };

  await startRecording();
  await sleep(600);
  await clickVisibleSelector(
    client,
    '[data-product-surface="chat.voice-recording"] .voice-recording-actions button:first-child',
    'cancel-voice-recording',
  );
  await waitForUi(
    clientId,
    client,
    'cancelled voice recording',
    `
      return {
        ready: !document.querySelector(
          '[data-product-surface="chat.voice-recording"]'
        )
      };
    `,
  );

  await startRecording();
  await sleep(1600);
  await clickVisibleSelector(
    client,
    '[data-product-surface="chat.voice-recording"] .voice-recording-actions button:last-child',
    'finish-voice-recording',
  );
  await waitForUi(
    clientId,
    client,
    'ready voice attachment',
    `
      const surface = document.querySelector(
        '[data-product-surface="chat.attachment-ready"]'
      );
      return {
        ready: Boolean(surface?.getClientRects().length),
        text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
  );
  await clickVisibleSelector(
    client,
    'button.message-send-button',
    'send-voice-message',
  );
  return waitForUi(
    clientId,
    client,
    'sent voice message',
    `
      const previous = new Set(arguments[0]);
      const rows = [...document.querySelectorAll('[data-message-ulid]')]
        .filter((element) => (
          element.getClientRects().length
          && element.querySelector('[data-attachment-id]')
          && !previous.has(element.getAttribute('data-message-ulid') || '')
        ));
      const row = rows.at(-1);
      const item = row?.querySelector('[data-attachment-id]');
      return {
        ready: Boolean(item),
        messageId: row?.getAttribute('data-message-ulid') || '',
        attachmentId: item?.getAttribute('data-attachment-id') || '',
        text: (row?.innerText || '').replace(/\\s+/g, ' ').trim()
      };
    `,
    [existingIds],
  );
}

async function playLatestVoiceMessage(clientId, client, friendlyName) {
  await openChatConversation(clientId, client, 'friend', friendlyName);
  if (client.platform === 'desktop') {
    const voice = await waitForUi(
      clientId,
      client,
      'ready Desktop voice message',
      `
        const voices = [...document.querySelectorAll(
          '[data-chat-voice-playback-state]'
        )].filter((element) => element.getClientRects().length);
        const voice = voices.at(-1);
        return {
          ready: Boolean(voice)
            && !['loading', 'error'].includes(
              voice.getAttribute('data-chat-voice-playback-state') || ''
            ),
          state: voice?.getAttribute('data-chat-voice-playback-state') || ''
        };
      `,
    );
    const played = await executeWebScript(
      client,
      `
        const voices = [...document.querySelectorAll(
          '[data-chat-voice-playback-state]'
        )].filter((element) => element.getClientRects().length);
        const button = voices.at(-1)?.querySelector(
          'button[data-chat-voice-playing]'
        );
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      `,
    );
    assertContract(
      played === true,
      'CHAT_VOICE_PLAY_CONTROL_MISSING',
      `${clientId} cannot play the voice message`,
    );
    return waitForUi(
      clientId,
      client,
      'Desktop voice playback',
      `
        const voices = [...document.querySelectorAll(
          '[data-chat-voice-playback-state]'
        )].filter((element) => element.getClientRects().length);
        const state = voices.at(-1)
          ?.getAttribute('data-chat-voice-playback-state') || '';
        return { ready: ['playing', 'ended'].includes(state), state };
      `,
    );
  }
  await waitForUi(
    clientId,
    client,
    'ready Mobile voice message',
    `
      const audios = [...document.querySelectorAll(
        '.mobile-attachment-audio audio'
      )].filter((element) => element.getClientRects().length);
      const audio = audios.at(-1);
      return {
        ready: Boolean(audio?.getAttribute('src')),
        src: audio?.getAttribute('src') || ''
      };
    `,
  );
  const played = await executeWebScript(
    client,
    `
      const audios = [...document.querySelectorAll(
        '.mobile-attachment-audio audio'
      )].filter((element) => element.getClientRects().length);
      const audio = audios.at(-1);
      if (!(audio instanceof HTMLAudioElement)) return { ok: false };
      audio.click();
      return audio.play()
        .then(() => ({ ok: true, paused: audio.paused }))
        .catch((error) => ({ ok: false, error: String(error) }));
    `,
  );
  assertContract(
    played?.ok === true,
    'CHAT_VOICE_PLAY_FAILED',
    `${clientId} voice playback failed: ${played?.error || 'unknown'}`,
  );
  return played;
}

async function clickConversationHeaderCall(clientId, client, kind) {
  const started = await executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          const pane = document.querySelector('[data-chat-conversation-pane]');
          const selector = arguments[0] === 'video'
            ? 'svg.lucide-video'
            : 'svg.lucide-phone';
          const button = [...(pane?.querySelectorAll('button') || [])]
            .find((candidate) => (
              candidate.getClientRects().length
              && candidate.querySelector(selector)
              && !candidate.closest('[data-chat-call-surface]')
            ));
          if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
          button.click();
          return true;
        `
      : `
          const buttons = [...document.querySelectorAll(
            '.chat-header-actions button'
          )].filter((button) => button.getClientRects().length);
          const index = arguments[0] === 'video' ? 1 : 0;
          const button = buttons[index];
          if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
          button.click();
          return true;
        `,
    [kind],
  );
  assertContract(
    started === true,
    'CHAT_CALL_CONTROL_MISSING',
    `${clientId} cannot start a ${kind} call`,
  );
  return { kind };
}

async function readCallSurface(client) {
  return executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector('[data-chat-call-surface]');
          return {
            active: Boolean(surface?.getClientRects().length),
            mediaKind: surface?.getAttribute('data-chat-call-media-kind') || '',
            state: surface?.getAttribute('data-chat-call-state') || '',
            text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
          };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const buttons = [...(surface?.querySelectorAll('button') || [])];
          return {
            active: Boolean(surface?.getClientRects().length),
            connected: Boolean(surface?.classList.contains('active')),
            labels: buttons.map((button) => button.getAttribute('aria-label') || ''),
            selected: buttons.filter((button) => button.classList.contains('selected'))
              .map((button) => button.getAttribute('aria-label') || ''),
            terminal: Boolean(
              surface
              && buttons.some((button) => button.querySelector('svg.lucide-x'))
            ),
            text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
          };
        `,
  );
}

async function waitForCallSurface(
  clientId,
  client,
  expectedState,
  mediaKind,
  friendlyName,
) {
  const state = await waitForUi(
    clientId,
    client,
    `${mediaKind} call ${expectedState}`,
    client.platform === 'desktop'
      ? `
          const [expectedState, mediaKind] = arguments;
          const surface = document.querySelector('[data-chat-call-surface]');
          const state = surface?.getAttribute('data-chat-call-state') || '';
          const media = surface?.getAttribute('data-chat-call-media-kind') || '';
          return {
            ready: Boolean(surface?.getClientRects().length)
              && state === expectedState
              && media === mediaKind,
            state,
            mediaKind: media,
            text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
          };
        `
      : `
          const [expectedState] = arguments;
          const surface = document.querySelector('.mobile-call-surface');
          const buttons = [...(surface?.querySelectorAll('button') || [])];
          const incoming = buttons.some((button) => (
            button.classList.contains('accept')
          ));
          const connected = Boolean(surface?.classList.contains('active'));
          const terminal = buttons.some((button) => (
            button.querySelector('svg.lucide-x')
          ));
          const ready = expectedState === 'incoming'
            ? incoming
            : expectedState === 'active'
              ? connected
              : expectedState === 'terminal'
                ? terminal
                : Boolean(surface?.getClientRects().length)
                  && !incoming
                  && !connected
                  && !terminal;
          return {
            ready,
            incoming,
            connected,
            terminal,
            text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
          };
        `,
    [expectedState, mediaKind],
  );
  assertContract(
    !friendlyName
      || state.text.toLowerCase().includes(friendlyName.toLowerCase()),
    'CHAT_CALL_FRIENDLY_IDENTITY_MISSING',
    `${clientId} ${mediaKind} call surface does not identify ${friendlyName}`,
  );
  return state;
}

async function clickCallSurfaceControl(clientId, client, action) {
  const clicked = await executeWebScript(
    client,
    `
      const surface = document.querySelector(
        arguments[0] === 'desktop'
          ? '[data-chat-call-surface]'
          : '.mobile-call-surface'
      );
      const buttons = [...(surface?.querySelectorAll('button') || [])]
        .filter((button) => button.getClientRects().length);
      const action = arguments[1];
      const button = buttons.find((candidate) => {
        if (action === 'accept') {
          return candidate.classList.contains('accept')
            || (
              candidate.querySelector('svg.lucide-phone')
              && !candidate.querySelector('svg.lucide-phone-off')
            );
        }
        if (action === 'decline' || action === 'end') {
          return candidate.classList.contains('danger')
            || Boolean(candidate.querySelector('svg.lucide-phone-off'));
        }
        if (action === 'microphone') {
          return Boolean(candidate.querySelector(
            'svg.lucide-mic, svg.lucide-mic-off'
          ));
        }
        if (action === 'camera') {
          return Boolean(candidate.querySelector(
            'svg.lucide-camera, svg.lucide-camera-off'
          ));
        }
        if (action === 'dismiss') {
          return Boolean(candidate.querySelector('svg.lucide-x'));
        }
        return false;
      });
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return { ok: false };
      }
      const before = button.getAttribute('aria-label')
        || button.getAttribute('title')
        || button.className;
      button.click();
      return { ok: true, before };
    `,
    [client.platform, action],
  );
  assertContract(
    clicked?.ok === true,
    'CHAT_CALL_ACTION_MISSING',
    `${clientId} cannot perform call action ${action}`,
  );
  return clicked;
}

async function waitForCallTerminal(clientId, client) {
  return waitForUi(
    clientId,
    client,
    'terminal call state',
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector('[data-chat-call-surface]');
          const state = surface?.getAttribute('data-chat-call-state') || '';
          return {
            ready: !surface
              || !surface.getClientRects().length
              || !['incoming', 'outgoing', 'active', 'reconnecting'].includes(state),
            state
          };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const terminal = Boolean(
            surface
            && [...surface.querySelectorAll('button')].some((button) => (
              button.querySelector('svg.lucide-x')
            ))
          );
          return {
            ready: !surface || !surface.getClientRects().length || terminal,
            terminal,
            text: (surface?.innerText || '').replace(/\\s+/g, ' ').trim()
          };
        `,
  );
}

async function clearTerminalCallSurface(clientId, client) {
  const state = await readCallSurface(client);
  if (!state.active) return state;
  await clickCallSurfaceControl(clientId, client, 'dismiss');
  return waitForUi(
    clientId,
    client,
    'dismissed terminal call',
    `
      const surface = document.querySelector(
        arguments[0] === 'desktop'
          ? '[data-chat-call-surface]'
          : '.mobile-call-surface'
      );
      return { ready: !surface || !surface.getClientRects().length };
    `,
    [client.platform],
  );
}

async function toggleCallControl(clientId, client, action) {
  const before = await readCallSurface(client);
  await clickCallSurfaceControl(clientId, client, action);
  return waitForUi(
    clientId,
    client,
    `${action} call toggle`,
    `
      const surface = document.querySelector(
        arguments[0] === 'desktop'
          ? '[data-chat-call-surface]'
          : '.mobile-call-surface'
      );
      const buttons = [...(surface?.querySelectorAll('button') || [])];
      const action = arguments[1];
      const button = buttons.find((candidate) => (
        action === 'microphone'
          ? candidate.querySelector('svg.lucide-mic, svg.lucide-mic-off')
          : candidate.querySelector('svg.lucide-camera, svg.lucide-camera-off')
      ));
      const label = button?.getAttribute('aria-label')
        || button?.getAttribute('title')
        || '';
      const selected = Boolean(button?.classList.contains('selected'));
      return {
        ready: Boolean(button)
          && (label !== arguments[2] || selected !== arguments[3]),
        label,
        selected
      };
    `,
    [
      client.platform,
      action,
      before.labels?.find((label) => (
        action === 'microphone'
          ? /mute/i.test(label)
          : /camera/i.test(label)
      )) || '',
      Boolean(before.selected?.some((label) => (
        action === 'microphone'
          ? /mute/i.test(label)
          : /camera/i.test(label)
      ))),
    ],
  );
}

async function runChatPhase(manifest, evidenceDir, preflight) {
  const interactionTrace = [];
  const sequenceRef = { value: 0 };
  const step = async (clientId, stepId, action) => {
    const client = manifest.clients[clientId];
    await activateForegroundClient(clientId, client);
    return withWebContext(client, async () => {
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
    });
  };

  for (const clientId of requiredClientIds) {
    await step(clientId, 'chat-authenticated-precondition', () => (
      ensureAuthenticated(
        clientId,
        manifest.clients[clientId],
        manifest.stationUrl,
      )
    ));
  }
  const bobCoralRequest = (await step(
    'ios-coral',
    'chat-coral-request-bob',
    () => requestMobileFriendship(
      'ios-coral',
      manifest.clients['ios-coral'],
      'bob',
      'Bob',
    ),
  )).result;
  await step(
    'desktop-bob',
    'chat-bob-accept-coral',
    () => acceptIncomingFriendship(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      'Carol',
      bobCoralRequest.peerPtid,
    ),
  );

  const stamp = Date.now();
  const aliceBobText = `MWPU Alice to Bob ${stamp}`;
  const bobAliceReply = `MWPU Bob to Alice ${stamp}`;
  const coralAliceText = `MWPU Carol to Alice ${stamp}`;
  const aliceCoralReply = `MWPU Alice to Carol ${stamp}`;

  await step(
    'android-alice',
    'chat-alice-send-bob-text',
    () => sendChatText(
      'android-alice',
      manifest.clients['android-alice'],
      'friend',
      'Bob',
      aliceBobText,
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-receive-and-reply-alice',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Alice',
      );
      const received = await waitForChatMessage(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        aliceBobText,
      );
      const reply = await sendChatText(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Alice',
        bobAliceReply,
      );
      return { received, reply };
    },
  );
  await step(
    'android-alice',
    'chat-alice-receive-bob-and-read-state',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Bob',
      );
      const received = await waitForChatMessage(
        'android-alice',
        manifest.clients['android-alice'],
        bobAliceReply,
      );
      const receipt = await waitForChatReadReceipt(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Bob',
        aliceBobText,
      );
      return { received, receipt };
    },
  );
  await step(
    'ios-coral',
    'chat-coral-send-alice-text',
    () => sendChatText(
      'ios-coral',
      manifest.clients['ios-coral'],
      'friend',
      'Alice',
      coralAliceText,
    ),
  );
  await step(
    'android-alice',
    'chat-alice-receive-and-reply-coral',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Carol',
      );
      const received = await waitForChatMessage(
        'android-alice',
        manifest.clients['android-alice'],
        coralAliceText,
      );
      const reply = await sendChatText(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Carol',
        aliceCoralReply,
      );
      return { received, reply };
    },
  );
  await step(
    'ios-coral',
    'chat-coral-receive-alice-and-read-state',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'friend',
        'Alice',
      );
      const received = await waitForChatMessage(
        'ios-coral',
        manifest.clients['ios-coral'],
        aliceCoralReply,
      );
      const receipt = await waitForChatReadReceipt(
        'ios-coral',
        manifest.clients['ios-coral'],
        'friend',
        'Alice',
        coralAliceText,
      );
      return { received, receipt };
    },
  );
  await step(
    'desktop-bob',
    'chat-direct-history-stable-bob',
    () => assertChatMessageOrder(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      'friend',
      'Alice',
      [aliceBobText, bobAliceReply],
    ),
  );
  await step(
    'ios-coral',
    'chat-direct-history-stable-coral',
    () => assertChatMessageOrder(
      'ios-coral',
      manifest.clients['ios-coral'],
      'friend',
      'Alice',
      [coralAliceText, aliceCoralReply],
    ),
  );

  const attachmentName = `mwpu-${stamp}.png`;
  await step(
    'desktop-bob',
    'chat-bob-send-alice-attachment',
    () => sendDesktopAttachment(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      'Alice',
      attachmentName,
    ),
  );
  await step(
    'android-alice',
    'chat-alice-open-bob-attachment',
    () => verifyMobileAttachment(
      'android-alice',
      manifest.clients['android-alice'],
      'Bob',
    ),
  );
  await step(
    'android-alice',
    'chat-alice-react-bob-message',
    () => reactToMobileMessage(
      'android-alice',
      manifest.clients['android-alice'],
      bobAliceReply,
      '\u{1F44D}',
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-observe-alice-reaction',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Alice',
      );
      return waitForUi(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'Alice reaction on Bob message',
        `
          const row = [...document.querySelectorAll('[data-message-ulid]')]
            .find((element) => (
              element.getClientRects().length
              && (element.innerText || '').includes(arguments[0])
            ));
          const reaction = [...(row?.querySelectorAll(
            '[data-message-reaction]'
          ) || [])].find((element) => (
            element.getAttribute('data-message-reaction') === arguments[1]
          ));
          return {
            ready: Boolean(reaction),
            reaction: reaction?.getAttribute('data-message-reaction') || ''
          };
        `,
        [bobAliceReply, '\u{1F44D}'],
      );
    },
  );
  const richReply = `MWPU rich reply ${stamp}`;
  await step(
    'android-alice',
    'chat-alice-reply-bob-message',
    () => replyToMobileMessage(
      'android-alice',
      manifest.clients['android-alice'],
      bobAliceReply,
      richReply,
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-observe-alice-reply',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Alice',
      );
      const reply = await waitForChatMessage(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        richReply,
      );
      assertContract(
        reply.text.includes(bobAliceReply),
        'CHAT_REPLY_RECEIVER_CONTEXT_MISSING',
        'Bob does not see the original message in Alice reply',
      );
      return reply;
    },
  );
  await step(
    'android-alice',
    'chat-alice-forward-bob-message-to-coral',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Bob',
      );
      return forwardMobileMessage(
        'android-alice',
        manifest.clients['android-alice'],
        bobAliceReply,
        'Carol',
      );
    },
  );
  await step(
    'ios-coral',
    'chat-coral-observe-forwarded-message',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'friend',
        'Alice',
      );
      return waitForChatMessage(
        'ios-coral',
        manifest.clients['ios-coral'],
        bobAliceReply,
      );
    },
  );
  await step(
    'android-alice',
    'chat-alice-search-original-message',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Bob',
      );
      return searchMobileMessage(
        'android-alice',
        manifest.clients['android-alice'],
        bobAliceReply,
      );
    },
  );

  const aliceGroup = (await step(
    'android-alice',
    'chat-alice-open-shared-group',
    () => openChatConversation(
      'android-alice',
      manifest.clients['android-alice'],
      'group',
    ),
  )).result;
  const groupName = aliceGroup.title || aliceGroup.label
    .match(/MWPU Three Client \d+/)?.[0]
    || '';
  assertContract(
    groupName.startsWith('MWPU Three Client'),
    'CHAT_SHARED_GROUP_MISSING',
    'Alice cannot resolve the shared three-client Group',
  );
  const aliceGroupText = `MWPU Alice group ${stamp}`;
  const bobGroupText = `MWPU Bob group ${stamp}`;
  const coralGroupText = `MWPU Carol group ${stamp}`;
  await step(
    'android-alice',
    'chat-alice-send-group-message',
    () => sendChatText(
      'android-alice',
      manifest.clients['android-alice'],
      'group',
      groupName,
      aliceGroupText,
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-receive-and-send-group-message',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'group',
        groupName,
      );
      const received = await waitForChatMessage(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        aliceGroupText,
      );
      const sent = await sendChatText(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'group',
        groupName,
        bobGroupText,
      );
      return { received, sent };
    },
  );
  await step(
    'ios-coral',
    'chat-coral-receive-and-send-group-message',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'group',
        groupName,
      );
      const alice = await waitForChatMessage(
        'ios-coral',
        manifest.clients['ios-coral'],
        aliceGroupText,
      );
      const bob = await waitForChatMessage(
        'ios-coral',
        manifest.clients['ios-coral'],
        bobGroupText,
      );
      const sent = await sendChatText(
        'ios-coral',
        manifest.clients['ios-coral'],
        'group',
        groupName,
        coralGroupText,
      );
      return { alice, bob, sent };
    },
  );
  await step(
    'android-alice',
    'chat-alice-group-administration',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'group',
        groupName,
      );
      await waitForChatMessage(
        'android-alice',
        manifest.clients['android-alice'],
        coralGroupText,
      );
      await openMobileGroupManagement(
        'android-alice',
        manifest.clients['android-alice'],
      );
      const promoted = await clickGroupMemberButton(
        'android-alice',
        manifest.clients['android-alice'],
        'Bob',
        0,
      );
      const demoted = await clickGroupMemberButton(
        'android-alice',
        manifest.clients['android-alice'],
        'Bob',
        0,
      );
      const muted = await clickGroupMemberButton(
        'android-alice',
        manifest.clients['android-alice'],
        'Bob',
        2,
      );
      const unmuted = await clickGroupMemberButton(
        'android-alice',
        manifest.clients['android-alice'],
        'Bob',
        2,
      );
      const membership = await removeAndRestoreGroupMember(
        'android-alice',
        manifest.clients['android-alice'],
        'Bob',
      );
      await clickVisibleSelector(
        manifest.clients['android-alice'],
        '[data-acceptance-id="group-management"] .chat-action-sheet-header button',
        'close-group-management',
      );
      return {
        demoted,
        membership,
        muted,
        promoted,
        unmuted,
      };
    },
  );
  await step(
    'ios-coral',
    'chat-coral-role-gated-group-controls',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'group',
        groupName,
      );
      return proveGroupRoleDenied(
        'ios-coral',
        manifest.clients['ios-coral'],
      );
    },
  );
  for (const clientId of requiredClientIds) {
    await step(
      clientId,
      'chat-group-history-converged',
      () => assertChatMessageOrder(
        clientId,
        manifest.clients[clientId],
        'group',
        groupName,
        [aliceGroupText, bobGroupText, coralGroupText],
      ),
    );
  }

  await step(
    'android-alice',
    'chat-alice-record-and-send-voice',
    () => recordMobileVoiceMessage(
      'android-alice',
      manifest.clients['android-alice'],
      'Bob',
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-play-alice-voice',
    () => playLatestVoiceMessage(
      'desktop-bob',
      manifest.clients['desktop-bob'],
      'Alice',
    ),
  );
  await step(
    'ios-coral',
    'chat-coral-record-and-send-voice',
    () => recordMobileVoiceMessage(
      'ios-coral',
      manifest.clients['ios-coral'],
      'Alice',
    ),
  );
  await step(
    'android-alice',
    'chat-alice-play-coral-voice',
    () => playLatestVoiceMessage(
      'android-alice',
      manifest.clients['android-alice'],
      'Carol',
    ),
  );

  await step(
    'android-alice',
    'chat-alice-start-audio-call-bob',
    async () => {
      await openChatConversation(
        'android-alice',
        manifest.clients['android-alice'],
        'friend',
        'Bob',
      );
      await clickConversationHeaderCall(
        'android-alice',
        manifest.clients['android-alice'],
        'audio',
      );
      return waitForCallSurface(
        'android-alice',
        manifest.clients['android-alice'],
        'outgoing',
        'audio',
        'Bob',
      );
    },
  );
  await step(
    'desktop-bob',
    'chat-bob-answer-audio-call',
    async () => {
      await waitForCallSurface(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'incoming',
        'audio',
        'Alice',
      );
      await clickCallSurfaceControl(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'accept',
      );
      return waitForCallSurface(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'active',
        'audio',
        'Alice',
      );
    },
  );
  await step(
    'android-alice',
    'chat-alice-audio-call-connected',
    () => waitForCallSurface(
      'android-alice',
      manifest.clients['android-alice'],
      'active',
      'audio',
      'Bob',
    ),
  );
  await step(
    'desktop-bob',
    'chat-bob-end-audio-call',
    async () => {
      await clickCallSurfaceControl(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'end',
      );
      return waitForCallTerminal(
        'desktop-bob',
        manifest.clients['desktop-bob'],
      );
    },
  );
  await step(
    'android-alice',
    'chat-alice-audio-call-terminal',
    async () => {
      await waitForCallTerminal(
        'android-alice',
        manifest.clients['android-alice'],
      );
      return clearTerminalCallSurface(
        'android-alice',
        manifest.clients['android-alice'],
      );
    },
  );

  await step(
    'ios-coral',
    'chat-coral-start-audio-call-alice',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'friend',
        'Alice',
      );
      await clickConversationHeaderCall(
        'ios-coral',
        manifest.clients['ios-coral'],
        'audio',
      );
      return waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'outgoing',
        'audio',
        'Alice',
      );
    },
  );
  await step(
    'android-alice',
    'chat-alice-reject-coral-audio-call',
    async () => {
      await waitForCallSurface(
        'android-alice',
        manifest.clients['android-alice'],
        'incoming',
        'audio',
        'Carol',
      );
      await clickCallSurfaceControl(
        'android-alice',
        manifest.clients['android-alice'],
        'decline',
      );
      return waitForCallTerminal(
        'android-alice',
        manifest.clients['android-alice'],
      );
    },
  );
  for (const clientId of ['android-alice', 'ios-coral']) {
    await step(
      clientId,
      'chat-rejected-audio-call-terminal',
      async () => {
        await waitForCallTerminal(clientId, manifest.clients[clientId]);
        return clearTerminalCallSurface(
          clientId,
          manifest.clients[clientId],
        );
      },
    );
  }
  await step(
    'ios-coral',
    'chat-coral-retry-audio-call-alice',
    async () => {
      await openChatConversation(
        'ios-coral',
        manifest.clients['ios-coral'],
        'friend',
        'Alice',
      );
      await clickConversationHeaderCall(
        'ios-coral',
        manifest.clients['ios-coral'],
        'audio',
      );
      return waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'outgoing',
        'audio',
        'Alice',
      );
    },
  );
  await step(
    'android-alice',
    'chat-alice-answer-coral-audio-retry',
    async () => {
      await waitForCallSurface(
        'android-alice',
        manifest.clients['android-alice'],
        'incoming',
        'audio',
        'Carol',
      );
      await clickCallSurfaceControl(
        'android-alice',
        manifest.clients['android-alice'],
        'accept',
      );
      return waitForCallSurface(
        'android-alice',
        manifest.clients['android-alice'],
        'active',
        'audio',
        'Carol',
      );
    },
  );
  await step(
    'ios-coral',
    'chat-coral-end-audio-retry',
    async () => {
      await waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'active',
        'audio',
        'Alice',
      );
      await clickCallSurfaceControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'end',
      );
      return waitForCallTerminal(
        'ios-coral',
        manifest.clients['ios-coral'],
      );
    },
  );
  for (const clientId of ['android-alice', 'ios-coral']) {
    await step(
      clientId,
      'chat-completed-audio-retry-terminal',
      async () => {
        await waitForCallTerminal(clientId, manifest.clients[clientId]);
        return clearTerminalCallSurface(
          clientId,
          manifest.clients[clientId],
        );
      },
    );
  }

  await step(
    'desktop-bob',
    'chat-bob-start-video-call-coral',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Carol',
      );
      await clickConversationHeaderCall(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'video',
      );
      return waitForCallSurface(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'outgoing',
        'video',
        'Carol',
      );
    },
  );
  await step(
    'ios-coral',
    'chat-coral-answer-bob-video-call',
    async () => {
      await waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'incoming',
        'video',
        'Bob',
      );
      await clickCallSurfaceControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'accept',
      );
      return waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'active',
        'video',
        'Bob',
      );
    },
  );
  await step(
    'desktop-bob',
    'chat-bob-toggle-video-controls',
    async () => {
      await waitForCallSurface(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'active',
        'video',
        'Carol',
      );
      const microphone = await toggleCallControl(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'microphone',
      );
      const camera = await toggleCallControl(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'camera',
      );
      return { camera, microphone };
    },
  );
  await step(
    'ios-coral',
    'chat-coral-toggle-video-controls-and-end',
    async () => {
      const microphone = await toggleCallControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'microphone',
      );
      const camera = await toggleCallControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'camera',
      );
      await clickCallSurfaceControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'end',
      );
      await waitForCallTerminal(
        'ios-coral',
        manifest.clients['ios-coral'],
      );
      return { camera, microphone };
    },
  );
  for (const clientId of ['desktop-bob', 'ios-coral']) {
    await step(
      clientId,
      'chat-video-call-terminal',
      async () => {
        await waitForCallTerminal(clientId, manifest.clients[clientId]);
        return clearTerminalCallSurface(
          clientId,
          manifest.clients[clientId],
        );
      },
    );
  }
  await step(
    'desktop-bob',
    'chat-bob-retry-video-call-coral',
    async () => {
      await openChatConversation(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'friend',
        'Carol',
      );
      await clickConversationHeaderCall(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'video',
      );
      return waitForCallSurface(
        'desktop-bob',
        manifest.clients['desktop-bob'],
        'outgoing',
        'video',
        'Carol',
      );
    },
  );
  await step(
    'ios-coral',
    'chat-coral-reject-video-retry',
    async () => {
      await waitForCallSurface(
        'ios-coral',
        manifest.clients['ios-coral'],
        'incoming',
        'video',
        'Bob',
      );
      await clickCallSurfaceControl(
        'ios-coral',
        manifest.clients['ios-coral'],
        'decline',
      );
      return waitForCallTerminal(
        'ios-coral',
        manifest.clients['ios-coral'],
      );
    },
  );
  for (const clientId of ['desktop-bob', 'ios-coral']) {
    await step(
      clientId,
      'chat-video-retry-terminal',
      async () => {
        await waitForCallTerminal(clientId, manifest.clients[clientId]);
        return clearTerminalCallSurface(
          clientId,
          manifest.clients[clientId],
        );
      },
    );
  }

  const report = {
    kind: 'peers-touch-three-client-product-journey-result',
    schemaVersion: 1,
    phase: 'chat',
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

function normalizeRecoveryText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function assertRecoveryIntersection(
  clientId,
  label,
  beforeValues,
  afterValues,
) {
  const before = new Set(beforeValues.filter(Boolean));
  const after = new Set(afterValues.filter(Boolean));
  const retained = [...before].filter((value) => after.has(value));
  assertContract(
    retained.length > 0,
    'RECOVERY_VISIBLE_STATE_MISSING',
    `${clientId} did not recover any ${label}`,
  );
  return retained;
}

async function navigateRecoveryChatList(clientId, client) {
  if (client.platform === 'desktop') {
    await navigateDesktopPrimary(
      clientId,
      client,
      'chat',
      '[data-social-chat-layout]',
    );
    await clickSelector(
      client,
      '[data-chat-subpage="chats"]',
      'open-recovery-chat-list',
    );
    await waitForUi(
      clientId,
      client,
      'Desktop recovery conversation list',
      `
        return {
          ready: Boolean(
            document.querySelector('[data-chat-conversation-list-shell]')
          )
        };
      `,
    );
    return;
  }
  if (await selectorIsVisible(
    client,
    '[data-product-surface^="chat."][data-product-surface$="-thread"]',
  )) {
    await clickSelector(
      client,
      'button[aria-label="Back"]',
      'return-to-recovery-chat-list',
    );
  }
  await navigateMobileShell(
    clientId,
    client,
    'chat',
    '[data-product-surface^="chat.list"]',
  );
}

async function readRecoveryConversationInventory(clientId, client) {
  await navigateRecoveryChatList(clientId, client);
  const inventory = await executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          return [...document.querySelectorAll('[data-pt-conversation-item]')]
            .filter((element) => element.getClientRects().length)
            .map((element) => ({
              id: element.getAttribute('data-pt-conversation-item') || '',
              kind: element.getAttribute('data-chat-conversation-kind') || '',
              label: (element.innerText || '').replace(/\\s+/g, ' ').trim()
            }));
        `
      : `
          return [...document.querySelectorAll('[data-conversation-id]')]
            .filter((element) => element.getClientRects().length)
            .map((element) => ({
              id: element.getAttribute('data-conversation-id') || '',
              kind: element.getAttribute('data-conversation-kind') || '',
              label: (element.innerText || '').replace(/\\s+/g, ' ').trim()
            }));
        `,
  );
  const direct = inventory.filter(({ kind }) => kind === 'friend');
  const groups = inventory.filter(({ kind }) => kind === 'group');
  assertContract(
    direct.length > 0,
    'RECOVERY_DIRECT_HISTORY_REQUIRED',
    `${clientId} has no Direct conversation to recover`,
  );
  assertContract(
    groups.length > 0,
    'RECOVERY_GROUP_HISTORY_REQUIRED',
    `${clientId} has no Group conversation to recover`,
  );
  return { direct, groups };
}

async function openRecoveryConversation(
  clientId,
  client,
  kind,
  friendlyName = '',
) {
  await navigateRecoveryChatList(clientId, client);
  const selector = client.platform === 'desktop'
    ? '[data-pt-conversation-item]'
    : '[data-conversation-id]';
  const opened = await executeWebScript(
    client,
    `
      const [selector, kind, friendlyName] = arguments;
      const rows = [...document.querySelectorAll(selector)]
        .filter((element) => element.getClientRects().length)
        .filter((element) => (
          (element.getAttribute('data-chat-conversation-kind')
            || element.getAttribute('data-conversation-kind')) === kind
        ));
      const target = rows.find((element) => (
        friendlyName
        && (element.innerText || '').toLowerCase().includes(
          friendlyName.toLowerCase()
        )
      )) || rows[0];
      if (!(target instanceof HTMLElement)) {
        return { ok: false, reason: 'conversation-missing' };
      }
      const id = target.getAttribute('data-pt-conversation-item')
        || target.getAttribute('data-conversation-id')
        || '';
      target.click();
      return {
        id,
        label: (target.innerText || '').replace(/\\s+/g, ' ').trim(),
        ok: true
      };
    `,
    [selector, kind, friendlyName],
  );
  assertContract(
    opened?.ok === true && opened.id,
    kind === 'group'
      ? 'RECOVERY_GROUP_HISTORY_REQUIRED'
      : 'RECOVERY_DIRECT_HISTORY_REQUIRED',
    `${clientId} cannot open a ${kind} conversation`,
  );
  const detail = await waitForUi(
    clientId,
    client,
    `${kind} recovery history`,
    client.platform === 'desktop'
      ? `
          const composer = document.querySelector(
            '[data-chat-composer="' + arguments[0] + '"]'
          );
          const messages = [...document.querySelectorAll('[data-message-ulid]')]
            .filter((element) => element.getClientRects().length);
          return {
            ready: Boolean(composer) && messages.length > 0,
            messageIds: messages.map((element) => (
              element.getAttribute('data-message-ulid') || ''
            )),
            messageText: messages.map((element) => (
              (element.innerText || '').replace(/\\s+/g, ' ').trim()
            )),
            text: (document.body?.innerText || '').slice(0, 2400)
          };
        `
      : `
          const surface = document.querySelector(
            arguments[1] === 'group'
              ? '[data-product-surface="chat.group-thread"]'
              : '[data-product-surface="chat.direct-thread"]'
          );
          const messages = [...document.querySelectorAll('[data-message-ulid]')]
            .filter((element) => element.getClientRects().length);
          return {
            ready: Boolean(surface?.getClientRects().length)
              && messages.length > 0,
            messageIds: messages.map((element) => (
              element.getAttribute('data-message-ulid') || ''
            )),
            messageText: messages.map((element) => (
              (element.innerText || '').replace(/\\s+/g, ' ').trim()
            )),
            text: (surface?.innerText || '').slice(0, 2400)
          };
        `,
    [opened.id, kind],
  );
  return {
    id: opened.id,
    label: normalizeRecoveryText(opened.label),
    messageIds: detail.messageIds.filter(Boolean),
    messageText: detail.messageText.map(normalizeRecoveryText).filter(Boolean),
    text: normalizeRecoveryText(detail.text),
  };
}

async function readRecoverySocialSnapshot(clientId, client) {
  if (client.platform === 'desktop') {
    await navigateDesktopPrimary(
      clientId,
      client,
      'moments',
      '[data-pt-primary-nav="moments"] [role="button"]',
      'Social',
    );
    const feed = await waitForUi(
      clientId,
      client,
      'Desktop recovered Social feed',
      `
        const main = document.querySelector('[data-page="moments"] main');
        const cards = main
          ? [...main.querySelectorAll('div')].filter((element) => (
              element.getClientRects().length
              && getComputedStyle(element).cursor === 'pointer'
              && element.querySelectorAll('button').length >= 2
              && (element.innerText || '').trim().length > 0
            ))
          : [];
        const card = cards[0];
        return {
          ready: Boolean(card),
          signatures: cards.slice(0, 8).map((element) => (
            (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500)
          )),
          text: (main?.innerText || '').slice(0, 3000)
        };
      `,
    );
    const opened = await executeWebScript(
      client,
      `
        const main = document.querySelector('[data-page="moments"] main');
        const card = main
          ? [...main.querySelectorAll('div')].find((element) => (
              element.getClientRects().length
              && getComputedStyle(element).cursor === 'pointer'
              && element.querySelectorAll('button').length >= 2
              && (element.innerText || '').trim().length > 0
            ))
          : null;
        if (!(card instanceof HTMLElement)) return false;
        card.click();
        return true;
      `,
    );
    assertContract(
      opened === true,
      'RECOVERY_SOCIAL_DETAIL_REQUIRED',
      `${clientId} cannot open a Social post`,
    );
    const detail = await waitForUi(
      clientId,
      client,
      'Desktop recovered Social detail',
      `
        const region = document.querySelector('[data-moments-comments-region]');
        return {
          ready: Boolean(region),
          text: (document.querySelector('[data-page="moments"] main')?.innerText || '')
            .slice(0, 3000)
        };
      `,
    );
    return {
      detail: normalizeRecoveryText(detail.text),
      postIds: [],
      signatures: feed.signatures.map(normalizeRecoveryText).filter(Boolean),
    };
  }

  await navigateMobileShell(
    clientId,
    client,
    'moments',
    '[data-product-surface="moments.feed"]',
  );
  const feed = await waitForUi(
    clientId,
    client,
    'Mobile recovered Social feed',
    `
      const cards = [...document.querySelectorAll(
        'article[data-acceptance-id="social-moment-card"][data-post-id]'
      )].filter((element) => element.getClientRects().length);
      return {
        ready: cards.length > 0,
        postIds: cards.map((element) => element.getAttribute('data-post-id') || ''),
        signatures: cards.slice(0, 8).map((element) => (
          (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500)
        ))
      };
    `,
  );
  const firstPostId = feed.postIds.find(Boolean);
  await clickSelector(
    client,
    `[data-acceptance-id="social-thread-open"][data-post-id="${firstPostId}"]`,
    'open-recovered-social-detail',
  );
  const detail = await waitForUi(
    clientId,
    client,
    'Mobile recovered Social detail',
    `
      const surface = document.querySelector(
        '[data-product-surface="moments.detail-comments"]'
      );
      return {
        ready: Boolean(surface?.getClientRects().length),
        text: (surface?.innerText || '').slice(0, 3000)
      };
    `,
  );
  return {
    detail: normalizeRecoveryText(detail.text),
    postIds: feed.postIds.filter(Boolean),
    signatures: feed.signatures.map(normalizeRecoveryText).filter(Boolean),
  };
}

async function readRecoveryProductSnapshot(clientId, client) {
  const account = clientAccounts[clientId];
  const inventory = await readRecoveryConversationInventory(clientId, client);
  const directTarget = clientId === 'android-alice'
    ? 'Bob'
    : clientId === 'desktop-bob'
      ? 'Alice'
      : 'Alice';
  const direct = await openRecoveryConversation(
    clientId,
    client,
    'friend',
    directTarget,
  );
  const group = await openRecoveryConversation(clientId, client, 'group');
  const social = await readRecoverySocialSnapshot(clientId, client);
  return {
    account: account.email,
    direct,
    group,
    inventory,
    social,
  };
}

function assertRecoveredProductSnapshot(clientId, before, after) {
  assertContract(
    before.account === after.account,
    'RECOVERY_ACTOR_CHANGED',
    `${clientId} recovered the wrong account`,
  );
  assertRecoveryIntersection(
    clientId,
    'Direct conversations',
    before.inventory.direct.map(({ id }) => id),
    after.inventory.direct.map(({ id }) => id),
  );
  assertRecoveryIntersection(
    clientId,
    'Group conversations',
    before.inventory.groups.map(({ id }) => id),
    after.inventory.groups.map(({ id }) => id),
  );
  assertRecoveryIntersection(
    clientId,
    'Direct messages',
    before.direct.messageIds,
    after.direct.messageIds,
  );
  assertRecoveryIntersection(
    clientId,
    'Group messages',
    before.group.messageIds,
    after.group.messageIds,
  );
  if (before.social.postIds.length > 0) {
    assertRecoveryIntersection(
      clientId,
      'Social posts',
      before.social.postIds,
      after.social.postIds,
    );
  } else {
    assertRecoveryIntersection(
      clientId,
      'Social post signatures',
      before.social.signatures,
      after.social.signatures,
    );
  }
  assertContract(
    before.social.detail && after.social.detail,
    'RECOVERY_SOCIAL_DETAIL_REQUIRED',
    `${clientId} did not recover Social detail`,
  );
  return {
    directMessagesRetained: assertRecoveryIntersection(
      clientId,
      'Direct history',
      before.direct.messageIds,
      after.direct.messageIds,
    ),
    groupMessagesRetained: assertRecoveryIntersection(
      clientId,
      'Group history',
      before.group.messageIds,
      after.group.messageIds,
    ),
  };
}

async function dismissTerminalCallSurface(clientId, client) {
  const state = await executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector('[data-chat-call-surface]');
          return {
            active: Boolean(surface),
            state: surface?.getAttribute('data-chat-call-state') || ''
          };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const buttons = surface ? [...surface.querySelectorAll('button')] : [];
          const close = buttons.find((button) => (
            /close/i.test(button.getAttribute('aria-label') || '')
          ));
          if (close) close.click();
          return {
            active: Boolean(surface) && !close,
            state: close ? 'terminal-dismissed' : surface ? 'active' : 'idle'
          };
        `,
  );
  assertContract(
    state?.active === false,
    'RECOVERY_STALE_CALL_SURFACE',
    `${clientId} retains call state ${state?.state || 'unknown'} after relaunch`,
  );
  if (state.state === 'terminal-dismissed') {
    await waitForUi(
      clientId,
      client,
      'dismissed terminal call',
      `
        return { ready: !document.querySelector('.mobile-call-surface') };
      `,
    );
  }
  return state;
}

async function startRecoveryAudioCall(clientId, client, friendlyName) {
  await openRecoveryConversation(
    clientId,
    client,
    'friend',
    friendlyName,
  );
  const started = await executeWebScript(
    client,
    `
      const buttons = [...document.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length);
      const target = buttons.find((button) => (
        /start audio call/i.test(
          button.getAttribute('aria-label')
          || button.getAttribute('title')
          || ''
        )
      ));
      if (!(target instanceof HTMLButtonElement) || target.disabled) {
        return false;
      }
      target.click();
      return true;
    `,
  );
  assertContract(
    started === true,
    'RECOVERY_CALL_CONTROL_MISSING',
    `${clientId} cannot start an audio call`,
  );
  return waitForUi(
    clientId,
    client,
    'outgoing recovery audio call',
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector('[data-chat-call-surface]');
          return {
            ready: surface?.getAttribute('data-chat-call-state') === 'outgoing'
          };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const text = surface?.innerText || '';
          return {
            ready: Boolean(surface?.getClientRects().length)
              && /calling|outgoing|ringing/i.test(text),
            text
          };
        `,
  );
}

async function answerRecoveryCall(clientId, client) {
  await waitForUi(
    clientId,
    client,
    'incoming recovery audio call',
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector(
            '[data-chat-call-surface][data-chat-call-state="incoming"]'
          );
          return { ready: Boolean(surface?.getClientRects().length) };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const button = [...(surface?.querySelectorAll('button') || [])]
            .find((entry) => /accept/i.test(
              entry.getAttribute('aria-label') || ''
            ));
          return { ready: Boolean(button) };
        `,
  );
  const answered = await executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector(
            '[data-chat-call-surface][data-chat-call-state="incoming"]'
          );
          const buttons = [...(surface?.querySelectorAll('button') || [])];
          const accept = buttons.find((button) => /accept/i.test(
            button.getAttribute('aria-label')
            || button.getAttribute('title')
            || ''
          )) || buttons.at(-1);
          if (!(accept instanceof HTMLElement)) return false;
          accept.click();
          return true;
        `
      : `
          const surface = document.querySelector('.mobile-call-surface');
          const accept = [...(surface?.querySelectorAll('button') || [])]
            .find((button) => /accept/i.test(
              button.getAttribute('aria-label') || ''
            ));
          if (!(accept instanceof HTMLElement)) return false;
          accept.click();
          return true;
        `,
  );
  assertContract(
    answered === true,
    'RECOVERY_CALL_ACCEPT_FAILED',
    `${clientId} could not answer the recovery call`,
  );
  return waitForUi(
    clientId,
    client,
    'connected recovery audio call',
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector('[data-chat-call-surface]');
          return {
            ready: surface?.getAttribute('data-chat-call-state') === 'active'
          };
        `
      : `
          const surface = document.querySelector('.mobile-call-surface.active');
          return { ready: Boolean(surface?.getClientRects().length) };
        `,
  );
}

async function endRecoveryCall(clientId, client) {
  const ended = await executeWebScript(
    client,
    client.platform === 'desktop'
      ? `
          const surface = document.querySelector(
            '[data-chat-call-surface][data-chat-call-state="active"]'
          );
          const buttons = [...(surface?.querySelectorAll('button') || [])];
          const hangup = buttons.find((button) => /hang up|hangup|end call/i.test(
            button.getAttribute('aria-label')
            || button.getAttribute('title')
            || ''
          )) || buttons.at(-1);
          if (!(hangup instanceof HTMLElement)) return false;
          hangup.click();
          return true;
        `
      : `
          const surface = document.querySelector('.mobile-call-surface.active');
          const hangup = [...(surface?.querySelectorAll('button') || [])]
            .find((button) => /end/i.test(
              button.getAttribute('aria-label') || ''
            ));
          if (!(hangup instanceof HTMLElement)) return false;
          hangup.click();
          return true;
        `,
  );
  assertContract(
    ended === true,
    'RECOVERY_CALL_END_FAILED',
    `${clientId} could not end the recovery call`,
  );
}

async function runRecoveryPhase(manifest, evidenceDir, preflight) {
  const interactionTrace = [];
  const sequenceRef = { value: 0 };
  const before = {};
  const step = async (clientId, stepId, action) => {
    const client = manifest.clients[clientId];
    await activateForegroundClient(clientId, client);
    return withWebContext(client, async () => {
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
    });
  };

  for (const clientId of requiredClientIds) {
    await step(clientId, 'recovery-authenticated-precondition', () => (
      ensureAuthenticated(
        clientId,
        manifest.clients[clientId],
        manifest.stationUrl,
      )
    ));
    const observation = await step(
      clientId,
      'recovery-before-relaunch',
      () => readRecoveryProductSnapshot(
        clientId,
        manifest.clients[clientId],
      ),
    );
    before[clientId] = observation.result;
  }

  for (const clientId of requiredClientIds) {
    await step(
      clientId,
      'recovery-native-relaunch',
      () => relaunchClient(
        clientId,
        manifest.clients[clientId],
        evidenceDir,
      ),
    );
  }

  for (const clientId of requiredClientIds) {
    await step(clientId, 'recovery-session-identity', async () => {
      await ensureAuthenticated(
        clientId,
        manifest.clients[clientId],
        manifest.stationUrl,
      );
      const identity = await verifyAuthenticatedActor(
        clientId,
        manifest.clients[clientId],
      );
      await dismissTerminalCallSurface(
        clientId,
        manifest.clients[clientId],
      );
      return identity;
    });
    await step(clientId, 'recovery-chat-social-visible', async () => {
      const after = await readRecoveryProductSnapshot(
        clientId,
        manifest.clients[clientId],
      );
      return {
        after,
        retained: assertRecoveredProductSnapshot(
          clientId,
          before[clientId],
          after,
        ),
      };
    });
  }

  await step(
    'android-alice',
    'recovery-fresh-audio-call-start',
    () => startRecoveryAudioCall(
      'android-alice',
      manifest.clients['android-alice'],
      'Bob',
    ),
  );
  await step(
    'desktop-bob',
    'recovery-fresh-audio-call-answer',
    () => answerRecoveryCall(
      'desktop-bob',
      manifest.clients['desktop-bob'],
    ),
  );
  await step(
    'desktop-bob',
    'recovery-fresh-audio-call-end',
    async () => {
      await endRecoveryCall(
        'desktop-bob',
        manifest.clients['desktop-bob'],
      );
      return { ended: true };
    },
  );
  for (const clientId of requiredClientIds) {
    await step(
      clientId,
      'recovery-call-terminal-idle',
      () => dismissTerminalCallSurface(
        clientId,
        manifest.clients[clientId],
      ),
    );
  }

  const report = {
    kind: 'peers-touch-three-client-product-journey-result',
    schemaVersion: 1,
    phase: 'recovery',
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
    scenariosForPhase(matrix, 'contacts').length === 2,
    'SELF_TEST_CONTACTS_COUNT',
    'contacts phase scenario count changed unexpectedly',
  );
  assertContract(
    scenariosForPhase(matrix, 'all').length === matrixSummary.scenarioCount,
    'SELF_TEST_ALL_COUNT',
    'all phase does not include every scenario',
  );
  assertContract(
    scenariosForPhase(matrix, 'recovery').length === 2,
    'SELF_TEST_RECOVERY_COUNT',
    'recovery phase scenario count changed unexpectedly',
  );
  assertContract(
    normalizeRecoveryText('  one\n two  ') === 'one two',
    'SELF_TEST_RECOVERY_TEXT',
    'recovery text normalization is invalid',
  );
  assertContract(
    assertRecoveryIntersection(
      'self-test',
      'values',
      ['one', 'two'],
      ['two', 'three'],
    )[0] === 'two',
    'SELF_TEST_RECOVERY_INTERSECTION',
    'recovery state intersection is invalid',
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
  assertContract(
    retryableStaleElementError(new JourneyContractError(
      'WEBDRIVER_REQUEST_FAILED',
      'WebDriver 404: stale element reference',
    )) === true
      && retryableStaleElementError(new JourneyContractError(
        'WEBDRIVER_REQUEST_FAILED',
        'WebDriver 404: no such element',
      )) === false,
    'SELF_TEST_STALE_ELEMENT_RETRY',
    'stale element retry classification is invalid',
  );
  const readyImageDraft = selectNewReadyAttachmentDraft({
    drafts: [
      {
        id: 'prior-ready',
        status: 'ready',
        text: 'Image 68 B',
        visible: true,
      },
      {
        id: 'new-uploading',
        status: 'uploading',
        text: 'Image 68 B',
        visible: true,
      },
      {
        id: 'new-ready',
        status: 'ready',
        text: 'Image 68 B',
        visible: true,
      },
    ],
  }, ['prior-ready']);
  assertContract(
    readyImageDraft?.id === 'new-ready',
    'SELF_TEST_ATTACHMENT_DRAFT_IDENTITY',
    'attachment draft readiness must require a new visible ready draft',
  );
  assertFriendlyLoginRecovery('self-test', 'Login failed');
  let internalLoginDetailRejected = false;
  try {
    assertFriendlyLoginRecovery(
      'self-test',
      'Access gate submit failed: station returned 400',
    );
  } catch (error) {
    internalLoginDetailRejected = error instanceof JourneyContractError
      && error.code === 'ENTRY_LOGIN_RECOVERY_INTERNAL_DETAIL';
  }
  assertContract(
    internalLoginDetailRejected,
    'SELF_TEST_LOGIN_RECOVERY_COPY',
    'internal login failure detail was not rejected',
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
  if (!['entry', 'shell', 'contacts', 'chat', 'recovery'].includes(options.phase)) {
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
    : options.phase === 'shell'
      ? await runShellPhase(manifest, evidenceDir, preflight)
      : options.phase === 'contacts'
        ? await runContactsPhase(manifest, evidenceDir, preflight)
        : options.phase === 'chat'
          ? await runChatPhase(manifest, evidenceDir, preflight)
          : await runRecoveryPhase(manifest, evidenceDir, preflight);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const code = error instanceof JourneyContractError
    ? error.code
    : 'UNEXPECTED_FAILURE';
  process.stderr.write(`FAIL ${code}: ${error.message}\n`);
  process.exitCode = 1;
});
