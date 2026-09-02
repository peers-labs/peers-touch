import {
  CapabilityApprovalPolicy,
  type AgentCapabilityBinding,
} from '../../gen/proto/domain/agent/capability_pb';

type CapabilityBindingIdentity = Pick<
  AgentCapabilityBinding,
  'bindingId' | 'capabilityId' | 'capabilityVersion'
>;

export interface FoundationCapabilityIsolationBinding
  extends CapabilityBindingIdentity {
  approvalPolicy: CapabilityApprovalPolicy;
  originalRevision: string;
  isolatedRevision: string;
  restoredRevision: string;
}

export interface FoundationCapabilityIsolationJournal {
  agentId: string;
  agentVersion: number;
  originalReadyCapabilityCount: number;
  originalReadyCapabilityHash: string;
  bindings: FoundationCapabilityIsolationBinding[];
}

export interface FoundationCapabilityFixtureJournal {
  agentId: string;
  agentVersion: number;
  capabilityId: string;
  capabilityVersion: string;
  setupIdempotencyKey: string;
  cleanupExpectedRevision?: string;
  cleanupIdempotencyKey?: string;
  originalBinding: {
    bindingId: string;
    enabled: boolean;
    approvalPolicy: CapabilityApprovalPolicy;
    revision: string;
  } | null;
}

export interface FoundationCapabilityRestorationEntry {
  original: FoundationCapabilityIsolationBinding;
  current: AgentCapabilityBinding;
  requiresRestore: boolean;
}

const VALID_APPROVAL_POLICIES = new Set<CapabilityApprovalPolicy>([
  CapabilityApprovalPolicy.MANUAL,
  CapabilityApprovalPolicy.ALLOW_LIST,
  CapabilityApprovalPolicy.AUTO,
  CapabilityApprovalPolicy.DENY,
]);

function invalidJournal(): never {
  throw new Error(
    'agent.acceptance.foundationCapabilityIsolationJournalInvalid',
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidJournal();
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidJournal();
  }
  return value;
}

export function parseFoundationCapabilityIsolationJournal(
  raw: string | null,
): FoundationCapabilityIsolationJournal | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidJournal();
  }
  const value = record(parsed);
  if (!Array.isArray(value.bindings) || value.bindings.length === 0) {
    return invalidJournal();
  }
  const seenBindingIds = new Set<string>();
  const bindings = value.bindings.map((candidate) => {
    const binding = record(candidate);
    const bindingId = nonemptyString(binding.bindingId);
    const capabilityId = nonemptyString(binding.capabilityId);
    const capabilityVersion = nonemptyString(binding.capabilityVersion);
    const originalRevision = nonemptyString(binding.originalRevision);
    const isolatedRevision = nonemptyString(binding.isolatedRevision);
    const restoredRevision = nonemptyString(binding.restoredRevision);
    const approvalPolicy = binding.approvalPolicy;
    if (
      seenBindingIds.has(bindingId)
      || typeof approvalPolicy !== 'number'
      || !Number.isSafeInteger(approvalPolicy)
      || !VALID_APPROVAL_POLICIES.has(approvalPolicy)
      || !/^[1-9][0-9]*$/.test(originalRevision)
      || !/^[1-9][0-9]*$/.test(isolatedRevision)
      || !/^[1-9][0-9]*$/.test(restoredRevision)
      || BigInt(isolatedRevision) !== BigInt(originalRevision) + 1n
      || BigInt(restoredRevision) !== BigInt(isolatedRevision) + 1n
    ) {
      return invalidJournal();
    }
    seenBindingIds.add(bindingId);
    return {
      bindingId,
      capabilityId,
      capabilityVersion,
      approvalPolicy,
      originalRevision,
      isolatedRevision,
      restoredRevision,
    };
  });
  const agentId = nonemptyString(value.agentId);
  const agentVersion = value.agentVersion;
  const originalReadyCapabilityCount = value.originalReadyCapabilityCount;
  const originalReadyCapabilityHash = value.originalReadyCapabilityHash;
  if (
    typeof agentVersion !== 'number'
    || !Number.isSafeInteger(agentVersion)
    || agentVersion <= 0
    || typeof originalReadyCapabilityCount !== 'number'
    || !Number.isSafeInteger(originalReadyCapabilityCount)
    || originalReadyCapabilityCount < 0
    || typeof originalReadyCapabilityHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(originalReadyCapabilityHash)
  ) {
    return invalidJournal();
  }
  return {
    agentId,
    agentVersion,
    originalReadyCapabilityCount,
    originalReadyCapabilityHash,
    bindings,
  };
}

export function parseFoundationCapabilityFixtureJournal(
  raw: string | null,
): FoundationCapabilityFixtureJournal | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidJournal();
  }
  const value = record(parsed);
  const agentId = nonemptyString(value.agentId);
  const capabilityId = nonemptyString(value.capabilityId);
  const capabilityVersion = nonemptyString(value.capabilityVersion);
  const setupIdempotencyKey = nonemptyString(value.setupIdempotencyKey);
  const hasCleanupExpectedRevision =
    value.cleanupExpectedRevision !== undefined;
  const hasCleanupIdempotencyKey =
    value.cleanupIdempotencyKey !== undefined;
  if (hasCleanupExpectedRevision !== hasCleanupIdempotencyKey) {
    return invalidJournal();
  }
  let cleanupExpectedRevision: string | undefined;
  let cleanupIdempotencyKey: string | undefined;
  if (hasCleanupExpectedRevision) {
    cleanupExpectedRevision = nonemptyString(value.cleanupExpectedRevision);
    cleanupIdempotencyKey = nonemptyString(value.cleanupIdempotencyKey);
    if (!/^[1-9][0-9]*$/.test(cleanupExpectedRevision)) {
      return invalidJournal();
    }
  }
  const agentVersion = value.agentVersion;
  if (
    typeof agentVersion !== 'number'
    || !Number.isSafeInteger(agentVersion)
    || agentVersion <= 0
  ) {
    return invalidJournal();
  }
  let originalBinding: FoundationCapabilityFixtureJournal['originalBinding'] =
    null;
  if (value.originalBinding !== null) {
    const original = record(value.originalBinding);
    const bindingId = nonemptyString(original.bindingId);
    const revision = nonemptyString(original.revision);
    const enabled = original.enabled;
    const approvalPolicy = original.approvalPolicy;
    if (
      typeof enabled !== 'boolean'
      || typeof approvalPolicy !== 'number'
      || !Number.isSafeInteger(approvalPolicy)
      || !VALID_APPROVAL_POLICIES.has(approvalPolicy)
      || !/^[1-9][0-9]*$/.test(revision)
    ) {
      return invalidJournal();
    }
    originalBinding = {
      bindingId,
      enabled,
      approvalPolicy,
      revision,
    };
  }
  return {
    agentId,
    agentVersion,
    capabilityId,
    capabilityVersion,
    setupIdempotencyKey,
    ...(cleanupExpectedRevision && cleanupIdempotencyKey
      ? { cleanupExpectedRevision, cleanupIdempotencyKey }
      : {}),
    originalBinding,
  };
}

function assertFoundationCapabilityBindingIdentity(
  expected: CapabilityBindingIdentity,
  current: CapabilityBindingIdentity,
): void {
  if (
    current.bindingId !== expected.bindingId
    || current.capabilityId !== expected.capabilityId
    || current.capabilityVersion !== expected.capabilityVersion
  ) {
    throw new Error(
      'agent.acceptance.foundationCapabilityBindingIdentityChanged',
    );
  }
}

export function planFoundationCapabilityBindingRestoration(
  originals: readonly FoundationCapabilityIsolationBinding[],
  currentBindings: readonly AgentCapabilityBinding[],
): FoundationCapabilityRestorationEntry[] {
  return originals.map((original) => {
    const current = currentBindings.find(
      (binding) => binding.bindingId === original.bindingId
        && !binding.tombstonedAt,
    );
    if (!current) {
      throw new Error('agent.acceptance.foundationCapabilityBindingMissing');
    }
    assertFoundationCapabilityBindingIdentity(original, current);
    const currentRevision = current.revision.toString();
    const isOriginalState =
      currentRevision === original.originalRevision
      && current.enabled
      && current.approvalPolicy === original.approvalPolicy;
    const isIsolatedState =
      currentRevision === original.isolatedRevision
      && !current.enabled
      && current.approvalPolicy === original.approvalPolicy;
    const isRestoredState =
      currentRevision === original.restoredRevision
      && current.enabled
      && current.approvalPolicy === original.approvalPolicy;
    if (!isOriginalState && !isIsolatedState && !isRestoredState) {
      throw new Error(
        'agent.acceptance.foundationCapabilityBindingStateChanged',
      );
    }
    return {
      original,
      current,
      requiresRestore: isIsolatedState,
    };
  });
}

export async function restoreFoundationCapabilityBindings(
  originals: readonly FoundationCapabilityIsolationBinding[],
  listBindings: () => Promise<AgentCapabilityBinding[]>,
  restoreBinding: (
    original: FoundationCapabilityIsolationBinding,
    current: AgentCapabilityBinding,
  ) => Promise<void>,
): Promise<void> {
  planFoundationCapabilityBindingRestoration(
    originals,
    await listBindings(),
  );
  for (const original of [...originals].reverse()) {
    const [{ current, requiresRestore }] =
      planFoundationCapabilityBindingRestoration(
      [original],
      await listBindings(),
    );
    if (requiresRestore) {
      await restoreBinding(original, current);
    }
  }
}

export function assertFoundationCapabilityIsolationPrerequisites(
  bindings: readonly FoundationCapabilityIsolationBinding[],
  readyCapabilityCount: number,
  requireEffectiveCapabilities: boolean,
): void {
  if (
    !Number.isSafeInteger(readyCapabilityCount)
    || readyCapabilityCount < 0
    || (bindings.length === 0 && readyCapabilityCount !== 0)
    || (
      requireEffectiveCapabilities
      && (bindings.length === 0 || readyCapabilityCount === 0)
    )
  ) {
    throw new Error(
      'agent.acceptance.foundationCapabilityIsolationUnavailable',
    );
  }
}

export function isFoundationCapabilityIsolationRestored(
  value: Record<string, unknown>,
): boolean {
  const disabled = value.disabledBindingCount;
  const isolatedReady = value.readyCapabilityCount;
  const originalReady = value.originalReadyCapabilityCount;
  const restoredBindings = value.restoredBindingCount;
  const restoredReady = value.restoredReadyCapabilityCount;
  const originalHash = value.originalReadyCapabilityHash;

  return (
    typeof disabled === 'number'
    && Number.isSafeInteger(disabled)
    && disabled > 0
    && isolatedReady === 0
    && typeof originalReady === 'number'
    && Number.isSafeInteger(originalReady)
    && originalReady > 0
    && restoredBindings === disabled
    && restoredReady === originalReady
    && typeof originalHash === 'string'
    && /^[0-9a-f]{64}$/.test(originalHash)
    && value.restoredReadyCapabilityHash === originalHash
    && value.restorationVerified === true
  );
}

export function assertFoundationCapabilityIsolationAgentVersion(
  expectedVersion: number,
  currentVersion: number,
): void {
  if (
    !Number.isSafeInteger(expectedVersion)
    || !Number.isSafeInteger(currentVersion)
    || currentVersion !== expectedVersion
  ) {
    throw new Error('agent.acceptance.foundationCapabilityIsolationAgentChanged');
  }
}

export function assertFoundationCapabilityFixtureCleanupState(
  prepared: AgentCapabilityBinding,
  current: AgentCapabilityBinding,
): void {
  assertFoundationCapabilityBindingIdentity(prepared, current);
  const preparedRevision = prepared.revision;
  const currentRevision = current.revision;
  if (
    (
      currentRevision !== preparedRevision
      && currentRevision !== preparedRevision + 2n
    )
    || current.enabled !== prepared.enabled
    || current.approvalPolicy !== prepared.approvalPolicy
  ) {
    throw new Error(
      'agent.acceptance.foundationCapabilityFixtureStateChanged',
    );
  }
}
