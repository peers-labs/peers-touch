import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
} from './workflow-owner-reference.mjs';

const COMMAND_GROUPS = Object.freeze({
  'active-work': Object.freeze({
    sync: 'active-work-sync',
    repair: 'active-work-repair',
    status: null,
    'status-all': null,
    close: 'active-work-close',
  }),
  'dev-session': Object.freeze({
    start: 'dev-session-start',
    status: null,
    archive: 'dev-session-archive',
    transition: 'dev-transition',
    'functional-result': 'dev-functional-result',
  }),
  'development-close': Object.freeze({
    close: 'dev-close',
    status: null,
  }),
  'dev-work': Object.freeze({
    start: 'dev-start',
    update: 'dev-update',
    check: 'dev-check',
    heartbeat: 'dev-heartbeat',
    release: 'dev-release',
    'prepare-resources': 'dev-resources-prepare',
    'resource-status': null,
    'record-resource': 'dev-resource-record',
    status: null,
    'status-all': null,
  }),
  'machine-dev': Object.freeze({
    register: 'env-register',
    select: 'profile',
    update: 'env-update',
    unregister: 'env-unregister',
    check: null,
    resolve: null,
    'status-all': null,
    'validate-lease': null,
    'verify-held': null,
    lease: null,
  }),
  'plan-mount': Object.freeze({
    mount: 'plan-mount',
    unmount: 'plan-unmount',
    status: null,
  }),
  planctl: Object.freeze({
    activate: 'plan-activate',
    advance: 'plan-advance',
    cancel: 'plan-cancel',
    amend: 'plan-amend',
    'approve-north-star': 'plan-approve-north-star',
    'seal-completion': 'plan-seal-completion',
    reopen: 'plan-reopen',
    'invalidate-source': 'plan-reopen',
    validate: null,
    'source-status': null,
    current: null,
    next: null,
    status: null,
  }),
  migration: Object.freeze({
    migrate: 'plan-state-migrate',
  }),
  worktree: Object.freeze({
    create: 'worktree-create',
    status: null,
  }),
});

const WORKFLOW_OWNER_COMMAND_TARGETS = new Set([
  'worktree-create',
  'worktree-creation-status',
  'env-register',
  'env-update',
  'env-unregister',
  'env-check',
  'env-status-all',
  'profile',
  'dev-start',
  'dev-update',
  'dev-check',
  'dev-heartbeat',
  'dev-release',
  'dev-close',
  'dev-close-status',
  'dev-resources-prepare',
  'dev-resources-status',
  'dev-resource-record',
  'dev-session-start',
  'dev-session-status',
  'dev-session-archive',
  'dev-transition',
  'dev-functional-result',
  'active-work-sync',
  'active-work-repair',
  'active-work-status',
  'active-work-status-all',
  'active-work-close',
  'plan-mount',
  'plan-mount-status',
  'plan-unmount',
  'plan-state-migrate',
  'plan-approve-north-star',
  'plan-amend',
  'plan-seal-completion',
  'plan-cancel',
  'plan-activate',
  'plan-validate',
  'plan-status',
  'plan-current',
  'plan-next',
  'plan-advance',
  'plan-reopen',
  'completion-review-prepare',
  'completion-review-submit',
  'completion-review-status',
  'skills',
  'skills-hard-cut',
  'skills-gc',
  'agent-integration-audit',
  'agent-integration-audit-all',
]);

function fail(code, message, detail = {}) {
  throw Object.assign(new Error(message), { code, detail });
}

export function isWorkflowOwnerCommandTarget(value) {
  return WORKFLOW_OWNER_COMMAND_TARGETS.has(value);
}

export function workflowOwnerOperationLabel(group, action) {
  const commands = COMMAND_GROUPS[group];
  if (commands === undefined || !Object.hasOwn(commands, action)) {
    fail(
      'WORKFLOW_OWNER_COMMAND_UNKNOWN',
      'command is not registered in the OWNER command policy',
      { group, action },
    );
  }
  const label = commands[action];
  if (label === null) return null;
  if (!WORKFLOW_OWNER_COMMAND_TARGETS.has(label)) {
    fail(
      'WORKFLOW_OWNER_COMMAND_INVALID',
      'command policy label is not an OWNER target',
      { group, action, label },
    );
  }
  return label;
}

export function workflowOwnerActionIdentity(receipt) {
  return [
    receipt.actor.rootBindingDigest,
    receipt.actor.bindingDigest,
    receipt.actionId,
  ].join('\0');
}

export function isExactWorkflowOwnerReceipt(receipt, expected = {}) {
  return (
    receipt?.actor?.role === 'OWNER' &&
    receipt.actor.bindingDigest === receipt.actor.rootBindingDigest &&
    receipt.binding?.workspaceId === expected.workspaceId &&
    receipt.operation?.family === 'OWNER_CONTROL' &&
    (expected.operationLabel === undefined ||
      receipt.operation.label === expected.operationLabel)
  );
}

export function requireWorkflowOwnerReference(value, detail = {}) {
  if (value === null || value === undefined) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_REQUIRED',
      'operation requires an exact live main-session OWNER receipt',
      detail,
    );
  }
  return validateWorkflowOwnerReference(value);
}

export function assertMatchingWorkflowOwner(
  expected,
  actual,
  detail = {},
) {
  const stored = requireWorkflowOwnerReference(expected, {
    ...detail,
    missing: 'stored',
  });
  const current = requireWorkflowOwnerReference(actual, {
    ...detail,
    missing: 'current',
  });
  if (!sameWorkflowOwnerReference(stored, current)) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_MISMATCH',
      'current main-session OWNER does not match persisted ownership',
      {
        ...detail,
        expected: stored.rootBindingDigest,
        actual: current.rootBindingDigest,
      },
    );
  }
  return stored;
}
