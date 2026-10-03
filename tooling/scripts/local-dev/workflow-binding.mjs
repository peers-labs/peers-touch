#!/usr/bin/env node

import {
  isDirectInvocation,
} from '../lib/machine-dev-paths.mjs';
import {
  createWorkflowBindingAssignment,
  readWorkflowBindingContextByActor,
  terminalizeWorkflowChild,
} from './workflow-binding-store.mjs';

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function parseArguments(argv) {
  const [action, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const token = tokens[index];
    const value = tokens[index + 1];
    if (!token?.startsWith('--') || value === undefined) {
      fail('WORKFLOW_BINDING_USAGE', 'Binding command arguments are invalid');
    }
    options[token.slice(2)] = value;
  }
  if (!['assign', 'status', 'terminal'].includes(action)) {
    fail(
      'WORKFLOW_BINDING_USAGE',
      'Action must be assign, status, or terminal',
    );
  }
  return { action, options };
}

function parseActor(source) {
  try {
    const actor = JSON.parse(source);
    if (actor === null || typeof actor !== 'object' || Array.isArray(actor)) {
      throw new Error('actor is not an object');
    }
    return actor;
  } catch (error) {
    fail('WORKFLOW_BINDING_USAGE', `--actor must be JSON: ${error.message}`);
  }
}

export function runWorkflowBindingCli(argv, dependencies = {}) {
  const { action, options } = parseArguments(argv);
  if (!options.actor) {
    fail('WORKFLOW_BINDING_USAGE', '--actor is required');
  }
  const context = (
    dependencies.readWorkflowBindingContextByActor ??
    readWorkflowBindingContextByActor
  )(parseActor(options.actor), {
    machineRoot: dependencies.machineRoot,
    now: dependencies.now,
  });
  if (action === 'status') {
    return { status: 'PASS', action, projection: context.projection };
  }
  if (action === 'assign') {
    if (
      !options.role ||
      !options['workflow-session'] ||
      !options.operation
    ) {
      fail(
        'WORKFLOW_BINDING_USAGE',
        'assign requires --role, --workflow-session, and --operation',
      );
    }
    const leaseSeconds = Number(options['lease-seconds'] ?? 1800);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
      fail('WORKFLOW_BINDING_USAGE', '--lease-seconds must be positive');
    }
    const result = (
      dependencies.createWorkflowBindingAssignment ??
      createWorkflowBindingAssignment
    )(
      context.projection,
      {
        assignmentId: options.assignment,
        role: options.role,
        workflowSessionId: options['workflow-session'],
        operationId: options.operation,
        leaseMs: leaseSeconds * 1000,
      },
      {
        machineRoot: dependencies.machineRoot,
        now: dependencies.now,
      },
    );
    return { status: 'PASS', action, ...result };
  }
  if (context.projection.role === 'OWNER') {
    fail(
      'WORKFLOW_BINDING_TERMINAL_INVALID',
      'OWNER lifecycle is closed only by an Anchor-bound release',
    );
  }
  const terminal = (
    dependencies.terminalizeWorkflowChild ?? terminalizeWorkflowChild
  )(context.binding, options.result, {
    machineRoot: dependencies.machineRoot,
    now: dependencies.now,
  });
  return { status: 'PASS', action, terminal };
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(runWorkflowBindingCli(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error.code ?? 'WORKFLOW_BINDING_FAILED',
        message: error.message,
      })}\n`,
    );
    process.exitCode = 2;
  }
}
