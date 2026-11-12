import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
  chatActorIdentityMetadata,
  chatActorIdentityMetadataParts,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

interface ChatActorIdentityRowProps {
  identity: ChatActorIdentityProjection;
  avatarSize?: number;
  style?: CSSProperties;
}

export function ChatActorIdentityRow({
  identity,
  avatarSize = 36,
  style,
}: ChatActorIdentityRowProps) {
  const { t } = useTranslation('chat');
  const { federation, station } = chatActorIdentityMetadataParts(identity);
  const metadata = chatActorIdentityMetadata(identity);

  return (
    <div
      className="sc-identity-row"
      data-chat-identity-ptid={identity.actorPtid}
      data-chat-identity-display-name={identity.displayName}
      data-chat-identity-federated-handle={identity.federatedHandle}
      data-chat-identity-home-station-domain={identity.homeStationDomain}
      data-chat-identity-home-station-peer-id={identity.homeStationPeerId}
      data-chat-identity-home-station-name={identity.homeStationName ?? ''}
      data-chat-identity-federation-id={identity.federationId}
      data-chat-identity-federation-name={identity.federationName}
      style={style}
    >
      <span
        data-chat-avatar-ptid={identity.actorPtid}
        data-chat-avatar-src={identity.avatarUrl}
        className="sc-identity-row__avatar"
      >
        <UserSquareAvatar
          remoteUrl={identity.avatarUrl}
          actorPtid={identity.actorPtid}
          name={identity.displayName}
          size={avatarSize}
        />
      </span>
      <div className="sc-identity-row__body">
        <strong
          className="sc-identity-row__name"
          title={identity.displayName}
        >
          {identity.displayName}
        </strong>
        <div data-chat-identity-metadata className="sc-identity-row__metadata">
          {federation ? (
            <span data-chat-identity-federation title={federation}>
              {t('chat.social.identity.federation', { federation })}
            </span>
          ) : null}
          {station || identity.homeStationPeerId ? (
            <span
              data-chat-identity-station
              title={station || t('chat.social.identity.stationUnavailable')}
            >
              {station
                ? t('chat.social.identity.station', { station })
                : t('chat.social.identity.stationUnavailable')}
            </span>
          ) : null}
          {!federation && !station && !identity.homeStationPeerId ? (
            <span title={metadata}>{metadata}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
