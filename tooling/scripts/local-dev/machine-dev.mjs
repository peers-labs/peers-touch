#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MachineDevError,
  buildLeaseCommand,
  canonicalize,
  checkWorkspace,
  registerWorkspace,
  selectWorkspaceProfile,
  statusAll,
  unregisterWorkspace,
  updateWorkspace,
  validateLeaseRequest,
  verifyHeldLease,
} from './machine-dev-registry.mjs';

const OPTION_NAMES = new Map([
  ['workspace-root', 'workspaceRoot'],
  ['workspace-id', 'workspaceId'],
  ['env-repo', 'envRepo'],
  ['home', 'home'],
  ['profile', 'profile'],
  ['slot', 'slot'],
  ['capabilities', 'capabilities'],
  ['purpose', 'purpose'],
  ['owner', 'owner'],
  ['budget-seconds', 'budgetSeconds'],
  ['resource-kind', 'resourceKind'],
  ['resource-id', 'resourceId'],
  ['reset-scope', 'resetScope'],
  ['format', 'format'],
]);

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  let command = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--') {
      command = rest.slice(index + 1);
      break;
    }
    if (!token.startsWith('--')) {
      throw new MachineDevError(
        'INVALID_ARGUMENT',
        `unexpected argument: ${token}`,
      );
    }
    const optionName = OPTION_NAMES.get(token.slice(2));
    if (!optionName) {
      throw new MachineDevError(
        'INVALID_ARGUMENT',
        `unsupported option: ${token}`,
      );
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new MachineDevError(
        'INVALID_ARGUMENT',
        `missing value for ${token}`,
      );
    }
    options[optionName] = value;
    index += 1;
  }
  if (command !== null) options.command = command;
  return { action, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function outputShell(resolved) {
  const values = {
    PT_MACHINE_DEV_AUTHORITY: resolved.authority,
    PT_MACHINE_WORKSPACE_ID: resolved.binding.workspaceId,
    PT_MACHINE_WORKSPACE_ROOT: resolved.binding.canonicalRoot,
    PT_MACHINE_WORKSPACE_STATE_ROOT: resolved.workspaceStateRoot,
    PT_MACHINE_PROFILE_FILE: resolved.profile.profileFile,
    PT_MACHINE_PROFILE_SOURCE_STATE: resolved.profile.sourceState,
    PT_MACHINE_ALLOWED_CAPABILITIES:
      resolved.binding.allowedCapabilities.join(','),
    PT_MACHINE_PROFILE: resolved.binding.profile,
    PT_MACHINE_SLOT: resolved.binding.slot,
    PT_MACHINE_DESKTOP_APP_GATEWAY_PORT: resolved.ports.desktopAppGateway,
    PT_MACHINE_DESKTOP_APP_WEB_PORT: resolved.ports.desktopAppWeb,
    PT_MACHINE_DESKTOP_WEB_GATEWAY_PORT: resolved.ports.desktopWebGateway,
    PT_MACHINE_DESKTOP_WEB_WEB_PORT: resolved.ports.desktopWebWeb,
    PT_MACHINE_MOBILE_WEB_PORT: resolved.ports.mobileWeb,
  };
  for (const [key, value] of Object.entries(values)) {
    process.stdout.write(`export ${key}=${shellQuote(value)}\n`);
  }
}

function requireOption(options, key) {
  if (options[key] === undefined || options[key] === '') {
    throw new MachineDevError(
      'INVALID_ARGUMENT',
      `${key} is required for this action`,
    );
  }
}

function runLease(options) {
  if (!Array.isArray(options.command) || options.command.length === 0) {
    throw new MachineDevError(
      'INVALID_ARGUMENT',
      'a command is required after --',
    );
  }
  const runner = buildLeaseCommand(options);
  return new Promise((resolve) => {
    const child = spawn(runner.executable, runner.arguments, {
      stdio: 'inherit',
    });
    let forwardedSignal = null;
    const handlers = new Map();
    for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        forwardedSignal = signalName;
        if (child.exitCode === null) child.kill(signalName);
      };
      handlers.set(signalName, handler);
      process.on(signalName, handler);
    }
    child.once('error', (error) => {
      for (const [signalName, handler] of handlers) {
        process.off(signalName, handler);
      }
      process.stderr.write(
        `${JSON.stringify({
          status: 'BLOCKED',
          code: 'LEASE_RUNNER_UNAVAILABLE',
          message: String(error),
        })}\n`,
      );
      resolve(2);
    });
    child.once('close', (code, signalName) => {
      for (const [registeredSignal, handler] of handlers) {
        process.off(registeredSignal, handler);
      }
      if (typeof code === 'number') {
        resolve(code);
        return;
      }
      const effectiveSignal = signalName ?? forwardedSignal;
      resolve(
        effectiveSignal && effectiveSignal in SIGNAL_EXIT_CODES
          ? SIGNAL_EXIT_CODES[effectiveSignal]
          : 2,
      );
    });
  });
}

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export async function runCli(argv) {
  const { action, options } = parseArguments(argv);
  options.envRepo ??= process.env.PT_ENV_REPO;
  switch (action) {
    case 'register':
      for (const key of [
        'profile',
        'slot',
        'capabilities',
        'purpose',
        'owner',
      ]) {
        requireOption(options, key);
      }
      output(registerWorkspace(options));
      return 0;
    case 'select':
      for (const key of ['profile', 'owner']) {
        requireOption(options, key);
      }
      output(selectWorkspaceProfile(options));
      return 0;
    case 'update':
      output(updateWorkspace(options));
      return 0;
    case 'unregister':
      requireOption(options, 'owner');
      output(unregisterWorkspace(options));
      return 0;
    case 'check':
      output(checkWorkspace(options));
      return 0;
    case 'resolve': {
      const resolved = checkWorkspace(options);
      if (options.format === 'shell') {
        outputShell(resolved);
      } else if (options.format && options.format !== 'json') {
        throw new MachineDevError(
          'INVALID_ARGUMENT',
          'format must be json or shell',
        );
      } else {
        output(resolved);
      }
      return 0;
    }
    case 'status-all':
      output(statusAll(options));
      return 0;
    case 'validate-lease':
      output(validateLeaseRequest(options));
      return 0;
    case 'verify-held':
      output(verifyHeldLease(options));
      return 0;
    case 'lease':
      return runLease(options);
    default:
      throw new MachineDevError(
        'INVALID_ARGUMENT',
        'action must be register, select, update, unregister, check, resolve, status-all, validate-lease, verify-held, or lease',
      );
  }
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const payload =
      error instanceof MachineDevError
        ? {
            status: 'BLOCKED',
            code: error.code,
            message: error.message,
            detail: error.detail,
          }
        : {
            status: 'BLOCKED',
            code: 'MACHINE_DEV_INTERNAL_ERROR',
            message: String(error),
          };
    process.stderr.write(`${JSON.stringify(canonicalize(payload), null, 2)}\n`);
    process.exitCode = 2;
  }
}
