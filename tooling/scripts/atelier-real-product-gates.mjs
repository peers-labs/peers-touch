#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-real-product-gates-aggregate.json');
const defaultTimeoutMs = Number.parseInt(process.env.PEERS_ATELIER_REAL_PRODUCT_GATE_TIMEOUT_MS ?? '900000', 10);
const variantsTimeoutMs = Number.parseInt(process.env.PEERS_ATELIER_REAL_PRODUCT_VARIANTS_GATE_TIMEOUT_MS ?? '1800000', 10);

const gates = [
  {
    script: 'applet:atelier-real-product-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-real-product-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-product-window-failure-matrix-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-product-window-failure-matrix-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-product-window-cross-restart-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-product-window-cross-restart-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-decision-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-decision-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-live-resume-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-live-resume-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-artifact-gate-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-artifact-gate-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-artifact-body-fetch-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-artifact-body-fetch-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-artifact-gate-recovery-product-window-gate',
    evidence: 'applet-readiness-evidence/official-applet/atelier-artifact-gate-recovery-product-window-gate.json',
    timeoutMs: defaultTimeoutMs,
  },
  {
    script: 'applet:atelier-artifact-gate-recovery-variants-product-window-gate',
    evidence: [
      'applet-readiness-evidence/official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json',
      'applet-readiness-evidence/official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json',
      'applet-readiness-evidence/official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json',
    ],
    timeoutMs: variantsTimeoutMs,
  },
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'bounded aggregate wrapper runs all Atelier real-product and product-window child gates to clean exit',
    'all child gate evidence files parse as ok=true with claimBoundary.readiness=NOT_READY',
    'aggregate command fails closed on child gate failure, timeout, missing evidence, or readiness drift',
  ],
  doesNotProve: [
    'arbitrary user-driven Host + Station + applet E2E beyond the scripted real-product gates',
    'real IDE launch',
    'production provider/model/runtime quality outside the controlled gate server paths',
    'global Atelier readiness',
  ],
};

function writeEvidence(ok, details, message = ok ? 'Atelier real-product aggregate gates passed' : 'Atelier real-product aggregate gates failed') {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    evidencePath,
    `${JSON.stringify({
      ok,
      evidenceClass: 'REAL_PRODUCT_PATH',
      gate: 'atelier:real-product-gates',
      message,
      details,
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
    }, null, 2)}\n`,
  );
}

function readEvidence(filePath) {
  assert.ok(existsSync(filePath), `missing evidence file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function validateEvidence(script, evidencePathForScript) {
  const evidencePaths = Array.isArray(evidencePathForScript) ? evidencePathForScript : [evidencePathForScript];
  return evidencePaths.map((relativePath) => {
    const document = readEvidence(path.resolve(relativePath));
    assert.equal(document.ok, true, `${script} evidence must be ok=true: ${relativePath}`);
    assert.equal(
      document.claimBoundary?.readiness,
      'NOT_READY',
      `${script} evidence must preserve claimBoundary.readiness=NOT_READY: ${relativePath}`,
    );
    return {
      path: relativePath,
      ok: document.ok,
      readiness: document.claimBoundary?.readiness,
      evidenceClass: document.evidenceClass,
    };
  });
}

function runGate(gate) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number.isFinite(gate.timeoutMs) && gate.timeoutMs > 0 ? gate.timeoutMs : defaultTimeoutMs;
    const child = spawn('pnpm', ['run', gate.script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      detached: true,
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (child.exitCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }, 5_000).unref();
    }, timeoutMs);
    timeout.unref();

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${gate.script} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${gate.script} exited with ${code ?? `signal ${signal}`}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const details = [];
  for (const gate of gates) {
    const startedAt = new Date().toISOString();
    await runGate(gate);
    const evidence = validateEvidence(gate.script, gate.evidence);
    details.push({
      script: gate.script,
      startedAt,
      completedAt: new Date().toISOString(),
      timeoutMs: gate.timeoutMs,
      evidence,
    });
  }
  writeEvidence(true, details);
}

main().catch((error) => {
  writeEvidence(false, [], error instanceof Error ? error.message : String(error));
  console.error(error);
  process.exit(1);
});
