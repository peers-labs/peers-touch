import { describe, expect, it } from 'vitest';

import {
  isReadablePrivateMomentProjection,
  normalizePrivateMomentProjection,
  privateDeliveryNoticeState,
} from '../../services/privateMomentsNative';

function readableProjection(overrides: Record<string, unknown> = {}) {
  return {
    post_id: '01REMOTEPRIVATEPOST000000001',
    content_id: '01REMOTEPRIVATEPOST000000001',
    generation: '1',
    author_ptid: 'ptid:alice',
    audience_kind: 'FRIENDS',
    state: 'CONTENT_READY',
    remote_delivery_state: 'PENDING',
    mentions: [],
    reactions: [],
    reaction_revision: '0',
    reactions_hydrated: true,
    content: {
      kind: 'TEXT',
      text: 'encrypted content opened locally',
    },
    ...overrides,
  };
}

describe('cross-Station private Moment delivery resilience', () => {
  it('projects pending and retrying delivery without changing content truth', () => {
    const pending = normalizePrivateMomentProjection(readableProjection());
    const retrying = normalizePrivateMomentProjection(readableProjection({
      remote_delivery_state: 'RETRYING',
    }));

    expect(privateDeliveryNoticeState(pending.remoteDeliveryState))
      .toBe('REMOTE_DELIVERY_PENDING');
    expect(privateDeliveryNoticeState(retrying.remoteDeliveryState))
      .toBe('REMOTE_DELIVERY_RETRYING');
    expect(pending.state).toBe('CONTENT_READY');
    expect(pending.content).toEqual({
      kind: 'TEXT',
      text: 'encrypted content opened locally',
    });
  });

  it('keeps verified content readable during retry when the remote source is unavailable', () => {
    const projection = normalizePrivateMomentProjection(readableProjection({
      state: 'REMOTE_SOURCE_UNAVAILABLE',
      remote_delivery_state: undefined,
      error_code: 'REMOTE_SOURCE_UNAVAILABLE',
    }));

    expect(projection.state).toBe('REMOTE_SOURCE_UNAVAILABLE');
    expect(projection.content?.kind).toBe('TEXT');
    expect(isReadablePrivateMomentProjection(projection)).toBe(true);
  });

  it('surfaces terminal and expired delivery as explicit non-retrying states', () => {
    expect(privateDeliveryNoticeState('TERMINAL')).toBe('REMOTE_DELIVERY_FAILED');
    expect(privateDeliveryNoticeState('EXPIRED')).toBe('REMOTE_DELIVERY_EXPIRED');
    expect(privateDeliveryNoticeState('DELIVERED')).toBeUndefined();
  });
});
