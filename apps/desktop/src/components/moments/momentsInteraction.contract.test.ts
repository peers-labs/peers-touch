import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePrivateCommentComposerAction } from './privateCommentComposerState';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const composerSource = source('./MomentComposer.tsx');
const audiencePickerSource = source('./AudiencePicker.tsx');
const commentListSource = source('./CommentList.tsx');
const detailSource = source('../../pages/moments/MomentDetailPage.tsx');
const appSource = source('../../pages/moments/MomentsApp.tsx');
const threadSource = source('./surfaces/SocialThreadSurface.tsx');
const searchSource = source('../../pages/moments/UserSearchPage.tsx');
const userSource = source('../../pages/moments/MomentsUserPage.tsx');
const circleSource = source('../../pages/moments/CircleManagePage.tsx');
const discoverySource = source('../../store/discovery.ts');
const runtimeSource = source('../../runtimes/momentsRuntime.ts');
const appRuntimeHookSource = source('../../hooks/useAppRuntime.ts');
const momentCardSource = source('./MomentCard.tsx');
const actionBarSource = source('./surfaces/SocialActionBar.tsx');
const enMoments = JSON.parse(
  source('../../../../../packages/locales/en/moments.json'),
) as Record<string, string>;

describe('Desktop Moments interaction contract', () => {
  it('boots recovery projections independently from critical Chat readiness', () => {
    const deferredProjection = appRuntimeHookSource.indexOf(
      'void installDeferredAppRuntimeProjections(actorPtid);',
    );
    const criticalRuntime = appRuntimeHookSource.indexOf(
      'void installAuthenticatedCriticalRuntimes(actorPtid).then(() => {',
    );

    expect(deferredProjection).toBeGreaterThan(-1);
    expect(criticalRuntime).toBeGreaterThan(deferredProjection);
    expect(appRuntimeHookSource).toContain('cancelDeferredProjections?.();');
    expect(appRuntimeHookSource).toContain('cancelIdleRuntimes?.();');
  });

  it('keeps post text away from its visible input boundary', () => {
    expect(composerSource).toContain('data-moments-composer-input');
    expect(composerSource).toContain("padding: '8px 12px'");
    expect(composerSource).toContain('border: `1px solid ${token.colorBorderSecondary}`');
  });

  it('lets users collapse and restore the mounted comment composer', () => {
    expect(threadSource).toContain('data-moments-comments-toggle');
    expect(detailSource).toContain('data-moments-comments-region');
    expect(detailSource).toContain('commentsOpen && (');
    expect(detailSource).toContain('<CommentList');
    expect(appSource).toContain('key={view.postId}');
    // The thread composer must not be remounted by draft/native
    // revision identity — only thread + viewer identity keys it.
    expect(detailSource).not.toContain('draftRevision');
    expect(detailSource).not.toContain('rendererGeneration');
  });

  it('keeps a committed private Comment actionable without plaintext', () => {
    expect(resolvePrivateCommentComposerAction({
      state: 'COMMENT_FAILED',
      publicationState: 'COMMITTED_PENDING_READBACK',
      retryDeadlinePending: false,
      text: '',
      draftText: '',
    })).toBe('reconcile');
    expect(detailSource).toContain('composerPublicationState');
    expect(commentListSource).toContain("t('moments.comment.confirmResult')");
    expect(commentListSource).toContain(
      "composerPublicationState === 'COMMITTED_PENDING_READBACK'",
    );
    expect(commentListSource).toContain("if (!onRetry) return 'submit'");
    expect(commentListSource).toContain(
      "composerState === 'COMMENT_RATE_LIMITED'",
    );
    expect(commentListSource).toContain('retryDeadlinePending');
    expect(commentListSource).toContain('withinRetryDeadline');
    expect(detailSource).toContain(
      "privateThread.state === 'COMMENT_PARENT_UNAVAILABLE'",
    );
  });

  it('navigates from a search result only through its avatar', () => {
    expect(searchSource).toContain('onAvatarClick={() => onOpenUser(u.id)}');
    expect(searchSource).not.toContain('onClick={() => onOpenUser(u.id)}');
    expect(searchSource).not.toContain('loading={searching}');
    expect(searchSource).toContain('searchError && query === normalizedText');
    expect(userSource).toContain('discoveryUser: s.usersById[actorPtid]');
    expect(userSource).toContain('loading={!author && profileLoading}');
    expect(userSource).toContain('refreshing={!!author && profileLoading}');
    expect(discoverySource).toContain('generation !== profileLoadGeneration');
    expect(runtimeSource).toContain('loadUserProfile(trimmedActorPtid, true)');
  });

  it('adds audience members through identity search instead of typed DIDs', () => {
    expect(circleSource).toContain('data-moments-circle-person-picker');
    expect(circleSource).toContain("t('moments.circle.searchPeoplePlaceholder')");
    expect(circleSource).not.toContain('memberInput');
    expect(runtimeSource).toContain('export async function ensureCircleMemberProfiles');
    expect(runtimeSource).toContain('const batchSize = 6');
    expect(appSource.indexOf("setView({ kind: 'tab', tab });")).toBeLessThan(
      appSource.indexOf('void ensureCircleMemberProfiles();'),
    );
    expect(enMoments['moments.circle.explanation']).toContain('private lists');
    expect(enMoments['moments.circle.searchPeoplePlaceholder']).not.toContain('DID');
  });

  it('gates a remote recipient publish behind typed readiness', () => {
    const admissionIndex = composerSource.indexOf('prepareRemotePrivateRecipient(');
    const publishIndex = composerSource.indexOf('const id = await createPost(privateDraft)');

    expect(admissionIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(admissionIndex);
    expect(composerSource).toContain('privateMomentPublishIntent(privateDraft)');
    expect(audiencePickerSource).toContain('data-moments-audience-kind');
    expect(audiencePickerSource).toContain('data-moments-audience-target="circle"');
    expect(audiencePickerSource).toContain('data-moments-audience-target="group"');
    expect(audiencePickerSource).toContain('data-moments-audience-actors');
    expect(composerSource).toContain('homeStationPeerId !== localStationPeerId');
    expect(composerSource).toContain('await preparePrivateAudience(intent)');
    expect(composerSource).toContain("privatePublishState === 'READY_PRIVATE'");
    expect(composerSource).toContain('<SocialPrivateState');
    expect(composerSource).toContain('clearPrivatePublishState();');
    expect(enMoments['moments.compose.checkRecipients']).toBe('Check recipients');
  });

  it('renders private Reaction status and explicit retry through SocialActionBar', () => {
    expect(momentCardSource).toContain('privateReaction: s.reactionsByPost[post.id]');
    expect(momentCardSource).toContain('retryPrivateReaction(post.id)');
    expect(momentCardSource).not.toContain('message.error(String(err))');
    expect(actionBarSource).toContain("reactionState === 'REACTION_PENDING'");
    expect(actionBarSource).toContain("t('moments.reaction.retry')");
    expect(enMoments['moments.reaction.status.REACTION_PENDING']).toBe(
      'Reaction pending',
    );
  });

  it('binds the embedded detail card reactions to the moments store', () => {
    // Detail reactions must call the same store actions as feeds; the
    // embedded MomentCard must never render a no-op reaction row.
    expect(detailSource).toContain('reactToPost: s.reactToPost');
    expect(detailSource).toContain('unreactToPost: s.unreactToPost');
    expect(detailSource).toContain('onReact={reactToPost}');
    expect(detailSource).toContain('onUnreact={unreactToPost}');
  });

  it('keeps Reply available on every comment while gating Delete by ownership', () => {
    expect(commentListSource).toContain('data-moments-comment-reply={comment.id}');
    // The reply button renders outside the ownership gate.
    const replyIndex = commentListSource.indexOf('data-moments-comment-reply');
    const gateIndex = commentListSource.indexOf('canModerate && onDelete');
    expect(replyIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(replyIndex);
    expect(commentListSource).toContain("t('moments.comment.deleteFailed')");
  });

  it('routes production and harness PUBLIC media through one composer decision', () => {
    const harnessSource = source('../../acceptance/moments/harness.ts');
    expect(composerSource).toContain('decideComposerImageAttachments({');
    expect(composerSource).toContain('sniffPickedImageMagic');
    expect(composerSource).toContain('api.ossUploadAttachmentSocial');
    // Private slots never go through the PUBLIC plaintext uploader.
    expect(composerSource).toContain("audience.kind !== Audience_Kind.PUBLIC");
    expect(harnessSource).toContain('decideComposerImageAttachments({');
    // The deleted encrypted social upload command stays gone from
    // production composer and acceptance harness.
    expect(composerSource).not.toContain('ossUploadEncryptedAttachmentSocial');
    expect(harnessSource).not.toContain('ossUploadEncryptedAttachmentSocial');
    // Magic validation reads only a bounded header, not the full file.
    const decisionSource = source('./composerMediaDecision.ts');
    expect(decisionSource).toContain('MAGIC_HEADER_BYTES');
    expect(decisionSource).toContain('reader.cancel()');
  });

  it('evicts deleted/revoked moments locally without issuing write commands', () => {
    const runtimeSource = source('../../runtimes/momentsRuntime.ts');
    expect(runtimeSource).toContain('evictPost(payload.postId)');
    expect(detailSource).not.toContain('composerRetryNotBeforeUnixMs');
  });
});
