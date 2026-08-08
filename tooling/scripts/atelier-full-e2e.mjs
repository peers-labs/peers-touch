#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseDesktopLaunchSpec,
  parseProviderProfile,
  redactRuntimeInputValues,
  runtimeInputs,
  sanitizeRuntimeInputStatus,
  validateRuntimeInput,
} from './atelier-full-e2e-runtime-inputs.mjs';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = process.env.PEERS_ATELIER_FULL_E2E_EVIDENCE_PATH
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_EVIDENCE_PATH)
  : path.join(evidenceDir, 'atelier-full-e2e.json');
const preflightPath = process.env.PEERS_ATELIER_FULL_E2E_PREFLIGHT_PATH
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_PREFLIGHT_PATH)
  : path.join(evidenceDir, 'atelier-full-e2e-preflight.json');
const desktopReadyEvidencePath = process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE)
  : path.join(evidenceDir, 'atelier-full-e2e-desktop-ready.json');
const workspaceOpenEvidencePath = process.env.PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE)
  : path.join(evidenceDir, 'atelier-full-e2e-workspace-open.json');
const ideLaunchEvidencePath = process.env.PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE)
  : path.join(evidenceDir, 'atelier-full-e2e-ide-launch.json');
const providerRuntimeEvidencePath = process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE)
  : path.join(evidenceDir, 'atelier-full-e2e-provider-runtime.json');
const atelierManifestPath = path.resolve('apps/applets/atelier/applet.manifest.json');

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'full E2E entrypoint fails closed when required real runtime inputs are missing',
    'full E2E cannot be counted as passing evidence until the real runtime path writes ok=true',
    'missing runtime inputs remain explicit and machine-readable',
    'when runtime inputs are present, Desktop Host launch must use a bounded non-shell child process before any full E2E claim',
    'Desktop Host readiness evidence must be current-launch scoped and prove peers.atelier service binding/product-window semantics before the runner advances',
    'when Desktop Host is ready, Station-owned Atelier routes must pass authenticated Host service-binding handshakes through applets_invoke before any full E2E claim',
    'post-ready applet action evidence must be current-launch scoped before UI/IDE/provider runtime automation can claim progress',
    'real IDE launch evidence must be a separate current-launch Desktop Host proof and cannot be inferred from workspace.open Host intent acceptance',
    'production provider/runtime quality evidence must be a separate Station-owned proof before full E2E can pass',
  ],
  doesNotProve: [
    'full Host + Station + applet E2E',
    'real IDE launch',
    'production provider/model/runtime quality',
    'global Atelier readiness',
  ],
};

const finalProofObligations = [
  {
    id: 'full-host-station-applet-e2e',
    status: 'MISSING',
    requiredEvidence:
      'Run the official peers.atelier package through the real Desktop Host product shell/window against a real Station service binding and record task creation, projection replay, decision resolve, artifact/body/preview, cleanup, and auth/error behavior.',
  },
  {
    id: 'post-ready-applet-ui-actions',
    status: 'MISSING',
    requiredEvidence:
      'After Desktop ready evidence, prove current-launch applet UI actions reached Desktop Host, starting with atelier.workspace.open action evidence bound to launchId/sessionId/taskId/workspaceUri/IDE target.',
  },
  {
    id: 'real-ide-launch',
    status: 'MISSING',
    requiredEvidence:
      'Produce independent atelier-full-e2e-ide-launch.json evidence from the real Desktop Host workspace resolver proving IDE launch for atelier.workspace.open.',
  },
  {
    id: 'production-provider-runtime-quality',
    status: 'MISSING',
    requiredEvidence:
      'Produce independent atelier-full-e2e-provider-runtime.json Station-owned evidence for the configured provider profileRef, proving provider runtime, model quality, streaming UX, artifact persistence, and trace/checkpoint/resume without applet execution exposure.',
  },
];

function stopChildProcess(child, signal = 'SIGTERM') {
  if (!child || child.killed || !child.pid) {
    return;
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process already exited.
    }
  }
}

function assertString(value, message) {
  assert.equal(typeof value, 'string', message);
  assert.ok(value.trim(), message);
}

function redactedErrorMessage(error) {
  return redactRuntimeInputValues(error instanceof Error ? error.message : String(error));
}

function runtimeInputHash(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function assertDesktopReadyEvidence(ready, { launchId, stationUrl }) {
  assert.equal(typeof ready, 'object', 'Desktop Host readiness evidence must be an object');
  assert.notEqual(ready, null, 'Desktop Host readiness evidence must be an object');
  assert.equal(Array.isArray(ready), false, 'Desktop Host readiness evidence must be an object');
  assert.equal(ready.ok, true, 'Desktop Host readiness evidence must be ok=true');
  assert.equal(ready.launchId, launchId, 'Desktop Host readiness evidence must match current launchId');
  assert.equal(ready.appletId, 'peers.atelier', 'Desktop Host readiness evidence must prove peers.atelier');
  assertString(ready.sessionId, 'Desktop Host readiness evidence must include sessionId');
  assert.equal(ready.readiness, 'NOT_READY', 'Desktop Host readiness evidence must not claim global readiness');
  assert.equal(ready.globalReady, false, 'Desktop Host readiness evidence must preserve globalReady=false');

  assert.equal(typeof ready.serviceBinding, 'object', 'Desktop Host readiness evidence must include serviceBinding object');
  assert.notEqual(ready.serviceBinding, null, 'Desktop Host readiness evidence must include serviceBinding object');
  assert.equal(ready.serviceBinding.service, 'atelier', 'Desktop Host readiness evidence must bind service=atelier');
  assert.equal(ready.serviceBinding.transport, 'sdk.network.request', 'Desktop Host readiness evidence must prove sdk.network.request service binding transport');
  assert.equal(ready.serviceBinding.stationUrlRedacted, true, 'Desktop Host readiness evidence must redact the configured Station URL');
  assert.equal(ready.serviceBinding.stationUrlHash, runtimeInputHash(stationUrl), 'Desktop Host readiness evidence must prove the configured Station URL by hash');
  assert.equal(ready.serviceBinding.stationPathPrefix, '/applets/atelier/v1', 'Desktop Host readiness evidence must prove Station Atelier path prefix');

  assert.equal(typeof ready.productShell, 'object', 'Desktop Host readiness evidence must include productShell object');
  assert.notEqual(ready.productShell, null, 'Desktop Host readiness evidence must include productShell object');
  assert.equal(ready.productShell.kind, 'desktop_host_product_shell', 'Desktop Host readiness evidence must prove Desktop product shell');
  assert.equal(ready.productShell.appletId, 'peers.atelier', 'Desktop Host readiness evidence product shell must target peers.atelier');

  assert.equal(typeof ready.productWindow, 'object', 'Desktop Host readiness evidence must include productWindow object');
  assert.notEqual(ready.productWindow, null, 'Desktop Host readiness evidence must include productWindow object');
  assert.equal(ready.productWindow.kind, 'desktop_product_window', 'Desktop Host readiness evidence must prove Desktop product window');
  assert.equal(ready.productWindow.appletId, 'peers.atelier', 'Desktop Host readiness evidence product window must target peers.atelier');
  assert.equal(ready.productWindow.mounted, true, 'Desktop Host readiness evidence must prove peers.atelier mounted in the product window');

  assertString(ready.completedAt, 'Desktop Host readiness evidence must include completedAt timestamp');
}

function assertWorkspaceOpenActionEvidence(evidence, { launchId, sessionId, ideTarget }) {
  assert.equal(typeof evidence, 'object', 'workspace open action evidence must be an object');
  assert.notEqual(evidence, null, 'workspace open action evidence must be an object');
  assert.equal(Array.isArray(evidence), false, 'workspace open action evidence must be an object');
  assert.equal(evidence.ok, true, 'workspace open action evidence must be ok=true');
  assert.equal(evidence.launchId, launchId, 'workspace open action evidence must match current launchId');
  assert.equal(evidence.appletId, 'peers.atelier', 'workspace open action evidence must prove peers.atelier');
  assert.equal(evidence.sessionId, sessionId, 'workspace open action evidence must match Desktop ready sessionId');
  assert.equal(evidence.action, 'atelier.workspace.open', 'workspace open action evidence must prove atelier.workspace.open action');
  assert.equal(evidence.accepted, true, 'workspace open action evidence must prove Host accepted the action');
  assert.equal(evidence.mode, 'host_intent', 'workspace open action evidence must remain a Host intent');
  assert.equal(evidence.hostSideEffect, 'workspace_open_intent', 'workspace open action evidence must preserve Host intent side effect');
  assert.equal(evidence.realIdeLaunchProven, false, 'workspace open action evidence must not claim real IDE launch');
  assert.equal(evidence.ideHintRedacted, true, 'workspace open action evidence must redact configured IDE target');
  assert.equal(evidence.ideTargetHash, runtimeInputHash(ideTarget), 'workspace open action evidence must match configured IDE target by hash');
  assertString(evidence.taskId, 'workspace open action evidence must include taskId');
  assertString(evidence.workspaceUri, 'workspace open action evidence must include workspaceUri');
  const parsed = new URL(evidence.workspaceUri);
  assert.equal(parsed.protocol, 'pt-workspace:', 'workspace open action evidence must use pt-workspace URI');
  assert.equal(parsed.hostname, 'task', 'workspace open action evidence must use pt-workspace://task/<taskId>');
  assert.equal(parsed.pathname, `/${encodeURIComponent(evidence.taskId)}`, 'workspace open action evidence task path must match taskId');
  assert.equal(parsed.searchParams.has('workspace'), true, 'workspace open action evidence must include workspace query');
  assertString(evidence.completedAt, 'workspace open action evidence must include completedAt timestamp');
}

function assertRealIdeLaunchEvidence(evidence, { launchId, sessionId, workspaceOpen, ideTarget }) {
  assert.equal(typeof evidence, 'object', 'real IDE launch evidence must be an object');
  assert.notEqual(evidence, null, 'real IDE launch evidence must be an object');
  assert.equal(Array.isArray(evidence), false, 'real IDE launch evidence must be an object');
  assert.equal(evidence.ok, true, 'real IDE launch evidence must be ok=true');
  assert.equal(evidence.launchId, launchId, 'real IDE launch evidence must match current launchId');
  assert.equal(evidence.appletId, 'peers.atelier', 'real IDE launch evidence must prove peers.atelier');
  assert.equal(evidence.sessionId, sessionId, 'real IDE launch evidence must match Desktop ready sessionId');
  assert.equal(evidence.action, 'atelier.workspace.open', 'real IDE launch evidence must be bound to atelier.workspace.open');
  assert.equal(evidence.taskId, workspaceOpen.taskId, 'real IDE launch evidence taskId must match workspace.open action');
  assert.equal(evidence.workspaceUri, workspaceOpen.workspaceUri, 'real IDE launch evidence workspaceUri must match workspace.open action');
  assert.equal(evidence.ideTargetRedacted, true, 'real IDE launch evidence must redact configured IDE target');
  assert.equal(evidence.ideTargetHash, runtimeInputHash(ideTarget), 'real IDE launch evidence must match configured IDE target by hash');
  assert.equal(evidence.realIdeLaunchProven, true, 'real IDE launch evidence must explicitly prove real IDE launch');
  assert.equal(evidence.launchOwner, 'desktop_host', 'real IDE launch evidence must be owned by Desktop Host');
  assertString(evidence.resolver, 'real IDE launch evidence must include workspace resolver');
  assertString(evidence.launchCommand, 'real IDE launch evidence must include launch command identifier');
  assert.equal(evidence.appletFileShellExecuteExposed, false, 'real IDE launch evidence must not expose file/shell/execute to applet');
  assert.equal(evidence.appletOpenExternalUrlExposed, false, 'real IDE launch evidence must not expose openExternalUrl to applet');
  assertString(evidence.completedAt, 'real IDE launch evidence must include completedAt timestamp');
}

function assertProviderRuntimeEvidence(evidence, { launchId, sessionId, providerProfile }) {
  assert.equal(typeof evidence, 'object', 'provider/runtime evidence must be an object');
  assert.notEqual(evidence, null, 'provider/runtime evidence must be an object');
  assert.equal(Array.isArray(evidence), false, 'provider/runtime evidence must be an object');
  assert.equal(evidence.ok, true, 'provider/runtime evidence must be ok=true');
  assert.equal(evidence.launchId, launchId, 'provider/runtime evidence must match current launchId');
  assert.equal(evidence.appletId, 'peers.atelier', 'provider/runtime evidence must prove peers.atelier');
  assert.equal(evidence.sessionId, sessionId, 'provider/runtime evidence must match Desktop ready sessionId');
  assert.equal(evidence.owner, 'station', 'provider/runtime evidence must be Station-owned');
  assert.equal(evidence.scope, 'production-provider-runtime', 'provider/runtime evidence must use production-provider-runtime scope');
  assert.equal(evidence.providerProfileRefRedacted, true, 'provider/runtime evidence must redact provider profile ref');
  assert.equal(evidence.providerProfileRefHash, runtimeInputHash(providerProfile.profileRef), 'provider/runtime evidence must match provider profile ref by hash');
  assert.equal(evidence.providerRuntimeProven, true, 'provider/runtime evidence must prove provider runtime');
  assert.equal(evidence.providerModelQualityProven, true, 'provider/runtime evidence must prove provider model quality');
  assert.equal(evidence.streamingReplyUXProven, true, 'provider/runtime evidence must prove streaming reply UX');
  assert.equal(evidence.artifactPersistenceProven, true, 'provider/runtime evidence must prove artifact persistence');
  assert.equal(evidence.traceCheckpointResumeProven, true, 'provider/runtime evidence must prove trace/checkpoint/resume');
  assert.equal(evidence.appletProviderInvokeExposed, false, 'provider/runtime evidence must not expose provider invoke to applet');
  assert.equal(evidence.appletRuntimeExecuteExposed, false, 'provider/runtime evidence must not expose runtime execute to applet');
  assert.equal(evidence.appletArtifactWriteExposed, false, 'provider/runtime evidence must not expose artifact writes to applet');
  assert.equal(evidence.appletTraceCheckpointResumeExposed, false, 'provider/runtime evidence must not expose Trace/Checkpoint/Resume to applet');
  assertString(evidence.completedAt, 'provider/runtime evidence must include completedAt timestamp');
}

async function waitForChildExitOrReady(child, readyPath, timeoutMs, readinessContext) {
  const deadline = Date.now() + timeoutMs;
  let exitRecord = null;
  child.once('exit', (code, signal) => {
    exitRecord = { code, signal };
  });
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) {
      const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
      assertDesktopReadyEvidence(ready, readinessContext);
      return { status: 'READY', ready };
    }
    if (exitRecord) {
      return { status: 'EXITED', ...exitRecord };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { status: 'TIMEOUT' };
}

async function runDesktopHostLaunchProbe() {
  const launch = parseDesktopLaunchSpec(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_APP);
  const timeoutMs = Number(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_TIMEOUT_MS ?? 30_000);
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000, 'PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_TIMEOUT_MS must be 1..300000');
  const launchId = randomUUID();
  if (existsSync(desktopReadyEvidencePath)) {
    rmSync(desktopReadyEvidencePath);
  }
  if (existsSync(workspaceOpenEvidencePath)) {
    rmSync(workspaceOpenEvidencePath);
  }
  if (existsSync(ideLaunchEvidencePath)) {
    rmSync(ideLaunchEvidencePath);
  }
  if (existsSync(providerRuntimeEvidencePath)) {
    rmSync(providerRuntimeEvidencePath);
  }

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PEERS_ATELIER_FULL_E2E: '1',
      PEERS_ATELIER_FULL_E2E_APPLET_ID: 'peers.atelier',
      PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID: launchId,
      PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE: desktopReadyEvidencePath,
      PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE: workspaceOpenEvidencePath,
      PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE: ideLaunchEvidencePath,
      PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE: providerRuntimeEvidencePath,
      PEERS_STATION_URL: process.env.PEERS_ATELIER_FULL_E2E_STATION_URL,
      PEERS_APPLET_SERVICE_ATELIER: process.env.PEERS_ATELIER_FULL_E2E_STATION_URL,
      PEERS_APPLET_SERVICE_STATION_API: process.env.PEERS_ATELIER_FULL_E2E_STATION_URL,
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const result = await waitForChildExitOrReady(child, desktopReadyEvidencePath, timeoutMs, {
      launchId,
      stationUrl: process.env.PEERS_ATELIER_FULL_E2E_STATION_URL,
    });
    if (result.status === 'READY') {
      return {
        status: 'PASS',
        launchKind: launch.kind,
        commandRedacted: true,
        argsCount: launch.args.length,
        readyEvidencePath: path.relative(process.cwd(), desktopReadyEvidencePath),
        readyEvidence: {
          launchId: result.ready.launchId,
          sessionId: result.ready.sessionId,
          appletId: result.ready.appletId,
          service: result.ready.serviceBinding.service,
          transport: result.ready.serviceBinding.transport,
          stationUrlRedacted: result.ready.serviceBinding.stationUrlRedacted,
          stationUrlMatchesConfigured:
            result.ready.serviceBinding.stationUrlHash === runtimeInputHash(process.env.PEERS_ATELIER_FULL_E2E_STATION_URL),
          productShell: result.ready.productShell.kind,
          productWindow: result.ready.productWindow.kind,
          mounted: result.ready.productWindow.mounted,
        },
      };
    }
    throw new Error(`Desktop Host launch did not produce readiness evidence: ${JSON.stringify({
      status: result.status,
      code: result.code,
      signal: result.signal,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-2000),
    })}`);
  } finally {
    stopChildProcess(child, 'SIGTERM');
    setTimeout(() => stopChildProcess(child, 'SIGKILL'), 5_000).unref();
  }
}

function readWorkspaceOpenActionEvidence(desktopLaunch) {
  assert.ok(existsSync(workspaceOpenEvidencePath), `missing post-ready applet action evidence: ${workspaceOpenEvidencePath}`);
  const evidence = JSON.parse(readFileSync(workspaceOpenEvidencePath, 'utf8'));
  assertWorkspaceOpenActionEvidence(evidence, {
    launchId: desktopLaunch.readyEvidence.launchId,
    sessionId: desktopLaunch.readyEvidence.sessionId,
    ideTarget: process.env.PEERS_ATELIER_FULL_E2E_IDE,
  });
  return {
    path: path.relative(process.cwd(), workspaceOpenEvidencePath),
    status: 'PASS',
    action: evidence.action,
    taskId: evidence.taskId,
    workspaceUri: evidence.workspaceUri,
    ideHintRedacted: true,
    ideTargetMatchesConfigured: evidence.ideTargetHash === runtimeInputHash(process.env.PEERS_ATELIER_FULL_E2E_IDE),
    mode: evidence.mode,
    accepted: evidence.accepted,
    opened: evidence.opened,
    realIdeLaunchProven: evidence.realIdeLaunchProven === true,
  };
}

function readRealIdeLaunchEvidence(desktopLaunch, workspaceOpenAction) {
  assert.ok(existsSync(ideLaunchEvidencePath), `missing real IDE launch evidence: ${ideLaunchEvidencePath}`);
  const evidence = JSON.parse(readFileSync(ideLaunchEvidencePath, 'utf8'));
  assertRealIdeLaunchEvidence(evidence, {
    launchId: desktopLaunch.readyEvidence.launchId,
    sessionId: desktopLaunch.readyEvidence.sessionId,
    workspaceOpen: workspaceOpenAction,
    ideTarget: process.env.PEERS_ATELIER_FULL_E2E_IDE,
  });
  return {
    path: path.relative(process.cwd(), ideLaunchEvidencePath),
    status: 'PASS',
    action: evidence.action,
    taskId: evidence.taskId,
    workspaceUri: evidence.workspaceUri,
    ideTargetRedacted: true,
    ideTargetMatchesConfigured: evidence.ideTargetHash === runtimeInputHash(process.env.PEERS_ATELIER_FULL_E2E_IDE),
    resolver: evidence.resolver,
    launchOwner: evidence.launchOwner,
    realIdeLaunchProven: evidence.realIdeLaunchProven,
  };
}

function readProviderRuntimeEvidence(desktopLaunch) {
  assert.ok(existsSync(providerRuntimeEvidencePath), `missing provider/runtime quality evidence: ${providerRuntimeEvidencePath}`);
  const providerProfile = parseProviderProfile(
    process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE,
    'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
  );
  const evidence = JSON.parse(readFileSync(providerRuntimeEvidencePath, 'utf8'));
  assertProviderRuntimeEvidence(evidence, {
    launchId: desktopLaunch.readyEvidence.launchId,
    sessionId: desktopLaunch.readyEvidence.sessionId,
    providerProfile,
  });
  return {
    path: path.relative(process.cwd(), providerRuntimeEvidencePath),
    status: 'PASS',
    owner: evidence.owner,
    scope: evidence.scope,
    providerProfileRefRedacted: true,
    providerProfileRefMatchesConfigured: evidence.providerProfileRefHash === runtimeInputHash(providerProfile.profileRef),
    providerRuntimeProven: evidence.providerRuntimeProven,
    providerModelQualityProven: evidence.providerModelQualityProven,
    streamingReplyUXProven: evidence.streamingReplyUXProven,
    artifactPersistenceProven: evidence.artifactPersistenceProven,
    traceCheckpointResumeProven: evidence.traceCheckpointResumeProven,
  };
}

function desktopGatewayUrl() {
  const configured = process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_GATEWAY_URL?.trim();
  if (configured) {
    const parsed = new URL(configured);
    assert.ok(['http:', 'https:'].includes(parsed.protocol), 'PEERS_ATELIER_FULL_E2E_DESKTOP_GATEWAY_URL must be http(s)');
    return parsed;
  }
  const port = process.env.PT_GATEWAY_PORT?.trim() || '3030';
  assert.match(port, /^\d+$/, 'PT_GATEWAY_PORT must be numeric when used by Atelier full E2E');
  return new URL(`http://127.0.0.1:${port}/`);
}

async function invokeDesktopGateway(cmd, args) {
  const timeoutMs = Number(process.env.PEERS_ATELIER_FULL_E2E_HANDSHAKE_TIMEOUT_MS ?? 10_000);
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, 'PEERS_ATELIER_FULL_E2E_HANDSHAKE_TIMEOUT_MS must be 1..60000');

  const url = desktopGatewayUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cmd, args }),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error(`${cmd} returned non-JSON body with status ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`${cmd} failed with HTTP status ${response.status}: ${JSON.stringify(json)}`);
    }
    if (json?.ok !== true) {
      const message = json?.error?.message || json?.error || JSON.stringify(json);
      throw new Error(`${cmd} failed: ${message}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function gatewayManifest() {
  const manifest = readJson(atelierManifestPath);
  return {
    id: manifest.id,
    permissions: manifest.permissions,
    services: manifest.services,
    skills: manifest.skills ?? [],
  };
}

async function invokeHostServiceBindingJson(desktopLaunch, pathName, { method = 'GET', body } = {}) {
  const result = await invokeDesktopGateway('applets_invoke', {
    id: 'peers.atelier',
    sessionId: desktopLaunch.readyEvidence.sessionId,
    capability: 'network',
    action: 'request',
    params: {
      service: 'atelier',
      path: pathName,
      method,
      ...(body === undefined ? {} : { body }),
    },
    manifest: gatewayManifest(),
  });
  const payload = result.data?.status;
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  assert.equal(typeof parsed, 'object', `applets_invoke ${method} ${pathName} must return JSON object status`);
  assert.notEqual(parsed, null, `applets_invoke ${method} ${pathName} must return JSON object status`);
  assert.equal(parsed.status, 200, `applets_invoke ${method} ${pathName} must return HTTP 200 through service binding`);
  return parsed.body;
}

function assertWorkspaceSnapshot(value) {
  assert.equal(typeof value, 'object', 'workspace response must be an object');
  assert.notEqual(value, null, 'workspace response must be an object');
  assert.equal(typeof value.workspace, 'object', 'workspace response must include workspace object');
  assert.notEqual(value.workspace, null, 'workspace response must include workspace object');
  assert.ok(Array.isArray(value.workspace.tasks), 'workspace.tasks must be an array');
  assert.equal(typeof value.selectedTaskId, 'string', 'workspace response must include selectedTaskId string');
}

function assertProviderCapabilities(value) {
  assert.equal(typeof value, 'object', 'provider capabilities response must be an object');
  assert.notEqual(value, null, 'provider capabilities response must be an object');
  assert.equal(value.source, 'station.provider.capabilities', 'provider capabilities must be Station-owned');
  assert.ok(Array.isArray(value.capabilities), 'provider capabilities must include capabilities array');
  for (const capability of value.capabilities) {
    assert.equal(capability.scope, 'station-provider', 'provider capability scope must remain station-provider');
    assert.equal(capability.readOnly, true, 'provider capability discovery must remain read-only');
  }
}

async function runReadOnlyHostServiceBindingHandshakes(desktopLaunch) {
  const workspace = await invokeHostServiceBindingJson(desktopLaunch, '/v1/workspace');
  assertWorkspaceSnapshot(workspace);
  const providerProfile = parseProviderProfile(
    process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE,
    'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
  );
  const providerCapabilities = await invokeHostServiceBindingJson(desktopLaunch, '/v1/provider/capabilities', {
    method: 'POST',
    body: {
      fullE2ELaunchId: desktopLaunch.readyEvidence.launchId,
      fullE2ESessionId: desktopLaunch.readyEvidence.sessionId,
      fullE2EProviderProfileRef: providerProfile.profileRef,
    },
  });
  assertProviderCapabilities(providerCapabilities);
  return {
    stationWorkspace: {
      path: '/applets/atelier/v1/workspace',
      publicPath: '/v1/workspace',
      method: 'GET',
      status: 'PASS',
      transport: 'desktop_host.applets_invoke.network.request',
      taskCount: workspace.workspace.tasks.length,
      selectedTaskId: workspace.selectedTaskId,
    },
    providerCapabilities: {
      path: '/applets/atelier/v1/provider/capabilities',
      publicPath: '/v1/provider/capabilities',
      method: 'POST',
      status: 'PASS',
      transport: 'desktop_host.applets_invoke.network.request',
      count: providerCapabilities.capabilities.length,
      source: providerCapabilities.source,
    },
  };
}

function readJson(filePath) {
  assert.ok(existsSync(filePath), `missing prerequisite evidence: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeEvidence(document) {
  const finalDocument = document.ok === false
    ? {
        ...document,
        finalProofObligations,
        missingFinalEvidence: finalProofObligations,
      }
    : document;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(finalDocument, null, 2)}\n`);
}

function clearStaleFinalSideEvidence() {
  const cleared = [];
  for (const filePath of [
    desktopReadyEvidencePath,
    workspaceOpenEvidencePath,
    ideLaunchEvidencePath,
    providerRuntimeEvidencePath,
  ]) {
    if (existsSync(filePath)) {
      rmSync(filePath);
      cleared.push(path.relative(process.cwd(), filePath));
    }
  }
  return cleared;
}

function validatePreflight() {
  const preflight = readJson(preflightPath);
  assert.equal(preflight.ok, true, 'atelier-full-e2e-preflight evidence must be ok=true');
  assert.equal(preflight.readiness, 'NOT_READY', 'atelier-full-e2e-preflight must preserve readiness=NOT_READY');
  assert.equal(preflight.globalReady, false, 'atelier-full-e2e-preflight must preserve globalReady=false');
  return preflight;
}

function preflightSourceInstrumentationGaps(preflight) {
  return Array.isArray(preflight.sourceInstrumentationGaps)
    ? preflight.sourceInstrumentationGaps
    : [];
}

async function main() {
  const startedAt = new Date().toISOString();
  const preflight = validatePreflight();
  const sourceInstrumentationGaps = preflightSourceInstrumentationGaps(preflight);
  const runtimeInputStatus = runtimeInputs.map((input) => sanitizeRuntimeInputStatus(validateRuntimeInput(input)));
  const missingRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'MISSING');
  const invalidRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'INVALID');
  const presentRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'PRESENT');

  if (missingRuntimeInputs.length > 0) {
    const staleFinalSideEvidenceCleared = clearStaleFinalSideEvidence();
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'MISSING_RUNTIME_INPUTS',
      missingRuntimeInputs,
      invalidRuntimeInputs,
      presentRuntimeInputs,
      sourceInstrumentationGaps,
      staleFinalSideEvidenceCleared,
      preflight: {
        path: path.relative(process.cwd(), preflightPath),
        ok: preflight.ok,
        readiness: preflight.readiness,
        globalReady: preflight.globalReady,
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E missing runtime inputs: ${missingRuntimeInputs.map((input) => input.env).join(', ')}`);
  }

  if (invalidRuntimeInputs.length > 0) {
    const staleFinalSideEvidenceCleared = clearStaleFinalSideEvidence();
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'INVALID_RUNTIME_INPUTS',
      missingRuntimeInputs,
      invalidRuntimeInputs,
      presentRuntimeInputs,
      sourceInstrumentationGaps,
      staleFinalSideEvidenceCleared,
      preflight: {
        path: path.relative(process.cwd(), preflightPath),
        ok: preflight.ok,
        readiness: preflight.readiness,
        globalReady: preflight.globalReady,
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E invalid runtime inputs: ${invalidRuntimeInputs.map((input) => input.env).join(', ')}`);
  }

  if (sourceInstrumentationGaps.length > 0) {
    const staleFinalSideEvidenceCleared = clearStaleFinalSideEvidence();
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'SOURCE_INSTRUMENTATION_GAPS',
      missingRuntimeInputs,
      invalidRuntimeInputs,
      presentRuntimeInputs,
      sourceInstrumentationGaps,
      staleFinalSideEvidenceCleared,
      preflight: {
        path: path.relative(process.cwd(), preflightPath),
        ok: preflight.ok,
        readiness: preflight.readiness,
        globalReady: preflight.globalReady,
      },
      requiredNextStep:
        'Wire Desktop Host real IDE launch side evidence and Station provider/runtime side evidence producers before launching full E2E runtime probes.',
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E source instrumentation gaps: ${sourceInstrumentationGaps.map((gap) => gap.id).join(', ')}`);
  }

  let desktopLaunch = {};
  try {
    desktopLaunch = await runDesktopHostLaunchProbe();
  } catch (error) {
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'DESKTOP_HOST_LAUNCH_FAILED',
      presentRuntimeInputs,
      desktopLaunch: {
        status: 'FAIL',
        reason: redactedErrorMessage(error),
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E Desktop Host launch failed: ${redactedErrorMessage(error)}`);
  }

  let runtimeHandshakes = {};
  try {
    runtimeHandshakes = await runReadOnlyHostServiceBindingHandshakes(desktopLaunch);
  } catch (error) {
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'STATION_HANDSHAKE_FAILED',
      presentRuntimeInputs,
      desktopLaunch,
      runtimeHandshakes: {
        hostServiceBindingReadOnlyRoutes: {
          status: 'FAIL',
          reason: redactedErrorMessage(error),
        },
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E Host service-binding handshake failed: ${redactedErrorMessage(error)}`);
  }

  let workspaceOpenAction = {};
  try {
    workspaceOpenAction = readWorkspaceOpenActionEvidence(desktopLaunch);
  } catch (error) {
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'APPLET_UI_ACTIONS_NOT_PROVEN',
      presentRuntimeInputs,
      runtimeHandshakes,
      desktopLaunch,
      postReadyActions: {
        workspaceOpen: {
          status: 'FAIL',
          reason: redactedErrorMessage(error),
        },
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E applet UI actions not proven: ${redactedErrorMessage(error)}`);
  }

  let ideLaunch = {};
  try {
    ideLaunch = readRealIdeLaunchEvidence(desktopLaunch, workspaceOpenAction);
  } catch (error) {
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'REAL_IDE_LAUNCH_NOT_PROVEN',
      presentRuntimeInputs,
      runtimeHandshakes,
      desktopLaunch,
      postReadyActions: {
        workspaceOpen: workspaceOpenAction,
      },
      ideLaunch: {
        status: 'FAIL',
        reason: redactedErrorMessage(error),
      },
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E real IDE launch not proven: ${redactedErrorMessage(error)}`);
  }

  let providerRuntime = {};
  try {
    providerRuntime = readProviderRuntimeEvidence(desktopLaunch);
  } catch (error) {
    writeEvidence({
      ok: false,
      evidenceClass: 'READINESS_AUDIT',
      gate: 'atelier:full-e2e',
      readiness: 'NOT_READY',
      globalReady: false,
      failureMode: 'REAL_RUNTIME_AUTOMATION_NOT_WIRED',
      presentRuntimeInputs,
      runtimeHandshakes,
      desktopLaunch,
      postReadyActions: {
        workspaceOpen: workspaceOpenAction,
      },
      ideLaunch,
      providerRuntime: {
        status: 'FAIL',
        reason: redactedErrorMessage(error),
      },
      requiredNextStep:
        'Wire production provider/runtime quality evidence before allowing ok=true full E2E evidence.',
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`Atelier full E2E provider/runtime quality not proven: ${redactedErrorMessage(error)}`);
  }

  writeEvidence({
    ok: true,
    evidenceClass: 'REAL_PRODUCT_PATH',
    gate: 'atelier:full-e2e',
    readiness: 'NOT_READY',
    globalReady: false,
    presentRuntimeInputs,
    runtimeHandshakes,
    desktopLaunch,
    postReadyActions: {
      workspaceOpen: workspaceOpenAction,
    },
    ideLaunch,
    providerRuntime,
    claimBoundary,
    notCovered: [
      'global Atelier readiness still requires completion audit over all explicit objective requirements',
    ],
    startedAt,
    completedAt: new Date().toISOString(),
  });
}

try {
  await main();
} catch (error) {
  console.error(redactedErrorMessage(error));
  process.exit(1);
}
