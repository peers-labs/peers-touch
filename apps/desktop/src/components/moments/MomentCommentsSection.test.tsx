// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MomentCommentsSection } from './MomentCommentsSection';

const fixture = vi.hoisted(() => ({
  comments: [] as Array<{ id: string }>,
  frames: [] as FrameRequestCallback[],
  acquire: vi.fn(() => vi.fn()),
}));
vi.mock('../../runtimes/momentsRuntime', () => ({ acquireMomentComments: fixture.acquire }));
vi.mock('../../kernel/PageActivityContext', () => ({ useIsPageActive: () => true }));
vi.mock('../../store/session', () => ({
  useSessionStore: (select: (state: unknown) => unknown) => select({
    currentUser: { actorPtid: 'viewer' }, sessionEpoch: 1,
  }),
}));
vi.mock('./useActiveMomentsStore', () => ({
  useActiveMomentsSlice: (select: (state: unknown) => unknown) => select({
    comments: { post: fixture.comments }, commentsLoading: {}, commentsHasMore: {},
  }),
  useActivePrivateCommentsSlice: (select: (state: unknown) => unknown) => select({
    threadsByPost: {}, draftsById: {}, activeDraftByPost: {}, scope: {},
  }),
  useActivePrivateMomentsSlice: (select: (state: unknown) => unknown) => select({ reactionCommands: {} }),
}));
vi.mock('./CommentList', () => ({
  CommentList: ({ comments }: { comments: Array<{ id: string }> }) => <>
    {comments.map(comment => <div key={comment.id} data-moments-comment={comment.id} tabIndex={0} />)}
    <textarea />
  </>,
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    fixture.frames.push(callback); return fixture.frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('IntersectionObserver', class {
    observe() {} disconnect() {}
  });
  fixture.comments = [{ id: 'addressed' }];
  fixture.frames = [];
  fixture.acquire.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(active = true, targetIntent = 1) {
  await act(async () => root.render(<MomentCommentsSection postId="post" isPrivate={false}
    targetCommentId="addressed" active={active} targetIntent={targetIntent} />));
  await act(async () => {
    for (const callback of fixture.frames.splice(0)) callback(0);
  });
}
it('focuses once per explicit intent without stealing an editor focus during reads', async () => {
  await render();
  const target = host.querySelector('[data-moments-comment="addressed"]');
  expect(document.activeElement).toBe(target);
  const input = host.querySelector('textarea')!;
  input.focus();
  fixture.comments = [...fixture.comments, { id: 'new' }];
  await render();
  expect(document.activeElement).toBe(input);
  await render(false);
  await render(true);
  expect(document.activeElement).toBe(input);
  await render(true, 2);
  expect(document.activeElement).toBe(target);
});
it('does not focus a collapsed thread or another surface with the same target', async () => {
  await render(false);
  expect(document.activeElement).toBe(document.body);
  fixture.comments = [];
  const outside = document.createElement('button');
  outside.dataset.momentsComment = 'addressed';
  host.before(outside);
  try {
    await render();
    expect(document.activeElement).not.toBe(outside);
  } finally { outside.remove(); }
});
