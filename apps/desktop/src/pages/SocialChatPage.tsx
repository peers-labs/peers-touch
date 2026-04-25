import { useEffect, useMemo, useRef, useState } from 'react';
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

  // --- Refs for values used inside effects without re-triggering subscriptions ---
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionRef = useRef(activeSessionUlid);
  activeSessionRef.current = activeSessionUlid;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // --- Stabilize activePeerDid: only propagate when the actual string value changes ---
  const rawActivePeerDid = useMemo(() => {
    if (activeTab !== 'friend' || !activeSessionUlid || !currentUserDid) return null;
    const session = sessions.find((s) => s.ulid === activeSessionUlid);
    if (!session) return null;
    return session.participantADid === currentUserDid ? session.participantBDid : session.participantADid;
  }, [activeTab, activeSessionUlid, currentUserDid, sessions]);

  const [stableActivePeerDid, setStableActivePeerDid] = useState(rawActivePeerDid);
  useEffect(() => {
    setStableActivePeerDid((prev) => (prev === rawActivePeerDid ? prev : rawActivePeerDid));
  }, [rawActivePeerDid]);

  const activePeerDidRef = useRef(stableActivePeerDid);
  activePeerDidRef.current = stableActivePeerDid;

  const [subPage, setSubPage] = useState<ChatSubPage>('chats');
  // Lazy-mount contacts panel: only create on first visit, then keep alive
  const [contactsMounted, setContactsMounted] = useState(false);
  useEffect(() => {
    if (subPage === 'contacts' && !contactsMounted) setContactsMounted(true);
  }, [subPage, contactsMounted]);

  useEffect(() => {
    loadCurrentUserProfile().catch(() => {});
    initEncryption().catch(() => {});
  }, [loadCurrentUserProfile, initEncryption]);

  // --- Sync timer: runs for component lifetime, reads mutable values via refs ---
  useEffect(() => {
    let disposed = false;
    const syncFriendChat = async () => {
      const currentSessions = sessionsRef.current;
      if (currentSessions.length === 0) return;
      try {
        const results = await Promise.all(
          currentSessions.map((session) => api.friendChatSync(session.ulid, 50, 2).catch((error) => {
            log.error('socialChat', 'background sync failed', { sessionUlid: session.ulid, error });
            return { synced_count: 0, pages_fetched: 0 };
          })),
        );
        if (disposed) return;
        const changed = results.some((item) => (item?.synced_count ?? 0) > 0);
        if (!changed) return;
        await loadSessions();
        await loadConversationPreviews().catch(() => {});
        if (!disposed && activeTabRef.current === 'friend' && activeSessionRef.current) {
          await loadMessages(activeSessionRef.current, 'friend');
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
  }, [loadMessages, loadSessions, loadConversationPreviews]);

  // --- P2P event registration: only re-subscribe when currentUserDid changes ---
  useEffect(() => {
    if (!currentUserDid) return;

    friendChatP2p.setOnStatus((_myDid, peerDid, status) => {
      const sid = activeSessionRef.current;
      if (!sid || activeTabRef.current !== 'friend') return;
      if (activePeerDidRef.current !== peerDid) return;
      setFriendP2pStatus(sid, status.state, status.detail);
    });

    friendChatP2p.setOnEnvelope((env) => {
      const sid = env.sessionUlid;
      if (!sid) return;
      api.friendChatSync(sid, 50, 1)
        .then(() => {
          if (activeTabRef.current === 'friend' && activeSessionRef.current === sid) {
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
  }, [currentUserDid, loadMessages, setFriendP2pStatus]);

  // --- P2P connection: stabilized deps prevent close/reconnect cycles ---
  useEffect(() => {
    const sid = activeSessionRef.current;
    if (!currentUserDid || !stableActivePeerDid || !sid) return;
    setFriendP2pStatus(sid, 'connecting');
    friendChatP2p.ensureConnected(currentUserDid, stableActivePeerDid).catch((error) => {
      const currentSid = activeSessionRef.current;
      if (currentSid) {
        setFriendP2pStatus(currentSid, 'failed', error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      friendChatP2p.closeAll();
    };
  }, [currentUserDid, stableActivePeerDid, setFriendP2pStatus]);

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

      {/* Left panel: keep both mounted once visited, toggle visibility */}
      <div style={{ display: subPage === 'chats' ? 'contents' : 'none' }}>
        <ChatSessionList />
      </div>
      {contactsMounted && (
        <div style={{ display: subPage === 'contacts' ? 'contents' : 'none' }}>
          <ChatContactsPanel />
        </div>
      )}

      {/* Right area: message content */}
      <ChatMessageArea />
      {showDetail && <ChatDetailPanel />}
    </Flexbox>
  );
}
