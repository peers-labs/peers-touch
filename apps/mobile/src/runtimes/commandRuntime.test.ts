// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import {
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  MobileDurableCommandState,
  MomentDraftPayloadSchema,
} from '../gen/proto/domain/mobile/reliability_pb';
import {
  applyReliabilityCommandRecoveryAction,
  applyReliabilityProjectionCheckpoints,
  discardReliabilityDrafts,
  getDraftRestorationPort,
  nextReliabilityRetryDelay,
  notifyReliabilityCommandChanged,
  prepareReliabilityScopeExit,
  readReliabilityRuntimeStatus,
  reliabilityCommandRecoveryActions,
  registerDraftRestorationConsumer,
  registerReliabilityReconciliationWake,
  restoreReliabilityDrafts,
  type CommandProjection,
  type DraftProjection,
} from './commandRuntime';

describe('commandRuntime draft recovery', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('revalidates and delivers every restored draft through its typed consumer', async () => {
    const draft = momentDraft();
    const consumer = vi.fn();
    const unregister = registerDraftRestorationConsumer(
      draft.stationPeerId,
      draft.actorPtid,
      draft.surfaceKind,
      draft.targetId,
      consumer,
    );
    invokeMock.mockResolvedValue(
      Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft)),
    );

    try {
      await expect(restoreReliabilityDrafts([projection(draft)]))
        .resolves.toEqual([draft]);
    } finally {
      unregister();
    }
    expect(consumer).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledWith(draft);
    expect(invokeMock).toHaveBeenCalledWith('draft_load', {
      input: {
        stationPeerId: 'station-a',
        actorPtid: 'ptid:alice',
        surfaceKind: MobileDraftSurfaceKind.MOMENT_COMPOSER,
        targetId: 'compose',
      },
    });
  });

  it('delivers a restored draft when its non-alive composer mounts later', async () => {
    const draft = momentDraft();
    const consumer = vi.fn();
    invokeMock.mockResolvedValue(
      Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft)),
    );

    await restoreReliabilityDrafts([projection(draft)]);
    expect(consumer).not.toHaveBeenCalled();

    const unregister = registerDraftRestorationConsumer(
      draft.stationPeerId,
      draft.actorPtid,
      draft.surfaceKind,
      draft.targetId,
      consumer,
    );
    try {
      expect(consumer).toHaveBeenCalledOnce();
      expect(consumer).toHaveBeenCalledWith(draft);
    } finally {
      unregister();
    }
  });

  it('lets an existing direct port consumer claim a deferred typed draft', async () => {
    const draft = momentDraft('direct-consumer');
    const encoded = Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft));
    invokeMock.mockResolvedValue(encoded);

    await restoreReliabilityDrafts([projection(draft)]);
    await expect(getDraftRestorationPort().load(
      draft.stationPeerId,
      draft.actorPtid,
      draft.surfaceKind,
      draft.targetId,
    )).resolves.toEqual(draft);

    const consumer = vi.fn();
    const unregister = registerDraftRestorationConsumer(
      draft.stationPeerId,
      draft.actorPtid,
      draft.surfaceKind,
      draft.targetId,
      consumer,
    );
    try {
      expect(consumer).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it('propagates consumer delivery failure instead of fabricating no draft', async () => {
    const draft = momentDraft('delivery-failure');
    const unregister = registerDraftRestorationConsumer(
      draft.stationPeerId,
      draft.actorPtid,
      draft.surfaceKind,
      draft.targetId,
      () => {
        throw new Error('consumer rejected draft');
      },
    );
    invokeMock.mockResolvedValue(
      Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft)),
    );

    try {
      await expect(restoreReliabilityDrafts([projection(draft)]))
        .rejects.toThrow('consumer rejected draft');
    } finally {
      unregister();
    }
  });

  it('keeps recovery visible when a projected draft is no longer readable', async () => {
    invokeMock.mockResolvedValue(null);

    await expect(restoreReliabilityDrafts([projection(momentDraft())]))
      .rejects.toThrow('mobile.reliability.draftMissing');
  });

  it('verifies logical absence before completing explicit discard', async () => {
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(null);

    await expect(discardReliabilityDrafts([projection(momentDraft())]))
      .resolves.toBeUndefined();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'draft_remove',
      'draft_load',
    ]);
  });

  it('fails closed when the Rust owner still returns a discarded draft', async () => {
    const draft = momentDraft();
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(
        Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft)),
      );

    await expect(discardReliabilityDrafts([projection(draft)]))
      .rejects.toThrow('mobile.reliability.draftDiscardIncomplete');
  });

  it('schedules the earliest persisted retry without exceeding timer bounds', () => {
    const commands = [
      retryProjection(8_000),
      retryProjection(6_000),
      { ...retryProjection(5_000), state: 'unknown-outcome' },
    ];

    expect(nextReliabilityRetryDelay(commands, 4_000)).toBe(2_000);
    expect(nextReliabilityRetryDelay(commands, 9_000)).toBe(0);
    expect(nextReliabilityRetryDelay([], 4_000)).toBeNull();
  });

  it('routes command admission wakeups to the single runtime owner', () => {
    const wake = vi.fn();
    const unregister = registerReliabilityReconciliationWake(wake);
    try {
      notifyReliabilityCommandChanged();
      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
    notifyReliabilityCommandChanged();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('derives only state-valid recovery actions from the generated state', () => {
    expect(reliabilityCommandRecoveryActions(
      commandProjection(MobileDurableCommandState.QUEUED),
    )).toEqual(['cancel']);
    expect(reliabilityCommandRecoveryActions(
      commandProjection(MobileDurableCommandState.RETRY_WAIT),
    )).toEqual(['cancel']);
    expect(reliabilityCommandRecoveryActions(
      commandProjection(MobileDurableCommandState.UNRESOLVED),
    )).toEqual(['reconcile', 'discard-tracking']);
    expect(reliabilityCommandRecoveryActions(
      commandProjection(MobileDurableCommandState.FAILED_TERMINAL),
    )).toEqual(['acknowledge']);
    expect(reliabilityCommandRecoveryActions(
      commandProjection(MobileDurableCommandState.COMMITTED),
    )).toEqual([]);
  });

  it('routes command recovery actions through the Rust owner', async () => {
    invokeMock.mockResolvedValue(undefined);
    const queued = commandProjection(MobileDurableCommandState.QUEUED);
    const unresolved = commandProjection(MobileDurableCommandState.UNRESOLVED);
    const failed = commandProjection(MobileDurableCommandState.FAILED_TERMINAL);

    await applyReliabilityCommandRecoveryAction('cancel', [queued, unresolved]);
    await applyReliabilityCommandRecoveryAction('discard-tracking', [unresolved]);
    await applyReliabilityCommandRecoveryAction('acknowledge', [failed]);
    await applyReliabilityCommandRecoveryAction('reconcile', [unresolved]);

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'reliability_cancel_command',
      'reliability_discard_unresolved',
      'reliability_acknowledge_terminal_failure',
      'social_friend_request_reconcile',
      'social_relationship_reconcile',
    ]);
  });

  it('reads exact record and byte capacity with the native exhaustion cause', async () => {
    const status = {
      active: true,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      runtimeGeneration: 7,
      admissionOpen: true,
      pendingCommands: 64,
      unknownCommands: 0,
      draftCount: 0,
      archivedLegacyFiles: 0,
      commandCapacity: {
        recordCount: 64,
        recordLimit: 512,
        byteUsage: 16_700_000,
        byteLimit: 16_777_216,
        exhaustionCauses: ['byte-capacity'],
      },
    };
    invokeMock.mockResolvedValue(status);

    await expect(readReliabilityRuntimeStatus()).resolves.toEqual(status);
    expect(invokeMock).toHaveBeenCalledWith('reliability_status');
  });

  it('prepares scope exit through the exact Station, actor, and generation', async () => {
    invokeMock.mockResolvedValue({
      active: true,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      runtimeGeneration: 7,
      admissionOpen: false,
      pendingCommands: 0,
      unknownCommands: 0,
      draftCount: 2,
      archivedLegacyFiles: 0,
    });

    await prepareReliabilityScopeExit('station-a', 'ptid:alice', 7);

    expect(invokeMock).toHaveBeenCalledWith(
      'reliability_prepare_scope_exit',
      {
        input: {
          stationPeerId: 'station-a',
          actorPtid: 'ptid:alice',
          runtimeGeneration: 7,
        },
      },
    );
  });

  it('replays projection application after a checkpoint acknowledgement interruption', async () => {
    const checkpoint = {
      commandId: 'command-checkpoint',
      payloadSha256: [1, 2, 3],
      authoritativeLookupBytes: [4, 5, 6],
      createdAtMs: 42,
    };
    const applyProjection = vi.fn().mockResolvedValue(undefined);
    invokeMock
      .mockResolvedValueOnce([checkpoint])
      .mockRejectedValueOnce(new Error('ack interrupted'))
      .mockResolvedValueOnce([checkpoint])
      .mockResolvedValueOnce(undefined);

    await expect(
      applyReliabilityProjectionCheckpoints(
        'station-a',
        'ptid:alice',
        7,
        applyProjection,
      ),
    ).rejects.toThrow('ack interrupted');
    await expect(
      applyReliabilityProjectionCheckpoints(
        'station-a',
        'ptid:alice',
        7,
        applyProjection,
      ),
    ).resolves.toBe(1);

    expect(applyProjection).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'reliability_list_projection_checkpoints',
      'reliability_acknowledge_projection',
      'reliability_list_projection_checkpoints',
      'reliability_acknowledge_projection',
    ]);
  });

  it('coalesces concurrent projection application for one runtime scope', async () => {
    const checkpoint = {
      commandId: 'command-checkpoint',
      payloadSha256: [1, 2, 3],
      authoritativeLookupBytes: [4, 5, 6],
      createdAtMs: 42,
    };
    let releaseProjection!: () => void;
    const projectionApplied = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    const applyProjection = vi.fn(() => projectionApplied);
    invokeMock
      .mockResolvedValueOnce([checkpoint])
      .mockResolvedValueOnce(undefined);

    const first = applyReliabilityProjectionCheckpoints(
      'station-a',
      'ptid:alice',
      7,
      applyProjection,
    );
    const second = applyReliabilityProjectionCheckpoints(
      'station-a',
      'ptid:alice',
      7,
      applyProjection,
    );
    releaseProjection();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(applyProjection).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'reliability_list_projection_checkpoints',
      'reliability_acknowledge_projection',
    ]);
  });
});

function momentDraft(targetId = 'compose') {
  return create(MobileDraftEnvelopeV2Schema, {
    schemaRevision: 2,
    stationPeerId: 'station-a',
    actorPtid: 'ptid:alice',
    surfaceKind: MobileDraftSurfaceKind.MOMENT_COMPOSER,
    targetId,
    updatedAt: timestampFromMs(42),
    payload: {
      case: 'moment',
      value: create(MomentDraftPayloadSchema, {
        text: 'retained draft',
        mediaRefs: [],
      }),
    },
  });
}

function projection(
  envelope: ReturnType<typeof momentDraft>,
): DraftProjection {
  return {
    key: `${envelope.surfaceKind}:${envelope.targetId}`,
    kind: 'moments',
    surfaceKind: 'moment',
    targetId: envelope.targetId,
    updatedAtMs: 42,
    envelope,
  };
}

function retryProjection(nextAttemptAtMs: number): CommandProjection {
  return {
    commandId: `command-${nextAttemptAtMs}`,
    orderingKey: 'friend:ptid:bob',
    state: 'failed-retryable',
    attemptCount: 1,
    typedLastError: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    nextAttemptAtMs,
    envelope: {},
  } as CommandProjection;
}

function commandProjection(state: MobileDurableCommandState): CommandProjection {
  return {
    commandId: `command-${state}`,
    orderingKey: 'friend:ptid:bob',
    state: 'unknown-outcome',
    attemptCount: 1,
    typedLastError: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    nextAttemptAtMs: null,
    envelope: {
      commandId: `command-${state}`,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      state,
    },
  } as CommandProjection;
}
