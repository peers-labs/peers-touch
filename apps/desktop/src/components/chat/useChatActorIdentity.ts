import { useTranslation } from 'react-i18next';

import { useActorIdentity } from '../common/useActorIdentity';
import { actorDisplayName } from '../../store/socialProfileProjection';

export function useChatActorIdentity(actorPtid: string, nickname?: string) {
  const { t } = useTranslation('chat');
  const identity = useActorIdentity(actorPtid, { nickname });
  return {
    ...identity,
    displayName: actorDisplayName(
      identity.displayName,
      t('chat.social.detail.unknownMember'),
    ),
  };
}
