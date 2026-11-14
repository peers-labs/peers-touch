import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircleSchema, CircleMemberSchema } from '../gen/proto/domain/social/circle_pb';
import { useMomentsStore } from './moments';

const api = vi.hoisted(() => ({
  list: vi.fn(), members: vi.fn(), create: vi.fn(), remove: vi.fn(), delete: vi.fn(),
}));
vi.mock('../services/socialCirclePages', () => ({
  loadAllSocialCircles: api.list, loadAllSocialCircleMembers: api.members,
}));
vi.mock('../services/social_api', () => ({
  socialCircleCreate: api.create, socialCircleRemoveMembers: api.remove, socialCircleDelete: api.delete,
}));
vi.mock('../services/publicFeedNative', () => ({ resetPublicFeed: vi.fn() }));
vi.mock('../utils/logger', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../storage/desktopClientStorage', () => ({ readDesktopPreferenceSync: vi.fn() }));
const circle = create(CircleSchema, { id: 1n, name: 'Friends' });
const member = create(CircleMemberSchema, { circleId: 1n, actorPtid: 'ptid:bob' });

describe('Circle projection concurrency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useMomentsStore.getState().reset();
    api.list.mockResolvedValue([circle]);
    api.members.mockResolvedValue([]);
    api.create.mockResolvedValue({ circle });
    api.remove.mockResolvedValue({});
    api.delete.mockResolvedValue({ success: true });
  });

  it('rejects an older list that would hide a newly committed circle', async () => {
    let complete!: (value: unknown) => void;
    api.list.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const read = useMomentsStore.getState().listMyCircles();
    const rejected = expect(read).rejects.toThrow('CIRCLE_READ_SUPERSEDED');
    await useMomentsStore.getState().createCircle('Friends');
    complete([]);
    await rejected;
    expect(useMomentsStore.getState().circles.map(item => item.id)).toEqual([1n]);
  });

  it('does not reintroduce a removed member from an older read', async () => {
    useMomentsStore.setState({ circles: [circle], circleMembers: { '1': [member] } });
    let complete!: (value: unknown) => void;
    api.members.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const read = useMomentsStore.getState().loadCircleMembers('1');
    const rejected = expect(read).rejects.toThrow('CIRCLE_READ_SUPERSEDED');
    const removal = useMomentsStore.getState().removeCircleMember('1', 'ptid:bob');
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    complete([member]);
    await rejected;
    await removal;
    expect(useMomentsStore.getState().circleMembers['1']).toEqual([]);
    expect(useMomentsStore.getState().circleMembersErrors).toEqual({});
  });

  it('rejects late actor responses and shares actual read completion', async () => {
    useMomentsStore.setState({ circles: [circle] });
    let complete!: (value: unknown) => void;
    api.members.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const first = useMomentsStore.getState().loadCircleMembers('1');
    const second = useMomentsStore.getState().loadCircleMembers('1');
    const rejected = Promise.all([
      expect(first).rejects.toThrow('MOMENTS_SESSION_STALE'),
      expect(second).rejects.toThrow('MOMENTS_SESSION_STALE'),
    ]);
    expect(api.members).toHaveBeenCalledOnce();
    useMomentsStore.getState().reset();
    complete([member]);
    await rejected;
    expect(useMomentsStore.getState().circleMembers).toEqual({});
  });
});
