import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Empty, Icon, useDrawerAssembly } from '@peers-touch/ui';
import { ChatSessionList, type ChatRailTab } from '../components/chat/ChatSessionList';
import { ChatContactsPanel } from '../components/chat/ChatContactsPanel';
import { ChatMessageArea } from '../components/chat/ChatMessageArea';
import { ChatRailResizer } from '../components/chat/ChatRailResizer';
import {
  CHAT_RAIL_DEFAULT_WIDTH,
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
  const { t } = useTranslation('chat');
  const {
    showDetail,
    openThreadRootUlid,
    setFriendP2pStatus,
    conversationMembers,
    activeSessionUlid,
    activeGroupUlid,
    activeTab,
    currentUserPtid,
    getIMConversations,
    loadSessions,
    restoreConversation,
    selectGroup,
    selectSession,
    closeThread,
    setShowDetail,
  } = useActiveSocialChatSlice((state) => ({
    showDetail: state.showDetail,
    openThreadRootUlid: state.openThreadRootUlid,
    setFriendP2pStatus: state.setFriendP2pStatus,
    conversationMembers: state.conversationMembers,
    activeSessionUlid: state.activeSessionUlid,
    activeGroupUlid: state.activeGroupUlid,
    activeTab: state.activeTab,
    currentUserPtid: state.currentUserPtid,
    getIMConversations: state.getIMConversations,
    loadSessions: state.loadSessions,
    restoreConversation: state.restoreConversation,
    selectGroup: state.selectGroup,
    selectSession: state.selectSession,
    closeThread: state.closeThread,
    setShowDetail: state.setShowDetail,
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

  // Presentation owns geometry/navigation only. Runtime selection stays alive
  // on Back, so the same composer, attachments and reading position survive.
  const [initialRailWidth] = useState(() => readStoredChatRailWidth(window.localStorage));
  const assembly = useDrawerAssembly({
    initialPreference: initialRailWidth,
    onPreferenceCommit: (width) => { persistChatRailWidth(width, window.localStorage); },
  });
  const { pose } = assembly;
  const selectedObject = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const taskIdentity = selectedObject ? `${activeTab}:${selectedObject}` : directOpenIntent?.peerPtid ?? '';
  const previousTask = useRef('');
  useLayoutEffect(() => {
    if (previousTask.current === taskIdentity) return;
    previousTask.current = taskIdentity;
    if (taskIdentity) { assembly.dismissLeaf(); assembly.reveal(); }
    else assembly.retireTask();
  }, [taskIdentity]); // The controller reads its current guide poses.
  useLayoutEffect(() => {
    if (openThreadRootUlid) assembly.setLeaf({ kind: 'thread', messageId: openThreadRootUlid });
    else assembly.setLeaf(showDetail ? { kind: 'detail' } : null);
  }, [openThreadRootUlid, showDetail, assembly.navigation, taskIdentity]);
  const backToCatalog = () => {
    if (assembly.leaf) { closeThread(); setShowDetail(false); }
    assembly.back();
  };
  const resetRailWidth = () => {
    assembly.back();
    assembly.setCatalog(CHAT_RAIL_DEFAULT_WIDTH);
  };
  const compactRail = pose.catalogRowsCompact;

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
      ref={assembly.surface}
      className="sc-chat"
      data-social-chat-layout
      data-drawer-assembly="shared"
      data-compressed={pose.compressed}
      data-work-compact={pose.workToolsCompact}
      data-preferred-width={assembly.preferred}
      data-catalog-exposure={pose.exposure}
      data-navigation-progress={assembly.navigation}
      data-leaf-progress={assembly.leafProgress}
      data-chat-active-peer-ptid={activePeerDid ?? ''}
      data-chat-side-panel-open={openThreadRootUlid || showDetail ? 'true' : 'false'}
      style={{
        '--pt-chat-rail-width': `${pose.paper}px`,
        '--sc-catalog-visible': `${pose.visibleCatalog}px`,
        '--sc-catalog-exposure': `${pose.exposure}px`,
        '--sc-work-width': `${pose.workWidth}px`,
        '--sc-work-x': `${pose.mainX}px`,
        '--sc-leaf-width': `${pose.leafWidth}px`,
        '--sc-leaf-x': `${pose.leafX}px`,
        '--sc-composer-budget': `${pose.composerBudget}px`,
      } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && assembly.open) {
          event.preventDefault();
          backToCatalog();
        }
      }}
    >
      {/* Unified 300px rail: Segmented 消息/联系人 header lives inside
          ChatSessionList; contacts render in the same rail and open
          conversations directly. */}
      <div className="sc-catalog-guide" data-drawer-catalog data-drawn={pose.catalogInteractive}
        inert={!pose.catalogInteractive || !!assembly.leaf || assembly.leafProgress > 0 || (assembly.open && assembly.navigation < 1)}
        aria-hidden={!pose.catalogInteractive || !!assembly.leaf || assembly.leafProgress > 0 || (assembly.open && assembly.navigation < 1)}>
      <ChatSessionList
        compact={compactRail}
        onExpandRail={resetRailWidth}
        onConversationSelected={() => { cancelDirectOpenIntent(); assembly.reveal(); }}
        onOpenDirect={openDirectConversation}
        tab={subPage}
        onTabChange={(next) => {
          if (next === 'contacts') setContactsMounted(true);
          setSubPage(next);
        }}
        renderContacts={(query) => (contactsMounted || subPage === 'contacts') ? (
          <ChatContactsPanel
            embedded
            compact={compactRail}
            onExpandRail={resetRailWidth}
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
      </div>

      {/* The conversation stage is always present; selecting a contact flips
          the rail back to 消息 and opens the conversation here. */}
      <ChatRailResizer assembly={assembly} />
      <AttachmentDetailHost />
      <div className="sc-chat-work" data-drawer-work
        data-visible={assembly.open || assembly.navigation > 0}
        inert={!assembly.open || assembly.navigation < 1}
        aria-hidden={!assembly.open || assembly.navigation < 1}>
      <div className="sc-chat-work__body"
        inert={!!assembly.leaf || assembly.leafProgress > 0}
        aria-hidden={!!assembly.leaf || assembly.leafProgress > 0}>
      <ChatMessageArea
        directOpenIntent={directOpenIntent}
        compressed={pose.compressed}
        compactTools={pose.workToolsCompact}
        onBack={backToCatalog}
      />
      </div>
      <div className="sc-chat-leaf" data-visible={!!assembly.leaf || assembly.leafProgress > 0}
        inert={!assembly.leaf || assembly.leafProgress < 1}
        aria-hidden={!assembly.leaf || assembly.leafProgress < 1}>
        {assembly.leafContent?.kind === 'thread'
          ? <ChatThreadPanel rootUlid={assembly.leafContent.messageId} />
          : assembly.leafContent?.kind === 'detail' && <ChatDetailPanel />}
      </div>
      </div>
      {!assembly.open && assembly.navigation === 0 && (
        <div className="sc-chat-rest-placeholder" aria-hidden="true">
          <Empty icon={<Icon iconId="inbox" size={40} />}
            description={t('chat.social.messageArea.selectConversation')} />
        </div>
      )}

      {/* Voice / video call surface — page-level so a ringing call
          stays visible regardless of which conversation is open. */}
      <CallSurface />
      <GroupCallSurface />
    </div>
  );
}
