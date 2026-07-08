#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packageDir = path.resolve('apps/desktop/applets-dist/peers.atelier');
const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-product-window-cross-restart-gate.json');
const firstRenderedEvidencePath = path.join(evidenceDir, 'atelier-product-window-cross-restart-first-rendered-evidence.json');
const firstCreatedEvidencePath = path.join(evidenceDir, 'atelier-product-window-cross-restart-first-created-evidence.json');
const firstProductShellEvidencePath = path.join(evidenceDir, 'atelier-product-window-cross-restart-first-product-shell-evidence.json');
const secondProductShellEvidencePath = path.join(evidenceDir, 'atelier-product-window-cross-restart-second-product-shell-evidence.json');
const genericEvidencePath = path.resolve('applet-readiness-evidence/desktop/product-window-gate/product-shell-evidence.json');
const genericOutputPath = path.resolve('applet-readiness-evidence/desktop/product-window-gate-output.txt');
const storageRoot = path.resolve('.local/applet-product-window-gate/atelier-cross-restart-storage');
const cargoTargetDir = path.resolve('.local/applet-product-window-gate/atelier-cross-restart-cargo-target');
const bundleRoot = path.join(cargoTargetDir, 'release', 'bundle');
const certificationCreateGoal = 'Atelier product-window cross-restart cursor E2E';

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

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(rootDir, 'apps', 'station', 'app'),
      env: {
        ...process.env,
        PEERS_ATELIER_GATE_CLOSE_BEFORE_FIRST_REPLAY: '1',
        PEERS_ATELIER_GATE_CLOSE_AFTER_FIRST_REPLAY: '1',
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
      reject(new Error(`Timed out waiting for Atelier cross-restart gate server: ${stderr}`));
    }, Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_GATE_STARTUP_TIMEOUT_MS ?? 60_000));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
      if (!line || settled) return;
      try {
        const ready = JSON.parse(line);
        if (!ready.baseUrl || !ready.token || !ready.agentId) {
          throw new Error('ready payload must include baseUrl, token, and agentId');
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
        reject(new Error(`Atelier cross-restart gate server exited before readiness with ${code}: ${stderr}`));
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

function runProductWindowPhase({ ready, launchOptions, requiredUrls, skipBuild, preserveStorageRoot, renderedEvidencePath, createdEvidencePath }) {
  const args = [
    'tooling/scripts/applet-desktop-product-window-gate.mjs',
    packageDir,
    '--product-app',
  ];
  if (skipBuild) args.push('--skip-build');

  const result = spawnSync('node', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_ACTOR_ID: 'atelier-real-product-gate-actor',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_TOKEN: ready.token,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL: ready.baseUrl,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_STORAGE_ROOT: storageRoot,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_PROFILE: 'desktop-atelier-cross-restart',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_CARGO_TARGET_DIR: cargoTargetDir,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_BUNDLE_ROOT: skipBuild ? bundleRoot : '',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_PRESERVE_STORAGE_ROOT: preserveStorageRoot ? '1' : '0',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON: JSON.stringify(launchOptions),
      PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS: requiredUrls.join(','),
      PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS:
        process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '30000',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS:
        process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '8000',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER: renderedEvidencePath ? '1' : '0',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS:
        process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS ?? '5000',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE: renderedEvidencePath ?? '',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_CREATED_PROJECT_EVIDENCE: createdEvidencePath ?? '',
    },
  });

  if (result.status !== 0) {
    throw new Error([
      'Underlying Desktop product-window gate failed for peers.atelier cross-restart phase',
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  assert.ok(existsSync(genericEvidencePath), `Underlying product-window evidence is missing: ${genericEvidencePath}`);
  return {
    productShellEvidence: readJson(genericEvidencePath),
    output: result.stdout,
  };
}

function findReplayRequest(requests, startIndex, predicate) {
  return requests.slice(startIndex).find(predicate);
}

async function waitForSecondReplayProbe(baseUrl, startIndex, expected) {
  const timeoutMs = Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_REPLAY_PROBE_TIMEOUT_MS ?? 15_000);
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/replay_probe`);
    const requests = Array.isArray(lastProbe.requests) ? lastProbe.requests : [];
    const matched = findReplayRequest(requests, startIndex, (request) => {
      const replayedSeqs = Array.isArray(request.replayedSeqs) ? request.replayedSeqs : [];
      return request.agentId === expected.agentId
        && request.taskId === expected.taskId
        && request.afterEventSeq >= expected.minAfterEventSeq
        && replayedSeqs.length === 0;
    });
    if (matched) {
      return { ...lastProbe, matchedRequest: matched, startIndex };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for cross-restart replay probe: ${JSON.stringify({ expected, startIndex, lastProbe })}`);
}

function fail(message, details = []) {
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    ok: false,
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.atelier',
    gate: 'applet:atelier-product-window-cross-restart-gate',
    message,
    details,
    notCovered: [
      'human decision / escalation / resume E2E',
      'Artifact/Gate production and blocking-gate recovery E2E',
      'rich artifact body rendering in a Host sandbox',
      'complete Host + Station + applet E2E',
    ],
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`FAIL Atelier product-window cross-restart gate\n${message}\n${details.join('\n')}\n`);
  process.exit(1);
}

if (!existsSync(packageDir)) {
  fail(`Atelier packaged applet is missing: ${packageDir}`, ['Run pnpm applets:build before this gate.']);
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  rmSync(storageRoot, { recursive: true, force: true });
  rmSync(firstRenderedEvidencePath, { force: true });
  rmSync(firstCreatedEvidencePath, { force: true });
  rmSync(firstProductShellEvidencePath, { force: true });
  rmSync(secondProductShellEvidencePath, { force: true });

  const server = await startGateServer();
  try {
    const first = runProductWindowPhase({
      ready: server.ready,
      launchOptions: {
        agentId: server.ready.agentId,
        certificationMode: 'product-window-e2e',
        createGoal: certificationCreateGoal,
        agentIds: [server.ready.agentId],
        taskId: server.ready.taskId,
        afterEventSeq: 0,
        runKind: 'agents',
        flowId: 'expert-hierarchy',
      },
      requiredUrls: [
        '/applets/atelier/v1/workspace',
        '/applets/atelier/v1/projects',
        '/sub-agent/agent/events/subscribe',
      ],
      skipBuild: false,
      preserveStorageRoot: false,
      renderedEvidencePath: firstRenderedEvidencePath,
      createdEvidencePath: firstCreatedEvidencePath,
    });
    writeFileSync(firstProductShellEvidencePath, `${JSON.stringify(first.productShellEvidence, null, 2)}\n`);

    const createdProjectEvidence = readJson(firstCreatedEvidencePath);
    const renderedProjectionEvidence = readJson(firstRenderedEvidencePath);
    const createdTaskId = createdProjectEvidence.properties?.taskId;
    const firstRenderedSeq = renderedProjectionEvidence.properties?.eventSeq;
    assert.equal(typeof createdTaskId, 'string', 'first launch must create a task id');
    assert.equal(typeof firstRenderedSeq, 'number', 'first launch must render a projection event seq');

    const beforeSecondProbe = await fetchJson(`${server.ready.baseUrl}/__atelier_gate/replay_probe`);
    const beforeSecondRequests = Array.isArray(beforeSecondProbe.requests) ? beforeSecondProbe.requests : [];
    const secondStartIndex = beforeSecondRequests.length;

    const second = runProductWindowPhase({
      ready: server.ready,
      launchOptions: {
        agentId: server.ready.agentId,
        certificationMode: 'product-window-e2e',
        taskId: createdTaskId,
        afterEventSeq: 0,
        runKind: 'agents',
        flowId: 'expert-hierarchy',
      },
      requiredUrls: [
        '/applets/atelier/v1/workspace',
        '/sub-agent/agent/events/subscribe',
      ],
      skipBuild: true,
      preserveStorageRoot: true,
    });
    writeFileSync(secondProductShellEvidencePath, `${JSON.stringify(second.productShellEvidence, null, 2)}\n`);

    const crossRestartReplayProbe = await waitForSecondReplayProbe(
      server.ready.baseUrl,
      secondStartIndex,
      {
        agentId: server.ready.agentId,
        taskId: createdTaskId,
        minAfterEventSeq: firstRenderedSeq,
      },
    );

    const evidence = {
      ok: true,
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.atelier',
      gate: 'applet:atelier-product-window-cross-restart-gate',
      packageDir: path.relative(rootDir, packageDir),
      underlyingGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs --product-app',
      storageRoot: path.relative(rootDir, storageRoot),
      firstProductShellEvidencePath: path.relative(rootDir, firstProductShellEvidencePath),
      secondProductShellEvidencePath: path.relative(rootDir, secondProductShellEvidencePath),
      firstRenderedEvidencePath: path.relative(rootDir, firstRenderedEvidencePath),
      firstCreatedEvidencePath: path.relative(rootDir, firstCreatedEvidencePath),
      firstProductShellEvidence: first.productShellEvidence,
      secondProductShellEvidence: second.productShellEvidence,
      createdProjectEvidence,
      renderedProjectionEvidence,
      stationGateServer: {
        baseUrl: server.ready.baseUrl,
        agentId: server.ready.agentId,
        firstRenderedSeq,
        secondStartIndex,
        crossRestartReplayProbe,
      },
      coveredPaths: [
        'first packaged peers.atelier product-window launch creates a Station task and renders a projection event',
        'Desktop Gateway persists the Atelier projection cursor to the product-window storage root',
        'second packaged peers.atelier product-window launch reuses the same storage root with a new applet session',
        'second launch subscribes through /sub-agent/agent/events/subscribe using the persisted cursor instead of afterEventSeq=0',
        'Station replay after cross-restart returns no already-applied projection events',
      ],
      notCovered: [
        'human decision / escalation / resume E2E',
        'Artifact/Gate production and blocking-gate recovery E2E',
        'rich artifact body rendering in a Host sandbox',
        'complete Host + Station + applet E2E',
      ],
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write([
      'PASS Atelier product-window cross-restart gate',
      `Evidence: ${path.relative(rootDir, evidencePath)}`,
      `Second replay request: ${JSON.stringify(crossRestartReplayProbe.matchedRequest)}`,
    ].join('\n'));
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  fail('Atelier product-window cross-restart gate failed', [
    error instanceof Error ? error.message : String(error),
  ]);
});
