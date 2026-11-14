import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScopedFeedback } from '../../hooks/useAppFeedback';
import { Button, Dialog, MomentAuthor, MomentCard as PeerMomentCard } from '@peers-touch/ui';
import { ExternalLink, MapPin, Pencil, Trash2 } from 'lucide-react';
import {
  Audience_Kind, RelationshipReason_Kind, ReactionKind,
  type FeedObjectExplanation, type Post, type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import { MomentAttachments, MomentVideoAttachment } from './MomentAttachments';
import { MomentAuthorTrigger } from './MomentAuthorTrigger';
import { MomentTextEditor } from './MomentTextEditor';
import { MomentCommentsSection } from './MomentCommentsSection';
import { MomentPoll } from './MomentPoll';
import { PrivateMediaGrid } from './PrivateMediaGrid';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useActorIdentity } from '../common/useActorIdentity';
import { useActiveMomentsFederationSlice, useActivePrivateMomentsSlice } from './useActiveMomentsStore';
import { isReadablePrivateMomentProjection, privateDeliveryNoticeState } from '../../services/privateMomentsNative';
import { SocialActionBar, SocialPrivateState, SocialTrustMeta } from './surfaces';
import { formatMomentTime } from './momentTime';
import { projectPrivateReactionRecovery } from '../../store/privateMoments';
import { useMomentsNavigationStore } from '../../store/momentsNavigation';
import { momentResourceKey } from '../../store/momentsTimeline';

interface MomentCardProps {
  post: Post; reactions?: ReactionSummary[]; explanation?: FeedObjectExplanation;
  viewerActorPtid?: string; surface?: 'home' | 'federated' | 'profile' | 'circle';
  onOpen?: (postId: string) => void; defaultCommentsOpen?: boolean; targetCommentId?: string;
  onReact?: (postId: string, kind: ReactionKind, operationId: string) => Promise<void> | void;
  onUnreact?: (postId: string, kind: ReactionKind | undefined, operationId: string) => Promise<void> | void;
  onAuthorClick?: (actorPtid: string) => void; onDelete?: (postId: string) => Promise<void> | void;
  embedded?: boolean;
}

const audienceKeys: Partial<Record<Audience_Kind, string>> = {
  [Audience_Kind.PUBLIC]: 'public', [Audience_Kind.FOLLOWERS]: 'followers',
  [Audience_Kind.FRIENDS]: 'friends', [Audience_Kind.SELF]: 'self',
  [Audience_Kind.CIRCLE]: 'circle', [Audience_Kind.GROUP]: 'group',
  [Audience_Kind.CUSTOM_ALLOW]: 'customAllow', [Audience_Kind.CUSTOM_DENY]: 'customDeny',
};
const reasonKeys: Partial<Record<RelationshipReason_Kind, string>> = {
  [RelationshipReason_Kind.RELATIONSHIP_REASON_SELF]: 'self',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING]: 'following',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWER]: 'follower',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_MUTUAL]: 'mutual',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_CIRCLE]: 'circle',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_MENTIONED]: 'mentioned',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_PUBLIC_FEDERATED]: 'publicFederated',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_PROFILE_VIEW]: 'profileView',
  [RelationshipReason_Kind.RELATIONSHIP_REASON_UNKNOWN]: 'unknown',
};
function bodyText(post: Post): string {
  const content = post.content;
  if (!content.case) return '';
  return content.case === 'repostPost' ? content.value.comment : content.value.text;
}

/** Native/Proto adapter. The shared MomentCard owns the complete visible card anatomy. */
export const MomentCard = memo(function MomentCard({ post, reactions, explanation, viewerActorPtid,
  surface = 'home', onOpen, defaultCommentsOpen = true, targetCommentId, onReact, onUnreact,
  onAuthorClick, onDelete, embedded }: MomentCardProps) {
  const { t } = useTranslation('moments');
  const createdAtMillis = post.createdAt === undefined ? undefined
    : Number(post.createdAt.seconds) * 1000 + post.createdAt.nanos / 1_000_000;
  const feedback = useScopedFeedback();
  const selfStation = useActiveMomentsFederationSlice(state => state.self);
  const { projection, platform, readMoment, recoverMoment, openMedia, reactionCommands, retryReaction,
    scope, postsById, reactionLiveFlights } =
    useActivePrivateMomentsSlice(state => ({
      projection: state.postsById[post.id], platform: state.platform, readMoment: state.readMoment,
      recoverMoment: state.recoverMoment, openMedia: state.openMedia,
      reactionCommands: state.reactionCommands, retryReaction: state.retryReaction,
      scope: state.scope, postsById: state.postsById, reactionLiveFlights: state.reactionLiveFlights,
      reactionRecoveryEpoch: state.reactionRecoveryEpoch,
    }));
  const recoveryState = { scope, platform, postsById, reactionLiveFlights };
  const resourceKey = momentResourceKey(post);
  const commentsKey = embedded ? `embedded:${resourceKey}` : resourceKey;
  const commentsOpen = useMomentsNavigationStore(state => state.commentsOpen[commentsKey] ?? defaultCommentsOpen);
  const setCommentsOpen = useMomentsNavigationStore(state => state.setCommentsOpen);
  const commentFocusIntent = useMomentsNavigationStore(state => state.commentFocusIntent);
  const [commentsMounted, setCommentsMounted] = useState(commentsOpen);
  if (commentsOpen && !commentsMounted) setCommentsMounted(true);
  const [deleteOpen, setDeleteOpen] = useState(false), [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const authorPtid = post.authorPtid || post.author?.id || '';
  const identity = useActorIdentity(authorPtid, { requireCanonicalProfile: true });
  const name = identity.displayName || t('moments.author.unknown');
  const audienceKind = explanation?.audienceExplanation?.kind ?? post.audience?.kind ?? Audience_Kind.PUBLIC;
  const isPrivate = audienceKind !== Audience_Kind.PUBLIC && audienceKind !== Audience_Kind.KIND_UNSPECIFIED;
  const state = projection?.state ?? (platform === 'native' ? 'LOADING_AUTHORIZED_RESOURCE' : 'PRIVATE_UNSUPPORTED_ON_DEVICE');
  const readable = Boolean(projection && isReadablePrivateMomentProjection(projection));
  const privateContent = readable ? projection?.content : undefined;
  const text = isPrivate ? privateContent?.kind === 'REPOST' ? privateContent.comment : privateContent?.text ?? '' : bodyText(post);
  const isSelf = identity.isSelf || Boolean(viewerActorPtid && viewerActorPtid === authorPtid);
  const domain = explanation?.source?.stationDomain || post.author?.homeStationDomain || '';
  const local = isSelf || Boolean(identity.homeStationPeerId && identity.homeStationPeerId === selfStation?.home_station_peer_id)
    || Boolean(domain && domain === selfStation?.home_station_domain);
  const sourceKind = local ? 'local' : identity.homeStationPeerId || domain ? 'remote' : 'unknown';
  const fallbackReason = isSelf ? 'self' : audienceKind === Audience_Kind.CIRCLE ? 'circle'
    : surface === 'federated' ? 'publicFederated' : surface === 'profile' ? 'profileView'
      : domain ? 'remotePublic' : 'homeDefault';
  const reasonKey = explanation?.relationshipReason
    ? reasonKeys[explanation.relationshipReason.kind] ?? fallbackReason : fallbackReason;
  const content = post.content;
  const images = !isPrivate && (content.case === 'imagePost' || content.case === 'locationPost') ? content.value.images : [];
  const original = !isPrivate && content.case === 'repostPost' ? content.value.originalPost : undefined;
  const delivery = privateDeliveryNoticeState(projection?.remoteDeliveryState);
  const canEdit = isSelf && !isPrivate && Boolean(post.publicFeedRef) && !post.isDeleted;
  const shownReactions = isPrivate && projection?.reactionsHydrated ? projection.reactions ?? [] : reactions ?? post.reactions;
  const unavailable = isPrivate && !readable;
  const react = async (kind: ReactionKind, operationId: string) => {
    try { await onReact?.(post.id, kind, operationId); }
    catch { feedback.error(t('moments.reaction.status.REACTION_REJECTED')); }
  };
  const unreact = async (kind: ReactionKind | undefined, operationId: string) => {
    try { await onUnreact?.(post.id, kind, operationId); }
    catch { feedback.error(t('moments.reaction.status.REACTION_REJECTED')); }
  };
  const confirmDelete = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try { await onDelete(post.id); setDeleteOpen(false); }
    catch { feedback.error(t('moments.delete.error')); }
    finally { setDeleting(false); }
  };
  return <PeerMomentCard postId={post.id} text={text} embedded={embedded}
    data-moments-comments-region={post.id}
    data-author-ptid={authorPtid}
    data-self={isSelf ? 'true' : 'false'}
    data-self-ptid={identity.currentUserPtid ?? ''}
    data-session-ptid={identity.sessionActorPtid ?? ''}
    data-social-chat-ptid={identity.socialChatUserPtid ?? ''}
    data-viewer-ptid={viewerActorPtid ?? ''}
    data-can-edit={canEdit ? 'true' : 'false'}
    copy={{ more: t('moments.action.more'), expand: t('moments.action.showMore'), collapse: t('moments.action.showLess') }}
    author={<MomentAuthorTrigger actorPtid={authorPtid} onOpenProfile={onAuthorClick} onOpenMoment={onOpen}>
      <MomentAuthor name={name} time={formatMomentTime(createdAtMillis, t)}
        label={t('moments.identity.cardLabel', { name })}
        avatar={<UserSquareAvatar remoteUrl={identity.avatarUrl || undefined} actorPtid={authorPtid || null}
          name={name} size={48} radius={13} />} />
    </MomentAuthorTrigger>}
    menuActions={[
      ...(canEdit ? [{ id: `moment.edit.${post.id}`, label: t('moments.edit.action'),
        leading: <Pencil size={14} />, onActivate: () => setEditOpen(true) }] : []),
      ...(isSelf && onDelete ? [{ id: `moment.delete.${post.id}`, label: t('moments.delete.action'),
        leading: <Trash2 size={14} />, tone: 'danger' as const, onActivate: () => setDeleteOpen(true) }] : []),
    ]}
    trust={<SocialTrustMeta source={{ kind: sourceKind, stationLabel: identity.homeStationName }}
      reason={{ label: t(`moments.reason.${reasonKey}`), kind: explanation?.relationshipReason?.kind }}
      audience={{ kind: audienceKind, label: t(`moments.audience.${audienceKeys[audienceKind] ?? 'public'}`) }} />}
    notice={isPrivate && <>
      {state !== 'CONTENT_READY' && <SocialPrivateState state={state} revocationReason={projection?.revocationReason}
        compact onRetry={() => void readMoment(post.id)} onRecover={() => void recoverMoment(post.id)} />}
      {state === 'CONTENT_READY' && delivery && <SocialPrivateState state={delivery} compact />}
    </>}
    attachments={<>
      {images.length > 0 && <MomentAttachments cids={images.slice(0, 9).map(image => image.url || image.id)}
        alts={images.slice(0, 9).map(image => image.altText)} />}
      {!isPrivate && content.case === 'videoPost' && content.value.video && <MomentVideoAttachment
        id={content.value.video.url || content.value.video.id} poster={content.value.video.thumbnailUrl} />}
      {privateContent && (privateContent.kind === 'IMAGE' || privateContent.kind === 'VIDEO') &&
        <PrivateMediaGrid media={privateContent.media} postId={post.id} onOpen={id => void openMedia(post.id, id)} />}
    </>}
    content={<>
      {!isPrivate && content.case === 'linkPost' && content.value.link && <p><ExternalLink size={15} />
        {/^(https?):\/\//.test(content.value.link.url)
          ? <a href={content.value.link.url} target="_blank" rel="noreferrer">{content.value.link.title || content.value.link.url}</a>
          : <span>{content.value.link.title}</span>}
        {content.value.link.description && <span> · {content.value.link.description}</span>}
      </p>}
      {!isPrivate && content.case === 'pollPost' && <MomentPoll key={post.id} post={post} />}
      {!isPrivate && content.case === 'locationPost' && content.value.location && <p><MapPin size={15} />
        {content.value.location.name}{content.value.location.address && <span> · {content.value.location.address}</span>}
      </p>}
      {privateContent?.kind === 'REPOST' && <blockquote>
        <strong>{privateContent.sourceAuthorPtid}</strong><p>{privateContent.sourceText}</p>
      </blockquote>}
      {privateContent?.kind === 'LINK' && <p><ExternalLink size={15} />
        <a href={privateContent.url} target="_blank" rel="noreferrer">{privateContent.title}</a></p>}
      {privateContent?.kind === 'POLL' && <MomentPoll key={post.id} post={post} />}
      {privateContent?.kind === 'LOCATION' && <p><MapPin size={15} /> {privateContent.name}
        {privateContent.address && <span> · {privateContent.address}</span>}</p>}
      {original && <blockquote><MomentCard post={original} embedded defaultCommentsOpen={false}
        viewerActorPtid={viewerActorPtid} onAuthorClick={onAuthorClick} /></blockquote>}
    </>}
    actions={<SocialActionBar postId={post.id} reactions={shownReactions} commentCount={Number(post.stats?.commentsCount ?? 0n)}
      commentsOpen={commentsOpen} reactionCommands={isPrivate ? Object.values(reactionCommands).filter(command =>
        command.postId === post.id && !command.commentId && command.operation !== 'VOTE_POLL')
        .map(command => ({ ...command, recovery: projectPrivateReactionRecovery(recoveryState, command) })) : undefined}
      onRetryReaction={isPrivate && !unavailable ? async (kind, commandId) => {
        try { await retryReaction(post.id, '', kind, commandId); } catch { feedback.error(t('moments.reaction.retryUnavailable')); }
      } : undefined}
      onReact={!unavailable && onReact ? react : undefined} onUnreact={!unavailable && onUnreact ? unreact : undefined}
      onOpenComments={() => setCommentsOpen(commentsKey, !commentsOpen)} />}
    commentsOpen={commentsOpen}
    comments={commentsMounted && !unavailable ? <MomentCommentsSection postId={post.id} isPrivate={isPrivate}
      active={commentsOpen} draftPostId={resourceKey} targetIntent={commentFocusIntent}
      viewerActorPtid={viewerActorPtid} targetCommentId={targetCommentId} onAuthorClick={onAuthorClick} /> : undefined}
    dialogs={<>
      {editOpen && <MomentTextEditor postId={post.id} text={text} onClose={() => setEditOpen(false)} />}
      <Dialog open={deleteOpen} onDismiss={() => { if (!deleting) setDeleteOpen(false); }}
        title={t('moments.delete.confirmTitle')} closeLabel={t('moments.action.cancel')}
        description={t(isPrivate ? 'moments.delete.confirmDescription' : 'moments.delete.publicDescription')}
        footer={<>
          <Button actionId={`moment.delete.cancel.${post.id}`} label={t('moments.action.cancel')} emphasis="quiet"
            availability={deleting ? { kind: 'disabled', reason: t('moments.reaction.pending') } : undefined}
            onActivate={() => setDeleteOpen(false)} />
          <Button actionId={`moment.delete.confirm.${post.id}`} label={t('moments.delete.action')} emphasis="primary"
            tone="danger" execution={deleting ? 'pending' : 'idle'} data-acceptance-id="social-delete-confirm"
            onActivate={() => void confirmDelete()} />
        </>} />
    </>} />;
});
