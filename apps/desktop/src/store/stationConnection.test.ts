import { describe, expect, it } from 'vitest';

import { resolveConversationStationChip } from './stationConnection';

const localReady = {
  initialized: true,
  peerId: 'station-peer-1',
  name: 'Aspen Station',
  realtimeConnected: true,
};

describe('resolveConversationStationChip', () => {
  it('binds local groups to the own station with live connectivity', () => {
    expect(resolveConversationStationChip({
      kind: 'group',
      authorityStationId: '',
      authorityStationName: '',
      localStation: localReady,
    })).toEqual({
      stationId: 'station-peer-1',
      label: 'Aspen Station',
      state: 'connected',
    });
  });

  it('reports disconnected when the realtime channel is down', () => {
    const chip = resolveConversationStationChip({
      kind: 'group',
      authorityStationId: '',
      authorityStationName: '',
      localStation: { ...localReady, realtimeConnected: false },
    });
    expect(chip?.state).toBe('disconnected');
  });

  it('hides the group chip before hydration or without a human name', () => {
    expect(resolveConversationStationChip({
      kind: 'group',
      authorityStationId: '',
      authorityStationName: '',
      localStation: { ...localReady, initialized: false },
    })).toBeNull();

    expect(resolveConversationStationChip({
      kind: 'group',
      authorityStationId: '',
      authorityStationName: '',
      localStation: { ...localReady, name: '', peerId: '12D3abc' },
    })).toBeNull();
  });

  it('shows a known federated authority station neutrally for direct chats', () => {
    expect(resolveConversationStationChip({
      kind: 'friend',
      authorityStationId: 'station-peer-9',
      authorityStationName: 'Birch Station',
      localStation: localReady,
    })).toEqual({
      stationId: 'station-peer-9',
      label: 'Birch Station',
      state: 'neutral',
    });
  });

  it('hides the direct-chat chip when the authority station is unknown', () => {
    expect(resolveConversationStationChip({
      kind: 'friend',
      authorityStationId: '',
      authorityStationName: '',
      localStation: localReady,
    })).toBeNull();
  });
});
