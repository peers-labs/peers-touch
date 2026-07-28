import { useEffect, useRef, useState } from 'react';
import { T } from '../theme';
import { SessionList } from '../components/SessionList';
import { ChatArea } from '../components/ChatArea';
import { DetailPanel } from '../components/DetailPanel';
import { FindPeopleModal } from '../components/FindPeopleModal';
import { useChatState } from '../state';

export function SocialChatPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootWidth, setRootWidth] = useState(0);
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
  } = useChatState();

  const [findPeopleOpen, setFindPeopleOpen] = useState(false);

  useEffect(() => {
    if (!rootRef.current) return undefined;
    const update = () => setRootWidth(rootRef.current?.clientWidth ?? 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  const compact = rootWidth > 0 && rootWidth < T.sessionListWidth + T.chatReadableMinWidth;
  const listOnly = rootWidth > 0 && rootWidth < T.chatSplitMinWidth;

  return (
    <div ref={rootRef} style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0, overflow: 'hidden', background: T.bg }}>
      <SessionList
        conversations={conversations}
        activeId={activeId}
        compact={compact}
        fill={listOnly}
        onSelect={selectConversation}
        onTogglePin={togglePin}
        onToggleMute={toggleMute}
        onMarkAsRead={markAsRead}
        onHide={hideConversation}
        onDelete={deleteConversation}
        onFindPeople={() => setFindPeopleOpen(true)}
      />
      {listOnly && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 0,
            overflow: 'hidden',
          }}
        />
      )}
      {!listOnly && (
      <ChatArea
        conversation={activeConversation}
        messages={messages}
        onToggleDetail={toggleDetail}
        onSendMessage={sendMessage}
        onRestoreHistory={restoreConversationHistory}
        compact={compact}
      />
      )}
      {!compact && showDetail && activeConversation && (
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
      )}
      <FindPeopleModal open={findPeopleOpen} onClose={() => setFindPeopleOpen(false)} />
    </div>
  );
}
