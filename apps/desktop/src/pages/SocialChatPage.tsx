import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatSessionList, type ChatRailTab } from '../components/chat/ChatSessionList';
import { ChatContactsPanel } from '../components/chat/ChatContactsPanel';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatRailResizer } from '../components/chat/ChatRailResizer';
import {
  CHAT_RAIL_DEFAULT_WIDTH,
  clampChatRailWidth,
  persistChatRailWidth,
  readStoredChatRailWidth,
} from '../components/chat/chatRailWidth';
import { ChatDetailPanel } from '../components/chat/ChatDetailPanel';
import { ChatThreadPanel } from '../components/chat/ChatThreadPanel';
import { AttachmentDetailHost } from '../components/chat/AttachmentDetailHost';
import { CallSurface } from '../components/chat/CallSurface';
import { GroupCallSurface } from '../components/chat/GroupCallSurface';
import {
  beginDirectConversationOpen,
  failDirectConversationOpen,
  findContactConversation,
  type ContactSelection,
  type DirectConversationOpenIntent,
  type FriendContactSelection,
} from '../components/chat/contactSelection';
import { api } from '../services/desktop_api';
import { mapChatError } from '../services/errorMappings/chatErrorMapping';
import { presentError } from '../services/errorPresenter';
import { imServiceV1 } from '../services/im-service';
import { scheduleIdle } from '../kernel/boot';
import { useActiveSocialChatSlice } from '../components/chat/useActiveSocialChatStore';
import { NARROW_MEDIA_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { currentAuthenticatedActorPtid } from '../store/session';
import { log } from '../utils/logger';
import { readFeatureFlags } from '../modules/settings/featureFlags';
import { callP2p } from '../modules/p2p/callP2p';

type ChatSubPage = ChatRailTab;

interface OwnedContactSelection {
  actorPtid: string;
  contact: ContactSelection;
}

// Page contract:
//   • All projection state (sessions, groups, friend requests, conversation
//     previews, unread counts, current user profile, encryption keys) is
//     OWNED by `runtimes/socialRuntime.ts` (which adapts
//     `services/socialRealtime.ts`). This page is a pure renderer over
//     that store.
//   • The only page-bound side-effects are P2P transport subscriptions
//     (which depend on the active session/peer in this view) and the
//     opt-in crypto telemetry tick. Both are explicitly view-bound, so
//     they live here rather than in the runtime.
//   • Mount-time data fetches are forbidden — see
//     docs/client/desktop/runtime-projections.md.

export function SocialChatPage() {
  const {
    showDetail,
    openThreadRootUlid,
    setFriendP2pStatus,
    conversationMembers,
    activeSessionUlid,
    activeTab,
    currentUserPtid,
    getIMConversations,
    loadSessions,
    restoreConversation,
    selectGroup,
    selectSession,
  } = useActiveSocialChatSlice((state) => ({
    showDetail: state.showDetail,
    openThreadRootUlid: state.openThreadRootUlid,
    setFriendP2pStatus: state.setFriendP2pStatus,
    conversationMembers: state.conversationMembers,
    activeSessionUlid: state.activeSessionUlid,
    activeTab: state.activeTab,
    currentUserPtid: state.currentUserPtid,
    getIMConversations: state.getIMConversations,
    loadSessions: state.loadSessions,
    restoreConversation: state.restoreConversation,
    selectGroup: state.selectGroup,
    selectSession: state.selectSession,
  }));

  // --- Refs for values used inside effects without re-triggering subscriptions ---
  const activeSessionRef = useRef(activeSessionUlid);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeSessionRef.current = activeSessionUlid;
    activeTabRef.current = activeTab;
  }, [activeSessionUlid, activeTab]);

  // --- Stabilize activePeerDid: only propagate when the actual string value changes ---
  const activePeerDid = useMemo(() => {
    if (activeTab !== 'friend' || !activeSessionUlid || !currentUserPtid) return null;
    const members = conversationMembers[activeSessionUlid] ?? [];
    return members.find((member) => member.ptid && member.ptid !== currentUserPtid)?.ptid ?? null;
  }, [activeTab, activeSessionUlid, conversationMembers, currentUserPtid]);

  const activePeerDidRef = useRef(activePeerDid);
  useEffect(() => {
    activePeerDidRef.current = activePeerDid;
  }, [activePeerDid]);

  const [subPage, setSubPage] = useState<ChatSubPage>('chats');
  const [ownedContactSelection, setOwnedContactSelection] = useState<OwnedContactSelection | null>(null);
  const [directOpenIntent, setDirectOpenIntent] = useState<DirectConversationOpenIntent | null>(null);
  const directOpenGenerationRef = useRef(0);
  const contactOwnerPtid = currentUserPtid
    || currentAuthenticatedActorPtid()
    || '';
  const selectedContact = ownedContactSelection?.actorPtid === contactOwnerPtid
    ? ownedContactSelection.contact
    : null;

  const cancelDirectOpenIntent = useCallback(() => {
    directOpenGenerationRef.current += 1;
    setDirectOpenIntent(null);
  }, []);

  // Narrow single-pane navigation (WeChat-style push): below 720px the catalog
  // rail owns the stage until a conversation opens; the conversation slides in
  // from the right and the header back control pops it back out. The motion is
  // CSS-driven via data-narrow-open (transform/visibility), this state only
  // decides whether the conversation layer is active.
  const isNarrow = useMediaQuery(NARROW_MEDIA_QUERY);
  const narrowOpen = isNarrow && (!!activeSessionUlid || !!directOpenIntent);
  const backToCatalog = useCallback(() => {
    cancelDirectOpenIntent();
    selectSession('');
  }, [cancelDirectOpenIntent, selectSession]);

  // Manually resizable catalog rail (wide surfaces only). The numeric width
  // feeds a CSS custom property; the rail's width declaration stays in
  // chat.css so the 720px media query can still override it. Drag previews
  // update state only, pointer drop / keyboard actions commit to localStorage.
  const [railWidth, setRailWidth] = useState<number>(() =>
    readStoredChatRailWidth(window.localStorage));
  const previewRailWidth = useCallback(
    (next: number) => setRailWidth(clampChatRailWidth(next)),
    [],
  );
  const commitRailWidth = useCallback((next: number) => {
    setRailWidth(persistChatRailWidth(next, window.localStorage));
  }, []);
  const resetRailWidth = useCallback(() => {
    setRailWidth(
      persistChatRailWidth(CHAT_RAIL_DEFAULT_WIDTH, window.localStorage),
    );
  }, []);

  const openDirectConversation = useCallback((contact: FriendContactSelection) => {
    const requestGeneration = ++directOpenGenerationRef.current;
    const existing = findContactConversation(contact, getIMConversations());
    if (existing) {
      setDirectOpenIntent(null);
      selectSession(existing.id);
      restoreConversation('friend', existing.id);
      setSubPage('chats');
      return;
    }

    const intent = beginDirectConversationOpen(contact);
    setDirectOpenIntent(intent);
    selectSession('');
    setSubPage('chats');

    void imServiceV1.messaging.createDirect({
      peerPtid: contact.peerPtid,
    }).then((conversation) => {
      if (directOpenGenerationRef.current !== requestGeneration) return;
      selectSession(conversation.conversationId);
      restoreConversation('friend', conversation.conversationId);
      setDirectOpenIntent(null);
      loadSessions().catch((error) => {
        log.warn('socialChatPage', 'background loadSessions after createDirect failed', {
          conversationId: conversation.conversationId,
          error,
        });
      });
    }).catch((error) => {
      if (directOpenGenerationRef.current !== requestGeneration) return;
      // Floating toast only: the peer-bound pane stays open instead of being
      // replaced by an inline error block. Re-selecting the contact retries.
      const presentation = presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
      setDirectOpenIntent((current) => (
        current?.peerPtid === contact.peerPtid
          ? failDirectConversationOpen(current, presentation)
          : current
      ));
    });
  }, [
    getIMConversations,
    loadSessions,
    restoreConversation,
    selectSession,
  ]);

  const handleContactMessage = useCallback((contact: ContactSelection) => {
    if (contact.kind === 'group') {
      cancelDirectOpenIntent();
      selectGroup(contact.conversationId);
      restoreConversation('group', contact.conversationId);
      setSubPage('chats');
      return;
    }
    if (contact.kind === 'person') return;
    openDirectConversation(contact);
  }, [
    cancelDirectOpenIntent,
    openDirectConversation,
    restoreConversation,
    selectGroup,
  ]);

  // Lazy-mount contacts panel: only create on first visit, then keep
  // alive. Pre-warm during the first idle window so the contacts tab
  // click is a pure visibility flip rather than a full subtree mount.
  // (The kernel `scheduleIdle` falls back to setTimeout in WebViews
  // without `requestIdleCallback`.)
  const [contactsMounted, setContactsMounted] = useState(false);
  useEffect(() => {
    if (contactsMounted) return;
    return scheduleIdle(() => setContactsMounted(true));
  }, [contactsMounted]);

  useEffect(() => {
    if (!readFeatureFlags().cryptoDrTelemetryEnabled) return;
    let cancelled = false;
    const tick = () =>
      api.cryptoRatchetTelemetrySnapshot().then((s) => {
        if (!cancelled) log.info('crypto', 'ratchet decrypt counts', s);
      }).catch(() => undefined);
    tick();
    const h = window.setInterval(tick, 24 * 60 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, []);

  // --- P2P event registration: only re-subscribe when currentUserPtid changes ---
  useEffect(() => {
    if (!currentUserPtid) return;

    // P2P here only carries transport status (so the UI can show
    // "P2P direct / via relay / SSE-only"). The text data plane is
    // consumed by the app-level social realtime bridge.
    callP2p.setOnStatus((_myDid, peerPtid, status) => {
      const sid = activeSessionRef.current;
      if (!sid || activeTabRef.current !== 'friend') return;
      if (activePeerDidRef.current !== peerPtid) return;
      setFriendP2pStatus(sid, status.state, status.detail, status.transport);
    });

    callP2p.ensurePeerRegistered(currentUserPtid).catch(() => {});
    return () => {
      callP2p.setOnStatus(null);
    };
  }, [currentUserPtid, setFriendP2pStatus]);

  // --- P2P connection: stabilized deps prevent close/reconnect cycles ---
  useEffect(() => {
    const sid = activeSessionRef.current;
    if (!currentUserPtid || !activePeerDid || !sid) return;
    setFriendP2pStatus(sid, 'connecting');
    callP2p.ensureConnected(currentUserPtid, activePeerDid).catch((error) => {
      const currentSid = activeSessionRef.current;
      if (currentSid) {
        setFriendP2pStatus(currentSid, 'failed', error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      // Conversation switch: recycle only idle transport-readiness
      // connections. A ringing / active call must survive navigation
      // (peer B can call while the user reads peer C) — see
      // docs/architecture/domains/chat/calling/voice-video.md §7. Full
      // teardown belongs to the dedicated page-unmount effect below.
      callP2p.closeIdleConnections();
    };
  }, [currentUserPtid, activePeerDid, setFriendP2pStatus]);

  // --- Page unmount: full teardown of every connection and any live call ---
  useEffect(() => {
    return () => {
      callP2p.closeAll();
    };
  }, []);

  return (
    <div
      className="sc-chat"
      data-social-chat-layout
      data-narrow={isNarrow ? 'true' : 'false'}
      data-narrow-open={narrowOpen ? 'true' : 'false'}
      data-chat-active-peer-ptid={activePeerDid ?? ''}
      data-chat-side-panel-open={openThreadRootUlid || showDetail ? 'true' : 'false'}
      style={{ '--pt-chat-rail-width': `${railWidth}px` } as React.CSSProperties}
    >
      {/* Unified 300px rail: Segmented 消息/联系人 header lives inside
          ChatSessionList; contacts render in the same rail and open
          conversations directly. */}
      <ChatSessionList
        onConversationSelected={cancelDirectOpenIntent}
        onOpenDirect={openDirectConversation}
        tab={subPage}
        onTabChange={(next) => {
          if (next === 'contacts') setContactsMounted(true);
          setSubPage(next);
        }}
        renderContacts={(query) => (contactsMounted || subPage === 'contacts') ? (
          <ChatContactsPanel
            embedded
            query={query}
            selectedContact={selectedContact}
            onSelectContact={(contact) => {
              setOwnedContactSelection({ actorPtid: contactOwnerPtid, contact });
            }}
            onStartChat={(contact) => {
              setOwnedContactSelection({ actorPtid: contactOwnerPtid, contact });
              handleContactMessage(contact);
            }}
          />
        ) : null}
      />

      {/* The conversation stage is always present; selecting a contact flips
          the rail back to 消息 and opens the conversation here. */}
      {!isNarrow && (
        <ChatRailResizer
          width={railWidth}
          onPreview={previewRailWidth}
          onCommit={commitRailWidth}
          onReset={resetRailWidth}
        />
      )}
      <AttachmentDetailHost />
      <ChatMessageArea
        directOpenIntent={directOpenIntent}
        narrow={isNarrow}
        onNarrowBack={backToCatalog}
      />
      {openThreadRootUlid ? <ChatThreadPanel /> : showDetail && <ChatDetailPanel />}

      {/* Voice / video call surface — page-level so a ringing call
          stays visible regardless of which conversation is open. */}
      <CallSurface />
      <GroupCallSurface />
    </div>
  );
}
