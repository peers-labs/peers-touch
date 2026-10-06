import { createHash } from 'node:crypto';

export const WORKFLOW_OWNER_REFERENCE_KIND =
  'peers-touch-workflow-owner-reference';

const HOSTS = new Set(['trae', 'cursor', 'codex']);
const SHA256 = /^[0-9a-f]{64}$/;
const REFERENCE_KEYS = new Set([
  'host',
  'kind',
  'rootBindingDigest',
  'rootChatHash',
  'rootChatId',
]);

function fail(code, message, detail = {}) {
  throw Object.assign(new Error(message), { code, detail });
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function requiredRootChatId(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.length > 1024 ||
    value.includes('\0') ||
    value.includes('\n')
  ) {
    fail(
      'WORKFLOW_OWNER_SESSION_INVALID',
      'workflow owner root chat ID is invalid',
    );
  }
  return value;
}

export function hashWorkflowRootChatIdentity(host, rootChatId) {
  if (!HOSTS.has(host)) {
    fail('WORKFLOW_OWNER_SESSION_INVALID', 'workflow owner host is invalid');
  }
  const normalized = requiredRootChatId(rootChatId);
  return createHash('sha256')
    .update(`${host}\0root\0${normalized}`)
    .digest('hex');
}

export function validateWorkflowOwnerReference(value, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (
    !exactKeys(value, REFERENCE_KEYS) ||
    value.kind !== WORKFLOW_OWNER_REFERENCE_KIND ||
    !HOSTS.has(value.host) ||
    !SHA256.test(value.rootChatHash) ||
    !SHA256.test(value.rootBindingDigest)
  ) {
    fail(
      'WORKFLOW_OWNER_REFERENCE_INVALID',
      'workflow owner reference shape is invalid',
    );
  }
  const rootChatId = requiredRootChatId(value.rootChatId);
  if (
    hashWorkflowRootChatIdentity(value.host, rootChatId) !==
    value.rootChatHash
  ) {
    fail(
      'WORKFLOW_OWNER_REFERENCE_INVALID',
      'workflow owner root chat ID does not match its hash',
    );
  }
  return value;
}

export function workflowOwnerReferenceFromBinding(binding) {
  if (
    binding === null ||
    typeof binding !== 'object' ||
    binding.role !== 'OWNER' ||
    typeof binding.rootChatId !== 'string'
  ) {
    fail(
      'WORKFLOW_OWNER_SESSION_MIGRATION_REQUIRED',
      'workflow owner binding has no durable root chat ID',
    );
  }
  return validateWorkflowOwnerReference({
    kind: WORKFLOW_OWNER_REFERENCE_KIND,
    host: binding.host,
    rootChatId: binding.rootChatId,
    rootChatHash: binding.rootChatHash,
    rootBindingDigest: binding.digest,
  });
}

export function sameWorkflowOwnerReference(left, right) {
  if (left === null || right === null) return left === right;
  validateWorkflowOwnerReference(left);
  validateWorkflowOwnerReference(right);
  return (
    left.host === right.host &&
    left.rootChatId === right.rootChatId &&
    left.rootChatHash === right.rootChatHash &&
    left.rootBindingDigest === right.rootBindingDigest
  );
}
