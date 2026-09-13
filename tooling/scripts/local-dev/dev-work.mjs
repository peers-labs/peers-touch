#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  checkDeclaration,
  heartbeatDeclaration,
  releaseDeclaration,
  startOrUpdateDeclaration,
  statusAll,
  statusCurrent,
} from './dev-work-ledger.mjs';
import {
  DevWorkError,
  canonicalize,
  digestDeclaration,
} from './dev-work-schema.mjs';

export { DevWorkError, digestDeclaration };
export {
  checkDeclaration,
  heartbeatDeclaration,
  processStartIdentity,
  readLedger,
  releaseDeclaration,
  startOrUpdateDeclaration,
  statusAll,
  statusCurrent,
} from './dev-work-ledger.mjs';

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new DevWorkError('INVALID_ARGUMENT', `unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new DevWorkError('INVALID_ARGUMENT', `missing value for --${key}`);
    }
    index += 1;
    const optionKey = {
      'work-item': 'workItemId',
      session: 'sessionId',
      journey: 'journeyId',
      owner: 'owner',
      purpose: 'purpose',
      branch: 'branch',
      'source-head': 'sourceHead',
      'source-claims': 'sourceClaims',
      'runtime-claims': 'runtimeClaims',
      'expires-minutes': 'expiresMinutes',
      'workspace-root': 'workspaceRoot',
      home: 'home',
    }[key];
    if (!optionKey) {
      throw new DevWorkError(
        'INVALID_ARGUMENT',
        `unsupported option: --${key}`,
      );
    }
    options[optionKey] = value;
  }
  return { action, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

export function runCli(argv) {
  const { action, options } = parseArguments(argv);
  switch (action) {
    case 'start':
      output(startOrUpdateDeclaration(options));
      break;
    case 'update':
      output(startOrUpdateDeclaration(options, { requireExisting: true }));
      break;
    case 'status':
      output(statusCurrent(options));
      break;
    case 'status-all':
      output(statusAll(options));
      break;
    case 'check':
      output(checkDeclaration(options));
      break;
    case 'heartbeat':
      output(heartbeatDeclaration(options));
      break;
    case 'release':
      output(releaseDeclaration(options));
      break;
    default:
      throw new DevWorkError(
        'INVALID_ARGUMENT',
        'action must be start, update, status, status-all, check, heartbeat, or release',
      );
  }
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const payload =
      error instanceof DevWorkError
        ? {
            status: 'BLOCKED',
            code: error.code,
            message: error.message,
            detail: error.detail,
          }
        : {
            status: 'BLOCKED',
            code: 'DEV_WORK_INTERNAL_ERROR',
            message: String(error),
          };
    process.stderr.write(`${JSON.stringify(canonicalize(payload), null, 2)}\n`);
    process.exitCode = 2;
  }
}
