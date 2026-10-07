#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  isDirectInvocation,
  repoRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  cancelExecutionRun,
  readLivePlanMountId,
  releasePlanMount,
  resolvePlanMountByIdentity,
} from '../plan/plan-mount.mjs';
import {
  clearActiveWorkRecord,
  readActiveWorkRecord,
} from './active-work-store.mjs';
import {
  createDevelopmentCloseReceipt,
  readDevelopmentCloseReceipt,
  updateDevelopmentCloseReceipt,
  writeDevelopmentCloseReceipt,
} from './development-close-store.mjs';
import {
  releaseDeclaration,
  statusAll as statusAllDeclarations,
} from './dev-work-ledger.mjs';
import {
  archiveSessionStore,
  loadSessionStore,
  sessionStorePaths,
} from './dev-session-store.mjs';
import { TERMINAL_STATES } from './dev-session-schema.mjs';
import {
  captureWorkspace,
  observeLeases,
  unregisterWorkspaceByIdentity,
} from './machine-dev-registry.mjs';
import {
  WorkspaceLifecycleLockError,
  withWorkspaceLifecycleLock,
} from './workspace-lifecycle-lock.mjs';
import {
  assertMatchingWorkflowOwner,
  requireWorkflowOwnerReference,
} from './workflow-owner-command-policy.mjs';
import {
  resolveWorkflowOwnerCommandContext,
} from './workflow-owner-context.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const MODES = new Set(['tracked', 'standalone']);
const CLOSE_REASONS = new Set(['completed', 'cancelled', 'owner-abandon']);
const ENVIRONMENT_POLICIES = new Set(['retain', 'unregister']);

export class DevelopmentCloseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DevelopmentCloseError';
    this.code = code;
    this.details = details;
    this.detail = details;
  }
}

function fail(code, message, details = {}) {
  throw new DevelopmentCloseError(code, message, details);
}

function requiredText(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.includes('\0') ||
    value.includes('\n') ||
    (pattern && !pattern.test(value))
  ) {
    fail('DEVELOPMENT_CLOSE_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function selector(options = {}) {
  const workItemId = requiredText(
    options.workItemId,
    'workItemId',
    IDENTIFIER,
  );
  if (options.workspaceId !== undefined) {
    const workspaceId = requiredText(
      options.workspaceId,
      'workspaceId',
      WORKSPACE_ID,
    );
    if (options.repoRoot !== undefined || options.workspaceRoot !== undefined) {
      const root = path.resolve(
        options.repoRoot ?? options.workspaceRoot,
      );
      let derived;
      try {
        derived = workspaceIdForRoot(root);
      } catch (error) {
        fail(
          'WORKTREE_IDENTITY_UNAVAILABLE',
          'workspace root cannot be resolved',
          { cause: String(error) },
        );
      }
      if (derived !== workspaceId) {
        fail(
          'WORKTREE_IDENTITY_MISMATCH',
          'workspaceId does not match the selected root',
          { expected: derived, actual: workspaceId },
        );
      }
      return { workspaceId, workItemId, canonicalRoot: root };
    }
    return { workspaceId, workItemId, canonicalRoot: null };
  }
  const workspace = captureWorkspace(
    options.repoRoot ?? options.workspaceRoot ?? repoRoot,
  );
  return {
    workspaceId: workspace.workspaceId,
    workItemId,
    canonicalRoot: workspace.canonicalRoot,
  };
}

function exactDeclaration(options, identity, dependencies) {
  const status = (
    dependencies.statusAllDeclarations ?? statusAllDeclarations
  )({
    home: options.home,
    now: options.now,
  });
  const matches = status.declarations.filter(
    (declaration) =>
      declaration.workspaceId === identity.workspaceId &&
      declaration.workItemId === identity.workItemId,
  );
  if (matches.length > 1) {
    fail(
      'DEVELOPMENT_CLOSE_OWNER_CONFLICT',
      'multiple declarations match the Development close selector',
      { declarations: matches.map((value) => value.declarationId) },
    );
  }
  return matches[0] ?? null;
}

function sessionContext(options, identity, declaration, activeWork) {
  const sessionId = declaration?.sessionId ?? activeWork?.sessionId ?? null;
  if (sessionId === null) return null;
  const paths = sessionStorePaths({
    home: options.home,
    workspaceId: identity.workspaceId,
    workItemId: identity.workItemId,
  });
  const archiveDirectory = path.join(
    paths.directory,
    'archive',
    sessionId,
  );
  const exists =
    existsSync(paths.session) ||
    existsSync(paths.events) ||
    existsSync(path.join(archiveDirectory, 'session.json')) ||
    existsSync(path.join(archiveDirectory, 'events.ndjson'));
  return exists ? { archiveDirectory, paths, sessionId } : null;
}

function inspectSession(options, identity, context, dependencies) {
  if (context === null) return null;
  if (!existsSync(context.paths.session) && !existsSync(context.paths.events)) {
    return { archived: true, session: null };
  }
  const session = (
    dependencies.loadSessionStore ?? loadSessionStore
  )({
    home: options.home,
    workspaceId: identity.workspaceId,
    workItemId: identity.workItemId,
    expected: {
      workspaceId: identity.workspaceId,
      workItemId: identity.workItemId,
      sessionId: context.sessionId,
    },
  });
  return { archived: false, session };
}

function validateTrackedOwners(
  options,
  identity,
  execution,
  declaration,
  activeWork,
) {
  if (execution.mount.mountedBy !== options.owner) {
    fail(
      'DEVELOPMENT_CLOSE_OWNER_MISMATCH',
      'Development close owner does not own the Plan mount',
      {
        expected: execution.mount.mountedBy,
        actual: options.owner,
      },
    );
  }
  if (
    declaration !== null &&
    (declaration.mountId !== execution.mount.mountId ||
      declaration.runId !== execution.run.runId)
  ) {
    fail(
      'DEVELOPMENT_CLOSE_OWNER_MISMATCH',
      'declaration does not match the selected Plan execution',
      {
        declarationMountId: declaration.mountId,
        declarationRunId: declaration.runId,
        mountId: execution.mount.mountId,
        runId: execution.run.runId,
      },
    );
  }
  if (
    activeWork !== null &&
    (activeWork.workItemId !== identity.workItemId ||
      activeWork.mountId !== execution.mount.mountId ||
      activeWork.runId !== execution.run.runId)
  ) {
    fail(
      'DEVELOPMENT_CLOSE_OWNER_MISMATCH',
      'active-work does not match the selected Plan execution',
      {
        activeWorkItemId: activeWork.workItemId,
        activeMountId: activeWork.mountId,
        activeRunId: activeWork.runId,
      },
    );
  }
}

function assertClosePreconditions({
  activeLeases,
  activeWork,
  closeReason,
  declaration,
  execution,
  mode,
  owner,
  sessionInspection,
}) {
  if (activeLeases.length > 0) {
    fail(
      'DEVELOPMENT_CLOSE_RUNTIME_ACTIVE',
      'runtime leases must be released before Development close',
      {
        activeLeases: activeLeases.map((lease) => ({
          leaseId: lease.leaseId,
          resourceKind: lease.resourceKind,
          resourceId: lease.resourceId,
        })),
      },
    );
  }
  if (declaration !== null && declaration.owner !== owner) {
    fail(
      'DEVELOPMENT_CLOSE_OWNER_MISMATCH',
      'Development close owner does not own the declaration',
      {
        expected: declaration.owner,
        actual: owner,
      },
    );
  }
  if (mode === 'standalone' && activeWork !== null) {
    fail(
      'DEVELOPMENT_CLOSE_MODE_MISMATCH',
      'standalone Development close cannot own tracked active-work',
    );
  }
  if (mode === 'standalone' && execution !== null) {
    fail(
      'DEVELOPMENT_CLOSE_MODE_MISMATCH',
      'standalone Development close cannot own a Plan mount',
    );
  }
  if (
    sessionInspection?.session !== undefined &&
    sessionInspection?.session !== null &&
    !TERMINAL_STATES.has(sessionInspection.session.state.state) &&
    closeReason !== 'owner-abandon'
  ) {
    fail(
      'DEVELOPMENT_CLOSE_SESSION_ACTIVE',
      'Development Session must be terminal before normal close',
      { state: sessionInspection.session.state.state },
    );
  }
  if (execution === null) return;
  if (
    closeReason === 'completed' &&
    execution.run.state !== 'completed'
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RUN_NOT_COMPLETED',
      'completed close requires a completed Execution Run',
      { state: execution.run.state },
    );
  }
  if (
    closeReason === 'cancelled' &&
    execution.run.state === 'completed'
  ) {
    fail(
      'DEVELOPMENT_CLOSE_RUN_ALREADY_COMPLETED',
      'a completed Execution Run cannot be cancelled',
    );
  }
}

function normalizedBlocker(error) {
  const details = error?.details ?? error?.detail ?? {};
  return {
    code: error?.code ?? 'DEVELOPMENT_CLOSE_INTERNAL_ERROR',
    message: error?.message ?? String(error),
    details:
      details !== null &&
      typeof details === 'object' &&
      !Array.isArray(details)
        ? details
        : { value: String(details) },
  };
}

function invokeStageHook(options, stage, receipt) {
  if (typeof options.stageHook === 'function') {
    options.stageHook(stage, receipt);
  }
}

export function statusDevelopmentClose(options = {}) {
  const identity = selector(options);
  return readDevelopmentCloseReceipt({
    home: options.home,
    workspaceId: identity.workspaceId,
    workItemId: identity.workItemId,
  });
}

export async function closeDevelopment(options = {}, dependencies = {}) {
  const identity = selector(options);
  const mode = requiredText(options.mode, 'mode');
  const closeReason = requiredText(options.closeReason, 'closeReason');
  const environmentPolicy = requiredText(
    options.environmentPolicy,
    'environmentPolicy',
  );
  const owner = requiredText(options.owner, 'owner');
  const workflowOwner = requireWorkflowOwnerReference(
    options.workflowOwner,
    { record: 'Development close' },
  );
  if (!MODES.has(mode)) {
    fail('DEVELOPMENT_CLOSE_INVALID', 'mode must be tracked or standalone');
  }
  if (!CLOSE_REASONS.has(closeReason)) {
    fail(
      'DEVELOPMENT_CLOSE_INVALID',
      'closeReason must be completed, cancelled, or owner-abandon',
    );
  }
  if (!ENVIRONMENT_POLICIES.has(environmentPolicy)) {
    fail(
      'DEVELOPMENT_CLOSE_INVALID',
      'environmentPolicy must be retain or unregister',
    );
  }
  if (
    identity.canonicalRoot === null &&
    mode === 'tracked' &&
    options.mountId === undefined
  ) {
    fail(
      'DEVELOPMENT_CLOSE_INVALID',
      'orphan recovery requires workspaceId and mountId',
    );
  }

  try {
    return await withWorkspaceLifecycleLock(
      {
        home: options.home,
        workspaceId: identity.workspaceId,
        ...(identity.canonicalRoot === null
          ? {}
          : { workspaceRoot: identity.canonicalRoot }),
        lockTimeoutMs: options.lockTimeoutMs,
      },
      async (lifecycleLease) => {
        let receipt = readDevelopmentCloseReceipt({
          home: options.home,
          workspaceId: identity.workspaceId,
          workItemId: identity.workItemId,
        });
        let execution = null;
        const selectedMountId =
          options.mountId ?? receipt?.mountId ?? undefined;
        if (mode === 'tracked') {
          execution = (
            dependencies.resolvePlanMountByIdentity ??
            resolvePlanMountByIdentity
          )({
            home: options.home,
            workspaceId: identity.workspaceId,
            mountId: selectedMountId,
            allowReleased: true,
          });
        } else {
          const liveMountId = (
            dependencies.readLivePlanMountId ?? readLivePlanMountId
          )(identity.workspaceId, { home: options.home });
          if (liveMountId !== null) {
            execution = { mount: { mountId: liveMountId } };
          }
        }
        const fixed = {
          workspaceId: identity.workspaceId,
          workItemId: identity.workItemId,
          mode,
          closeReason,
          environmentPolicy,
          owner,
          mountId: mode === 'tracked' ? execution.mount.mountId : null,
          runId: mode === 'tracked' ? execution.run.runId : null,
        };
        if (receipt === null) {
          receipt = createDevelopmentCloseReceipt(fixed, options);
        } else {
          for (const [field, value] of Object.entries(fixed)) {
            if (receipt[field] !== value) {
              fail(
                'DEVELOPMENT_CLOSE_RECEIPT_MISMATCH',
                'existing Development close receipt has a different selector',
                { field, expected: receipt[field], actual: value },
              );
            }
          }
          if (receipt.state === 'CLOSED') return receipt;
          receipt = updateDevelopmentCloseReceipt(
            receipt,
            { state: 'CLOSING', blocker: null },
            options,
          );
        }
        receipt = writeDevelopmentCloseReceipt(receipt, {
          home: options.home,
        });

        const persist = (stage, resources) => {
          receipt = updateDevelopmentCloseReceipt(
            receipt,
            {
              state: 'CLOSING',
              blocker: null,
              resources,
            },
            options,
          );
          receipt = writeDevelopmentCloseReceipt(receipt, {
            home: options.home,
          });
          invokeStageHook(options, stage, receipt);
        };

        try {
          const leaseObservation = (
            dependencies.observeLeases ?? observeLeases
          )({ home: options.home });
          const activeLeases = leaseObservation.activeLeases.filter(
            (lease) => lease.workspaceId === identity.workspaceId,
          );
          const declaration = exactDeclaration(
            options,
            identity,
            dependencies,
          );
          const activeWork = (
            dependencies.readActiveWorkRecord ?? readActiveWorkRecord
          )({
            home: options.home,
            workspaceId: identity.workspaceId,
          });
          if (declaration !== null) {
            assertMatchingWorkflowOwner(
              declaration.workflowOwner,
              workflowOwner,
              { record: 'development declaration' },
            );
          }
          if (activeWork !== null) {
            assertMatchingWorkflowOwner(
              activeWork.workflowOwner,
              workflowOwner,
              { record: 'active-work' },
            );
          }
          const context = sessionContext(
            options,
            identity,
            declaration,
            activeWork,
          );
          const sessionInspection = inspectSession(
            options,
            identity,
            context,
            dependencies,
          );
          if (mode === 'tracked') {
            validateTrackedOwners(
              options,
              identity,
              execution,
              declaration,
              activeWork,
            );
          }
          assertClosePreconditions({
            activeLeases,
            activeWork,
            closeReason,
            declaration,
            execution,
            mode,
            owner,
            sessionInspection,
          });

          persist('runtime-leases', { runtimeLeases: 'RELEASED' });

          if (context === null) {
            persist('session', { session: 'NOT_APPLICABLE' });
          } else {
            const archived = (
              dependencies.archiveSessionStore ?? archiveSessionStore
            )({
              home: options.home,
              workspaceId: identity.workspaceId,
              workItemId: identity.workItemId,
              expected: {
                workspaceId: identity.workspaceId,
                workItemId: identity.workItemId,
                sessionId: context.sessionId,
                workflowOwner,
              },
              allowNonTerminal: closeReason === 'owner-abandon',
            });
            persist('session', {
              session:
                archived.archivedAs === 'owner-abandon'
                  ? 'ABANDONED'
                  : 'ARCHIVED',
            });
          }

          if (
            mode === 'tracked' &&
            closeReason === 'cancelled' &&
            execution.run.state !== 'cancelled'
          ) {
            execution = await (
              dependencies.cancelExecutionRun ?? cancelExecutionRun
            )({
              home: options.home,
              workspaceId: identity.workspaceId,
              mountId: execution.mount.mountId,
              owner,
              lifecycleLease,
            });
          }

          if (activeWork === null) {
            persist('active-work', { activeWork: 'NOT_APPLICABLE' });
          } else {
            (
              dependencies.clearActiveWorkRecord ?? clearActiveWorkRecord
            )({
              home: options.home,
              workspaceId: identity.workspaceId,
              workItemId: identity.workItemId,
              expectedRevision: activeWork.revision,
              workflowOwner,
              lifecycleLease,
            });
            persist('active-work', { activeWork: 'CLOSED' });
          }

          if (declaration === null) {
            persist('declaration', { declaration: 'NOT_APPLICABLE' });
          } else {
            (
              dependencies.releaseDeclaration ?? releaseDeclaration
            )({
              home: options.home,
              workspaceId: identity.workspaceId,
              workItemId: identity.workItemId,
              owner,
              workflowOwner,
              lifecycleLease,
              now: options.now,
            });
            persist('declaration', { declaration: 'RELEASED' });
          }

          if (mode === 'standalone') {
            persist('plan-mount', { planMount: 'NOT_APPLICABLE' });
          } else {
            const releaseReason =
              closeReason === 'owner-abandon'
                ? 'owner-unmount'
                : closeReason;
            await (
              dependencies.releasePlanMount ?? releasePlanMount
            )({
              home: options.home,
              workspaceId: identity.workspaceId,
              mountId: execution.mount.mountId,
              owner,
              reason: releaseReason,
              allowUnfinished: closeReason === 'owner-abandon',
              lifecycleLease,
              now: options.now,
            });
            persist('plan-mount', { planMount: 'RELEASED' });
          }

          if (environmentPolicy === 'retain') {
            persist('environment-registration', {
              environmentRegistration: 'RETAINED',
            });
          } else {
            try {
              (
                dependencies.unregisterWorkspaceByIdentity ??
                unregisterWorkspaceByIdentity
              )({
                home: options.home,
                workspaceId: identity.workspaceId,
                owner,
                lifecycleLease,
                now: options.now,
              });
              persist('environment-registration', {
                environmentRegistration: 'UNREGISTERED',
              });
            } catch (error) {
              if (error?.code !== 'WORKSPACE_UNREGISTERED') throw error;
              persist('environment-registration', {
                environmentRegistration: 'NOT_REGISTERED',
              });
            }
          }

          receipt = updateDevelopmentCloseReceipt(
            receipt,
            { state: 'CLOSED', blocker: null },
            options,
          );
          return writeDevelopmentCloseReceipt(receipt, {
            home: options.home,
          });
        } catch (error) {
          const blocker = normalizedBlocker(error);
          receipt = updateDevelopmentCloseReceipt(
            receipt,
            { state: 'BLOCKED', blocker },
            options,
          );
          receipt = writeDevelopmentCloseReceipt(receipt, {
            home: options.home,
          });
          throw new DevelopmentCloseError(
            blocker.code,
            blocker.message,
            { ...blocker.details, receipt },
          );
        }
      },
    );
  } catch (error) {
    if (error instanceof WorkspaceLifecycleLockError) {
      fail(error.code, error.message, error.detail);
    }
    throw error;
  }
}

const OPTION_NAMES = {
  home: 'home',
  'repo-root': 'repoRoot',
  'workspace-root': 'workspaceRoot',
  'workspace-id': 'workspaceId',
  'work-item': 'workItemId',
  mode: 'mode',
  reason: 'closeReason',
  'environment-policy': 'environmentPolicy',
  owner: 'owner',
  'mount-id': 'mountId',
};

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      fail('DEVELOPMENT_CLOSE_INVALID', `unexpected argument: ${token}`);
    }
    const optionName = OPTION_NAMES[token.slice(2)];
    if (!optionName) {
      fail('DEVELOPMENT_CLOSE_INVALID', `unsupported option: ${token}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('DEVELOPMENT_CLOSE_INVALID', `missing value for ${token}`);
    }
    options[optionName] = value;
    index += 1;
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(argv = process.argv.slice(2), io = {}) {
  const { action, options } = parseArguments(argv);
  let result;
  if (action === 'close') {
    options.workflowOwner = resolveWorkflowOwnerCommandContext(
      'development-close',
      'close',
      {
        home: options.home,
        workspaceRoot: options.repoRoot ?? process.cwd(),
        resolveCurrentWorkflowOwnerContext:
          io.dependencies?.resolveCurrentWorkflowOwnerContext,
      },
    ).workflowOwner;
    result = await closeDevelopment(options, io.dependencies);
  } else if (action === 'status') {
    result = statusDevelopmentClose(options);
  } else {
    fail(
      'DEVELOPMENT_CLOSE_INVALID',
      'action must be close or status',
    );
  }
  output({ status: 'PASS', action, close: result }, io.output);
  return result;
}

if (isDirectInvocation(import.meta.url)) {
  runCli().catch((error) => {
    output(
      {
        status: 'BLOCKED',
        code: error?.code ?? 'DEVELOPMENT_CLOSE_INTERNAL_ERROR',
        message: error?.message ?? String(error),
        details: error?.details ?? error?.detail ?? {},
      },
      process.stderr,
    );
    process.exitCode = 2;
  });
}
