import { useEffect, useRef, useState } from 'react';
import { T } from '../theme';
import { SessionList } from '../components/SessionList';
import { ChatArea } from '../components/ChatArea';
import { DetailPanel } from '../components/DetailPanel';
import { useChatState } from '../state';
import { Contact, MessageCircle } from 'lucide-react';

type SocialChatTab = 'chat' | 'contacts';

function ChatRail({ activeTab, onSelect }: { activeTab: SocialChatTab; onSelect: (tab: SocialChatTab) => void }) {
  const items = [
    { id: 'chat' as const, title: 'Chat', icon: MessageCircle },
    { id: 'contacts' as const, title: 'Contacts', icon: Contact },
  ];

  return (
    <div
      style={{
        width: 48,
        minWidth: 48,
        height: '100%',
        paddingTop: T.space3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: T.space1,
        borderRight: `1px solid ${T.border}`,
        background: T.bg,
      }}
    >
      {items.map(({ id, title, icon: Icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={active}
            onClick={() => onSelect(id)}
            style={{
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: T.radiusMd,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: active ? T.primary : T.textTertiary,
              background: active ? 'rgba(107,91,214,0.1)' : 'transparent',
            }}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
          </button>
        );
      })}
    </div>
  );
}

function ContactsPane() {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: T.bg,
        color: T.textTertiary,
      }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
        <div style={{ fontSize: T.fontHeading, color: T.text, fontWeight: 800, marginBottom: T.space2 }}>Contacts</div>
        <div style={{ fontSize: T.fontSm }}>
          Contacts is the sibling tab of Chat in this surface. It stays in the Chat module rail instead of becoming a Desktop Shell route.
        </div>
      </div>
    </div>
  );
}

export function SocialChatPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootWidth, setRootWidth] = useState(0);
  const [activeTab, setActiveTab] = useState<SocialChatTab>('chat');
  const {
    conversations,
    activeId,
    activeConversation,
    messages,
    currentUserId,
    groupMembers,
    showDetail,
    selectConversation,
    toggleDetail,
    togglePin,
    toggleMute,
    markAsRead,
    hideConversation,
    deleteConversation,
    clearConversationHistory,
    restoreConversationHistory,
    sendMessage,
    renameGroup,
    removeGroupMember,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
    createFriendConversation,
    createGroupConversation,
  } = useChatState();

  useEffect(() => {
    if (!rootRef.current) return undefined;
    const update = () => setRootWidth(rootRef.current?.clientWidth ?? 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  const compact = rootWidth > 0 && rootWidth < 780;
  const conversationOnly = rootWidth > 0 && rootWidth < 400;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', minWidth: 0, overflow: 'hidden', background: T.bg }}>
      <ChatRail activeTab={activeTab} onSelect={setActiveTab} />
      {activeTab === 'contacts' ? (
        <ContactsPane />
      ) : (
        <>
      {!conversationOnly && (
        <SessionList
          conversations={conversations}
          activeId={activeId}
          compact={compact}
          fill={false}
          onSelect={selectConversation}
          onTogglePin={togglePin}
          onToggleMute={toggleMute}
          onMarkAsRead={markAsRead}
          onHide={hideConversation}
          onDelete={deleteConversation}
          onCreateFriend={createFriendConversation}
          onCreateGroup={createGroupConversation}
        />
      )}
        <ChatArea
          conversation={activeConversation}
          messages={messages}
          onToggleDetail={toggleDetail}
          onSendMessage={sendMessage}
          onRestoreHistory={restoreConversationHistory}
          compact={compact}
        />
      {showDetail && activeConversation && (
        compact ? (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 336, maxWidth: 'calc(100% - 48px)', zIndex: 25, boxShadow: '-16px 0 40px rgba(15,23,42,0.12)' }}>
            <DetailPanel
              conversation={activeConversation}
              currentUserId={currentUserId}
              groupMembers={groupMembers}
              onClose={toggleDetail}
              onDeleteConversation={deleteConversation}
              onClearHistory={clearConversationHistory}
              onRestoreHistory={restoreConversationHistory}
              onRemoveMember={removeGroupMember}
              onRenameGroup={renameGroup}
              onSetMemberRole={setMemberRole}
              onToggleMemberMute={toggleMemberMute}
              onTransferOwnership={transferOwnership}
            />
          </div>
        ) : (
          <DetailPanel
            conversation={activeConversation}
            currentUserId={currentUserId}
            groupMembers={groupMembers}
            onClose={toggleDetail}
            onDeleteConversation={deleteConversation}
            onClearHistory={clearConversationHistory}
            onRestoreHistory={restoreConversationHistory}
            onRemoveMember={removeGroupMember}
            onRenameGroup={renameGroup}
            onSetMemberRole={setMemberRole}
            onToggleMemberMute={toggleMemberMute}
            onTransferOwnership={transferOwnership}
          />
        )
      )}
        </>
      )}
    </div>
  );
}
