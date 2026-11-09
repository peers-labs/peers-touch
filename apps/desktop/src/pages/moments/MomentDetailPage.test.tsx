// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MomentDetailView } from './MomentDetailPage';

const projection = vi.hoisted(() => ({
  post: undefined as { id: string } | undefined,
  deletePost: vi.fn<() => Promise<void>>(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/moments/useActiveMomentsStore', () => ({
  useActiveMomentsSlice: (select: (state: unknown) => unknown) => select({
    postsById: { post: projection.post }, reactions: {}, feedExplanations: {},
    deletePost: projection.deletePost, reactToPost: vi.fn(), unreactToPost: vi.fn(),
  }),
}));
vi.mock('../../components/moments/MomentCard', () => ({
  MomentCard: () => <div data-testid="thread" />,
}));

let host: HTMLDivElement;
let root: Root;
const onBack = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  projection.post = undefined;
  onBack.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<UIProvider><MomentDetailView
    postId="post" onBack={onBack} onAuthorClick={() => {}}
  /></UIProvider>));
}

it('allows return when the selected post is absent', async () => {
  await render();
  expect(host.textContent).toContain('moments.placeholder.detailEmpty');
  const back = host.querySelector<HTMLButtonElement>('button');
  expect(back?.textContent).toContain('moments.action.back');
  await act(async () => back!.click());
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="thread"]')).toBeNull();
});

it('retains return above the thread when its post disappears', async () => {
  projection.post = { id: 'post' };
  await render();
  const back = host.querySelector<HTMLButtonElement>('button')!;
  const thread = host.querySelector('[data-testid="thread"]')!;
  expect(back.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  projection.post = undefined;
  await render();
  expect(host.querySelector('button')).toBe(back);
  await act(async () => back.click());
  expect(onBack).toHaveBeenCalledTimes(1);
});
