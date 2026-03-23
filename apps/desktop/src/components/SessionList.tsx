import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar } from '@lobehub/ui';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { useChatStore } from '../store/chat';
import { useState } from 'react';
import { theme } from 'antd';

export function SessionList() {
  const { sessions, currentSessionKey, loadSessions, selectSession, newSession, deleteSession } =
    useChatStore();
  const [search, setSearch] = useState('');
  const { token } = theme.useToken();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filtered = search
    ? sessions.filter(
        (s) =>
          (s.title || s.key).toLowerCase().includes(search.toLowerCase()),
      )
    : sessions;

  return (
    <Flexbox height="100%" style={{ background: token.colorBgLayout }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        padding={16}
        gap={8}
      >
        <SearchBar
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <ActionIcon
          icon={Plus}
          onClick={newSession}
          title="New session"
          style={{
            background: token.colorPrimary,
            color: '#fff',
            borderRadius: 8,
          }}
        />
      </Flexbox>

      <Flexbox flex={1} style={{ overflow: 'auto', padding: '0 8px 8px' }}>
        {filtered.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            flex={1}
            style={{ color: token.colorTextQuaternary, padding: 40, fontSize: 13 }}
          >
            {search ? 'No matching sessions' : 'No sessions yet. Start a new chat!'}
          </Flexbox>
        )}
        {filtered.map((s) => {
          const isActive = s.key === currentSessionKey;
          return (
            <Flexbox
              key={s.key}
              horizontal
              align="center"
              gap={10}
              onClick={() => selectSession(s.key)}
              padding="10px 12px"
              style={{
                borderRadius: 8,
                cursor: 'pointer',
                marginBottom: 2,
                background: isActive ? token.colorPrimaryBg : 'transparent',
                transition: 'background 0.2s',
              }}
            >
              <MessageSquare
                size={18}
                style={{
                  flexShrink: 0,
                  color: isActive ? token.colorPrimary : token.colorTextSecondary,
                }}
              />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 400,
                    color: token.colorText,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.title || s.key}
                </div>
                <div style={{ fontSize: 12, color: token.colorTextDescription }}>
                  {s.message_count} messages
                </div>
              </Flexbox>
              <ActionIcon
                icon={Trash2}
                size="small"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  deleteSession(s.key);
                }}
                title="Delete"
                style={{ opacity: 0.5 }}
              />
            </Flexbox>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
}
