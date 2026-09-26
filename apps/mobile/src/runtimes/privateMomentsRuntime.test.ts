import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  PrivateMomentProjection,
  PrivateMomentReadProjection,
} from '../services/mobileCommands';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';

const commandMocks = vi.hoisted(() => ({
  activate: vi.fn(),
  publish: vi.fn(),
  publishMoment: vi.fn(),
  readText: vi.fn(),
  readMoment: vi.fn(),
  openMedia: vi.fn(),
  recoverText: vi.fn(),
  recoverMoment: vi.fn(),
  commentSubmit: vi.fn(),
  comments: vi.fn(),
  storeRecoveryPhrase: vi.fn(),
  reconcile: vi.fn(),
  snapshot: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('../services/mobileCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/mobileCommands')>();
  return {
    ...actual,
    privateSocialCommentSubmit: commandMocks.commentSubmit,
    privateSocialComments: commandMocks.comments,
    privateSocialOpenMedia: commandMocks.openMedia,
    privateSocialActivate: commandMocks.activate,
    privateSocialPublish: commandMocks.publishMoment,
    privateSocialPublishText: commandMocks.publish,
    privateSocialRead: commandMocks.readMoment,
    privateSocialReadText: commandMocks.readText,
    privateSocialRecover: commandMocks.recoverMoment,
    privateSocialRecoverText: commandMocks.recoverText,
    privateSocialStoreRecoveryPhrase: commandMocks.storeRecoveryPhrase,
    privateSocialReconcile: commandMocks.reconcile,
    privateSocialSnapshot: commandMocks.snapshot,
    privateSocialTeardown: commandMocks.teardown,
  };
});

import {
  createPrivateMomentsRuntimeDescriptor,
  mergeProjectionLists,
  mergeReadProjectionMap,
  openPrivateMomentMedia,
  publishPrivateMoment,
  publishPrivateTextMoment,
  readPrivateComments,
  readPrivateMoment,
  readPrivateMomentsSnapshot,
  readPrivateTextMoment,
  recoverPrivateMoment,
  recoverPrivateTextMoment,
  reconcilePrivateMoments,
  storePrivateSocialRecoveryPhrase,
  submitPrivateComment,
} from './privateMomentsRuntime';

let activeDescriptor: ReturnType<typeof createPrivateMomentsRuntimeDescriptor> | null = null;

const runtimeContext = {
  generation: 1,
  beginReadinessUpdate: () => ({
    isCurrent: () => true,
    waitForDependencies: async () => true,
    ready: () => undefined,
    fail: () => undefined,
  }),
};

beforeEach(() => {
  for (const mock of Object.values(commandMocks)) mock.mockReset();
  commandMocks.snapshot.mockResolvedValue({
    publishProjections: [],
    readProjections: [],
    commentDrafts: [],
    comments: [],
  });
  commandMocks.teardown.mockResolvedValue({
    active: false,
    activationGeneration: 0,
    workerMode: 'on_demand',
  });
  useAuthStore.setState({
    session: null,
    accessDecision: null,
    loading: false,
    error: null,
    restored: false,
  });
});

afterEach(async () => {
  await activeDescriptor?.teardown({ reason: 'app-unmount' });
  activeDescriptor = null;
  useAuthStore.setState({
    session: null,
    accessDecision: null,
  });
});

function projection(
  draftId: string,
  draftRevision: number,
  state: PrivateMomentProjection['state'],
): PrivateMomentProjection {
  return {
    draftId,
    draftRevision,
    contentId: `${draftId}:${draftRevision}`,
    generation: 1,
    audienceKind: 'FRIENDS',
    state,
  };
}

function readProjection(
  postId: string,
  generation: string,
  state: PrivateMomentReadProjection['state'],
): PrivateMomentReadProjection {
  return {
    postId,
    contentId: postId,
    generation,
    authorPtid: state === 'CONTENT_READY' ? 'ptid:alice' : '',
    audienceKind: state === 'CONTENT_READY' ? 'FRIENDS' : 'UNKNOWN',
    state,
    content: state === 'CONTENT_READY'
      ? { kind: 'TEXT', text: `text:${generation}` }
      : undefined,
  };
}

function authSession(sessionId: string): MobileAuthSession {
  return {
    stationPeerId: 'station-1',
    stationUrl: 'https://station.test',
    sessionId,
    actorRef: { ptid: 'ptid:alice' },
    authenticatedAt: 1,
  };
}

function activeStatus(activationGeneration: number) {
  return {
    active: true,
    profileId: 'profile-1',
    stationPeerId: 'station-1',
    actorPtid: 'ptid:alice',
    deviceId: 'device-1',
    activationGeneration,
    workerMode: 'on_demand' as const,
  };
}

describe('privateMomentsRuntime projection', () => {
  it('replaces an older state for the same durable draft identity', () => {
    const merged = mergeProjectionLists(
      [projection('draft-a', 1, 'UNKNOWN_OUTCOME')],
      [{ ...projection('draft-a', 1, 'PUBLISHED'), postId: 'post-a' }],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        draftId: 'draft-a',
        state: 'PUBLISHED',
        postId: 'post-a',
      }),
    ]);
  });

  it('keeps independent draft revisions addressable', () => {
    const merged = mergeProjectionLists(
      [projection('draft-a', 1, 'PUBLISHED')],
      [projection('draft-a', 2, 'PUBLISHING')],
    );

    expect(merged.map((item) => item.draftRevision)).toEqual([2, 1]);
  });

  it('merges receiver projections by stable post ID and rejects older ready content', () => {
    const current = {
      'post-a': readProjection('post-a', '2', 'CONTENT_READY'),
    };
    const merged = mergeReadProjectionMap(current, [
      readProjection('post-a', '1', 'CONTENT_READY'),
      readProjection('post-b', '1', 'CONTENT_READY'),
    ]);

    expect(merged['post-a']?.content).toEqual({ kind: 'TEXT', text: 'text:2' });
    expect(merged['post-b']?.content).toEqual({ kind: 'TEXT', text: 'text:1' });
  });

  it('lets a terminal deny replace and clear a cached ready projection', () => {
    const merged = mergeReadProjectionMap(
      { 'post-a': readProjection('post-a', '2', 'CONTENT_READY') },
      [readProjection('post-a', '0', 'NOT_FOUND_OR_NOT_AUTHORIZED')],
    );

    expect(merged['post-a']).toEqual(expect.objectContaining({
      postId: 'post-a',
      state: 'NOT_FOUND_OR_NOT_AUTHORIZED',
      content: undefined,
    }));
  });

  it('discards a plaintext read completion after a same-PTID session switch', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolveRead: ((projection: PrivateMomentReadProjection) => void) | undefined;
    commandMocks.readText.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    const completion = readPrivateTextMoment('post-a');
    expect(commandMocks.readText).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      activationGeneration: 1,
      postId: 'post-a',
    });

    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolveRead?.(readProjection('post-a', '1', 'CONTENT_READY'));

    await expect(completion).rejects.toThrow('mobile.privateSocial.staleReadCompletion');
    expect(readPrivateMomentsSnapshot().postsById).toEqual({});
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('carries the exact activation generation on every account-scoped command', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(7));
    commandMocks.publish.mockResolvedValue(projection('draft-a', 1, 'PUBLISHED'));
    commandMocks.reconcile.mockResolvedValue({
      endpointPrekeysAvailable: 8,
      submissionsProcessed: 1,
      submissionsUnknown: 0,
      submissionsTerminal: 0,
    });
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    await publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    await reconcilePrivateMoments();
    await activeDescriptor.teardown({ reason: 'app-unmount' });
    activeDescriptor = null;

    const exactScope = {
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      activationGeneration: 7,
    };
    expect(commandMocks.snapshot).toHaveBeenCalledWith(exactScope);
    expect(commandMocks.publish).toHaveBeenCalledWith({
      ...exactScope,
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    expect(commandMocks.reconcile).toHaveBeenCalledWith(exactScope);
    expect(commandMocks.teardown).toHaveBeenCalledWith(exactScope);
  });

  it('projects private publish and recovery states without exposing the phrase', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(7));
    commandMocks.publish.mockResolvedValue(projection('draft-a', 1, 'PUBLISHED'));
    commandMocks.storeRecoveryPhrase.mockResolvedValue(undefined);
    commandMocks.recoverText.mockResolvedValue(
      readProjection('post-a', '2', 'CONTENT_READY'),
    );
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    await publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    await storePrivateSocialRecoveryPhrase('abandon '.repeat(23) + 'art', 7);
    await recoverPrivateTextMoment('post-a');

    expect(commandMocks.storeRecoveryPhrase).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      activationGeneration: 7,
      recoveryPhrase: 'abandon '.repeat(23) + 'art',
      recoveryEpoch: 7,
    });
    expect(readPrivateMomentsSnapshot().publishStateHistory).toEqual([
      'AUDIENCE_REQUIRED',
      'CHECKING_PRIVATE_READINESS',
      'PUBLISHED',
    ]);
    expect(readPrivateMomentsSnapshot().readStateHistoryByPostId['post-a']).toEqual([
      'WAITING_FOR_PRIVATE_KEY',
      'CONTENT_READY',
    ]);
  });

  it('tears down the exact native generation when post-activation bootstrap fails', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(11));
    commandMocks.snapshot.mockRejectedValueOnce(new Error('snapshot failed'));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();

    await activeDescriptor.bootstrap(runtimeContext);

    expect(commandMocks.teardown).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      activationGeneration: 11,
    });
    expect(readPrivateMomentsSnapshot()).toEqual(expect.objectContaining({
      active: false,
      projections: [],
      postsById: {},
      errorMessage: 'snapshot failed',
    }));
  });

  it('tears down an activated generation when its returned identity is invalid', async () => {
    commandMocks.activate.mockResolvedValue({
      ...activeStatus(13),
      actorPtid: 'ptid:eve',
    });
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();

    await activeDescriptor.bootstrap(runtimeContext);

    expect(commandMocks.snapshot).not.toHaveBeenCalled();
    expect(commandMocks.teardown).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      activationGeneration: 13,
    });
    expect(readPrivateMomentsSnapshot()).toEqual(expect.objectContaining({
      active: false,
      projections: [],
      postsById: {},
      errorMessage: 'mobile.privateSocial.activationIdentityMismatch',
    }));
  });

  it('discards a publish completion after a same-PTID session switch', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolvePublish: ((value: PrivateMomentProjection) => void) | undefined;
    commandMocks.publish.mockReturnValueOnce(new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    const completion = publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolvePublish?.(projection('draft-a', 1, 'PUBLISHED'));

    await expect(completion).rejects.toThrow('mobile.privateSocial.stalePublishCompletion');
    expect(readPrivateMomentsSnapshot().projections).toEqual([]);
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('does not publish a stale same-PTID session error globally', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let rejectPublish: ((reason: Error) => void) | undefined;
    commandMocks.publish.mockReturnValueOnce(new Promise((_, reject) => {
      rejectPublish = reject;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    const completion = publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    rejectPublish?.(new Error('old session failed'));

    await expect(completion).rejects.toThrow('old session failed');
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('does not merge a stale same-PTID reconciliation completion', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolveReconcile: ((report: {
      endpointPrekeysAvailable: number;
      submissionsProcessed: number;
      submissionsUnknown: number;
      submissionsTerminal: number;
    }) => void) | undefined;
    commandMocks.reconcile.mockReturnValueOnce(new Promise((resolve) => {
      resolveReconcile = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    const completion = reconcilePrivateMoments();
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolveReconcile?.({
      endpointPrekeysAvailable: 9,
      submissionsProcessed: 3,
      submissionsUnknown: 0,
      submissionsTerminal: 0,
    });

    await expect(completion).resolves.toBeNull();
    expect(readPrivateMomentsSnapshot().lastReport).toBeNull();
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('routes generic subtype, media, recovery, and Comment operations through one scope', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(7));
    commandMocks.publishMoment.mockResolvedValue(projection('draft-image', 1, 'PUBLISHED'));
    const placeholder = {
      ...readProjection('post-image', '1', 'CONTENT_READY'),
      mentions: [],
      content: {
        kind: 'IMAGE' as const,
        text: 'caption',
        media: [{
          attachmentId: 'attachment-1',
          objectId: 'object-1',
          state: 'MEDIA_PLACEHOLDER' as const,
          mimeType: 'image/png',
          width: 100,
          height: 100,
          durationMs: 0,
          altText: 'sample',
        }],
      },
    };
    const ready = {
      ...placeholder,
      content: {
        ...placeholder.content,
        media: [{
          ...placeholder.content.media[0],
          state: 'MEDIA_READY' as const,
          localPath: '/private/cache/object-1.media',
        }],
      },
    };
    commandMocks.readMoment.mockResolvedValue(placeholder);
    commandMocks.openMedia.mockResolvedValue(ready);
    commandMocks.recoverMoment.mockResolvedValue(ready);
    commandMocks.commentSubmit.mockResolvedValue({
      draft: {
        draftId: 'comment-draft-1',
        draftRevision: 1,
        postId: 'post-image',
        replyToCommentId: '',
        text: 'private reply',
        mentions: [],
        state: 'COMMENT_POSTED',
        commentId: 'comment-1',
      },
      comment: {
        commentId: 'comment-1',
        contentId: 'comment-1',
        generation: '1',
        postId: 'post-image',
        replyToCommentId: '',
        authorPtid: 'ptid:alice',
        state: 'COMMENT_POSTED',
        text: 'private reply',
        mentions: [],
        reactionsCount: 0,
        repliesCount: 0,
      },
    });
    commandMocks.comments.mockResolvedValue({
      postId: 'post-image',
      comments: [],
      nextCursor: '',
      hasMore: false,
    });
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap(runtimeContext);

    await publishPrivateMoment({
      draftId: 'draft-image',
      draftRevision: 1,
      text: 'caption',
      audience: { kind: 'FRIENDS' },
      momentKind: 'IMAGE',
      files: [{ handle: 'handle-1', attachmentId: 'attachment-1' }],
    });
    await readPrivateMoment('post-image');
    await openPrivateMomentMedia('post-image', 'object-1');
    await recoverPrivateMoment('post-image');
    await submitPrivateComment({
      draftId: 'comment-draft-1',
      draftRevision: 1,
      postId: 'post-image',
      text: 'private reply',
    });
    await readPrivateComments('post-image');

    const scope = expect.objectContaining({ activationGeneration: 7 });
    expect(commandMocks.publishMoment).toHaveBeenCalledWith(scope);
    expect(commandMocks.readMoment).toHaveBeenCalledWith(scope);
    expect(commandMocks.openMedia).toHaveBeenCalledWith(scope);
    expect(commandMocks.recoverMoment).toHaveBeenCalledWith(scope);
    expect(commandMocks.commentSubmit).toHaveBeenCalledWith(scope);
    expect(commandMocks.comments).toHaveBeenCalledWith(scope);
    expect(readPrivateMomentsSnapshot()).toMatchObject({
      postsById: { 'post-image': ready },
      commentDrafts: [
        expect.objectContaining({
          draftId: 'comment-draft-1',
          state: 'COMMENT_POSTED',
        }),
      ],
      comments: [
        expect.objectContaining({
          commentId: 'comment-1',
          text: 'private reply',
        }),
      ],
    });
  });
});
