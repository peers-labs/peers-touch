#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const requestedArgs = process.argv.slice(2);
const resolveBlockingGate = requestedArgs.includes('--resolve-blocking-gate');
const recoveryActionArg = requestedArgs.find((arg) => arg.startsWith('--gate-recovery-action='));
const recoveryAction = resolveBlockingGate
  ? (recoveryActionArg?.split('=')[1] ?? 'rerun_failed_node')
  : '';
const recoveryVariants = {
  rerun_failed_node: {
    choice: 'Rerun failed node',
    evidenceSlug: '',
    gateRecoveryAction: 'rerun',
    taskStatus: 2,
    nodeStatus: 2,
    gatePlanStatus: 'active',
    resumesExecution: true,
  },
  accept_risk: {
    choice: 'Accept risk',
    evidenceSlug: 'accept-risk',
    gateRecoveryAction: 'accept',
    taskStatus: 4,
    nodeStatus: 3,
    gatePlanStatus: 'accepted',
    resumesExecution: true,
  },
  continue: {
    choice: 'Continue',
    evidenceSlug: 'continue',
    gateRecoveryAction: 'continue',
    taskStatus: 4,
    nodeStatus: 3,
    gatePlanStatus: 'continued',
    resumesExecution: true,
  },
  cancel: {
    choice: 'Cancel task',
    evidenceSlug: 'cancel',
    gateRecoveryAction: 'cancel',
    taskStatus: 6,
    nodeStatus: 3,
    gatePlanStatus: 'cancelled',
    resumesExecution: false,
  },
};
const recoveryVariant = resolveBlockingGate ? recoveryVariants[recoveryAction] : null;
if (resolveBlockingGate && !recoveryVariant) {
  throw new Error(`Unsupported --gate-recovery-action=${recoveryAction}`);
}
const passThroughArgs = requestedArgs.filter((arg) =>
  arg !== '--resolve-blocking-gate' && !arg.startsWith('--gate-recovery-action='));
const packageDir = path.resolve('apps/desktop/applets-dist/peers.atelier');
const genericEvidencePath = path.resolve('applet-readiness-evidence/desktop/product-window-gate/product-shell-evidence.json');
const genericOutputPath = path.resolve('applet-readiness-evidence/desktop/product-window-gate-output.txt');
const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(
  evidenceDir,
  resolveBlockingGate
    ? (recoveryVariant.evidenceSlug
      ? `atelier-artifact-gate-recovery-${recoveryVariant.evidenceSlug}-product-window-gate.json`
      : 'atelier-artifact-gate-recovery-product-window-gate.json')
    : 'atelier-artifact-gate-product-window-gate.json',
);
const unsubscribeEvidencePath = path.join(evidenceDir, 'atelier-artifact-gate-product-window-unsubscribe-evidence.json');
const renderedEvidencePath = path.join(evidenceDir, 'atelier-artifact-gate-product-window-rendered-evidence.json');
const previewOpenEvidencePath = path.join(evidenceDir, 'atelier-artifact-preview-open-product-window-evidence.json');
const decisionEvidencePath = path.join(
  evidenceDir,
  resolveBlockingGate && recoveryVariant.evidenceSlug
    ? `atelier-artifact-gate-recovery-${recoveryVariant.evidenceSlug}-product-window-resolved-evidence.json`
    : 'atelier-artifact-gate-recovery-product-window-resolved-evidence.json',
);
const subscriptionDiagnosticEvidencePath = path.join(evidenceDir, 'atelier-artifact-gate-product-window-subscription-diagnostic.jsonl');
const gateTaskId = 'atelier-real-product-gate-task';
const gateDecisionId = 'atelier-real-product-gate-blocking-decision';
const gateArtifactId = 'atelier-real-product-gate-artifact';
const gateId = 'atelier-real-product-blocking-gate';
const gateChoice = recoveryVariant?.choice ?? '';
const pausedTaskStatus = 5;
const completedNodeStatus = 3;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function waitForArtifactGateProbe(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/artifact_gate_probe`);
    if (
      lastProbe &&
      lastProbe.taskId === gateTaskId &&
      lastProbe.artifactId === gateArtifactId &&
      lastProbe.gateId === gateId &&
      lastProbe.decisionId === gateDecisionId &&
      lastProbe.taskStatus === pausedTaskStatus &&
      lastProbe.nodeStatus === completedNodeStatus &&
      lastProbe.gatePlanStatus === 'blocked' &&
      lastProbe.artifactEventCount >= 1 &&
      lastProbe.failedGateEventCount >= 1 &&
      lastProbe.pendingInterrupts === 1 &&
      lastProbe.resolvedInterrupts === 0
    ) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for artifact/gate probe: ${JSON.stringify({ lastProbe })}`);
}

async function waitForResolvedArtifactGateProbe(baseUrl, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/artifact_gate_probe`);
    if (
      lastProbe &&
      lastProbe.taskId === gateTaskId &&
      lastProbe.artifactId === gateArtifactId &&
      lastProbe.gateId === gateId &&
      lastProbe.decisionId === gateDecisionId &&
      lastProbe.taskStatus === expected.taskStatus &&
      lastProbe.nodeStatus === expected.nodeStatus &&
      lastProbe.gatePlanStatus === expected.gatePlanStatus &&
      lastProbe.pendingInterrupts === 0 &&
      lastProbe.resolvedInterrupts === 1 &&
      lastProbe.humanDecisionRoute === 'station.orchestration' &&
      lastProbe.humanDecisionAction === expected.humanDecisionAction &&
      lastProbe.humanDecisionReason === 'gate_blocked' &&
      lastProbe.gateRecoveryAction === expected.gateRecoveryAction
    ) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for resolved artifact/gate probe: ${JSON.stringify({ lastProbe })}`);
}

function replayProbeMatches(request, expected) {
  if (!request || typeof request !== 'object') {
    return false;
  }
  const replayedSeqs = Array.isArray(request.replayedSeqs) ? request.replayedSeqs : [];
  const afterEventSeq = typeof request.afterEventSeq === 'number' ? request.afterEventSeq : -1;
  const cursorMatches = typeof expected.afterEventSeq === 'number'
    ? afterEventSeq === expected.afterEventSeq
    : afterEventSeq >= expected.minAfterEventSeq;
  const replayMatches = expected.expectNoReplay === true
    ? replayedSeqs.length === 0
    : expected.replayedSeqs.every((seq) => replayedSeqs.includes(seq));
  return (
    request.agentId === expected.agentId &&
    request.taskId === expected.taskId &&
    cursorMatches &&
    replayMatches
  );
}

function notCoveredForCurrentMode() {
  const notCovered = [
    'rerun_failed_node recovery into a real executor/provider loop',
    'web iframe/image/html/diff renderer, Console Logs runtime stream, and attachment Host Storage runtime',
    'projection SSE cross-restart cursor recovery inside real Desktop product window UI',
    'complete Host + Station + applet E2E',
  ];
  if (!resolveBlockingGate) {
    notCovered.splice(
      1,
      0,
      'blocking gate rerun/accept/continue/cancel recovery through /v1/escalations:resolve',
    );
  }
  return notCovered;
}

async function waitForReplayProbeRequest(baseUrl, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/replay_probe`);
    const requests = Array.isArray(lastProbe.requests) ? lastProbe.requests : [];
    if (requests.some((request) => replayProbeMatches(request, expected))) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for artifact/gate recovery replay probe request: ${JSON.stringify({
    expected,
    lastProbe,
  })}`);
}

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(rootDir, 'apps', 'station', 'app'),
      env: {
        ...process.env,
        PEERS_ATELIER_GATE_SCENARIO: 'artifact_gate_blocking',
        PEERS_ATELIER_GATE_CLOSE_BEFORE_FIRST_REPLAY: '0',
        PEERS_ATELIER_GATE_CLOSE_AFTER_FIRST_REPLAY: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      reject(new Error(`Timed out waiting for Atelier artifact/gate product-window gate server: ${stderr}`));
    }, Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_GATE_STARTUP_TIMEOUT_MS ?? 60_000));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
      if (!line || settled) {
        return;
      }
      try {
        const ready = JSON.parse(line);
        if (!ready.baseUrl || !ready.token) {
          throw new Error('ready payload must include baseUrl and token');
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ child, ready });
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        reject(error);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Atelier artifact/gate server exited before readiness with ${code}: ${stderr}`));
      }
    });
  });
}

function stopGateServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    }
  });
}

function fail(message, details = []) {
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    ok: false,
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.atelier',
    gate: 'applet:atelier-artifact-gate-product-window-gate',
    message,
    details,
      notCovered: notCoveredForCurrentMode(),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`FAIL Atelier artifact/gate product-window gate\n${message}\n${details.join('\n')}\n`);
  process.exit(1);
}

if (!existsSync(packageDir)) {
  fail(`Atelier packaged applet is missing: ${packageDir}`, [
    'Run pnpm applets:build before this gate.',
  ]);
}

async function main() {
  const server = await startGateServer();
  try {
    rmSync(unsubscribeEvidencePath, { force: true });
    rmSync(renderedEvidencePath, { force: true });
    rmSync(previewOpenEvidencePath, { force: true });
    rmSync(decisionEvidencePath, { force: true });
    rmSync(subscriptionDiagnosticEvidencePath, { force: true });
    const launchOptions = {
      agentId: server.ready.agentId,
      certificationMode: 'product-window-e2e',
      agentIds: [server.ready.agentId],
      taskId: gateTaskId,
      afterEventSeq: 0,
      openArtifactPreview: true,
      openArtifactPreviewTaskId: gateTaskId,
      openArtifactPreviewArtifactId: gateArtifactId,
    };
    if (resolveBlockingGate) {
      launchOptions.resolveDecisionTaskId = gateTaskId;
      launchOptions.resolveDecisionBlockId = gateDecisionId;
      launchOptions.resolveDecisionChoice = gateChoice;
    }
    const result = spawnSync(
      'node',
      [
        'tooling/scripts/applet-desktop-product-window-gate.mjs',
        packageDir,
        '--product-app',
        ...passThroughArgs,
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ACTOR_ID: 'atelier-real-product-gate-actor',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_TOKEN: server.ready.token,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER: '1',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS ?? '8000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE: unsubscribeEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_GATE_RENDERED_EVIDENCE:
            renderedEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_PREVIEW_OPENED_EVIDENCE:
            previewOpenEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE:
            decisionEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_SUBSCRIPTION_DIAGNOSTIC_EVIDENCE:
            subscriptionDiagnosticEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL: server.ready.baseUrl,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON: JSON.stringify(launchOptions),
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS:
            resolveBlockingGate
              ? '/applets/atelier/v1/workspace,/applets/atelier/v1/escalations:resolve,/sub-agent/agent/events/subscribe'
              : '/applets/atelier/v1/workspace,/sub-agent/agent/events/subscribe',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '30000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '8000',
        },
      },
    );

    if (result.status !== 0) {
      const diagnostics = readJsonLines(subscriptionDiagnosticEvidencePath);
      throw new Error([
        'Underlying Desktop product-window gate failed for peers.atelier artifact/gate recovery',
        diagnostics.length > 0
          ? `Subscription diagnostics: ${JSON.stringify(diagnostics.slice(-8), null, 2)}`
          : 'Subscription diagnostics: <missing>',
        result.stdout,
        result.stderr,
      ].filter(Boolean).join('\n'));
    }

    const productShellEvidence = readJson(genericEvidencePath);
    assert.equal(productShellEvidence.ok, true, 'product-window evidence must report ok=true');
    assert.equal(productShellEvidence.appletId, 'peers.atelier', 'product-window evidence must be for peers.atelier');
    assert.equal(productShellEvidence.productShell, true, 'product-window evidence must use normal product shell');

    const renderedEvidence = readJson(renderedEvidencePath);
    assert.equal(renderedEvidence.ok, true, 'artifact/gate rendered evidence must report ok=true');
    assert.equal(renderedEvidence.event, 'atelier.artifact_gate.rendered', 'rendered evidence event mismatch');
    const renderedProperties = renderedEvidence.properties ?? {};
    assert.equal(renderedProperties.taskId, gateTaskId, 'rendered evidence taskId mismatch');
    assert.ok(renderedProperties.eventSeq >= 4, 'rendered evidence must include durable event cursor');
    assert.ok(renderedProperties.artifactCount >= 1, 'rendered evidence must include rendered artifact count');
    assert.ok(renderedProperties.gateCount >= 1, 'rendered evidence must include rendered gate count');
    assert.ok(renderedProperties.failedGateCount >= 1, 'rendered evidence must include failed gate count');
    assert.ok(renderedProperties.artifactIds?.includes(gateArtifactId), 'rendered evidence must include artifact id');
    assert.ok(renderedProperties.gateIds?.includes(gateId), 'rendered evidence must include gate id');
    assert.ok(renderedProperties.gateStatuses?.includes('failed'), 'rendered evidence must include failed gate status');

    const previewOpenEvidence = readJson(previewOpenEvidencePath);
    assert.equal(previewOpenEvidence.ok, true, 'artifact preview open evidence must report ok=true');
    assert.equal(previewOpenEvidence.event, 'atelier.artifact.preview.opened', 'preview open evidence event mismatch');
    const previewOpenProperties = previewOpenEvidence.properties ?? {};
    assert.equal(previewOpenProperties.taskId, gateTaskId, 'preview open evidence taskId mismatch');
    assert.equal(previewOpenProperties.artifactId, gateArtifactId, 'preview open evidence artifactId mismatch');
    assert.equal(previewOpenProperties.accepted, true, 'preview open evidence must be accepted');
    assert.equal(previewOpenProperties.prepared, true, 'preview open evidence must be prepared');
    assert.equal(previewOpenProperties.opened, true, 'preview open evidence must prove Desktop Host opened the renderer surface');
    assert.equal(previewOpenProperties.rendererOwner, 'desktop_host', 'preview open evidence owner mismatch');
    assert.equal(previewOpenProperties.rendererMode, 'host_sandbox_manifest', 'preview open evidence mode mismatch');
    assert.equal(previewOpenProperties.rendererStatus, 'rendered', 'preview open evidence status mismatch');
    assert.ok(
      previewOpenProperties.rendererCapabilities?.includes('host_visual_renderer_surface'),
      'preview open evidence must include Host visual renderer capability',
    );
    assert.equal(previewOpenProperties.sandboxRef, `atelier-sandbox://${gateTaskId}/${gateArtifactId}/preview`, 'preview open evidence sandboxRef mismatch');
    assert.equal(previewOpenProperties.bodyRef, `artifact://${gateTaskId}/${gateArtifactId}/body`, 'preview open evidence bodyRef mismatch');

    let decisionEvidence = null;
    let replayProbe = null;
    if (resolveBlockingGate) {
      decisionEvidence = readJson(decisionEvidencePath);
      assert.equal(decisionEvidence.ok, true, 'decision resolved evidence must report ok=true');
      assert.equal(decisionEvidence.event, 'atelier.decision.resolved.rendered', 'decision evidence event mismatch');
      const decisionProperties = decisionEvidence.properties ?? {};
      assert.equal(decisionProperties.taskId, gateTaskId, 'decision evidence taskId mismatch');
      assert.equal(decisionProperties.blockId, gateDecisionId, 'decision evidence blockId mismatch');
      assert.equal(decisionProperties.choice, gateChoice, 'decision evidence choice mismatch');
      assert.ok(
        typeof decisionProperties.eventSeq === 'number' && decisionProperties.eventSeq >= 5,
        'decision evidence must include resolved durable event cursor',
      );
      assert.ok(
        typeof decisionProperties.artifactCount === 'number' && decisionProperties.artifactCount >= 1,
        'decision evidence must keep rendered artifact count',
      );
      assert.ok(
        typeof decisionProperties.gateCount === 'number' && decisionProperties.gateCount >= 1,
        'decision evidence must keep rendered gate count',
      );
      assert.ok(
        typeof decisionProperties.failedGateCount === 'number' && decisionProperties.failedGateCount >= 1,
        'decision evidence must keep failed gate count',
      );
      replayProbe = await waitForReplayProbeRequest(
        server.ready.baseUrl,
        {
          agentId: server.ready.agentId,
          taskId: gateTaskId,
          minAfterEventSeq: decisionProperties.eventSeq,
          replayedSeqs: [],
          expectNoReplay: true,
        },
        Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_REPLAY_PROBE_TIMEOUT_MS ?? 15_000),
      );
    }

    const artifactGateProbe = resolveBlockingGate
      ? await waitForResolvedArtifactGateProbe(
        server.ready.baseUrl,
          {
            humanDecisionAction: recoveryAction,
            gateRecoveryAction: recoveryVariant.gateRecoveryAction,
            taskStatus: recoveryVariant.taskStatus,
            nodeStatus: recoveryVariant.nodeStatus,
            gatePlanStatus: recoveryVariant.gatePlanStatus,
          },
        Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_ARTIFACT_GATE_PROBE_TIMEOUT_MS ?? 15_000),
      )
      : await waitForArtifactGateProbe(
        server.ready.baseUrl,
        Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_ARTIFACT_GATE_PROBE_TIMEOUT_MS ?? 15_000),
      );
    const unsubscribeEvidence = existsSync(unsubscribeEvidencePath)
      ? readJson(unsubscribeEvidencePath)
      : null;

    mkdirSync(evidenceDir, { recursive: true });
    const evidence = {
      ok: true,
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.atelier',
      gate: 'applet:atelier-artifact-gate-product-window-gate',
      packageDir: path.relative(rootDir, packageDir),
      underlyingGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs --product-app',
      genericEvidencePath: path.relative(rootDir, genericEvidencePath),
      genericOutputPath: path.relative(rootDir, genericOutputPath),
      subscriptionDiagnosticEvidencePath: path.relative(rootDir, subscriptionDiagnosticEvidencePath),
      productShellEvidence,
      renderedEvidence,
      previewOpenEvidence,
      decisionEvidence,
      unsubscribeEvidence,
      subscriptionDiagnostics: readJsonLines(subscriptionDiagnosticEvidencePath),
      stationGateServer: {
        baseUrl: server.ready.baseUrl,
        taskId: gateTaskId,
        agentId: server.ready.agentId,
        artifactId: gateArtifactId,
        gateId,
        decisionId: gateDecisionId,
        artifactGateProbe,
        replayProbe,
      },
      coveredPaths: [
        'packaged peers.atelier renders inside the normal Desktop product shell',
        'official peers.atelier loads Station-produced artifact and failed blocking gate metadata through /v1/workspace service binding',
        'official peers.atelier renders Station-produced artifact metadata, failed blocking gate metadata, and the pending recovery decision in the normal Desktop product window',
        'official peers.atelier submits the Station-projected sandbox preview target through atelier.artifact.preview.open and receives a Desktop Host-owned rendered sandbox surface descriptor',
        'Station fixture keeps the blocking gate pending and does not grant applet artifact/gate production or execution capability',
        ...(resolveBlockingGate
          ? [
              `official peers.atelier submits a blocking-gate ${recoveryAction} choice through /v1/escalations:resolve service binding`,
              `Station guarded decision resolve consumes the durable blocking gate interrupt and materializes gate_recovery_action=${recoveryVariant.gateRecoveryAction}`,
            'official peers.atelier renders the resolved blocking gate decision choice from the Station-owned snapshot',
            'official peers.atelier starts Station projection replay after the resolved durable event cursor',
          ]
          : []),
      ],
        notCovered: notCoveredForCurrentMode(),
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write([
      'PASS Atelier artifact/gate product-window gate',
      `Evidence: ${path.relative(rootDir, evidencePath)}`,
      `Underlying evidence: ${path.relative(rootDir, genericEvidencePath)}`,
      result.stdout,
    ].filter(Boolean).join('\n'));
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  fail('Atelier artifact/gate product-window gate failed before Desktop product-window launch', [
    error instanceof Error ? error.message : String(error),
  ]);
});
