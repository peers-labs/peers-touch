import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';

import type { MockUser } from '../mock';
import { Avatar } from './Avatar';

const { Text } = Typography;

export function ContactIdentityRow({
  contact,
  selected = false,
}: {
  contact: MockUser;
  selected?: boolean;
}) {
  const { token } = theme.useToken();
  const federation = contact.federationName || contact.federationId || '';
  const station = contact.homeStation || contact.federatedHandle || '';

  return (
    <Flexbox horizontal align="center" gap={10} flex={1} style={{ minWidth: 0 }}>
      <Avatar
        identityKey={contact.id}
        name={contact.name}
        src={contact.avatar}
        size={36}
        online={contact.online}
      />
      <Flexbox gap={1} flex={1} style={{ minWidth: 0 }}>
        <Text
          strong
          ellipsis={{ tooltip: contact.name }}
          style={{
            color: selected ? token.colorPrimary : token.colorText,
            fontSize: 13,
            lineHeight: 1.25,
          }}
        >
          {contact.name}
        </Text>
        {federation ? (
          <Text
            data-prototype-identity-federation
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
            Federation: {federation}
          </Text>
        ) : null}
        {station ? (
          <Text
            data-prototype-identity-station
            type="secondary"
            title={station}
            style={{
              display: 'block',
              fontSize: 11,
              lineHeight: 1.25,
              overflowWrap: 'anywhere',
              whiteSpace: 'normal',
            }}
          >
            Station: {station}
          </Text>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}
