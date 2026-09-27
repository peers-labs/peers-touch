import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HomeErrorCode,
  HomeProjectionFreshness,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';
import { useHomeStore } from './home';

describe('home projection store', () => {
  beforeEach(() => {
    useHomeStore.getState().reset();
  });

  it('preserves accepted content and exposes stale retry metadata for an older revision', () => {
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 9n,
        freshness: HomeProjectionFreshness.FRESH,
        pinnedAgents: [{
          agentId: 'agent-1',
          agentName: 'researcher',
          displayName: 'Researcher',
        }],
      }),
    );
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 8n,
        freshness: HomeProjectionFreshness.STALE,
        sliceErrors: [{
          sliceId: 'projection',
          code: HomeErrorCode.PROJECTION_STALE,
          retryable: true,
          recoveryAction: 'retry',
        }],
      }),
    );

    expect(useHomeStore.getState().projection).toMatchObject({
      revision: 9n,
      freshness: HomeProjectionFreshness.STALE,
      pinnedAgents: [{
        agentId: 'agent-1',
        agentName: 'researcher',
        displayName: 'Researcher',
      }],
      sliceErrors: [{
        sliceId: 'projection',
        code: HomeErrorCode.PROJECTION_STALE,
        retryable: true,
        recoveryAction: 'retry',
      }],
    });
    expect(useHomeStore.getState()).toMatchObject({
      loading: false,
      error: null,
    });
  });

  it('accepts a lower revision after the actor scope changes', () => {
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 9n,
      }),
    );
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-2',
        revision: 1n,
      }),
    );

    expect(useHomeStore.getState().projection).toEqual(expect.objectContaining({
      ptid: 'ptid:actor-2',
      revision: 1n,
    }));
  });
});
