import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ChatSessionList } from '../components/chat/ChatSessionList';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { useSocialChatStore } from '../store/socialChat';

export function SocialChatPage() {
  const { showDetail, loadCurrentUserProfile } = useSocialChatStore();

  useEffect(() => {
    loadCurrentUserProfile();
  }, [loadCurrentUserProfile]);

  return (
    <Flexbox horizontal style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <ChatSessionList />
      <ChatMessageArea />
      {showDetail && <ChatDetailPanel />}
    </Flexbox>
  );
}
