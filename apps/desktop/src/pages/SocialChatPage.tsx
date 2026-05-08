import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Tooltip } from 'antd';
import { MessageCircle, Contact } from 'lucide-react';
import { ChatSessionList } from '../components/chat/ChatSessionList';
import { ChatContactsPanel } from '../components/chat/ChatContactsPanel';
import { ChatContactsDetailPanel } from '../components/chat/ChatContactsDetailPanel';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { ChatThreadPanel } from '../components/chat/ChatThreadPanel';
import { CallSurface } from '../components/chat/CallSurface';
import { api } from '../services/desktop_api';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';
import { readFeatureFlags } from '../modules/settings/featureFlags';
import { friendChatP2p } from '../modules/p2p/friendChatP2p';

type ChatSubPage = 'chats' | 'contacts';

export function SocialChatPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    showDetail,
    openThreadRootUlid,
    loadCurrentUserProfile,
    initEncryption,
    loadSessions,
    setFriendP2pStatus,
    sessions,
    activeSessionUlid,
    activeTab,
    currentUserDid,
  } = useSocialChatStore();
  const loadConversationPreviews = useSocialChatStore((s) => s.loadConversationPreviews);
  const loadGroups = useSocialChatStore((s) => s.loadGroups);
  const loadGroupUnreadCounts = useSocialChatStore((s) => s.loadGroupUnreadCounts);

  // --- Refs for values used inside effects without re-triggering subscriptions ---
  const activeSessionRef = useRef(activeSessionUlid);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeSessionRef.current = activeSessionUlid;
    activeTabRef.current = activeTab;
  }, [activeSessionUlid, activeTab]);

  // --- Stabilize activePeerDid: only propagate when the actual string value changes ---
  const activePeerDid = useMemo(() => {
    if (activeTab !== 'friend' || !activeSessionUlid || !currentUserDid) return null;
    const session = sessions.find((s) => s.ulid === activeSessionUlid);
    if (!session) return null;
    return session.participantADid === currentUserDid ? session.participantBDid : session.participantADid;
  }, [activeTab, activeSessionUlid, currentUserDid, sessions]);

  const activePeerDidRef = useRef(activePeerDid);
  useEffect(() => {
    activePeerDidRef.current = activePeerDid;
  }, [activePeerDid]);

  const [subPage, setSubPage] = useState<ChatSubPage>('chats');
  // Lazy-mount contacts panel: only create on first visit, then keep alive
  const [contactsMounted, setContactsMounted] = useState(false);

  useEffect(() => {
    loadCurrentUserProfile().catch(() => {});
    initEncryption().catch(() => {});
  }, [loadCurrentUserProfile, initEncryption]);

  useEffect(() => {
    if (!readFeatureFlags().cryptoDrTelemetryEnabled) return;
    let cancelled = false;
    const tick = () =>
      api.cryptoRatchetTelemetrySnapshot().then((s) => {
        if (!cancelled) log.info('crypto', 'ratchet decrypt counts', s);
      }).catch(() => {});
    tick();
    const h = window.setInterval(tick, 24 * 60 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, []);

  // First visible load: the page may load list data needed to render the
  // chat surface, but app-level realtime/backfill/sync is owned by the
  // runtime bridge so it keeps running even when this page is not mounted.
  useEffect(() => {
    let disposed = false;
    const t0 = performance.now();
    const phase = (label: string) => {
      log.info('socialChat', `cold-load:${label}`, { ms: Math.round(performance.now() - t0) });
    };

    const yieldToPaint = () => new Promise<void>((r) => setTimeout(r, 0));

    const cold = async () => {
      phase('start');
      await Promise.allSettled([
        loadSessions(),
        loadGroups(),
      ]);
      if (disposed) return;
      phase('list-visible');

      await yieldToPaint();
      if (disposed) return;

      void Promise.allSettled([
        loadGroupUnreadCounts(),
        loadConversationPreviews(),
      ]).then(() => {
        if (!disposed) phase('list-decorated');
      });
    };

    cold().catch((error) => log.error('socialChat', 'cold-load failed', error));

    return () => {
      disposed = true;
    };
  }, [loadSessions, loadGroups, loadGroupUnreadCounts, loadConversationPreviews]);

  // --- P2P event registration: only re-subscribe when currentUserDid changes ---
  useEffect(() => {
    if (!currentUserDid) return;

    // P2P here only carries transport status (so the UI can show
    // "P2P direct / via relay / SSE-only"). The text data plane is
    // consumed by the app-level social realtime bridge.
    friendChatP2p.setOnStatus((_myDid, peerDid, status) => {
      const sid = activeSessionRef.current;
      if (!sid || activeTabRef.current !== 'friend') return;
      if (activePeerDidRef.current !== peerDid) return;
      setFriendP2pStatus(sid, status.state, status.detail, status.transport);
    });

    friendChatP2p.ensurePeerRegistered(currentUserDid).catch(() => {});
    return () => {
      friendChatP2p.setOnStatus(null);
    };
  }, [currentUserDid, setFriendP2pStatus]);

  // --- P2P connection: stabilized deps prevent close/reconnect cycles ---
  useEffect(() => {
    const sid = activeSessionRef.current;
    if (!currentUserDid || !activePeerDid || !sid) return;
    setFriendP2pStatus(sid, 'connecting');
    friendChatP2p.ensureConnected(currentUserDid, activePeerDid).catch((error) => {
      const currentSid = activeSessionRef.current;
      if (currentSid) {
        setFriendP2pStatus(currentSid, 'failed', error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      friendChatP2p.closeAll();
    };
  }, [currentUserDid, activePeerDid, setFriendP2pStatus]);

  const subNavItems: { key: ChatSubPage; icon: typeof MessageCircle; label: string }[] = [
    { key: 'chats', icon: MessageCircle, label: t('chat.social.subNav.chats') },
    { key: 'contacts', icon: Contact, label: t('chat.social.subNav.contacts') },
  ];

  return (
    <Flexbox horizontal style={{ height: '100%', minHeight: 0, width: '100%', overflow: 'hidden' }}>
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
                onClick={() => {
                  if (key === 'contacts') setContactsMounted(true);
                  setSubPage(key);
                }}
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

      {/* Right area: the active sub-page owns its own content semantics. */}
      {subPage === 'chats' ? (
        <>
          <ChatMessageArea />
          {openThreadRootUlid ? <ChatThreadPanel /> : showDetail && <ChatDetailPanel />}
        </>
      ) : (
        <ChatContactsDetailPanel onMessage={() => setSubPage('chats')} />
      )}
      {/* Voice / video call surface — page-level so a ringing call
          stays visible regardless of which conversation is open. */}
      <CallSurface />
    </Flexbox>
  );
}
