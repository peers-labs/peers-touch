import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input, theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Search } from 'lucide-react';

import type { DesktopIMConversationProjection } from '../../store/socialProjection';

const { Text } = Typography;

interface ForwardPickerModalProps {
  conversations: DesktopIMConversationProjection[];
  onCancel: () => void;
  onSelect: (conversation: DesktopIMConversationProjection) => void;
  open: boolean;
}

export function ForwardPickerModal({
  conversations,
  onCancel,
  onSelect,
  open,
}: ForwardPickerModalProps) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const [filter, setFilter] = useState('');

  const filtered = filter.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(filter.toLowerCase()),
      )
    : conversations;

  return (
    <Modal
      title={t('chat.social.messageArea.forwardTitle')}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={360}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.messageArea.forwardTitle')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
        />
        <Flexbox
          gap={2}
          style={{
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <Text type="secondary" style={{ textAlign: 'center', padding: 16 }}>
              —
            </Text>
          ) : (
            filtered.map((conv) => (
              <Flexbox
                key={conv.id}
                horizontal
                align="center"
                gap={10}
                onClick={() => onSelect(conv)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: token.colorFillSecondary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                    flexShrink: 0,
                  }}
                >
                  {conv.title.charAt(0).toUpperCase()}
                </span>
                <Flexbox style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
                    {conv.title}
                  </Text>
                  <Text
                    type="secondary"
                    ellipsis
                    style={{ fontSize: 11 }}
                  >
                    {conv.kind === 'group' ? `Group · ${conv.memberCount ?? 0}` : 'Direct'}
                  </Text>
                </Flexbox>
              </Flexbox>
            ))
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
