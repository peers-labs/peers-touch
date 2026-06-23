import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Modal, Select, theme, Tooltip, Typography } from 'antd';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import {
  chatMediaKindForAttachment,
  formatChatAttachmentSize,
} from '@peers-touch/client-chat-core';
import { FriendshipStatus } from '../../gen/proto/domain/chat/chat_pb';
import {
  Ban,
  BellOff,
  Camera,
  ChevronRight,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  LogOut,
  Paperclip,
  Pin,
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
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';

const { Text } = Typography;

const DETAIL_HEADER_HEIGHT = 56;

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

const RECENT_MEDIA_LIMIT = 6;
const RECENT_FILE_LIMIT = 4;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
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
      const mediaKind = chatMediaKindForAttachment(attachment);
      const isImage = mediaKind === 'image';
      const isVideo = mediaKind === 'video';
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

function DetailSection({ title, children, gap = 8 }: { title?: string; children: ReactNode; gap?: number }) {
  const { token } = theme.useToken();
  return (
    <Flexbox gap={gap} style={{ padding: '0 16px', marginBottom: 12 }}>
      {title && (
        <Text style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: token.colorTextTertiary }}>
          {title}
        </Text>
      )}
      <Flexbox
        gap={gap}
        style={{
          padding: 12,
          borderRadius: 12,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        appearance: 'none',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        padding: 2,
        cursor: 'pointer',
        background: checked ? token.colorPrimary : token.colorFillSecondary,
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'block',
          width: 16,
          height: 16,
          borderRadius: 8,
          background: '#fff',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      />
    </button>
  );
}

function DetailAttachmentCard({ item }: { item: DetailAttachmentItem }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [previewFailed, setPreviewFailed] = useState(false);
  const openUrl = useOssAttachmentUrl(item.attachment.cid);
  const previewCid = item.isImage
    ? (item.attachment.thumbnailCid || item.attachment.cid)
    : item.attachment.thumbnailCid;
  const previewUrl = useOssAttachmentUrl(previewCid);
  const filename = item.attachment.filename?.trim() || t('chat.social.detail.unnamedAttachment');
  const sizeLabel = formatChatAttachmentSize(item.attachment.size);
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

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDids, setInviteDids] = useState<string[]>([]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [peerBlocked, setPeerBlocked] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

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
  const peerPresenceKnown = peerDid ? peerDid in peerOnline : false;
  const peerIsOnline = peerDid in peerOnline ? peerOnline[peerDid] : null;
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

  const handleSaveGroupName = async () => {
    if (!activeUlid || !editNameValue.trim()) {
      setEditingName(false);
      return;
    }
    try {
      await api.groupChatUpdateGroup(activeUlid, editNameValue.trim());
      await loadGroups();
      toast.success(t('chat.social.detail.groupNameUpdated'));
    } catch (error) {
      log.error('chat', 'update group name failed', { groupUlid: activeUlid, error });
      toast.error(t('chat.social.detail.groupNameUpdateFailed'));
    }
    setEditingName(false);
  };

  const handleGroupAvatarClick = () => {
    // Station API for group avatar upload is not yet available.
    // Show a placeholder toast; the UI entry point is ready for when the
    // backend supports it.
    toast.info(t('chat.social.detail.groupAvatarComingSoon'));
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
      title: t('chat.social.detail.chatBackground'),
      icon: null,
      width: 440,
      content: (
        <Flexbox gap={12}>
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
          <Flexbox gap={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('chat.social.detail.backgroundImageUrl')}</Text>
            <input
              placeholder="https://..."
              defaultValue={activeLocalState?.backgroundImage || ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateActiveLocalState({ backgroundImage: (e.target as HTMLInputElement).value.trim() });
                  Modal.destroyAll();
                }
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: `1px solid ${token.colorBorder}`,
                borderRadius: 6,
                background: token.colorBgContainer,
                color: token.colorText,
                fontSize: 13,
              }}
            />
          </Flexbox>
        </Flexbox>
      ),
      okButtonProps: { style: { display: 'none' } },
      cancelText: t('chat.social.messageArea.cancel'),
    });
  };

  useEffect(() => {
    if (isGroup && activeUlid) {
      loadGroupMembers(activeUlid);
    }
  }, [isGroup, activeUlid, loadGroupMembers]);

  useEffect(() => {
    setShowAllMembers(false);
    setInviteModalOpen(false);
    setInviteDids([]);
    setEditingName(false);
  }, [activeUlid]);

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
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        justify="center"
        style={{
          height: DETAIL_HEADER_HEIGHT,
          minHeight: DETAIL_HEADER_HEIGHT,
          position: 'relative',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 15 }}>
          {t('chat.social.detail.title')}
        </Text>
        <Button
          type="text"
          icon={<X size={16} />}
          onClick={() => setShowDetail(false)}
          style={{ position: 'absolute', right: 12, width: 28, height: 28 }}
        />
      </Flexbox>

      {/* Scrollable content */}
      <Flexbox style={{ flex: 1, overflow: 'auto' }}>
        {/* Identity section */}
        {isGroup ? (
          <Flexbox align="center" gap={12} style={{ padding: '20px 16px 12px' }}>
            {/* Avatar with edit overlay */}
            <div
              style={{ position: 'relative', cursor: canManageGroupMembers ? 'pointer' : 'default' }}
              onClick={canManageGroupMembers ? handleGroupAvatarClick : undefined}
            >
              <Flexbox
                align="center"
                justify="center"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  background: token.colorFillSecondary,
                  color: token.colorTextSecondary,
                }}
              >
                <Users size={32} />
              </Flexbox>
              {canManageGroupMembers && (
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: token.colorPrimary,
                    color: '#fff',
                    border: `2px solid ${token.colorBgContainer}`,
                  }}
                >
                  <Camera size={12} />
                </Flexbox>
              )}
            </div>
            {/* Editable group name */}
            {editingName ? (
              <Flexbox horizontal align="center" gap={8}>
                <input
                  autoFocus
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveGroupName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  onBlur={() => void handleSaveGroupName()}
                  style={{
                    border: 'none',
                    borderBottom: `2px solid ${token.colorPrimary}`,
                    background: 'transparent',
                    fontSize: 16,
                    fontWeight: 600,
                    textAlign: 'center',
                    outline: 'none',
                    width: 180,
                    padding: '2px 4px',
                    color: token.colorText,
                  }}
                />
              </Flexbox>
            ) : (
              <Text
                strong
                style={{ fontSize: 16, cursor: canManageGroupMembers ? 'pointer' : 'default' }}
                onClick={canManageGroupMembers ? () => {
                  setEditNameValue(activeGroup?.name || '');
                  setEditingName(true);
                } : undefined}
              >
                {displayName}
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('chat.social.detail.membersCount', { count: groupMemberCount })}
            </Text>
          </Flexbox>
        ) : (
          <Flexbox style={{ padding: '16px 16px 8px' }}>
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
            />
          </Flexbox>
        )}

        {/* Members section (group only) */}
        {isGroup && (
          <DetailSection title={t('chat.social.detail.membersLabel')}>
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
            <Flexbox horizontal align="center" justify="space-between" style={{ marginTop: 4 }}>
              <Button
                type="dashed"
                icon={<UserPlus size={14} />}
                size="small"
                disabled={!canManageGroupMembers || inviteCandidates.length === 0}
                onClick={() => setInviteModalOpen(true)}
              >
                {t('chat.social.detail.addMember')}
              </Button>
              {members.length > 6 && (
                <Button
                  type="link"
                  size="small"
                  style={{ fontSize: 12, padding: 0 }}
                  onClick={() => setShowAllMembers((v) => !v)}
                >
                  {showAllMembers ? t('chat.social.detail.showLess') : t('chat.social.detail.seeAll')}
                </Button>
              )}
            </Flexbox>
          </DetailSection>
        )}

        {/* Settings section */}
        <DetailSection title={t('chat.social.detail.settings')}>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <BellOff size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.muteNotifications')}</Text>
            </Flexbox>
            <Toggle
              checked={Boolean(activeLocalState?.muted)}
              onChange={(v) => updateActiveLocalState({ muted: v })}
            />
          </Flexbox>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Pin size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.pinConversation')}</Text>
            </Flexbox>
            <Toggle
              checked={Boolean(activeLocalState?.sticky)}
              onChange={(v) => updateActiveLocalState({ sticky: v })}
            />
          </Flexbox>
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ cursor: 'pointer' }}
            onClick={openBackgroundModal}
          >
            <Flexbox horizontal align="center" gap={8}>
              <ImageIcon size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.chatBackground')}</Text>
            </Flexbox>
            <ChevronRight size={15} style={{ color: token.colorTextQuaternary }} />
          </Flexbox>
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ cursor: 'pointer' }}
            onClick={() => window.dispatchEvent(new CustomEvent('peers-chat:open-search'))}
          >
            <Flexbox horizontal align="center" gap={8}>
              <Search size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.searchMessages')}</Text>
            </Flexbox>
            <ChevronRight size={15} style={{ color: token.colorTextQuaternary }} />
          </Flexbox>
        </DetailSection>

        {/* Shared Content section */}
        <DetailSection title={t('chat.social.detail.sharedContent')}>
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
        </DetailSection>

        {/* Security section */}
        {encryptionEnabled && (
          <DetailSection title={t('chat.social.encryption.title')}>
            <Flexbox horizontal align="center" gap={6}>
              <Lock size={14} style={{ color: token.colorSuccess }} />
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.encryption.title')}</Text>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.social.encryption.fingerprint')}</Text>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {ownFingerprint || '—'}
            </Text>
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
            {!isGroup && peerDid && verifyOpen && currentUserDid ? (
              <SafetyVerificationPanel
                localActorDid={currentUserDid}
                localFingerprint={ownFingerprint || ''}
                peerDid={peerDid}
              />
            ) : null}
            {activeTab === 'friend' ? (
              <Flexbox gap={4} style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('chat.social.encryption.upgradeBody.line3')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('chat.social.encryption.upgradeBlocked')}
                </Text>
              </Flexbox>
            ) : null}
          </DetailSection>
        )}

        {/* Danger zone */}
        <DetailSection title={t('chat.social.detail.dangerZone')}>
          <Button
            type="text"
            danger
            icon={<Trash2 size={14} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            onClick={confirmClearHistory}
          >
            {t('chat.social.detail.clearHistory')}
          </Button>
          {activeLocalState?.clearedAt ? (
            <Button
              type="text"
              icon={<RotateCcw size={14} />}
              style={{ justifyContent: 'flex-start', height: 36 }}
              block
              onClick={() => updateActiveLocalState({ clearedAt: 0 })}
            >
              {t('chat.social.detail.restoreHistory')}
            </Button>
          ) : null}
          {isGroup ? (
            <Button
              type="text"
              danger
              icon={<LogOut size={14} />}
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
              icon={peerBlocked ? <RotateCcw size={14} /> : <Ban size={14} />}
              style={{ justifyContent: 'flex-start', height: 36 }}
              block
              disabled={!peerDid}
              onClick={peerBlocked ? confirmUnblockUser : confirmBlockUser}
            >
              {peerBlocked ? t('chat.social.detail.unblockUser') : t('chat.social.detail.blockUser')}
            </Button>
          )}
        </DetailSection>

        {/* Spacer for scroll padding */}
        <div style={{ height: 16 }} />
      </Flexbox>

      {/* Invite modal */}
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
          label: t('chat.social.detail.membersLabel'),
          value: groupMemberCount,
        },
      ],
    };
  }

  const stats: { label: string; value: number }[] = [];
  if (cachedPeerProfile) {
    if (typeof cachedPeerProfile.statuses_count === 'number') {
      stats.push({
        label: t('chat.social.detail.posts'),
        value: cachedPeerProfile.statuses_count,
      });
    }
    if (typeof cachedPeerProfile.followers_count === 'number') {
      stats.push({
        label: t('chat.social.detail.followers'),
        value: cachedPeerProfile.followers_count,
      });
    }
    if (typeof cachedPeerProfile.following_count === 'number') {
      stats.push({
        label: t('chat.social.detail.following'),
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
