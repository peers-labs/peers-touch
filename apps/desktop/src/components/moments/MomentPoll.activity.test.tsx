// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create as createProto } from '@bufbuild/protobuf';
import { PostSchema } from '../../gen/proto/domain/social/post_pb';
import { PageActivityProvider, usePageActiveStoreSelector } from '../../kernel/PageActivityContext';
import { MomentPoll } from './MomentPoll';

const publicStore = create(() => ({
  pollCommands: {}, votePoll: vi.fn(), retryPoll: vi.fn(),
}));
const privateStore = create(() => ({
  postsById: { post: { content: {
    kind: 'POLL', question: 'Question', options: ['First', 'Second'],
    minChoices: 1, maxChoices: 1, expiresAtSeconds: 4_000_000_000,
    opaqueOptionIds: ['first', 'second'],
    result: { voteCounts: [1, 0], selectedOptions: [0], voterCount: 1 },
  } } },
  reactionCommands: {},
}));
const paintedPoll = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@peers-touch/ui', () => ({
  MomentPoll: (props: { totalVotes: bigint; confirmedChoices: number[] }) => {
    paintedPoll(props);
    return <output>{String(props.totalVotes)}:{props.confirmedChoices.join(',')}</output>;
  },
}));
vi.mock('../../services/privateMomentsNative', () => ({
  privateReactionTargetKey: () => 'post-poll',
}));
vi.mock('../../store/privateMoments', () => ({
  usePrivateMomentsStore: (selector: (state: ReturnType<typeof privateStore.getState>) => unknown) =>
    privateStore(selector),
}));
vi.mock('./useActiveMomentsStore', () => ({
  useActiveMomentsSlice: (selector: (state: ReturnType<typeof publicStore.getState>) => unknown) =>
    usePageActiveStoreSelector(publicStore, selector, shallow),
  useActivePrivateMomentsSlice: (selector: (state: ReturnType<typeof privateStore.getState>) => unknown) =>
    usePageActiveStoreSelector(privateStore, selector, shallow),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  paintedPoll.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('freezes a hidden private poll and reads the latest verified result on page return', async () => {
  const render = async (active: boolean) => {
    await act(async () => root.render(
      <PageActivityProvider active={active} descriptorId="moments" pageId="moments">
        <MomentPoll post={createProto(PostSchema, { id: 'post' })} />
      </PageActivityProvider>,
    ));
  };
  await render(true);
  expect(host.textContent).toBe('1:0');
  await render(false);
  const hiddenRenderCount = paintedPoll.mock.calls.length;
  await act(async () => privateStore.setState(state => ({
    postsById: { post: { content: {
      ...state.postsById.post.content,
      result: { voteCounts: [2, 1], selectedOptions: [1], voterCount: 3 },
    } } },
  })));
  expect(paintedPoll).toHaveBeenCalledTimes(hiddenRenderCount);
  expect(host.textContent).toBe('1:0');
  await render(true);
  expect(host.textContent).toBe('3:1');
});
