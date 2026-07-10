#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(repoRoot, 'applet-readiness-evidence', 'official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-real-product-gate.json');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.stdio ?? 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
      }
    });
  });
}

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/atelier_gate_server'], {
      cwd: path.join(repoRoot, 'apps', 'station', 'app'),
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
      if (!settled) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        reject(new Error('Timed out waiting for Atelier real product gate server'));
      }
    }, Number(process.env.PEERS_ATELIER_REAL_PRODUCT_GATE_STARTUP_TIMEOUT_MS ?? 60_000));

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
        reject(new Error(`Atelier gate server exited before readiness with ${code}: ${stderr}`));
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

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const server = await startGateServer();
  try {
    await run(
      'cargo',
      [
        'test',
        '--bin',
        'peers-touch-desktop',
        'atelier_gateway_reaches_station_bundled_atelier_workspace',
        '--',
        '--nocapture',
      ],
      {
        cwd: path.join(repoRoot, 'apps', 'desktop', 'src-tauri'),
        env: {
          PEERS_APPLET_ATELIER_GATE_BASE_URL: server.ready.baseUrl,
          PEERS_APPLET_ATELIER_GATE_TOKEN: server.ready.token,
          PEERS_APPLET_ATELIER_GATE_AGENT_ID: server.ready.agentId,
          PEERS_APPLET_ATELIER_GATE_TASK_ID: server.ready.taskId,
        },
      },
    );

    writeFileSync(
      evidencePath,
      `${JSON.stringify(
        {
          ok: true,
          evidenceClass: 'REAL_PRODUCT_PATH',
          appletId: 'peers.atelier',
          service: 'atelier',
          productPath:
            'Desktop Gateway network.request + atelier.events.subscribe -> Station-bundled Atelier official facade + Station agent event stream -> Station-owned AtelierProjectionService.LoadWorkspace + EventStreamService.ReplayTaskEvents -> sqlite-backed agent store',
          stationMountPath: '/applets/atelier/v1',
          stationEventPath: '/sub-agent/agent/events/subscribe',
          desktopPublicPath: '/v1',
          coveredPaths: [
            '/v1/workspace',
            'atelier.projection.event replay via /sub-agent/agent/events/subscribe',
            'afterEventSeq cursor-filtered replay through Desktop Gateway and Station EventStreamService',
            'controlled Station SSE close before first replay followed by Desktop Gateway reconnect with afterEventSeq=0',
            'controlled Station SSE close after first replay followed by Desktop Gateway reconnect using persisted cursor',
          ],
          notCovered: [
            'arbitrary network failure outside controlled pre-replay/post-replay Station SSE EOF',
            'cross-restart cursor recovery in real Desktop product window UI',
            'real Desktop product window UI',
          ],
          command:
            'cargo test --bin peers-touch-desktop atelier_gateway_reaches_station_bundled_atelier_workspace -- --nocapture',
          startedAt,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        ok: false,
        evidenceClass: 'REAL_PRODUCT_PATH',
        appletId: 'peers.atelier',
        service: 'atelier',
        error: String(error?.message ?? error),
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.error(error);
  process.exit(1);
});
