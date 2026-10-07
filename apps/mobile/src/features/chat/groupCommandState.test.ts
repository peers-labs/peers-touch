import { describe, expect, it, vi } from 'vitest';

import {
  groupCommandOutcomeKey,
  isGroupCommandBusy,
  refreshGroupCommandOutcomes,
  trackGroupCommand,
  type GroupCommandKind,
  type TrackGroupCommandInput,
} from './groupCommandState';

function conversation(overrides = {}) {
  return {
    conversationId: 'group-1',
    authorityStationId: 'station-a',
    federationId: 'federation-a',
    kind: 2,
    name: 'Group',
    description: '',
    ownerPtid: 'ptid:alice',
    memberPtids: ['ptid:alice'],
    members: [{
      ptid: 'ptid:alice',
      role: 3,
      homeStationPeerId: 'station-a',
      muted: false,
    }],
    membershipEpoch: 1,
    mlsEpoch: 1,
    active: true,
    updatedAtUnixMs: 1,
    ...overrides,
  };
}

function pending(
  kind: GroupCommandKind,
  extra: Omit<
    Partial<TrackGroupCommandInput>,
    'commandId' | 'conversationId' | 'kind'
  > = {},
) {
  return trackGroupCommand({}, {
    commandId: `command-${kind}`,
    conversationId: 'group-1',
    kind,
    ...extra,
  });
}

describe('Group command outcomes', () => {
  it.each([
    ['pending', 'pending'],
    ['committed', 'pending'],
    ['retry_wait', 'uncertain'],
    ['submitted', 'uncertain'],
    ['failed', 'failed'],
    ['superseded', 'failed'],
  ] as const)('maps Messaging Engine %s to %s before projection convergence', async (
    state,
    expected,
  ) => {
    const outcomes = pending('add-member', { targetPtid: 'ptid:bob' });
    const refreshed = await refreshGroupCommandOutcomes(
      outcomes,
      [conversation()],
      'ptid:alice',
      vi.fn(async () => ({
        commandId: 'command-add-member',
        conversationId: 'group-1',
        state,
        lastErrorCode: state === 'failed' ? 'authority_rejected' : '',
      })),
    );

    expect(refreshed[
      groupCommandOutcomeKey('group-1', 'add-member', 'ptid:bob')
    ]).toMatchObject({ state: expected });
    expect(isGroupCommandBusy(Object.values(refreshed)[0])).toBe(
      expected !== 'failed',
    );
  });

  it('clears member operations only after authoritative membership appears', async () => {
    const outcomes = pending('add-member', {
      targetPtid: 'ptid:bob',
      expectedRole: 'member',
    });
    const projected = conversation({
      memberPtids: ['ptid:alice', 'ptid:bob'],
      members: [
        conversation().members[0],
        {
          ptid: 'ptid:bob',
          role: 1,
          homeStationPeerId: 'station-b',
          muted: false,
        },
      ],
    });

    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [projected],
      'ptid:alice',
      vi.fn(),
    )).resolves.toEqual({});
  });

  it('clears authority and metadata operations from their exact projections', async () => {
    let outcomes = pending('update', {
      expectedName: 'Renamed',
      expectedDescription: 'Description',
    });
    outcomes = trackGroupCommand(outcomes, {
      commandId: 'command-role',
      conversationId: 'group-1',
      kind: 'update-member',
      targetPtid: 'ptid:bob',
      expectedRole: 'admin',
      expectedMuted: true,
    });
    outcomes = trackGroupCommand(outcomes, {
      commandId: 'command-owner',
      conversationId: 'group-1',
      kind: 'transfer-ownership',
      targetPtid: 'ptid:bob',
    });
    const projected = conversation({
      name: 'Renamed',
      description: 'Description',
      ownerPtid: 'ptid:bob',
      memberPtids: ['ptid:alice', 'ptid:bob'],
      members: [
        conversation().members[0],
        {
          ptid: 'ptid:bob',
          role: 2,
          homeStationPeerId: 'station-b',
          muted: true,
        },
      ],
    });

    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [projected],
      'ptid:alice',
      vi.fn(),
    )).resolves.toEqual({});
  });

  it('keeps a leave intent pending without treating its intent ID as a command ID', async () => {
    const outcomes = trackGroupCommand({}, {
      commandId: 'leave-intent-1',
      conversationId: 'group-1',
      kind: 'leave',
      statusReadable: false,
    });
    const readStatus = vi.fn();

    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [conversation()],
      'ptid:alice',
      readStatus,
    )).resolves.toEqual(outcomes);
    expect(readStatus).not.toHaveBeenCalled();
    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [],
      'ptid:alice',
      readStatus,
    )).resolves.toEqual({});
  });

  it('marks status lookup failure and binding mismatch as uncertain', async () => {
    const outcomes = pending('dissolve');
    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [conversation()],
      'ptid:alice',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    )).resolves.toMatchObject({
      [groupCommandOutcomeKey('group-1', 'dissolve')]: {
        state: 'uncertain',
      },
    });
    await expect(refreshGroupCommandOutcomes(
      outcomes,
      [conversation()],
      'ptid:alice',
      vi.fn(async () => ({
        commandId: 'wrong',
        conversationId: 'group-1',
        state: 'failed' as const,
        lastErrorCode: '',
      })),
    )).resolves.toMatchObject({
      [groupCommandOutcomeKey('group-1', 'dissolve')]: {
        state: 'uncertain',
        lastErrorCode: 'mobile.messaging.commandProjectionBindingMismatch',
      },
    });
  });
});
