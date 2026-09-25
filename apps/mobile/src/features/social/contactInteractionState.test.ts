import { describe, expect, it } from 'vitest';

import {
  classifyPeopleSearchFeedback,
  FriendRequestDecisionFence,
} from './contactInteractionState';
import { SocialApiError } from './socialTypes';

function searchError(input: {
  path: string;
  status?: number;
  code?: string;
  message?: string;
}) {
  return new SocialApiError({
    method: 'GET',
    path: input.path,
    status: input.status,
    code: input.code,
    message: input.message ?? 'search failed',
  });
}

describe('Contacts MF-M search feedback', () => {
  it('keeps local no-result and unresolved federated handle distinct', () => {
    expect(classifyPeopleSearchFeedback({
      query: 'bob',
      resultCount: 0,
      loading: false,
      error: null,
    })).toBe('local-no-result');
    expect(classifyPeopleSearchFeedback({
      query: '@bob@remote.example',
      resultCount: 0,
      loading: false,
      error: null,
    })).toBe('unresolved-federated-handle');
    expect(classifyPeopleSearchFeedback({
      query: '@bob@remote.example',
      resultCount: 0,
      loading: false,
      error: searchError({
        path: '/actor/federation/resolve',
        status: 404,
        code: 'ACTOR_NOT_FOUND',
      }),
    })).toBe('unresolved-federated-handle');
  });

  it('reports remote unavailability only for a federated resolution transport', () => {
    expect(classifyPeopleSearchFeedback({
      query: '@bob@remote.example',
      resultCount: 0,
      loading: false,
      error: searchError({
        path: '/actor/federation/resolve',
        status: 503,
      }),
    })).toBe('remote-unavailable');
    expect(classifyPeopleSearchFeedback({
      query: 'bob',
      resultCount: 0,
      loading: false,
      error: searchError({
        path: '/api/v1/social/users/search',
        status: 503,
      }),
    })).toBe('failed');
  });
});

describe('Contacts MF-M request decision fence', () => {
  it('fences accept and reject until projection removal', () => {
    const fence = new FriendRequestDecisionFence();
    const scope = 'station-a\u0000ptid:alice';

    expect(fence.begin(scope, 'request-1', 'accept')).toBe(true);
    expect(fence.begin(scope, 'request-1', 'reject')).toBe(false);
    expect(fence.snapshot(scope)).toEqual({
      'request-1': { action: 'accept', phase: 'pending' },
    });

    fence.markUnknown(scope, 'request-1');
    fence.syncAuthoritativeRequests(scope, new Set(['request-1']));
    expect(fence.snapshot(scope)).toEqual({
      'request-1': { action: 'accept', phase: 'unknown' },
    });
    expect(fence.begin(scope, 'request-1', 'accept')).toBe(false);

    fence.syncAuthoritativeRequests(scope, new Set());
    expect(fence.snapshot(scope)).toEqual({});
    expect(fence.begin(scope, 'request-1', 'reject')).toBe(true);
  });

  it('isolates identical request IDs by Station and actor scope', () => {
    const fence = new FriendRequestDecisionFence();
    expect(fence.begin('station-a\u0000ptid:alice', 'request-1', 'accept')).toBe(true);
    expect(fence.begin('station-b\u0000ptid:alice', 'request-1', 'reject')).toBe(true);
    expect(fence.snapshot('station-a\u0000ptid:alice')['request-1']?.action).toBe('accept');
    expect(fence.snapshot('station-b\u0000ptid:alice')['request-1']?.action).toBe('reject');
  });
});
