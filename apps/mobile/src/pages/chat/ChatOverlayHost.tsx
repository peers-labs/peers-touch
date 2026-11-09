import { useState, type ReactNode } from 'react';
import {
  Button,
  Empty,
  Icon,
  IconButton,
  Spin,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';
import { isRecalledChatMessage } from '@peers-touch/client-chat-core';

import { confirm, confirmDestructive } from '../../app/feedback/mobileFeedback';
import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileAvatar } from '../../components/MobileAvatar';
import { actorDisplayName } from '../../features/social/socialProjection';
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
import { isOwnChatMessage } from '../../features/chat/chatSelectors';
import type { ConversationSettingsFeedback } from './conversationSettingsState';

const MOBILE_MESSAGE_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F389}'] as const;

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
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><Icon iconId="close" size={18} /></button>
        </div>
        <div className="chat-action-list">
          <div className="chat-background-section message-action-reactions">
            <Text tone="secondary" className="chat-background-title">{t('mobile.chat.addReaction')}</Text>
            <div className="chat-background-grid">
              {MOBILE_MESSAGE_REACTIONS.map((reaction) => {
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
                    <Icon iconId="laugh" size={14} />
                    <span>{reaction}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="chat-action-group">
            <ChatActionButton icon={<Icon iconId="corner-up-left" size={18} />} title={t('mobile.chat.reply')} onClick={onReply} />
            <ChatActionButton icon={<Icon iconId="forward" size={18} />} title={t('mobile.chat.forward')} disabled={commandBusy || unavailable} onClick={onForward} />
            <ChatActionButton icon={<Icon iconId="message-square" size={18} />} title={t('mobile.chat.thread')} onClick={onOpenThread} />
            <ChatActionButton
              icon={<Icon iconId="pin" size={18} />}
              title={t(metadata.pinnedByPtid ? 'mobile.chat.unpinMessage' : 'mobile.chat.pinMessage')}
              active={Boolean(metadata.pinnedByPtid)}
              disabled={commandBusy}
              onClick={onTogglePin}
            />
            <ChatActionButton
              icon={<Icon iconId="flag" size={18} />}
              title={flagLabel}
              active={flagged}
              disabled={flagLoading}
              onClick={onToggleFlag}
            />
          </div>
          {mine && !unavailable ? (
            <div className="chat-action-group">
              {canEdit ? <ChatActionButton icon={<Icon iconId="edit" size={18} />} title={t('mobile.chat.edit')} disabled={commandBusy} onClick={onEdit} /> : null}
              <ChatActionButton icon={<Icon iconId="rotate-ccw" size={18} />} title={t('mobile.chat.recall')} disabled={commandBusy} onClick={onRecall} />
            </div>
          ) : null}
          {!unavailable ? (
            <div className="chat-action-group">
              {canModerate ? (
                <ChatActionButton icon={<Icon iconId="shield-x" size={18} />} title={t('mobile.chat.moderate')} disabled={commandBusy} onClick={onModerate} danger />
              ) : null}
              <ChatActionButton icon={<Icon iconId="eye-off" size={18} />} title={t('mobile.chat.deleteForMe')} disabled={commandBusy} onClick={onHideForMe} danger />
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
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><Icon iconId="close" size={18} /></button>
        </div>
        <div className="chat-action-list">
          {error ? <div className="chat-overlay-alert error" role="alert"><Icon iconId="warning" size={16} /><span>{error}</span></div> : null}
          {destinations.length === 0 ? (
            <Empty description={t('mobile.chat.forwardEmpty')} />
          ) : (
            <BoundedList
              surfaceKey="message-forward-destinations"
              items={destinations}
              itemKey={(destination) => destination.key}
              size={100}
            >
              {(rows) => rows.map((destination) => (
                <div key={destination.key} className="contact-item conversation-item forward-destination-row">
                  <div className="contact-item-meta">
                    <MobileAvatar src={destination.avatar}>
                      {destination.title.slice(0, 1).toUpperCase()}
                    </MobileAvatar>
                    <span className="contact-item-copy">
                      <Text strong>{destination.title}</Text>
                      <span className="contact-item-description">{destination.subtitle}</span>
                    </span>
                  </div>
                  <span className="contact-item-actions">
                    {pendingDestinationId === destination.conversationId ? (
                      <Spin size="small" />
                    ) : (
                      <IconButton
                        actionId="message-forward-select"
                        iconId="forward"
                        iconSize={17}
                        label={t('mobile.chat.forwardTo', { destination: destination.title })}
                        emphasis="quiet"
                        availability={Boolean(pendingDestinationId)
                          ? { kind: 'disabled', reason: t('mobile.chat.forwardTitle') }
                          : undefined}
                        onActivate={() => onSelect(destination)}
                      />
                    )}
                  </span>
                </div>
              ))}
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
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><Icon iconId="close" size={18} /></button>
        </div>
        <div className="chat-action-list">
          <ConversationSettingsFeedbackNotice
            feedback={settingsFeedback}
            onRetry={onRetrySettings}
          />
          <div className="chat-action-group">
            <ChatActionButton icon={<Icon iconId="search" size={18} />} title={t('mobile.chat.quickSearch')} onClick={onSearch} />
            <ChatActionButton icon={<Icon iconId="volume-x" size={18} />} title={t('mobile.chat.quickMute')} active={state.muted} disabled={settingsBusy} onClick={onToggleMute} />
            <ChatActionButton icon={<Icon iconId="pin" size={18} />} title={t('mobile.chat.quickSticky')} active={state.sticky} disabled={settingsBusy} onClick={onToggleSticky} />
            <ChatActionButton icon={<Icon iconId="bell" size={18} />} title={t('mobile.chat.quickAlert')} active={state.alertEnabled} disabled={settingsBusy} onClick={onToggleAlert} />
          </div>
          <div className="chat-background-section">
            <Text tone="secondary" className="chat-background-title">{t('mobile.chat.quickBackground')}</Text>
            <div className="chat-background-grid">
              {CHAT_BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`chat-background-choice chat-background-${option} ${state.background === option ? 'active' : ''}`}
                  type="button"
                  disabled={settingsBusy}
                  onClick={() => onSelectBackground(option)}
                >
                  <Icon iconId="image" size={14} />
                  <span>{t(`mobile.chat.background.${option}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="chat-action-group">
            {onManageGroup ? <ChatActionButton icon={<Icon iconId="users" size={18} />} title={t('mobile.group.members')} onClick={onManageGroup} /> : null}
          </div>
          <div className="chat-action-group danger">
            <ChatActionButton icon={<Icon iconId="delete" size={18} />} title={t('mobile.chat.quickClearHistory')} danger disabled={settingsBusy} onClick={onClearHistory} />
            {isFriendThread ? (
              peerBlocked
                ? <ChatActionButton icon={<Icon iconId="rotate-ccw" size={18} />} title={t('mobile.contacts.unblock')} onClick={onUnblockPeer} />
                : <ChatActionButton icon={<Icon iconId="ban" size={18} />} title={t('mobile.contacts.block')} danger onClick={onBlockPeer} />
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
          <Text tone="secondary" id="chat-clear-confirm-description">
            {t('mobile.chat.clearHistoryConfirmBody')}
          </Text>
        </div>
        <div className="chat-confirm-actions">
          <Button
            actionId="chat-destructive-cancel"
            fullWidth
            emphasis="secondary"
            availability={busy ? { kind: 'disabled', reason: t('common.action.cancel') } : undefined}
            onActivate={onCancel}
          >
            {t('common.action.cancel')}
          </Button>
          <Button
            actionId="chat-destructive-confirm"
            fullWidth
            emphasis="primary"
            tone="danger"
            execution={busy ? 'pending' : 'idle'}
            onActivate={onConfirm}
          >
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

  const runOperation = async (
    operationKey: string,
    failureKey: string,
    operation: () => Promise<unknown>,
  ) => {
    if (pendingOperation || groupCommandBusy) return;
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
            <Icon iconId="close" size={18} />
          </button>
        </div>
        <div className="chat-action-list group-management-panel">
          {!canManage ? (
            <div className="chat-overlay-alert info" role="status">
              <Icon iconId="shield-alert" size={16} />
              <span>{t('mobile.group.roleDenied')}</span>
            </div>
          ) : null}
          {operationError ? (
            <div className="chat-overlay-alert error" role="alert">
              <Icon iconId="warning" size={16} />
              <span>{operationError}</span>
            </div>
          ) : null}
          {visibleGroupOutcome ? (
            <GroupCommandNotice outcome={visibleGroupOutcome} />
          ) : null}

          <SectionTitle
            title={t('mobile.group.profile')}
            count={conversation.memberPtids.length}
          />
          <TextField
            value={groupNameDraft}
            placeholder={t('mobile.group.namePlaceholder')}
            disabled={!canManage || Boolean(pendingOperation) || groupCommandBusy}
            onValueChange={setGroupNameDraft}
          />
          <TextArea
            value={groupDescriptionDraft}
            placeholder={t('mobile.group.descriptionPlaceholder')}
            minimumRows={2}
            maximumRows={4}
            disabled={!canManage || Boolean(pendingOperation) || groupCommandBusy}
            onValueChange={setGroupDescriptionDraft}
          />
          {canManage ? (
            <Button
              actionId="group-management-save"
              emphasis="primary"
              execution={pendingOperation === 'save' ? 'pending' : 'idle'}
              availability={!groupNameDraft.trim()
                || Boolean(pendingOperation)
                || groupCommandBusy
                ? { kind: 'disabled', reason: t('common.action.save') }
                : undefined}
              onActivate={() => void runOperation(
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
              disabled={Boolean(pendingOperation) || groupCommandBusy}
              onCheckedChange={(value) => void runOperation(
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
              disabled={Boolean(pendingOperation) || groupCommandBusy}
              onCheckedChange={(value) => void runOperation(
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
              {(rows) => rows.map((member) => {
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
                    const controlsDisabled = Boolean(pendingOperation) || groupCommandBusy;
                    return (
                      <div
                        key={member.ptid}
                        className="contact-item group-member-row"
                        data-scroll-anchor-id={member.ptid}
                        data-group-membership-state={membershipOutcome?.state}
                      >
                        <div className="contact-item-meta">
                          <MobileAvatar src={profile?.avatar}>
                            {memberName.slice(0, 1)}
                          </MobileAvatar>
                          <span className="contact-item-copy">
                            <Text strong>{memberName}</Text>
                            <span className="contact-item-description">{memberSubtitle}</span>
                          </span>
                        </div>
                        <span className="group-member-badges">
                          <Tag>{groupRoleLabel(member.role, t)}</Tag>
                          {member.muted ? <Tag tone="warning">{t('mobile.group.memberMuted')}</Tag> : null}
                          {membershipOutcome ? (
                            <GroupCommandTag outcome={membershipOutcome} />
                          ) : null}
                        </span>
                        {canManageTarget ? (
                          <span className="group-member-actions">
                            {myRole === MemberRole.OWNER ? (
                              <Button
                                actionId={`${memberOperation}-role`}
                                emphasis="secondary"
                                density="compact"
                                availability={controlsDisabled
                                  ? { kind: 'disabled', reason: t('mobile.group.promoteAdmin') }
                                  : undefined}
                                onActivate={() => void runOperation(
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
                            ) : null}
                            {myRole === MemberRole.OWNER ? (
                              <Button
                                actionId={`${memberOperation}-transfer`}
                                emphasis="secondary"
                                density="compact"
                                availability={controlsDisabled
                                  ? { kind: 'disabled', reason: t('mobile.group.transferOwner') }
                                  : undefined}
                                onActivate={() => {
                                  void confirmDestructive({
                                    title: t('mobile.group.transferOwnerConfirmTitle'),
                                    description: t('mobile.group.transferOwnerConfirmBody', {
                                      name: memberName,
                                    }),
                                    confirmLabel: t('mobile.group.transferOwner'),
                                    cancelLabel: t('common.action.cancel'),
                                    onConfirm: () => runOperation(
                                      `${memberOperation}:transfer`,
                                      'mobile.group.operationTransferOwnerFailed',
                                      () => onTransferOwnership(member.ptid),
                                    ),
                                  });
                                }}
                              >
                                {t('mobile.group.transferOwner')}
                              </Button>
                            ) : null}
                            <Button
                              actionId={`${memberOperation}-mute`}
                              emphasis="secondary"
                              density="compact"
                              availability={controlsDisabled
                                ? { kind: 'disabled', reason: t('mobile.group.muteMember') }
                                : undefined}
                              onActivate={() => void runOperation(
                                `${memberOperation}:mute`,
                                'mobile.group.operationUpdateMemberFailed',
                                () => onToggleMemberMuted(member.ptid, !member.muted),
                              )}
                            >
                              {t(member.muted
                                ? 'mobile.group.unmuteMember'
                                : 'mobile.group.muteMember')}
                            </Button>
                            <Button
                              actionId={`${memberOperation}-remove`}
                              tone="danger"
                              density="compact"
                              availability={controlsDisabled
                                ? { kind: 'disabled', reason: t('mobile.group.removeMember') }
                                : undefined}
                              onActivate={() => {
                                void confirmDestructive({
                                  title: t('common.action.confirm'),
                                  description: `${t('mobile.group.removeMember')} ${memberName}`,
                                  confirmLabel: t('mobile.group.removeMember'),
                                  cancelLabel: t('common.action.cancel'),
                                  onConfirm: () => runOperation(
                                    `${memberOperation}:remove`,
                                    'mobile.group.operationRemoveFailed',
                                    () => onRemoveMember(member.ptid),
                                  ),
                                });
                              }}
                            >
                              {t('mobile.group.removeMember')}
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
            </BoundedList>
          ) : (
            <Empty description={t('mobile.group.noMembers')} />
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
              {(rows) => rows.map((candidate) => {
                    const membershipOutcome = groupCommandOutcomes[
                      groupCommandOutcomeKey(
                        conversation.conversationId,
                        'add-member',
                        candidate.peerPtid,
                      )
                    ];
                    const invitePending = pendingOperation === `invite:${candidate.peerPtid}`
                      || isGroupCommandBusy(membershipOutcome);
                    return (
                      <div
                        key={candidate.peerPtid}
                        className="contact-item group-invite-row"
                        data-scroll-anchor-id={candidate.peerPtid}
                        data-group-membership-state={membershipOutcome?.state}
                      >
                        <div className="contact-item-meta">
                          <MobileAvatar src={candidate.peerAvatar}>
                            {candidate.peerName.slice(0, 1)}
                          </MobileAvatar>
                          <span className="contact-item-copy">
                            <Text strong>{candidate.peerName}</Text>
                            <span className="contact-item-description">
                              {t('mobile.chat.forwardDestinationDirect')}
                            </span>
                          </span>
                        </div>
                        {membershipOutcome ? (
                          <GroupCommandTag outcome={membershipOutcome} />
                        ) : null}
                        <span className="contact-item-actions">
                          <Button
                            actionId={`invite:${candidate.peerPtid}`}
                            emphasis="primary"
                            density="compact"
                            execution={invitePending ? 'pending' : 'idle'}
                            availability={Boolean(pendingOperation) || groupCommandBusy
                              ? { kind: 'disabled', reason: t('mobile.group.invite') }
                              : undefined}
                            onActivate={() => void runOperation(
                              `invite:${candidate.peerPtid}`,
                              'mobile.group.operationInviteFailed',
                              () => onInviteMember(candidate.peerPtid),
                            )}
                          >
                            {t('mobile.group.invite')}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
            </BoundedList>
          ) : (
            <Empty description={t('mobile.group.noInviteCandidates')} />
          )}

          <div className="chat-action-group danger">
            <Button
              actionId="group-leave-or-dissolve"
              tone="danger"
              fullWidth
              execution={pendingOperation === 'leave-or-dissolve' ? 'pending' : 'idle'}
              availability={Boolean(pendingOperation) || groupCommandBusy
                ? { kind: 'disabled', reason: t('mobile.group.leaveGroup') }
                : undefined}
              onActivate={() => {
                const owner = myRole === MemberRole.OWNER;
                void confirmDestructive({
                  title: t(owner
                    ? 'mobile.group.dissolveGroupConfirmTitle'
                    : 'mobile.group.leaveGroupConfirmTitle'),
                  description: t(owner
                    ? 'mobile.group.dissolveGroupConfirmBody'
                    : 'mobile.group.leaveGroupConfirmBody'),
                  confirmLabel: t(owner
                    ? 'mobile.group.dissolveGroup'
                    : 'mobile.group.leaveGroup'),
                  cancelLabel: t('common.action.cancel'),
                  onConfirm: () => runOperation(
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
  return actorDisplayName(profile?.displayName, '')
    || actorDisplayName(profile?.username, '')
    || t('mobile.contacts.unknownUser');
}

function GroupCommandNotice({
  outcome,
}: {
  readonly outcome: GroupCommandOutcome;
}) {
  const { t } = useMobileI18n();
  return (
    <div
      className="chat-overlay-alert"
      data-group-command-state={outcome.state}
      data-tone={outcome.state === 'failed' ? 'error' : 'info'}
      role={outcome.state === 'failed' ? 'alert' : 'status'}
    >
      <Icon iconId={outcome.state === 'failed' ? 'warning' : 'info'} size={16} />
      <span>{t(groupCommandStateLabel(outcome))}</span>
    </div>
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
      tone={outcome.state === 'failed'
        ? 'danger'
        : outcome.state === 'uncertain'
          ? 'warning'
          : 'info'}
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

  const tone = feedback.phase === 'failed'
    ? 'error'
    : feedback.phase === 'committed'
      ? 'success'
      : 'info';

  return (
    <div
      className="chat-overlay-alert"
      data-conversation-settings-state={feedback.phase}
      data-tone={tone}
      role={feedback.phase === 'failed' ? 'alert' : 'status'}
    >
      <Icon iconId={tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info'} size={16} />
      <span>{t(messageKey)}</span>
      {feedback.phase === 'failed' ? (
        <Button
          actionId="conversation-settings-retry"
          emphasis="quiet"
          density="compact"
          leading={<Icon iconId="rotate-ccw" size={13} />}
          onActivate={onRetry}
        >
          {t('common.action.retry')}
        </Button>
      ) : null}
    </div>
  );
}

function SectionTitle({ title, count }: { readonly title: string; readonly count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text tone="secondary">{count}</Text>
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
      onClick={onClick}
      disabled={disabled}
    >
      <span className="chat-action-icon">{icon}</span>
      <span>{title}</span>
    </button>
  );
}
