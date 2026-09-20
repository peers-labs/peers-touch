import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Modal, Select, Tag, theme, Tooltip, Typography } from 'antd';
import {
  type ChatAttachmentLike,
  chatMediaKindForAttachment,
  formatChatAttachmentSize,
} from '@peers-touch/client-chat-core';
import {
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
import { groupAvatarRemoteUrl } from '../../store/socialChat';
import { GroupSquareAvatar } from '../common/GroupSquareAvatar';
import {
  CHAT_BACKGROUND_OPTIONS,
  projectDesktopIMMessages,
  type DesktopIMMessageProjection,
} from '../../store/socialProjection';
import { api, type AccountProfile } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import type { FriendChatSession } from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  GroupRole,
  type Group,
  type GroupMember,
} from '../../gen/proto/domain/chat/group_chat_pb';
import { SafetyVerificationPanel } from './SafetyVerificationPanel';
import { useMessagingAttachmentUrl } from './AttachmentItem';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
import { SquareAvatar } from '../common/SquareAvatar';
import { getGroupMemberControlState } from './chatGroupPermissions';
import { presentError } from '../../services/errorPresenter';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
} from './useActiveSocialChatStore';
import { imServiceV1 } from '../../services/im-service';
import { setCachedOssAttachmentUrl } from '../../services/ossAttachmentUrlCache';
import { resolveFederationStationName } from '../../store/federation';

const { Text } = Typography;

const DETAIL_HEADER_HEIGHT = 64;
const HISTORY_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;

type DetailAttachment = ChatAttachmentLike;
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
type GroupMemberLike = Pick<GroupMember, 'ptid' | 'nickname' | 'role' | 'muted'>;

interface GroupMemberDisplay extends GroupMemberLike {
  displayName: string;
  subtitle?: string;
  avatar?: string;
}

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function groupRoleLabel(role: number, t: (key: string) => string): string {
  if (role >= GroupRole.OWNER) return t('chat.social.detail.roleOwner');
  if (role >= GroupRole.ADMIN) return t('chat.social.detail.roleAdmin');
  return t('chat.social.detail.roleMember');
}

function formatHistoryRestoreRemaining(remainingMs: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return t('chat.social.detail.restoreHistoryRemainingHoursMinutes', { hours, minutes });
  }
  return t('chat.social.detail.restoreHistoryRemainingMinutes', { minutes });
}

function getCurrentConversationAttachments(messages: DesktopIMMessageProjection[]): DetailAttachmentItem[] {
  const items: DetailAttachmentItem[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.recalled || !message.attachments || message.attachments.length === 0) return;

    const timestampMs = message.sentAtMs;
    message.attachments.forEach((attachment, attachmentIndex) => {
      const mediaKind = chatMediaKindForAttachment(attachment);
      const isImage = mediaKind === 'image';
      const isVideo = mediaKind === 'video';
      items.push({
        id: `${message.id || messageIndex}:${attachment.cid || attachmentIndex}`,
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

function MemberAvatar({ member, size = 32 }: { member: GroupMemberDisplay; size?: number }) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      data-chat-avatar-ptid={member.ptid}
      data-chat-avatar-src={member.avatar || ''}
      align="center"
      justify="center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: token.colorFillSecondary,
        color: token.colorTextSecondary,
        fontSize: Math.max(12, Math.round(size * 0.36)),
        fontWeight: 700,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <SquareAvatar
        remoteUrl={member.avatar}
        name={member.displayName}
        size={size}
        radius={Math.round(size * 0.32)}
        style={{ display: 'block' }}
      >
        {getInitial(member.displayName)}
      </SquareAvatar>
    </Flexbox>
  );
}

function MemberPreviewCard({ member }: { member: GroupMemberDisplay }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const role = Number(member.role ?? GroupRole.MEMBER);
  return (
    <Flexbox data-chat-group-member={member.ptid} align="center" gap={6} style={{ width: 66, minWidth: 0 }}>
      <MemberAvatar member={member} size={42} />
      <Text ellipsis style={{ width: '100%', textAlign: 'center', fontSize: 12, fontWeight: 600 }}>
        {member.displayName}
      </Text>
      {role >= GroupRole.ADMIN || member.muted ? (
        <Text
          ellipsis
          style={{
            width: '100%',
            textAlign: 'center',
            fontSize: 10,
            color: role >= GroupRole.OWNER ? token.colorWarning : role >= GroupRole.ADMIN ? token.colorPrimary : token.colorTextTertiary,
          }}
        >
          {member.muted ? t('chat.social.detail.memberMuted') : groupRoleLabel(role, t)}
        </Text>
      ) : null}
    </Flexbox>
  );
}

function MemberItem({ member, action, lockedReason }: { member: GroupMemberDisplay; action?: ReactNode; lockedReason?: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const role = Number(member.role ?? GroupRole.MEMBER);
  return (
    <Flexbox horizontal align="center" gap={10} style={{ padding: '8px 0', minWidth: 0 }}>
      <MemberAvatar member={member} />
      <Flexbox gap={3} style={{ flex: 1, minWidth: 0 }}>
        <Text ellipsis style={{ fontSize: 13, fontWeight: 600 }}>{member.displayName}</Text>
        <Flexbox horizontal gap={4} align="center" style={{ minWidth: 0, flexWrap: 'wrap' }}>
          {member.subtitle ? (
            <Text type="secondary" ellipsis style={{ fontSize: 11, maxWidth: 120 }}>
              {member.subtitle}
            </Text>
          ) : null}
          <Tag
            bordered={false}
            color={role >= GroupRole.OWNER ? 'gold' : role >= GroupRole.ADMIN ? 'blue' : 'default'}
            style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}
          >
            {groupRoleLabel(role, t)}
          </Tag>
          {member.muted ? (
            <Tag bordered={false} color="warning" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
              {t('chat.social.detail.memberMuted')}
            </Tag>
          ) : null}
        </Flexbox>
      </Flexbox>
      {!action && lockedReason ? (
        <Tooltip title={lockedReason}>
          <Lock size={13} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
        </Tooltip>
      ) : null}
      {action ? (
        <Flexbox horizontal gap={4} style={{ justifyContent: 'flex-end', flexWrap: 'wrap', maxWidth: 188 }}>
          {action}
        </Flexbox>
      ) : null}
    </Flexbox>
  );
}

function DetailSection({ title, children, gap = 8 }: { title?: string; children: ReactNode; gap?: number }) {
  const { token } = theme.useToken();
  return (
    <Flexbox gap={gap} style={{ padding: '0 16px', marginBottom: 12, minWidth: 0 }}>
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
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
}

function Toggle({
  action,
  checked,
  disabled = false,
  onChange,
}: {
  action: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const { token } = theme.useToken();
  return (
    <button
      data-chat-conversation-action={action}
      data-chat-conversation-action-state={checked ? 'on' : 'off'}
      type="button"
      disabled={disabled}
      aria-busy={disabled}
      aria-checked={checked}
      role="switch"
      onClick={() => onChange(!checked)}
      style={{
        appearance: 'none',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        padding: 2,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
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
  const { src: openUrl, openState, resolve } = useMessagingAttachmentUrl(
    item.attachment,
    item.kind === 'media',
  );
  const previewUrl = openUrl;
  const filename = item.attachment.filename?.trim() || t('chat.social.detail.unnamedAttachment');
  const sizeLabel = formatChatAttachmentSize(item.attachment.size);
  const hasAttachmentIdentity = Boolean(
    (item.attachment as DetailAttachment & { attachmentId?: string }).attachmentId
      || item.attachment.cid?.startsWith('messaging:'),
  );
  const canOpen = hasAttachmentIdentity && openState !== 'pending';
  const isMedia = item.kind === 'media';
  const openStateLabel = openState === 'pending'
    ? t('chat.social.messageArea.attachmentStateDownloading')
    : openState === 'error'
      ? t('chat.social.messageArea.attachmentDownloadFailed')
      : '';
  const tooltip = openStateLabel || (
    hasAttachmentIdentity
      ? t('chat.social.detail.openAttachment')
      : t('chat.social.detail.attachmentUnavailable')
  );
  const Icon = item.isImage ? ImageIcon : item.isVideo ? Film : FileText;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPreviewFailed(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, item.attachment.cid]);

  const handleOpen = async () => {
    if (openState === 'pending') return;
    const resolved = openUrl ?? await resolve();
    if (resolved) window.open(resolved, '_blank');
  };

  if (isMedia) {
    return (
      <Tooltip title={tooltip}>
        <span style={{ display: 'inline-flex' }}>
          <button
            data-chat-detail-attachment={item.id}
            data-chat-detail-attachment-kind={item.kind}
            data-chat-detail-attachment-open-state={openState}
            aria-busy={openState === 'pending'}
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
              {openStateLabel ? (
                <Text type={openState === 'error' ? 'danger' : 'secondary'} ellipsis style={{ fontSize: 10 }}>
                  {openStateLabel}
                </Text>
              ) : null}
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
          data-chat-detail-attachment={item.id}
          data-chat-detail-attachment-kind={item.kind}
          data-chat-detail-attachment-open-state={openState}
          aria-busy={openState === 'pending'}
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
                {openStateLabel || sizeLabel || t('chat.social.detail.fileAttachment')}
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
  kind,
  title,
  emptyLabel,
  items,
  limit,
}: {
  kind: 'media' | 'files';
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
    <Flexbox
      data-chat-detail-attachments={kind}
      data-chat-detail-attachment-count={items.length}
      gap={8}
    >
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

function getFriendPeerDid(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid) return session.participantBPtid || '';
    if (session.participantBPtid === currentUserPtid) return session.participantAPtid || '';
  }
  return session.participantBPtid || session.participantAPtid || '';
}

function getFriendPeerName(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid)
      return session.participantBDisplayName || session.participantBPtid || '';
    if (session.participantBPtid === currentUserPtid)
      return session.participantADisplayName || session.participantAPtid || '';
  }
  return session.participantBDisplayName || session.participantBPtid || '';
}

function getFriendPeerAvatar(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid) return session.participantBAvatar || '';
    if (session.participantBPtid === currentUserPtid) return session.participantAAvatar || '';
  }
  return session.participantBAvatar || session.participantAAvatar || '';
}

function getFriendPeerDisplayProfile(
  session: FriendChatSession,
  currentUserPtid: string | null,
): { did: string; name: string; avatar: string } | null {
  if (currentUserPtid && session.participantAPtid === currentUserPtid) {
    return {
      did: session.participantBPtid || '',
      name: session.participantBDisplayName?.trim() || '',
      avatar: session.participantBAvatar || '',
    };
  }
  if (currentUserPtid && session.participantBPtid === currentUserPtid) {
    return {
      did: session.participantAPtid || '',
      name: session.participantADisplayName?.trim() || '',
      avatar: session.participantAAvatar || '',
    };
  }
  return {
    did: session.participantBPtid || session.participantAPtid || '',
    name: session.participantBDisplayName?.trim() || session.participantADisplayName?.trim() || '',
    avatar: session.participantBAvatar || session.participantAAvatar || '',
  };
}

export function ChatDetailPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    sessions, groups, groupMembers,
    setShowDetail, loadSessions, loadGroupMembers, loadGroups, loadMessages,
    loadConversationPreviews, selectGroup,
    conversationLocalState, updateConversationLocalState,
    setConversationBackgroundPreview,
    getIMConversations,
    messages,
    encryptionEnabled,
    ownFingerprint,
    currentUserPtid,
    currentUserProfile,
    peerOnline,
    peerProfiles,
    loadPeerProfile,
    setGroupSecurityState,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    sessions: s.sessions,
    groups: s.groups,
    groupMembers: s.groupMembers,
    setShowDetail: s.setShowDetail,
    loadSessions: s.loadSessions,
    loadGroupMembers: s.loadGroupMembers,
    loadGroups: s.loadGroups,
    loadMessages: s.loadMessages,
    loadConversationPreviews: s.loadConversationPreviews,
    selectGroup: s.selectGroup,
    conversationLocalState: s.conversationLocalState,
    updateConversationLocalState: s.updateConversationLocalState,
    setConversationBackgroundPreview: s.setConversationBackgroundPreview,
    getIMConversations: s.getIMConversations,
    messages: s.messages,
    encryptionEnabled: s.encryptionEnabled,
    ownFingerprint: s.ownFingerprint,
    currentUserPtid: s.currentUserPtid,
    currentUserProfile: s.currentUserProfile,
    peerOnline: s.peerOnline,
    peerProfiles: s.peerProfiles,
    loadPeerProfile: s.loadPeerProfile,
    setGroupSecurityState: s.setGroupSecurityState,
  }));
  const {
    actorStationEntries,
    memberStationsByFederation,
  } = useActiveChatFederationSlice((state) => ({
    actorStationEntries: state.actorStationEntries,
    memberStationsByFederation: state.memberStationsByFederation,
  }));

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const isGroup = activeTab === 'group';
  const activeConversation = activeUlid
    ? getIMConversations().find((conversation) => conversation.kind === activeTab && conversation.id === activeUlid)
    : undefined;
  const activeFriendSession = activeTab === 'friend'
    ? sessions.find((s) => s.ulid === activeUlid)
    : undefined;
  const activeGroup: Group | undefined = isGroup
    ? groups.find((g) => g.ulid === activeUlid)
    : undefined;
  const groupAvatarUrl = groupAvatarRemoteUrl(activeGroup)
    || (activeConversation?.avatar || '');
  const authorityStationId = activeConversation?.authorityStationId?.trim() || '';
  const authorityStationName = resolveFederationStationName({
    actorPtid: activeConversation?.peerPtid,
    federationId: activeConversation?.federationId,
    stationPeerId: authorityStationId,
    actorStationEntries,
    memberStationsByFederation,
  });

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [memberManagerOpen, setMemberManagerOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDids, setInviteDids] = useState<string[]>([]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [editingMyNickname, setEditingMyNickname] = useState(false);
  const [editMyNicknameValue, setEditMyNicknameValue] = useState('');
  const [historyActionPending, setHistoryActionPending] = useState(false);
  const [conversationActionPending, setConversationActionPending] = useState<string | null>(null);
  const [backgroundRetryPath, setBackgroundRetryPath] = useState<string | null>(null);
  const [historyNow, setHistoryNow] = useState(Date.now());

  const peerPtid = !isGroup
    ? activeConversation?.peerPtid || getFriendPeerDid(activeFriendSession, currentUserPtid)
    : '';
  const members: GroupMember[] = isGroup && activeUlid ? (groupMembers[activeUlid] || []) : [];
  const myGroupMember = currentUserPtid ? members.find((member) => member.ptid === currentUserPtid) : undefined;
  const myGroupNickname = myGroupMember?.nickname?.trim() || '';
  const memberProfiles = useMemo(() => {
    const profiles = new Map<string, { name: string; avatar: string }>();
    if (currentUserPtid) {
      profiles.set(currentUserPtid, {
        name: currentUserProfile?.displayName?.trim() || currentUserProfile?.username?.trim() || '',
        avatar: currentUserProfile?.avatar || '',
      });
    }
    sessions.forEach((session) => {
      const peerProfile = getFriendPeerDisplayProfile(session, currentUserPtid);
      if (peerProfile?.did && peerProfile.name) {
        profiles.set(peerProfile.did, { name: peerProfile.name, avatar: peerProfile.avatar });
      }
    });
    for (const [did, profile] of Object.entries(peerProfiles)) {
      if (profile && !profiles.has(did)) {
        profiles.set(did, {
          name: profile.display_name?.trim() || profile.username?.trim() || '',
          avatar: profile.avatar || '',
        });
      }
    }
    return profiles;
  }, [currentUserPtid, currentUserProfile, sessions, peerProfiles]);
  const displayMembers: GroupMemberDisplay[] = useMemo(() => {
    const sourceMembers: GroupMemberLike[] = members.length > 0
      ? members
      : activeGroup?.ownerPtid
        ? [{
            ptid: activeGroup.ownerPtid,
            nickname: '',
            role: GroupRole.OWNER,
            muted: false,
          }]
        : [];
    return sourceMembers.map((member) => {
      const nickname = member.nickname?.trim() || '';
      const profile = memberProfiles.get(member.ptid);
      const profileName = profile?.name?.trim() || '';
      const displayName = nickname || profileName || t('chat.social.detail.unknownMember');
      return {
        ...member,
        displayName,
        subtitle: nickname && profileName && nickname !== profileName ? profileName : undefined,
        avatar: profile?.avatar || '',
      };
    });
  }, [activeGroup?.ownerPtid, memberProfiles, members, t]);
  const memberDisplayByDid = useMemo(
    () => new Map(displayMembers.map((member) => [member.ptid, member])),
    [displayMembers],
  );
  const getMemberDisplayName = (member: GroupMember): string =>
    memberDisplayByDid.get(member.ptid)?.displayName
    || member.nickname?.trim()
    || t('chat.social.detail.unknownMember');
  const memberPtidSet = useMemo(() => new Set(members.map((member) => member.ptid)), [members]);
  const inviteCandidates = useMemo(
    () => sessions
      .map((session) => ({
        did: getFriendPeerDid(session, currentUserPtid),
        name: getFriendPeerName(session, currentUserPtid),
      }))
      .filter((candidate): candidate is { did: string; name: string } =>
        Boolean(candidate.did && !memberPtidSet.has(candidate.did)),
      ),
    [currentUserPtid, memberPtidSet, sessions],
  );
  const groupMemberCount = isGroup ? (activeConversation?.memberCount || activeGroup?.memberCount || members.length) : 0;
  const myGroupRole = activeGroup?.ownerPtid === currentUserPtid ? GroupRole.OWNER : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = Boolean(
    activeGroup?.ownerPtid === currentUserPtid ||
    myGroupRole >= GroupRole.ADMIN,
  );
  const isGroupOwner = isGroup && myGroupRole === GroupRole.OWNER;
  const myGroupRoleLabel = groupRoleLabel(myGroupRole, t);
  const groupPermissionTitle = isGroupOwner
    ? t('chat.social.detail.permissionOwnerTitle')
    : myGroupRole >= GroupRole.ADMIN
      ? t('chat.social.detail.permissionAdminTitle')
      : t('chat.social.detail.permissionMemberTitle');
  const groupPermissionBody = isGroupOwner
    ? t('chat.social.detail.permissionOwnerBody')
    : myGroupRole >= GroupRole.ADMIN
      ? t('chat.social.detail.permissionAdminBody')
      : t('chat.social.detail.permissionMemberBody');
  const currentName = isGroup
    ? (activeConversation?.title || activeGroup?.name || t('chat.social.sessionList.unnamedGroup'))
    : activeConversation?.title || getFriendPeerName(activeFriendSession, currentUserPtid);
  const displayName = currentName || t('chat.social.sessionList.unknown');
  const peerAvatar = activeConversation?.avatar || getFriendPeerAvatar(activeFriendSession, currentUserPtid);
  const peerPresenceKnown = peerPtid ? peerPtid in peerOnline : false;
  const peerIsOnline = peerPtid in peerOnline ? peerOnline[peerPtid] : null;
  const localStateKey = activeUlid ? `${activeTab}:${activeUlid}` : '';
  const activeLocalState = localStateKey ? conversationLocalState[localStateKey] : undefined;
  const activeMessages = useMemo(
    () => (
      activeUlid
        ? projectDesktopIMMessages(activeTab, activeUlid, messages[activeUlid] ?? [])
        : []
    ),
    [activeTab, activeUlid, messages],
  );
  const clearHistoryClearedAt = Number(activeLocalState?.clearedAt || 0);
  const clearHistoryExpiresAt = clearHistoryClearedAt > 0
    ? clearHistoryClearedAt + HISTORY_RESTORE_WINDOW_MS
    : 0;
  const canRestoreHistory = clearHistoryClearedAt > 0 && historyNow < clearHistoryExpiresAt;
  const restoreHistoryRemainingText = canRestoreHistory
    ? formatHistoryRestoreRemaining(clearHistoryExpiresAt - historyNow, t)
    : '';
  const clearHistoryExpired = clearHistoryClearedAt > 0 && !canRestoreHistory;
  const { mediaAttachments, fileAttachments } = useMemo(() => {
    const attachments = getCurrentConversationAttachments(activeMessages);
    return {
      mediaAttachments: attachments.filter((item) => item.kind === 'media'),
      fileAttachments: attachments.filter((item) => item.kind === 'file'),
    };
  }, [activeMessages]);

  useEffect(() => {
    if (!clearHistoryClearedAt || historyNow >= clearHistoryExpiresAt) return undefined;
    const timer = window.setInterval(() => setHistoryNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [clearHistoryClearedAt, clearHistoryExpiresAt, historyNow]);

  const runConversationAction = async (
    action: string,
    patch: Parameters<typeof updateConversationLocalState>[2],
  ): Promise<boolean> => {
    if (!activeUlid || conversationActionPending) return false;
    setConversationActionPending(action);
    try {
      await updateConversationLocalState(activeTab, activeUlid, patch);
      return true;
    } catch (error) {
      log.error('chat', 'conversation action failed', {
        action,
        kind: activeTab,
        ulid: activeUlid,
        error,
      });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
      return false;
    } finally {
      setConversationActionPending(null);
    }
  };

  const applyHistoryClearedAt = async (clearedAt: number) => {
    if (!activeUlid) return;
    setHistoryActionPending(true);
    // #region debug-point E:history-clear-marker
    void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'E', location: 'ChatDetailPanel.tsx:applyHistoryClearedAt:start', msg: '[DEBUG] History marker update started', data: { kind: activeTab, conversationId: activeUlid, previousClearedAt: clearHistoryClearedAt, requestedClearedAt: clearedAt }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    try {
      await updateConversationLocalState(activeTab, activeUlid, { clearedAt });
      setHistoryNow(Date.now());
      const refreshResults = await Promise.allSettled([
        loadMessages(activeUlid, activeTab),
        loadConversationPreviews(),
      ]);
      if (refreshResults.some((result) => result.status === 'rejected')) {
        log.warn('chat', 'conversation history committed; projection refresh deferred', {
          kind: activeTab,
          ulid: activeUlid,
          clearedAt,
        });
      }
      // #region debug-point E:history-clear-marker-result
      void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'E', location: 'ChatDetailPanel.tsx:applyHistoryClearedAt:success', msg: '[DEBUG] History marker update completed', data: { kind: activeTab, conversationId: activeUlid, requestedClearedAt: clearedAt }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      toast.success(clearedAt > 0
        ? t('chat.social.detail.clearHistorySuccess')
        : t('chat.social.detail.restoreHistorySuccess'));
    } catch (error) {
      // #region debug-point E:history-clear-marker-error
      void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'E', location: 'ChatDetailPanel.tsx:applyHistoryClearedAt:error', msg: '[DEBUG] History marker update failed', data: { kind: activeTab, conversationId: activeUlid, previousClearedAt: clearHistoryClearedAt, requestedClearedAt: clearedAt, error: String(error) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      log.error('chat', 'conversation history action failed', { kind: activeTab, ulid: activeUlid, clearedAt, error });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
      throw error;
    } finally {
      setHistoryActionPending(false);
    }
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

  const handleSaveMyNickname = async () => {
    if (!activeUlid) {
      setEditingMyNickname(false);
      return;
    }
    const nextNickname = editMyNicknameValue.trim();
    try {
      await api.groupChatUpdateNickname(activeUlid, nextNickname);
      await loadGroupMembers(activeUlid);
      toast.success(t('chat.social.detail.myNicknameUpdated'));
    } catch (error) {
      log.error('chat', 'update group nickname failed', { groupUlid: activeUlid, error });
      toast.error(t('chat.social.detail.myNicknameUpdateFailed'));
    }
    setEditingMyNickname(false);
  };

  const handleGroupAvatarClick = async () => {
    if (!activeUlid) return;
    let filePath: string;
    try {
      filePath = await api.pickImageFile();
    } catch {
      return;
    }
    try {
      const uploaded = await api.ossUploadAttachmentSocial(filePath);
      const avatarPath = `/sub-oss/file?key=${encodeURIComponent(uploaded.key)}`;
      await api.groupChatUpdateGroup(
        activeUlid,
        activeGroup?.name || displayName,
        activeGroup?.description || undefined,
        avatarPath,
      );
      toast.success(t('chat.social.detail.groupAvatarUpdated'));
      loadGroups();
    } catch (error) {
      log.error('chat', 'update group avatar failed', { groupUlid: activeUlid, error });
      toast.error(t('chat.social.detail.groupAvatarUpdateFailed'));
    }
  };

  const handleUploadBackgroundImage = async (filePath: string, previewUrl: string) => {
    if (!activeUlid) return;
    if (conversationActionPending) return;
    setConversationBackgroundPreview(activeTab, activeUlid, previewUrl);
    setBackgroundRetryPath(filePath);
    setConversationActionPending('background-image');
    const backgroundStartedAt = performance.now();
    // #region debug-point B:background-selection
    void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'B', location: 'ChatDetailPanel.tsx:handleUploadBackgroundImage:start', msg: '[DEBUG] Background upload started after local preview commit', data: { kind: activeTab, conversationId: activeUlid, filePathLength: filePath.length, currentBackgroundImage: activeLocalState?.backgroundImage || '' }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    try {
      const uploaded = await api.ossUploadLocalFile({
        file_path: filePath,
        bucket: 'personal',
        visibility: 'private',
        chat_session_id: null,
      });
      // #region debug-point B:background-uploaded
      void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'B', location: 'ChatDetailPanel.tsx:handleUploadBackgroundImage:uploaded', msg: '[DEBUG] Background upload completed', data: { kind: activeTab, conversationId: activeUlid, elapsedMs: Math.round(performance.now() - backgroundStartedAt), cid: uploaded.cid }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      setCachedOssAttachmentUrl(uploaded.cid, { src: previewUrl });
      await updateConversationLocalState(activeTab, activeUlid, { backgroundImage: uploaded.cid });
      setConversationBackgroundPreview(activeTab, activeUlid, null);
      // #region debug-point B:background-committed
      void fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-experience-failures', runId: 'post-fix', hypothesisId: 'B', location: 'ChatDetailPanel.tsx:handleUploadBackgroundImage:committed', msg: '[DEBUG] Background durable commit completed after preview', data: { kind: activeTab, conversationId: activeUlid, elapsedMs: Math.round(performance.now() - backgroundStartedAt), cid: uploaded.cid }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      setBackgroundRetryPath(null);
      toast.success(t('chat.social.detail.backgroundImageUpdated'));
    } catch (error) {
      setConversationBackgroundPreview(activeTab, activeUlid, null);
      log.error('chat', 'update chat background image failed', { kind: activeTab, ulid: activeUlid, error });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
    } finally {
      setConversationActionPending(null);
    }
  };

  const handleSelectBackgroundImage = async () => {
    if (conversationActionPending) return;
    let filePath: string;
    try {
      filePath = await api.pickImageFile();
    } catch {
      return;
    }
    const previewUrl = convertFileSrc(filePath);
    Modal.destroyAll();
    void handleUploadBackgroundImage(filePath, previewUrl);
  };

  const confirmClearHistory = () => {
    Modal.confirm({
      title: t('chat.social.detail.clearHistoryConfirmTitle'),
      content: t('chat.social.detail.clearHistoryConfirmBody', {
        duration: t('chat.social.detail.restoreHistoryWindowOneDay'),
      }),
      okText: t('chat.social.detail.clearHistory'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: () => applyHistoryClearedAt(Date.now()),
    });
  };

  const confirmRestoreHistory = () => {
    if (!canRestoreHistory) return;
    Modal.confirm({
      title: t('chat.social.detail.restoreHistoryConfirmTitle'),
      content: t('chat.social.detail.restoreHistoryConfirmBody', {
        remaining: restoreHistoryRemainingText,
      }),
      okText: t('chat.social.detail.restoreHistory'),
      cancelText: t('chat.social.messageArea.cancel'),
      onOk: () => applyHistoryClearedAt(0),
    });
  };

  const submitGroupInvites = async () => {
    if (!activeUlid || inviteDids.length === 0) return;
    setInviteSubmitting(true);
    const pendingDids = [...inviteDids];
    try {
      setGroupSecurityState(activeUlid, 'establishing');
      for (const did of pendingDids) {
        await imServiceV1.messaging.submitMembershipIntent({
          conversationId: activeUlid,
          action: 'add_actor',
          targetPtid: did,
        })
      }
      setGroupSecurityState(activeUlid, 'ready');
      await loadSessions();
      setInviteDids([]);
      setInviteModalOpen(false);
      toast.success(t('chat.social.detail.addMemberSuccess'));
    } catch (error) {
      setGroupSecurityState(activeUlid, 'error');
      log.error('chat', 'invite group members failed', { groupUlid: activeUlid, inviteeCount: inviteDids.length, error });
      toast.error(t('chat.social.detail.addMemberFailed'));
      throw error;
    } finally {
      setInviteSubmitting(false);
    }
  };

  const confirmRemoveGroupMember = (member: GroupMember) => {
    if (!activeUlid || !member.ptid) return;
    const memberName = getMemberDisplayName(member);
    Modal.confirm({
      title: t('chat.social.detail.removeMemberConfirmTitle'),
      content: t('chat.social.detail.removeMemberConfirmBody', { name: memberName }),
      okText: t('chat.social.detail.removeMember'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setGroupSecurityState(activeUlid, 'establishing');
          await imServiceV1.messaging.submitMembershipIntent({
            conversationId: activeUlid,
            action: 'remove_actor',
            targetPtid: member.ptid,
          })
          setGroupSecurityState(activeUlid, 'ready');
          await loadSessions();
          toast.success(t('chat.social.detail.removeMemberSuccess'));
        } catch (error) {
          setGroupSecurityState(activeUlid, 'error');
          log.error('chat', 'remove group member failed', { groupUlid: activeUlid, ptid: member.ptid, error });
          toast.error(t('chat.social.detail.removeMemberFailed'));
          throw error;
        }
      },
    });
  };

  const updateGroupMember = async (member: GroupMember, input: { role?: number; muted?: boolean }) => {
    if (!activeUlid || !member.ptid) return;
    try {
      await api.groupChatUpdateMember(activeUlid, member.ptid, input);
      await loadGroupMembers(activeUlid);
      toast.success(t('chat.social.detail.updateMemberSuccess'));
    } catch (error) {
      log.error('chat', 'update group member failed', { groupUlid: activeUlid, ptid: member.ptid, input, error });
      toast.error(t('chat.social.detail.updateMemberFailed'));
      throw error;
    }
  };

  const confirmUpdateGroupMemberRole = (member: GroupMember, role: number) => {
    const memberName = getMemberDisplayName(member);
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

  const confirmTransferGroupOwnership = (member: GroupMember) => {
    if (!activeUlid || !member.ptid) return;
    const memberName = getMemberDisplayName(member);
    Modal.confirm({
      title: t('chat.social.detail.transferOwnerConfirmTitle'),
      content: t('chat.social.detail.transferOwnerConfirmBody', { name: memberName }),
      okText: t('chat.social.detail.transferOwner'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.groupChatTransferOwnership(activeUlid, member.ptid);
          await Promise.allSettled([loadGroupMembers(activeUlid), loadGroups()]);
          toast.success(t('chat.social.detail.transferOwnerSuccess'));
        } catch (error) {
          log.error('chat', 'transfer group ownership failed', { groupUlid: activeUlid, nextOwnerPtid: member.ptid, error });
          toast.error(t('chat.social.detail.transferOwnerFailed'));
          throw error;
        }
      },
    });
  };

  const confirmLeaveGroup = () => {
    if (!activeUlid) return;
    Modal.confirm({
      title: t('chat.social.detail.leaveGroupConfirmTitle'),
      content: t('chat.social.detail.leaveGroupConfirmBody'),
      okText: t('chat.social.detail.leaveGroup'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const [conversation, federationSelf] = await Promise.all([
            imServiceV1.conversation.getConversation(activeUlid),
            api.federationGetSelf(),
          ]);
          await imServiceV1.messaging.requestLeaveIntent({
            federationId: conversation.federationId,
            authorityStationPeerId: conversation.authorityStationPeerId,
            authorityEpoch: Number(conversation.authorityEpoch),
            homeStationPeerId: federationSelf.homeStationPeerId,
            conversationId: activeUlid,
            observedMembershipEpoch: Number(conversation.membershipEpoch),
            observedMlsEpoch: Number(conversation.mlsEpoch),
          });
          setGroupSecurityState(activeUlid, 'establishing');
          setShowDetail(false);
        } catch (error) {
          log.error('chat', 'leave group failed', { groupUlid: activeUlid, error });
          toast.error(t('chat.social.detail.leaveGroupFailed'));
          throw error;
        }
      },
    });
  };

  const confirmDissolveGroup = () => {
    if (!activeUlid) return;
    Modal.confirm({
      title: t('chat.social.detail.dissolveGroupConfirmTitle'),
      content: t('chat.social.detail.dissolveGroupConfirmBody'),
      okText: t('chat.social.detail.dissolveGroup'),
      cancelText: t('chat.social.messageArea.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.groupChatDissolveGroup(activeUlid);
          await loadGroups();
          selectGroup('');
          setShowDetail(false);
          toast.success(t('chat.social.detail.dissolveGroupSuccess'));
        } catch (error) {
          log.error('chat', 'dissolve group failed', { groupUlid: activeUlid, error });
          toast.error(t('chat.social.detail.dissolveGroupFailed'));
          throw error;
        }
      },
    });
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
            data-chat-background-select
            value={activeLocalState?.background || 'default'}
            options={CHAT_BACKGROUND_OPTIONS.map((value) => ({
              value,
              label: t(`chat.social.background.${value}`),
            }))}
            onChange={(value) => {
              void runConversationAction('background', { background: value }).then((updated) => {
                if (updated) Modal.destroyAll();
              });
            }}
            disabled={Boolean(conversationActionPending)}
            style={{ width: '100%' }}
          />
          <Button
            data-chat-background-upload
            block
            icon={<ImageIcon size={14} />}
            loading={conversationActionPending === 'background-image'}
            onClick={() => {
              void handleSelectBackgroundImage();
            }}
          >
            {t('chat.social.detail.uploadBackgroundImage')}
          </Button>
          {backgroundRetryPath ? (
            <Button
              data-chat-background-retry
              block
              loading={conversationActionPending === 'background-image'}
              onClick={() => {
                Modal.destroyAll();
                void handleUploadBackgroundImage(
                  backgroundRetryPath,
                  convertFileSrc(backgroundRetryPath),
                );
              }}
            >
              {t('chat.social.detail.retryBackgroundImage')}
            </Button>
          ) : null}
          {activeLocalState?.backgroundImage ? (
            <Button
              data-chat-background-clear
              block
              type="text"
              danger
              loading={conversationActionPending === 'background-image-clear'}
              onClick={() => {
                void runConversationAction('background-image-clear', {
                  backgroundImage: '',
                }).then((updated) => {
                  if (updated) Modal.destroyAll();
                });
              }}
            >
              {t('chat.social.detail.clearBackgroundImage')}
            </Button>
          ) : null}
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
    setMemberManagerOpen(false);
    setInviteModalOpen(false);
    setInviteDids([]);
    setEditingName(false);
    setConversationActionPending(null);
    setBackgroundRetryPath(null);
    setEditingMyNickname(false);
  }, [activeUlid]);

  useEffect(() => {
    if (!isGroup && peerPtid) {
      void loadPeerProfile(peerPtid);
    }
  }, [isGroup, peerPtid, loadPeerProfile]);

  const cachedPeerProfile = !isGroup && peerPtid ? peerProfiles[peerPtid] : undefined;

  return (
    <Flexbox
      data-chat-detail-panel="open"
      data-chat-detail-conversation={activeUlid}
      data-chat-detail-muted={activeLocalState?.muted ? 'true' : 'false'}
      data-chat-detail-pinned={activeLocalState?.sticky ? 'true' : 'false'}
      data-chat-detail-background={activeLocalState?.background || 'default'}
      data-chat-detail-background-image={activeLocalState?.backgroundImage || ''}
      data-chat-detail-cleared-at={String(activeLocalState?.clearedAt || 0)}
      data-chat-detail-action-pending={conversationActionPending || ''}
      data-chat-detail-background-retry={backgroundRetryPath ? 'true' : 'false'}
      style={{
        width: 320,
        maxWidth: '100%',
        minWidth: 0,
        height: '100%',
        background: token.colorBgContainer,
        overflow: 'hidden',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
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
      <Flexbox style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {/* Identity section */}
        {isGroup ? (
          <Flexbox align="center" gap={12} style={{ padding: '20px 16px 12px' }}>
            {/* Avatar with edit overlay */}
            <div
              style={{ position: 'relative', cursor: 'pointer' }}
              onClick={handleGroupAvatarClick}
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
                  overflow: 'hidden',
                }}
              >
                <GroupSquareAvatar
                  remoteUrl={groupAvatarUrl || undefined}
                  members={members.slice(0, 4).map((m) => {
                    const p = memberProfiles.get(m.ptid);
                    return { name: p?.name || m.nickname || '', avatar: p?.avatar || '' };
                  })}
                  name={displayName}
                  size={72}
                  radius={18}
                />
              </Flexbox>
              {isGroup && (
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
                peerPtid,
                activeGroup,
                groupMemberCount,
                peerPresenceKnown,
                peerIsOnline,
                encryptionEnabled,
                cachedPeerProfile,
                authorityStationId,
                authorityStationName,
                federationId: activeConversation?.federationId || '',
                t,
              })}
            />
          </Flexbox>
        )}

        <Flexbox
          data-chat-station="authority"
          data-chat-station-id={authorityStationId}
          data-chat-station-name={authorityStationName}
          data-chat-station-state={authorityStationId ? 'available' : 'unavailable'}
          horizontal
          align="center"
          justify="center"
          style={{ padding: '0 16px 10px', minWidth: 0 }}
        >
          <Text
            type="secondary"
            ellipsis={authorityStationName ? { tooltip: authorityStationName } : false}
            style={{ maxWidth: '100%', fontSize: 11 }}
          >
            {authorityStationName
              ? t('chat.social.detail.authorityStation', { station: authorityStationName })
              : t('chat.social.detail.authorityStationUnavailable')}
          </Text>
        </Flexbox>

        {isGroup ? (
          <DetailSection title={t('chat.social.detail.permissionLabel')} gap={10}>
            <Flexbox horizontal align="center" justify="space-between" gap={10}>
              <Flexbox gap={3} style={{ minWidth: 0 }}>
                <Text strong style={{ fontSize: 13 }}>{groupPermissionTitle}</Text>
                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.45 }}>
                  {groupPermissionBody}
                </Text>
              </Flexbox>
              <Tag
                bordered={false}
                color={isGroupOwner ? 'gold' : myGroupRole >= GroupRole.ADMIN ? 'blue' : 'default'}
                style={{ marginInlineEnd: 0, flexShrink: 0 }}
              >
                {myGroupRoleLabel}
              </Tag>
            </Flexbox>
          </DetailSection>
        ) : null}

        {/* Members section (group only) */}
        {isGroup && (
          <DetailSection title={t('chat.social.detail.membersLabel')}>
            {displayMembers.length > 0 ? (
              <Flexbox horizontal gap={10} style={{ flexWrap: 'wrap', minWidth: 0 }}>
                {(showAllMembers ? displayMembers : displayMembers.slice(0, 8)).map((member) => (
                  <MemberPreviewCard key={member.ptid} member={member} />
                ))}
              </Flexbox>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.detail.membersLoading')}
              </Text>
            )}
            <Flexbox horizontal align="center" justify="space-between" gap={8} style={{ marginTop: 4, minWidth: 0, flexWrap: 'wrap' }}>
              <Button
                data-chat-group-add-member-open
                type="dashed"
                icon={<UserPlus size={14} />}
                size="small"
                disabled={inviteCandidates.length === 0}
                onClick={() => setInviteModalOpen(true)}
              >
                {t('chat.social.detail.addMember')}
              </Button>
              <Flexbox horizontal gap={8} style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
                {displayMembers.length > 8 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ fontSize: 12, padding: 0 }}
                    onClick={() => setShowAllMembers((v) => !v)}
                  >
                    {showAllMembers ? t('chat.social.detail.showLess') : t('chat.social.detail.seeAll')}
                  </Button>
                )}
                <Button
                  data-chat-group-manage-members
                  type="link"
                  size="small"
                  style={{ fontSize: 12, padding: 0 }}
                  disabled={members.length === 0}
                  onClick={() => setMemberManagerOpen(true)}
                >
                  {t('chat.social.detail.manageMembers')}
                </Button>
              </Flexbox>
            </Flexbox>
          </DetailSection>
        )}

        {/* Settings section */}
        <DetailSection title={t('chat.social.detail.settings')}>
          {isGroup ? (
            <Flexbox horizontal align="center" justify="space-between" gap={10}>
              <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, flex: 1 }}>
                <Users size={15} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                <Flexbox gap={1} style={{ minWidth: 0, flex: 1 }}>
                  <Text style={{ fontSize: 13 }}>{t('chat.social.detail.myGroupNickname')}</Text>
                  {editingMyNickname ? (
                    <input
                      autoFocus
                      value={editMyNicknameValue}
                      placeholder={t('chat.social.detail.myGroupNicknamePlaceholder')}
                      onChange={(event) => setEditMyNicknameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleSaveMyNickname();
                        if (event.key === 'Escape') setEditingMyNickname(false);
                      }}
                      onBlur={() => void handleSaveMyNickname()}
                      style={{
                        border: 'none',
                        borderBottom: `1px solid ${token.colorPrimary}`,
                        background: 'transparent',
                        color: token.colorText,
                        fontSize: 12,
                        outline: 'none',
                        padding: '2px 0',
                      }}
                    />
                  ) : (
                    <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                      {myGroupNickname || t('chat.social.detail.myGroupNicknameUnset')}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
              {!editingMyNickname ? (
                <Button
                  size="small"
                  type="text"
                  onClick={() => {
                    setEditMyNicknameValue(myGroupNickname);
                    setEditingMyNickname(true);
                  }}
                >
                  {t('chat.social.detail.edit')}
                </Button>
              ) : null}
            </Flexbox>
          ) : null}
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <BellOff size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.muteNotifications')}</Text>
            </Flexbox>
            <Toggle
              action="mute"
              checked={Boolean(activeLocalState?.muted)}
              disabled={conversationActionPending === 'mute'}
              onChange={(v) => {
                void runConversationAction('mute', { muted: v });
              }}
            />
          </Flexbox>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Pin size={15} style={{ color: token.colorTextSecondary }} />
              <Text style={{ fontSize: 13 }}>{t('chat.social.detail.pinConversation')}</Text>
            </Flexbox>
            <Toggle
              action="pin"
              checked={Boolean(activeLocalState?.sticky)}
              disabled={conversationActionPending === 'pin'}
              onChange={(v) => {
                void runConversationAction('pin', { sticky: v });
              }}
            />
          </Flexbox>
          <Flexbox
            data-chat-conversation-action="background"
            horizontal
            align="center"
            justify="space-between"
            style={{ cursor: conversationActionPending ? 'wait' : 'pointer' }}
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
            kind="media"
            title={t('chat.social.detail.mediaWithCount', { count: mediaAttachments.length })}
            emptyLabel={t('chat.social.detail.mediaEmpty')}
            items={mediaAttachments}
            limit={RECENT_MEDIA_LIMIT}
          />
          <DetailAttachmentSection
            kind="files"
            title={t('chat.social.detail.filesWithCount', { count: fileAttachments.length })}
            emptyLabel={t('chat.social.detail.filesEmpty')}
            items={fileAttachments}
            limit={RECENT_FILE_LIMIT}
          />
        </DetailSection>

        {/* Security section */}
        {encryptionEnabled && !isGroup && (
          <DetailSection title={t('chat.social.encryption.title')}>
            <Flexbox horizontal align="center" gap={6}>
              <Lock size={14} style={{ color: token.colorSuccess }} />
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.encryption.title')}</Text>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.social.encryption.fingerprint')}</Text>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {ownFingerprint || '—'}
            </Text>
            {!isGroup && peerPtid ? (
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
            {!isGroup && peerPtid && verifyOpen && currentUserPtid ? (
              <SafetyVerificationPanel
                localActorPtid={currentUserPtid}
                localFingerprint={ownFingerprint || ''}
                peerPtid={peerPtid}
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
            data-chat-history-action="clear"
            type="text"
            danger
            icon={<Trash2 size={14} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            loading={historyActionPending}
            disabled={historyActionPending}
            onClick={confirmClearHistory}
          >
            {t('chat.social.detail.clearHistory')}
          </Button>
          {canRestoreHistory ? (
            <Flexbox gap={4}>
              <Button
                data-chat-history-action="restore"
                type="text"
                icon={<RotateCcw size={14} />}
                style={{ justifyContent: 'flex-start', height: 36 }}
                block
                loading={historyActionPending}
                disabled={historyActionPending}
                onClick={confirmRestoreHistory}
              >
                {t('chat.social.detail.restoreHistory')}
              </Button>
              <Text type="secondary" style={{ fontSize: 12, padding: '0 11px 4px' }}>
                {t('chat.social.detail.restoreHistoryRemaining', { remaining: restoreHistoryRemainingText })}
              </Text>
            </Flexbox>
          ) : clearHistoryExpired ? (
            <Text type="secondary" style={{ fontSize: 12, padding: '0 11px 4px' }}>
              {t('chat.social.detail.restoreHistoryExpired')}
            </Text>
          ) : null}
          {isGroup ? (
            <Button
              type="text"
              danger
              icon={isGroupOwner ? <Trash2 size={14} /> : <LogOut size={14} />}
              style={{ justifyContent: 'flex-start', height: 36 }}
              block
              onClick={isGroupOwner ? confirmDissolveGroup : confirmLeaveGroup}
            >
              {isGroupOwner ? t('chat.social.detail.dissolveGroup') : t('chat.social.detail.leaveGroup')}
            </Button>
          ) : null}
        </DetailSection>

        {/* Spacer for scroll padding */}
        <div style={{ height: 16 }} />
      </Flexbox>

      {/* Member management modal */}
      <Modal
        title={t('chat.social.detail.manageMembers')}
        open={memberManagerOpen}
        footer={null}
        width={520}
        onCancel={() => setMemberManagerOpen(false)}
      >
        <Flexbox gap={10} style={{ maxHeight: 'min(520px, 70vh)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
          {displayMembers.map((member) => {
            const memberRole = Number(member.role ?? GroupRole.MEMBER);
            const targetIsSelf = member.ptid === currentUserPtid;
            const controlState = getGroupMemberControlState({
              canManageGroupMembers,
              isSelf: targetIsSelf,
              membersLoaded: members.length > 0,
              myGroupRole,
              targetRole: memberRole,
            });
            const managedMember = members.find((groupMember) => groupMember.ptid === member.ptid);
            const lockedReason = controlState.lockedReasonKey ? t(controlState.lockedReasonKey) : undefined;
            return (
              <MemberItem
                key={member.ptid}
                member={member}
                lockedReason={lockedReason}
                action={controlState.canManageTarget && managedMember ? (
                  <>
                    {myGroupRole === GroupRole.OWNER ? (
                      <>
                        <Button
                          type="text"
                          size="small"
                          onClick={() => confirmUpdateGroupMemberRole(
                            managedMember,
                            memberRole === GroupRole.ADMIN ? GroupRole.MEMBER : GroupRole.ADMIN,
                          )}
                        >
                          {memberRole === GroupRole.ADMIN
                            ? t('chat.social.detail.demoteAdmin')
                            : t('chat.social.detail.promoteAdmin')}
                        </Button>
                        <Button type="text" size="small" onClick={() => confirmTransferGroupOwnership(managedMember)}>
                          {t('chat.social.detail.transferOwner')}
                        </Button>
                      </>
                    ) : null}
                    <Button type="text" size="small" onClick={() => toggleGroupMemberMuted(managedMember)}>
                      {member.muted ? t('chat.social.detail.unmuteMember') : t('chat.social.detail.muteMember')}
                    </Button>
                    <Button
                      data-chat-group-remove-member={member.ptid}
                      type="text"
                      size="small"
                      danger
                      onClick={() => confirmRemoveGroupMember(managedMember)}
                    >
                      {t('chat.social.detail.removeMember')}
                    </Button>
                  </>
                ) : undefined}
              />
            );
          })}
        </Flexbox>
      </Modal>

      {/* Invite modal */}
      <Modal
        title={t('chat.social.detail.addMember')}
        open={inviteModalOpen}
        okText={t('chat.social.detail.addMember')}
        cancelText={t('chat.social.messageArea.cancel')}
        confirmLoading={inviteSubmitting}
        okButtonProps={{
          'data-chat-group-add-member-submit': 'true',
          disabled: inviteDids.length === 0,
        }}
        onOk={() => void submitGroupInvites()}
        onCancel={() => {
          setInviteModalOpen(false);
          setInviteDids([]);
        }}
      >
        <Flexbox gap={8}>
          <Text type="secondary">{t('chat.social.detail.addMemberDesc')}</Text>
          <Select
            data-chat-group-add-member-select
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
  peerPtid: string;
  activeGroup: Group | undefined;
  groupMemberCount: number;
  peerPresenceKnown: boolean;
  peerIsOnline: boolean | null | undefined;
  encryptionEnabled: boolean;
  cachedPeerProfile: AccountProfile | null | undefined;
  authorityStationId: string;
  authorityStationName: string;
  federationId: string;
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
  peerPtid,
  activeGroup,
  groupMemberCount,
  peerPresenceKnown,
  peerIsOnline,
  encryptionEnabled,
  cachedPeerProfile,
  authorityStationId,
  authorityStationName,
  federationId,
  t,
}: BuildChatDetailProfileArgs): PublicProfileModel {
  const presenceLabel = isGroup
    ? t('chat.social.detail.membersCount', { count: groupMemberCount })
    : peerPresenceKnown
      ? peerIsOnline
        ? t('chat.social.detail.online')
        : t('chat.social.detail.offline')
      : t('chat.social.detail.presenceUnavailable');
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
    did: cachedPeerProfile?.id?.trim() || peerPtid,
    createdAt: cachedPeerProfile?.created_at?.trim() || undefined,
    region: cachedPeerProfile?.region?.trim() || undefined,
    tags: (cachedPeerProfile?.tags ?? []).filter(Boolean),
    links: (cachedPeerProfile?.links ?? []).filter((l) => l && (l.label || l.url)),
    relationLabel: presenceLabel,
    relationTone: peerIsOnline ? 'success' : 'default',
    identityMetadata: authorityStationName
      ? [t('chat.social.identity.station', { station: authorityStationName })]
      : undefined,
    technicalDetails: [
      {
        id: 'actor-ptid',
        label: t('chat.social.identity.details.actorPtid'),
        value: cachedPeerProfile?.id?.trim() || peerPtid,
      },
      {
        id: 'station-peer-id',
        label: t('chat.social.identity.details.stationPeerId'),
        value: authorityStationId,
      },
      {
        id: 'federation-id',
        label: t('chat.social.identity.details.federationId'),
        value: federationId,
      },
    ].filter((detail) => detail.value).map((detail) => ({
      ...detail,
      copyLabel: t('chat.social.identity.details.copy', { label: detail.label }),
      copiedLabel: t('chat.social.identity.details.copied', { label: detail.label }),
      copyFailedLabel: t('chat.social.identity.details.copyFailed', { label: detail.label }),
    })),
    technicalDetailsLabel: t('chat.social.identity.details.title'),
    badges: [encryptionBadge],
    stats: stats.length > 0 ? stats : undefined,
  };
}
