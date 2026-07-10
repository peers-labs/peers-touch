#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const passThroughArgs = process.argv.slice(2);
const packageDir = path.resolve('apps/desktop/applets-dist/peers.atelier');
const genericEvidencePath = path.resolve('applet-readiness-evidence/desktop/product-window-gate/product-shell-evidence.json');
const genericOutputPath = path.resolve('applet-readiness-evidence/desktop/product-window-gate-output.txt');
const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-decision-product-window-gate.json');
const unsubscribeEvidencePath = path.join(evidenceDir, 'atelier-decision-product-window-unsubscribe-evidence.json');
const decisionEvidencePath = path.join(evidenceDir, 'atelier-decision-product-window-resolved-evidence.json');
const gateTaskId = 'atelier-real-product-gate-task';
const gateDecisionId = 'atelier-real-product-gate-decision';
const gateChoice = '继续执行';
const runningTaskStatus = 2;
const decisionCoveredPaths = [
  'packaged peers.atelier renders inside the normal Desktop product shell',
  'official peers.atelier loads Station pending decision through /v1/workspace service binding inside the real Desktop product window UI',
  'official peers.atelier submits a decision option through /v1/escalations:resolve service binding inside the real Desktop product window UI',
  'Station guarded decision resolve consumes a durable pending interrupt while preserving the running task boundary',
  'official peers.atelier renders the resolved decision choice from the Station-owned snapshot',
  'official peers.atelier starts Station projection replay after the resolved durable event cursor',
];
const decisionDoesNotProve = [
  'Artifact/Gate production and blocking-gate recovery E2E',
  'PAUSED task live resume into the execution loop with a real executor/provider',
  'projection SSE cross-restart cursor recovery inside real Desktop product window UI',
  'complete Host + Station + applet E2E',
];

function decisionClaimBoundary(proves = []) {
  return {
    readiness: 'NOT_READY',
    proves,
    doesNotProve: decisionDoesNotProve,
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function replayProbeMatches(request, expected) {
  if (!request || typeof request !== 'object') {
    return false;
  }
  const replayedSeqs = Array.isArray(request.replayedSeqs) ? request.replayedSeqs : [];
  return (
    request.agentId === expected.agentId &&
    request.taskId === expected.taskId &&
    request.afterEventSeq === expected.afterEventSeq &&
    expected.replayedSeqs.every((seq) => replayedSeqs.includes(seq))
  );
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
  throw new Error(`Timed out waiting for decision replay probe request: ${JSON.stringify({
    expected,
    lastProbe,
  })}`);
}

async function waitForResolveProbe(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/resolve_probe`);
    const requests = Array.isArray(lastProbe.requests) ? lastProbe.requests : [];
    const request = requests.find((candidate) =>
      candidate &&
      candidate.taskId === gateTaskId &&
      candidate.blockId === gateDecisionId &&
      candidate.choice === gateChoice &&
      candidate.taskStatus === runningTaskStatus &&
      candidate.resolvedEventCount >= 1 &&
      candidate.pendingInterrupts === 0 &&
      candidate.resolvedInterrupts === 1 &&
      candidate.humanDecisionRoute === 'station.orchestration' &&
      candidate.humanDecisionAction === 'continue' &&
      candidate.humanDecisionReason === 'budget'
    );
    if (request) {
      return { ...lastProbe, matchedRequest: request };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for decision resolve probe: ${JSON.stringify({
    taskId: gateTaskId,
    blockId: gateDecisionId,
    choice: gateChoice,
    lastProbe,
  })}`);
}

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(rootDir, 'apps', 'station', 'app'),
      env: {
        ...process.env,
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
      reject(new Error(`Timed out waiting for Atelier decision product-window gate server: ${stderr}`));
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
        reject(new Error(`Atelier decision gate server exited before readiness with ${code}: ${stderr}`));
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
    gate: 'applet:atelier-decision-product-window-gate',
    message,
    details,
    claimBoundary: decisionClaimBoundary(),
    notCovered: decisionDoesNotProve,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`FAIL Atelier decision product-window gate\n${message}\n${details.join('\n')}\n`);
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
    rmSync(decisionEvidencePath, { force: true });
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
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE:
            decisionEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL: server.ready.baseUrl,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON: JSON.stringify({
            agentId: server.ready.agentId,
            certificationMode: 'product-window-e2e',
            agentIds: [server.ready.agentId],
            taskId: gateTaskId,
            afterEventSeq: 0,
            resolveDecisionTaskId: gateTaskId,
            resolveDecisionBlockId: gateDecisionId,
            resolveDecisionChoice: gateChoice,
          }),
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS:
            '/applets/atelier/v1/workspace,/applets/atelier/v1/escalations:resolve,/sub-agent/agent/events/subscribe',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '30000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '8000',
        },
      },
    );

    if (result.status !== 0) {
      throw new Error([
        'Underlying Desktop product-window gate failed for peers.atelier decision resolve',
        result.stdout,
        result.stderr,
      ].filter(Boolean).join('\n'));
    }

    if (!existsSync(genericEvidencePath)) {
      throw new Error([
        `Underlying product-window evidence is missing: ${genericEvidencePath}`,
        result.stdout,
      ].filter(Boolean).join('\n'));
    }

    const productShellEvidence = readJson(genericEvidencePath);
    assert.equal(productShellEvidence.ok, true, 'product-window evidence must report ok=true');
    assert.equal(productShellEvidence.appletId, 'peers.atelier', 'product-window evidence must be for peers.atelier');
    assert.equal(productShellEvidence.productShell, true, 'product-window evidence must use normal product shell');
    assert.equal(productShellEvidence.event, 'applet.product.rendered', 'product-window evidence must report applet.product.rendered');
    assert.equal(productShellEvidence.launchMode, 'product-window-certification', 'product-window launch mode mismatch');

    const decisionEvidence = readJson(decisionEvidencePath);
    assert.equal(decisionEvidence.ok, true, 'decision resolved evidence must report ok=true');
    assert.equal(decisionEvidence.appletId, 'peers.atelier', 'decision evidence must be for peers.atelier');
    assert.equal(decisionEvidence.event, 'atelier.decision.resolved.rendered', 'decision evidence event mismatch');
    const decisionProperties = decisionEvidence.properties ?? {};
    assert.equal(decisionProperties.taskId, gateTaskId, 'decision evidence taskId mismatch');
    assert.equal(decisionProperties.blockId, gateDecisionId, 'decision evidence blockId mismatch');
    assert.equal(decisionProperties.choice, gateChoice, 'decision evidence choice mismatch');
    assert.ok(
      typeof decisionProperties.eventSeq === 'number' && decisionProperties.eventSeq >= 4,
      'decision evidence must include resolved durable event sequence',
    );
    assert.ok(
      typeof decisionProperties.streamCount === 'number' && decisionProperties.streamCount >= 3,
      'decision evidence must include rendered stream count',
    );

    const resolveProbe = await waitForResolveProbe(
      server.ready.baseUrl,
      Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_RESOLVE_PROBE_TIMEOUT_MS ?? 15_000),
    );
    const replayProbe = await waitForReplayProbeRequest(
      server.ready.baseUrl,
      {
        agentId: server.ready.agentId,
        taskId: gateTaskId,
        afterEventSeq: decisionProperties.eventSeq,
        replayedSeqs: [],
      },
      Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_REPLAY_PROBE_TIMEOUT_MS ?? 15_000),
    );

    const unsubscribeEvidence = existsSync(unsubscribeEvidencePath)
      ? readJson(unsubscribeEvidencePath)
      : null;
    if (unsubscribeEvidence) {
      assert.equal(unsubscribeEvidence.ok, true, 'product-window unsubscribe evidence must report ok=true');
      assert.equal(unsubscribeEvidence.topic, 'atelier.projection.event', 'product-window unsubscribe evidence topic mismatch');
    }

    mkdirSync(evidenceDir, { recursive: true });
    const evidence = {
      ok: true,
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.atelier',
      gate: 'applet:atelier-decision-product-window-gate',
      packageDir: path.relative(rootDir, packageDir),
      underlyingGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs --product-app',
      genericEvidencePath: path.relative(rootDir, genericEvidencePath),
      genericOutputPath: path.relative(rootDir, genericOutputPath),
      productShellEvidence,
      decisionEvidence,
      unsubscribeEvidence,
      stationGateServer: {
        baseUrl: server.ready.baseUrl,
        taskId: gateTaskId,
        agentId: server.ready.agentId,
        decisionId: gateDecisionId,
        resolveProbe,
        replayProbe,
      },
      coveredPaths: decisionCoveredPaths,
      claimBoundary: decisionClaimBoundary(decisionCoveredPaths),
      notCovered: decisionDoesNotProve,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write([
      'PASS Atelier decision product-window gate',
      `Evidence: ${path.relative(rootDir, evidencePath)}`,
      `Underlying evidence: ${path.relative(rootDir, genericEvidencePath)}`,
      result.stdout,
    ].filter(Boolean).join('\n'));
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  fail('Atelier decision product-window gate failed before Desktop product-window launch', [
    error instanceof Error ? error.message : String(error),
  ]);
});
