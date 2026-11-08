import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FollowButton } from '@peers-touch/ui';
import { useScopedFeedback } from '../../hooks/useAppFeedback';
import { useActiveRelationshipsSlice } from './useActiveMomentsStore';
import { SocialRelationshipAllowedAction } from '../../gen/proto/domain/social/relationship_pb';

// Relation reads belong to Moments Runtime. Missing/failed truth has an
// explicit read action; it must never masquerade as "not following".

interface FollowButtonProps {
  targetActorPtid: string;
  /** Optional viewer id; when matches target, the button hides itself. */
  viewerActorPtid?: string;
  /** When `compact`, drop the icon and use the button-text-only form. */
  compact?: boolean;
}

export function MomentRelationshipAction({ targetActorPtid, viewerActorPtid, compact }: FollowButtonProps) {
  const { t } = useTranslation('moments');
  const feedback = useScopedFeedback();
  const { relation, status, statusError, blockPending, loadingMap, loadRelationship,
    loadRelationshipStatus, follow, unfollow } = useActiveRelationshipsSlice((s) => ({
    relation: s.relations[targetActorPtid],
    status: s.statuses[targetActorPtid], statusError: s.statusErrors[targetActorPtid],
    blockPending: s.blockPending[targetActorPtid], loadRelationshipStatus: s.loadRelationshipStatus,
    loadingMap: s.loading,
    loadRelationship: s.loadRelationship,
    follow: s.follow,
    unfollow: s.unfollow,
  }));

  const [submitting, setSubmitting] = useState(false);

  if (viewerActorPtid && viewerActorPtid === targetActorPtid) return null;

  const following = !!relation?.following;
  const loading = !relation && !!loadingMap[targetActorPtid];
  if (!relation) {
    return <Button actionId={`relationship.resolve.${targetActorPtid}`}
      label={loading ? t('moments.follow.loading') : t('moments.follow.resolve')}
      execution={loading ? 'pending' : 'idle'} emphasis="secondary"
      onActivate={() => void Promise.all([loadRelationship(targetActorPtid), loadRelationshipStatus(targetActorPtid)]).catch(() =>
        feedback.error(t('moments.follow.unavailable')))} />;
  }

  const handleClick = async () => {
    if (submitting || blockPending || !status || statusError
      || !status.allowedActions.includes(SocialRelationshipAllowedAction.FOLLOW)) return;
    setSubmitting(true);
    try {
      if (following) {
        await unfollow(targetActorPtid);
      } else {
        await follow(targetActorPtid);
      }
    } catch {
      feedback.error(t('moments.follow.unavailable'));
    } finally {
      setSubmitting(false);
    }
  };

  const label = (() => {
    if (loading) return t('moments.follow.loading');
    if (following) return t('moments.follow.following');
    return t('moments.follow.follow');
  })();

  return (
    <FollowButton actionId={`author.follow.${targetActorPtid}`} following={following}
      label={label} compact={compact} onActivate={() => void handleClick()}
      availability={!status || statusError || blockPending
        || !status.allowedActions.includes(SocialRelationshipAllowedAction.FOLLOW)
        ? { kind: 'disabled', reason: t('moments.follow.unavailable') } : undefined}
      execution={submitting || loading ? 'pending' : 'idle'} />
  );
}
