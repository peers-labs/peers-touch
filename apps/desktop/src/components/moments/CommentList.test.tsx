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

it('submits a changed reply target with unchanged text', async () => {
  const input = await render({
    composerDraftReplyToCommentId: 'first',
    comments: ['first', 'second'].map(id => ({
      id, postId: 'post', authorPtid: 'ptid:alice', replyToCommentId: '', content: id,
    })),
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[data-moments-comment-reply="second"]')!.click();
  });
  await enter(input);
  expect(submit).toHaveBeenCalledWith('unchanged', 'second', []);
  expect(retry).not.toHaveBeenCalled();
});

it('recovers the retained reply and mention intent when the editor has no local draft', async () => {
  const mention = { actorPtid: 'ptid:alice', offset: 0, length: 6, display: '@Alice' };
  const input = await render({
    composerDraftText: '@Alice hello', composerDraftReplyToCommentId: 'first',
    composerDraftMentions: [mention],
  });
  await enter(input);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  expect(input.value).toBe('@Alice hello');
});

it('submits a changed same-name mention with unchanged final text', async () => {
  const input = await render({
    composerDraftText: '@Alice hello',
    composerDraftMentions: [{ actorPtid: 'ptid:old-alice', offset: 0, length: 6, display: '@Alice' }],
  });
  await type(input, '@Ali');
  await enter(input);
  await type(input, '@Alice hello');
  await enter(input);
  expect(submit).toHaveBeenCalledWith('@Alice hello', undefined,
    [{ actorPtid: 'ptid:alice', offset: 0, length: 6, display: '@Alice' }]);
  expect(retry).not.toHaveBeenCalled();
});

it('binds mention offsets to the trimmed submitted text', async () => {
  const input = await render({ composerState: undefined, composerDraftText: '' });
  await type(input, '  @Ali');
  await enter(input);
  await type(input, '  @Alice hello  ');
  await enter(input);
  expect(submit).toHaveBeenCalledWith('@Alice hello', undefined,
    [{ actorPtid: 'ptid:alice', offset: 0, length: 6, display: '@Alice' }]);
});

it('keeps the acquired empty state and editor while background data is pending', async () => {
  const input = await render({ loaded: true, composerState: undefined });
  const empty = host.querySelector('.pt-mom-comment-status');
  await type(input, 'my retained reply');
  await act(async () => { input.focus(); input.setSelectionRange(3, 3); });
  await render({ loaded: true, loading: true, composerState: undefined });
  expect(host.querySelector('.pt-mom-comment-status')).toBe(empty);
  expect(host.textContent).not.toContain('moments.follow.loading');
  expect(host.querySelector('textarea')).toBe(input);
  expect(input.value).toBe('my retained reply');
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(3);
});

it('shows initial acquisition once and keeps pagination in place while pending', async () => {
  await render({ loaded: false, loading: true });
  expect(host.textContent).toContain('moments.follow.loading');
  expect(host.textContent).not.toContain('moments.comment.empty');
  await render({ loaded: true, loading: false, hasMore: true });
  const more = host.querySelector('[data-action-id="comments.more.post"]');
  expect(more).not.toBeNull();
  await render({ loaded: true, loading: true, hasMore: true });
  expect(host.querySelector('[data-action-id="comments.more.post"]')).toBe(more);
  expect(host.textContent).not.toContain('moments.follow.loading');
});

it('animates only new arrivals without replacing rows or replaying their motion', async () => {
  const comment = (id: string) => ({
    id, postId: 'post', authorPtid: 'ptid:alice', replyToCommentId: '', content: id,
  });
  await render({ loaded: true, comments: [comment('old')] });
  const old = host.querySelector('[data-moments-comment="old"]');
  expect(old?.hasAttribute('data-arriving')).toBe(false);
  await render({ loaded: true, comments: [comment('old'), comment('new')] });
  expect(host.querySelector('[data-moments-comment="old"]')).toBe(old);
  const arrived = host.querySelector('[data-moments-comment="new"]')!;
  expect(arrived.getAttribute('data-arriving')).toBe('true');
  await act(async () => { arrived.dispatchEvent(new Event('animationend', { bubbles: true })); });
  await render({ loaded: true, loading: true, comments: [comment('old'), comment('new')] });
  expect(host.querySelector('[data-moments-comment="new"]')).toBe(arrived);
  expect(arrived.hasAttribute('data-arriving')).toBe(false);
});
