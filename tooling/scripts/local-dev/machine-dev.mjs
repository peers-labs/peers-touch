#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  MachineDevError,
  buildLeaseCommand,
  canonicalize,
  checkWorkspace,
  profileEnvironment,
  registerWorkspace,
  selectWorkspaceProfile,
  statusAll,
  unregisterWorkspace,
  unregisterWorkspaceByIdentity,
  updateWorkspace,
  validateLeaseRequest,
  verifyHeldLease,
} from './machine-dev-registry.mjs';
import { MachineResourceOwner } from './machine-dev-resource-store.mjs';
import { RESOURCE_KIND, readResourceState } from './machine-dev-resource-contract.mjs';
import { IOSResourceProvider } from './machine-dev-ios-provider.mjs';

const OPTION_NAMES = new Map([
  ['workspace-root', 'workspaceRoot'],
  ['workspace-id', 'workspaceId'],
  ['env-repo', 'envRepo'],
  ['home', 'home'],
  ['profile', 'profile'],
  ['target-profile', 'targetProfile'],
  ['slot', 'slot'],
  ['capabilities', 'capabilities'],
  ['purpose', 'purpose'],
  ['owner', 'owner'],
  ['budget-seconds', 'budgetSeconds'],
  ['resource-kind', 'resourceKind'],
  ['resource-id', 'resourceId'],
  ['reset-scope', 'resetScope'],
  ['expected-branch', 'expectedBranch'],
  ['expected-head', 'expectedHead'],
  ['expected-workspace-digest', 'expectedWorkspaceDigest'],
  ['names-json', 'namesJson'],
  ['selection-keys-json', 'selectionKeysJson'],
  ['count', 'count'],
  ['create', 'create'],
  ['preparation-id', 'preparationId'],
  ['snapshot', 'snapshot'],
  ['selector', 'selector'],
  ['resource-action', 'resourceAction'],
  ['target-file', 'targetFile'],
  ['app-path', 'appPath'],
  ['operation-id', 'operationId'],
  ['decision', 'decision'],
  ['impact-digest', 'impactDigest'],
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
    ...profileEnvironment(resolved.profile),
    PT_MACHINE_DEV_AUTHORITY: resolved.authority,
    PT_MACHINE_WORKSPACE_ID: resolved.binding.workspaceId,
    PT_MACHINE_WORKSPACE_ROOT: resolved.binding.canonicalRoot,
    PT_MACHINE_WORKSPACE_STATE_ROOT: resolved.workspaceStateRoot,
    PT_MACHINE_PROFILE_FILE: resolved.profile.profileFile,
    PT_MACHINE_PROFILE_SOURCE_STATE: resolved.profile.sourceState,
    PT_MACHINE_ALLOWED_CAPABILITIES:
      resolved.binding.allowedCapabilities.join(','),
    PT_MACHINE_PROFILE: resolved.binding.profile,
    PT_MACHINE_TARGET_PROFILE: resolved.profile.profile,
    PT_MACHINE_SLOT: resolved.binding.slot,
    PT_MACHINE_DESKTOP_APP_GATEWAY_PORT: resolved.ports.desktopAppGateway,
    PT_MACHINE_DESKTOP_APP_WEB_PORT: resolved.ports.desktopAppWeb,
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
      stdio: inheritedDescriptors(),
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

function inheritedDescriptors() {
  const descriptors = ['inherit', 'inherit', 'inherit'];
  const frames = JSON.parse(process.env.PT_MACHINE_LEASE_STACK_JSON ?? '[]');
  for (const frame of frames) {
    const fd = Number(frame.fd);
    if (!Number.isInteger(fd) || fd < 3 || fd > 128) throw new MachineDevError('RUNTIME_IDENTITY_MISMATCH', 'invalid inherited descriptor');
    while (descriptors.length <= fd) descriptors.push('ignore');
    descriptors[fd] = fd;
  }
  return descriptors;
}

function readTarget(options) {
  return options.targetFile ? JSON.parse(readFileSync(options.targetFile, 'utf8')) : null;
}

function operationFor(options) {
  requireOption(options, 'operationId');
  const operation = readResourceState(options).operations.find((item) => item.id === options.operationId);
  if (!operation) throw new MachineDevError('RESOURCE_OPERATION_MISMATCH', 'unknown resource operation');
  return operation;
}

async function mutateResource(options) {
  const owner = new MachineResourceOwner(options);
  const operation = owner.begin(options.operationId);
  const provider = new IOSResourceProvider();
  let code = 0;
  let failure = null;
  try {
    if (operation.action === 'boot') provider.boot(operation.providerId);
    else if (operation.action === 'install') provider.install(operation.providerId, operation.appPath);
    else if (operation.action === 'reset') provider.reset(operation.providerId);
    else if (operation.action === 'delete') provider.delete(operation.providerId);
    else if (options.command?.length) {
      provider.boot(operation.providerId);
      code = await new Promise((resolve, reject) => {
        const child = spawn(options.command[0], options.command.slice(1), {
          stdio: inheritedDescriptors(),
          env: {
            ...process.env,
            PT_MACHINE_RESOURCE_ID: operation.resourceId,
            PT_MACHINE_RESOURCE_PROVIDER_ID: operation.providerId,
            PT_MACHINE_RESOURCE_OPERATION_ID: operation.id,
          },
        });
        child.once('error', reject);
        child.once('close', (exitCode, signalName) => resolve(exitCode ?? SIGNAL_EXIT_CODES[signalName] ?? 2));
      });
      if (code !== 0) failure = new Error(`runtime exited with ${code}`);
    }
  } catch (error) {
    failure = error;
    code = 2;
  }
  output(owner.finish(operation.id, failure));
  if (failure) throw failure;
  return code;
}

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export async function runCli(argv) {
  const { action, options } = parseArguments(argv);
  options.envRepo ??= process.env.PT_ENV_REPO;
  if (['check', 'resolve', 'validate-lease', 'verify-held', 'lease'].includes(action) || action?.startsWith('resource-')) {
    options.targetProfile ??= process.env.PT_DEV_TARGET_PROFILE;
  } else if (options.targetProfile !== undefined) {
    throw new MachineDevError(
      'INVALID_ARGUMENT', 'target-profile is an operation target, not a binding update',
    );
  }
  switch (action) {
    case 'resource-discover':
      output(new MachineResourceOwner(options).discover());
      return 0;
    case 'resource-assign':
      output(new MachineResourceOwner(options).assign({
        names: options.namesJson ? JSON.parse(options.namesJson) : undefined,
        selectionKeys: options.selectionKeysJson ? JSON.parse(options.selectionKeysJson) : undefined,
        count: options.count, purpose: options.purpose, snapshot: options.snapshot,
        create: options.create === 'true', preparationId: options.preparationId,
      }));
      return 0;
    case 'resource-inspect':
      output(new MachineResourceOwner(options).inspectAssignments());
      return 0;
    case 'resource-binding':
      output(new MachineResourceOwner(options).binding(options.selector));
      return 0;
    case 'resource-run-ios': {
      const resolved = checkWorkspace({ ...options, capabilities: ['station.connect'] });
      const frames = JSON.parse(process.env.PT_MACHINE_LEASE_STACK_JSON ?? '[]');
      if (!frames.some((item) => item.kind === 'local.slot' && item.resourceId === String(resolved.binding.slot))) {
        const command = [process.execPath, path.resolve(import.meta.dirname, 'machine-dev.mjs'), ...argv];
        return runLease({ ...options, resourceKind: 'local.slot', resourceId: String(resolved.binding.slot),
          budgetSeconds: options.budgetSeconds ?? 43200, command });
      }
      verifyHeldLease({ ...options, resourceKind: 'local.slot', resourceId: String(resolved.binding.slot) });
      const owner = new MachineResourceOwner(options);
      const operation = options.operationId ? operationFor(options) : owner.propose({
        selector: options.selector, action: 'use',
        target: {
          bundleId: 'com.peers.touch.mobile', source: owner.source(resolved),
          devUrl: `http://127.0.0.1:${resolved.ports.mobileWeb}`,
          stationUrl: resolved.profile.stationUrl,
          purpose: options.purpose ?? 'Mobile development',
        },
      });
      process.stderr.write(`${JSON.stringify({ profile: resolved.profile.profile, operation }, null, 2)}\n`);
      if (operation.status !== 'ready') {
        throw new MachineDevError('RESOURCE_DECISION_REQUIRED', 'review this operation impact and choose force or decline with resource-decide, then resume this operation', operation);
      }
      const execution = ['resource-execute', '--operation-id', operation.id];
      for (const [flag, value] of [
        ['workspace-root', resolved.binding.canonicalRoot], ['env-repo', options.envRepo],
        ['home', options.home], ['target-profile', resolved.profile.profile],
        ['budget-seconds', options.budgetSeconds ?? 43200],
      ]) {
        if (value !== undefined) execution.push(`--${flag}`, String(value));
      }
      return runCli([...execution, '--', ...(options.command ?? [])]);
    }
    case 'resource-use-install':
      for (const key of ['operationId', 'appPath']) requireOption(options, key);
      output(new MachineResourceOwner(options).installDuringUse(options.operationId, options.appPath));
      return 0;
    case 'resource-build-identity':
      requireOption(options, 'operationId');
      process.stdout.write(JSON.stringify(canonicalize(new MachineResourceOwner(options).buildIdentity(options.operationId))));
      return 0;
    case 'resource-check-dev-endpoint': {
      const operation = operationFor(options);
      output(new MachineResourceOwner(options).checkDevEndpoint(operation.providerId, operation.target.devUrl));
      return 0;
    }
    case 'resource-detach':
      requireOption(options, 'resourceId');
      output(new MachineResourceOwner(options).detach(options.resourceId));
      return 0;
    case 'resource-propose':
      requireOption(options, 'resourceAction');
      output(new MachineResourceOwner(options).propose({
        resourceId: options.resourceId, selector: options.selector,
        action: options.resourceAction, target: readTarget(options), appPath: options.appPath,
      }));
      return 0;
    case 'resource-decide':
      for (const key of ['operationId', 'decision', 'impactDigest']) requireOption(options, key);
      output(new MachineResourceOwner(options).decide(options.operationId, options.decision, options.impactDigest));
      return 0;
    case 'resource-execute':
    case 'resource-recover': {
      const operation = operationFor(options);
      if (action === 'resource-execute' && operation.status !== 'ready') {
        throw new MachineDevError('RESOURCE_DECISION_REQUIRED', 'operation requires its specific overwrite decision', operation);
      }
      const command = [
        process.execPath, path.resolve(import.meta.dirname, 'machine-dev.mjs'),
        action === 'resource-execute' ? 'resource-mutate' : 'resource-reconcile',
        '--workspace-root', options.workspaceRoot ?? process.cwd(),
        '--operation-id', operation.id,
      ];
      for (const [flag, value] of [['env-repo', options.envRepo], ['home', options.home], ['target-profile', options.targetProfile]]) {
        if (value) command.push(`--${flag}`, value);
      }
      if (options.command?.length) command.push('--', ...options.command);
      return runLease({
        ...options, resourceKind: RESOURCE_KIND, resourceId: operation.providerId,
        budgetSeconds: options.budgetSeconds ?? 3600, command,
      });
    }
    case 'resource-mutate':
      requireOption(options, 'operationId');
      return mutateResource(options);
    case 'resource-reconcile':
      requireOption(options, 'operationId');
      output(new MachineResourceOwner(options).recoverOperation(options.operationId));
      return 0;
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
      output(
        options.workspaceId === undefined
          ? unregisterWorkspace(options)
          : unregisterWorkspaceByIdentity(options),
      );
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
      error instanceof MachineDevError || typeof error?.code === 'string'
        ? {
            status: 'BLOCKED',
            code: error.code,
            message: error.message,
            detail: error.detail ?? error.details ?? {},
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
