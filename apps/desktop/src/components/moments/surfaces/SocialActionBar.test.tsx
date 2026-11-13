// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { UIProvider } from '@peers-touch/ui';
import { create } from '@bufbuild/protobuf';
import { ReactionKind, ReactionSummarySchema } from '../../../gen/proto/domain/social/post_pb';
import {
  projectPrivateReactionRecovery, usePrivateMomentsStore,
  type PrivateReactionStatusProjection,
} from '../../../store/privateMoments';
import { privateReactionTargetKey } from '../../../services/privateMomentsNative';
import { SocialActionBar } from './SocialActionBar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock('../../../storage/desktopClientStorage', () => ({ readDesktopPreferenceSync: vi.fn() }));
vi.mock('../../../utils/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const native = vi.mocked(invoke);
const ok = (value: unknown) => ({ ok: true, data: { status: JSON.stringify(value) } });
const command = (kind: ReactionKind, state: PrivateReactionStatusProjection['state'] = 'REACTION_PENDING',
  extra: Partial<PrivateReactionStatusProjection> = {}): PrivateReactionStatusProjection => ({
  commandId: `command-${kind}`, postId: 'post', commentId: '', kind, state,
  operation: 'REACT', attemptCount: 1, projectionRevision: '1', ...extra,
});
const mutation = (value: PrivateReactionStatusProjection) => ok({
  command: value, reactions: [], projectionRevision: value.projectionRevision, exactReplay: true,
});
const key = (kind: ReactionKind) => privateReactionTargetKey('post', '', kind);
let host: HTMLDivElement, root: Root;
let retryErrors: unknown[];
let commands: PrivateReactionStatusProjection[];

// Same owner projection and exact-command dispatch as the MomentCard adapter;
// neither the callback nor the private store/Native adapter is mocked.
function ConnectedActions() {
  const state = usePrivateMomentsStore();
  return <UIProvider><SocialActionBar postId="post" commentsOpen={false}
    reactions={[create(ReactionSummarySchema, { kind: ReactionKind.REACTION_LIKE, count: 1n })]}
    reactionCommands={Object.values(state.reactionCommands).map(value => ({
      ...value, recovery: projectPrivateReactionRecovery(state, value),
    }))}
    onReact={async kind => { await state.setReaction('post', kind, 'REACT'); }}
    onRetryReaction={async (kind, commandId) => {
      try { await state.retryReaction('post', '', kind, commandId); }
      catch (error) { retryErrors.push(error); }
    }} onOpenComments={() => {}} /></UIProvider>;
}

const retryButton = (kind: ReactionKind) => host.querySelector<HTMLButtonElement>(
  `[data-action-id="moment.reaction.retry.post.${kind}"]`,
);
const likeButton = () => host.querySelector<HTMLButtonElement>(
  `[data-action-id="moment.reaction-chip.post.${ReactionKind.REACTION_LIKE}"]`,
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  retryErrors = [];
  commands = [];
  native.mockImplementation(async name => {
    if (name === 'social_private_moments_bootstrap') return ok({
      actorPtid: 'ptid:viewer', deviceId: 'device-viewer', sessionGeneration: '1', projections: [{
        postId: 'post', contentId: 'content', generation: '1', authorPtid: 'ptid:author',
        audienceKind: 'FRIENDS', state: 'CONTENT_READY', mentions: [], reactions: [],
        reactionRevision: '1', content: { kind: 'TEXT', text: 'private' },
      }], reactionCommands: commands,
    });
    throw new Error(`unexpected Native call: ${name}`);
  });
  usePrivateMomentsStore.getState().activateActor('ptid:viewer', 41);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    usePrivateMomentsStore.getState().reset();
  });
  host.remove();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderCommands(values: PrivateReactionStatusProjection[]) {
  commands = values;
  await act(async () => {
    await usePrivateMomentsStore.getState().bootstrap(41);
    root.render(<ConnectedActions />);
  });
}

it('recovers pending unknown outcomes by exact ID after owner backoff, independently of terminal kinds and ballots', async () => {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(now);
  const like = command(ReactionKind.REACTION_LIKE, 'REACTION_PENDING', { retryNotBeforeUnixMs: now + 5_000 });
  await renderCommands([
    command(ReactionKind.REACTION_UNSPECIFIED, 'REACTION_PENDING', {
      operation: 'VOTE_POLL', selectedOpaqueOptionIds: ['a'.repeat(64)],
    }),
    like, command(ReactionKind.REACTION_LOVE, 'REACTION_REJECTED'),
    command(ReactionKind.REACTION_WOW, 'REACTION_COMMITTED'),
  ]);
  const statuses = [...host.querySelectorAll('[role="status"]')].filter(node =>
    node.textContent?.includes('moments.reaction.status.'));
  expect(statuses).toHaveLength(2);
  expect(statuses.map(node => node.textContent)).toEqual([
    expect.stringContaining('REACTION_PENDING'), expect.stringContaining('REACTION_REJECTED'),
  ]);
  expect(host.textContent).not.toContain('moments.reaction.status.REACTION_COMMITTED');
  expect(likeButton()!.getAttribute('aria-disabled')).toBe('true');
  expect(retryButton(ReactionKind.REACTION_LIKE)!.getAttribute('aria-disabled')).toBe('true');
  expect(retryButton(ReactionKind.REACTION_LOVE)).toBeNull();
  expect(retryButton(ReactionKind.REACTION_UNSPECIFIED)).toBeNull();
  await act(async () => {
    await expect(usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, like.commandId))
      .rejects.toMatchObject({ code: 'REACTION_RETRY_NOT_READY' });
  });
  expect(native.mock.calls.filter(([name]) => name === 'social_private_reaction_retry')).toHaveLength(0);
  const readsBeforeExpiry = native.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(5_001); });
  expect(retryButton(like.kind)!.getAttribute('aria-disabled')).toBeNull();
  expect(native.mock.calls).toHaveLength(readsBeforeExpiry);
  native.mockResolvedValueOnce(mutation({ ...like, state: 'REACTION_COMMITTED', projectionRevision: '2' }));
  await act(async () => { retryButton(like.kind)!.click(); });
  expect(native).toHaveBeenLastCalledWith('social_private_reaction_retry', {
    input: { actor_ptid: 'ptid:viewer', renderer_generation: 41, command_id: like.commandId },
  });
  expect(usePrivateMomentsStore.getState().reactionCommands[key(like.kind)]).toBeUndefined();
  expect(usePrivateMomentsStore.getState().reactionCommands[key(ReactionKind.REACTION_LOVE)].state)
    .toBe('REACTION_REJECTED');
  expect(usePrivateMomentsStore.getState().reactionCommands[key(ReactionKind.REACTION_UNSPECIFIED)].operation)
    .toBe('VOTE_POLL');
  expect(likeButton()!.getAttribute('aria-disabled')).toBeNull();
  expect(retryErrors).toEqual([]);
});

it('retains exact retry identity after transport and retryable failures, then hides terminal recovery', async () => {
  const like = command(ReactionKind.REACTION_LIKE, 'REACTION_RETRYING');
  await renderCommands([like]);
  native.mockRejectedValueOnce(new Error('IPC disconnected'));
  await act(async () => { retryButton(like.kind)!.click(); });
  expect(usePrivateMomentsStore.getState().reactionCommands[key(like.kind)]).toMatchObject({
    commandId: like.commandId, state: 'REACTION_PENDING',
  });
  expect(retryButton(like.kind)!.getAttribute('aria-disabled')).toBeNull();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  native.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', details: {
    state: 'REACTION_RETRYING', retryable: true, retry_after_seconds: 9,
  } } });
  await act(async () => { retryButton(like.kind)!.click(); });
  expect(usePrivateMomentsStore.getState().reactionCommands[key(like.kind)]).toMatchObject({
    commandId: like.commandId, state: 'REACTION_RETRYING', retryNotBeforeUnixMs: now + 9_000,
  });
  expect(retryButton(like.kind)!.getAttribute('aria-disabled')).toBe('true');
  clock.mockReturnValue(now + 9_001);
  await act(async () => { root.render(<ConnectedActions />); });
  native.mockResolvedValueOnce(mutation({ ...like, state: 'REACTION_REJECTED' }));
  await act(async () => { retryButton(like.kind)!.click(); });
  expect(retryButton(like.kind)).toBeNull();
  await expect(usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, like.commandId))
    .rejects.toMatchObject({ code: 'REACTION_RETRY_UNAVAILABLE' });
  expect(native.mock.calls.filter(([name]) => name === 'social_private_reaction_retry'))
    .toHaveLength(3);
  expect(retryErrors).toHaveLength(2);
});

it('shares an exact retry flight while fencing stale IDs and keeping other reaction kinds independent', async () => {
  const like = command(ReactionKind.REACTION_LIKE);
  await renderCommands([like]);
  let finish!: (value: unknown) => void;
  native.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let completion!: Promise<unknown>;
  await act(async () => {
    completion = usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, like.commandId);
    expect(usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, like.commandId)).toBe(completion);
  });
  expect(retryButton(like.kind)!.getAttribute('aria-disabled')).toBe('true');
  await act(async () => { retryButton(like.kind)!.click(); retryButton(like.kind)!.click(); });
  expect(native.mock.calls.filter(([name]) => name === 'social_private_reaction_retry')).toHaveLength(1);
  expect(usePrivateMomentsStore.getState().setReaction('post', like.kind, 'REACT')).toBe(completion);
  await expect(usePrivateMomentsStore.getState().setReaction('post', like.kind, 'UNREACT'))
    .rejects.toMatchObject({ code: 'REACTION_COMMAND_PENDING' });
  await expect(usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, 'old-command'))
    .rejects.toMatchObject({ code: 'REACTION_RETRY_UNAVAILABLE' });
  const love = command(ReactionKind.REACTION_LOVE, 'REACTION_COMMITTED');
  native.mockResolvedValueOnce(mutation(love));
  await act(async () => {
    await usePrivateMomentsStore.getState().setReaction('post', love.kind, 'REACT');
    finish(mutation({ ...like, state: 'REACTION_COMMITTED' }));
    await completion;
  });
  expect(usePrivateMomentsStore.getState().reactionLiveFlights).toEqual({});
  expect(native.mock.calls.filter(([name]) => name === 'social_private_reaction_retry')).toHaveLength(1);
});

it('does not dispatch direct retry while an original submission is live, and fences replaced sessions', async () => {
  await renderCommands([]);
  const like = command(ReactionKind.REACTION_LIKE);
  let finish!: (value: unknown) => void;
  native.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let submission!: Promise<unknown>;
  await act(async () => {
    submission = usePrivateMomentsStore.getState().setReaction('post', like.kind, 'REACT');
  });
  await act(async () => {
    commands = [like];
    await usePrivateMomentsStore.getState().bootstrap(41);
    await expect(usePrivateMomentsStore.getState().retryReaction('post', '', like.kind, like.commandId))
      .rejects.toMatchObject({ code: 'REACTION_COMMAND_PENDING' });
  });
  expect(retryButton(like.kind)!.getAttribute('aria-disabled')).toBe('true');
  await act(async () => {
    usePrivateMomentsStore.getState().activateActor('ptid:other', 42);
    finish(mutation({ ...like, state: 'REACTION_COMMITTED' }));
    await expect(submission).rejects.toMatchObject({ code: 'PRIVATE_SESSION_REPLACED' });
  });
  expect(usePrivateMomentsStore.getState().reactionCommands).toEqual({});
  expect(usePrivateMomentsStore.getState().reactionLiveFlights).toEqual({});
  expect(native.mock.calls.filter(([name]) => name === 'social_private_reaction_retry')).toHaveLength(0);
});
