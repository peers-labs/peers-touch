import { beforeEach, describe, expect, it, vi } from 'vitest';
import { socialBlockActor, socialUnblockActor } from './social_api';

const wire = vi.hoisted(() => vi.fn());
vi.mock('./desktop_api', () => ({ invokeRustProto: wire }));

describe('Social relationship revision transport', () => {
  beforeEach(() => { wire.mockReset(); wire.mockResolvedValue({}); });

  it('carries a full int64 revision as canonical decimal text', async () => {
    await socialBlockActor({
      targetActorPtid: 'ptid:bob', targetHomeStationPeerId: 'home-bob',
      observedRevision: 9_223_372_036_854_775_807n,
    });
    expect(wire).toHaveBeenCalledWith('social_block_actor', expect.anything(), {
      target_actor_ptid: 'ptid:bob', target_home_station_peer_id: 'home-bob',
      observed_revision: '9223372036854775807',
    });
  });

  it('keeps safe existing numeric callers exact', async () => {
    await socialUnblockActor({
      targetActorPtid: 'ptid:bob', targetHomeStationPeerId: 'home-bob', observedRevision: 3,
    });
    expect(wire).toHaveBeenLastCalledWith('social_unblock_actor', expect.anything(), {
      target_actor_ptid: 'ptid:bob', target_home_station_peer_id: 'home-bob', observed_revision: '3',
    });
  });

  it('rejects unsafe numbers, negative and overflowing revisions before transport', async () => {
    for (const revision of [Number.MAX_SAFE_INTEGER + 1, -1, 0.5, -1n, 9_223_372_036_854_775_808n]) {
      await expect(socialBlockActor({
        targetActorPtid: 'ptid:bob', targetHomeStationPeerId: 'home-bob', observedRevision: revision,
      })).rejects.toThrow('SOCIAL_RELATIONSHIP_REVISION_INVALID');
    }
    expect(wire).not.toHaveBeenCalled();
  });
});
