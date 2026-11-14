import { beforeEach, describe, expect, it, vi } from 'vitest';

const privateMomentMocks = vi.hoisted(() => ({
  publish: vi.fn(),
  publishMoment: vi.fn(),
  readMoment: vi.fn(),
  openMedia: vi.fn(),
  submitComment: vi.fn(),
  readComments: vi.fn(),
  recoverMoment: vi.fn(),
  snapshot: vi.fn(),
  retryReaction: vi.fn(),
}));

vi.mock('../runtimes/privateMomentsRuntime', () => ({
  openPrivateMomentMedia: privateMomentMocks.openMedia,
  publishPrivateMoment: privateMomentMocks.publishMoment,
  readPrivateComments: privateMomentMocks.readComments,
  readPrivateMoment: privateMomentMocks.readMoment,
  recoverPrivateMoment: privateMomentMocks.recoverMoment,
  publishPrivateTextMoment: privateMomentMocks.publish,
  readPrivateMomentsSnapshot: privateMomentMocks.snapshot,
  readPrivateTextMoment: vi.fn(),
  reconcilePrivateMoments: vi.fn(),
  submitPrivateComment: privateMomentMocks.submitComment,
  retryPrivateMomentReaction: privateMomentMocks.retryReaction,
}));

import { mobileAcceptanceActions } from './actions';

const publishPrivateText = mobileAcceptanceActions[
  'moments.private.publishText'
] as unknown as (input: unknown) => Promise<unknown>;

const recoverPrivate = mobileAcceptanceActions[
  'moments.private.recover'
] as unknown as (input: unknown) => Promise<unknown>;

const publishPrivate = mobileAcceptanceActions[
  'moments.private.publish'
] as unknown as (input: unknown) => Promise<unknown>;
const readPrivate = mobileAcceptanceActions[
  'moments.private.read'
] as unknown as (input: unknown) => Promise<unknown>;
const openPrivateMedia = mobileAcceptanceActions[
  'moments.private.media.open'
] as unknown as (input: unknown) => Promise<unknown>;
const submitPrivateCommentAction = mobileAcceptanceActions[
  'moments.private.comment.submit'
] as unknown as (input: unknown) => Promise<unknown>;
const readPrivateCommentsAction = mobileAcceptanceActions[
  'moments.private.comments.read'
] as unknown as (input: unknown) => Promise<unknown>;
const readPrivateSnapshotAction = mobileAcceptanceActions[
  'moments.private.snapshot'
] as unknown as () => Promise<unknown>;

function publishInput(audience: Record<string, unknown>) {
  return {
    draftId: 'draft-1',
    draftRevision: 1,
    text: 'private',
    audience,
  };
}

describe('Mobile Acceptance private Social audience', () => {
  beforeEach(() => {
    for (const mock of Object.values(privateMomentMocks)) mock.mockReset();
    privateMomentMocks.snapshot.mockReturnValue({
      active: true,
      reconciling: false,
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      projections: [],
      postsById: {},
      commentDrafts: [],
      reactionCommands: [],
      publishStateHistory: ['AUDIENCE_REQUIRED'],
      readStateHistoryByPostId: {},
      lastReport: null,
      errorMessage: null,
    });
    privateMomentMocks.publish.mockImplementation(async (intent) => ({
      draftId: intent.draftId,
      draftRevision: intent.draftRevision,
      contentId: 'content-1',
      generation: 1,
      audienceKind: intent.audience.kind,
      state: 'PUBLISHING',
    }));
  });

  it('forwards distinct Circle and Group target fields', async () => {
    await publishPrivateText(publishInput({
      kind: 'CIRCLE',
      circleId: '18446744073709551615',
    }));
    await publishPrivateText(publishInput({
      kind: 'GROUP',
      groupConversationId: '01J9Z7Y6M5N4P3Q2R1S0TUVWXY',
    }));

    expect(privateMomentMocks.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        audience: {
          kind: 'CIRCLE',
          circleId: '18446744073709551615',
        },
      }),
    );
    expect(privateMomentMocks.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        audience: {
          kind: 'GROUP',
          groupConversationId: '01J9Z7Y6M5N4P3Q2R1S0TUVWXY',
        },
      }),
    );
  });

  it('forwards CUSTOM_DENY(PUBLIC) so Native can return PRIVATE_UNSUPPORTED', async () => {
    await publishPrivateText(publishInput({
      kind: 'CUSTOM_DENY',
      actorPtids: ['ptid:bob'],
      baseKind: 'FOLLOWERS',
    }));
    await publishPrivateText(publishInput({
      kind: 'CUSTOM_DENY',
      actorPtids: ['ptid:bob'],
      baseKind: 'PUBLIC',
    }));

    expect(privateMomentMocks.publish).toHaveBeenCalledTimes(2);
    expect(privateMomentMocks.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        audience: {
          kind: 'CUSTOM_DENY',
          actorPtids: ['ptid:bob'],
          baseKind: 'PUBLIC',
        },
      }),
    );
  });

  it('rejects typed targets on the wrong audience kind', async () => {
    await expect(publishPrivateText(publishInput({
      kind: 'FOLLOWERS',
      circleId: '42',
    }))).rejects.toThrow(
      'acceptance.mobile.invalidInput:moments.private.audience.circleId',
    );
    await expect(publishPrivateText(publishInput({
      kind: 'CIRCLE',
      groupConversationId: '01J9Z7Y6M5N4P3Q2R1S0TUVWXY',
    }))).rejects.toThrow(
      'acceptance.mobile.invalidInput:moments.private.audience.groupConversationId',
    );
    expect(privateMomentMocks.publish).not.toHaveBeenCalled();
  });

  it('initiates native recovery with only post identity and epoch', async () => {
    privateMomentMocks.recoverMoment.mockResolvedValue({
      postId: 'post-1',
      contentId: 'content-1',
      generation: '1',
      authorPtid: 'ptid:alice',
      audienceKind: 'FRIENDS',
      state: 'RECOVERY_REQUIRED',
    });

    const result = await recoverPrivate({
      postId: 'post-1',
      recoveryEpoch: 7,
    });

    expect(privateMomentMocks.recoverMoment).toHaveBeenCalledWith(
      'post-1',
      7,
    );
    expect(result).toMatchObject({ postId: 'post-1', state: 'RECOVERY_REQUIRED' });
    expect(JSON.stringify(result)).not.toMatch(/phrase|secret|handle/i);
  });

  it('sanitizes recovered plaintext into a digest', async () => {
    privateMomentMocks.recoverMoment.mockResolvedValue({
      postId: 'post-1',
      contentId: 'content-1',
      generation: '1',
      authorPtid: 'ptid:alice',
      audienceKind: 'FRIENDS',
      state: 'CONTENT_READY',
      content: { kind: 'TEXT', text: 'recovered private text' },
    });

    const result = await recoverPrivate({ postId: 'post-1' });

    expect(result).toMatchObject({
      postId: 'post-1',
      state: 'CONTENT_READY',
      contentKind: 'TEXT',
    });
    expect(JSON.stringify(result)).not.toContain('recovered private text');
  });

  it('exposes sanitized private Comment draft failures', async () => {
    privateMomentMocks.snapshot.mockReturnValue({
      active: true,
      reconciling: false,
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      projections: [],
      postsById: {},
      commentDrafts: [{
        draftId: 'private-comment-draft',
        draftRevision: 1,
        postId: 'post-1',
        replyToCommentId: '',
        text: 'private comment body',
        mentions: [],
        state: 'COMMENT_FAILED',
        errorCode: 'COMMENT_PLAN_INVALID',
      }],
      reactionCommands: [],
      publishStateHistory: [],
      readStateHistoryByPostId: {},
      lastReport: null,
      errorMessage: null,
    });

    const result = await readPrivateSnapshotAction();

    expect(result).toMatchObject({
      commentDrafts: [{
        postId: 'post-1',
        state: 'COMMENT_FAILED',
        errorCode: 'COMMENT_PLAN_INVALID',
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-comment-draft|private comment body/,
    );
  });

  it('exposes sanitized private Reaction command state', async () => {
    privateMomentMocks.snapshot.mockReturnValue({
      active: true,
      reconciling: false,
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      projections: [],
      postsById: {},
      commentDrafts: [],
      reactionCommands: [{
        commandId: 'private-reaction-command',
        postId: 'post-1',
        kind: 2,
        operation: 'REACT',
        state: 'REACTION_UNKNOWN_OUTCOME',
        attemptCount: 1,
        projectionRevision: '0',
        errorCode: 'SOCIAL_20008',
      }],
      publishStateHistory: [],
      readStateHistoryByPostId: {},
      lastReport: null,
      errorMessage: null,
    });

    const result = await readPrivateSnapshotAction();

    expect(result).toMatchObject({
      reactionCommands: [{
        postId: 'post-1',
        kind: 2,
        operation: 'REACT',
        state: 'REACTION_UNKNOWN_OUTCOME',
        attemptCount: 1,
        projectionRevision: '0',
        errorCode: 'SOCIAL_20008',
      }],
    });
    expect(JSON.stringify(result)).not.toContain('private-reaction-command');
  });

  it.each(['', 'root-comment'])('replays the retained Native interaction twice for target %s', async (commentId) => {
    const command = {
      commandId: 'retained-command', postId: 'post-1', commentId,
      kind: commentId ? 1 : 0, operation: commentId ? 'REACT' : 'VOTE_POLL',
      state: 'REACTION_COMMITTED', attemptCount: 1, projectionRevision: '4',
      selectedOpaqueOptionIds: commentId ? [] : ['opaque-option'],
    };
    const snapshot = { ...privateMomentMocks.snapshot(), activationGeneration: 3, reactionCommands: [command] };
    privateMomentMocks.snapshot.mockReturnValue(snapshot);
    privateMomentMocks.retryReaction.mockResolvedValue({
      command, reactions: [{ kind: 1, count: '2', reactedByViewer: true }],
      projectionRevision: '4', exactReplay: false,
      ...(commentId ? {} : { poll: {
        postId: 'post-1', commandId: 'newer-peer-command', voteActorPtid: 'peer',
        voteCounts: ['0', '2'], selectedOptions: [1], voterCount: '2', projectionRevision: '5',
      } }),
    });
    const result = await mobileAcceptanceActions['moments.private.interaction.replay']({
      postId: 'post-1', commentId,
    });
    expect(privateMomentMocks.retryReaction.mock.calls).toEqual([['retained-command'], ['retained-command']]);
    expect(result).toMatchObject({ nativeRetryCount: 2, state: 'REACTION_COMMITTED', attemptCount: 1 });
    expect(result.replays[0]).toEqual(result.replays[1]);
    expect(JSON.stringify(result)).not.toMatch(/retained-command|opaque-option|newer-peer-command/);
  });

  it('rejects a substituted command before claiming an exact replay', async () => {
    const command = {
      commandId: 'retained-command', postId: 'post-1', commentId: '',
      kind: 0, operation: 'VOTE_POLL', state: 'REACTION_COMMITTED',
      attemptCount: 1, projectionRevision: '4', selectedOpaqueOptionIds: ['opaque-option'],
    };
    privateMomentMocks.snapshot.mockReturnValue({
      ...privateMomentMocks.snapshot(), activationGeneration: 3, reactionCommands: [command],
    });
    privateMomentMocks.retryReaction.mockResolvedValue({
      command: { ...command, selectedOpaqueOptionIds: ['substituted-option'] },
      poll: {}, reactions: [], exactReplay: false,
    });
    await expect(mobileAcceptanceActions['moments.private.interaction.replay']({
      postId: 'post-1',
    })).rejects.toThrow('privateInteractionReplayMismatch');
    expect(privateMomentMocks.retryReaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a replay completion after Native activation replacement', async () => {
    const command = {
      commandId: 'retained-command', postId: 'post-1', commentId: 'root-comment',
      kind: 1, operation: 'REACT', state: 'REACTION_COMMITTED',
      attemptCount: 1, projectionRevision: '4',
    };
    const snapshot = { ...privateMomentMocks.snapshot(), activationGeneration: 3, reactionCommands: [command] };
    privateMomentMocks.snapshot.mockReturnValue(snapshot);
    privateMomentMocks.retryReaction.mockImplementation(async () => {
      privateMomentMocks.snapshot.mockReturnValue({ ...snapshot, activationGeneration: 4 });
      return { command, reactions: [], exactReplay: false };
    });
    await expect(mobileAcceptanceActions['moments.private.interaction.replay']({
      postId: 'post-1', commentId: 'root-comment',
    })).rejects.toThrow('privateInteractionReplayMismatch');
    expect(privateMomentMocks.retryReaction).toHaveBeenCalledTimes(1);
  });

  it('exposes bounded generic subtype, media, and Comment actions without plaintext', async () => {
    privateMomentMocks.publishMoment.mockResolvedValue({
      draftId: 'draft-image',
      draftRevision: 1,
      contentId: 'content-image',
      generation: 1,
      audienceKind: 'FRIENDS',
      state: 'PUBLISHED',
      postId: 'post-image',
      text: 'private caption',
    });
    const imageProjection = {
      postId: 'post-image',
      contentId: 'content-image',
      generation: '1',
      authorPtid: 'ptid:alice',
      audienceKind: 'FRIENDS',
      state: 'CONTENT_READY',
      mentions: [],
      content: {
        kind: 'IMAGE',
        text: 'private caption',
        media: [{
          attachmentId: 'attachment-1',
          objectId: 'object-1',
          state: 'MEDIA_PLACEHOLDER',
          mimeType: 'image/png',
          width: 10,
          height: 10,
          durationMs: 0,
          altText: '',
        }],
      },
    };
    privateMomentMocks.readMoment.mockResolvedValue(imageProjection);
    privateMomentMocks.openMedia.mockResolvedValue({
      ...imageProjection,
      content: {
        ...imageProjection.content,
        media: [{
          ...imageProjection.content.media[0],
          state: 'MEDIA_READY',
          localPath: '/private/cache/object-1.media',
        }],
      },
    });
    privateMomentMocks.submitComment.mockResolvedValue({
      draft: {
        draftId: 'comment-draft',
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
    privateMomentMocks.readComments.mockResolvedValue({
      postId: 'post-image',
      comments: [],
      nextCursor: '',
      hasMore: false,
    });

    await expect(publishPrivate({
      ...publishInput({ kind: 'FRIENDS' }),
      momentKind: 'IMAGE',
      files: [{ handle: 'handle-1', attachmentId: 'attachment-1' }],
    })).resolves.toMatchObject({ state: 'PUBLISHED' });
    await expect(readPrivate({ postId: 'post-image' })).resolves.toMatchObject({
      contentKind: 'IMAGE',
      mediaStates: ['MEDIA_PLACEHOLDER'],
    });
    await expect(openPrivateMedia({ postId: 'post-image', objectId: 'object-1' }))
      .resolves.toMatchObject({ mediaStates: ['MEDIA_READY'] });
    const comment = await submitPrivateCommentAction({
      draftId: 'comment-draft', draftRevision: 1, postId: 'post-image', text: 'private reply',
    });
    expect(comment).toMatchObject({ state: 'COMMENT_POSTED', mentionCount: 0 });
    expect(JSON.stringify(comment)).not.toContain('private reply');
    await expect(readPrivateCommentsAction({ postId: 'post-image' }))
      .resolves.toMatchObject({ postId: 'post-image', comments: [] });
  });
});
