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
const evidencePath = path.join(evidenceDir, 'atelier-product-window-gate.json');
const unsubscribeEvidencePath = path.join(evidenceDir, 'atelier-product-window-unsubscribe-evidence.json');
const renderedProjectionEvidencePath = path.join(evidenceDir, 'atelier-product-window-rendered-projection-evidence.json');
const createdProjectEvidencePath = path.join(evidenceDir, 'atelier-product-window-created-project-evidence.json');
const certificationCreateGoal = 'Atelier product-window createFromGoal E2E';
const productWindowCoveredPaths = [
  'packaged peers.atelier renders inside the normal Desktop product shell',
  'Desktop product-window route reports applet.product.rendered for peers.atelier',
  'official peers.atelier loads Station workspace through /v1/workspace service binding inside the real Desktop product window UI',
  'official peers.atelier sends createFromGoal through /v1/projects service binding and Station creates a durable task/node/provider-plan/event projection source inside the real Desktop product window UI',
  'official peers.atelier starts Station projection event replay through atelier.events.subscribe -> /sub-agent/agent/events/subscribe inside the real Desktop product window UI',
  'official peers.atelier reconnects after controlled post-first-replay SSE close and resumes from the persisted cursor inside the real Desktop product window UI',
  'official peers.atelier applies a Station projection event to rendered stream state inside the real Desktop product window UI',
  'official peers.atelier unsubscribes atelier.projection.event and cancels the Desktop Gateway projection subscription after product-window close',
];
const productWindowDoesNotProve = [
  'projection SSE cross-restart cursor recovery inside real Desktop product window UI',
  'human decision / escalation / resume E2E',
  'Artifact/Gate production and blocking-gate recovery E2E',
  'complete Host + Station + applet E2E',
];

function productWindowClaimBoundary(proves = []) {
  return {
    readiness: 'NOT_READY',
    proves,
    doesNotProve: productWindowDoesNotProve,
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
    request.agentId === expected.agentId
    && request.taskId === expected.taskId
    && request.afterEventSeq === expected.afterEventSeq
    && expected.replayedSeqs.every((seq) => replayedSeqs.includes(seq))
  );
}

function replayProbeHasSequence(requests, expectedSequence) {
  let cursor = 0;
  for (const request of requests) {
    if (replayProbeMatches(request, expectedSequence[cursor])) {
      cursor += 1;
      if (cursor >= expectedSequence.length) {
        return true;
      }
    }
  }
  return false;
}

async function waitForReplayProbeSequence(baseUrl, expectedSequence, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/replay_probe`);
    const requests = Array.isArray(lastProbe.requests) ? lastProbe.requests : [];
    if (replayProbeHasSequence(requests, expectedSequence)) {
      return lastProbe;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for product-window replay probe sequence: ${JSON.stringify({
    expectedSequence,
    lastProbe,
  })}`);
}

async function waitForCreateProbe(baseUrl, expectedTaskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  while (Date.now() < deadline) {
    lastProbe = await fetchJson(`${baseUrl}/__atelier_gate/create_probe`);
    const requests = Array.isArray(lastProbe.requests) ? lastProbe.requests : [];
    const request = requests.find((candidate) =>
      candidate &&
      candidate.goal === certificationCreateGoal &&
      candidate.taskId === expectedTaskId &&
      typeof candidate.taskId === 'string' &&
      candidate.taskId.length > 0 &&
      candidate.nodeCount > 0 &&
      candidate.eventCount > 0 &&
      candidate.providerPlanCount > 0
    );
    if (request) {
      return { ...lastProbe, matchedRequest: request };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for product-window createFromGoal probe: ${JSON.stringify({
    goal: certificationCreateGoal,
    expectedTaskId,
    lastProbe,
  })}`);
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
      reject(new Error(`Timed out waiting for Atelier product-window gate server: ${stderr}`));
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
        reject(new Error(`Atelier product-window gate server exited before readiness with ${code}: ${stderr}`));
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
    gate: 'applet:atelier-product-window-gate',
    message,
    details,
    claimBoundary: productWindowClaimBoundary(),
    notCovered: productWindowDoesNotProve,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`FAIL Atelier product-window gate\n${message}\n${details.join('\n')}\n`);
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
    rmSync(renderedProjectionEvidencePath, { force: true });
    rmSync(createdProjectEvidencePath, { force: true });
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
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_DELAY_MS ?? '30000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE: unsubscribeEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE:
            renderedProjectionEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL: server.ready.baseUrl,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_CREATED_PROJECT_EVIDENCE:
            createdProjectEvidencePath,
          PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON: JSON.stringify({
            agentId: server.ready.agentId,
            certificationMode: 'product-window-e2e',
            createGoal: certificationCreateGoal,
            agentIds: [server.ready.agentId],
            taskId: server.ready.taskId,
            afterEventSeq: 0,
            runKind: 'agents',
            flowId: 'expert-hierarchy',
          }),
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS:
            '/applets/atelier/v1/workspace,/applets/atelier/v1/projects,/sub-agent/agent/events/subscribe',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '60000',
          PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS:
            process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '35000',
        },
      },
    );

    if (result.status !== 0) {
      throw new Error([
        'Underlying Desktop product-window gate failed for peers.atelier',
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
    assert.ok(
      typeof productShellEvidence.readySource === 'string' && productShellEvidence.readySource.length > 0,
      'product-window evidence must include readySource',
    );
    const unsubscribeEvidence = readJson(unsubscribeEvidencePath);
    assert.equal(unsubscribeEvidence.ok, true, 'product-window unsubscribe evidence must report ok=true');
    assert.equal(unsubscribeEvidence.appletId, 'peers.atelier', 'product-window unsubscribe evidence must be for peers.atelier');
    assert.equal(unsubscribeEvidence.topic, 'atelier.projection.event', 'product-window unsubscribe evidence topic mismatch');
    assert.equal(unsubscribeEvidence.event, 'atelier.projection.unsubscribe', 'product-window unsubscribe evidence event mismatch');
      const createdProjectEvidence = readJson(createdProjectEvidencePath);
      assert.equal(createdProjectEvidence.ok, true, 'product-window created project evidence must report ok=true');
      assert.equal(
        createdProjectEvidence.appletId,
        'peers.atelier',
        'product-window created project evidence must be for peers.atelier',
      );
      assert.equal(
        createdProjectEvidence.event,
        'atelier.project.created.rendered',
        'product-window created project evidence event mismatch',
      );
      const createdProjectProperties = createdProjectEvidence.properties ?? {};
      assert.equal(
        createdProjectProperties.goal,
        certificationCreateGoal,
        'product-window created project evidence goal mismatch',
      );
      assert.equal(
        createdProjectProperties.runKind,
        'agents',
        'product-window created project evidence must use Station-owned agents intent',
      );
      assert.ok(
        typeof createdProjectProperties.taskId === 'string' && createdProjectProperties.taskId.length > 0,
        'product-window created project evidence must include created taskId',
      );
      assert.ok(
        typeof createdProjectProperties.nodeCount === 'number' && createdProjectProperties.nodeCount > 0,
        'product-window created project evidence must include created task nodes',
      );
      assert.ok(
        typeof createdProjectProperties.eventSeq === 'number' && createdProjectProperties.eventSeq > 0,
        'product-window created project evidence must include durable event sequence',
      );
    const renderedProjectionEvidence = readJson(renderedProjectionEvidencePath);
    assert.equal(renderedProjectionEvidence.ok, true, 'product-window rendered projection evidence must report ok=true');
    assert.equal(
      renderedProjectionEvidence.appletId,
      'peers.atelier',
      'product-window rendered projection evidence must be for peers.atelier',
    );
    assert.equal(
      renderedProjectionEvidence.event,
      'atelier.projection.rendered',
      'product-window rendered projection evidence event mismatch',
    );
    const renderedProjectionProperties = renderedProjectionEvidence.properties ?? {};
    assert.equal(
      renderedProjectionProperties.taskId,
        createdProjectProperties.taskId,
        'product-window rendered projection evidence must use the created project taskId',
    );
    assert.equal(
      renderedProjectionProperties.patchKind,
      'stream.append',
      'product-window rendered projection evidence must come from a stream.append event',
    );
    assert.ok(
      typeof renderedProjectionProperties.eventSeq === 'number' && renderedProjectionProperties.eventSeq >= 1,
      'product-window rendered projection evidence must include an applied event seq',
    );
    assert.ok(
      Array.isArray(renderedProjectionProperties.eventBlockIds) && renderedProjectionProperties.eventBlockIds.length > 0,
      'product-window rendered projection evidence must include event block ids',
    );
    assert.ok(
      Array.isArray(renderedProjectionProperties.renderedBlockIds) &&
        renderedProjectionProperties.eventBlockIds.every((blockId) =>
          renderedProjectionProperties.renderedBlockIds.includes(blockId),
        ),
      'product-window rendered projection evidence must prove event blocks reached rendered state',
    );
    assert.ok(
      typeof renderedProjectionProperties.streamCount === 'number' &&
        renderedProjectionProperties.streamCount >= renderedProjectionProperties.eventBlockIds.length,
      'product-window rendered projection evidence must include rendered stream count',
    );
    const expectedReplayProbeSequence = [
      {
        agentId: server.ready.agentId,
        taskId: createdProjectProperties.taskId,
        afterEventSeq: 0,
        replayedSeqs: [1],
      },
      {
        agentId: server.ready.agentId,
        taskId: createdProjectProperties.taskId,
        afterEventSeq: 1,
        replayedSeqs: [2, 3],
      },
      {
        agentId: server.ready.agentId,
        taskId: createdProjectProperties.taskId,
        afterEventSeq: renderedProjectionProperties.eventSeq,
        replayedSeqs: [],
      },
    ];
    const replayProbe = await waitForReplayProbeSequence(
      server.ready.baseUrl,
      expectedReplayProbeSequence,
      Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_REPLAY_PROBE_TIMEOUT_MS ?? 15_000),
    );
    const replayProbeRequests = Array.isArray(replayProbe.requests) ? replayProbe.requests : [];
    assert.ok(replayProbeHasSequence(replayProbeRequests, expectedReplayProbeSequence));
    const createProbe = await waitForCreateProbe(
      server.ready.baseUrl,
      createdProjectProperties.taskId,
      Number(process.env.PEERS_ATELIER_PRODUCT_WINDOW_CREATE_PROBE_TIMEOUT_MS ?? 15_000),
    );
    assert.equal(
      createProbe.matchedRequest.taskId,
      createdProjectProperties.taskId,
      'product-window create probe taskId must match rendered create evidence',
    );

    mkdirSync(evidenceDir, { recursive: true });
    const evidence = {
      ok: true,
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.atelier',
      gate: 'applet:atelier-product-window-gate',
      packageDir: path.relative(rootDir, packageDir),
      underlyingGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs --product-app',
      genericEvidencePath: path.relative(rootDir, genericEvidencePath),
      genericOutputPath: path.relative(rootDir, genericOutputPath),
      productShellEvidence,
      unsubscribeEvidence,
      renderedProjectionEvidence,
      createdProjectEvidence,
      stationGateServer: {
        baseUrl: server.ready.baseUrl,
        taskId: server.ready.taskId,
        agentId: server.ready.agentId,
        controlledClose: {
          beforeFirstReplay: true,
          afterFirstReplay: true,
        },
        expectedReplayProbeSequence,
        replayProbe,
        createProbe,
      },
      coveredPaths: productWindowCoveredPaths,
      claimBoundary: productWindowClaimBoundary(productWindowCoveredPaths),
      notCovered: productWindowDoesNotProve,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write([
      'PASS Atelier product-window gate',
      `Evidence: ${path.relative(rootDir, evidencePath)}`,
      `Underlying evidence: ${path.relative(rootDir, genericEvidencePath)}`,
      result.stdout,
    ].filter(Boolean).join('\n'));
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  fail('Atelier product-window gate failed before Desktop product-window launch', [
    error instanceof Error ? error.message : String(error),
  ]);
});
