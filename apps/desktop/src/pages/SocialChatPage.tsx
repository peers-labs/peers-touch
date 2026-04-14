import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Tooltip } from 'antd';
import { MessageCircle, Contact } from 'lucide-react';
import { ChatSessionList } from '../components/chat/ChatSessionList';
import { ChatContactsPanel } from '../components/chat/ChatContactsPanel';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { useSocialChatStore } from '../store/socialChat';

type ChatSubPage = 'chats' | 'contacts';

export function SocialChatPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { showDetail, loadCurrentUserProfile, initEncryption } = useSocialChatStore();
  const [subPage, setSubPage] = useState<ChatSubPage>('chats');

  useEffect(() => {
    loadCurrentUserProfile().catch(() => {});
    initEncryption().catch(() => {});
  }, [loadCurrentUserProfile, initEncryption]);

  const subNavItems: { key: ChatSubPage; icon: typeof MessageCircle; label: string }[] = [
    { key: 'chats', icon: MessageCircle, label: t('chat.social.subNav.chats') },
    { key: 'contacts', icon: Contact, label: t('chat.social.subNav.contacts') },
  ];

  return (
    <Flexbox horizontal style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Sub-navigation: thin vertical icon bar */}
      <Flexbox
        gap={4}
        align="center"
        style={{
          width: 48,
          minWidth: 48,
          height: '100%',
          paddingTop: 12,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        {subNavItems.map(({ key, icon: Icon, label }) => {
          const isActive = subPage === key;
          return (
            <Tooltip key={key} title={label} placement="right">
              <Flexbox
                align="center"
                justify="center"
                onClick={() => setSubPage(key)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: isActive ? token.colorPrimaryBg : 'transparent',
                  color: isActive ? token.colorPrimary : token.colorTextTertiary,
                  transition: 'all 0.2s',
                }}
              >
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              </Flexbox>
            </Tooltip>
          );
        })}
      </Flexbox>

      {/* Left panel: Chat list or Contacts */}
      {subPage === 'chats' ? <ChatSessionList /> : <ChatContactsPanel />}

      {/* Right area: message content */}
      <ChatMessageArea />
      {showDetail && <ChatDetailPanel />}
    </Flexbox>
  );
}
