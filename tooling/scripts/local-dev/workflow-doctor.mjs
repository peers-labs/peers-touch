#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import {
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { buildStandaloneWorkflowSnapshot } from './workflow-snapshot.mjs';

export const WORKFLOW_DOCTOR_KIND = 'peers-touch-workflow-doctor-report';
export const WORKFLOW_DOCTOR_SCHEMA_VERSION = 2;

function sourceIdentity(root) {
  return {
    workspaceId: workspaceIdForRoot(root),
    branch: execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  };
}

function runIntegrationAudit(root, host) {
  const result = spawnSync(
    'python3',
    [
      'tooling/scripts/agent-integration-audit.py',
      '--root',
      root,
      '--host',
      host,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw Object.assign(new Error('optional Hook audit unavailable'), {
      code: 'AGENT_INTEGRATION_AUDIT_UNAVAILABLE',
    });
  }
  return JSON.parse(result.stdout);
}

async function capture(provider, fallbackCode) {
  try {
    return { ok: true, value: await provider() };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? fallbackCode,
      message: error?.message ?? String(error),
    };
  }
}

export async function evaluateStandaloneWorkflowDoctor(
  options = {},
  dependencies = {},
) {
  const root = realpathSync(options.repoRoot ?? repoRoot);
  const now = dependencies.now?.() ?? new Date();
  const source =
    dependencies.sourceIdentity?.(root) ?? sourceIdentity(root);
  const snapshotResult = await capture(
    () =>
      (dependencies.buildSnapshot ?? buildStandaloneWorkflowSnapshot)({
        workspaceRoots: [root],
        now,
      }),
    'WORKFLOW_SNAPSHOT_UNAVAILABLE',
  );
  const integrationResult = await capture(
    () =>
      (dependencies.auditIntegration ?? runIntegrationAudit)(
        root,
        options.host ?? 'trae',
      ),
    'AGENT_INTEGRATION_AUDIT_UNAVAILABLE',
  );
  const row = snapshotResult.ok
    ? snapshotResult.value.worktrees.find(
        (candidate) => candidate.workspaceId === source.workspaceId,
      )
    : null;
  const findings = [];
  if (!snapshotResult.ok || row === null) {
    findings.push({
      severity: 'error',
      code: snapshotResult.code ?? 'WORKFLOW_WORKTREE_MISSING',
    });
  } else {
    findings.push(
      ...row.taskErrors.map((error) => ({
        severity: 'warning',
        code: error.code,
        taskId: error.taskId,
      })),
    );
  }
  if (!integrationResult.ok || integrationResult.value?.status !== 'PASS') {
    findings.push({
      severity: 'notice',
      code: integrationResult.code ?? 'AGENT_INTEGRATION_OPTIONAL',
    });
  }
  return {
    schemaVersion: WORKFLOW_DOCTOR_SCHEMA_VERSION,
    kind: WORKFLOW_DOCTOR_KIND,
    mode: 'standalone',
    status: findings.some((finding) => finding.severity === 'error')
      ? 'BLOCKED'
      : 'PASS',
    checkedAt: now.toISOString(),
    source,
    taskCount: row?.tasks.length ?? 0,
    findings,
  };
}

export async function runWorkflowDoctorCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const options = { host: 'trae' };
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== '--host' || !argv[index + 1]) {
      throw Object.assign(new Error(`unsupported argument: ${argv[index]}`), {
        code: 'WORKFLOW_DOCTOR_ARGUMENT_INVALID',
      });
    }
    options.host = argv[index + 1];
  }
  return evaluateStandaloneWorkflowDoctor(
    {
      ...options,
      ...(dependencies.repoRoot ? { repoRoot: dependencies.repoRoot } : {}),
    },
    dependencies,
  );
}

export function workflowDoctorExitCode(report) {
  return report.status === 'PASS' ? 0 : 2;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const report = await runWorkflowDoctorCli();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = workflowDoctorExitCode(report);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: WORKFLOW_DOCTOR_SCHEMA_VERSION,
        kind: WORKFLOW_DOCTOR_KIND,
        status: 'BLOCKED',
        code: error?.code ?? 'WORKFLOW_DOCTOR_FAILED',
      })}\n`,
    );
    process.exitCode = 2;
  }
}
