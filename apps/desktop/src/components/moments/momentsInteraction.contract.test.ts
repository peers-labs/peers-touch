import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePrivateCommentComposerAction } from './privateCommentComposerState';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const composerSource = source('./MomentComposer.tsx');
const audiencePickerSource = source('./AudiencePicker.tsx');
const sharedAudienceSource = source('../../../../../packages/ui/web/src/moment-composer.tsx');
const sharedMomentsCss = source('../../../../../packages/ui/web/src/moments.css');
const commentListSource = source('./CommentList.tsx');
const commentsSectionSource = source('./MomentCommentsSection.tsx');
const detailSource = source('../../pages/moments/MomentDetailPage.tsx');
const appSource = source('../../pages/moments/MomentsApp.tsx');
const sharedCardSource = source('../../../../../packages/ui/web/src/moment-card.tsx');
const scopeSource = source('../../../../../packages/ui/web/src/moment-scope-bar.tsx');
const navigationSource = source('../../store/momentsNavigation.ts');
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
  it('uses peers-ui across all Social surfaces and the shell-owned scoped feedback path', () => {
    const legacy: string[] = [];
    const inspect = (directory: URL) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) inspect(file);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
          && /(?:from\s*|import\s*\()\s*['"](?:antd|@lobehub\/ui)['"]/.test(readFileSync(file, 'utf8'))) {
          legacy.push(file.pathname);
        }
      }
    };
    inspect(new URL('./', import.meta.url));
    inspect(new URL('../../pages/moments/', import.meta.url));
    expect(legacy).toEqual([]);
    // The shell owns the session-scoped feedback channel: it creates it via
    // useAppFeedback, provides it through AppFeedbackContext (consumed by
    // useScopedFeedback), and renders its FeedbackHost. UIProvider itself moved
    // up to main.tsx on master, so the binding lives on the context/host here.
    const appSourceScoped = source('../../App.tsx');
    expect(appSourceScoped).toContain('useAppFeedback()');
    expect(appSourceScoped).toContain('AppFeedbackContext.Provider value={feedback}');
    expect(appSourceScoped).toContain('<FeedbackHost channel={feedback} />');
    for (const consumer of ['./MomentComposer.tsx', './MomentCard.tsx', './CommentList.tsx',
      './MomentAuthorTrigger.tsx', './MomentRelationshipAction.tsx', '../../pages/moments/CircleManagePage.tsx']) {
      expect(source(consumer)).toContain('useScopedFeedback');
    }
  });

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
    expect(composerSource).toContain('<MomentComposerSurface');
    expect(sharedMomentsCss).toContain('.sk-compose .pt-field-frame');
    expect(sharedMomentsCss).toContain('padding: 4px 8px');
  });

  it('lets users collapse and restore the comment thread inside the card', () => {
    expect(sharedCardSource).toContain('data-acceptance-id="social-open-comments"');
    expect(sharedCardSource).toContain('aria-expanded={commentsOpen}');
    expect(actionBarSource).toContain('<MomentReactionBar');
    expect(detailSource).not.toContain('SocialThreadSurface');
    // Comments expand inline in the card; the section anchor stays on the
    // card root so deep-link captures find the thread from its card.
    expect(momentCardSource).toContain('data-moments-comments-region={post.id}');
    expect(momentCardSource).toContain('commentsMounted && !unavailable');
    expect(momentCardSource).toContain('commentsOpen={commentsOpen}');
    expect(momentCardSource).toContain('active={commentsOpen}');
    expect(sharedCardSource).toContain('hidden={!commentsOpen}');
    expect(momentCardSource).toContain('<MomentCommentsSection');
    expect(commentsSectionSource).toContain('<CommentList');
    expect(appSource).toContain('key={view.postId}');
    // The thread composer must not be remounted by draft/native
    // revision identity — only thread + viewer identity keys it.
    expect(commentsSectionSource).not.toContain('draftRevision');
    expect(commentsSectionSource).not.toContain('rendererGeneration');
    expect(commentsSectionSource).toContain('key={commentDraftKey(');
    expect(commentsSectionSource).toContain('sessionEpoch');
  });

  it('keeps a committed private Comment actionable without plaintext', () => {
    expect(resolvePrivateCommentComposerAction({
      state: 'COMMENT_FAILED',
      publicationState: 'COMMITTED_PENDING_READBACK',
      retryDeadlinePending: false,
      text: '',
      draftText: '',
    })).toBe('reconcile');
    expect(commentsSectionSource).toContain('composerPublicationState');
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
    expect(commentsSectionSource).toContain(
      "privateThread.state === 'COMMENT_PARENT_UNAVAILABLE'",
    );
  });

  it('keeps two scopes and nearby search while identities open their original profile', () => {
    expect(navigationSource).toContain("MomentsTab = 'feed' | 'circles'");
    expect(appSource).toContain('<MomentScopeBar');
    expect(appSource).toContain("setQuery('')");
    expect(scopeSource).toContain('data-scope-search={value}');
    expect(scopeSource).toContain('onQueryChange');
    expect(appSource).toContain('onAuthorClick={goUser}');
    expect(userSource).toContain('discoveryUser: s.usersById[actorPtid]');
    expect(userSource).toContain('loading={!author && profileLoading}');
    expect(userSource).toContain('refreshing={!!author && profileLoading}');
    expect(discoverySource).toContain('generation !== profileLoadGeneration');
    expect(runtimeSource).toContain('loadUserProfile(trimmedActorPtid, true)');
  });

  it('adds audience members through identity search instead of typed DIDs', () => {
    expect(circleSource).toContain('<MomentCircleEditor');
    expect(circleSource).toContain('void searchUsers(value)');
    expect(circleSource).toContain('await saveCircle(');
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
    expect(sharedAudienceSource).toContain('data-moments-audience-kind');
    expect(sharedAudienceSource).toContain('data-moments-audience-target');
    expect(audiencePickerSource).toContain("case: 'circleId'");
    expect(audiencePickerSource).toContain("case: 'groupConversationId'");
    expect(sharedAudienceSource).toContain('data-moments-audience-actors');
    expect(composerSource).toContain('homeStationPeerId !== localStationPeerId');
    expect(composerSource).toContain('await preparePrivateAudience(intent)');
    expect(composerSource).toContain("privatePublishState === 'READY_PRIVATE'");
    expect(composerSource).toContain('<SocialPrivateState');
    expect(composerSource).toContain('clearPrivatePublishState();');
    expect(enMoments['moments.compose.checkRecipients']).toBe('Check recipients');
  });

  it('renders private Reaction status and explicit retry through SocialActionBar', () => {
    expect(momentCardSource).toContain('Object.values(reactionCommands)');
    expect(momentCardSource).toContain('command.postId === post.id && !command.commentId');
    expect(momentCardSource).toContain('projectPrivateReactionRecovery(recoveryState, command)');
    expect(momentCardSource).toContain("retryReaction(post.id, '', kind, commandId)");
    expect(momentCardSource).not.toContain('message.error(String(err))');
    expect(actionBarSource).toContain("command.state === 'REACTION_PENDING'");
    expect(actionBarSource).toContain("t('moments.reaction.retry')");
    expect(actionBarSource).toContain('command.recovery?.eligible');
    expect(actionBarSource).not.toContain("command.state === 'REACTION_REJECTED' && onRetryReaction");
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
    expect(commentListSource).toContain('onSubmit(trimmed, replyRootId, normalized)');
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
