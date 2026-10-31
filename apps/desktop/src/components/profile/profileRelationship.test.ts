import { describe, expect, it } from 'vitest';

import type { FriendRequestData } from '../../store/socialNormalizers';
import type { Relationship } from '../../gen/proto/domain/social/relationship_pb';
import {
  classifyProfileRelationship,
  findFriendRequest,
} from './profileRelationship';

const SELF = 'ptid:peer:alice';
const PEER = 'ptid:peer:bob';

function request(overrides: Partial<FriendRequestData> = {}): FriendRequestData {
  return {
    id: 'req-1',
    senderPtid: SELF,
    receiverPtid: PEER,
    federationId: 'federation-a',
    senderHomeStationPeerId: 'station-a',
    receiverHomeStationPeerId: 'station-b',
    status: 1,
    message: '',
    createdAt: '2026-10-31T00:00:00Z',
    respondedAt: '',
    senderDisplayName: 'Alice',
    senderAvatar: '',
    receiverDisplayName: 'Bob',
    receiverAvatar: '',
    ...overrides,
  };
}

describe('classifyProfileRelationship', () => {
  it('classifies the current actor as self regardless of edges', () => {
    expect(classifyProfileRelationship({
      actorPtid: SELF,
      currentUserPtid: SELF,
    })).toBe('self');
  });

  it('classifies mutual follow as friend even without a friend request', () => {
    const relationship = { following: true, followedBy: true } as Relationship;
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      relationship,
    })).toBe('friend');
  });

  it('classifies an accepted request as friend', () => {
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      friendRequest: request({ status: 2 }),
    })).toBe('friend');
  });

  it('classifies an outgoing pending request as requested', () => {
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      friendRequest: request({ status: 1 }),
    })).toBe('requested');
  });

  it('classifies an incoming pending request as incoming-request', () => {
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      friendRequest: request({
        status: 1,
        senderPtid: PEER,
        receiverPtid: SELF,
      }),
    })).toBe('incoming-request');
  });

  it('classifies one-way follow, rejected and missing edges as stranger', () => {
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      relationship: { following: true, followedBy: false } as Relationship,
    })).toBe('stranger');
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
      friendRequest: request({ status: 3 }),
    })).toBe('stranger');
    expect(classifyProfileRelationship({
      actorPtid: PEER,
      currentUserPtid: SELF,
    })).toBe('stranger');
  });
});

describe('findFriendRequest', () => {
  it('returns the latest request between the two actors', () => {
    const older = request({
      id: 'req-old',
      status: 3,
      createdAt: '2026-10-01T00:00:00Z',
    });
    const newer = request({
      id: 'req-new',
      status: 1,
      createdAt: '2026-10-20T00:00:00Z',
    });
    const unrelated = request({
      id: 'req-other',
      receiverPtid: 'ptid:peer:carol',
    });
    expect(findFriendRequest([older, unrelated, newer], SELF, PEER)?.id).toBe('req-new');
  });

  it('returns null without a current user or matching request', () => {
    expect(findFriendRequest([request()], null, PEER)).toBeNull();
    expect(findFriendRequest([request()], SELF, 'ptid:peer:carol')).toBeNull();
  });
});
