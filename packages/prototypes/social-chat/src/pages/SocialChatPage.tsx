import { T } from '../theme';
import { SessionList } from '../components/SessionList';
import { ChatArea } from '../components/ChatArea';
import { DetailPanel } from '../components/DetailPanel';
import { useChatState } from '../state';

export function SocialChatPage() {
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
    renameGroup,
    removeGroupMember,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
  } = useChatState();

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: T.bg }}>
      <SessionList
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onTogglePin={togglePin}
        onToggleMute={toggleMute}
        onMarkAsRead={markAsRead}
        onHide={hideConversation}
        onDelete={deleteConversation}
      />
      <ChatArea
        conversation={activeConversation}
        messages={messages}
        onToggleDetail={toggleDetail}
      />
      {showDetail && activeConversation && (
        <DetailPanel
          conversation={activeConversation}
          currentUserId={currentUserId}
          groupMembers={groupMembers}
          onClose={toggleDetail}
          onDeleteConversation={deleteConversation}
          onRemoveMember={removeGroupMember}
          onRenameGroup={renameGroup}
          onSetMemberRole={setMemberRole}
          onToggleMemberMute={toggleMemberMute}
          onTransferOwnership={transferOwnership}
        />
      )}
    </div>
  );
}
