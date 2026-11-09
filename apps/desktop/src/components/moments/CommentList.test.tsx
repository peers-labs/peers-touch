// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentList } from './CommentList';
import { useSocialCommentDraftsStore } from '../../store/socialCommentDrafts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../store/session', () => ({
  useSessionStore: (select: (state: unknown) => unknown) => select({
    authenticated: true, currentUser: { actorPtid: 'ptid:viewer' }, sessionEpoch: 1,
  }),
}));
vi.mock('./mentions/useSocialMentionCandidates', () => ({
  useSocialMentionCandidates: () => [{
    actorPtid: 'ptid:alice', displayName: 'Alice', username: 'alice',
  }],
}));
vi.mock('./MomentCommentAuthorName', () => ({ MomentCommentAuthorName: () => null }));
vi.mock('./MomentAuthorTrigger', () => ({ MomentAuthorTrigger: () => null }));
vi.mock('../common/UserSquareAvatar', () => ({ UserSquareAvatar: () => null }));
vi.mock('../common/useActorIdentity', () => ({ useActorIdentity: () => ({ displayName: 'Alice' }) }));
vi.mock('../../hooks/useAppFeedback', () => ({ useScopedFeedback: () => ({ error: vi.fn() }) }));

let host: HTMLDivElement;
let root: Root;
const submit = vi.fn<(...args: unknown[]) => Promise<void>>();
const retry = vi.fn<() => Promise<void>>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useSocialCommentDraftsStore.getState().reset();
  submit.mockReset().mockResolvedValue(undefined);
  retry.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<Parameters<typeof CommentList>[0]> = {}) {
  await act(async () => root.render(<UIProvider><CommentList
    postId="post" comments={[]} onLoadMore={() => {}}
    viewerActorPtid="ptid:viewer" onSubmit={submit} onRetry={retry}
    composerState="COMMENT_FAILED" composerDraftText="unchanged"
    {...props}
  /></UIProvider>));
  return host.querySelector('textarea')!;
}

async function enter(input: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
  await act(async () => { input.dispatchEvent(event); });
  return event;
}

async function type(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it.each(['keyboard', 'button'])('retries unchanged failed intent through %s', async (inputMode) => {
  const input = await render();
  if (inputMode === 'keyboard') await enter(input);
  else await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  expect(input.value).toBe('unchanged');
});

it('submits an edited failed draft and clears only after success', async () => {
  const input = await render();
  await type(input, 'edited');
  await enter(input);
  expect(submit).toHaveBeenCalledWith('edited', undefined, []);
  expect(retry).not.toHaveBeenCalled();
  expect(input.value).toBe('');
});

it('keeps failed retry text and prevents duplicate keyboard and button commands', async () => {
  let reject!: (error: Error) => void;
  retry.mockImplementation(() => new Promise((_resolve, failure) => { reject = failure; }));
  const input = await render();
  await enter(input);
  await enter(input);
  await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('retry unavailable')));
  expect(input.value).toBe('unchanged');
  expect(host.textContent).toContain('moments.private.state.PUBLISH_FAILED.description');
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  { composerState: 'COMMENT_PARENT_UNAVAILABLE' as const },
  { composerState: 'COMMENT_SUBMITTING' as const },
  { composerState: 'COMMENT_RATE_LIMITED' as const, composerRetryAfterSeconds: 5 },
])('rejects keyboard commands when the composer is unavailable: %j', async (props) => {
  const input = await render(props);
  await enter(input);
  expect(submit).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('keeps Enter for IME composition and Shift+Enter for newlines', async () => {
  const input = await render();
  const composing = await enter(input, { isComposing: true });
  const newline = await enter(input, { shiftKey: true });
  await act(async () => { input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  const candidate = await enter(input);
  expect([composing, newline, candidate].every(event => !event.defaultPrevented)).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('uses Enter to select a mention before publishing', async () => {
  const input = await render({ composerState: undefined, composerDraftText: '' });
  await type(input, '@Ali');
  await enter(input);
  expect(input.value).toContain('@Alice');
  expect(submit).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('can confirm committed readback with an empty editor', async () => {
  await render({ composerPublicationState: 'COMMITTED_PENDING_READBACK' });
  await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});
