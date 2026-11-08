import { useTranslation } from 'react-i18next';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { useActorIdentity } from '../common/useActorIdentity';

export function MomentCommentAuthorName({ actorPtid }: { actorPtid: string }) {
  const { t } = useTranslation('moments');
  const identity = useActorIdentity(actorPtid, {
    requireCanonicalProfile: true,
  });

  return (
    <strong>
      {actorDisplayName(identity.displayName, t('moments.author.unknown'))}
    </strong>
  );
}
