#!/usr/bin/env node

import path from 'node:path';

import {
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../../../scripts/lib/machine-dev-paths.mjs';
import {
  readLivePlanMountId,
  resolvePlanMountByIdentity,
} from '../../../scripts/plan/plan-mount.mjs';
import { readActiveWorkRecord } from '../../../scripts/local-dev/active-work-store.mjs';
import { readDevelopmentCloseReceipt } from '../../../scripts/local-dev/development-close-store.mjs';
import { statusAll as statusAllDeclarations } from '../../../scripts/local-dev/dev-work-ledger.mjs';
import { statusDevelopmentSession } from '../../../scripts/local-dev/dev-session.mjs';
import {
  COMPLETION_AUDIT_CLAIM_CLASSES,
  COMPLETION_AUDIT_MODES,
  evaluateCompletionSnapshot,
} from './completion-audit-schema.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;

class CompletionAuditError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CompletionAuditError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CompletionAuditError(code, message, details);
}

function required(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    (pattern && !pattern.test(value))
  ) {
    fail('COMPLETION_AUDIT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function resolveSelector(options) {
  const workItemId = required(
    options.workItemId,
    'workItemId',
    IDENTIFIER,
  );
  if (options.workspaceId !== undefined) {
    const workspaceId = required(
      options.workspaceId,
      'workspaceId',
      WORKSPACE_ID,
    );
    if (options.repoRoot !== undefined) {
      const root = path.resolve(options.repoRoot);
      const derived = workspaceIdForRoot(root);
      if (derived !== workspaceId) {
        fail(
          'COMPLETION_AUDIT_SELECTOR_MISMATCH',
          'workspaceId does not match repoRoot',
          { expected: derived, actual: workspaceId },
        );
      }
    }
    return { workspaceId, workItemId };
  }
  const root = path.resolve(options.repoRoot ?? repoRoot);
  return {
    workspaceId: workspaceIdForRoot(root),
    workItemId,
  };
}

function exactDeclaration(options, selector) {
  const declarations = statusAllDeclarations({
    home: options.home,
  }).declarations.filter(
    (declaration) =>
      declaration.workspaceId === selector.workspaceId &&
      declaration.workItemId === selector.workItemId,
  );
  if (declarations.length > 1) {
    fail(
      'COMPLETION_AUDIT_SELECTOR_AMBIGUOUS',
      'multiple declarations match the selector',
      { declarations: declarations.map((value) => value.declarationId) },
    );
  }
  return declarations[0] ?? null;
}

function currentSession(options, selector, declaration, activeWork) {
  if (declaration === null && activeWork === null) return null;
  const sessionId = declaration?.sessionId ?? activeWork?.sessionId;
  try {
    const session = statusDevelopmentSession({
      home: options.home,
      workspaceId: selector.workspaceId,
      workItemId: selector.workItemId,
      sessionId,
      planId: declaration?.planId ?? activeWork?.planId,
      taskId: declaration?.taskId ?? activeWork?.currentTaskId,
      branch: declaration?.branch ?? activeWork?.branch,
    });
    return {
      sessionId: session.state.sessionId,
      state: session.state.state,
      eventDigest: session.eventDigest,
    };
  } catch (error) {
    if (error?.code === 'SESSION_UNAVAILABLE') return null;
    throw error;
  }
}

function trackedExecution(options, selector, closeReceipt) {
  const mountId =
    options.mountId ??
    closeReceipt?.mountId ??
    readLivePlanMountId(selector.workspaceId, { home: options.home });
  if (mountId === null) return { mount: null, run: null };
  const execution = resolvePlanMountByIdentity({
    home: options.home,
    workspaceId: selector.workspaceId,
    mountId,
    allowReleased: true,
  });
  return {
    mount: {
      mountId: execution.mount.mountId,
      state: execution.mount.state,
      recordDigest: execution.mount.recordDigest,
    },
    run: {
      runId: execution.run.runId,
      state: execution.run.state,
      recordDigest: execution.run.recordDigest,
    },
  };
}

export function collectCompletionSnapshot(options = {}) {
  const selector = resolveSelector(options);
  const mode = required(options.mode, 'mode');
  const claimClass = required(options.claimClass, 'claimClass');
  if (!COMPLETION_AUDIT_MODES.has(mode)) {
    fail(
      'COMPLETION_AUDIT_INVALID',
      'mode must be tracked or standalone',
    );
  }
  if (!COMPLETION_AUDIT_CLAIM_CLASSES.has(claimClass)) {
    fail(
      'COMPLETION_AUDIT_INVALID',
      'claimClass must be implementation-ready, delivery-ready, or close-ready',
    );
  }
  const declaration = exactDeclaration(options, selector);
  const activeWork = readActiveWorkRecord({
    home: options.home,
    workspaceId: selector.workspaceId,
  });
  const closeReceipt = readDevelopmentCloseReceipt({
    home: options.home,
    workspaceId: selector.workspaceId,
    workItemId: selector.workItemId,
  });
  const execution =
    mode === 'tracked'
      ? trackedExecution(options, selector, closeReceipt)
      : {
          mount:
            readLivePlanMountId(selector.workspaceId, {
              home: options.home,
            }) === null
              ? null
              : { state: 'mounted' },
          run: null,
        };
  return {
    selector: {
      ...selector,
      mountId: execution.mount?.mountId ?? null,
    },
    mode,
    claimClass,
    declaration,
    activeWork,
    session: currentSession(
      options,
      selector,
      declaration,
      activeWork,
    ),
    closeReceipt,
    mount: execution.mount,
    run: execution.run,
  };
}

export function auditCompletion(options = {}) {
  return evaluateCompletionSnapshot(collectCompletionSnapshot(options));
}

const OPTION_NAMES = {
  home: 'home',
  'repo-root': 'repoRoot',
  'workspace-id': 'workspaceId',
  'work-item': 'workItemId',
  'mount-id': 'mountId',
  mode: 'mode',
  'claim-class': 'claimClass',
};

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      fail('COMPLETION_AUDIT_INVALID', `unexpected argument: ${token}`);
    }
    const optionName = OPTION_NAMES[token.slice(2)];
    if (!optionName) {
      fail('COMPLETION_AUDIT_INVALID', `unsupported option: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('COMPLETION_AUDIT_INVALID', `missing value for ${token}`);
    }
    options[optionName] = value;
    index += 1;
  }
  return options;
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function runCli(argv = process.argv.slice(2)) {
  const report = auditCompletion(parseArguments(argv));
  output(report);
  if (report.status !== 'PASS') process.exitCode = 2;
  return report;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    output(
      {
        kind: 'peers-touch-completion-audit',
        status: 'BLOCKED',
        error: {
          code: error?.code ?? 'COMPLETION_AUDIT_INTERNAL_ERROR',
          message: error?.message ?? String(error),
          details: error?.details ?? {},
        },
      },
      process.stderr,
    );
    process.exitCode = 2;
  }
}
