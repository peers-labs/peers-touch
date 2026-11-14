import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircleMemberSchema, CircleSchema } from '../gen/proto/domain/social/circle_pb';
import { loadAllSocialCircleMembers, loadAllSocialCircles } from './socialCirclePages';

const mocks = vi.hoisted(() => ({ members: vi.fn(), circles: vi.fn() }));
vi.mock('./social_api', () => ({
  socialCircleListMembers: mocks.members, socialCircleListMine: mocks.circles,
}));
const member = (id: number) => create(CircleMemberSchema, {
  circleId: 1n, actorPtid: `ptid:member-${id}`,
});
const page = (start: number, end: number, cursor = '') => ({
  members: Array.from({ length: end - start }, (_, index) => member(start + index)),
  nextCursor: cursor, hasMore: Boolean(cursor),
});

describe('Circle full-page projections', () => {
  beforeEach(() => vi.resetAllMocks());

  it('acquires all 45 members in bounded pages and forwards opaque cursors', async () => {
    mocks.members.mockResolvedValueOnce(page(0, 20, 'a'))
      .mockResolvedValueOnce(page(20, 40, 'b')).mockResolvedValueOnce(page(40, 45));
    const members = await loadAllSocialCircleMembers('1', () => {});
    expect(members).toHaveLength(45);
    expect(mocks.members.mock.calls).toEqual([['1', undefined, 20], ['1', 'a', 20], ['1', 'b', 20]]);
  });

  it('deduplicates overlap without publishing an incomplete traversal', async () => {
    mocks.members.mockResolvedValueOnce(page(0, 20, 'a')).mockResolvedValueOnce(page(18, 25));
    expect(await loadAllSocialCircleMembers('1', () => {})).toHaveLength(25);
  });

  it('rejects repeated or missing cursors and a failed continuation', async () => {
    mocks.members.mockResolvedValueOnce(page(0, 20, 'a')).mockResolvedValueOnce(page(20, 40, 'a'));
    await expect(loadAllSocialCircleMembers('1', () => {})).rejects.toThrow('CIRCLE_CURSOR_INVALID');
    mocks.members.mockResolvedValueOnce({ ...page(0, 20), hasMore: true });
    await expect(loadAllSocialCircleMembers('1', () => {})).rejects.toThrow('CIRCLE_CURSOR_INVALID');
    mocks.members.mockResolvedValueOnce(page(0, 20, 'a')).mockRejectedValueOnce(new Error('offline'));
    await expect(loadAllSocialCircleMembers('1', () => {})).rejects.toThrow('offline');
  });

  it('fences identity changes before requesting the next page', async () => {
    let current = true;
    mocks.members.mockImplementation(async () => { current = false; return page(0, 20, 'a'); });
    await expect(loadAllSocialCircleMembers('1', () => {
      if (!current) throw new Error('scope changed');
    })).rejects.toThrow('scope changed');
    expect(mocks.members).toHaveBeenCalledTimes(1);
  });

  it('rejects a member from another circle', async () => {
    mocks.members.mockResolvedValue({ ...page(0, 1), members: [create(CircleMemberSchema, {
      circleId: 2n, actorPtid: 'ptid:other',
    })] });
    await expect(loadAllSocialCircleMembers('1', () => {})).rejects.toThrow('CIRCLE_PROJECTION_INVALID');
  });

  it('also traverses the circle catalogue instead of keeping its first page', async () => {
    mocks.circles.mockResolvedValueOnce({
      circles: Array.from({ length: 20 }, (_, index) => create(CircleSchema, { id: BigInt(index + 1) })),
      nextCursor: 'circles-next', hasMore: true,
    }).mockResolvedValueOnce({ circles: [create(CircleSchema, { id: 21n })], nextCursor: '', hasMore: false });
    expect(await loadAllSocialCircles(() => {})).toHaveLength(21);
    expect(mocks.circles).toHaveBeenLastCalledWith('circles-next', 20);
  });
});
