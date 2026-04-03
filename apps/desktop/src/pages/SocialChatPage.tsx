import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme } from 'antd';
import { ChatSessionList } from '../components/chat/ChatSessionList';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { useSocialChatStore } from '../store/socialChat';

export function SocialChatPage() {
  const { token } = theme.useToken();
  const showDetail = useSocialChatStore((s) => s.showDetail);
  const loadCurrentProfile = useSocialChatStore((s) => s.loadCurrentProfile);

  useEffect(() => {
    loadCurrentProfile();
  }, [loadCurrentProfile]);

  return (
    <Flexbox horizontal style={{ height: '100%', overflow: 'hidden', background: token.colorBgLayout }}>
      <ChatSessionList />
      <ChatMessageArea />
      <div
        style={{
          width: showDetail ? 320 : 0,
          minWidth: showDetail ? 320 : 0,
          overflow: 'hidden',
          transition: 'width 0.25s ease, min-width 0.25s ease',
          borderLeft: showDetail ? `1px solid ${token.colorBorderSecondary}` : 'none',
        }}
      >
        {showDetail && <ChatDetailPanel />}
      </div>
    </Flexbox>
  );
}
