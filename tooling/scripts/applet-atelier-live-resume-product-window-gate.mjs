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
const evidencePath = path.join(evidenceDir, 'atelier-live-resume-product-window-gate.json');
const unsubscribeEvidencePath = path.join(evidenceDir, 'atelier-live-resume-product-window-unsubscribe-evidence.json');
const decisionEvidencePath = path.join(evidenceDir, 'atelier-live-resume-product-window-resolved-evidence.json');
const gateTaskId = 'atelier-real-product-gate-task';
const gateDecisionId = 'atelier-real-product-gate-decision';
const gateNodeId = 'atelier-real-product-live-resume-node';
const gateChoice = '继续执行';

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

async function waitForLiveResumeProbe(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/live_resume_probe`);
    const providerCalls = Array.isArray(lastProbe.providerCalls) ? lastProbe.providerCalls : [];
    const hasWaitToolCall = providerCalls.some((call) => call?.waitTool === true);
    const hasFinalCall = providerCalls.some((call) => call?.final === true);
    if (
      lastProbe.taskId === gateTaskId &&
      lastProbe.interruptId === gateDecisionId &&
      lastProbe.nodeId === gateNodeId &&
      lastProbe.turnStatus === 'completed' &&
      lastProbe.finalResponse === 'Atelier live resume provider turn completed after Station human decision.' &&
      lastProbe.resolvedInterrupts === 1 &&
      lastProbe.consumedInterrupts === 1 &&
      providerCalls.length >= 2 &&
      hasWaitToolCall &&
      hasFinalCall
    ) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for live resume provider probe: ${JSON.stringify(lastProbe)}`);
}

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(rootDir, 'apps', 'station', 'app'),
      env: {
        ...process.env,
        PEERS_ATELIER_GATE_SCENARIO: 'live_resume_provider',
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
      reject(new Error(`Timed out waiting for Atelier live-resume gate server: ${stderr}`));
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
        reject(new Error(`Atelier live-resume gate server exited before readiness with ${code}: ${stderr}`));
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
    gate: 'applet:atelier-live-resume-product-window-gate',
    message,
    details,
    notCovered: [
      'complete Host + Station + applet E2E',
      'rich Host artifact sandbox visual renderer',
      'real executor/provider recovery completion beyond live human-decision resume',
    ],
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`FAIL Atelier live-resume product-window gate\n${message}\n${details.join('\n')}\n`);
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
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS ?? '9000',
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
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '9000',
        },
      },
    );

    if (result.status !== 0) {
      throw new Error([
        'Underlying Desktop product-window gate failed for peers.atelier live resume',
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

    const decisionEvidence = readJson(decisionEvidencePath);
    assert.equal(decisionEvidence.ok, true, 'decision resolved evidence must report ok=true');
    assert.equal(decisionEvidence.appletId, 'peers.atelier', 'decision evidence must be for peers.atelier');
    assert.equal(decisionEvidence.event, 'atelier.decision.resolved.rendered', 'decision evidence event mismatch');
    const decisionProperties = decisionEvidence.properties ?? {};
    assert.equal(decisionProperties.taskId, gateTaskId, 'decision evidence taskId mismatch');
    assert.equal(decisionProperties.blockId, gateDecisionId, 'decision evidence blockId mismatch');
    assert.equal(decisionProperties.choice, gateChoice, 'decision evidence choice mismatch');

    const liveResumeProbe = await waitForLiveResumeProbe(
      server.ready.baseUrl,
      Number(process.env.PEERS_ATELIER_LIVE_RESUME_PROBE_TIMEOUT_MS ?? 20_000),
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
      gate: 'applet:atelier-live-resume-product-window-gate',
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
        nodeId: gateNodeId,
        liveResumeProbe,
      },
      coveredPaths: [
        'packaged peers.atelier renders inside the normal Desktop product shell',
        'official peers.atelier loads Station pending human decision through /v1/workspace service binding',
        'official peers.atelier submits the decision through /v1/escalations:resolve service binding',
        'Station ResolveCollaborationInterrupt wakes an in-flight LiveResumeBroker waiter',
        'real TurnService.ExecuteTurn provider loop executes station_human_decision_resume, consumes the interrupt, and performs the final provider call in the same turn',
      ],
      notCovered: [
        'complete Host + Station + applet E2E',
        'rich Host artifact sandbox visual renderer',
        'real executor/provider recovery completion beyond live human-decision resume',
      ],
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write([
      'PASS Atelier live-resume product-window gate',
      `Evidence: ${path.relative(rootDir, evidencePath)}`,
      `Underlying evidence: ${path.relative(rootDir, genericEvidencePath)}`,
      result.stdout,
    ].filter(Boolean).join('\n'));
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  fail('Atelier live-resume product-window gate failed before completion', [
    error instanceof Error ? error.message : String(error),
  ]);
});
