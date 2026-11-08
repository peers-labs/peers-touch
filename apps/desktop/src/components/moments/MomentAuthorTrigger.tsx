import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { IdentityTrigger, type IdentityCardCopy } from '@peers-touch/ui';
import { message } from 'antd';
import { useActorIdentity } from '../common/useActorIdentity';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { ensureUserMomentsProjection } from '../../runtimes/momentsRuntime';
import { useActiveMomentsSlice, useActiveRelationshipsSlice } from './useActiveMomentsStore';
import { SocialRelationshipAllowedAction } from '../../gen/proto/domain/social/relationship_pb';

/** Identity/relationship/read adapter. The library owns the card and popover. */
export function MomentAuthorTrigger({ actorPtid, children, onOpenProfile, onOpenMoment }: {
  actorPtid: string; children: ReactElement;
  onOpenProfile?: (actorPtid: string) => void; onOpenMoment?: (postId: string) => void;
}) {
  const { t } = useTranslation('moments');
  const identity = useActorIdentity(actorPtid, { requireCanonicalProfile: true });
  const { relation, status, statusError, blockPending, setBlocked, followers, follow, unfollow } = useActiveRelationshipsSlice(state => ({
    relation: state.relations[actorPtid], followers: state.followersByActor[actorPtid]?.total,
    status: state.statuses[actorPtid], statusError: state.statusErrors[actorPtid],
    blockPending: Boolean(state.blockPending[actorPtid]), setBlocked: state.setBlocked,
    follow: state.follow, unfollow: state.unfollow,
  }));
  const posts = useActiveMomentsSlice(state => (
    state.userFeeds[actorPtid]?.postIds.slice(0, 3).map(id => state.postsById[id]).filter(Boolean) ?? []
  ));
  const [pending, setPending] = useState(false);
  const copy: IdentityCardCopy = {
    localStation: t('moments.source.unresolved'), followers: t('moments.stats.followers'),
    mutual: t('moments.reason.mutual'), recentMoments: t('moments.identity.recent'),
    follow: t('moments.follow.follow'), following: t('moments.follow.following'),
    block: t('moments.identity.block'), unblock: t('moments.identity.unblock'),
    message: t('moments.identity.message'), openProfile: t('moments.identity.openProfile'),
    openSelfProfile: t('moments.identity.openSelfProfile'),
    cardLabel: name => t('moments.identity.cardLabel', { name }),
    momentLabel: (name, text) => t('moments.identity.momentLabel', { name, text }),
  };
  const toggleFollow = async () => {
    if (!relation || pending || blockPending || !status || statusError
      || !status.allowedActions.includes(SocialRelationshipAllowedAction.FOLLOW)) return;
    setPending(true);
    try { await (relation.following ? unfollow(actorPtid) : follow(actorPtid)); }
    catch { message.error(t('moments.follow.unavailable')); }
    finally { setPending(false); }
  };
  const toggleBlock = async () => {
    if (!status || statusError || blockPending || pending) return;
    try { await setBlocked(actorPtid, !status.blockedByViewer); }
    catch { message.error(t('moments.follow.unavailable')); }
  };
  const unavailable = { kind: 'disabled' as const, reason: t('moments.follow.unavailable') };
  return <IdentityTrigger copy={copy} name={identity.displayName || t('moments.author.unknown')}
    avatar={<UserSquareAvatar actorPtid={actorPtid} remoteUrl={identity.avatarUrl || undefined}
      name={identity.displayName} size={44} radius={12} />}
    station={identity.homeStationName} isSelf={identity.isSelf} resolved={Boolean(identity.displayName)}
    followers={followers} mutual={Boolean(relation?.following && relation.followedBy)} followed={relation?.following}
    actionIdSuffix={actorPtid} followExecution={pending ? 'pending' : 'idle'}
    followAvailability={!status || statusError || blockPending
      || !status.allowedActions.includes(SocialRelationshipAllowedAction.FOLLOW) ? unavailable : undefined}
    blocked={status?.blockedByViewer}
    blockExecution={blockPending ? 'pending' : 'idle'}
    blockAvailability={!status || statusError || pending || !status.targetHomeStationPeerId ? unavailable : undefined}
    onToggleBlock={() => void toggleBlock()}
    onToggleFollow={relation ? () => void toggleFollow() : undefined}
    onOpenChange={open => { if (open) void ensureUserMomentsProjection(actorPtid)
      .catch(() => message.error(t('moments.follow.unavailable'))); }}
    moments={posts.map(post => ({
      id: post.id, text: post.content.case === 'textPost' ? post.content.value.text : '',
    }))}
    onOpenProfile={onOpenProfile ? () => onOpenProfile(actorPtid) : undefined}
    onOpenMoment={onOpenMoment}>
    {children}
  </IdentityTrigger>;
}
