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
import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';

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

    // Cold-load is sliced into three priority bands. The bands are not
    // sequenced via `await`; they are *budgeted*: each band yields back
    // to the event loop before the next runs, so React can paint the
    // list as soon as band-1 lands, even if the network for band-2 is
    // still in flight. Without slicing, a user with N sessions paid
    // O(N) sequential SQLite-open cost on first-mount because the old
    // backfill loop ran inside the same microtask chain as the list
    // load. The new layout keeps the heavy work async-detached so the
    // first click on the chat menu paints in <100ms even when the local
    // store is cold.
    const PRIORITY_BACKFILL_LIMIT = 12;
    const yieldToPaint = () => new Promise<void>((r) => setTimeout(r, 0));

    const cold = async () => {
      // Band 1 — critical path: list is visible. These two calls hit
      // station for session/group metadata and are the only thing the
      // user is waiting on for "the chat menu opened".
      phase('start');
      await Promise.allSettled([
        loadSessions(),
        loadGroups(),
      ]);
      if (disposed) return;
      phase('list-visible');

      // Yield once so React paints the list rows before we kick off
      // band-2's network fan-out. This is cheap (one task tick) and
      // measurably improves perceived "first paint" latency.
      await yieldToPaint();
      if (disposed) return;

      // Band 2 — decorations: per-session previews + group unread
      // counts. These are *not* awaited from the cold-load promise
      // chain because they only paint extra detail onto already-
      // visible rows. Detaching them means a slow station response
      // here cannot keep the cold-load spinner spinning.
      void Promise.allSettled([
        loadGroupUnreadCounts(),
        loadConversationPreviews(),
      ]).then(() => {
        if (!disposed) phase('list-decorated');
      });

      // Band 3 — backfill, two-tier:
      //   3a. Top-N most-recent sessions sync immediately, sequentially.
      //       Sequential because each `friendChatSync` does a station
      //       fetch + local DB ingest, and we want to avoid keychain /
      //       SQLite contention. Top-N because the user only sees ~12
      //       rows in the conversation list at once; backfilling the
      //       300th session before the 1st is a waste of cold-load
      //       budget.
      //   3b. The remaining (older) sessions sync on the next idle
      //       tick, again sequentially. They will paint into rows
      //       that the user has to scroll to anyway, so the latency
      //       is invisible.
      // The local_chat_store connection pool means the per-call cost
      // here is now dominated by network, not by SQLCipher key
      // derivation. With pooling we measured ~30ms/sync on warm cache
      // vs ~250ms/sync without; this slicing complements that — if
      // the user has 50 sessions we still avoid 50× sequential RTT
      // before the user can interact.
      // ISO timestamps sort lexicographically, so a string compare on
      // `lastMessageAt|updatedAt|createdAt` (whichever is present)
      // gives us "most recently active first" without pulling
      // `activityFromSession` out of the store module just for sort.
      const sessionTs = (s: typeof sessionsRef.current[number]) =>
        (s as any).lastMessageAt ?? (s as any).updatedAt ?? (s as any).createdAt ?? '';
      const allSessions = sessionsRef.current.slice().sort((a, b) => {
        const ax = sessionTs(a);
        const bx = sessionTs(b);
        if (ax === bx) return 0;
        return bx > ax ? 1 : -1;
      });
      const priority = allSessions.slice(0, PRIORITY_BACKFILL_LIMIT);
      const deferred = allSessions.slice(PRIORITY_BACKFILL_LIMIT);

      const syncOne = async (sessionUlid: string) => {
        try {
          await api.friendChatSync(sessionUlid, 50, 1);
        } catch (error) {
          log.warn('socialChat', 'cold-load: per-session sync failed', {
            sessionUlid,
            error,
          });
        }
      };

      for (const session of priority) {
        if (disposed) return;
        await syncOne(session.ulid);
      }
      phase('backfill-priority-done');

      if (deferred.length > 0) {
        // requestIdleCallback is not in lib.dom.d.ts under our tsconfig
        // target, but Tauri's webview ships it. Fall back to a coarse
        // setTimeout if it's missing so this still works in the test
        // harness (jsdom).
        const scheduleIdle = (cb: () => void) => {
          const w = window as any;
          if (typeof w.requestIdleCallback === 'function') {
            w.requestIdleCallback(cb, { timeout: 2000 });
          } else {
            setTimeout(cb, 250);
          }
        };
        scheduleIdle(async () => {
          for (const session of deferred) {
            if (disposed) return;
            await syncOne(session.ulid);
          }
          if (!disposed) phase('backfill-deferred-done');
        });
      } else {
        phase('backfill-done');
      }
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

  // --- Realtime SSE message arrival: server-pushed, no polling ---
  //
  // The single SSE stream (see docs/architecture/realtime/event-stream.md
  // and services/eventStream.ts) fan-outs every incoming chat message
  // to this subscriber. We mirror what the legacy P2P onEnvelope path
  // did — delegate to friendChatSync to ingest the canonical message
  // from Station + refresh the active conversation. The handler is
  // intentionally small; ingestion (decrypt + persist + dedupe) lives
  // in the sync pipeline so any path (SSE, future federation,
  // catch-up) hits the same code.
  useEffect(() => {
    const off = eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIVED, (payload) => {
      const sid = payload.sessionUlid;
      if (!sid) return;
      api.friendChatSync(sid, 50, 1)
        .then(() => {
          if (activeTabRef.current === 'friend' && activeSessionRef.current === sid) {
            return loadMessages(sid, 'friend');
          }
          return undefined;
        })
        .catch((error) => log.warn('socialChat', 'realtime sync failed', error));
    });
    return off;
  }, [loadMessages]);

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
