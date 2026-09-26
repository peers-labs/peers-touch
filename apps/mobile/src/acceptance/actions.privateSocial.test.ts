import { beforeEach, describe, expect, it, vi } from 'vitest';

const privateMomentMocks = vi.hoisted(() => ({
  publish: vi.fn(),
  publishMoment: vi.fn(),
  readMoment: vi.fn(),
  openMedia: vi.fn(),
  submitComment: vi.fn(),
  readComments: vi.fn(),
  recover: vi.fn(),
  recoverMoment: vi.fn(),
  storeRecoveryPhrase: vi.fn(),
}));

vi.mock('../runtimes/privateMomentsRuntime', () => ({
  openPrivateMomentMedia: privateMomentMocks.openMedia,
  publishPrivateMoment: privateMomentMocks.publishMoment,
  readPrivateComments: privateMomentMocks.readComments,
  readPrivateMoment: privateMomentMocks.readMoment,
  recoverPrivateMoment: privateMomentMocks.recoverMoment,
  publishPrivateTextMoment: privateMomentMocks.publish,
  readPrivateMomentsSnapshot: vi.fn(() => ({
    projections: [],
    postsById: {},
    publishStateHistory: ['AUDIENCE_REQUIRED'],
    readStateHistoryByPostId: {},
  })),
  readPrivateTextMoment: vi.fn(),
  recoverPrivateTextMoment: privateMomentMocks.recover,
  reconcilePrivateMoments: vi.fn(),
  storePrivateSocialRecoveryPhrase: privateMomentMocks.storeRecoveryPhrase,
  submitPrivateComment: privateMomentMocks.submitComment,
}));

import { mobileAcceptanceActions } from './actions';

const publishPrivateText = mobileAcceptanceActions[
  'moments.private.publishText'
] as unknown as (input: unknown) => Promise<unknown>;

const storeRecoveryPhrase = mobileAcceptanceActions[
  'moments.private.storeRecoveryPhrase'
] as unknown as (input: unknown) => Promise<unknown>;

const recoverPrivateText = mobileAcceptanceActions[
  'moments.private.recoverText'
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

  it('accepts only FOLLOWERS as the CUSTOM_DENY base', async () => {
    await publishPrivateText(publishInput({
      kind: 'CUSTOM_DENY',
      actorPtids: ['ptid:bob'],
      baseKind: 'FOLLOWERS',
    }));

    await expect(publishPrivateText(publishInput({
      kind: 'CUSTOM_DENY',
      actorPtids: ['ptid:bob'],
      baseKind: 'PUBLIC',
    }))).rejects.toThrow(
      'acceptance.mobile.invalidInput:moments.private.audience.baseKind',
    );
    expect(privateMomentMocks.publish).toHaveBeenCalledOnce();
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

  it('stores recovery input without returning the phrase', async () => {
    privateMomentMocks.storeRecoveryPhrase.mockResolvedValue(undefined);

    const result = await storeRecoveryPhrase({
      recoveryPhrase: 'abandon '.repeat(23) + 'art',
      recoveryEpoch: 7,
    });

    expect(privateMomentMocks.storeRecoveryPhrase).toHaveBeenCalledWith(
      'abandon '.repeat(23) + 'art',
      7,
    );
    expect(result).toEqual({ stored: true, recoveryEpoch: 7 });
    expect(JSON.stringify(result)).not.toContain('abandon');
  });

  it('sanitizes recovered plaintext into a digest', async () => {
    privateMomentMocks.recover.mockResolvedValue({
      postId: 'post-1',
      contentId: 'content-1',
      generation: '1',
      authorPtid: 'ptid:alice',
      audienceKind: 'FRIENDS',
      state: 'CONTENT_READY',
      content: { kind: 'TEXT', text: 'recovered private text' },
    });

    const result = await recoverPrivateText({ postId: 'post-1' });

    expect(result).toMatchObject({
      postId: 'post-1',
      state: 'CONTENT_READY',
      contentKind: 'TEXT',
    });
    expect(JSON.stringify(result)).not.toContain('recovered private text');
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
