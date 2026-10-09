import path from 'node:path';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import { readActiveWorkRecord } from './active-work-store.mjs';
import {
  readWorkflowOwnerByDigest,
  workflowOwnerIsReleased,
} from './workflow-binding-store.mjs';
import { readWorkspaceActions } from './workflow-action-store.mjs';
import {
  sameWorkflowOwnerReference,
  validateWorkflowOwnerReference,
  workflowOwnerReferenceFromBinding,
} from './workflow-owner-reference.mjs';

function fail(code, message, detail = {}) {
  throw Object.assign(new Error(message), { code, detail });
}

function operationDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail('WORKFLOW_OWNER_CONTEXT_INVALID', 'workflow owner clock is invalid');
  }
  return date;
}

function latestActionReceipts(receipts) {
  const latest = new Map();
  for (const receipt of receipts) {
    latest.set(receipt.actionId, receipt);
  }
  return [...latest.values()];
}

function activeWorkOwnerContext(options, workspaceId) {
  const activeWork = (
    options.readActiveWork ??
    readActiveWorkRecord
  )({
    home: options.home,
    workspaceId,
    ...(options.machineRoot === undefined
      ? {}
      : {
          recordPath: path.join(
            options.machineRoot,
            'workspaces',
            workspaceId,
            'workflow',
            'active-work.json',
          ),
        }),
  });
  const reference = validateWorkflowOwnerReference(
    activeWork?.workflowOwner ?? null,
    { nullable: true },
  );
  if (reference === null) return null;
  const owner = (options.readOwnerByDigest ?? readWorkflowOwnerByDigest)(
    reference.rootBindingDigest,
    {
      home: options.home,
      machineRoot: options.machineRoot,
    },
  );
  if (
    (options.ownerIsReleased ?? workflowOwnerIsReleased)(owner, {
      home: options.home,
      machineRoot: options.machineRoot,
    })
  ) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_NOT_LIVE',
      'current active-work belongs to a released OWNER',
      { workspaceId, rootBindingDigest: owner.digest },
    );
  }
  const actual = workflowOwnerReferenceFromBinding(owner);
  if (!sameWorkflowOwnerReference(reference, actual)) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_MISMATCH',
      'current active-work does not match its owner binding',
      { workspaceId, rootBindingDigest: owner.digest },
    );
  }
  return {
    workflowOwner: actual,
    actionReceiptDigest: null,
  };
}

export function resolveCurrentWorkflowOwnerContext(options = {}) {
  if (options.workflowOwner !== undefined) {
    return {
      workflowOwner: validateWorkflowOwnerReference(options.workflowOwner, {
        nullable: true,
      }),
      actionReceiptDigest: options.actionReceiptDigest ?? null,
    };
  }
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const now = operationDate(options.now);
  const readActions = options.readActions ?? readWorkspaceActions;
  const receipts = latestActionReceipts(
    readActions({
      home: options.home,
      machineRoot: options.machineRoot,
      workspaceId,
    }),
  ).filter(
    (receipt) =>
      ['RUNNING', 'WAITING'].includes(receipt.result) &&
      receipt.leaseUntil !== null &&
      Date.parse(receipt.leaseUntil) > now.getTime() &&
      (options.operationLabel === undefined ||
        receipt.operation?.label === options.operationLabel),
  );
  if (receipts.length === 0) {
    return (
      activeWorkOwnerContext(options, workspaceId) ?? {
        workflowOwner: null,
        actionReceiptDigest: null,
      }
    );
  }
  const rootBindingDigests = [
    ...new Set(receipts.map((receipt) => receipt.actor.rootBindingDigest)),
  ];
  if (rootBindingDigests.length !== 1) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_AMBIGUOUS',
      'multiple live workflow owners match this workspace action',
      { workspaceId, rootBindingDigests },
    );
  }
  const owner = (options.readOwnerByDigest ?? readWorkflowOwnerByDigest)(
    rootBindingDigests[0],
    {
      home: options.home,
      machineRoot: options.machineRoot,
    },
  );
  if (
    (options.ownerIsReleased ?? workflowOwnerIsReleased)(owner, {
      home: options.home,
      machineRoot: options.machineRoot,
    })
  ) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_NOT_LIVE',
      'current workflow action belongs to a released OWNER',
      { workspaceId, rootBindingDigest: owner.digest },
    );
  }
  const matching = receipts
    .filter(
      (receipt) =>
        receipt.actor.rootBindingDigest === owner.digest &&
        receipt.binding.workspaceId === workspaceId,
    )
    .sort(
      (left, right) =>
        right.at.localeCompare(left.at) || right.sequence - left.sequence,
    );
  if (matching.length === 0) {
    fail(
      'WORKFLOW_OWNER_CONTEXT_MISMATCH',
      'live workflow action does not match its owner binding',
      { workspaceId, rootBindingDigest: owner.digest },
    );
  }
  return {
    workflowOwner: workflowOwnerReferenceFromBinding(owner),
    actionReceiptDigest: matching[0].digest,
  };
}
