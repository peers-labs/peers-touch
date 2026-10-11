import { useEffect, useRef, useState } from 'react';
import { T } from '../theme';
import { SessionList } from '../components/SessionList';
import { ChatArea } from '../components/ChatArea';
import { DetailPanel } from '../components/DetailPanel';
import { FindPeopleModal } from '../components/FindPeopleModal';
import { ContactsBook } from '../components/ContactsBook';
import { SearchMessagesModal } from '../components/SearchMessagesModal';
import { useChatState } from '../state';
import { Contact, MessageCircle } from 'lucide-react';
import { USERS } from '../mock';

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

export function SocialChatPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootWidth, setRootWidth] = useState(0);
  const [activeTab, setActiveTab] = useState<SocialChatTab>('chat');
  const {
    conversations,
    activeId,
    activeConversation,
    messages,
    messagesByConversation,
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
    clearConversationData,
    setConversationBackgroundImage,
    sendMessage,
    sendAttachment,
    editMessage,
    retryMessage,
    renameGroup,
    removeGroupMember,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
    createFriendConversation,
    createGroupConversation,
  } = useChatState();

  const [findPeopleOpen, setFindPeopleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchConversationId, setSearchConversationId] = useState<string | undefined>(undefined);
  const [pendingJumpMessageId, setPendingJumpMessageId] = useState<string | null>(null);

  const senderName = (senderId: string): string =>
    senderId === 'system'
      ? 'System'
      : (USERS[senderId]?.name ?? senderId);

  const openMessageSearch = (conversationId?: string) => {
    setSearchConversationId(conversationId);
    setSearchOpen(true);
  };

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
        <ContactsBook
          onOpenConversation={(conversationId) => {
            selectConversation(conversationId);
            setActiveTab('chat');
          }}
          onStartChatWithPerson={(name, peerId) => {
            createFriendConversation(name, peerId);
            setActiveTab('chat');
          }}
        />
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
          onFindPeople={() => setFindPeopleOpen(true)}
        />
      )}
        <ChatArea
          conversation={activeConversation}
          messages={messages}
          conversations={conversations}
          onToggleDetail={toggleDetail}
          onSendMessage={sendMessage}
          onSendAttachment={sendAttachment}
          onRetryMessage={retryMessage}
          onEditMessage={editMessage}
          externalJumpMessageId={pendingJumpMessageId}
          onJumpConsumed={() => setPendingJumpMessageId(null)}
          backgroundImageUrl={activeConversation?.backgroundImage}
          compact={compact}
        />
      {showDetail && activeConversation && (
        compact ? (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 336, maxWidth: 'calc(100% - 48px)', zIndex: 25, boxShadow: '-16px 0 40px rgba(15,23,42,0.12)' }}>
            <DetailPanel
              conversation={activeConversation}
              currentUserId={currentUserId}
              groupMembers={groupMembers}
              messages={messages}
              onClose={toggleDetail}
              onDeleteConversation={deleteConversation}
              onClearHistory={clearConversationData}
              onSelectBackgroundImage={setConversationBackgroundImage}
              onRemoveMember={removeGroupMember}
              onRenameGroup={renameGroup}
              onSetMemberRole={setMemberRole}
              onToggleMemberMute={toggleMemberMute}
              onTransferOwnership={transferOwnership}
              onSearchMessages={() => openMessageSearch(activeConversation.id)}
            />
          </div>
        ) : (
          <DetailPanel
            conversation={activeConversation}
            currentUserId={currentUserId}
            groupMembers={groupMembers}
            messages={messages}
            onClose={toggleDetail}
            onDeleteConversation={deleteConversation}
            onClearHistory={clearConversationData}
            onSelectBackgroundImage={setConversationBackgroundImage}
            onRemoveMember={removeGroupMember}
            onRenameGroup={renameGroup}
            onSetMemberRole={setMemberRole}
            onToggleMemberMute={toggleMemberMute}
            onTransferOwnership={transferOwnership}
            onSearchMessages={() => openMessageSearch(activeConversation.id)}
          />
        )
      )}
        </>
      )}
      <FindPeopleModal open={findPeopleOpen} onClose={() => setFindPeopleOpen(false)} />
      <SearchMessagesModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        conversations={conversations}
        messagesByConversation={messagesByConversation}
        senderName={senderName}
        conversationId={searchConversationId}
        onJump={(conversationId, messageId) => {
          selectConversation(conversationId);
          setPendingJumpMessageId(messageId);
          setSearchOpen(false);
        }}
      />
    </div>
  );
}
