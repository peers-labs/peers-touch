import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import type { SocialNativeOperation } from '../../services/socialNativeAdapter';

const ports = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../services/socialNativeAdapter', () => ({
  executeSocialNativeOperation: (
    _session: unknown,
    operation: SocialNativeOperation,
  ) => ports.execute(operation),
}));
vi.mock('../../runtimes/mutationAdmission', () => ({
  requireMobileMutationAdmission: vi.fn(),
}));

import { useSocialCirclesStore } from './socialCircles';
import { useSocialStore } from './socialStore';

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function response(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    bodyBytes: Array.from(new TextEncoder().encode(JSON.stringify({ data }))),
  };
}

describe('Station-owned Social Circle projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSocialCirclesStore.getState().reset();
    useSocialStore.setState({
      authSession: session,
      sessionKey: 'station-a|ptid:alice|device-a|1',
    });
  });

  it('keeps member mutations pending until members and count readbacks converge', async () => {
    let memberPtids: string[] = [];
    ports.execute.mockImplementation(async (operation: SocialNativeOperation) => {
      switch (operation.operationId) {
        case 'social_circle_members_add':
          memberPtids = [...memberPtids, ...operation.member_ptids];
          return response({ addedCount: 1, memberCount: '1' });
        case 'social_circle_members_list':
          return response({
            members: memberPtids.map((actorPtid) => ({
              circleId: '7',
              actorPtid,
            })),
            nextCursor: '',
            hasMore: false,
          });
        case 'social_circles_list':
          return response({
            circles: [{
              id: '7',
              name: 'Family',
              description: '',
              memberCount: String(memberPtids.length),
              ownerPtid: 'ptid:alice',
            }],
            nextCursor: '',
            hasMore: false,
          });
        default:
          throw new Error(`unexpected operation ${operation.operationId}`);
      }
    });

    const pending = useSocialCirclesStore.getState().addMembers('7', ['ptid:bob']);
    expect(useSocialCirclesStore.getState().pendingCircleIds['7']).toBe(true);
    expect(useSocialCirclesStore.getState().membersByCircle['7']).toBeUndefined();

    await pending;

    expect(useSocialCirclesStore.getState().pendingCircleIds['7']).toBe(false);
    expect(useSocialCirclesStore.getState().membersByCircle['7']?.[0]?.actorPtid)
      .toBe('ptid:bob');
    expect(useSocialCirclesStore.getState().circles[0]?.memberCount).toBe(1n);
  });

  it('does not publish a stale Circle page into a replacement session', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    ports.execute.mockReturnValue(new Promise((accept) => { resolve = accept; }));

    const pending = useSocialCirclesStore.getState().refreshCircles();
    useSocialStore.setState({
      authSession: { ...session, stationPeerId: 'station-b' },
    });
    resolve(response({
      circles: [{
        id: '7',
        name: 'Old account',
        memberCount: '0',
        ownerPtid: 'ptid:alice',
      }],
      nextCursor: '',
      hasMore: false,
    }));
    await pending;

    expect(useSocialCirclesStore.getState().circles).toEqual([]);
  });

  it('preserves picker results when remote resolution fails', async () => {
    useSocialCirclesStore.setState({
      sessionKey: 'station-a|ptid:alice|device-a|1',
      pickerResults: [{
        id: 'ptid:bob',
        ptid: 'ptid:bob',
        homeStationPeerId: 'station-a',
        username: 'bob',
        displayName: 'Bob',
        avatar: '',
      }],
    });
    useSocialStore.setState({
      profileGateway: {
        searchActors: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            items: [{
              id: 'ptid:carol',
              ptid: 'ptid:carol',
              homeStationPeerId: 'station-a',
              username: 'carol',
              displayName: 'Carol',
              avatar: '',
            }],
            total: 1,
          },
        }),
        searchFederationActors: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'REMOTE_UNAVAILABLE',
            message: 'mobile.contacts.searchFailed',
            method: 'POST',
            path: '/sub-federation/catalog/search',
          },
        }),
      } as never,
    });

    await useSocialCirclesStore.getState().searchPickerPeople('carol', 'fed-1');

    expect(useSocialCirclesStore.getState().pickerResults).toEqual([
      {
        id: 'ptid:bob',
        ptid: 'ptid:bob',
        homeStationPeerId: 'station-a',
        username: 'bob',
        displayName: 'Bob',
        avatar: '',
      },
    ]);
    expect(useSocialCirclesStore.getState().pickerError)
      .toBe('mobile.contacts.searchFailed');
  });
});
