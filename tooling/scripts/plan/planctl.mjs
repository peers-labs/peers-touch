#!/usr/bin/env node

import path from 'node:path';

import {
  PlanPackageError,
  isDirectInvocation,
  loadPlanPackage,
  summarizePlanPackage,
} from './plan-package.mjs';

const READ_OPTIONS = new Set(['plan', 'repo-root']);

function fail(code, message, details) {
  throw new PlanPackageError(code, message, details);
}

function parseArguments(argv) {
  if (argv.length === 0) fail('PLAN_CLI_USAGE', 'Command is required');
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token === '--') {
      fail('PLAN_CLI_USAGE', 'Unexpected positional argument', {
        argument: token,
      });
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('PLAN_CLI_USAGE', `Option --${key} requires a value`);
    }
    if (Object.hasOwn(options, key)) {
      fail('PLAN_CLI_USAGE', `Option --${key} may appear only once`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail('PLAN_CLI_USAGE', `--${key} is required`);
  }
  return value;
}

function assertAllowedOptions(options, allowed) {
  const accepted = allowed instanceof Set ? allowed : new Set(allowed);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (unknown.length > 0) {
    fail('PLAN_CLI_USAGE', 'Unknown command option', { unknown });
  }
}

function explicitPlanPath(options) {
  const plan = requireOption(options, 'plan');
  const root = path.resolve(options['repo-root'] ?? process.cwd());
  return path.isAbsolute(plan) ? path.resolve(plan) : path.resolve(root, plan);
}

async function loadExplicitPlan(options) {
  return loadPlanPackage(explicitPlanPath(options), {
    repoRoot: options['repo-root'],
  });
}

function taskProjection(plan, task) {
  return {
    id: task.id,
    workstreamId: task.workstreamId,
    path: task.path,
    dependsOn: task.dependsOn,
    slice: plan.taskSlices.get(task.id),
  };
}

async function validateCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  const plan = await loadExplicitPlan(options);
  return {
    ...summarizePlanPackage(plan),
    taskCount: plan.plan.tasks.length,
  };
}

async function inspectCommand(options) {
  assertAllowedOptions(options, READ_OPTIONS);
  const plan = await loadExplicitPlan(options);
  return {
    ...summarizePlanPackage(plan),
    tasks: plan.plan.tasks.map((task) => taskProjection(plan, task)),
  };
}

async function taskCommand(options) {
  assertAllowedOptions(options, [...READ_OPTIONS, 'task']);
  const plan = await loadExplicitPlan(options);
  const taskId = requireOption(options, 'task');
  const task = plan.plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    fail('PLAN_TASK_NOT_FOUND', 'Task does not exist in the selected Plan', {
      taskId,
    });
  }
  return {
    ok: true,
    plan: plan.path,
    planPath: plan.planPath,
    planId: plan.plan.planId,
    versionId: plan.plan.versionId,
    planVersionDigest: plan.planVersionDigest,
    task: taskProjection(plan, task),
  };
}

export async function runPlanctl(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'validate') return validateCommand(options);
  if (command === 'inspect') return inspectCommand(options);
  if (command === 'task') return taskCommand(options);
  fail('PLAN_CLI_USAGE', 'Unknown command', {
    command,
    commands: ['validate', 'inspect', 'task'],
  });
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runPlanctl(argv);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const normalized =
      error instanceof PlanPackageError
        ? error
        : new PlanPackageError(
            'PLAN_INTERNAL_ERROR',
            error?.message ?? String(error),
          );
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) {
  await main();
}
