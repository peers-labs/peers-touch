import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Tooltip } from 'antd';
import { MessageCircle, Contact } from 'lucide-react';
import { ChatSessionList } from '../components/chat/ChatSessionList';
import { ChatContactsPanel } from '../components/chat/ChatContactsPanel';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { api } from '../services/desktop_api';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';
import { friendChatP2p } from '../modules/p2p/friendChatP2p';

type ChatSubPage = 'chats' | 'contacts';

export function SocialChatPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    showDetail,
    loadCurrentUserProfile,
    initEncryption,
    loadSessions,
    loadMessages,
    setFriendP2pStatus,
    sessions,
    activeSessionUlid,
    activeTab,
    currentUserDid,
  } = useSocialChatStore();
  const loadConversationPreviews = useSocialChatStore((s) => s.loadConversationPreviews);

  const activePeerDid = useMemo(() => {
    if (activeTab !== 'friend' || !activeSessionUlid || !currentUserDid) return null;
    const session = sessions.find((s) => s.ulid === activeSessionUlid);
    if (!session) return null;
    return session.participantADid === currentUserDid ? session.participantBDid : session.participantADid;
  }, [activeTab, activeSessionUlid, currentUserDid, sessions]);

  const [subPage, setSubPage] = useState<ChatSubPage>('chats');

  useEffect(() => {
    loadCurrentUserProfile().catch(() => {});
    initEncryption().catch(() => {});
  }, [loadCurrentUserProfile, initEncryption]);

  useEffect(() => {
    let disposed = false;
    const syncFriendChat = async () => {
      if (sessions.length === 0) return;
      try {
        const results = await Promise.all(
          sessions.map((session) => api.friendChatSync(session.ulid, 50, 2).catch((error) => {
            log.error('socialChat', 'background sync failed', { sessionUlid: session.ulid, error });
            return { synced_count: 0, pages_fetched: 0 };
          })),
        );
        if (disposed) return;
        const changed = results.some((item) => (item?.synced_count ?? 0) > 0);
        if (!changed) return;
        await loadSessions();
        await loadConversationPreviews().catch(() => {});
        if (!disposed && activeTab === 'friend' && activeSessionUlid) {
          await loadMessages(activeSessionUlid, 'friend');
        }
      } catch (error) {
        log.error('socialChat', 'background sync loop failed', error);
      }
    };

    syncFriendChat().catch(() => {});
    const timer = window.setInterval(() => {
      syncFriendChat().catch(() => {});
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [sessions, activeSessionUlid, activeTab, loadMessages, loadSessions, loadConversationPreviews]);

  useEffect(() => {
    if (!currentUserDid) return;

    friendChatP2p.setOnStatus((_myDid, peerDid, status) => {
      if (!activeSessionUlid || activeTab !== 'friend') return;
      if (activePeerDid !== peerDid) return;
      setFriendP2pStatus(activeSessionUlid, status.state, status.detail);
    });

    friendChatP2p.setOnEnvelope((env) => {
      const sid = env.sessionUlid;
      if (!sid) return;
      api.friendChatSync(sid, 50, 1)
        .then(() => {
          if (activeTab === 'friend' && activeSessionUlid === sid) {
            return loadMessages(sid, 'friend');
          }
          return undefined;
        })
        .catch((error) => log.warn('p2p', 'sync after hint failed', error));
    });

    friendChatP2p.ensurePeerRegistered(currentUserDid).catch(() => {});
    return () => {
      friendChatP2p.setOnEnvelope(null);
      friendChatP2p.setOnStatus(null);
    };
  }, [currentUserDid, activePeerDid, activeSessionUlid, activeTab, loadMessages, setFriendP2pStatus]);

  useEffect(() => {
    if (!currentUserDid || !activePeerDid || !activeSessionUlid) return;
    setFriendP2pStatus(activeSessionUlid, 'connecting');
    friendChatP2p.ensureConnected(currentUserDid, activePeerDid).catch((error) => {
      setFriendP2pStatus(activeSessionUlid, 'failed', error instanceof Error ? error.message : String(error));
    });

    return () => {
      friendChatP2p.closeAll();
    };
  }, [currentUserDid, activePeerDid, activeSessionUlid, setFriendP2pStatus]);

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
