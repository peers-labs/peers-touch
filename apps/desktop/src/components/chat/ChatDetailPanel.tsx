import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Divider, Modal, Select, theme, Tooltip, Typography } from 'antd';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { FriendshipStatus } from '../../gen/proto/domain/chat/chat_pb';
import {
  Ban,
  BellOff,
  BellRing,
  ChevronRight,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  LogOut,
  Paperclip,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { CHAT_BACKGROUND_OPTIONS } from '../../store/socialProjection';
import { api, type AccountProfile } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendMessageAttachment,
} from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  GroupRole,
  type Group,
  type GroupMember,
  type GroupMessage,
  type GroupMessageAttachment,
} from '../../gen/proto/domain/chat/group_chat_pb';
import { SafetyVerificationPanel } from './SafetyVerificationPanel';
import { useAttachmentUrl } from './useAttachmentUrl';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';

const { Text } = Typography;

type DetailActionRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  soonLabel?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
};

type SocialMessage = FriendChatMessage | GroupMessage;
type DetailAttachment = FriendMessageAttachment | GroupMessageAttachment;
type DetailAttachmentKind = 'media' | 'file';

interface DetailAttachmentItem {
  id: string;
  attachment: DetailAttachment;
  kind: DetailAttachmentKind;
  isImage: boolean;
  isVideo: boolean;
  timestampMs: number;
}

const IMAGE_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_FILENAME_PATTERN = /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i;
const RECENT_MEDIA_LIMIT = 6;
const RECENT_FILE_LIMIT = 4;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function isImageAttachment(attachment: DetailAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('image/') || IMAGE_FILENAME_PATTERN.test(filename);
}

function isVideoAttachment(attachment: DetailAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('video/') || VIDEO_FILENAME_PATTERN.test(filename);
}

function formatAttachmentSize(size: DetailAttachment['size']): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getMessageTimestampMs(message: SocialMessage): number {
  const ts = message.createdAt ?? message.sentAt;
  return ts ? timestampDate(ts).getTime() : 0;
}

function getCurrentConversationAttachments(messages: SocialMessage[]): DetailAttachmentItem[] {
  const items: DetailAttachmentItem[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.recalled || !message.attachments || message.attachments.length === 0) return;

    const timestampMs = getMessageTimestampMs(message);
    message.attachments.forEach((attachment, attachmentIndex) => {
      const isImage = isImageAttachment(attachment);
      const isVideo = isVideoAttachment(attachment);
      items.push({
        id: `${message.ulid || messageIndex}:${attachment.cid || attachmentIndex}`,
        attachment,
        kind: isImage || isVideo ? 'media' : 'file',
        isImage,
        isVideo,
        timestampMs,
      });
    });
  });

  return items.sort((a, b) => b.timestampMs - a.timestampMs);
}

function MemberItem({ member, action }: { member: GroupMember; action?: ReactNode }) {
  const { token } = theme.useToken();
  const name = member.nickname || member.actorDid.slice(0, 16);
  return (
    <Flexbox horizontal align="center" gap={10} style={{ padding: '6px 0' }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: token.colorFillSecondary,
          color: token.colorTextSecondary,
          fontSize: 13,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {getInitial(name)}
      </Flexbox>
      <Text ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{name}</Text>
      {action}
    </Flexbox>
  );
}

function DetailActionRow({
  icon,
  title,
  description,
  soonLabel,
  disabled,
  danger,
  onClick,
}: DetailActionRowProps) {
  const { token } = theme.useToken();
  const iconColor = danger ? token.colorError : token.colorPrimary;

  return (
    <Button
      type="text"
      block
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 'auto',
        padding: '10px 12px',
        justifyContent: 'stretch',
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <Flexbox horizontal align="center" gap={10} style={{ width: '100%', minWidth: 0 }}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: danger ? token.colorErrorBg : token.colorFillSecondary,
            color: disabled ? token.colorTextDisabled : iconColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </Flexbox>
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <Text
            style={{
              color: disabled ? token.colorTextDisabled : danger ? token.colorError : token.colorText,
              fontSize: 13,
              fontWeight: 600,
            }}
            ellipsis
          >
            {title}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
            {description}
          </Text>
        </Flexbox>
        {soonLabel ? (
          <Text
            type="secondary"
            style={{
              padding: '2px 6px',
              borderRadius: 999,
              background: token.colorFillTertiary,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            {soonLabel}
          </Text>
        ) : (
          <ChevronRight size={15} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
        )}
      </Flexbox>
    </Button>
  );
}

function DetailAttachmentCard({ item }: { item: DetailAttachmentItem }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [previewFailed, setPreviewFailed] = useState(false);
  const openUrl = useAttachmentUrl(item.attachment.cid);
  const previewCid = item.isImage
    ? (item.attachment.thumbnailCid || item.attachment.cid)
    : item.attachment.thumbnailCid;
  const previewUrl = useAttachmentUrl(previewCid);
  const filename = item.attachment.filename?.trim() || t('chat.social.detail.unnamedAttachment');
  const sizeLabel = formatAttachmentSize(item.attachment.size);
  const canOpen = Boolean(openUrl);
  const isMedia = item.kind === 'media';
  const tooltip = canOpen
    ? t('chat.social.detail.openAttachment')
    : t('chat.social.detail.attachmentUnavailable');
  const Icon = item.isImage ? ImageIcon : item.isVideo ? Film : FileText;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPreviewFailed(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, item.attachment.cid]);

  const handleOpen = () => {
    if (openUrl) window.open(openUrl, '_blank');
  };

  if (isMedia) {
    return (
      <Tooltip title={tooltip}>
        <span style={{ display: 'inline-flex' }}>
          <button
            type="button"
            disabled={!canOpen}
            onClick={handleOpen}
            style={{
              appearance: 'none',
              width: 86,
              minHeight: 106,
              padding: 6,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 14,
              background: token.colorFillQuaternary,
              color: token.colorText,
              cursor: canOpen ? 'pointer' : 'default',
              opacity: canOpen ? 1 : 0.58,
              textAlign: 'left',
            }}
          >
            <Flexbox gap={5}>
              <Flexbox
                align="center"
                justify="center"
                style={{
                  width: '100%',
                  height: 58,
                  overflow: 'hidden',
                  borderRadius: 10,
                  background: token.colorFillSecondary,
                  color: token.colorTextTertiary,
                }}
              >
                {previewUrl && !previewFailed ? (
                  <img
                    src={previewUrl}
                    alt={filename}
                    onError={() => setPreviewFailed(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <Icon size={22} />
                )}
              </Flexbox>
              <Text ellipsis style={{ fontSize: 11, fontWeight: 600, maxWidth: '100%' }}>
                {filename}
              </Text>
              <Flexbox horizontal align="center" justify="space-between" gap={4}>
                <Text type="secondary" ellipsis style={{ fontSize: 10, minWidth: 0 }}>
                  {sizeLabel || t('chat.social.detail.mediaAttachment')}
                </Text>
                {canOpen ? <ExternalLink size={10} style={{ color: token.colorTextTertiary, flexShrink: 0 }} /> : null}
              </Flexbox>
            </Flexbox>
          </button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip}>
      <span style={{ display: 'block', width: '100%' }}>
        <button
          type="button"
          disabled={!canOpen}
          onClick={handleOpen}
          style={{
            appearance: 'none',
            width: '100%',
            padding: '8px 10px',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 13,
            background: token.colorFillQuaternary,
            color: token.colorText,
            cursor: canOpen ? 'pointer' : 'default',
            opacity: canOpen ? 1 : 0.58,
            textAlign: 'left',
          }}
        >
          <Flexbox horizontal align="center" gap={9} style={{ minWidth: 0 }}>
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 32,
                height: 32,
                flex: '0 0 32px',
                borderRadius: 10,
                background: token.colorFillSecondary,
                color: token.colorPrimary,
              }}
            >
              <Paperclip size={16} />
            </Flexbox>
            <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
              <Text ellipsis style={{ fontSize: 12, fontWeight: 600 }}>
                {filename}
              </Text>
              <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                {sizeLabel || t('chat.social.detail.fileAttachment')}
              </Text>
            </Flexbox>
            {canOpen ? <ExternalLink size={13} style={{ color: token.colorTextTertiary, flexShrink: 0 }} /> : null}
          </Flexbox>
        </button>
      </span>
    </Tooltip>
  );
}

function DetailAttachmentSection({
  title,
  emptyLabel,
  items,
  limit,
}: {
  title: string;
  emptyLabel: string;
  items: DetailAttachmentItem[];
  limit: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const visibleItems = items.slice(0, limit);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const isFileSection = visibleItems[0]?.kind === 'file';

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between">
        <Text strong style={{ fontSize: 13 }}>{title}</Text>
        {hiddenCount > 0 ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('chat.social.detail.moreAttachments', { count: hiddenCount })}
          </Text>
        ) : null}
      </Flexbox>
      {visibleItems.length > 0 ? (
        <Flexbox
          horizontal={!isFileSection}
          gap={7}
          style={{
            flexWrap: isFileSection ? undefined : 'wrap',
          }}
        >
          {visibleItems.map((item) => (
            <DetailAttachmentCard key={item.id} item={item} />
          ))}
        </Flexbox>
      ) : (
        <Flexbox
          horizontal
          align="center"
          gap={8}
          style={{
            padding: '10px 11px',
            borderRadius: 13,
            border: `1px dashed ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
            color: token.colorTextSecondary,
          }}
        >
          <Paperclip size={14} />
          <Text type="secondary" style={{ fontSize: 12 }}>{emptyLabel}</Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}

function getFriendPeerDid(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid) return session.participantBDid || '';
    if (session.participantBDid === currentUserDid) return session.participantADid || '';
  }
  return session.participantBDid || session.participantADid || '';
}

function getFriendPeerName(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid)
      return session.participantBDisplayName || session.participantBDid || '';
    if (session.participantBDid === currentUserDid)
      return session.participantADisplayName || session.participantADid || '';
  }
  return session.participantBDisplayName || session.participantBDid || '';
}

function getFriendPeerAvatar(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid) return session.participantBAvatar || '';
    if (session.participantBDid === currentUserDid) return session.participantAAvatar || '';
  }
  return session.participantBAvatar || session.participantAAvatar || '';
}

function getFriendPeerOnlineSnapshot(session: FriendChatSession | undefined, peerDid: string): boolean | null {
  if (!session || !peerDid) return null;
  if (session.participantADid === peerDid) return session.participantAOnline;
  if (session.participantBDid === peerDid) return session.participantBOnline;
  return null;
}

export function ChatDetailPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    sessions, groups, groupMembers, messages,
    setShowDetail, loadSessions, loadGroupMembers, loadGroups, selectSession, selectGroup,
    conversationLocalState, updateConversationLocalState,
  } = useSocialChatStore();
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const ownFingerprint = useSocialChatStore((s) => s.ownFingerprint);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const peerProfiles = useSocialChatStore((s) => s.peerProfiles);
  const loadPeerProfile = useSocialChatStore((s) => s.loadPeerProfile);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const isGroup = activeTab === 'group';
  const activeFriendSession = activeTab === 'friend'
    ? sessions.find((s) => s.ulid === activeUlid)
    : undefined;
  const activeGroup: Group | undefined = isGroup
    ? groups.find((g) => g.ulid === activeUlid)
    : undefined;

  // The verify section is collapsed by default — most users won't
  // open it on every glance at a chat, and the QR / fetch is
  // network-bound. Lazy mount also defers the bundle fetch.
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDids, setInviteDids] = useState<string[]>([]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [peerBlocked, setPeerBlocked] = useState(false);

  // Resolve the peer DID for friend chats. Group safety numbers
  // are an N×N problem (each pair has its own number) and we
  // intentionally defer them until the chat ratchet upgrade —
  // see docs/architecture/crypto/double-ratchet-migration.md.
  const peerDid = getFriendPeerDid(activeFriendSession, currentUserDid);
  const members: GroupMember[] = isGroup && activeUlid ? (groupMembers[activeUlid] || []) : [];
  const memberDidSet = useMemo(() => new Set(members.map((member) => member.actorDid)), [members]);
  const inviteCandidates = useMemo(
    () => sessions
      .map((session) => ({
        did: getFriendPeerDid(session, currentUserDid),
        name: getFriendPeerName(session, currentUserDid),
      }))
      .filter((candidate): candidate is { did: string; name: string } =>
        Boolean(candidate.did && !memberDidSet.has(candidate.did)),
      ),
    [currentUserDid, memberDidSet, sessions],
  );
  const groupMemberCount = isGroup ? (activeGroup?.memberCount || members.length) : 0;
  const myGroupMember = members.find((member) => member.actorDid === currentUserDid);
  const myGroupRole = activeGroup?.ownerDid === currentUserDid ? GroupRole.OWNER : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = Boolean(
    activeGroup?.ownerDid === currentUserDid ||
    myGroupRole >= GroupRole.ADMIN,
  );
  const currentName = isGroup
    ? (activeGroup?.name || t('chat.social.sessionList.unnamedGroup'))
    : getFriendPeerName(activeFriendSession, currentUserDid);
  const displayName = currentName || t('chat.social.sessionList.unknown');
  const peerAvatar = getFriendPeerAvatar(activeFriendSession, currentUserDid);
  const peerPresenceSnapshot = getFriendPeerOnlineSnapshot(activeFriendSession, peerDid);
  const peerPresenceKnown = peerDid ? (peerDid in peerOnline || peerPresenceSnapshot !== null) : false;
  const peerIsOnline = peerDid in peerOnline ? peerOnline[peerDid] : peerPresenceSnapshot;
  const localStateKey = activeUlid ? `${activeTab}:${activeUlid}` : '';
  const activeLocalState = localStateKey ? conversationLocalState[localStateKey] : undefined;
  const activeMessages = activeUlid ? (messages[activeUlid] || []) : [];
  const { mediaAttachments, fileAttachments } = useMemo(() => {
    const attachments = getCurrentConversationAttachments(activeMessages);
    return {
      mediaAttachments: attachments.filter((item) => item.kind === 'media'),
      fileAttachments: attachments.filter((item) => item.kind === 'file'),
    };
  }, [activeMessages]);

  const updateActiveLocalState = (patch: Parameters<typeof updateConversationLocalState>[2]) => {
    if (!activeUlid) return;
    void updateConversationLocalState(activeTab, activeUlid, patch).catch(() => undefined);
  };

  const confirmClearHistory = () => {
    Modal.confirm({
      title: t('chat.social.detail.clearHistoryConfirmTitle'),
      content: t('chat.social.detail.clearHistoryConfirmBody'),
      okText: t('chat.social.detail.clearHistory'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: () => updateActiveLocalState({ clearedAt: Date.now() }),
    });
  };

  const confirmBlockUser = () => {
    if (!peerDid) return;
    Modal.confirm({
      title: t('chat.social.detail.blockUserConfirmTitle'),
      content: t('chat.social.detail.blockUserConfirmBody'),
      okText: t('chat.social.detail.blockUser'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.friendChatBlockUser(peerDid);
          await loadSessions();
          selectSession('');
          setShowDetail(false);
          toast.success(t('chat.social.detail.blockUserSuccess'));
        } catch (error) {
          log.error('chat', 'block user failed', { peerDid, error });
          toast.error(t('chat.social.detail.blockUserFailed'));
          throw error;
        }
      },
    });
  };

  const confirmUnblockUser = () => {
    if (!peerDid) return;
    Modal.confirm({
      title: t('chat.social.detail.unblockUserConfirmTitle'),
      content: t('chat.social.detail.unblockUserConfirmBody'),
      okText: t('chat.social.detail.unblockUser'),
      cancelText: t('chat.social.messageArea.cancel'),
      onOk: async () => {
        try {
          await api.friendChatUnblockUser(peerDid);
          setPeerBlocked(false);
          await loadSessions();
          toast.success(t('chat.social.detail.unblockUserSuccess'));
        } catch (error) {
          log.error('chat', 'unblock user failed', { peerDid, error });
          toast.error(t('chat.social.detail.unblockUserFailed'));
          throw error;
        }
      },
    });
  };

  const submitGroupInvites = async () => {
    if (!activeUlid || inviteDids.length === 0) return;
    setInviteSubmitting(true);
    try {
      await api.groupChatInviteToGroup(activeUlid, inviteDids);
      await Promise.allSettled([loadGroupMembers(activeUlid), loadGroups()]);
      setInviteDids([]);
      setInviteModalOpen(false);
      toast.success(t('chat.social.detail.addMemberSuccess'));
    } catch (error) {
      log.error('chat', 'invite group members failed', { groupUlid: activeUlid, inviteeCount: inviteDids.length, error });
      toast.error(t('chat.social.detail.addMemberFailed'));
      throw error;
    } finally {
      setInviteSubmitting(false);
    }
  };

  const confirmRemoveGroupMember = (member: GroupMember) => {
    if (!activeUlid || !member.actorDid) return;
    const memberName = member.nickname || member.actorDid;
    Modal.confirm({
      title: t('chat.social.detail.removeMemberConfirmTitle'),
      content: t('chat.social.detail.removeMemberConfirmBody', { name: memberName }),
      okText: t('chat.social.detail.removeMember'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.groupChatRemoveMember(activeUlid, member.actorDid);
          await Promise.allSettled([loadGroupMembers(activeUlid), loadGroups()]);
          toast.success(t('chat.social.detail.removeMemberSuccess'));
        } catch (error) {
          log.error('chat', 'remove group member failed', { groupUlid: activeUlid, actorDid: member.actorDid, error });
          toast.error(t('chat.social.detail.removeMemberFailed'));
          throw error;
        }
      },
    });
  };

  const updateGroupMember = async (member: GroupMember, input: { role?: number; muted?: boolean }) => {
    if (!activeUlid || !member.actorDid) return;
    try {
      await api.groupChatUpdateMember(activeUlid, member.actorDid, input);
      await loadGroupMembers(activeUlid);
      toast.success(t('chat.social.detail.updateMemberSuccess'));
    } catch (error) {
      log.error('chat', 'update group member failed', { groupUlid: activeUlid, actorDid: member.actorDid, input, error });
      toast.error(t('chat.social.detail.updateMemberFailed'));
      throw error;
    }
  };

  const confirmUpdateGroupMemberRole = (member: GroupMember, role: number) => {
    const memberName = member.nickname || member.actorDid;
    Modal.confirm({
      title: role === GroupRole.ADMIN ? t('chat.social.detail.promoteAdminConfirmTitle') : t('chat.social.detail.demoteAdminConfirmTitle'),
      content: role === GroupRole.ADMIN
        ? t('chat.social.detail.promoteAdminConfirmBody', { name: memberName })
        : t('chat.social.detail.demoteAdminConfirmBody', { name: memberName }),
      okText: role === GroupRole.ADMIN ? t('chat.social.detail.promoteAdmin') : t('chat.social.detail.demoteAdmin'),
      cancelText: t('chat.social.messageArea.cancel'),
      onOk: () => updateGroupMember(member, { role }),
    });
  };

  const toggleGroupMemberMuted = (member: GroupMember) => {
    void updateGroupMember(member, { muted: !member.muted });
  };

  const openBackgroundModal = () => {
    Modal.confirm({
      title: t('chat.social.detail.background'),
      icon: null,
      width: 440,
      content: (
        <Flexbox gap={8}>
          <Text type="secondary">{t('chat.social.detail.backgroundDesc')}</Text>
          <Select
            value={activeLocalState?.background || 'default'}
            options={CHAT_BACKGROUND_OPTIONS.map((value) => ({
              value,
              label: t(`chat.social.background.${value}`),
            }))}
            onChange={(value) => {
              updateActiveLocalState({ background: value });
              Modal.destroyAll();
            }}
            style={{ width: '100%' }}
          />
        </Flexbox>
      ),
      okButtonProps: { style: { display: 'none' } },
      cancelText: t('chat.social.messageArea.cancel'),
    });
  };

  const actionRows: DetailActionRowProps[] = [
    {
      icon: <Search size={16} />,
      title: t('chat.social.detail.searchMessages'),
      description: t('chat.social.detail.searchMessagesDesc'),
      onClick: () => window.dispatchEvent(new CustomEvent('peers-chat:open-search')),
    },
    {
      icon: activeLocalState?.muted ? <BellRing size={16} /> : <BellOff size={16} />,
      title: activeLocalState?.muted ? t('chat.social.detail.unmute') : t('chat.social.detail.notifications'),
      description: activeLocalState?.muted ? t('chat.social.detail.unmuteDesc') : t('chat.social.detail.notificationsDesc'),
      onClick: () => updateActiveLocalState({ muted: !activeLocalState?.muted }),
    },
    {
      icon: activeLocalState?.sticky ? <PinOff size={16} /> : <Pin size={16} />,
      title: activeLocalState?.sticky ? t('chat.social.detail.unpinTop') : t('chat.social.detail.pinTop'),
      description: activeLocalState?.sticky ? t('chat.social.detail.unpinTopDesc') : t('chat.social.detail.pinTopDesc'),
      onClick: () => updateActiveLocalState({ sticky: !activeLocalState?.sticky }),
    },
    {
      icon: activeLocalState?.alertEnabled === false ? <BellRing size={16} /> : <BellOff size={16} />,
      title: activeLocalState?.alertEnabled === false ? t('chat.social.detail.alertsOn') : t('chat.social.detail.alerts'),
      description: activeLocalState?.alertEnabled === false ? t('chat.social.detail.alertsOnDesc') : t('chat.social.detail.alertsDesc'),
      onClick: () => updateActiveLocalState({ alertEnabled: activeLocalState?.alertEnabled === false }),
    },
    {
      icon: <ImageIcon size={16} />,
      title: t('chat.social.detail.background'),
      description: t('chat.social.detail.backgroundDesc'),
      onClick: openBackgroundModal,
    },
    {
      icon: <Trash2 size={16} />,
      title: t('chat.social.detail.clearHistory'),
      description: t('chat.social.detail.clearHistoryDesc'),
      danger: true,
      onClick: confirmClearHistory,
    },
    ...(activeLocalState?.clearedAt ? [{
      icon: <RotateCcw size={16} />,
      title: t('chat.social.detail.restoreHistory'),
      description: t('chat.social.detail.restoreHistoryDesc'),
      onClick: () => updateActiveLocalState({ clearedAt: 0 }),
    }] : []),
  ];


  useEffect(() => {
    if (isGroup && activeUlid) {
      loadGroupMembers(activeUlid);
    }
  }, [isGroup, activeUlid, loadGroupMembers]);

  useEffect(() => {
    setShowAllMembers(false);
    setInviteModalOpen(false);
    setInviteDids([]);
  }, [activeUlid]);

  // Lazy peer profile load — same pattern as ChatContactsDetailPanel.
  // The cache lives in socialChat (single owner) so this effect just
  // signals the projection to fetch when a friend chat is selected.
  useEffect(() => {
    if (!isGroup && peerDid) {
      void loadPeerProfile(peerDid);
    }
  }, [isGroup, peerDid, loadPeerProfile]);

  useEffect(() => {
    if (isGroup || !peerDid) {
      setPeerBlocked(false);
      return;
    }
    let cancelled = false;
    void api.friendChatGetFriendshipStatus(peerDid)
      .then((response) => {
        if (!cancelled) setPeerBlocked(Number(response.friend?.status ?? 0) === FriendshipStatus.BLOCKED);
      })
      .catch((error) => {
        log.warn('chat', 'friendship status load failed', { peerDid, error });
        if (!cancelled) setPeerBlocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isGroup, peerDid]);

  const cachedPeerProfile = !isGroup && peerDid ? peerProfiles[peerDid] : undefined;

  return (
    <Flexbox
      style={{
        width: 320,
        height: '100%',
        background: token.colorBgContainer,
        overflow: 'auto',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        style={{
          position: 'relative',
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ width: '100%', textAlign: 'center', fontSize: 15 }}>
          {t('chat.social.detail.title')}
        </Text>
        <Button
          type="text"
          icon={<X size={16} />}
          onClick={() => setShowDetail(false)}
          style={{ position: 'absolute', right: 12, width: 28, height: 28 }}
        />
      </Flexbox>

      <Flexbox style={{ padding: 16 }}>
        <PublicProfileCard
          compact
          profile={buildChatDetailProfile({
            isGroup,
            displayName,
            peerAvatar,
            peerDid,
            activeGroup,
            groupMemberCount,
            peerPresenceKnown,
            peerIsOnline,
            encryptionEnabled,
            cachedPeerProfile,
            t,
          })}
          avatarNode={isGroup ? (
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 76,
                height: 76,
                borderRadius: 18,
                background: token.colorFillSecondary,
                color: token.colorTextSecondary,
              }}
            >
              <Users size={34} />
            </Flexbox>
          ) : undefined}
        />
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      {isGroup && (
        <>
          <Flexbox style={{ padding: '12px 16px' }} gap={6}>
            <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.members', { count: groupMemberCount })}</Text>
              <Button
                type="link"
                size="small"
                style={{ fontSize: 12, padding: 0 }}
                disabled={members.length <= 6}
                onClick={() => setShowAllMembers((value) => !value)}
              >
                {showAllMembers
                  ? t('chat.social.detail.showLess')
                  : t('chat.social.detail.seeAll')}
              </Button>
            </Flexbox>
            {members.length > 0 ? (
              (showAllMembers ? members : members.slice(0, 6)).map((m) => {
                const memberRole = Number(m.role ?? GroupRole.MEMBER);
                const canManageTarget = canManageGroupMembers
                  && m.actorDid !== currentUserDid
                  && memberRole !== GroupRole.OWNER
                  && (myGroupRole === GroupRole.OWNER || memberRole < myGroupRole);
                return (
                  <MemberItem
                    key={m.actorDid}
                    member={m}
                    action={canManageTarget ? (
                      <Flexbox horizontal gap={4}>
                        {myGroupRole === GroupRole.OWNER ? (
                          <Button
                            type="text"
                            size="small"
                            onClick={() => confirmUpdateGroupMemberRole(
                              m,
                              memberRole === GroupRole.ADMIN ? GroupRole.MEMBER : GroupRole.ADMIN,
                            )}
                          >
                            {memberRole === GroupRole.ADMIN
                              ? t('chat.social.detail.demoteAdmin')
                              : t('chat.social.detail.promoteAdmin')}
                          </Button>
                        ) : null}
                        <Button type="text" size="small" onClick={() => toggleGroupMemberMuted(m)}>
                          {m.muted ? t('chat.social.detail.unmuteMember') : t('chat.social.detail.muteMember')}
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          danger
                          onClick={() => confirmRemoveGroupMember(m)}
                        >
                          {t('chat.social.detail.removeMember')}
                        </Button>
                      </Flexbox>
                    ) : undefined}
                  />
                );
              })
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.detail.membersLoading')}
              </Text>
            )}
            <Button
              type="dashed"
              icon={<UserPlus size={14} />}
              block
              size="small"
              style={{ marginTop: 4 }}
              disabled={!canManageGroupMembers || inviteCandidates.length === 0}
              onClick={() => setInviteModalOpen(true)}
            >
              {t('chat.social.detail.addMember')}
            </Button>
          </Flexbox>
          <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />
        </>
      )}

      <Modal
        title={t('chat.social.detail.addMember')}
        open={inviteModalOpen}
        okText={t('chat.social.detail.addMember')}
        cancelText={t('chat.social.messageArea.cancel')}
        confirmLoading={inviteSubmitting}
        okButtonProps={{ disabled: inviteDids.length === 0 }}
        onOk={() => void submitGroupInvites()}
        onCancel={() => {
          setInviteModalOpen(false);
          setInviteDids([]);
        }}
      >
        <Flexbox gap={8}>
          <Text type="secondary">{t('chat.social.detail.addMemberDesc')}</Text>
          <Select
            mode="multiple"
            value={inviteDids}
            options={inviteCandidates.map((candidate) => ({
              label: candidate.name || candidate.did,
              value: candidate.did,
            }))}
            placeholder={t('chat.social.detail.addMemberPlaceholder')}
            onChange={setInviteDids}
            style={{ width: '100%' }}
          />
        </Flexbox>
      </Modal>

      <Flexbox style={{ padding: '12px 16px' }} gap={12}>
        <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.sharedContent')}</Text>
        <DetailAttachmentSection
          title={t('chat.social.detail.mediaWithCount', { count: mediaAttachments.length })}
          emptyLabel={t('chat.social.detail.mediaEmpty')}
          items={mediaAttachments}
          limit={RECENT_MEDIA_LIMIT}
        />
        <DetailAttachmentSection
          title={t('chat.social.detail.filesWithCount', { count: fileAttachments.length })}
          emptyLabel={t('chat.social.detail.filesEmpty')}
          items={fileAttachments}
          limit={RECENT_FILE_LIMIT}
        />
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      <Flexbox style={{ padding: '12px 16px' }} gap={8}>
        <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.actions')}</Text>
        <Flexbox
          gap={2}
          style={{
            padding: 4,
            borderRadius: 16,
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {actionRows.map((action) => (
            <DetailActionRow key={action.title} {...action} />
          ))}
        </Flexbox>
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      <Flexbox style={{ padding: '8px 16px 16px' }}>
        {isGroup ? (
          <Button
            type="text"
            danger
            icon={<LogOut size={16} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            onClick={async () => {
              if (activeUlid) {
                try {
                  await api.groupChatLeaveGroup(activeUlid);
                  await loadGroups();
                  selectGroup('');
                  setShowDetail(false);
                } catch (e) {
                  log.error('chat', 'leave group failed', e);
                }
              }
            }}
          >
            {t('chat.social.detail.leaveGroup')}
        </Button>
      ) : (
        <Button
          type="text"
          danger
          icon={peerBlocked ? <RotateCcw size={16} /> : <Ban size={16} />}
          style={{ justifyContent: 'flex-start', height: 36 }}
          block
          disabled={!peerDid}
          onClick={peerBlocked ? confirmUnblockUser : confirmBlockUser}
        >
          {peerBlocked ? t('chat.social.detail.unblockUser') : t('chat.social.detail.blockUser')}
          </Button>
        )}
      </Flexbox>

      {encryptionEnabled && (
        <>
          <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />
          <Flexbox style={{ padding: '12px 16px' }} gap={8}>
            <Flexbox horizontal align="center" gap={6}>
              <Lock size={14} style={{ color: token.colorSuccess }} />
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.encryption.title')}</Text>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.social.encryption.fingerprint')}</Text>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {ownFingerprint || '—'}
            </Text>
            {/* Identity verification — only meaningful on friend
                chats where there is a single peer to compare
                against. Group safety numbers wait on the chat
                ratchet upgrade. */}
            {!isGroup && peerDid ? (
              <Button
                type={verifyOpen ? 'default' : 'primary'}
                ghost={!verifyOpen}
                icon={<ShieldCheck size={14} />}
                size="small"
                onClick={() => setVerifyOpen((v) => !v)}
                style={{ marginTop: 4 }}
              >
                {verifyOpen
                  ? t('chat.social.verify.hide')
                  : t('chat.social.verify.show')}
              </Button>
            ) : null}
          </Flexbox>
          {!isGroup && peerDid && verifyOpen && currentUserDid ? (
            <SafetyVerificationPanel
              localActorDid={currentUserDid}
              localFingerprint={ownFingerprint || ''}
              peerDid={peerDid}
            />
          ) : null}
          {activeTab === 'friend' ? (
            <Flexbox style={{ padding: '8px 16px 12px' }} gap={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.encryption.upgradeBody.line3')}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.encryption.upgradeBlocked')}
              </Text>
            </Flexbox>
          ) : null}
        </>
      )}
    </Flexbox>
  );
}

interface BuildChatDetailProfileArgs {
  isGroup: boolean;
  displayName: string;
  peerAvatar: string;
  peerDid: string;
  activeGroup: Group | undefined;
  groupMemberCount: number;
  peerPresenceKnown: boolean;
  peerIsOnline: boolean | null | undefined;
  encryptionEnabled: boolean;
  cachedPeerProfile: AccountProfile | null | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

// Compose the profile data shown in the chat detail card from session-derived
// snapshots and the lazily-loaded Station profile. Station fields take
// precedence whenever present so freshly-edited bios/regions show through;
// the session row keeps the avatar/displayName/online state visible during
// the brief network round-trip.
function buildChatDetailProfile({
  isGroup,
  displayName,
  peerAvatar,
  peerDid,
  activeGroup,
  groupMemberCount,
  peerPresenceKnown,
  peerIsOnline,
  encryptionEnabled,
  cachedPeerProfile,
  t,
}: BuildChatDetailProfileArgs): PublicProfileModel {
  const presenceLabel = isGroup
    ? t('chat.social.detail.membersCount', { count: groupMemberCount })
    : peerPresenceKnown
      ? peerIsOnline
        ? t('chat.social.detail.online')
        : t('chat.social.detail.offline')
      : t('chat.social.detail.directMessage');
  const encryptionBadge = {
    label: encryptionEnabled
      ? t('chat.social.detail.encrypted')
      : t('chat.social.detail.notEncrypted'),
    tone: encryptionEnabled ? ('success' as const) : ('warning' as const),
  };

  if (isGroup) {
    return {
      displayName,
      did: activeGroup?.ulid,
      bio: activeGroup?.description,
      relationLabel: presenceLabel,
      relationTone: 'default',
      badges: [encryptionBadge],
      stats: [
        {
          label: t('chat.social.detail.membersLabel', { defaultValue: 'members' }),
          value: groupMemberCount,
        },
      ],
    };
  }

  const stats: { label: string; value: number }[] = [];
  if (cachedPeerProfile) {
    if (typeof cachedPeerProfile.statuses_count === 'number') {
      stats.push({
        label: t('chat.social.detail.posts', { defaultValue: 'Posts' }),
        value: cachedPeerProfile.statuses_count,
      });
    }
    if (typeof cachedPeerProfile.followers_count === 'number') {
      stats.push({
        label: t('chat.social.detail.followers', { defaultValue: 'Followers' }),
        value: cachedPeerProfile.followers_count,
      });
    }
    if (typeof cachedPeerProfile.following_count === 'number') {
      stats.push({
        label: t('chat.social.detail.following', { defaultValue: 'Following' }),
        value: cachedPeerProfile.following_count,
      });
    }
  }

  return {
    displayName: cachedPeerProfile?.display_name?.trim() || displayName,
    avatar: cachedPeerProfile?.avatar?.trim() || peerAvatar,
    header: cachedPeerProfile?.header?.trim() || undefined,
    username: cachedPeerProfile?.username?.trim() || undefined,
    bio: cachedPeerProfile?.note?.trim() || undefined,
    did: cachedPeerProfile?.id?.trim() || peerDid,
    createdAt: cachedPeerProfile?.created_at?.trim() || undefined,
    region: cachedPeerProfile?.region?.trim() || undefined,
    tags: (cachedPeerProfile?.tags ?? []).filter(Boolean),
    links: (cachedPeerProfile?.links ?? []).filter((l) => l && (l.label || l.url)),
    relationLabel: presenceLabel,
    relationTone: peerIsOnline ? 'success' : 'default',
    badges: [encryptionBadge],
    stats: stats.length > 0 ? stats : undefined,
  };
}
