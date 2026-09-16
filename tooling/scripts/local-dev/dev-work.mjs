#!/usr/bin/env node

import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';
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
  requireActiveDeclaration,
  startOrUpdateDeclaration,
  statusAll,
  statusCurrent,
} from './dev-work-ledger.mjs';

const OPTION_NAMES = {
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
};

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
    const optionKey = OPTION_NAMES[key];
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

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

export function runCli(argv, io = {}) {
  const { action, options } = parseArguments(argv);
  const write = io.output ?? output;
  let result;
  switch (action) {
    case 'start':
      result = startOrUpdateDeclaration(options);
      break;
    case 'update':
      result = startOrUpdateDeclaration(options, { requireExisting: true });
      break;
    case 'status':
      result = statusCurrent(options);
      break;
    case 'status-all':
      result = statusAll(options);
      break;
    case 'check':
      result = checkDeclaration(options);
      break;
    case 'heartbeat':
      result = heartbeatDeclaration(options);
      break;
    case 'release':
      result = releaseDeclaration(options);
      break;
    default:
      throw new DevWorkError(
        'INVALID_ARGUMENT',
        'action must be start, update, status, status-all, check, heartbeat, or release',
      );
  }
  write(result);
  return result;
}

function reportError(error) {
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
  output(payload, process.stderr);
  process.exitCode = 2;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
