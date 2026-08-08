#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packageDir = path.resolve('apps/desktop/applets-dist/peers.atelier');
const genericEvidencePath = path.resolve('tooling/acceptance/evidence/applets/desktop/product-window-gate/product-shell-evidence.json');
const genericOutputPath = path.resolve('.artifacts/applet-readiness/desktop/product-window-gate-output.txt');
const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-product-window-failure-matrix-gate.json');
const scenarios = [
  {
    name: 'auth-denied',
    expectedErrorKind: 'auth-denied',
    expectedRetryable: false,
    expectedRetryDelayMs: null,
  },
  {
    name: 'disconnected',
    expectedErrorKind: 'disconnected',
    expectedRetryable: true,
    expectedRetryDelayMs: 500,
  },
  {
    name: 'timeout',
    expectedErrorKind: 'disconnected',
    expectedRetryable: true,
    expectedRetryDelayMs: 500,
  },
];
const coveredPaths = [
  'packaged peers.atelier renders inside the normal Desktop product shell during controlled Station subscribe failure scenarios',
  'official peers.atelier loads Station workspace through /v1/workspace service binding before controlled subscribe failures',
  'official peers.atelier reports controller.subscribe-rejected diagnostics from the real Desktop product window UI',
  'official peers.atelier maps controlled Station auth-denied subscribe failure to auth-denied without retry',
  'official peers.atelier maps controlled Station disconnected subscribe failure to disconnected with retry scheduling',
  'official peers.atelier maps controlled Station timeout subscribe failure to disconnected with retry scheduling',
];
const notCovered = [
  'arbitrary real network failure matrix outside the controlled Station gate server',
  'cross-restart cursor recovery',
  'human decision / escalation / resume E2E',
  'Artifact/Gate production and blocking-gate recovery E2E',
  'complete Host + Station + applet E2E',
];

function claimBoundary(proves = []) {
  return {
    readiness: 'NOT_READY',
    proves,
    doesNotProve: notCovered,
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readNdjson(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function startGateServer(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(rootDir, 'apps', 'station', 'app'),
      env: {
        ...process.env,
        PEERS_ATELIER_GATE_EVENT_REPLAY_FAILURE_SCENARIO: scenario.name,
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
      reject(new Error(`Timed out waiting for Atelier product-window failure gate server (${scenario.name}): ${stderr}`));
    }, Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_GATE_STARTUP_TIMEOUT_MS ?? 60_000));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
      if (!line || settled) return;
      try {
        const ready = JSON.parse(line);
        if (!ready.baseUrl || !ready.token || !ready.agentId || !ready.taskId) {
          throw new Error('ready payload must include baseUrl, token, agentId, and taskId');
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
        reject(new Error(`Atelier product-window failure gate server (${scenario.name}) exited before readiness with ${code}: ${stderr}`));
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
  writeFileSync(
    evidencePath,
    `${JSON.stringify({
      ok: false,
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.atelier',
      gate: 'applet:atelier-product-window-failure-matrix-gate',
      message,
      details,
      coveredPaths: [],
      notCovered,
      claimBoundary: claimBoundary(),
    }, null, 2)}\n`,
  );
  process.stderr.write(`FAIL Atelier product-window failure matrix gate\n${message}\n${details.join('\n')}\n`);
  process.exit(1);
}

function assertScenarioDiagnostics(scenario, diagnosticEvidencePath) {
  assert.ok(existsSync(diagnosticEvidencePath), `diagnostic evidence missing for ${scenario.name}`);
  const diagnostics = readNdjson(diagnosticEvidencePath);
  const controllerRejection = diagnostics.find((entry) => {
    const properties = entry.properties ?? {};
    return (
      entry.ok === true &&
      entry.appletId === 'peers.atelier' &&
      entry.productShell === true &&
      entry.event === 'atelier.projection.subscription.diagnostic' &&
      properties.stage === 'controller.subscribe-rejected' &&
      properties.errorKind === scenario.expectedErrorKind &&
      properties.retryable === scenario.expectedRetryable &&
      properties.retryDelayMs === scenario.expectedRetryDelayMs
    );
  });
  assert.ok(
    controllerRejection,
    `missing controller.subscribe-rejected diagnostic for ${scenario.name}: ${JSON.stringify(diagnostics, null, 2)}`,
  );
  const clientRejection = diagnostics.find((entry) => {
    const properties = entry.properties ?? {};
    return properties.stage === 'client.subscribe-rejected' && typeof properties.error === 'string' && properties.error.length > 0;
  });
  assert.ok(clientRejection, `missing client.subscribe-rejected diagnostic for ${scenario.name}`);
  return {
    diagnosticEvidencePath: path.relative(rootDir, diagnosticEvidencePath),
    controllerRejection,
    clientRejection,
    diagnosticCount: diagnostics.length,
  };
}

async function runScenario(scenario) {
  const server = await startGateServer(scenario);
  const diagnosticEvidencePath = path.join(evidenceDir, `atelier-product-window-failure-${scenario.name}-diagnostics.ndjson`);
  try {
    rmSync(diagnosticEvidencePath, { force: true });
    const result = spawnSync(
      'node',
      [
        'tooling/scripts/applet-desktop-product-window-gate.mjs',
        packageDir,
        '--product-app',
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
            process.env.PEERS_ATELIER_FAILURE_MATRIX_CLOSE_AFTER_RENDER_DELAY_MS ?? '7000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_SUBSCRIPTION_DIAGNOSTIC_EVIDENCE:
            diagnosticEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL: server.ready.baseUrl,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON: JSON.stringify({
            agentId: server.ready.agentId,
            certificationMode: 'product-window-failure-matrix',
            agentIds: [server.ready.agentId],
            taskId: server.ready.taskId,
            afterEventSeq: 0,
            runKind: 'agents',
            flowId: 'expert-hierarchy',
          }),
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS:
            '/applets/atelier/v1/workspace,/sub-agent/agent/events/subscribe',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '20000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS:
            process.env.PEERS_ATELIER_FAILURE_MATRIX_POST_REQUIRED_URLS_WAIT_MS ?? '7000',
        },
      },
    );
    if (result.status !== 0) {
      throw new Error([
        `Underlying Desktop product-window failure scenario failed for ${scenario.name}`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join('\n'));
    }
    const productShellEvidence = readJson(genericEvidencePath);
    assert.equal(productShellEvidence.ok, true, `${scenario.name} product-window evidence must report ok=true`);
    assert.equal(productShellEvidence.appletId, 'peers.atelier', `${scenario.name} product-window evidence applet mismatch`);
    assert.equal(productShellEvidence.productShell, true, `${scenario.name} product-window evidence must use product shell`);
    assert.equal(productShellEvidence.event, 'applet.product.rendered', `${scenario.name} product-window render event mismatch`);
    const diagnostics = assertScenarioDiagnostics(scenario, diagnosticEvidencePath);
    return {
      scenario: scenario.name,
      expectedErrorKind: scenario.expectedErrorKind,
      expectedRetryable: scenario.expectedRetryable,
      expectedRetryDelayMs: scenario.expectedRetryDelayMs,
      stationGateServer: {
        baseUrl: server.ready.baseUrl,
        taskId: server.ready.taskId,
        agentId: server.ready.agentId,
        failureScenario: scenario.name,
      },
      productShellEvidence,
      diagnostics,
    };
  } finally {
    await stopGateServer(server.child);
  }
}

async function main() {
  if (!existsSync(packageDir)) {
    fail(`Atelier packaged applet is missing: ${packageDir}`, [
      'Run pnpm applets:build before this gate.',
    ]);
  }
  mkdirSync(evidenceDir, { recursive: true });
  const scenarioResults = [];
  for (const scenario of scenarios) {
    scenarioResults.push(await runScenario(scenario));
  }
  const evidence = {
    ok: true,
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.atelier',
    gate: 'applet:atelier-product-window-failure-matrix-gate',
    packageDir: path.relative(rootDir, packageDir),
    underlyingGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs --product-app',
    genericEvidencePath: path.relative(rootDir, genericEvidencePath),
    genericOutputPath: path.relative(rootDir, genericOutputPath),
    scenarios: scenarioResults,
    coveredPaths,
    notCovered,
    claimBoundary: claimBoundary(coveredPaths),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write([
    'PASS Atelier product-window failure matrix gate',
    `Evidence: ${path.relative(rootDir, evidencePath)}`,
  ].join('\n'));
}

main().catch((error) => {
  fail('Atelier product-window failure matrix gate failed', [
    error instanceof Error ? error.message : String(error),
  ]);
});
