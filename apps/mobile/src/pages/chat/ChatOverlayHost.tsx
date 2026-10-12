import { useState, type ReactNode } from 'react';
import { Alert, Button, Empty, Input, List, Modal, Spin, Switch, Tag, Typography } from 'antd';
import {
  Ban,
  Bell,
  Image,
  MessageSquare,
  Pencil,
  Pin,
  RotateCcw,
  Search,
  Trash2,
  Users,
  VolumeX,
  X,
  CornerUpLeft,
  EyeOff,
  Flag,
  Forward as ForwardIcon,
  ShieldX,
} from 'lucide-react';
import { CHAT_EMOJIS, isRecalledChatMessage } from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileAvatar } from '../../components/MobileAvatar';
import {
  CHAT_BACKGROUND_OPTIONS,
  type ChatBackgroundId,
  type FriendConversationSettings,
  type UpdateFriendConversationSettingsInput,
} from '../../features/social/socialApiTypes';
import type { ChatActionState } from '../../features/chat/chatActionState';
import {
  groupCommandOutcomeKey,
  isGroupCommandBusy,
  type GroupCommandOutcome,
  type GroupCommandOutcomes,
} from '../../features/chat/groupCommandState';
import type {
  SocialConversation,
  SocialMessage,
  PeerProfile,
} from '../../features/social/socialTypes';
import { MemberRole } from '../../gen/proto/domain/chat/conversation_pb';
import type {
  MessagingConversationProjection,
  MessagingMemberAuthorityMemberProjection,
} from '../../services/mobileCommands';
import {
  messageProjectionMetadata,
} from '../../features/chat/messageProjection';
import {
  isOwnChatMessage,
  messageDisplayText,
} from '../../features/chat/chatSelectors';
import type { ConversationSettingsFeedback } from './conversationSettingsState';

const { Text } = Typography;

export function ChatOverlayHost({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}

export function MessageActionSheet({
  message,
  currentUserPtid,
  canEdit,
  commandBusy,
  onClose,
  onReply,
  onForward,
  onOpenThread,
  onToggleReaction,
  onTogglePin,
  flagged,
  flagLabel,
  flagLoading,
  onToggleFlag,
  onEdit,
  onRecall,
  onHideForMe,
  canModerate,
  onModerate,
}: {
  readonly message: SocialMessage | undefined;
  readonly currentUserPtid: string | null;
  readonly canEdit: boolean;
  readonly commandBusy: boolean;
  readonly onClose: () => void;
  readonly onReply: () => void;
  readonly onForward: () => void;
  readonly onOpenThread: () => void;
  readonly onToggleReaction: (reaction: string) => void;
  readonly onTogglePin: () => void;
  readonly flagged: boolean;
  readonly flagLabel: string;
  readonly flagLoading: boolean;
  readonly onToggleFlag: () => void;
  readonly onEdit: () => void;
  readonly onRecall: () => void;
  readonly onHideForMe: () => void;
  readonly canModerate: boolean;
  readonly onModerate: () => void;
}) {
  const { t } = useMobileI18n();
  if (!message) return null;
  const metadata = messageProjectionMetadata(message);
  const mine = isOwnChatMessage(message, currentUserPtid);
  const recalled = isRecalledChatMessage(message);
  const unavailable = recalled || metadata.moderated;

  return (
    <div
      className="chat-action-sheet-shell message-action-sheet-shell"
      data-product-surface="chat.message-actions"
    >
      <button className="chat-action-sheet-backdrop" type="button" aria-label={t('common.action.close')} onClick={onClose} />
      <aside className="chat-action-sheet message-action-sheet" role="dialog" aria-modal="true" aria-labelledby="message-action-sheet-title">
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="message-action-sheet-title">{t('mobile.chat.messageActions')}</Text>
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="chat-action-list">
          <div className="chat-background-section message-action-reactions">
            <Text type="secondary" className="chat-background-title">{t('mobile.chat.addReaction')}</Text>
            <div className="chat-background-grid">
              {CHAT_EMOJIS.map((reaction) => {
                const active = metadata.reactions.some(
                  (item) => item.actorPtid === currentUserPtid && item.reaction === reaction,
                );
                return (
                  <button
                    key={reaction}
                    type="button"
                    className={`chat-background-choice message-reaction-choice ${active ? 'active' : ''}`}
                    aria-label={t('mobile.chat.reactWith', { reaction })}
                    aria-pressed={active}
                    disabled={commandBusy}
                    onClick={() => onToggleReaction(reaction)}
                  >
                    <span>{reaction}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="chat-action-group">
            <ChatActionButton icon={<CornerUpLeft size={18} />} title={t('mobile.chat.reply')} onClick={onReply} />
            <ChatActionButton icon={<ForwardIcon size={18} />} title={t('mobile.chat.forward')} disabled={commandBusy || unavailable} onClick={onForward} />
            <ChatActionButton icon={<MessageSquare size={18} />} title={t('mobile.chat.thread')} onClick={onOpenThread} />
            <ChatActionButton
              icon={<Pin size={18} />}
              title={t(metadata.pinnedByPtid ? 'mobile.chat.unpinMessage' : 'mobile.chat.pinMessage')}
              active={Boolean(metadata.pinnedByPtid)}
              disabled={commandBusy}
              onClick={onTogglePin}
            />
            <ChatActionButton
              icon={<Flag size={18} />}
              title={flagLabel}
              active={flagged}
              disabled={flagLoading}
              onClick={onToggleFlag}
            />
          </div>
          {mine && !unavailable ? (
            <div className="chat-action-group">
              {canEdit ? <ChatActionButton icon={<Pencil size={18} />} title={t('mobile.chat.edit')} disabled={commandBusy} onClick={onEdit} /> : null}
              <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.chat.recall')} disabled={commandBusy} onClick={onRecall} />
            </div>
          ) : null}
          {!unavailable ? (
            <div className="chat-action-group">
              {canModerate ? (
                <ChatActionButton icon={<ShieldX size={18} />} title={t('mobile.chat.moderate')} disabled={commandBusy} onClick={onModerate} danger />
              ) : null}
              <ChatActionButton icon={<EyeOff size={18} />} title={t('mobile.chat.deleteForMe')} disabled={commandBusy} onClick={onHideForMe} danger />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export interface MessageForwardDestination {
  readonly key: string;
  readonly conversationId: string;
  readonly kind: 'friend' | 'group';
  readonly title: string;
  readonly subtitle: string;
  readonly avatar: string;
}

export function PinnedMessagesSheet({
  open,
  messages,
  resolveSenderName,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly messages: readonly SocialMessage[];
  readonly resolveSenderName: (message: SocialMessage) => string;
  readonly onClose: () => void;
  readonly onSelect: (message: SocialMessage) => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;
  return (
    <div
      className="chat-action-sheet-shell"
      data-product-surface="chat.pinned-messages"
    >
      <button
        className="chat-action-sheet-backdrop"
        type="button"
        aria-label={t('common.action.close')}
        onClick={onClose}
      />
      <aside
        className="chat-action-sheet pinned-messages-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-messages-sheet-title"
      >
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="pinned-messages-sheet-title">
            {t('mobile.chat.pinnedMessages')}
          </Text>
          <button
            className="header-action"
            type="button"
            aria-label={t('common.action.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {messages.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('mobile.chat.noPinnedMessages')}
          />
        ) : (
          <BoundedList
            surfaceKey="pinned-messages"
            items={messages}
            itemKey={(message) => message.ulid}
            size={100}
          >
            {(rows) => (
              <div className="pinned-message-list">
                {rows.map((message) => (
                  <button
                    key={message.ulid}
                    type="button"
                    className="pinned-message-item"
                    onClick={() => onSelect(message)}
                  >
                    <span className="pinned-message-sender">
                      {resolveSenderName(message)}
                    </span>
                    <span className="pinned-message-preview">
                      {messageDisplayText(message, t)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </BoundedList>
        )}
      </aside>
    </div>
  );
}

export function ForwardMessageSheet({
  open,
  destinations,
  pendingDestinationId,
  error = '',
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly destinations: readonly MessageForwardDestination[];
  readonly pendingDestinationId: string;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSelect: (destination: MessageForwardDestination) => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;
  const productSurface = pendingDestinationId
    ? 'chat.forward-pending'
    : error
      ? 'chat.forward-failed'
      : 'chat.forward-picker';
  return (
    <div
      className="chat-action-sheet-shell"
      data-product-surface={productSurface}
    >
      <button className="chat-action-sheet-backdrop" type="button" aria-label={t('common.action.close')} onClick={onClose} />
      <aside className="chat-action-sheet" role="dialog" aria-modal="true" aria-labelledby="message-forward-sheet-title">
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="message-forward-sheet-title">{t('mobile.chat.forwardTitle')}</Text>
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="chat-action-list">
          {error ? <Alert type="error" showIcon title={error} /> : null}
          {destinations.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.forwardEmpty')} />
          ) : (
            <BoundedList
              surfaceKey="message-forward-destinations"
              items={destinations}
              itemKey={(destination) => destination.key}
              size={100}
            >
              {(rows) => (
                <List
                  dataSource={rows}
                  rowKey={(destination) => destination.key}
                  renderItem={(destination) => (
                    <List.Item
                      className="conversation-item"
                      actions={[
                        <Button
                          key="forward"
                          type="text"
                          icon={pendingDestinationId === destination.conversationId ? <Spin size="small" /> : <ForwardIcon size={17} />}
                          aria-label={t('mobile.chat.forwardTo', { destination: destination.title })}
                          disabled={Boolean(pendingDestinationId)}
                          onClick={() => onSelect(destination)}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={destination.title}
                        description={destination.subtitle}
                        avatar={(
                          <MobileAvatar
                            identityKey={destination.key}
                            identityRole={destination.kind === 'group'
                              ? 'group'
                              : 'person'}
                            name={destination.title}
                            size={48}
                            src={destination.avatar}
                          >
                            {destination.title.slice(0, 1).toUpperCase()}
                          </MobileAvatar>
                        )}
                      />
                    </List.Item>
                  )}
                />
              )}
            </BoundedList>
          )}
        </div>
      </aside>
    </div>
  );
}

export function ChatActionSheet({
  open,
  state,
  onClose,
  onSearch,
  onToggleMute,
  onToggleSticky,
  onToggleAlert,
  onSelectBackground,
  onClearHistory,
  isFriendThread,
  onManageGroup,
  peerBlocked,
  onBlockPeer,
  onUnblockPeer,
  settingsFeedback,
  onRetrySettings,
}: {
  readonly open: boolean;
  readonly state: ChatActionState;
  readonly onClose: () => void;
  readonly onSearch: () => void;
  readonly onToggleMute: () => void;
  readonly onToggleSticky: () => void;
  readonly onToggleAlert: () => void;
  readonly onSelectBackground: (background: ChatBackgroundId) => void;
  readonly onClearHistory: () => void;
  readonly isFriendThread: boolean;
  readonly onManageGroup?: () => void;
  readonly peerBlocked: boolean;
  readonly onBlockPeer: () => void;
  readonly onUnblockPeer: () => void;
  readonly settingsFeedback: ConversationSettingsFeedback;
  readonly onRetrySettings: () => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;
  const settingsBusy = settingsFeedback.phase === 'pending'
    || settingsFeedback.phase === 'retrying';
  const productSurface = settingsFeedback.phase === 'pending'
    || settingsFeedback.phase === 'retrying'
    ? 'chat.conversation-settings-pending'
    : settingsFeedback.phase === 'committed'
      ? 'chat.conversation-settings-saved'
      : settingsFeedback.phase === 'failed'
        ? 'chat.conversation-settings-failed'
        : 'chat.conversation-actions';

  return (
    <div
      className="chat-action-sheet-shell"
      data-product-surface={productSurface}
    >
      <button className="chat-action-sheet-backdrop" type="button" aria-label={t('common.action.close')} onClick={onClose} />
      <aside className="chat-action-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-action-sheet-title">
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="chat-action-sheet-title">{t('mobile.chat.moreActions')}</Text>
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="chat-action-list">
          <ConversationSettingsFeedbackNotice
            feedback={settingsFeedback}
            onRetry={onRetrySettings}
          />
          <div className="chat-action-group">
            <ChatActionButton icon={<Search size={18} />} title={t('mobile.chat.quickSearch')} onClick={onSearch} />
            <ChatActionButton icon={<VolumeX size={18} />} title={t('mobile.chat.quickMute')} active={state.muted} disabled={settingsBusy} onClick={onToggleMute} />
            <ChatActionButton icon={<Pin size={18} />} title={t('mobile.chat.quickSticky')} active={state.sticky} disabled={settingsBusy} onClick={onToggleSticky} />
            <ChatActionButton icon={<Bell size={18} />} title={t('mobile.chat.quickAlert')} active={state.alertEnabled} disabled={settingsBusy} onClick={onToggleAlert} />
          </div>
          <div className="chat-background-section">
            <Text type="secondary" className="chat-background-title">{t('mobile.chat.quickBackground')}</Text>
            <div className="chat-background-grid">
              {CHAT_BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`chat-background-choice chat-background-${option} ${state.background === option ? 'active' : ''}`}
                  type="button"
                  disabled={settingsBusy}
                  onClick={() => onSelectBackground(option)}
                >
                  <Image size={14} />
                  <span>{t(`mobile.chat.background.${option}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="chat-action-group">
            {onManageGroup ? <ChatActionButton icon={<Users size={18} />} title={t('mobile.group.members')} onClick={onManageGroup} /> : null}
          </div>
          <div className="chat-action-group danger">
            <ChatActionButton icon={<Trash2 size={18} />} title={t('mobile.chat.quickClearHistory')} danger disabled={settingsBusy} onClick={onClearHistory} />
            {isFriendThread ? (
              peerBlocked
                ? <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.contacts.unblock')} onClick={onUnblockPeer} />
                : <ChatActionButton icon={<Ban size={18} />} title={t('mobile.contacts.block')} danger onClick={onBlockPeer} />
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ChatDestructiveConfirmSheet({
  open,
  busy = false,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;

  return (
    <div
      className="chat-action-sheet-shell"
      data-product-surface="chat.destructive-confirm"
    >
      <button
        className="chat-action-sheet-backdrop"
        type="button"
        aria-label={t('common.action.close')}
        onClick={onCancel}
      />
      <aside
        className="chat-action-sheet chat-confirm-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-clear-confirm-title"
        aria-describedby="chat-clear-confirm-description"
      >
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-confirm-copy">
          <Text strong id="chat-clear-confirm-title">
            {t('mobile.chat.clearHistoryConfirmTitle')}
          </Text>
          <Text type="secondary" id="chat-clear-confirm-description">
            {t('mobile.chat.clearHistoryConfirmBody')}
          </Text>
        </div>
        <div className="chat-confirm-actions">
          <Button block disabled={busy} onClick={onCancel}>
            {t('common.action.cancel')}
          </Button>
          <Button block danger type="primary" loading={busy} onClick={onConfirm}>
            {t('mobile.chat.quickClearHistory')}
          </Button>
        </div>
      </aside>
    </div>
  );
}

interface GroupManagementModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly conversation: MessagingConversationProjection;
  readonly members: readonly MessagingMemberAuthorityMemberProjection[];
  readonly myRole: number;
  readonly canManage: boolean;
  readonly writeAdmissionOpen: boolean;
  readonly groupNameDraft: string;
  readonly setGroupNameDraft: (value: string) => void;
  readonly groupDescriptionDraft: string;
  readonly setGroupDescriptionDraft: (value: string) => void;
  readonly conversationSettings: FriendConversationSettings | undefined;
  readonly groupCommandOutcomes: GroupCommandOutcomes;
  readonly inviteCandidates: readonly SocialConversation[];
  readonly peerProfiles: Record<string, PeerProfile | null>;
  readonly currentUserPtid: string | null;
  readonly onSaveGroup: (name: string, description: string) => Promise<unknown>;
  readonly onUpdateMySettings: (
    patch: UpdateFriendConversationSettingsInput,
  ) => Promise<unknown> | void;
  readonly onUpdateMemberRole: (
    memberPtid: string,
    role: 'member' | 'admin',
  ) => Promise<unknown>;
  readonly onTransferOwnership: (memberPtid: string) => Promise<unknown>;
  readonly onToggleMemberMuted: (
    memberPtid: string,
    muted: boolean,
  ) => Promise<unknown>;
  readonly onRemoveMember: (memberPtid: string) => Promise<unknown>;
  readonly onInviteMember: (memberPtid: string) => Promise<unknown>;
  readonly onDissolveGroup: () => Promise<unknown>;
  readonly onLeaveGroup: () => Promise<unknown>;
}

export function GroupManagementModal({
  open,
  onClose,
  conversation,
  members,
  myRole,
  canManage,
  writeAdmissionOpen,
  groupNameDraft,
  setGroupNameDraft,
  groupDescriptionDraft,
  setGroupDescriptionDraft,
  conversationSettings,
  groupCommandOutcomes,
  inviteCandidates,
  peerProfiles,
  currentUserPtid,
  onSaveGroup,
  onUpdateMySettings,
  onUpdateMemberRole,
  onTransferOwnership,
  onToggleMemberMuted,
  onRemoveMember,
  onInviteMember,
  onDissolveGroup,
  onLeaveGroup,
}: GroupManagementModalProps) {
  const { t } = useMobileI18n();
  const [pendingOperation, setPendingOperation] = useState('');
  const [operationError, setOperationError] = useState('');
  if (!open) return null;
  const visibleGroupOutcomes = Object.values(groupCommandOutcomes).filter(
    (outcome) => outcome.conversationId === conversation.conversationId,
  );
  const visibleGroupOutcome = visibleGroupOutcomes.find(
    (outcome) => outcome.state === 'failed',
  ) ?? visibleGroupOutcomes.find(
    (outcome) => outcome.state === 'uncertain',
  ) ?? visibleGroupOutcomes[0];
  const groupCommandBusy = visibleGroupOutcomes.some(isGroupCommandBusy);
  const operationDisabled = !writeAdmissionOpen
    || Boolean(pendingOperation)
    || groupCommandBusy;

  const runOperation = async (
    operationKey: string,
    failureKey: string,
    operation: () => Promise<unknown>,
  ) => {
    if (operationDisabled) return;
    setPendingOperation(operationKey);
    setOperationError('');
    try {
      await operation();
      setPendingOperation('');
    } catch {
      setOperationError(t(failureKey));
      setPendingOperation('');
    }
  };

  return (
    <div
      className="chat-action-sheet-shell"
      data-product-surface={!canManage ? 'chat.group-role-denied' : undefined}
    >
      <button
        className="chat-action-sheet-backdrop"
        type="button"
        aria-label={t('common.action.close')}
        onClick={onClose}
      />
      <aside
        className="chat-action-sheet group-management-sheet"
        data-acceptance-id="group-management"
        data-chat-write-admission={writeAdmissionOpen ? 'open' : 'closed'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-management-title"
      >
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="group-management-title">{t('mobile.group.members')}</Text>
          <button
            className="header-action"
            type="button"
            aria-label={t('common.action.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="chat-action-list group-management-panel">
          {!writeAdmissionOpen ? (
            <Alert type="info" showIcon title={t('mobile.recovery.writeRevocation.body')} />
          ) : null}
          {!canManage ? (
            <Alert
              type="info"
              showIcon
              title={t('mobile.group.roleDenied')}
            />
          ) : null}
          {operationError ? <Alert type="error" showIcon title={operationError} /> : null}
          {visibleGroupOutcome ? (
            <GroupCommandNotice outcome={visibleGroupOutcome} />
          ) : null}

          <SectionTitle
            title={t('mobile.group.profile')}
            count={conversation.memberPtids.length}
          />
          <Input
            value={groupNameDraft}
            onChange={(event) => setGroupNameDraft(event.target.value)}
            placeholder={t('mobile.group.namePlaceholder')}
            disabled={!canManage || Boolean(pendingOperation) || groupCommandBusy}
          />
          <Input.TextArea
            value={groupDescriptionDraft}
            onChange={(event) => setGroupDescriptionDraft(event.target.value)}
            placeholder={t('mobile.group.descriptionPlaceholder')}
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={!canManage || Boolean(pendingOperation) || groupCommandBusy}
          />
          {canManage ? (
            <Button
              type="primary"
              loading={pendingOperation === 'save'}
              disabled={
                !groupNameDraft.trim()
                || operationDisabled
              }
              onClick={() => void runOperation(
                'save',
                'mobile.group.operationUpdateFailed',
                () => onSaveGroup(
                  groupNameDraft.trim(),
                  groupDescriptionDraft.trim(),
                ),
              )}
            >
              {t('common.action.save')}
            </Button>
          ) : null}

          <div className="group-setting-row">
            <Text>{t('mobile.group.myMuted')}</Text>
            <Switch
              aria-label={t('mobile.group.myMuted')}
              checked={Boolean(conversationSettings?.isMuted)}
              disabled={operationDisabled}
              onChange={(value) => void runOperation(
                'settings:mute',
                'mobile.settings.dirty.saveFailed',
                async () => onUpdateMySettings({ isMuted: value }),
              )}
            />
          </div>
          <div className="group-setting-row">
            <Text>{t('mobile.group.pinned')}</Text>
            <Switch
              aria-label={t('mobile.group.pinned')}
              checked={Boolean(conversationSettings?.isPinned)}
              disabled={operationDisabled}
              onChange={(value) => void runOperation(
                'settings:pin',
                'mobile.settings.dirty.saveFailed',
                async () => onUpdateMySettings({ isPinned: value }),
              )}
            />
          </div>

          <SectionTitle title={t('mobile.group.members')} count={members.length} />
          {members.length > 0 ? (
            <BoundedList
              surfaceKey={`members:${conversation.conversationId}`}
              items={[...members]}
              itemKey={(member) => member.ptid}
            >
              {(rows) => (
                <List
                  dataSource={rows}
                  rowKey="ptid"
                  renderItem={(member) => {
                    const profile = peerProfiles[member.ptid];
                    const memberName = groupMemberDisplayName(profile, t);
                    const memberSubtitle = profile?.federatedHandle
                      || profile?.acct
                      || groupRoleLabel(member.role, t);
                    const isSelf = member.ptid === currentUserPtid;
                    const canManageTarget = canManage
                      && !isSelf
                      && member.role !== MemberRole.OWNER
                      && (
                        myRole === MemberRole.OWNER
                        || member.role < myRole
                      );
                    const memberOperation = `member:${member.ptid}`;
                    const membershipOutcome = groupMembershipOutcome(
                      groupCommandOutcomes,
                      conversation.conversationId,
                      member.ptid,
                    );
                    return (
                      <List.Item
                        data-scroll-anchor-id={member.ptid}
                        data-group-membership-state={membershipOutcome?.state}
                        actions={[
                          canManageTarget && myRole === MemberRole.OWNER ? (
                            <Button
                              key="role"
                              size="small"
                              disabled={operationDisabled}
                              onClick={() => void runOperation(
                                `${memberOperation}:role`,
                                'mobile.group.operationUpdateMemberFailed',
                                () => onUpdateMemberRole(
                                  member.ptid,
                                  member.role === MemberRole.ADMIN
                                    ? 'member'
                                    : 'admin',
                                ),
                              )}
                            >
                              {t(member.role === MemberRole.ADMIN
                                ? 'mobile.group.demoteAdmin'
                                : 'mobile.group.promoteAdmin')}
                            </Button>
                          ) : null,
                          canManageTarget && myRole === MemberRole.OWNER ? (
                            <Button
                              key="transfer"
                              size="small"
                              disabled={operationDisabled}
                              onClick={() => {
                                Modal.confirm({
                                  title: t('mobile.group.transferOwnerConfirmTitle'),
                                  content: t('mobile.group.transferOwnerConfirmBody', {
                                    name: memberName,
                                  }),
                                  okText: t('mobile.group.transferOwner'),
                                  cancelText: t('common.action.cancel'),
                                  okButtonProps: { danger: true },
                                  onOk: () => runOperation(
                                    `${memberOperation}:transfer`,
                                    'mobile.group.operationTransferOwnerFailed',
                                    () => onTransferOwnership(member.ptid),
                                  ),
                                });
                              }}
                            >
                              {t('mobile.group.transferOwner')}
                            </Button>
                          ) : null,
                          canManageTarget ? (
                            <Button
                              key="mute"
                              size="small"
                              disabled={operationDisabled}
                              onClick={() => void runOperation(
                                `${memberOperation}:mute`,
                                'mobile.group.operationUpdateMemberFailed',
                                () => onToggleMemberMuted(member.ptid, !member.muted),
                              )}
                            >
                              {t(member.muted
                                ? 'mobile.group.unmuteMember'
                                : 'mobile.group.muteMember')}
                            </Button>
                          ) : null,
                          canManageTarget ? (
                            <Button
                              key="remove"
                              size="small"
                              danger
                              disabled={operationDisabled}
                              onClick={() => {
                                Modal.confirm({
                                  title: t('common.action.confirm'),
                                  content: `${t('mobile.group.removeMember')} ${memberName}`,
                                  okText: t('mobile.group.removeMember'),
                                  cancelText: t('common.action.cancel'),
                                  okButtonProps: { danger: true },
                                  onOk: () => runOperation(
                                    `${memberOperation}:remove`,
                                    'mobile.group.operationRemoveFailed',
                                    () => onRemoveMember(member.ptid),
                                  ),
                                });
                              }}
                            >
                              {t('mobile.group.removeMember')}
                            </Button>
                          ) : null,
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          avatar={(
                            <MobileAvatar src={profile?.avatar}>
                              {memberName.slice(0, 1)}
                            </MobileAvatar>
                          )}
                          title={<Text strong>{memberName}</Text>}
                          description={<Text type="secondary">{memberSubtitle}</Text>}
                        />
                        <Tag>{groupRoleLabel(member.role, t)}</Tag>
                        {member.muted ? <Tag color="warning">{t('mobile.group.memberMuted')}</Tag> : null}
                        {membershipOutcome ? (
                          <GroupCommandTag outcome={membershipOutcome} />
                        ) : null}
                      </List.Item>
                    );
                  }}
                />
              )}
            </BoundedList>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.group.noMembers')}
            />
          )}

          <SectionTitle
            title={t('mobile.group.inviteFriends')}
            count={inviteCandidates.length}
          />
          {inviteCandidates.length > 0 ? (
            <BoundedList
              surfaceKey={`invite:${conversation.conversationId}`}
              items={[...inviteCandidates]}
              itemKey={(candidate) => candidate.peerPtid}
            >
              {(rows) => (
                <List
                  dataSource={rows}
                  rowKey="peerPtid"
                  renderItem={(candidate) => {
                    const membershipOutcome = groupCommandOutcomes[
                      groupCommandOutcomeKey(
                        conversation.conversationId,
                        'add-member',
                        candidate.peerPtid,
                      )
                    ];
                    return (
                      <List.Item
                        data-scroll-anchor-id={candidate.peerPtid}
                        data-group-membership-state={membershipOutcome?.state}
                        actions={[
                          <Button
                            key="invite"
                            size="small"
                            type="primary"
                            disabled={operationDisabled}
                            loading={
                              pendingOperation === `invite:${candidate.peerPtid}`
                              || isGroupCommandBusy(membershipOutcome)
                            }
                            onClick={() => void runOperation(
                              `invite:${candidate.peerPtid}`,
                              'mobile.group.operationInviteFailed',
                              () => onInviteMember(candidate.peerPtid),
                            )}
                          >
                            {t('mobile.group.invite')}
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          avatar={(
                            <MobileAvatar src={candidate.peerAvatar}>
                              {candidate.peerName.slice(0, 1)}
                            </MobileAvatar>
                          )}
                          title={<Text strong>{candidate.peerName}</Text>}
                          description={(
                            <Text type="secondary">
                              {t('mobile.chat.forwardDestinationDirect')}
                            </Text>
                          )}
                        />
                        {membershipOutcome ? (
                          <GroupCommandTag outcome={membershipOutcome} />
                        ) : null}
                      </List.Item>
                    );
                  }}
                />
              )}
            </BoundedList>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.group.noInviteCandidates')}
            />
          )}

          <div className="chat-action-group danger">
            <Button
              danger
              block
              disabled={operationDisabled}
              loading={pendingOperation === 'leave-or-dissolve'}
              onClick={() => {
                const owner = myRole === MemberRole.OWNER;
                Modal.confirm({
                  title: t(owner
                    ? 'mobile.group.dissolveGroupConfirmTitle'
                    : 'mobile.group.leaveGroupConfirmTitle'),
                  content: t(owner
                    ? 'mobile.group.dissolveGroupConfirmBody'
                    : 'mobile.group.leaveGroupConfirmBody'),
                  okText: t(owner
                    ? 'mobile.group.dissolveGroup'
                    : 'mobile.group.leaveGroup'),
                  cancelText: t('common.action.cancel'),
                  okButtonProps: { danger: true },
                  onOk: () => runOperation(
                    'leave-or-dissolve',
                    owner
                      ? 'mobile.group.operationDissolveFailed'
                      : 'mobile.group.operationLeaveFailed',
                    owner ? onDissolveGroup : onLeaveGroup,
                  ),
                });
              }}
            >
              {t(myRole === MemberRole.OWNER
                ? 'mobile.group.dissolveGroup'
                : 'mobile.group.leaveGroup')}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function groupMemberDisplayName(
  profile: PeerProfile | null | undefined,
  t: (key: string) => string,
): string {
  return profile?.displayName
    || profile?.username
    || profile?.acct
    || profile?.federatedHandle
    || t('mobile.group.memberUnavailable');
}

function GroupCommandNotice({
  outcome,
}: {
  readonly outcome: GroupCommandOutcome;
}) {
  const { t } = useMobileI18n();
  return (
    <Alert
      data-group-command-state={outcome.state}
      type={outcome.state === 'failed' ? 'error' : 'info'}
      role={outcome.state === 'failed' ? 'alert' : 'status'}
      showIcon
      title={t(groupCommandStateLabel(outcome))}
    />
  );
}

function GroupCommandTag({
  outcome,
}: {
  readonly outcome: GroupCommandOutcome;
}) {
  const { t } = useMobileI18n();
  return (
    <Tag
      color={outcome.state === 'failed'
        ? 'error'
        : outcome.state === 'uncertain'
          ? 'warning'
          : 'processing'}
    >
      {t(groupCommandStateLabel(outcome))}
    </Tag>
  );
}

function groupMembershipOutcome(
  outcomes: GroupCommandOutcomes,
  conversationId: string,
  memberPtid: string,
): GroupCommandOutcome | undefined {
  return [
    'remove-member',
    'update-member',
    'transfer-ownership',
  ].map((kind) => outcomes[groupCommandOutcomeKey(
    conversationId,
    kind as 'remove-member' | 'update-member' | 'transfer-ownership',
    memberPtid,
  )]).find(Boolean);
}

function groupCommandStateLabel(
  outcome: GroupCommandOutcome,
): string {
  if (outcome.state === 'failed') {
    return 'mobile.recovery.command.state.failed-retryable';
  }
  return outcome.state === 'uncertain'
    ? 'mobile.chat.commandRetrying'
    : 'mobile.recovery.command.state.pending';
}

function ConversationSettingsFeedbackNotice({
  feedback,
  onRetry,
}: {
  readonly feedback: ConversationSettingsFeedback;
  readonly onRetry: () => void;
}) {
  const { t } = useMobileI18n();
  if (feedback.phase === 'idle') return null;
  const messageKey = feedback.phase === 'pending'
    ? 'mobile.settings.dirty.saving'
    : feedback.phase === 'retrying'
      ? 'mobile.chat.commandRetrying'
      : feedback.phase === 'committed'
        ? 'mobile.settings.dirty.saved'
        : 'mobile.settings.dirty.saveFailed';

  return (
    <Alert
      data-conversation-settings-state={feedback.phase}
      type={feedback.phase === 'failed'
        ? 'error'
        : feedback.phase === 'committed'
          ? 'success'
          : 'info'}
      role={feedback.phase === 'failed' ? 'alert' : 'status'}
      showIcon
      title={t(messageKey)}
      action={feedback.phase === 'failed' ? (
        <Button size="small" icon={<RotateCcw size={13} />} onClick={onRetry}>
          {t('common.action.retry')}
        </Button>
      ) : undefined}
    />
  );
}

function SectionTitle({ title, count }: { readonly title: string; readonly count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text type="secondary">{count}</Text>
    </div>
  );
}

function groupRoleLabel(
  role: number,
  t: (key: string) => string,
): string {
  if (role >= MemberRole.OWNER) return t('mobile.group.roleOwner');
  if (role >= MemberRole.ADMIN) return t('mobile.group.roleAdmin');
  return t('mobile.group.roleMember');
}

function ChatActionButton({
  icon,
  title,
  active,
  danger,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly active?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={`chat-action-button ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      type="button"
      aria-label={title}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="chat-action-icon">{icon}</span>
      <span>{title}</span>
    </button>
  );
}
