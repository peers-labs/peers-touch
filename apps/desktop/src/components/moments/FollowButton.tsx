import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { message } from 'antd';
import { UserMinus, UserPlus } from 'lucide-react';
import { useActiveRelationshipsSlice } from './useActiveMomentsStore';

// Follow button — three rendered states:
//   1. Loading (initial relation fetch in flight) → spinner button.
//   2. Not following → outline button with "+ Follow".
//   3. Following → filled button with "Following" + hover swap to
//      "Unfollow" so the user gets confirmation before clicking.
//
// Self-target case:
//   - The store has no concept of "is this me", so the parent must
//     not render this button when the target is the viewer. We
//     defensively early-return on `targetActorPtid === viewerActorPtid`
//     so a misuse renders nothing instead of an actionable button
//     that would 4xx on click.

interface FollowButtonProps {
  targetActorPtid: string;
  /** Optional viewer id; when matches target, the button hides itself. */
  viewerActorPtid?: string;
  /** When `compact`, drop the icon and use the button-text-only form. */
  compact?: boolean;
}

export function FollowButton({ targetActorPtid, viewerActorPtid, compact }: FollowButtonProps) {
  const { t } = useTranslation('moments');
  const { relation, loadingMap, loadRelationship, follow, unfollow } = useActiveRelationshipsSlice((s) => ({
    relation: s.relations[targetActorPtid],
    loadingMap: s.loading,
    loadRelationship: s.loadRelationship,
    follow: s.follow,
    unfollow: s.unfollow,
  }));

  const [hovering, setHovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!targetActorPtid || relation || loadingMap[targetActorPtid]) return;
    loadRelationship(targetActorPtid).catch(() => {
      // Silent — the relationship cell is best-effort. UI will show
      // the "+Follow" default state.
    });
  }, [targetActorPtid, relation, loadingMap, loadRelationship]);

  if (viewerActorPtid && viewerActorPtid === targetActorPtid) return null;

  const following = !!relation?.following;
  const loading = !relation && !!loadingMap[targetActorPtid];

  const handleClick = async () => {
    setSubmitting(true);
    try {
      if (following) {
        await unfollow(targetActorPtid);
      } else {
        await follow(targetActorPtid);
      }
    } catch (err) {
      message.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const label = (() => {
    if (loading) return t('moments.follow.loading');
    if (following) return hovering ? t('moments.follow.unfollow') : t('moments.follow.following');
    return t('moments.follow.follow');
  })();

  return (
    <Button
      type={following ? 'default' : 'primary'}
      danger={following && hovering}
      size={compact ? 'small' : 'middle'}
      loading={submitting || loading}
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      icon={
        compact ? undefined : following ? (
          hovering ? <UserMinus size={14} /> : undefined
        ) : (
          <UserPlus size={14} />
        )
      }
    >
      {label}
    </Button>
  );
}
