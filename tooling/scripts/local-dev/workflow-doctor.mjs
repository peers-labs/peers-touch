#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import {
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import { resolvePlanExecution } from '../plan/plan-mount.mjs';
import { findEarliestInvalidCompletionReview } from './completion-review.mjs';
import { buildWorkflowSnapshot } from './workflow-snapshot.mjs';

export const WORKFLOW_DOCTOR_KIND = 'peers-touch-workflow-doctor-report';
export const WORKFLOW_DOCTOR_SCHEMA_VERSION = 1;
export const WORKFLOW_DOCTOR_PROMISES = Object.freeze([
  Object.freeze({
    id: 'dev.integration.installed',
    label: 'Installed agent integration',
  }),
  Object.freeze({
    id: 'dev.plan.mount',
    label: 'Current workspace Plan mount',
  }),
  Object.freeze({
    id: 'dev.workflow.current',
    label: 'Current worktree workflow state',
  }),
  Object.freeze({
    id: 'dev.review.current',
    label: 'Current completion review',
  }),
  Object.freeze({
    id: 'dev.docs.executable',
    label: 'Executable documentation contract',
  }),
]);

export const WORKFLOW_DOCTOR_DOCUMENTS = Object.freeze({
  'docs/global/workflow.md': WORKFLOW_DOCTOR_PROMISES.map(({ id }) => id),
});

const PROMISE_BY_ID = new Map(
  WORKFLOW_DOCTOR_PROMISES.map((promise) => [promise.id, promise]),
);
const REVIEW_BLOCKING_STATES = new Set(['FAIL', 'STALE', 'UNAVAILABLE']);
const PLAN_REVIEW_REQUIRED_STATUSES = new Set(['completed']);
const PLAN_TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

function promiseResult(id, status, code, detail = {}) {
  const promise = PROMISE_BY_ID.get(id);
  if (!promise) throw new Error(`unknown Workflow Doctor promise: ${id}`);
  return {
    id,
    label: promise.label,
    status,
    code,
    detail,
  };
}

function pass(id, detail = {}) {
  return promiseResult(id, 'PASS', null, detail);
}

function blocked(id, code, detail = {}) {
  return promiseResult(id, 'BLOCKED', code, detail);
}

function gitValue(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sourceIdentity(root) {
  return {
    workspaceId: workspaceIdForRoot(root),
    branch: gitValue(root, ['branch', '--show-current']),
    head: gitValue(root, ['rev-parse', 'HEAD']),
  };
}

function parseAuditOutput(result) {
  let report;
  try {
    report = JSON.parse(result.stdout || result.stderr || '');
  } catch {
    const error = new Error('agent integration audit returned invalid JSON');
    error.code = 'AGENT_INTEGRATION_AUDIT_INVALID';
    throw error;
  }
  return report;
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
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error) throw result.error;
  return parseAuditOutput(result);
}

async function resolvePlan(root) {
  return resolvePlanExecution({ repoRoot: root });
}

export async function resolveDoctorReview(
  root,
  source,
  planResult,
  snapshot,
  dependencies = {},
) {
  const planStatus = planResult.run.state;
  const row = snapshot?.worktrees?.find(
    (candidate) => candidate.workspaceId === source.workspaceId,
  );
  if (!PLAN_REVIEW_REQUIRED_STATUSES.has(planStatus)) {
    return {
      planStatus,
      reviewState: row?.workflow?.review?.state ?? 'MISSING',
      required: false,
      invalidTaskId: null,
    };
  }
  const declaration = (snapshot?.declarations ?? [])
    .filter(
      (candidate) =>
        candidate.workspaceId === source.workspaceId &&
        candidate.planId === planResult.mount.planId &&
        typeof candidate.workItemId === 'string',
    )
    .sort((left, right) =>
      String(right.expiresAt ?? '').localeCompare(String(left.expiresAt ?? '')),
    )[0];
  if (!declaration) {
    const error = new Error('completed Plan has no review work-item lineage');
    error.code = 'COMPLETION_REVIEW_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const findInvalid =
    dependencies.findEarliestInvalidCompletionReview ??
    findEarliestInvalidCompletionReview;
  const invalid = await findInvalid({
    repoRoot: root,
    execution: planResult,
    planPackage: planResult.planPackage,
    workItemId: declaration.workItemId,
  });
  return {
    planStatus,
    reviewState: invalid === null ? 'PASS' : 'STALE',
    required: true,
    invalidTaskId: invalid?.taskId ?? null,
  };
}

async function capture(provider, fallbackCode) {
  try {
    return { ok: true, value: await provider() };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? fallbackCode,
    };
  }
}

function integrationPromise(result) {
  if (!result.ok) {
    return blocked('dev.integration.installed', result.code);
  }
  const report = result.value;
  if (report?.status === 'PASS') {
    return pass('dev.integration.installed', {
      host: report.host,
      callback: report.integrationReceipt?.receipt?.callbackProof?.status ?? null,
    });
  }
  const findings = [
    ...(report?.hostProjectionFindings ?? []).map((item) => item.issue),
    ...(report?.integrationReceipt?.findings ?? []),
    ...(report?.workflowIdentity?.identityFindings ?? []),
  ].filter((value) => typeof value === 'string');
  return blocked('dev.integration.installed', 'AGENT_INTEGRATION_BLOCKED', {
    findings: [...new Set(findings)].sort(),
  });
}

function mountPromise(result, source) {
  if (!result.ok) return blocked('dev.plan.mount', result.code);
  const { mount, snapshot, run } = result.value;
  const valid =
    mount?.workspaceId === source.workspaceId &&
    mount?.canonicalRoot === source.root &&
    mount?.planId === snapshot?.planId &&
    snapshot?.executionBinding?.workspaceId === source.workspaceId &&
    snapshot?.executionBinding?.branch === source.branch &&
    run?.mountId === mount?.mountId;
  return valid
    ? pass('dev.plan.mount', {
        planId: mount.planId,
        planStatus: run.state,
      })
    : blocked('dev.plan.mount', 'PLAN_MOUNT_IDENTITY_MISMATCH');
}

function currentWorkflowPromise(result, source, planResult) {
  if (!result.ok) return blocked('dev.workflow.current', result.code);
  const row = result.value?.worktrees?.find(
    (candidate) => candidate.workspaceId === source.workspaceId,
  );
  if (!row) {
    return blocked('dev.workflow.current', 'WORKFLOW_WORKTREE_MISSING');
  }
  const workflow = row.workflow;
  const expectedPlanId = planResult.ok
    ? planResult.value.mount.planId
    : null;
  const planStatus = planResult.value.run.state;
  const terminalPlan = PLAN_TERMINAL_STATUSES.has(planStatus);
  const projectedPlanMatches =
    workflow?.plan?.id === expectedPlanId &&
    workflow?.plan?.status === planStatus;
  const planMatches = terminalPlan
    ? workflow?.plan === null || projectedPlanMatches
    : projectedPlanMatches;
  const activePlan = planStatus === 'active';
  const currentOwnersPresent =
    !activePlan ||
    (typeof workflow?.task?.id === 'string' &&
      typeof workflow?.session?.state === 'string');
  const blockingFindings = (workflow?.findings ?? []).filter(
    (finding) => finding.severity === 'error',
  );
  const validActivity =
    row.agentActivity !== null &&
    typeof row.agentActivity === 'object' &&
    typeof row.agentActivity.state === 'string';
  if (
    !planMatches ||
    !currentOwnersPresent ||
    !validActivity ||
    workflow?.verdict === 'DRIFT' ||
    workflow?.verdict === 'BLOCKED' ||
    blockingFindings.length > 0
  ) {
    return blocked('dev.workflow.current', 'WORKFLOW_CURRENT_STATE_BLOCKED', {
      verdict: workflow?.verdict ?? null,
      findings: blockingFindings.map((finding) => finding.code).sort(),
    });
  }
  return pass('dev.workflow.current', {
    verdict: workflow.verdict,
    planId: workflow.plan?.id ?? expectedPlanId,
    taskId: workflow.task?.id ?? null,
    sessionState: workflow.session?.state ?? null,
    agentState: row.agentActivity.state,
    warnings: (workflow.findings ?? [])
      .filter((finding) => finding.severity === 'warning')
      .map((finding) => finding.code)
      .sort(),
  });
}

function reviewPromise(result) {
  if (!result.ok) {
    return blocked('dev.review.current', result.code);
  }
  const { planStatus, reviewState, required, invalidTaskId } = result.value;
  const allowed = required
    ? reviewState === 'PASS'
    : !REVIEW_BLOCKING_STATES.has(reviewState);
  return allowed
    ? pass('dev.review.current', {
        planStatus,
        reviewState,
        required,
      })
    : blocked('dev.review.current', 'COMPLETION_REVIEW_NOT_CURRENT', {
        planStatus,
        reviewState,
        required,
        invalidTaskId,
      });
}

function markerFor(id) {
  return `<!-- workflow-doctor:${id} -->`;
}

function docsPromise(result) {
  if (!result.ok) return blocked('dev.docs.executable', result.code);
  const missing = [];
  const duplicates = [];
  for (const [file, ids] of Object.entries(WORKFLOW_DOCTOR_DOCUMENTS)) {
    const text = result.value[file];
    for (const id of ids) {
      const marker = markerFor(id);
      const count = typeof text === 'string' ? text.split(marker).length - 1 : 0;
      if (count === 0) missing.push(`${file}:${id}`);
      if (count > 1) duplicates.push(`${file}:${id}`);
    }
  }
  return missing.length === 0 && duplicates.length === 0
    ? pass('dev.docs.executable', {
        documents: Object.keys(WORKFLOW_DOCTOR_DOCUMENTS),
        promiseCount: WORKFLOW_DOCTOR_PROMISES.length,
      })
    : blocked('dev.docs.executable', 'WORKFLOW_DOCUMENTATION_DRIFT', {
        missing,
        duplicates,
      });
}

function readDoctorDocuments(root, reader = readFileSync) {
  return Object.fromEntries(
    Object.keys(WORKFLOW_DOCTOR_DOCUMENTS).map((relative) => [
      relative,
      reader(path.join(root, ...relative.split('/')), 'utf8'),
    ]),
  );
}

function parseArguments(argv) {
  const options = { host: 'trae' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--host') {
      const error = new Error(`unsupported argument: ${token}`);
      error.code = 'WORKFLOW_DOCTOR_ARGUMENT_INVALID';
      throw error;
    }
    const value = argv[index + 1];
    if (!['trae', 'cursor', 'codex'].includes(value)) {
      const error = new Error('--host must be trae, cursor, or codex');
      error.code = 'WORKFLOW_DOCTOR_ARGUMENT_INVALID';
      throw error;
    }
    options.host = value;
    index += 1;
  }
  return options;
}

export async function evaluateWorkflowDoctor(options = {}, dependencies = {}) {
  const root = realpathSync(options.repoRoot ?? repoRoot);
  const now = dependencies.now?.() ?? new Date();
  const resolvedSource =
    dependencies.sourceIdentity?.(root) ?? sourceIdentity(root);
  const source = { ...resolvedSource, root };
  const host = options.host ?? 'trae';
  const integrationResult = await capture(
    () => (dependencies.auditIntegration ?? runIntegrationAudit)(root, host),
    'AGENT_INTEGRATION_AUDIT_UNAVAILABLE',
  );
  const planResult = await capture(
    () => (dependencies.resolvePlan ?? resolvePlan)(root),
    'PLAN_MOUNT_UNAVAILABLE',
  );
  const snapshotResult = await capture(
    () => (dependencies.buildSnapshot ?? buildWorkflowSnapshot)(),
    'WORKFLOW_SNAPSHOT_UNAVAILABLE',
  );
  const documentResult = await capture(
    () => readDoctorDocuments(root, dependencies.readFile),
    'WORKFLOW_DOCUMENTATION_UNAVAILABLE',
  );
  const reviewResult = await capture(
    () => {
      if (!planResult.ok) {
        throw Object.assign(new Error(), { code: planResult.code });
      }
      if (!snapshotResult.ok) {
        throw Object.assign(new Error(), { code: snapshotResult.code });
      }
      const resolver =
        dependencies.resolveReview ??
        ((...args) => resolveDoctorReview(...args, dependencies));
      return resolver(
        root,
        source,
        planResult.value,
        snapshotResult.value,
      );
    },
    'COMPLETION_REVIEW_UNAVAILABLE',
  );

  const promises = [
    integrationPromise(integrationResult),
    mountPromise(planResult, source),
    planResult.ok
      ? currentWorkflowPromise(snapshotResult, source, planResult)
      : blocked('dev.workflow.current', 'PLAN_MOUNT_UNAVAILABLE'),
    reviewPromise(reviewResult),
    docsPromise(documentResult),
  ];
  return {
    schemaVersion: WORKFLOW_DOCTOR_SCHEMA_VERSION,
    kind: WORKFLOW_DOCTOR_KIND,
    status: promises.every((promise) => promise.status === 'PASS')
      ? 'PASS'
      : 'BLOCKED',
    checkedAt: now.toISOString(),
    source: {
      workspaceId: source.workspaceId,
      branch: source.branch,
      head: source.head,
    },
    promises,
  };
}

export async function runWorkflowDoctorCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const options = parseArguments(argv);
  return evaluateWorkflowDoctor(
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
