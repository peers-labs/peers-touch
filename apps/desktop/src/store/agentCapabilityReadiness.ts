import {
  CapabilityReadinessState,
  type AgentCapabilityBinding,
  type CapabilityReadinessSnapshot,
} from '../gen/proto/domain/agent/capability_pb';

const STATION_CAPABILITY_AUTHORITY = 'station-capability-authority';

export type AgentComposerReadinessState =
  | 'ready'
  | 'degraded'
  | 'unavailable'
  | 'blocked'
  | 'unknown'
  | 'stale';

export type AgentCapabilityCompatibility =
  | 'compatible'
  | 'degraded'
  | 'incompatible'
  | 'unknown';

export interface AgentComposerReadinessProjection {
  state: AgentComposerReadinessState;
  compatibility: AgentCapabilityCompatibility;
  canSend: boolean;
  authority: string;
  reasonCode: string;
  snapshotId: string;
  runtimeSnapshotId: string;
  modelCapabilitySnapshotId: string;
  createdAtMs?: number;
  expiresAtMs?: number;
}

function timestampToMs(
  timestamp: { seconds: bigint; nanos: number } | undefined,
): number | undefined {
  if (!timestamp) return undefined;
  const seconds = Number(timestamp.seconds);
  if (!Number.isSafeInteger(seconds)) return undefined;
  return seconds * 1_000 + Math.floor(timestamp.nanos / 1_000_000);
}

function composerStateFromCapability(
  state: CapabilityReadinessState,
): AgentComposerReadinessState {
  switch (state) {
    case CapabilityReadinessState.READY:
      return 'ready';
    case CapabilityReadinessState.DEGRADED:
      return 'degraded';
    case CapabilityReadinessState.UNAVAILABLE:
      return 'unavailable';
    case CapabilityReadinessState.BLOCKED:
      return 'blocked';
    default:
      return 'unknown';
  }
}

function compatibilityFromComposerState(
  state: AgentComposerReadinessState,
): AgentCapabilityCompatibility {
  switch (state) {
    case 'ready':
      return 'compatible';
    case 'degraded':
      return 'degraded';
    case 'unavailable':
    case 'blocked':
      return 'incompatible';
    default:
      return 'unknown';
  }
}

function readinessPriority(state: AgentComposerReadinessState): number {
  switch (state) {
    case 'blocked':
      return 5;
    case 'unavailable':
      return 4;
    case 'unknown':
      return 3;
    case 'degraded':
      return 2;
    case 'ready':
      return 1;
    default:
      return 6;
  }
}

function unresolvedComposerReadiness(
  state: 'unknown' | 'stale',
  reasonCode: string,
  snapshot?: CapabilityReadinessSnapshot,
): AgentComposerReadinessProjection {
  return {
    state,
    compatibility: 'unknown',
    canSend: false,
    authority: STATION_CAPABILITY_AUTHORITY,
    reasonCode,
    snapshotId: snapshot?.snapshotId.trim() ?? '',
    runtimeSnapshotId: snapshot?.runtimeSnapshotId.trim() ?? '',
    modelCapabilitySnapshotId:
      snapshot?.modelCapabilities?.snapshotId.trim() ?? '',
    createdAtMs: timestampToMs(snapshot?.createdAt),
    expiresAtMs: timestampToMs(snapshot?.expiresAt),
  };
}

export function projectAgentComposerReadiness(
  agentId: string,
  agentVersion: number | bigint,
  bindings: readonly AgentCapabilityBinding[],
  snapshot: CapabilityReadinessSnapshot | undefined,
  nowMs = Date.now(),
): AgentComposerReadinessProjection {
  const normalizedAgentId = agentId.trim();
  if (!snapshot) {
    return unresolvedComposerReadiness('unknown', 'readiness_snapshot_missing');
  }

  const snapshotId = snapshot.snapshotId.trim();
  const runtimeSnapshotId = snapshot.runtimeSnapshotId.trim();
  const modelCapabilitySnapshotId =
    snapshot.modelCapabilities?.snapshotId.trim() ?? '';
  const createdAtMs = timestampToMs(snapshot.createdAt);
  const expiresAtMs = timestampToMs(snapshot.expiresAt);
  if (
    !normalizedAgentId
    || snapshot.agentId.trim() !== normalizedAgentId
    || !snapshotId
    || !runtimeSnapshotId
    || !modelCapabilitySnapshotId
    || modelCapabilitySnapshotId !== runtimeSnapshotId
    || createdAtMs === undefined
    || expiresAtMs === undefined
  ) {
    return unresolvedComposerReadiness(
      'unknown',
      'readiness_snapshot_incomplete',
      snapshot,
    );
  }

  const agentRevision = `agent:${normalizedAgentId}:${String(agentVersion)}`;
  if (
    expiresAtMs <= nowMs
    || !snapshot.bindingRevisions.includes(agentRevision)
  ) {
    return unresolvedComposerReadiness(
      'stale',
      expiresAtMs <= nowMs
        ? 'readiness_snapshot_expired'
        : 'agent_revision_stale',
      snapshot,
    );
  }

  const enabledBindings = bindings.filter(
    (binding) => binding.enabled && !binding.tombstonedAt,
  );
  let projectedState: AgentComposerReadinessState = 'ready';
  let reasonCode = 'capability_ready';
  let authority = STATION_CAPABILITY_AUTHORITY;
  for (const binding of enabledBindings) {
    const readiness = snapshot.capabilities.find(
      (item) =>
        item.bindingId === binding.bindingId
        && item.bindingRevision === binding.revision
        && item.capabilityId === binding.capabilityId
        && item.capabilityVersion === binding.capabilityVersion,
    );
    const candidateState = readiness
      ? composerStateFromCapability(readiness.state)
      : 'unknown';
    if (readinessPriority(candidateState) > readinessPriority(projectedState)) {
      projectedState = candidateState;
      reasonCode = readiness?.reasonCode.trim() || 'capability_readiness_missing';
      authority = readiness?.authority.trim() || STATION_CAPABILITY_AUTHORITY;
    }
  }

  return {
    state: projectedState,
    compatibility: compatibilityFromComposerState(projectedState),
    canSend: projectedState === 'ready' || projectedState === 'degraded',
    authority,
    reasonCode,
    snapshotId,
    runtimeSnapshotId,
    modelCapabilitySnapshotId,
    createdAtMs,
    expiresAtMs,
  };
}
