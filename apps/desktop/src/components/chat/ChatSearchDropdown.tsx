import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Empty, theme } from 'antd';
import { Search } from 'lucide-react';
import type { IMConversationProjection } from '@peers-touch/client-chat-core';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

interface ChatSearchDropdownProps {
  searchText: string;
  results: IMConversationProjection[];
  onSelect: (conversation: IMConversationProjection) => void;
}

export function ChatSearchDropdown({ searchText, results, onSelect }: ChatSearchDropdownProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const contacts = results.filter((c) => c.kind === 'friend');
  const groups = results.filter((c) => c.kind === 'group');

  if (!searchText.trim()) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 48,
        left: 12,
        right: 12,
        zIndex: 20,
        background: token.colorBgElevated,
        borderRadius: 10,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        border: `1px solid ${token.colorBorderSecondary}`,
        minHeight: '30%',
        maxHeight: 'calc(100% - 60px)',
        overflow: 'auto',
        padding: '6px 0',
      }}
    >
      {results.length === 0 ? (
        <Flexbox align="center" justify="center" style={{ padding: '24px 0' }}>
          <Empty
            image={<Search size={24} style={{ color: token.colorTextQuaternary }} />}
            imageStyle={{ height: 28 }}
            description={
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                {t('chat.social.sessionList.noResults')}
              </span>
            }
          />
        </Flexbox>
      ) : (
        <>
          {contacts.length > 0 && (
            <Section token={token} label="Contacts">
              {contacts.map((c) => (
                <ResultRow key={c.id} conversation={c} token={token} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {groups.length > 0 && (
            <Section token={token} label="Groups">
              {groups.map((c) => (
                <ResultRow key={c.id} conversation={c} token={token} onSelect={onSelect} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ token, label, children }: { token: any; label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '2px 0' }}>
      <div
        style={{
          padding: '4px 14px',
          fontSize: 11,
          fontWeight: 600,
          color: token.colorTextTertiary,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  conversation,
  token,
  onSelect,
}: {
  conversation: IMConversationProjection;
  token: any;
  onSelect: (c: IMConversationProjection) => void;
}) {
  const name = conversation.title || 'Unknown';
  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => onSelect(conversation)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <UserSquareAvatar remoteUrl={conversation.avatar} name={name} size={30} />
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {name}
      </span>
    </button>
  );
}
