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
  const loadGroups = useSocialChatStore((s) => s.loadGroups);
  const loadGroupUnreadCounts = useSocialChatStore((s) => s.loadGroupUnreadCounts);

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

  // --- Sync timer: 60 s safety-net only ---
  //
  // Real-time delivery is the responsibility of the WebRTC DataChannel
  // (P2P-direct or TURN-relay; both are equally responsive). When the DC
  // delivers a hint, `setOnEnvelope` below already triggers an immediate
  // sync + `loadMessages` for the active session. The interval here is
  // *only* a safety net for two corner cases:
  //
  //   1. WebRTC silently dies and `connectionstatechange` never fires
  //      (rare, but happens on macOS when the network stack flaps).
  //   2. The peer was offline when a message was sent, so it sits in
  //      station's pending queue until we pull it. The proper fix for
  //      (2) is an online/foreground-resume handshake that fetches
  //      `/friend-chat/pending` once — that's a separate change; until
  //      then this slow poll keeps the conversation eventually-consistent.
  //
  // 60 s was chosen because:
  //   - It's slow enough that station-side keychain / DB pressure is
  //     negligible even with dozens of sessions.
  //   - It's fast enough that the worst-case "I closed my laptop and
  //     re-opened it" reload feels reasonable.
  //
  // Do NOT lower this without first wiring up the explicit pending-pull
  // handshake — the previous 5 s value was masking the absence of one.
  // First-mount cold path: load list FAST so the user sees rows ASAP, then
  // do the slow per-session sync in the background. Keeping these
  // separated from `tick()` is important — `tick()` runs every 60s and the
  // cold-path is one-shot. This effect runs exactly once per `SocialChatPage`
  // mount; the page is keep-alive in `PageRouter`, so subsequent tab visits
  // do not re-trigger this. We deliberately do NOT block on
  // `friendChatSync` here — that's a multi-page Station fetch + DB ingest
  // that historically dominated the cold-load spinner. It now runs as a
  // detached background task while the list is already on screen.
  useEffect(() => {
    let disposed = false;
    const t0 = performance.now();
    const phase = (label: string) => {
      log.info('socialChat', `cold-load:${label}`, { ms: Math.round(performance.now() - t0) });
    };

    const cold = async () => {
      // 1. Critical path — list visible. Fan out, since these are independent.
      phase('start');
      await Promise.allSettled([
        loadSessions(),
        loadGroups(),
      ]);
      if (disposed) return;
      phase('list-visible');

      // 2. Secondary path — small fetches that decorate the list (last
      //    message previews, group unread counts). Fan out; UI re-renders
      //    incrementally.
      await Promise.allSettled([
        loadGroupUnreadCounts(),
        loadConversationPreviews(),
      ]);
      if (disposed) return;
      phase('list-decorated');

      // 3. Background path — Station→local message backfill per session.
      //    Sequential to avoid pegging keychain + station, but DETACHED
      //    from the cold spinner: the user is already chatting at this
      //    point, this just ensures missed messages get pulled.
      const sessionsForSync = sessionsRef.current;
      for (const session of sessionsForSync) {
        if (disposed) return;
        try {
          await api.friendChatSync(session.ulid, 50, 1);
        } catch (error) {
          log.warn('socialChat', 'cold-load: per-session sync failed', {
            sessionUlid: session.ulid,
            error,
          });
        }
      }
      phase('backfill-done');
    };

    cold().catch((error) => log.error('socialChat', 'cold-load failed', error));

    return () => {
      disposed = true;
    };
  }, [loadSessions, loadGroups, loadGroupUnreadCounts, loadConversationPreviews]);

  // --- Sync timer: 60 s safety-net only ---
  //
  // Real-time delivery is the responsibility of the WebRTC DataChannel
  // (P2P-direct or TURN-relay; both are equally responsive). When the DC
  // delivers a hint, `setOnEnvelope` below already triggers an immediate
  // sync + `loadMessages` for the active session. The interval here is
  // *only* a safety net for two corner cases:
  //
  //   1. WebRTC silently dies and `connectionstatechange` never fires
  //      (rare, but happens on macOS when the network stack flaps).
  //   2. The peer was offline when a message was sent, so it sits in
  //      station's pending queue until we pull it. The proper fix for
  //      (2) is an online/foreground-resume handshake that fetches
  //      `/friend-chat/pending` once — that's a separate change; until
  //      then this slow poll keeps the conversation eventually-consistent.
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const tick = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const currentSessions = sessionsRef.current;
        for (const session of currentSessions) {
          if (disposed) break;
          try {
            await api.friendChatSync(session.ulid, 50, 1);
          } catch (error) {
            log.error('socialChat', 'background sync failed', {
              sessionUlid: session.ulid,
              error,
            });
          }
        }
        if (disposed) return;
        if (activeTabRef.current === 'friend' && activeSessionRef.current) {
          await loadMessages(activeSessionRef.current, 'friend').catch((error) => {
            log.warn('socialChat', 'active session refresh failed', { error });
          });
        }
        await loadSessions().catch(() => {});
        await loadConversationPreviews().catch(() => {});
      } catch (error) {
        log.error('socialChat', 'background sync loop failed', error);
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      tick().catch(() => {});
    }, 60000);

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
      setFriendP2pStatus(sid, status.state, status.detail, status.transport);
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
