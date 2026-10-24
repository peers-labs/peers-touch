import { useTranslation } from 'react-i18next';
import { Typography } from 'antd';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { useActorIdentity } from '../common/useActorIdentity';

export function MomentCommentAuthorName({ actorPtid }: { actorPtid: string }) {
  const { t } = useTranslation('moments');
  const identity = useActorIdentity(actorPtid, {
    requireCanonicalProfile: true,
  });

  return (
    <Typography.Text strong style={{ fontSize: 13 }}>
      {actorDisplayName(identity.displayName, t('moments.author.unknown'))}
    </Typography.Text>
  );
}
