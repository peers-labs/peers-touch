import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { timestampMs } from '@bufbuild/protobuf/wkt';
import { invoke } from '@tauri-apps/api/core';

import {
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  MobileDurableCommandEnvelopeV2Schema,
  MobileDurableCommandErrorCode,
  MobileDurableCommandState,
  type MobileDraftEnvelopeV2,
  type MobileDurableCommandEnvelopeV2,
} from '../gen/proto/domain/mobile/reliability_pb';

export type DraftDisposition = 'retain' | 'discard';
export type LegacyReliabilityDisposition = 'retain' | 'discard-legacy';
export type ReliabilityCommandRecoveryAction =
  | 'reconcile'
  | 'cancel'
  | 'acknowledge'
  | 'discard-tracking';

export type CommandState =
  | 'pending'
  | 'failed-retryable'
  | 'committed'
  | 'failed-terminal'
  | 'unknown-outcome'
  | 'reconciling'
  | 'cancelled';

export interface ReliabilityRuntimeStatus {
  readonly active: boolean;
  readonly stationPeerId?: string;
  readonly actorPtid?: string;
  readonly runtimeGeneration: number;
  readonly admissionOpen: boolean;
  readonly pendingCommands: number;
  readonly unknownCommands: number;
  readonly draftCount: number;
  readonly recoveryState?: 'legacy-disposition-required' | 'reset-incomplete';
  readonly archivedLegacyFiles: number;
}

export type ReliabilityCapacityExhaustionCause =
  | 'record-count'
  | 'byte-capacity';

export interface ReliabilityCommandCapacityStatus {
  readonly recordCount: number;
  readonly recordLimit: number;
  readonly byteUsage: number;
  readonly byteLimit: number;
  readonly exhaustionCauses: readonly ReliabilityCapacityExhaustionCause[];
}

export interface ReliabilityRuntimeStatusProjection
  extends ReliabilityRuntimeStatus {
  readonly commandCapacity: ReliabilityCommandCapacityStatus;
}

export interface ReliabilityScopeCloseResult {
  readonly closed: boolean;
  readonly draftDisposition: DraftDisposition;
  readonly retainedDrafts: number;
  readonly recordsAbsent: boolean;
  readonly securePhysicalDeletionProven: false;
}

export interface ReliabilityCleanupResult {
  readonly recordsAbsent: boolean;
  readonly pathsAbsent: boolean;
  readonly keysAbsent: boolean;
  readonly securePhysicalDeletionProven: false;
}

export interface LegacyDispositionProjection extends ReliabilityCleanupResult {
  readonly recoveryState?: 'legacy-disposition-required';
  readonly archivedLegacyFiles: number;
}

export interface FriendRequestCommandProjection {
  readonly commandId: string;
  readonly requestId: string;
  readonly payloadSha256: readonly number[];
  readonly state: CommandState;
  readonly responseBytes?: readonly number[];
  readonly checkpointReady: boolean;
}

export interface SocialRelationshipCommandProjection {
  readonly commandId: string;
  readonly targetPtid: string;
  readonly payloadSha256: readonly number[];
  readonly state: CommandState;
  readonly responseBytes?: readonly number[];
  readonly checkpointReady: boolean;
}

export interface ReliabilityCheckpointProjection {
  readonly commandId: string;
  readonly payloadSha256: readonly number[];
  readonly authoritativeLookupBytes: readonly number[];
  readonly createdAtMs: number;
}

export interface CommandProjection {
  readonly commandId: string;
  readonly orderingKey: string;
  readonly state: CommandState;
  readonly attemptCount: number;
  readonly typedLastError: MobileDurableCommandErrorCode;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly nextAttemptAtMs: number | null;
  readonly envelope: MobileDurableCommandEnvelopeV2;
}

export interface DraftProjection {
  readonly key: string;
  readonly kind: 'chat' | 'moments';
  readonly surfaceKind: 'chat' | 'moment';
  readonly targetId: string;
  readonly updatedAtMs: number;
  readonly envelope: MobileDraftEnvelopeV2;
}

export interface DraftRestorationPort {
  save(envelope: MobileDraftEnvelopeV2): Promise<void>;
  load(
    stationPeerId: string,
    actorPtid: string,
    surfaceKind: MobileDraftSurfaceKind,
    targetId: string,
  ): Promise<MobileDraftEnvelopeV2 | null>;
  list(
    stationPeerId: string,
    actorPtid: string,
    surfaceKind?: MobileDraftSurfaceKind,
  ): Promise<DraftProjection[]>;
  remove(
    stationPeerId: string,
    actorPtid: string,
    surfaceKind: MobileDraftSurfaceKind,
    targetId: string,
  ): Promise<boolean>;
}

export type DraftRestorationConsumer = (
  envelope: MobileDraftEnvelopeV2,
) => void;

const MAX_RELIABILITY_TIMER_DELAY_MS = 2_147_000_000;
let reliabilityReconciliationWake: (() => void) | null = null;
// Process-local handoff only: Rust remains the sole durable draft owner.
const draftRestorationConsumers = new Map<string, DraftRestorationConsumer>();
const pendingDraftRestorations = new Map<string, MobileDraftEnvelopeV2>();
const observedDraftConsumers = new Set<string>();

function draftRestorationKey(
  stationPeerId: string,
  actorPtid: string,
  surfaceKind: MobileDraftSurfaceKind,
  targetId: string,
): string {
  return JSON.stringify([stationPeerId, actorPtid, surfaceKind, targetId]);
}

function envelopeRestorationKey(envelope: MobileDraftEnvelopeV2): string {
  return draftRestorationKey(
    envelope.stationPeerId,
    envelope.actorPtid,
    envelope.surfaceKind,
    envelope.targetId,
  );
}

function assertRestorableDraftEnvelope(envelope: MobileDraftEnvelopeV2): void {
  const payloadMatchesSurface =
    (
      envelope.surfaceKind === MobileDraftSurfaceKind.CHAT_COMPOSER
      && envelope.payload.case === 'chat'
    )
    || (
      envelope.surfaceKind === MobileDraftSurfaceKind.MOMENT_COMPOSER
      && envelope.payload.case === 'moment'
    );
  if (!payloadMatchesSurface) {
    throw new Error('mobile.reliability.draftPayloadMismatch');
  }
}

async function loadDraftEnvelopeFromOwner(
  stationPeerId: string,
  actorPtid: string,
  surfaceKind: MobileDraftSurfaceKind,
  targetId: string,
): Promise<MobileDraftEnvelopeV2 | null> {
  const bytes = await invoke<readonly number[] | null>('draft_load', {
    input: { stationPeerId, actorPtid, surfaceKind, targetId },
  });
  return bytes
    ? fromBinary(MobileDraftEnvelopeV2Schema, Uint8Array.from(bytes))
    : null;
}

function deliverRestoredDraft(envelope: MobileDraftEnvelopeV2): void {
  assertRestorableDraftEnvelope(envelope);
  const key = envelopeRestorationKey(envelope);
  const consumer = draftRestorationConsumers.get(key);
  if (!consumer) {
    if (!observedDraftConsumers.has(key)) {
      pendingDraftRestorations.set(key, envelope);
    }
    return;
  }

  pendingDraftRestorations.set(key, envelope);
  consumer(envelope);
  pendingDraftRestorations.delete(key);
  observedDraftConsumers.add(key);
}

export function registerDraftRestorationConsumer(
  stationPeerId: string,
  actorPtid: string,
  surfaceKind: MobileDraftSurfaceKind,
  targetId: string,
  consumer: DraftRestorationConsumer,
): () => void {
  const key = draftRestorationKey(
    stationPeerId,
    actorPtid,
    surfaceKind,
    targetId,
  );
  if (draftRestorationConsumers.has(key)) {
    throw new Error('mobile.reliability.draftConsumerAlreadyRegistered');
  }

  draftRestorationConsumers.set(key, consumer);
  const pending = pendingDraftRestorations.get(key);
  if (pending) {
    try {
      consumer(pending);
      pendingDraftRestorations.delete(key);
      observedDraftConsumers.add(key);
    } catch (error) {
      draftRestorationConsumers.delete(key);
      throw error;
    }
  }

  return () => {
    if (draftRestorationConsumers.get(key) === consumer) {
      draftRestorationConsumers.delete(key);
      observedDraftConsumers.delete(key);
    }
  };
}

export function registerReliabilityReconciliationWake(
  wake: () => void,
): () => void {
  if (reliabilityReconciliationWake) {
    throw new Error('mobile.reliability.reconciliationWakeAlreadyRegistered');
  }
  reliabilityReconciliationWake = wake;
  return () => {
    if (reliabilityReconciliationWake === wake) {
      reliabilityReconciliationWake = null;
    }
  };
}

export function notifyReliabilityCommandChanged(): void {
  reliabilityReconciliationWake?.();
}

export function nextReliabilityRetryDelay(
  commands: readonly CommandProjection[],
  nowMs: number,
): number | null {
  let earliest: number | null = null;
  for (const command of commands) {
    if (
      command.state !== 'failed-retryable'
      || command.nextAttemptAtMs === null
    ) {
      continue;
    }
    earliest = earliest === null
      ? command.nextAttemptAtMs
      : Math.min(earliest, command.nextAttemptAtMs);
  }
  if (earliest === null) return null;
  return Math.min(
    MAX_RELIABILITY_TIMER_DELAY_MS,
    Math.max(0, earliest - nowMs),
  );
}

export async function activateReliabilityRuntime(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<ReliabilityRuntimeStatus> {
  return invoke<ReliabilityRuntimeStatus>('reliability_activate', {
    input: { stationPeerId, actorPtid, runtimeGeneration },
  });
}

export async function readReliabilityRuntimeStatus(): Promise<ReliabilityRuntimeStatusProjection> {
  return invoke<ReliabilityRuntimeStatusProjection>('reliability_status');
}

export async function rebindReliabilityGeneration(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<ReliabilityRuntimeStatus> {
  return invoke<ReliabilityRuntimeStatus>('reliability_rebind_generation', {
    input: { stationPeerId, actorPtid, runtimeGeneration },
  });
}

export async function suspendReliabilityRuntime(): Promise<ReliabilityRuntimeStatus> {
  return invoke<ReliabilityRuntimeStatus>('reliability_suspend');
}

export async function prepareReliabilityScopeExit(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<ReliabilityRuntimeStatus> {
  return invoke<ReliabilityRuntimeStatus>('reliability_prepare_scope_exit', {
    input: { stationPeerId, actorPtid, runtimeGeneration },
  });
}

export async function openReliabilityAdmission(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<ReliabilityRuntimeStatus> {
  return invoke<ReliabilityRuntimeStatus>('reliability_open_admission', {
    input: { stationPeerId, actorPtid, runtimeGeneration },
  });
}

export async function closeReliabilityScope(
  draftDisposition: DraftDisposition,
): Promise<ReliabilityScopeCloseResult> {
  return invoke<ReliabilityScopeCloseResult>('reliability_close_scope', {
    input: { draftDisposition },
  });
}

export async function applyLegacyReliabilityDisposition(
  action: LegacyReliabilityDisposition,
): Promise<LegacyDispositionProjection> {
  return invoke<LegacyDispositionProjection>('reliability_apply_legacy_disposition', {
    input: { action },
  });
}

export async function resetAllLocalReliabilityData(): Promise<ReliabilityCleanupResult> {
  const result = await invoke<ReliabilityCleanupResult>('reliability_reset_all', {
    input: { confirmation: 'reset-all-local-reliability-data' },
  });
  pendingDraftRestorations.clear();
  observedDraftConsumers.clear();
  return result;
}

export async function listReliabilityCommands(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<CommandProjection[]> {
  const encoded = await invoke<readonly number[][]>('reliability_list_commands', {
    input: { stationPeerId, actorPtid, runtimeGeneration },
  });
  return encoded.map((bytes) => commandProjection(
    fromBinary(MobileDurableCommandEnvelopeV2Schema, Uint8Array.from(bytes)),
  ));
}

export async function listReliabilityProjectionCheckpoints(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<ReliabilityCheckpointProjection[]> {
  return invoke<ReliabilityCheckpointProjection[]>(
    'reliability_list_projection_checkpoints',
    { input: { stationPeerId, actorPtid, runtimeGeneration } },
  );
}

export async function cancelReliabilityCommand(
  stationPeerId: string,
  actorPtid: string,
  commandId: string,
): Promise<void> {
  await invoke('reliability_cancel_command', {
    input: { stationPeerId, actorPtid, commandId },
  });
}

export async function acknowledgeReliabilityProjection(
  stationPeerId: string,
  actorPtid: string,
  commandId: string,
  payloadSha256: readonly number[],
): Promise<void> {
  await invoke('reliability_acknowledge_projection', {
    input: { stationPeerId, actorPtid, commandId, payloadSha256 },
  });
}

const projectionCheckpointApplications = new Map<string, Promise<number>>();

export async function applyReliabilityProjectionCheckpoints(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
  applyProjection: () => Promise<void>,
): Promise<number> {
  const scopeKey = `${stationPeerId}\u001f${actorPtid}\u001f${runtimeGeneration}`;
  const active = projectionCheckpointApplications.get(scopeKey);
  if (active) return active;

  const operation = (async () => {
    const checkpoints = await listReliabilityProjectionCheckpoints(
      stationPeerId,
      actorPtid,
      runtimeGeneration,
    );
    if (checkpoints.length === 0) return 0;
    await applyProjection();
    for (const checkpoint of checkpoints) {
      await acknowledgeReliabilityProjection(
        stationPeerId,
        actorPtid,
        checkpoint.commandId,
        checkpoint.payloadSha256,
      );
    }
    return checkpoints.length;
  })();
  projectionCheckpointApplications.set(scopeKey, operation);
  try {
    return await operation;
  } finally {
    if (projectionCheckpointApplications.get(scopeKey) === operation) {
      projectionCheckpointApplications.delete(scopeKey);
    }
  }
}

export async function acknowledgeTerminalReliabilityFailure(
  stationPeerId: string,
  actorPtid: string,
  commandId: string,
): Promise<void> {
  await invoke('reliability_acknowledge_terminal_failure', {
    input: { stationPeerId, actorPtid, commandId },
  });
}

export async function discardUnresolvedReliabilityCommand(
  stationPeerId: string,
  actorPtid: string,
  commandId: string,
): Promise<void> {
  await invoke('reliability_discard_unresolved', {
    input: { stationPeerId, actorPtid, commandId },
  });
}

export function reliabilityCommandRecoveryActions(
  command: CommandProjection,
): readonly ReliabilityCommandRecoveryAction[] {
  switch (command.envelope.state) {
    case MobileDurableCommandState.QUEUED:
    case MobileDurableCommandState.RETRY_WAIT:
      return ['cancel'];
    case MobileDurableCommandState.UNKNOWN_OUTCOME:
    case MobileDurableCommandState.RECONCILING:
      return ['reconcile'];
    case MobileDurableCommandState.UNRESOLVED:
      return ['reconcile', 'discard-tracking'];
    case MobileDurableCommandState.FAILED_TERMINAL:
      return ['acknowledge'];
    default:
      return [];
  }
}

export async function applyReliabilityCommandRecoveryAction(
  action: ReliabilityCommandRecoveryAction,
  commands: readonly CommandProjection[],
): Promise<void> {
  const eligible = commands.filter((command) =>
    reliabilityCommandRecoveryActions(command).includes(action)
  );
  if (eligible.length === 0) return;

  if (action === 'reconcile') {
    const scopes = new Map<string, { stationPeerId: string; actorPtid: string }>();
    for (const command of eligible) {
      const { stationPeerId, actorPtid } = command.envelope;
      scopes.set(`${stationPeerId}\u001f${actorPtid}`, {
        stationPeerId,
        actorPtid,
      });
    }
    for (const scope of scopes.values()) {
      await reconcileReliableFriendRequests(scope.stationPeerId, scope.actorPtid);
      await reconcileReliableSocialRelationships(
        scope.stationPeerId,
        scope.actorPtid,
      );
    }
  } else {
    for (const command of eligible) {
      const { stationPeerId, actorPtid } = command.envelope;
      if (action === 'cancel') {
        await cancelReliabilityCommand(
          stationPeerId,
          actorPtid,
          command.commandId,
        );
      } else if (action === 'acknowledge') {
        await acknowledgeTerminalReliabilityFailure(
          stationPeerId,
          actorPtid,
          command.commandId,
        );
      } else {
        await discardUnresolvedReliabilityCommand(
          stationPeerId,
          actorPtid,
          command.commandId,
        );
      }
    }
  }
  notifyReliabilityCommandChanged();
}

export async function reconcileReliableFriendRequests(
  stationPeerId: string,
  actorPtid: string,
): Promise<FriendRequestCommandProjection[]> {
  return invoke<FriendRequestCommandProjection[]>('social_friend_request_reconcile', {
    input: { stationPeerId, actorPtid },
  });
}

export async function reconcileReliableSocialRelationships(
  stationPeerId: string,
  actorPtid: string,
): Promise<SocialRelationshipCommandProjection[]> {
  return invoke<SocialRelationshipCommandProjection[]>(
    'social_relationship_reconcile',
    { input: { stationPeerId, actorPtid } },
  );
}

export async function restoreReliabilityDrafts(
  drafts: readonly DraftProjection[],
): Promise<readonly MobileDraftEnvelopeV2[]> {
  const restored: MobileDraftEnvelopeV2[] = [];
  for (const draft of drafts) {
    const envelope = await loadDraftEnvelopeFromOwner(
      draft.envelope.stationPeerId,
      draft.envelope.actorPtid,
      draft.envelope.surfaceKind,
      draft.envelope.targetId,
    );
    if (!envelope) {
      throw new Error('mobile.reliability.draftMissing');
    }
    if (envelopeRestorationKey(envelope) !== envelopeRestorationKey(draft.envelope)) {
      throw new Error('mobile.reliability.draftScopeMismatch');
    }
    assertRestorableDraftEnvelope(envelope);
    restored.push(envelope);
  }
  restored.forEach(deliverRestoredDraft);
  return restored;
}

export async function discardReliabilityDrafts(
  drafts: readonly DraftProjection[],
): Promise<void> {
  const port = getDraftRestorationPort();
  for (const draft of drafts) {
    await port.remove(
      draft.envelope.stationPeerId,
      draft.envelope.actorPtid,
      draft.envelope.surfaceKind,
      draft.envelope.targetId,
    );
    const remaining = await loadDraftEnvelopeFromOwner(
      draft.envelope.stationPeerId,
      draft.envelope.actorPtid,
      draft.envelope.surfaceKind,
      draft.envelope.targetId,
    );
    if (remaining) {
      throw new Error('mobile.reliability.draftDiscardIncomplete');
    }
    const key = envelopeRestorationKey(draft.envelope);
    pendingDraftRestorations.delete(key);
    observedDraftConsumers.delete(key);
  }
}

function createDraftRestorationPort(): DraftRestorationPort {
  return {
    async save(envelope): Promise<void> {
      await invoke('draft_save', {
        input: {
          stationPeerId: envelope.stationPeerId,
          actorPtid: envelope.actorPtid,
          envelopeBytes: Array.from(toBinary(MobileDraftEnvelopeV2Schema, envelope)),
        },
      });
    },

    async load(stationPeerId, actorPtid, surfaceKind, targetId) {
      const envelope = await loadDraftEnvelopeFromOwner(
        stationPeerId,
        actorPtid,
        surfaceKind,
        targetId,
      );
      const key = draftRestorationKey(
        stationPeerId,
        actorPtid,
        surfaceKind,
        targetId,
      );
      if (!envelope) {
        observedDraftConsumers.delete(key);
        if (pendingDraftRestorations.has(key)) {
          throw new Error('mobile.reliability.draftMissing');
        }
        return null;
      }
      assertRestorableDraftEnvelope(envelope);
      pendingDraftRestorations.delete(key);
      observedDraftConsumers.add(key);
      return envelope;
    },

    async list(stationPeerId, actorPtid, surfaceKind) {
      const encoded = await invoke<readonly number[][]>('draft_list', {
        input: { stationPeerId, actorPtid, surfaceKind },
      });
      return encoded.map((bytes) => draftProjection(
        fromBinary(MobileDraftEnvelopeV2Schema, Uint8Array.from(bytes)),
      ));
    },

    async remove(stationPeerId, actorPtid, surfaceKind, targetId) {
      return invoke<boolean>('draft_remove', {
        input: { stationPeerId, actorPtid, surfaceKind, targetId },
      });
    },
  };
}

function commandProjection(envelope: MobileDurableCommandEnvelopeV2): CommandProjection {
  return {
    commandId: envelope.commandId,
    orderingKey: envelope.orderingKey,
    state: commandState(envelope.state),
    attemptCount: envelope.attemptCount,
    typedLastError: envelope.typedLastError,
    createdAtMs: envelope.createdAt ? timestampMs(envelope.createdAt) : 0,
    updatedAtMs: envelope.updatedAt ? timestampMs(envelope.updatedAt) : 0,
    nextAttemptAtMs: envelope.nextAttemptAt ? timestampMs(envelope.nextAttemptAt) : null,
    envelope,
  };
}

function draftProjection(envelope: MobileDraftEnvelopeV2): DraftProjection {
  const surfaceKind = envelope.surfaceKind === MobileDraftSurfaceKind.CHAT_COMPOSER
    ? 'chat'
    : 'moment';
  return {
    key: `${envelope.surfaceKind}:${envelope.targetId}`,
    kind: surfaceKind === 'chat' ? 'chat' : 'moments',
    surfaceKind,
    targetId: envelope.targetId,
    updatedAtMs: envelope.updatedAt ? timestampMs(envelope.updatedAt) : 0,
    envelope,
  };
}

function commandState(state: MobileDurableCommandState): CommandState {
  switch (state) {
    case MobileDurableCommandState.QUEUED:
    case MobileDurableCommandState.DISPATCH_FENCED:
    case MobileDurableCommandState.SUBMITTING:
    case MobileDurableCommandState.ACCEPTED_PENDING:
    case MobileDurableCommandState.CHECKPOINTING:
      return 'pending';
    case MobileDurableCommandState.RETRY_WAIT:
      return 'failed-retryable';
    case MobileDurableCommandState.COMMITTED:
      return 'committed';
    case MobileDurableCommandState.FAILED_TERMINAL:
    case MobileDurableCommandState.ACKNOWLEDGED:
      return 'failed-terminal';
    case MobileDurableCommandState.UNKNOWN_OUTCOME:
    case MobileDurableCommandState.UNRESOLVED:
      return 'unknown-outcome';
    case MobileDurableCommandState.RECONCILING:
      return 'reconciling';
    case MobileDurableCommandState.CANCELLED:
    case MobileDurableCommandState.DISCARDED:
    case MobileDurableCommandState.UNSPECIFIED:
      return 'cancelled';
  }
}

let draftPortInstance: DraftRestorationPort | null = null;

export function getDraftRestorationPort(): DraftRestorationPort {
  if (!draftPortInstance) {
    draftPortInstance = createDraftRestorationPort();
  }
  return draftPortInstance;
}
