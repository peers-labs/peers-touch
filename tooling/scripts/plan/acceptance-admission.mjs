#!/usr/bin/env node

import path from 'node:path';

import { isDirectInvocation, repoRoot } from '../lib/machine-dev-paths.mjs';
import { loadSessionStoreFromPath } from '../local-dev/dev-session-store.mjs';
import { loadPlanPackage } from './plan-package.mjs';
import { resolveWorkspacePlanBinding } from './workspace-plan-binding.mjs';

const ACCEPTANCE_STATES = new Set(['ACCEPTANCE_RUNNING']);
const GAP_STATES = new Set(['ACCEPTANCE_PASS', 'DELIVERY_READY']);

export class AcceptanceAdmissionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'AcceptanceAdmissionError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new AcceptanceAdmissionError(code, message, detail);
}

export async function admitAcceptance(options = {}, dependencies = {}) {
  const workspaceRoot = path.resolve(options.repoRoot ?? repoRoot);
  const mode = options.mode;
  if (!['acceptance', 'gap'].includes(mode)) {
    fail('ACCEPTANCE_ADMISSION_INVALID', 'mode must be acceptance or gap');
  }
  if (typeof options.session !== 'string' || options.session === '') {
    fail(
      'ACCEPTANCE_SESSION_REQUIRED',
      'broad Acceptance requires an explicit Development Session',
    );
  }
  const resolveBinding =
    dependencies.resolveWorkspacePlanBinding ?? resolveWorkspacePlanBinding;
  const binding = await resolveBinding({
    home: options.home,
    repoRoot: workspaceRoot,
  });
  const planPath = options.plan
    ? path.resolve(workspaceRoot, options.plan)
    : path.resolve(workspaceRoot, binding.planPath);
  const loadPlan = dependencies.loadPlanPackage ?? loadPlanPackage;
  const plan = await loadPlan(planPath, { repoRoot: workspaceRoot });
  const relativePlan = path
    .relative(workspaceRoot, plan.path)
    .split(path.sep)
    .join('/');
  if (
    binding.planId !== plan.manifest.planId ||
    binding.planPath !== relativePlan ||
    plan.manifest.status !== 'active' ||
    plan.currentTask === null
  ) {
    fail(
      'ACCEPTANCE_PLAN_NOT_READY',
      'broad Acceptance requires the bound active Plan and current Task',
      {
        planId: plan.manifest.planId,
        planStatus: plan.manifest.status,
        currentTaskId: plan.currentTask?.taskId ?? null,
      },
    );
  }
  const closureGates =
    plan.acceptance.closures[plan.currentTask.closureId] ?? [];
  if (closureGates.length === 0) {
    fail(
      'ACCEPTANCE_PLAN_NOT_READY',
      'current Task has no formal Acceptance closure',
      { taskId: plan.currentTask.taskId },
    );
  }
  let session;
  try {
    session = (
      dependencies.loadSessionStoreFromPath ?? loadSessionStoreFromPath
    )(options.session, {
      expected: {
        planId: plan.manifest.planId,
        taskId: plan.currentTask.taskId,
        workspaceId: plan.manifest.binding.workspaceId,
        branch: plan.manifest.binding.branch,
      },
    });
  } catch (error) {
    fail(
      'ACCEPTANCE_SESSION_INVALID',
      'Development Session is unavailable or does not match the current Task',
      { cause: error?.code ?? error?.message ?? String(error) },
    );
  }
  const state = session.state.state;
  const allowed = mode === 'acceptance' ? ACCEPTANCE_STATES : GAP_STATES;
  if (!allowed.has(state)) {
    fail(
      'ACCEPTANCE_FUNCTIONAL_FRONTIER_REQUIRED',
      mode === 'acceptance'
        ? 'broad Acceptance may start only from ACCEPTANCE_RUNNING'
        : 'Gap Detector requires successful formal Acceptance',
      {
        taskId: plan.currentTask.taskId,
        completionClass: plan.currentTask.completionClass,
        state,
        allowedStates: [...allowed],
      },
    );
  }
  return {
    ok: true,
    mode,
    planId: plan.manifest.planId,
    taskId: plan.currentTask.taskId,
    closureId: plan.currentTask.closureId,
    sessionId: session.state.sessionId,
    sessionState: state,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!['--repo-root', '--home', '--plan', '--session', '--mode'].includes(token)) {
      fail('ACCEPTANCE_ADMISSION_INVALID', `unsupported option: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail('ACCEPTANCE_ADMISSION_INVALID', `missing value for ${token}`);
    }
    options[
      {
        '--repo-root': 'repoRoot',
        '--home': 'home',
        '--plan': 'plan',
        '--session': 'session',
        '--mode': 'mode',
      }[token]
    ] = value;
    index += 1;
  }
  return options;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        await admitAcceptance(parseArguments(process.argv.slice(2))),
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? 'ACCEPTANCE_ADMISSION_FAILED',
          message: error?.message ?? String(error),
          detail: error?.detail ?? {},
        },
      })}\n`,
    );
    process.exitCode = 2;
  }
}
