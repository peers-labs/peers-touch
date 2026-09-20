import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';

import {
  chatActorIdentityMetadata,
  chatActorIdentityMetadataParts,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

const { Text } = Typography;

interface ChatActorIdentityRowProps {
  identity: ChatActorIdentityProjection;
  avatarSize?: number;
  nameColor?: string;
  style?: CSSProperties;
}

export function ChatActorIdentityRow({
  identity,
  avatarSize = 36,
  nameColor,
  style,
}: ChatActorIdentityRowProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { federation, station } = chatActorIdentityMetadataParts(identity);
  const metadata = chatActorIdentityMetadata(identity);

  return (
    <Flexbox
      data-chat-identity-ptid={identity.actorPtid}
      data-chat-identity-display-name={identity.displayName}
      data-chat-identity-federated-handle={identity.federatedHandle}
      data-chat-identity-home-station-domain={identity.homeStationDomain}
      data-chat-identity-home-station-peer-id={identity.homeStationPeerId}
      data-chat-identity-home-station-name={identity.homeStationName ?? ''}
      data-chat-identity-federation-id={identity.federationId}
      data-chat-identity-federation-name={identity.federationName}
      horizontal
      align="center"
      gap={9}
      flex={1}
      style={{ minWidth: 0, ...style }}
    >
      <span
        data-chat-avatar-ptid={identity.actorPtid}
        data-chat-avatar-src={identity.avatarUrl}
        style={{ display: 'inline-flex', flexShrink: 0 }}
      >
        <UserSquareAvatar
          remoteUrl={identity.avatarUrl}
          name={identity.displayName}
          size={avatarSize}
        />
      </span>
      <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
        <Text
          strong
          ellipsis={{ tooltip: identity.displayName }}
          style={{
            color: nameColor ?? token.colorText,
            fontSize: 13,
            lineHeight: 1.25,
          }}
        >
          {identity.displayName}
        </Text>
        <Flexbox
          data-chat-identity-metadata
          gap={0}
          style={{ minWidth: 0 }}
        >
          {federation ? (
            <Text
              data-chat-identity-federation
              type="secondary"
              title={federation}
              style={{
                display: 'block',
                fontSize: 11,
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
            >
              {t('chat.social.identity.federation', { federation })}
            </Text>
          ) : null}
          {station || identity.homeStationPeerId ? (
            <Text
              data-chat-identity-station
              type="secondary"
              title={station || t('chat.social.identity.stationUnavailable')}
              style={{
                display: 'block',
                fontSize: 11,
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
            >
              {station
                ? t('chat.social.identity.station', { station })
                : t('chat.social.identity.stationUnavailable')}
            </Text>
          ) : null}
          {!federation && !station && !identity.homeStationPeerId ? (
            <Text
              type="secondary"
              title={metadata}
              style={{
                display: 'block',
                fontSize: 11,
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
            >
              {metadata}
            </Text>
          ) : null}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
