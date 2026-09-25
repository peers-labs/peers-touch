import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { messagingCommands } from '../messaging/runtime';
import { scheduleIdle } from '../kernel/boot';
import { useActiveSocialChatSlice } from '../components/chat/useActiveSocialChatStore';
import { currentAuthenticatedActorPtid } from '../store/session';
import { log } from '../utils/logger';
import { readFeatureFlags } from '../modules/settings/featureFlags';
import { callP2p } from '../modules/p2p/callP2p';

type ChatSubPage = 'chats' | 'contacts';

interface OwnedContactSelection {
  actorPtid: string;
  contact: ContactSelection;
}

// #region debug-point A-C:cross-station-direct-open
function reportDirectOpenDebug(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('pt:direct-open-debug', { detail }));
}
// #endregion

// Page contract:
//   • Messaging projection state is owned by `runtimes/messagingRuntime.ts`;
//     friendship/profile/presence state is owned by `socialRuntime.ts`. This
//     page is a pure renderer over their typed projection store.
//   • The only page-bound side-effects are P2P transport subscriptions
//     (which depend on the active session/peer in this view) and the
//     opt-in crypto telemetry tick. Both are explicitly view-bound, so
//     they live here rather than in the runtime.
//   • Mount-time data fetches are forbidden — see
//     docs/client/desktop/runtime-projections.md.

export function SocialChatPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
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

    // #region debug-point C:cross-station-direct-open
    reportDirectOpenDebug({
      kind: 'create-direct-start',
      peerPtid: contact.peerPtid,
      federationId: contact.federationId,
    });
    // #endregion

    void messagingCommands.createDirect({
      peerPtid: contact.peerPtid,
      federationId: contact.federationId,
    }).then((conversation) => {
      if (directOpenGenerationRef.current !== requestGeneration) return;
      reportDirectOpenDebug({
        kind: 'create-direct-success',
        conversationId: conversation.conversationId,
      });
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
      reportDirectOpenDebug({
        kind: 'create-direct-failure',
        error: error instanceof Error ? error.message : String(error),
      });
      const presentation = presentError(error, {
        mode: 'inline',
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
      // docs/architecture/realtime/voice-video-calls.md §7. Full
      // teardown belongs to the dedicated page-unmount effect below.
      callP2p.closeIdleConnections();
    };
  }, [currentUserPtid, activePeerDid, setFriendP2pStatus]);

  const subNavItems: { key: ChatSubPage; icon: typeof MessageCircle; label: string }[] = [
    { key: 'chats', icon: MessageCircle, label: t('chat.social.subNav.chats') },
    { key: 'contacts', icon: Contact, label: t('chat.social.subNav.contacts') },
  ];

  return (
    <Flexbox
      data-social-chat-layout
      data-chat-active-peer-ptid={activePeerDid ?? ''}
      data-chat-side-panel-open={openThreadRootUlid || showDetail ? 'true' : 'false'}
      horizontal
      style={{ height: '100%', minHeight: 0, width: '100%', overflowX: 'auto', overflowY: 'hidden' }}
    >
      <style>
        {`
          @media (max-width: 960px) {
            [data-social-chat-layout][data-chat-side-panel-open='true'] {
              overflow-x: hidden !important;
            }
            [data-social-chat-layout][data-chat-side-panel-open='true']
              > [data-chat-conversation-list-shell] {
              display: none !important;
            }
            [data-social-chat-layout][data-chat-side-panel-open='true']
              > [data-chat-conversation-pane] {
              min-width: 0 !important;
            }
          }
        `}
      </style>
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
                data-chat-subpage={key}
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
      <div
        data-chat-conversation-list-shell
        style={{ display: subPage === 'chats' ? 'contents' : 'none' }}
      >
        <ChatSessionList
          onConversationSelected={cancelDirectOpenIntent}
          onOpenDirect={openDirectConversation}
        />
      </div>
      {contactsMounted && (
        <div style={{ display: subPage === 'contacts' ? 'contents' : 'none' }}>
          <ChatContactsPanel
            selectedContact={selectedContact}
            onSelectContact={(contact) => {
              setOwnedContactSelection({ actorPtid: contactOwnerPtid, contact });
            }}
            onStartChat={(contact) => {
              setOwnedContactSelection({ actorPtid: contactOwnerPtid, contact });
              handleContactMessage(contact);
            }}
          />
        </div>
      )}

      {/* Right area: the active sub-page owns its own content semantics. */}
      {subPage === 'chats' ? (
        <>
          <ChatMessageArea
            directOpenIntent={directOpenIntent}
            onRetryDirectOpen={() => {
              if (!directOpenIntent) return;
              openDirectConversation({
                kind: 'friend',
                peerPtid: directOpenIntent.peerPtid,
                federationId: directOpenIntent.federationId,
                federationName: directOpenIntent.federationName,
                displayName: directOpenIntent.displayName,
                avatar: directOpenIntent.avatar,
                username: directOpenIntent.username,
                federatedHandle: directOpenIntent.federatedHandle,
                homeStationDomain: directOpenIntent.homeStationDomain,
                homeStationPeerId: directOpenIntent.homeStationPeerId,
                homeStationName: directOpenIntent.homeStationName,
              });
            }}
          />
          {openThreadRootUlid ? <ChatThreadPanel /> : showDetail && <ChatDetailPanel />}
        </>
      ) : (
        <ChatContactsDetailPanel
          selectedContact={selectedContact}
          openingPeerPtid={
            directOpenIntent?.phase === 'creating'
              ? directOpenIntent.peerPtid
              : undefined
          }
          onMessage={handleContactMessage}
        />
      )}
    </Flexbox>
  );
}
