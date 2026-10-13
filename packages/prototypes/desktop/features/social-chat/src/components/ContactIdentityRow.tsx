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

  return (
    <Flexbox horizontal align="center" gap={10} flex={1} style={{ minWidth: 0 }}>
      <Avatar
        identityKey={contact.id}
        name={contact.name}
        src={contact.avatar}
        size={36}
        online={contact.online}
        federated={contact.federated}
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
      </Flexbox>
    </Flexbox>
  );
}
