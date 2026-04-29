import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, message } from 'antd';
import { UserMinus, UserPlus } from 'lucide-react';
import { useRelationshipsStore } from '../../store/relationships';

// Follow button — three rendered states:
//   1. Loading (initial relation fetch in flight) → spinner button.
//   2. Not following → outline button with "+ Follow".
//   3. Following → filled button with "Following" + hover swap to
//      "Unfollow" so the user gets confirmation before clicking.
//
// Self-target case:
//   - The store has no concept of "is this me", so the parent must
//     not render this button when the target is the viewer. We
//     defensively early-return on `targetActorId === viewerActorId`
//     so a misuse renders nothing instead of an actionable button
//     that would 4xx on click.

interface FollowButtonProps {
  targetActorId: string;
  /** Optional viewer id; when matches target, the button hides itself. */
  viewerActorId?: string;
  /** When `compact`, drop the icon and use the button-text-only form. */
  compact?: boolean;
}

export function FollowButton({ targetActorId, viewerActorId, compact }: FollowButtonProps) {
  const { t } = useTranslation('moments');
  const relation = useRelationshipsStore((s) => s.relations[targetActorId]);
  const loadingMap = useRelationshipsStore((s) => s.loading);
  const loadRelationship = useRelationshipsStore((s) => s.loadRelationship);
  const follow = useRelationshipsStore((s) => s.follow);
  const unfollow = useRelationshipsStore((s) => s.unfollow);

  const [hovering, setHovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!targetActorId || relation || loadingMap[targetActorId]) return;
    loadRelationship(targetActorId).catch(() => {
      // Silent — the relationship cell is best-effort. UI will show
      // the "+Follow" default state.
    });
  }, [targetActorId, relation, loadingMap, loadRelationship]);

  if (viewerActorId && viewerActorId === targetActorId) return null;

  const following = !!relation?.following;
  const loading = !relation && !!loadingMap[targetActorId];

  const handleClick = async () => {
    setSubmitting(true);
    try {
      if (following) {
        await unfollow(targetActorId);
      } else {
        await follow(targetActorId);
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
