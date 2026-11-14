// @vitest-environment jsdom
import { create } from '@bufbuild/protobuf';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostSchema, type Post } from '../../gen/proto/domain/social/post_pb';
import { useMomentsNavigationStore } from '../../store/momentsNavigation';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from './MomentCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useAppFeedback', () => ({ useScopedFeedback: () => ({ error: vi.fn() }) }));
vi.mock('./useActiveMomentsStore', () => ({
  useActiveMomentsFederationSlice: (select: (state: unknown) => unknown) => select({ self: null }),
  useActiveMomentsSlice: (select: (state: unknown) => unknown) => select({ reactionCommands: {} }),
  useActivePrivateMomentsSlice: (select: (state: unknown) => unknown) => select({
    postsById: {}, platform: 'browser', scope: {}, reactionCommands: {}, reactionLiveFlights: {},
  }),
}));
vi.mock('../common/useActorIdentity', () => ({
  useActorIdentity: () => ({ displayName: 'Alice', isSelf: false }),
}));
vi.mock('../common/UserSquareAvatar', () => ({ UserSquareAvatar: () => null }));
vi.mock('./MomentAuthorTrigger', () => ({ MomentAuthorTrigger: () => null }));
vi.mock('./MomentCommentsSection', () => ({
  MomentCommentsSection: () => <textarea defaultValue="retained draft" />,
}));

let host: HTMLDivElement;
let root: Root;
const post = (id: string) => create(PostSchema, { id, publicFeedRef: 'canonical-resource' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }));
  useMomentsNavigationStore.getState().reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(value: Post, key = 'card') {
  useMomentsStore.setState(state => ({ postsById: { ...state.postsById, [value.id]: value } }));
  await act(async () => root.render(<UIProvider><MomentCard key={key} post={value} /></UIProvider>));
}
const toggle = () => host.querySelector<HTMLButtonElement>('[data-acceptance-id="social-open-comments"]')!;

it('retains the editor and collapse choice across reads, aliases and remounts', async () => {
  await render(post('local-id'));
  const input = host.querySelector('textarea');
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('textarea')).toBe(input);
  await render(post('public-id'));
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await render(post('public-id'), 'replacement');
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
});

it('clears choices at scope reset and opens for a new explicit comment navigation', async () => {
  await render(post('local-id'));
  await act(async () => toggle().click());
  await act(async () => useMomentsNavigationStore.getState().setView({
    kind: 'detail', postId: 'local-id', commentId: 'addressed', from: 'feed',
  }));
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await act(async () => toggle().click());
  await render(post('local-id'));
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => useMomentsNavigationStore.getState().reset());
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
});
