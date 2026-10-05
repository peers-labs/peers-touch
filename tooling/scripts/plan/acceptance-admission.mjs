#!/usr/bin/env node

import path from 'node:path';

import { isDirectInvocation, repoRoot } from '../lib/machine-dev-paths.mjs';
import { loadSessionStoreFromPath } from '../local-dev/dev-session-store.mjs';
import { resolvePlanExecution } from './plan-mount.mjs';

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
  const execution = await (
    dependencies.resolvePlanExecution ?? resolvePlanExecution
  )({
    home: options.home,
    repoRoot: workspaceRoot,
  });
  const requestedPlan = options.plan
    ? path.resolve(workspaceRoot, options.plan)
    : execution.planPackage.path;
  const currentTaskId = execution.run.currentTaskId;
  const currentTask = currentTaskId
    ? execution.planPackage.taskSlices.get(currentTaskId)
    : null;
  if (
    requestedPlan !== execution.planPackage.path ||
    execution.run.state !== 'active' ||
    currentTask === null
  ) {
    fail(
      'ACCEPTANCE_PLAN_NOT_READY',
      'broad Acceptance requires the bound active Plan and current Task',
      {
        planId: execution.snapshot.planId,
        planStatus: execution.run.state,
        currentTaskId,
      },
    );
  }
  const closureGates =
    execution.snapshot.acceptance.closures[currentTask.closureId] ?? [];
  if (closureGates.length === 0) {
    fail(
      'ACCEPTANCE_PLAN_NOT_READY',
      'current Task has no formal Acceptance closure',
      { taskId: currentTask.taskId },
    );
  }
  let session;
  try {
    session = (
      dependencies.loadSessionStoreFromPath ?? loadSessionStoreFromPath
    )(options.session, {
      expected: {
        planId: execution.snapshot.planId,
        taskId: currentTask.taskId,
        workspaceId: execution.snapshot.executionBinding.workspaceId,
        branch: execution.snapshot.executionBinding.branch,
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
        taskId: currentTask.taskId,
        completionClass: currentTask.completionClass,
        state,
        allowedStates: [...allowed],
      },
    );
  }
  return {
    ok: true,
    mode,
    planId: execution.snapshot.planId,
    taskId: currentTask.taskId,
    closureId: currentTask.closureId,
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
